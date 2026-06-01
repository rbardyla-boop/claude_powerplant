/**
 * Tests for advisory non-goal adherence checking.
 *
 * detectNonGoalViolations is a heuristic, read-only signal: it flags undeclared
 * touched files that appear to violate a declared non-goal (path/text match
 * only). It must never gate approval and must not flag declared files or
 * purely behavioral non-goals. The review integration surfaces it without
 * changing classification.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { detectNonGoalViolations, FEATURE_TRIAL_CLAIM } from '../src/scout/feature-trial.js'
import { buildReviewRenderState } from '../src/cli/commands/review.js'
import { printReviewTui } from '../src/cli/terminal-output.js'

// ── detector unit tests ─────────────────────────────────────────────────────

describe('detectNonGoalViolations — heuristic path/text matching', () => {
  it('flags an undeclared config file against a "config" non-goal', () => {
    const v = detectNonGoalViolations(['Do not touch config files'], ['src/config.ts'], [])
    expect(v).toHaveLength(1)
    expect(v[0]!.files).toEqual(['src/config.ts'])
    expect(v[0]!.matched).toBe('config')
  })

  it('flags a file named literally as a path token in the non-goal', () => {
    const v = detectNonGoalViolations(['Do not modify package.json'], ['package.json', 'src/x.ts'], [])
    expect(v).toHaveLength(1)
    expect(v[0]!.files).toEqual(['package.json'])
    expect(v[0]!.matched).toBe('package.json')
  })

  it('flags via a glob token in the non-goal text', () => {
    const v = detectNonGoalViolations(['Avoid editing *.lock files'], ['cargo.lock'], [])
    // matches either the glob token (*.lock) or the lockfile keyword
    expect(v).toHaveLength(1)
    expect(v[0]!.files).toEqual(['cargo.lock'])
  })

  it('does NOT flag a declared (expected) file', () => {
    const v = detectNonGoalViolations(['Do not touch config'], ['src/config.ts'], ['src/config.ts'])
    expect(v).toEqual([])
  })

  it('does NOT flag a purely behavioral non-goal with no path signal', () => {
    const v = detectNonGoalViolations(
      ['Do not change runtime behavior', 'Do not break the build'],
      ['src/config.ts', 'tsconfig.json'],
      [],
    )
    expect(v).toEqual([])
  })

  it('is case-insensitive and reports only matching non-goals', () => {
    const v = detectNonGoalViolations(
      ['Do NOT touch CONFIG', 'Keep tests green'],
      ['SRC/Config.TS'],
      [],
    )
    expect(v).toHaveLength(1)
    expect(v[0]!.nonGoal).toBe('Do NOT touch CONFIG')
  })

  it('returns [] for empty non-goals or no undeclared files', () => {
    expect(detectNonGoalViolations([], ['src/config.ts'], [])).toEqual([])
    expect(detectNonGoalViolations(['Do not touch config'], [], [])).toEqual([])
    expect(detectNonGoalViolations(['Do not touch config'], ['tests/a.py'], [])).toEqual([])
  })

  it('flags docs and dependency surfaces from their keywords', () => {
    expect(detectNonGoalViolations(['Do not edit documentation'], ['docs/GUIDE.md'], [])).toHaveLength(1)
    expect(detectNonGoalViolations(['Do not change dependencies'], ['package.json'], [])).toHaveLength(1)
  })
})

// ── review integration ──────────────────────────────────────────────────────

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
  candidateId: 'scout-009',
  candidateTitle: 'Add dedup test',
  source: 'scout',
  expectedFiles: ['tests/test_dedup.py'],
  nonGoals: ['Do not touch config files', 'Do not change runtime behavior'],
  verificationCoverage: { strength: 'strong', reason: 'covers tests/test_dedup.py' },
  scopeCeiling: ['tests/**'],
  createdAt: '2026-06-01T00:00:00.000Z',
  claim: FEATURE_TRIAL_CLAIM,
}
// Patch touches the declared test (fine) AND an undeclared config file (violation).
const PATCH_VIOLATION = `--- /dev/null
+++ b/tests/test_dedup.py
@@ -0,0 +1,1 @@
+def test_dedup(): pass
--- a/src/config.ts
+++ b/src/config.ts
@@ -1 +1 @@
-a = 1
+a = 2
`

function writeRun(patchDiff: string): { dir: string; runId: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-nongoal-'))
  const dir = path.join(base, 'proj', 'pp-run-ng-1')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'TASK.md'), 'add test')
  fs.writeFileSync(path.join(dir, 'VERIFICATION_REPORT.md'), PASS_VERIFICATION)
  fs.writeFileSync(path.join(dir, 'RUN_CLASSIFICATION.json'), JSON.stringify(PASS_CLASSIFICATION))
  fs.writeFileSync(path.join(dir, 'PATCH.diff'), patchDiff)
  fs.writeFileSync(path.join(dir, 'FEATURE_TRIAL.json'), JSON.stringify(TRIAL, null, 2))
  return { dir, runId: 'pp-run-ng-1' }
}

describe('review integration — non-goal violations', () => {
  it('surfaces nonGoalViolations in the featureTrial state', () => {
    const { dir, runId } = writeRun(PATCH_VIOLATION)
    const state = buildReviewRenderState(runId, dir)
    expect(state.featureTrial!.nonGoalViolations).toHaveLength(1)
    expect(state.featureTrial!.nonGoalViolations[0]!.files).toEqual(['src/config.ts'])
    expect(state.featureTrial!.nonGoalViolations[0]!.nonGoal).toBe('Do not touch config files')
  })

  it('does not change classification or eligibility when violations exist', () => {
    const { dir, runId } = writeRun(PATCH_VIOLATION)
    const state = buildReviewRenderState(runId, dir)
    // A non-goal violation is advisory: the run still classifies on its checks.
    expect(state.overallStatus).toBe('PASS')
    expect(state.nextAction).toContain('approve')
  })

  it('renders an advisory possible-violation line in the TUI', () => {
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.join(' ')) })
    const restore = Object.getOwnPropertyDescriptor(process.stdout, 'columns')
    Object.defineProperty(process.stdout, 'columns', { value: 100, configurable: true })
    process.env['NO_COLOR'] = '1'
    try {
      const { dir, runId } = writeRun(PATCH_VIOLATION)
      printReviewTui(buildReviewRenderState(runId, dir))
      const out = logs.join('\n')
      expect(out).toMatch(/possible violation/i)
      expect(out).toMatch(/advisory/i)
      expect(out).toContain('Do not touch config files')
      expect(out).toContain('src/config.ts')
    } finally {
      spy.mockRestore()
      if (restore) Object.defineProperty(process.stdout, 'columns', restore)
      delete process.env['NO_COLOR']
    }
  })
})
