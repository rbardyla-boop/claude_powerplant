// src/cli/stage2c-run.ts — Stage 2C runner CLI entry point (Steps 1–10).
//
// Usage: node --import=tsx src/cli/stage2c-run.ts --task "..." [--dry-run] [--fake-agent] [--oracle] [--fixture oracle-pass] [--managed-agent]
//
// TRUST BOUNDARY:
//   - No Anthropic API transport is wired without STAGE2C_MANAGED_AGENT_ENABLED=1
//     AND STAGE2C_MANAGED_AGENT_LIVE=1 AND credentials present.
//   - clearedForRealProjectMounting: false (invariant).
//   - Only runStage2cSkeleton is called — never _runStage2cSkeletonForTesting.
//   - --fake-agent writes only inside the sanitized candidate workspace.
//   - --oracle runs the subprocess oracle against the candidate workspace only.
//   - --fixture oracle-pass makes fake-agent write valid JS so oracle can PASS.
//   - --managed-agent requires STAGE2C_MANAGED_AGENT_ENABLED=1 env gate;
//     without it the runner emits a blocked receipt and exits 0.
//   - --managed-agent with STAGE2C_MANAGED_AGENT_LIVE=1 and credentials present
//     activates the bounded live adapter (Step 10); oracle is suppressed.

import fs from 'fs'
import { fileURLToPath } from 'url'
import { runStage2cSkeleton } from '../../scripts/stage2c-runner.js'

// ── Parse CLI args ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { task: string; dryRun: boolean; fakeAgent: boolean; oracle: boolean; fixture?: 'oracle-pass'; managedAgent: boolean } {
  let task = ''
  let dryRun = false
  let fakeAgent = false
  let oracle = false
  let fixture: 'oracle-pass' | undefined = undefined
  let managedAgent = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--task' && i + 1 < argv.length) {
      task = argv[++i] ?? ''
    } else if (argv[i] === '--dry-run') {
      dryRun = true
    } else if (argv[i] === '--fake-agent') {
      fakeAgent = true
    } else if (argv[i] === '--oracle') {
      oracle = true
    } else if (argv[i] === '--fixture' && i + 1 < argv.length) {
      const val = argv[++i]
      if (val === 'oracle-pass') fixture = 'oracle-pass'
    } else if (argv[i] === '--managed-agent') {
      managedAgent = true
    }
  }
  return { task, dryRun, fakeAgent, oracle, fixture, managedAgent }
}

// ── Main — only when run directly as a script ─────────────────────────────────

const _currentFile = fileURLToPath(import.meta.url)
const _isMain = process.argv[1] !== undefined &&
  (process.argv[1] === _currentFile ||
   (() => { try { return fs.realpathSync(process.argv[1]!) === _currentFile } catch { return false } })())

if (_isMain) {
  const { task, dryRun, fakeAgent, oracle, fixture, managedAgent } = parseArgs(process.argv.slice(2))

  if (!task) {
    console.error('[stage2c-run] --task is required')
    process.exit(1)
  }

  // runStage2cSkeleton is async (Step 10 live adapter requires await).
  const result = await runStage2cSkeleton({ task, dryRun, fakeAgent, oracle, fixture, managedAgent })

  console.log(JSON.stringify(result.receipt ?? { outcome: result.outcome, blockerReason: result.blockerReason }, null, 2))

  if (result.outcome === 'RUNNER_BLOCKED') {
    console.error(`[stage2c-run] blocked: ${result.blockerReason}`)
    process.exit(1)
  }

  console.error(`[stage2c-run] outcome: ${result.outcome}`)
  console.error(`[stage2c-run] runDir:  ${result.receipt!.runDir}`)
  process.exit(0)
}
