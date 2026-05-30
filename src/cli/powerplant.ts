#!/usr/bin/env node
import { fileURLToPath } from 'url'
import path from 'path'
import { cmdInit } from './commands/init.js'
import { cmdInspect } from './commands/inspect.js'
import { cmdRun } from './commands/run.js'
import { cmdReview } from './commands/review.js'
import { cmdVerify } from './commands/verify.js'
import { cmdDoctor } from './commands/doctor.js'
import { cmdSetup } from './commands/setup.js'
import { cmdSkill } from './commands/skill.js'
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
  console.log('  powerplant init    [project-path] [--stack <stack>] [--yes] [--force]')
  console.log('  powerplant setup   [--repair]')
  console.log('  powerplant inspect <project-path>')
  console.log('  powerplant verify  <project-path>')
  console.log('  powerplant doctor  [project-path]')
  console.log('  powerplant run     [--yes] <project-path> "<task>"')
  console.log('  powerplant review  <run-id>')
  console.log('  powerplant skill   <subcommand>')
  console.log()
  console.log('Commands:')
  console.log('  init     Generate .powerplant/POLICY.yaml and VERIFY.yaml for a project')
  console.log('  setup    Provision or migrate runtime resources; --repair validates via live API')
  console.log('  inspect  Show what Claude would see/modify without starting a session')
  console.log('  verify   Run approved checks in an isolated workspace (no agent, no network)')
  console.log('  doctor   Show runtime status and configuration (no API call)')
  console.log('  run      Run a task on a sanitized copy and produce a patch')
  console.log('  review   Display artifacts from a completed run')
  console.log('  skill    Manage the Skill Reactor vault (import, test, promote, rollback)')
}

const [, , command, ...rest] = process.argv

switch (command) {
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

  case 'run': {
    let yes = false
    let args = rest
    if (args[0] === '--yes') {
      yes = true
      args = args.slice(1)
    }
    const projectPath = args[0]
    const task = args[1]
    if (!projectPath) {
      console.error('Error: project-path is required.')
      printUsage()
      process.exit(1)
    }
    if (!task) {
      console.error('Error: task is required.')
      printUsage()
      process.exit(1)
    }
    await cmdRun(projectPath, task, { yes })
    break
  }

  case 'review': {
    const runId = rest[0]
    if (!runId) {
      console.error('Error: run-id is required.')
      printUsage()
      process.exit(1)
    }
    await cmdReview(runId)
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
