/**
 * Tests for surfacing FEATURE_TRIAL.json in `powerplant review`.
 *
 * The trial panel is informational: it must be visible in JSON and TUI when a
 * valid FEATURE_TRIAL.json is present, fail safe when it is missing or
 * malformed, and NEVER change the run's PASS/FAIL classification or approve
 * eligibility.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildReviewRenderState } from '../src/cli/commands/review.js'
import { printReviewTui } from '../src/cli/terminal-output.js'
import { FEATURE_TRIAL_CLAIM } from '../src/scout/feature-trial.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PASS_VERIFICATION = `# Verification Report

### Check: \`scripts-syntax\`
Command: \`python -m compileall tests\`
Exit code: 0
Result: **PASS**
\`\`\`
compiled
\`\`\`
`

const PASS_CLASSIFICATION = {
  terminationReason: 'COMPLETED',
  patchEligibleForApplication: true,
  readCount: 1, writeCount: 1, checkCount: 1,
  finalizeAttempted: true, artifactsComplete: true, repeatedCheckFailures: false,
}

const PATCH_IN_SCOPE = `--- /dev/null
+++ b/tests/test_ai_provider.py
@@ -0,0 +1,3 @@
+def test_dispatch():
+    assert provider("ollama") is not None
+
`

const PATCH_DRIFT = `--- /dev/null
+++ b/tests/test_ai_provider.py
@@ -0,0 +1,1 @@
+def test_dispatch(): pass
--- a/src/ai_provider.py
+++ b/src/ai_provider.py
@@ -1,1 +1,1 @@
-x = 1
+x = 2
`

const VALID_TRIAL = {
  candidateId: 'scout-001',
  candidateTitle: 'Add test for ai_provider dispatch',
  source: 'scout',
  expectedFiles: ['tests/test_ai_provider.py'],
  nonGoals: ['Do not change product modules', 'Do not touch config'],
  verificationCoverage: {
    strength: 'strong',
    reason: 'required check `scripts-syntax` covers `tests/test_ai_provider.py`',
  },
  scopeCeiling: ['tests/**'],
  createdAt: '2026-06-01T00:00:00.000Z',
  claim: FEATURE_TRIAL_CLAIM,
}

interface Artifacts {
  patchDiff?: string
  trialJson?: string // raw string so we can write malformed content
  trial?: unknown // object to JSON.stringify
}

function writeRun(a: Artifacts): { dir: string; runId: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-trial-review-'))
  const projectId = 'demo-project'
  const runId = 'pp-run-trial-1'
  const dir = path.join(base, projectId, runId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'TASK.md'), 'Add a focused test')
  fs.writeFileSync(path.join(dir, 'VERIFICATION_REPORT.md'), PASS_VERIFICATION)
  fs.writeFileSync(path.join(dir, 'RUN_CLASSIFICATION.json'), JSON.stringify(PASS_CLASSIFICATION))
  fs.writeFileSync(path.join(dir, 'PATCH.diff'), a.patchDiff ?? PATCH_IN_SCOPE)
  if (a.trialJson !== undefined) {
    fs.writeFileSync(path.join(dir, 'FEATURE_TRIAL.json'), a.trialJson)
  } else if (a.trial !== undefined) {
    fs.writeFileSync(path.join(dir, 'FEATURE_TRIAL.json'), JSON.stringify(a.trial, null, 2))
  }
  return { dir, runId }
}

// ── JSON / state ──────────────────────────────────────────────────────────────

describe('review state — featureTrial in JSON output', () => {
  it('includes featureTrial when FEATURE_TRIAL.json exists', () => {
    const { dir, runId } = writeRun({ trial: VALID_TRIAL })
    const state = buildReviewRenderState(runId, dir)
    expect(state.featureTrial).toBeDefined()
    expect(state.featureTrial!.candidateId).toBe('scout-001')
    expect(state.featureTrial!.candidateTitle).toBe('Add test for ai_provider dispatch')
    expect(state.featureTrial!.expectedFiles).toEqual(['tests/test_ai_provider.py'])
    expect(state.featureTrial!.nonGoals).toEqual(VALID_TRIAL.nonGoals)
    expect(state.featureTrial!.verificationCoverage.strength).toBe('strong')
    expect(state.featureTrial!.scopeCeiling).toEqual(['tests/**'])
  })

  it('joins trial expected files with the actual touched files and reports faithful/drift', () => {
    const a = writeRun({ trial: VALID_TRIAL })
    const inScope = buildReviewRenderState(a.runId, a.dir)
    expect(inScope.featureTrial!.actualFiles).toEqual(['tests/test_ai_provider.py'])
    expect(inScope.featureTrial!.unexpectedFiles).toEqual([])
    expect(inScope.featureTrial!.drift).toBe('none')

    const b = writeRun({ trial: VALID_TRIAL, patchDiff: PATCH_DRIFT })
    const drifted = buildReviewRenderState(b.runId, b.dir)
    expect(drifted.featureTrial!.actualFiles).toContain('src/ai_provider.py')
    expect(drifted.featureTrial!.unexpectedFiles).toEqual(['src/ai_provider.py'])
    expect(drifted.featureTrial!.drift).toBe('drift')
  })

  it('missing FEATURE_TRIAL.json preserves prior review behavior', () => {
    const { dir, runId } = writeRun({}) // no trial written
    const state = buildReviewRenderState(runId, dir)
    expect(state.featureTrial).toBeUndefined()
    expect(state.featureTrialWarning).toBeUndefined()
    expect(state.overallStatus).toBe('PASS')
    expect(state.nextAction).toContain('approve')
  })

  it('malformed FEATURE_TRIAL.json fails safe (warning, no panel, no throw)', () => {
    const badJson = writeRun({ trialJson: '{ not valid json' })
    const stateBad = buildReviewRenderState(badJson.runId, badJson.dir)
    expect(stateBad.featureTrial).toBeUndefined()
    expect(stateBad.featureTrialWarning).toMatch(/not valid JSON/i)

    const wrongShape = writeRun({ trial: { candidateId: 'x' } }) // valid JSON, wrong schema
    const stateShape = buildReviewRenderState(wrongShape.runId, wrongShape.dir)
    expect(stateShape.featureTrial).toBeUndefined()
    expect(stateShape.featureTrialWarning).toMatch(/schema/i)
  })

  it('classification and eligibility are identical with and without featureTrial', () => {
    const withTrial = (() => {
      const { dir, runId } = writeRun({ trial: VALID_TRIAL })
      return buildReviewRenderState(runId, dir)
    })()
    const without = (() => {
      const { dir, runId } = writeRun({})
      return buildReviewRenderState(runId, dir)
    })()
    expect(withTrial.overallStatus).toBe(without.overallStatus)
    expect(withTrial.nextAction).toBe(without.nextAction)
    expect(withTrial.diff.files).toBe(without.diff.files)
    // The only difference is the presence of the informational panel.
    expect(withTrial.featureTrial).toBeDefined()
    expect(without.featureTrial).toBeUndefined()
  })
})

// ── TUI rendering ───────────────────────────────────────────────────────────

describe('review TUI — Feature Trial panel', () => {
  let logs: string[]
  let restoreColumns: PropertyDescriptor | undefined

  beforeEach(() => {
    logs = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logs.push(args.join(' ')) })
    restoreColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns')
    Object.defineProperty(process.stdout, 'columns', { value: 100, configurable: true })
    process.env['NO_COLOR'] = '1' // plain text for substring assertions
  })
  afterEach(() => {
    vi.restoreAllMocks()
    if (restoreColumns) Object.defineProperty(process.stdout, 'columns', restoreColumns)
    delete process.env['NO_COLOR']
  })

  function render(a: Artifacts): string {
    const { dir, runId } = writeRun(a)
    printReviewTui(buildReviewRenderState(runId, dir))
    return logs.join('\n')
  }

  it('renders the candidate id and title', () => {
    const out = render({ trial: VALID_TRIAL })
    expect(out).toContain('Feature Trial')
    expect(out).toContain('scout-001')
    expect(out).toContain('Add test for ai_provider dispatch')
  })

  it('renders the expected files', () => {
    expect(render({ trial: VALID_TRIAL })).toContain('tests/test_ai_provider.py')
  })

  it('renders the non-goals', () => {
    expect(render({ trial: VALID_TRIAL })).toContain('Do not change product modules')
  })

  it('renders verification coverage strength and reason', () => {
    const out = render({ trial: VALID_TRIAL })
    expect(out).toContain('strong')
    expect(out).toContain('scripts-syntax')
  })

  it('renders the scope ceiling', () => {
    const out = render({ trial: VALID_TRIAL })
    expect(out).toMatch(/Ceiling:.*tests\/\*\*/)
  })

  it('renders touched files and a faithful verdict in scope', () => {
    const out = render({ trial: VALID_TRIAL })
    expect(out).toMatch(/Touched:.*tests\/test_ai_provider\.py/)
    expect(out).toContain('faithful to candidate')
  })

  it('renders DRIFT and the unexpected file when the patch leaves scope', () => {
    const out = render({ trial: VALID_TRIAL, patchDiff: PATCH_DRIFT })
    expect(out).toContain('DRIFT')
    expect(out).toContain('src/ai_provider.py')
  })

  it('renders a warning (and no panel) for malformed FEATURE_TRIAL.json', () => {
    const out = render({ trialJson: 'totally not json' })
    expect(out).toContain('Feature Trial')
    expect(out).toMatch(/not valid JSON/i)
    expect(out).not.toContain('Candidate:')
  })

  it('omits the Feature Trial section entirely when no trial exists', () => {
    const out = render({})
    expect(out).not.toContain('Feature Trial')
  })
})
