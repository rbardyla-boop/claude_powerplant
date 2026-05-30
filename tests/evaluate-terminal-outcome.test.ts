import { describe, it, expect } from 'vitest'
import { evaluateTerminalRunOutcome } from '../src/projects/evaluate-terminal-outcome.js'
import type { CheckResult } from '../src/contracts/verification-preflight-report.js'
import { SPRINT4A_FINAL_RESPONSE } from '../src/config/constants.js'

const PASS_CHECK: CheckResult = {
  checkId: 'static-syntax-sw',
  command: 'node --check sw.js',
  verdict: 'PASS',
  exitCode: 0,
  stdoutTail: '',
  stderrTail: '',
  advisory: true,
}

const BASE = {
  checkResults: [PASS_CHECK],
  checksValidAfterLastWrite: true,
  testCheckPassed: true,
  finalizeReceived: true,
  finalizeAttempted: true,
  budgetExhausted: false,
  builtInToolUseCount: 0,
  sourceUnmodified: true,
  finalResponse: SPRINT4A_FINAL_RESPONSE,
  checkFailStreaks: {},
  patchPackagePresent: true,
  readCount: 8,
  writeCount: 2,
  checkCount: 1,
  lastFailedDiagnostic: null,
}

// ── Regression: review/run classification mismatch ────────────────────────────

describe('evaluate-terminal-outcome: completion signal', () => {
  it('case 1 — finalize received + artifacts present + non-magic final text => PASS', () => {
    const outcome = evaluateTerminalRunOutcome({
      ...BASE,
      finalResponse: 'The audit is complete. Findings written to tests/POWERPLANT_AUDIT.md.',
    })
    expect(outcome.finalVerificationPassed).toBe(true)
    expect(outcome.patchEligibleForApplication).toBe(true)
    expect(outcome.terminationReason).toBe('COMPLETED')
    expect(outcome.failureReason).toBe(null)
  })

  it('case 2 — finalize received + artifacts missing + non-magic final text => FAIL', () => {
    const outcome = evaluateTerminalRunOutcome({
      ...BASE,
      patchPackagePresent: false,
      finalResponse: 'The audit is complete.',
    })
    expect(outcome.finalVerificationPassed).toBe(false)
    expect(outcome.patchEligibleForApplication).toBe(false)
    expect(outcome.failureReason).toBe('patch package was not generated')
  })

  it('case 3 — no finalize + magic string absent => FAIL', () => {
    const outcome = evaluateTerminalRunOutcome({
      ...BASE,
      finalizeReceived: false,
      finalResponse: 'Work in progress.',
    })
    expect(outcome.finalVerificationPassed).toBe(false)
    expect(outcome.patchEligibleForApplication).toBe(false)
    expect(outcome.terminationReason).toBe('FAILED_INCOMPLETE_AGENT_RUN')
  })

  it('case 4 — no finalize + magic string present => still FAIL (magic string cannot override missing finalize)', () => {
    const outcome = evaluateTerminalRunOutcome({
      ...BASE,
      finalizeReceived: false,
      finalResponse: SPRINT4A_FINAL_RESPONSE,
    })
    expect(outcome.finalVerificationPassed).toBe(false)
    expect(outcome.patchEligibleForApplication).toBe(false)
    expect(outcome.terminationReason).toBe('FAILED_INCOMPLETE_AGENT_RUN')
  })

  it('case 5 — finalize received + artifacts present + magic string present => PASS (no regression)', () => {
    const outcome = evaluateTerminalRunOutcome({
      ...BASE,
      finalResponse: SPRINT4A_FINAL_RESPONSE,
    })
    expect(outcome.finalVerificationPassed).toBe(true)
    expect(outcome.patchEligibleForApplication).toBe(true)
    expect(outcome.terminationReason).toBe('COMPLETED')
    expect(outcome.failureReason).toBe(null)
  })
})
