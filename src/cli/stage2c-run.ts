// src/cli/stage2c-run.ts — Stage 2C runner CLI entry point (Step 1 + Step 2).
//
// Usage: node --import=tsx src/cli/stage2c-run.ts --task "..." [--dry-run] [--fake-agent]
//
// TRUST BOUNDARY:
//   - No Anthropic API transport is wired.
//   - No live session is created.
//   - clearedForRealProjectMounting: false (invariant).
//   - Only runStage2cSkeleton is called — never _runStage2cSkeletonForTesting.
//   - --fake-agent writes only inside the sanitized candidate workspace.

import fs from 'fs'
import { fileURLToPath } from 'url'
import { runStage2cSkeleton } from '../../scripts/stage2c-runner.js'

// ── Parse CLI args ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { task: string; dryRun: boolean; fakeAgent: boolean } {
  let task = ''
  let dryRun = false
  let fakeAgent = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--task' && i + 1 < argv.length) {
      task = argv[++i] ?? ''
    } else if (argv[i] === '--dry-run') {
      dryRun = true
    } else if (argv[i] === '--fake-agent') {
      fakeAgent = true
    }
  }
  return { task, dryRun, fakeAgent }
}

// ── Main — only when run directly as a script ─────────────────────────────────

const _currentFile = fileURLToPath(import.meta.url)
const _isMain = process.argv[1] !== undefined &&
  (process.argv[1] === _currentFile ||
   (() => { try { return fs.realpathSync(process.argv[1]!) === _currentFile } catch { return false } })())

if (_isMain) {
  const { task, dryRun, fakeAgent } = parseArgs(process.argv.slice(2))

  if (!task) {
    console.error('[stage2c-run] --task is required')
    process.exit(1)
  }

  const result = runStage2cSkeleton({ task, dryRun, fakeAgent })

  console.log(JSON.stringify(result.receipt ?? { outcome: result.outcome, blockerReason: result.blockerReason }, null, 2))

  if (result.outcome === 'RUNNER_BLOCKED') {
    console.error(`[stage2c-run] blocked: ${result.blockerReason}`)
    process.exit(1)
  }

  console.error(`[stage2c-run] outcome: ${result.outcome}`)
  console.error(`[stage2c-run] runDir:  ${result.receipt!.runDir}`)
  process.exit(0)
}
