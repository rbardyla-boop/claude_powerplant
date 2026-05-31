#!/usr/bin/env node
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'
import { cmdInit } from './commands/init.js'
import { cmdInspect } from './commands/inspect.js'
import { cmdRun } from './commands/run.js'
import { cmdReview } from './commands/review.js'
import { cmdApprove } from './commands/approve.js'
import { cmdVerify } from './commands/verify.js'
import { cmdDoctor } from './commands/doctor.js'
import { cmdSetup } from './commands/setup.js'
import { cmdSkill } from './commands/skill.js'
import { cmdSession } from './commands/session.js'
import { cmdScout } from './commands/scout.js'
import { loadPowerplantEnv } from '../config/powerplant-home.js'

// Resolve the Powerplant package root from this file's location so that
// credentials are loaded from <pkg-root>/.env regardless of cwd.
// src/cli/powerplant.ts → src/cli → src → pkg-root
const __filename = fileURLToPath(import.meta.url)
const pkgRoot = path.join(path.dirname(__filename), '..', '..')

// Credential precedence: shell → pkg-root/.env → ~/.powerplant/.env
// The target-project directory is never read.
loadPowerplantEnv(pkgRoot)

function printUsage(): void {
  console.log('Usage:')
  console.log('  powerplant --version')
  console.log('  powerplant init    [project-path] [--stack <stack>] [--yes] [--force]')
  console.log('  powerplant setup   [--repair]')
  console.log('  powerplant inspect <project-path>')
  console.log('  powerplant verify  <project-path>')
  console.log('  powerplant doctor  [project-path]')
  console.log('  powerplant scout   [project-path] [--json]')
  console.log('  powerplant run     [--yes] [--session <id>] <project-path> ("<task>" | --candidate <file>)')
  console.log('  powerplant review  <run-id> [--json] [--diff]')
  console.log('  powerplant approve <run-id> [--dry-run] [--pr] [--extend-session <id>]')
  console.log('  powerplant session <subcommand>')
  console.log('  powerplant skill   <subcommand>')
  console.log()
  console.log('Commands:')
  console.log('  init     Generate .powerplant/POLICY.yaml and VERIFY.yaml for a project')
  console.log('  setup    Provision or migrate runtime resources; --repair validates via live API')
  console.log('  inspect  Show what Claude would see/modify without starting a session')
  console.log('  verify   Run approved checks in an isolated workspace (no agent, no network)')
  console.log('  doctor   Show runtime status and configuration (no API call)')
  console.log('  scout    Discover small repo affordances (read-only); writes .scout/ candidates')
  console.log('  run      Run a task on a sanitized copy (or session workspace) and produce a patch')
  console.log('  review   Display artifacts from a completed run')
  console.log('  approve  Apply a reviewed run to a git branch with evidence hash')
  console.log('  session  Manage iterative session chains (create, list, status, close)')
  console.log('  skill    Manage the Skill Reactor vault (import, test, promote, rollback)')
}

const [, , command, ...rest] = process.argv

switch (command) {
  case '--version':
  case '-V': {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf-8')) as { version: string }
    console.log(`powerplant ${pkg.version}`)
    break
  }

  case 'init': {
    await cmdInit(rest)
    break
  }

  case 'setup': {
    const repair = rest.includes('--repair')
    await cmdSetup(repair)
    break
  }

  case 'inspect': {
    const projectPath = rest[0]
    if (!projectPath) {
      console.error('Error: project-path is required.')
      printUsage()
      process.exit(1)
    }
    await cmdInspect(projectPath)
    break
  }

  case 'verify': {
    const projectPath = rest[0]
    if (!projectPath) {
      console.error('Error: project-path is required.')
      printUsage()
      process.exit(1)
    }
    await cmdVerify(projectPath)
    break
  }

  case 'doctor': {
    // Project path is optional for doctor
    await cmdDoctor(rest[0] ?? null)
    break
  }

  case 'scout': {
    await cmdScout(rest)
    break
  }

  case 'run': {
    let yes = false
    let sessionId: string | undefined
    let candidatePath: string | undefined
    const positionalArgs: string[] = []
    let i = 0
    while (i < rest.length) {
      const a = rest[i]
      if (a === '--yes') {
        yes = true
        i++
      } else if (a === '--session') {
        const next = rest[i + 1]
        if (next && !next.startsWith('-')) {
          sessionId = next
          i += 2
        } else {
          i++
        }
      } else if (a === '--candidate') {
        const next = rest[i + 1]
        if (next && !next.startsWith('-')) {
          candidatePath = next
          i += 2
        } else {
          console.error('Error: --candidate requires a path to a candidate JSON file.')
          process.exit(1)
        }
      } else if (a !== undefined && !a.startsWith('-')) {
        positionalArgs.push(a)
        i++
      } else {
        i++
      }
    }
    const projectPath = positionalArgs[0]
    const task = positionalArgs[1]
    if (!projectPath) {
      console.error('Error: project-path is required.')
      printUsage()
      process.exit(1)
    }
    // A run is driven by EITHER a task string OR a scout candidate — never both,
    // never neither. The candidate derives the task and bounds it to its scope.
    if (!task && !candidatePath) {
      console.error('Error: provide a task string or --candidate <file>.')
      printUsage()
      process.exit(1)
    }
    if (task && candidatePath) {
      console.error('Error: provide either a task string or --candidate, not both.')
      process.exit(1)
    }
    await cmdRun(projectPath, task ?? '', { yes, sessionId, candidatePath })
    break
  }

  case 'review': {
    await cmdReview(rest)
    break
  }

  case 'approve': {
    await cmdApprove(rest)
    break
  }

  case 'session': {
    const subcommand = rest[0]
    await cmdSession(subcommand, rest.slice(1))
    break
  }

  case 'skill': {
    await cmdSkill(rest)
    break
  }

  default: {
    if (command) {
      console.error(`Error: Unknown command '${command}'`)
      console.error()
    }
    printUsage()
    process.exit(command ? 1 : 0)
  }
}
