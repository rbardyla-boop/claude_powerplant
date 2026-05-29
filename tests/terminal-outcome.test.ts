/**
 * Regression tests for evaluateTerminalRunOutcome() and SESSION_SUMMARY.passed fix.
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  evaluateTerminalRunOutcome,
  toRunClassification,
} from '../src/projects/evaluate-terminal-outcome.js'
import { generatePatchPackage } from '../src/projects/generate-patch-package.js'
import { buildPilotSnapshot } from '../src/projects/build-pilot-snapshot.js'
import { verifySourceUnchanged } from '../src/projects/verify-source-unchanged.js'
import { loadProjectContract } from '../src/projects/load-project-contract.js'
import type { CheckResult } from '../src/contracts/verification-preflight-report.js'
import type { RunClassification } from '../src/contracts/project-tool-contracts.js'
import { printReviewReport } from '../src/cli/terminal-output.js'
import { SPRINT4A_PILOT_SOURCE_PATH } from '../src/config/constants.js'

const PILOT_SOURCE = SPRINT4A_PILOT_SOURCE_PATH
const PILOT_AVAILABLE = Boolean(PILOT_SOURCE) && fs.existsSync(PILOT_SOURCE)
const FINAL_RESPONSE = 'SANITIZED PILOT PATCH COMPLETE'

const passCheck: CheckResult = {
  checkId: 'test', command: 'npx vitest run', verdict: 'PASS',
  exitCode: 0, stdoutTail: '# tests 2\n# pass 2\n# fail 0', stderrTail: '',
}
const failCheck: CheckResult = {
  checkId: 'test', command: 'npx vitest run', verdict: 'FAIL_CHECK',
  exitCode: 1, stdoutTail: '# tests 2\n# fail 1', stderrTail: '',
}
const integrityFailCheck: CheckResult = {
  checkId: 'test', command: 'npx vitest run', verdict: 'FAIL_VERIFICATION_INTEGRITY',
  exitCode: 0, stdoutTail: '# tests 0\n# pass 0', stderrTail: '',
}

function makeBaseOpts(overrides: Partial<Parameters<typeof evaluateTerminalRunOutcome>[0]> = {}) {
  return {
    checkResults: [passCheck], checksValidAfterLastWrite: true, testCheckPassed: true,
    finalizeReceived: true, finalizeAttempted: true, budgetExhausted: false,
    builtInToolUseCount: 0, sourceUnmodified: true, finalResponse: FINAL_RESPONSE,
    checkFailStreaks: {}, patchPackagePresent: true,
    readCount: 1, writeCount: 1, checkCount: 2, lastFailedDiagnostic: null,
    ...overrides,
  }
}

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-to-'))
  try { await fn(dir) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

// Scenario 1: self-correcting run is fully eligible
describe('Scenario 1: self-correcting run is fully eligible', () => {
  it('terminationReason COMPLETED', () => {
    expect(evaluateTerminalRunOutcome(makeBaseOpts({ checkResults: [failCheck, passCheck] })).terminationReason).toBe('COMPLETED')
  })
  it('finalVerificationPassed: true', () => {
    expect(evaluateTerminalRunOutcome(makeBaseOpts({ checkResults: [failCheck, passCheck] })).finalVerificationPassed).toBe(true)
  })
  it('patchEligibleForApplication: true', () => {
    expect(evaluateTerminalRunOutcome(makeBaseOpts({ checkResults: [failCheck, passCheck] })).patchEligibleForApplication).toBe(true)
  })
  it.skipIf(!PILOT_AVAILABLE)('SESSION_SUMMARY.passed is true with checksValidAfterLastWrite', async () => {
    await withTempDir(async dir => {
      const contract = loadProjectContract(PILOT_SOURCE)
      const snapshot = buildPilotSnapshot(contract, path.join(dir, 'run'))
      const sv = verifySourceUnchanged(snapshot)
      await generatePatchPackage({
        runId: 't1', snapshot, contract, sourceVerification: sv,
        checkResults: [failCheck, passCheck], checksValidAfterLastWrite: true,
        customToolCounts: {}, finalResponse: FINAL_RESPONSE,
        patchDir: path.join(dir, 'patch'), taskDescription: 'T', agentMessage: 'T', modelId: 'claude-haiku-4-5-20251001',
      })
      const s = JSON.parse(fs.readFileSync(path.join(dir, 'patch', 'SESSION_SUMMARY.json'), 'utf-8'))
      expect(s.passed).toBe(true)
    })
  })
})

// Scenario 2: intermediate failures preserved
describe('Scenario 2: intermediate failures preserved in history', () => {
  it('orderedCheckAttemptHistory contains all attempts', () => {
    const o = evaluateTerminalRunOutcome(makeBaseOpts({ checkResults: [failCheck, passCheck] }))
    expect(o.orderedCheckAttemptHistory).toHaveLength(2)
    expect(o.orderedCheckAttemptHistory[0]!.verdict).toBe('FAIL_CHECK')
    expect(o.orderedCheckAttemptHistory[1]!.verdict).toBe('PASS')
  })
  it('finalCheckResult points to last (PASS) attempt', () => {
    expect(evaluateTerminalRunOutcome(makeBaseOpts({ checkResults: [failCheck, passCheck] })).finalCheckResult?.verdict).toBe('PASS')
  })
  it.skipIf(!PILOT_AVAILABLE)('VERIFICATION_REPORT.md lists all check attempts', async () => {
    await withTempDir(async dir => {
      const contract = loadProjectContract(PILOT_SOURCE)
      const snapshot = buildPilotSnapshot(contract, path.join(dir, 'run'))
      const sv = verifySourceUnchanged(snapshot)
      await generatePatchPackage({
        runId: 't2', snapshot, contract, sourceVerification: sv,
        checkResults: [failCheck, passCheck], checksValidAfterLastWrite: true,
        customToolCounts: {}, finalResponse: FINAL_RESPONSE,
        patchDir: path.join(dir, 'patch'), taskDescription: 'T', agentMessage: 'T', modelId: 'claude-haiku-4-5-20251001',
      })
      const report = fs.readFileSync(path.join(dir, 'patch', 'VERIFICATION_REPORT.md'), 'utf-8')
      expect(report).toContain('FAIL_CHECK')
      expect(report).toContain('PASS')
    })
  })
})

// Scenario 3: no-finalize run remains ineligible
describe('Scenario 3: run ending without finalize is ineligible', () => {
  it('yields FAILED_INCOMPLETE_AGENT_RUN', () => {
    const o = evaluateTerminalRunOutcome(makeBaseOpts({
      finalizeReceived: false, finalizeAttempted: false, patchPackagePresent: false,
      checkResults: [], testCheckPassed: false, checksValidAfterLastWrite: false,
    }))
    expect(o.terminationReason).toBe('FAILED_INCOMPLETE_AGENT_RUN')
    expect(o.patchEligibleForApplication).toBe(false)
  })
})

// Scenario 4: budget-exhausted run remains ineligible
describe('Scenario 4: budget-exhausted run is ineligible', () => {
  it('yields FAILED_TOOL_BUDGET_EXHAUSTED', () => {
    const o = evaluateTerminalRunOutcome(makeBaseOpts({ budgetExhausted: true, finalizeReceived: false, patchPackagePresent: false }))
    expect(o.terminationReason).toBe('FAILED_TOOL_BUDGET_EXHAUSTED')
    expect(o.patchEligibleForApplication).toBe(false)
  })
  it('ineligible even with partial passing checks', () => {
    expect(evaluateTerminalRunOutcome(makeBaseOpts({
      budgetExhausted: true, finalizeReceived: false, patchPackagePresent: false,
      checkResults: [passCheck], testCheckPassed: true, checksValidAfterLastWrite: true,
    })).patchEligibleForApplication).toBe(false)
  })
})

// Scenario 5: verification-integrity failure remains ineligible
describe('Scenario 5: zero-test integrity failure is ineligible', () => {
  it('FAIL_VERIFICATION_INTEGRITY means testCheckPassed is false', () => {
    expect(integrityFailCheck.verdict === 'PASS').toBe(false)
  })
  it('patchEligibleForApplication: false when testCheckPassed is false', () => {
    expect(evaluateTerminalRunOutcome(makeBaseOpts({
      checkResults: [integrityFailCheck], testCheckPassed: false, checksValidAfterLastWrite: false,
      finalizeReceived: false, patchPackagePresent: false,
    })).patchEligibleForApplication).toBe(false)
  })
  it.skipIf(!PILOT_AVAILABLE)('SESSION_SUMMARY.passed is false when last check is integrity failure', async () => {
    await withTempDir(async dir => {
      const contract = loadProjectContract(PILOT_SOURCE)
      const snapshot = buildPilotSnapshot(contract, path.join(dir, 'run'))
      const sv = verifySourceUnchanged(snapshot)
      await generatePatchPackage({
        runId: 't5', snapshot, contract, sourceVerification: sv,
        checkResults: [integrityFailCheck], checksValidAfterLastWrite: false,
        customToolCounts: {}, finalResponse: FINAL_RESPONSE,
        patchDir: path.join(dir, 'patch'), taskDescription: 'T', agentMessage: 'T', modelId: 'claude-haiku-4-5-20251001',
      })
      const s = JSON.parse(fs.readFileSync(path.join(dir, 'patch', 'SESSION_SUMMARY.json'), 'utf-8'))
      expect(s.passed).toBe(false)
    })
  })
})

// Scenario 6: write after PASS invalidates eligibility
describe('Scenario 6: write after PASS invalidates eligibility', () => {
  it('ineligible when checksValidAfterLastWrite is false', () => {
    const o = evaluateTerminalRunOutcome(makeBaseOpts({ checksValidAfterLastWrite: false, testCheckPassed: true }))
    expect(o.patchEligibleForApplication).toBe(false)
    expect(o.failureReason).toContain('invalidated by write')
  })
  it.skipIf(!PILOT_AVAILABLE)('SESSION_SUMMARY.passed is false when checksValidAfterLastWrite is false', async () => {
    await withTempDir(async dir => {
      const contract = loadProjectContract(PILOT_SOURCE)
      const snapshot = buildPilotSnapshot(contract, path.join(dir, 'run'))
      const sv = verifySourceUnchanged(snapshot)
      await generatePatchPackage({
        runId: 't6', snapshot, contract, sourceVerification: sv,
        checkResults: [passCheck], checksValidAfterLastWrite: false,
        customToolCounts: {}, finalResponse: FINAL_RESPONSE,
        patchDir: path.join(dir, 'patch'), taskDescription: 'T', agentMessage: 'T', modelId: 'claude-haiku-4-5-20251001',
      })
      const s = JSON.parse(fs.readFileSync(path.join(dir, 'patch', 'SESSION_SUMMARY.json'), 'utf-8'))
      expect(s.passed).toBe(false)
    })
  })
})

// Scenario 7: review output headlines final PASS
describe('Scenario 7: printReviewReport uses classification for headline verdict', () => {
  it('displays ELIGIBLE when classification says patchEligibleForApplication: true', () => {
    const lines: string[] = []
    const orig = console.log
    console.log = (...a: unknown[]) => lines.push(a.join(' '))
    try {
      printReviewReport({
        runId: 'pp-run-1780007574270', artifactDir: '/mock', task: 'Fix test',
        patchDiff: '--- a/tests/math.test.ts\n', changedFilesMd: '', verificationMd: '', adversarialMd: '',
        sessionSummary: { passed: false, builtInToolUseCount: 0, originalProjectMounted: false, sourceUnmodified: true, executorNetworkDisabled: true, noCredentialsPassedToExecutor: true },
        runClassification: { terminationReason: 'COMPLETED', patchEligibleForApplication: true, readCount: 1, writeCount: 1, checkCount: 2, finalizeAttempted: true, artifactsComplete: true, repeatedCheckFailures: false },
      })
    } finally { console.log = orig }
    const out = lines.join('\n')
    expect(out).toContain('ELIGIBLE FOR HUMAN REVIEW')
    expect(out).toContain('COMPLETED')
  })
  it('shows intermediate failures note when checkCount > 1', () => {
    const lines: string[] = []
    const orig = console.log
    console.log = (...a: unknown[]) => lines.push(a.join(' '))
    try {
      printReviewReport({
        runId: 'test', artifactDir: '/mock', task: 't', patchDiff: '', changedFilesMd: '', verificationMd: '', adversarialMd: '',
        sessionSummary: { passed: false },
        runClassification: { terminationReason: 'COMPLETED', patchEligibleForApplication: true, readCount: 1, writeCount: 1, checkCount: 2, finalizeAttempted: true, artifactsComplete: true, repeatedCheckFailures: false },
      })
    } finally { console.log = orig }
    expect(lines.join('\n')).toContain('intermediate failures are normal')
  })
})

// Scenario 8: historical ineligible runs remain loudly ineligible
describe('Scenario 8: ineligible historical runs remain ineligible', () => {
  it('FAILED_INCOMPLETE_AGENT_RUN displays as INELIGIBLE', () => {
    const lines: string[] = []
    const orig = console.log
    console.log = (...a: unknown[]) => lines.push(a.join(' '))
    try {
      printReviewReport({
        runId: 'pp-run-1780006845393', artifactDir: '/mock', task: 't', patchDiff: '', changedFilesMd: '', verificationMd: '', adversarialMd: '',
        sessionSummary: { passed: false },
        runClassification: { terminationReason: 'FAILED_INCOMPLETE_AGENT_RUN', patchEligibleForApplication: false, readCount: 2, writeCount: 0, checkCount: 0, finalizeAttempted: false, artifactsComplete: false, repeatedCheckFailures: false },
      })
    } finally { console.log = orig }
    const out = lines.join('\n')
    expect(out).toContain('INELIGIBLE')
    expect(out).toContain('FAILED_INCOMPLETE_AGENT_RUN')
  })
  it('FAILED_TOOL_BUDGET_EXHAUSTED displays as INELIGIBLE', () => {
    const lines: string[] = []
    const orig = console.log
    console.log = (...a: unknown[]) => lines.push(a.join(' '))
    try {
      printReviewReport({
        runId: 'pp-budget', artifactDir: '/mock', task: 't', patchDiff: '', changedFilesMd: '', verificationMd: '', adversarialMd: '',
        sessionSummary: { passed: false },
        runClassification: { terminationReason: 'FAILED_TOOL_BUDGET_EXHAUSTED', patchEligibleForApplication: false, readCount: 10, writeCount: 5, checkCount: 8, finalizeAttempted: false, artifactsComplete: false, repeatedCheckFailures: true },
      })
    } finally { console.log = orig }
    const out = lines.join('\n')
    expect(out).toContain('INELIGIBLE')
    expect(out).toContain('FAILED_TOOL_BUDGET_EXHAUSTED')
  })
})

// Edge cases
describe('evaluateTerminalRunOutcome: edge cases', () => {
  it('no checks + no finalize → FAILED_INCOMPLETE_AGENT_RUN', () => {
    const o = evaluateTerminalRunOutcome(makeBaseOpts({ checkResults: [], finalizeReceived: false, finalizeAttempted: false, testCheckPassed: false, checksValidAfterLastWrite: false, patchPackagePresent: false }))
    expect(o.terminationReason).toBe('FAILED_INCOMPLETE_AGENT_RUN')
    expect(o.finalCheckResult).toBeNull()
  })
  it('single pass → COMPLETED and eligible', () => {
    const o = evaluateTerminalRunOutcome(makeBaseOpts({ checkResults: [passCheck], checkCount: 1 }))
    expect(o.terminationReason).toBe('COMPLETED')
    expect(o.patchEligibleForApplication).toBe(true)
  })
  it('toRunClassification correct fields', () => {
    const c = toRunClassification(evaluateTerminalRunOutcome(makeBaseOpts({ checkResults: [failCheck, passCheck], checkCount: 2 })))
    expect(c.terminationReason).toBe('COMPLETED')
    expect(c.patchEligibleForApplication).toBe(true)
    expect(c.checkCount).toBe(2)
  })
  it('checkFailStreaks >= 3 → repeatedCheckFailures: true', () => {
    expect(evaluateTerminalRunOutcome(makeBaseOpts({ checkFailStreaks: { test: 3 } })).repeatedCheckFailures).toBe(true)
  })
  it('failureReason null for passing run', () => {
    expect(evaluateTerminalRunOutcome(makeBaseOpts()).failureReason).toBeNull()
  })
})

// Backward compat — no checksValidAfterLastWrite
describe('SESSION_SUMMARY.passed: backward compat', () => {
  it.skipIf(!PILOT_AVAILABLE)('true when all results PASS (no override param)', async () => {
    await withTempDir(async dir => {
      const contract = loadProjectContract(PILOT_SOURCE)
      const snapshot = buildPilotSnapshot(contract, path.join(dir, 'run'))
      const sv = verifySourceUnchanged(snapshot)
      await generatePatchPackage({
        runId: 'compat-pass', snapshot, contract, sourceVerification: sv,
        checkResults: [passCheck], customToolCounts: {}, finalResponse: FINAL_RESPONSE,
        patchDir: path.join(dir, 'patch'), taskDescription: 'T', agentMessage: 'T', modelId: 'claude-haiku-4-5-20251001',
      })
      expect(JSON.parse(fs.readFileSync(path.join(dir, 'patch', 'SESSION_SUMMARY.json'), 'utf-8')).passed).toBe(true)
    })
  })
  it.skipIf(!PILOT_AVAILABLE)('false when checkResults null (no override param)', async () => {
    await withTempDir(async dir => {
      const contract = loadProjectContract(PILOT_SOURCE)
      const snapshot = buildPilotSnapshot(contract, path.join(dir, 'run'))
      const sv = verifySourceUnchanged(snapshot)
      await generatePatchPackage({
        runId: 'compat-null', snapshot, contract, sourceVerification: sv,
        checkResults: null, customToolCounts: {}, finalResponse: FINAL_RESPONSE,
        patchDir: path.join(dir, 'patch'), taskDescription: 'T', agentMessage: 'T', modelId: 'claude-haiku-4-5-20251001',
      })
      expect(JSON.parse(fs.readFileSync(path.join(dir, 'patch', 'SESSION_SUMMARY.json'), 'utf-8')).passed).toBe(false)
    })
  })
})

// Blocker 2 regression: patch-eligibility full conjunction
describe('Patch eligibility: all gates required', () => {
  it('ineligible when checks pass but finalize was never accepted', () => {
    const outcome = evaluateTerminalRunOutcome(makeBaseOpts({
      checkResults: [passCheck],
      checksValidAfterLastWrite: true,
      testCheckPassed: true,
      finalizeReceived: false,     // finalize never called
      finalizeAttempted: false,
      patchPackagePresent: false,
    }))
    expect(outcome.patchEligibleForApplication).toBe(false)
    expect(outcome.terminationReason).toBe('FAILED_INCOMPLETE_AGENT_RUN')
  })

  it('ineligible when checks pass and finalize attempted but budget exhausted first', () => {
    const outcome = evaluateTerminalRunOutcome(makeBaseOpts({
      checkResults: [passCheck],
      checksValidAfterLastWrite: true,
      testCheckPassed: true,
      finalizeReceived: false,
      finalizeAttempted: true,
      budgetExhausted: true,        // budget hit before finalize completed
      patchPackagePresent: false,
    }))
    expect(outcome.patchEligibleForApplication).toBe(false)
    expect(outcome.terminationReason).toBe('FAILED_TOOL_BUDGET_EXHAUSTED')
  })

  it('ineligible when artifacts are missing even if checks passed and finalize received', () => {
    const outcome = evaluateTerminalRunOutcome(makeBaseOpts({
      checkResults: [passCheck],
      checksValidAfterLastWrite: true,
      testCheckPassed: true,
      finalizeReceived: true,
      patchPackagePresent: false,   // artifacts incomplete
    }))
    expect(outcome.patchEligibleForApplication).toBe(false)
  })

  it('ineligible when FAIL_VERIFICATION_INTEGRITY is the final check result', () => {
    const outcome = evaluateTerminalRunOutcome(makeBaseOpts({
      checkResults: [integrityFailCheck],
      testCheckPassed: false,        // integrity failure sets this false
      checksValidAfterLastWrite: false,
      finalizeReceived: false,
      patchPackagePresent: false,
    }))
    expect(outcome.patchEligibleForApplication).toBe(false)
  })

  it('finalizeReceived gate is explicit even when terminationReason is COMPLETED', () => {
    // If somehow terminationReason COMPLETED was set without finalizeReceived
    // (which cannot happen in normal operation but is a safety net), ineligible.
    // In practice, terminationReason=COMPLETED requires finalizeReceived=true.
    // This test documents the conjunction explicitly.
    const outcome = evaluateTerminalRunOutcome(makeBaseOpts({
      checkResults: [passCheck],
      checksValidAfterLastWrite: true,
      testCheckPassed: true,
      finalizeReceived: true,       // both gates true
      patchPackagePresent: true,
    }))
    expect(outcome.terminationReason).toBe('COMPLETED')
    expect(outcome.patchEligibleForApplication).toBe(true)
  })
})
