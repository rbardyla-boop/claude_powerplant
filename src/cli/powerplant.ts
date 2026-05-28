#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { cmdInspect } from './commands/inspect.js'
import { cmdRun } from './commands/run.js'
import { cmdReview } from './commands/review.js'

// Auto-load .env from the package root if ANTHROPIC_API_KEY is not set.
// This makes the binary work when run from the package directory without
// needing `source .env` or `--env-file=.env` as separate steps.
function loadDotEnv(): void {
  if (process.env['ANTHROPIC_API_KEY']) return
  const __filename = fileURLToPath(import.meta.url)
  const pkgRoot = path.resolve(path.dirname(__filename), '..', '..')
  const envFile = path.join(pkgRoot, '.env')
  if (!fs.existsSync(envFile)) return
  const lines = fs.readFileSync(envFile, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (key && !process.env[key]) {
      process.env[key] = val
    }
  }
}

function printUsage(): void {
  console.log('Usage:')
  console.log('  powerplant inspect <project-path>')
  console.log('  powerplant run [--yes] <project-path> "<task>"')
  console.log('  powerplant review <run-id>')
  console.log()
  console.log('Commands:')
  console.log('  inspect  Show what Claude would see/modify without starting a session')
  console.log('  run      Run a task on a sanitized copy and produce a patch')
  console.log('  review   Display artifacts from a completed run')
}

loadDotEnv()

const [, , command, ...rest] = process.argv

switch (command) {
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

  default: {
    if (command) {
      console.error(`Error: Unknown command '${command}'`)
      console.error()
    }
    printUsage()
    process.exit(command ? 1 : 0)
  }
}
