// src/cli/stage2c-run.ts — Stage 2C skeleton runner CLI entry point.
//
// Usage: node --import=tsx src/cli/stage2c-run.ts --task "..." [--dry-run]
//
// TRUST BOUNDARY:
//   - No Anthropic API transport is wired in Step 1.
//   - No live session is created.
//   - clearedForRealProjectMounting: false (invariant).
//   - Only runStage2cSkeleton is called — never _runStage2cSkeletonForTesting.

import fs from 'fs'
import { fileURLToPath } from 'url'
import { runStage2cSkeleton } from '../../scripts/stage2c-runner.js'

// ── Parse CLI args ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { task: string; dryRun: boolean } {
  let task = ''
  let dryRun = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--task' && i + 1 < argv.length) {
      task = argv[++i] ?? ''
    } else if (argv[i] === '--dry-run') {
      dryRun = true
    }
  }
  return { task, dryRun }
}

// ── Main — only when run directly as a script ─────────────────────────────────

const _currentFile = fileURLToPath(import.meta.url)
const _isMain = process.argv[1] !== undefined &&
  (process.argv[1] === _currentFile ||
   (() => { try { return fs.realpathSync(process.argv[1]!) === _currentFile } catch { return false } })())

if (_isMain) {
  const { task, dryRun } = parseArgs(process.argv.slice(2))

  if (!task) {
    console.error('[stage2c-run] --task is required')
    process.exit(1)
  }

  const result = runStage2cSkeleton({ task, dryRun })

  console.log(JSON.stringify(result.receipt ?? { outcome: result.outcome, blockerReason: result.blockerReason }, null, 2))

  if (result.outcome !== 'SKELETON_NO_AGENT_EXECUTION') {
    console.error(`[stage2c-run] blocked: ${result.blockerReason}`)
    process.exit(1)
  }

  console.error(`[stage2c-run] outcome: ${result.outcome}`)
  console.error(`[stage2c-run] runDir:  ${result.receipt!.runDir}`)
  process.exit(0)
}
