/**
 * Tests for surfacing Feature Trial fidelity in `approve --dry-run`.
 *
 * The approve dry-run reuses the same parser path as review
 * (buildReviewRenderState) and renders the signals via printApproveTrialSummary.
 * These tests cover that renderer + the parser join: faithful, drift, non-goal
 * advisory, missing (preserves prior output), and malformed (fail-safe). The
 * summary is informational and must never change approval — asserted by checking
 * the parsed classification is identical with and without the trial.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildReviewRenderState } from '../src/cli/commands/review.js'
import { printApproveTrialSummary } from '../src/cli/terminal-output.js'
import { FEATURE_TRIAL_CLAIM } from '../src/scout/feature-trial.js'

const PASS_VERIFICATION = `# Verification Report

### Check: \`scripts-syntax\`
Command: \`python -m compileall tests\`
Exit code: 0
Result: **PASS**
\`\`\`
ok
\`\`\`
`
const PASS_CLASSIFICATION = {
  terminationReason: 'COMPLETED', patchEligibleForApplication: true,
  readCount: 1, writeCount: 1, checkCount: 1,
  finalizeAttempted: true, artifactsComplete: true, repeatedCheckFailures: false,
}
const TRIAL = {
  candidateId: 'scout-001',
  candidateTitle: 'Add ai_provider dispatch test',
  source: 'scout',
  expectedFiles: ['tests/test_ai_provider.py'],
  nonGoals: ['Do not touch config files'],
  verificationCoverage: { strength: 'strong', reason: 'covers tests/test_ai_provider.py' },
  scopeCeiling: ['tests/**'],
  createdAt: '2026-06-01T00:00:00.000Z',
  claim: FEATURE_TRIAL_CLAIM,
}
const PATCH_FAITHFUL = `--- /dev/null
+++ b/tests/test_ai_provider.py
@@ -0,0 +1,1 @@
+def test_dispatch(): pass
`
const PATCH_DRIFT_CONFIG = `--- /dev/null
+++ b/tests/test_ai_provider.py
@@ -0,0 +1,1 @@
+def test_dispatch(): pass
--- a/src/config.ts
+++ b/src/config.ts
@@ -1 +1 @@
-a = 1
+a = 2
`

interface Opts { patch?: string; trial?: unknown; trialJson?: string; noTrial?: boolean }
function writeRun(o: Opts): { dir: string; runId: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-approve-trial-'))
  const dir = path.join(base, 'proj', 'pp-run-at-1')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'TASK.md'), 'add test')
  fs.writeFileSync(path.join(dir, 'VERIFICATION_REPORT.md'), PASS_VERIFICATION)
  fs.writeFileSync(path.join(dir, 'RUN_CLASSIFICATION.json'), JSON.stringify(PASS_CLASSIFICATION))
  fs.writeFileSync(path.join(dir, 'PATCH.diff'), o.patch ?? PATCH_FAITHFUL)
  if (o.trialJson !== undefined) fs.writeFileSync(path.join(dir, 'FEATURE_TRIAL.json'), o.trialJson)
  else if (!o.noTrial) fs.writeFileSync(path.join(dir, 'FEATURE_TRIAL.json'), JSON.stringify(o.trial ?? TRIAL, null, 2))
  return { dir, runId: 'pp-run-at-1' }
}

describe('printApproveTrialSummary — approve dry-run fidelity', () => {
  let logs: string[]
  beforeEach(() => {
    logs = []
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.join(' ')) })
  })
  afterEach(() => vi.restoreAllMocks())

  function render(o: Opts): string {
    const { dir, runId } = writeRun(o)
    printApproveTrialSummary(buildReviewRenderState(runId, dir))
    return logs.join('\n')
  }

  it('prints a faithful / no-drift signal for an in-scope patch', () => {
    const out = render({ patch: PATCH_FAITHFUL })
    expect(out).toContain('Feature Trial:')
    expect(out).toContain('scout-001')
    expect(out).toContain('faithful (no drift)')
    expect(out).toMatch(/Coverage:.*strong/)
  })

  it('prints an advisory DRIFT signal when the patch leaves scope', () => {
    const out = render({ patch: PATCH_DRIFT_CONFIG })
    expect(out).toContain('DRIFT')
    expect(out).toContain('src/config.ts')
  })

  it('prints an advisory non-goal warning for a non-goal-violating touch', () => {
    const out = render({ patch: PATCH_DRIFT_CONFIG })
    expect(out).toMatch(/possible violation/i)
    expect(out).toContain('Do not touch config files')
    expect(out).toContain('src/config.ts')
  })

  it('prints nothing when FEATURE_TRIAL.json is absent (preserves prior output)', () => {
    const out = render({ noTrial: true })
    expect(out).toBe('')
    expect(out).not.toContain('Feature Trial')
  })

  it('prints a single fail-safe warning for a malformed FEATURE_TRIAL.json', () => {
    const out = render({ trialJson: '{ not json' })
    expect(out).toMatch(/Feature Trial:.*could not|not valid JSON/i)
    expect(out).not.toContain('Expected files:')
  })

  it('renders "no advisory findings" when non-goals are not violated', () => {
    const out = render({ patch: PATCH_FAITHFUL })
    expect(out).toContain('no advisory findings')
  })
})

describe('approve dry-run trial summary is informational only', () => {
  it('classification is identical with and without FEATURE_TRIAL.json', () => {
    const a = writeRun({ patch: PATCH_FAITHFUL }) // with trial
    const b = writeRun({ patch: PATCH_FAITHFUL, noTrial: true }) // without
    const withTrial = buildReviewRenderState(a.runId, a.dir)
    const without = buildReviewRenderState(b.runId, b.dir)
    expect(withTrial.overallStatus).toBe(without.overallStatus)
    // The summary renderer is pure output — it returns nothing and cannot alter state.
    expect(printApproveTrialSummary(withTrial)).toBeUndefined()
  })
})
