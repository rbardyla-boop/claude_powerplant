// src/cli/l1-harness-run.ts — Production L1 acceptance harness entrypoint.
//
// Authorization: Stage 2B Gate 2 — Immutable Fixture Binding and Production CLI
//
// Usage: node --import=tsx src/cli/l1-harness-run.ts [pilot-source-path]
//
// Live execution requires:
//   ANTHROPIC_API_KEY + CLAUDE_POWERPLANT_MODEL_ID + RUN_LIVE_L1_HARNESS=1
//
// TRUST BOUNDARY:
//   - fixtureAContentHash is loaded exclusively from the immutable L0 receipt
//     (l0-fixture-receipt.json) written by acceptance-bootstrap.ts at promotion time.
//   - The receipt is validated before any live work can begin.
//   - Missing, malformed or schema-mismatched receipts fail closed immediately.
//   - Only runL1Harness is called — never _runL1HarnessForTesting.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import Anthropic from '@anthropic-ai/sdk'
import { L0_FIXTURE_RECEIPT_FILENAME } from '../acceptance/l0-fixture-receipt.js'
import { runL1Harness } from '../../scripts/l1-runner.js'
import { validateSprint4aLiveEnv } from '../config/env.js'
import { runSkillGuidedSanitizedProjectPilot } from '../sessions/run-skill-guided-sanitized-project-pilot.js'
import { loadSprint4aState } from '../platform/sprint4a-state.js'
import { getPowerplantHome } from '../config/powerplant-home.js'
import type { L1PilotResult } from '../../scripts/l1-runner.js'

export { L0_FIXTURE_RECEIPT_FILENAME }

// ── L0 fixture receipt type and loader ────────────────────────────────────────

export interface L0FixtureReceipt {
  schemaVersion: 1
  fixtureSkillId: string
  contentHash: string
  installedAt: string
}

/**
 * Load and validate the immutable L0 fixture receipt from the acceptance home.
 * Throws with a descriptive message on any validation failure.
 * Does not call any live API or read the registry — receipt only.
 */
export function loadL0Receipt(powerplantHome: string): L0FixtureReceipt {
  const receiptPath = path.join(powerplantHome, 'state', L0_FIXTURE_RECEIPT_FILENAME)

  if (!fs.existsSync(receiptPath)) {
    throw new Error(
      `L0 fixture receipt not found at ${receiptPath} — run acceptance-bootstrap first`,
    )
  }

  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(receiptPath, 'utf-8'))
  } catch {
    throw new Error(
      `L0 fixture receipt at ${receiptPath} is malformed JSON — cannot proceed`,
    )
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('L0 fixture receipt is not a JSON object')
  }

  const r = raw as Record<string, unknown>

  if (r['schemaVersion'] !== 1) {
    throw new Error(
      `L0 fixture receipt has unsupported schemaVersion: ${String(r['schemaVersion'])}`,
    )
  }
  if (typeof r['fixtureSkillId'] !== 'string' || !r['fixtureSkillId']) {
    throw new Error('L0 fixture receipt missing or empty fixtureSkillId')
  }
  if (
    typeof r['contentHash'] !== 'string' ||
    !/^[a-f0-9]{64}$/.test(r['contentHash'])
  ) {
    throw new Error(
      'L0 fixture receipt has missing or invalid contentHash' +
      ' (expected 64-char lowercase hex SHA-256)',
    )
  }
  if (typeof r['installedAt'] !== 'string' || !r['installedAt']) {
    throw new Error('L0 fixture receipt missing or empty installedAt')
  }

  return {
    schemaVersion: 1,
    fixtureSkillId: r['fixtureSkillId'],
    contentHash: r['contentHash'],
    installedAt: r['installedAt'],
  }
}

// ── Main execution — only when run directly as a script ──────────────────────
// Guarded by import.meta.url check so the module can be imported by tests
// without triggering live execution or process.exit calls.

const _currentFile = fileURLToPath(import.meta.url)
const _isMain = process.argv[1] !== undefined &&
  (process.argv[1] === _currentFile || fs.realpathSync(process.argv[1]) === _currentFile)

if (_isMain) {
  const powerplantHome = getPowerplantHome()
  const pilotSourcePath = process.argv[2] ?? process.env['L1_PILOT_SOURCE_PATH'] ?? ''

  // ── Step 1: Load and validate immutable L0 receipt (non-live, always runs) ──
  let receipt: L0FixtureReceipt
  try {
    receipt = loadL0Receipt(powerplantHome)
  } catch (err) {
    console.error(
      '[l1-harness-run] L0 receipt validation failed:',
      err instanceof Error ? err.message : String(err),
    )
    console.error('[l1-harness-run] Run acceptance-bootstrap first to install the L0 fixture.')
    process.exit(1)
  }

  console.log('[l1-harness-run] L0 receipt validated')
  console.log(`  fixtureSkillId: ${receipt.fixtureSkillId}`)
  console.log(`  contentHash:    ${receipt.contentHash}`)
  console.log(`  installedAt:    ${receipt.installedAt}`)

  // ── Step 2: Live-execution guard — explicit opt-in required ──────────────────
  // Receipt validation above is always safe to run. The live harness execution
  // requires RUN_LIVE_L1_HARNESS=1 AND valid API credentials (Step 3).
  if (process.env['RUN_LIVE_L1_HARNESS'] !== '1') {
    console.log()
    console.log(
      '[l1-harness-run] Receipt validated.' +
      ' Set RUN_LIVE_L1_HARNESS=1 to proceed with live execution.',
    )
    process.exit(0)
  }

  // ── Step 3: Validate live environment (API credentials) ──────────────────────
  const env = validateSprint4aLiveEnv()

  if (!pilotSourcePath) {
    console.error(
      '[l1-harness-run] Pilot source path required:' +
      ' pass as argv[2] or set L1_PILOT_SOURCE_PATH',
    )
    process.exit(1)
  }

  // ── Step 4: Load provisioned agent state ─────────────────────────────────────
  const state = loadSprint4aState()
  if (!state?.agent) {
    console.error(
      '[l1-harness-run] Sprint 4A agent state not found or incomplete' +
      ' — run provision step first',
    )
    process.exit(1)
  }

  const controlClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

  // ── Step 5: Run L1 harness — production path only ────────────────────────────
  // runL1Harness is the only entry point used here; _runL1HarnessForTesting is
  // never imported or referenced in this file.
  const result = await runL1Harness({
    powerplantHome,
    fixtureASkillId: receipt.fixtureSkillId,
    fixtureAContentHash: receipt.contentHash,
    pilotExecutor: async (): Promise<L1PilotResult> => {
      const report = await runSkillGuidedSanitizedProjectPilot({
        skillRequest: {
          skillId: receipt.fixtureSkillId,
          expectedHash: receipt.contentHash,
        },
        pilotSourcePath,
        controlClient,
        state,
      })
      return {
        report,
        builtinToolUseCount: report.builtinToolUseCount ?? -1,
      }
    },
  })

  console.log()
  console.log(`[l1-harness-run] verdict: ${result.verdict}`)
  if (result.blockerReason) {
    console.error(`[l1-harness-run] blocker: ${result.blockerReason}`)
  }

  process.exit(result.verdict === 'L1_CANDIDATE_PASS' ? 0 : 1)
}
