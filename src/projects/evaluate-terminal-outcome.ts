/**
 * Canonical terminal-run evaluation. Single source of truth for:
 *   - SESSION_SUMMARY.json (passed)
 *   - RUN_CLASSIFICATION.json (terminationReason, patchEligibleForApplication)
 *   - powerplant review (headline verdict)
 *
 * Key invariant: intermediate check failures do NOT poison a run that subsequently
 * passed all required checks after the last write and finalized.
 */

import type { CheckResult } from '../contracts/verification-preflight-report.js'
import type { RunTerminationReason, RunClassification, RunCheckDiagnostics } from '../contracts/project-tool-contracts.js'
import { SPRINT4A_FINAL_RESPONSE } from '../config/constants.js'

export interface TerminalRunOutcome {
  terminationReason: RunTerminationReason
  finalVerificationPassed: boolean
  patchEligibleForApplication: boolean
  orderedCheckAttemptHistory: CheckResult[]
  finalCheckResult: CheckResult | null
  readCount: number
  writeCount: number
  checkCount: number
  finalizeAttempted: boolean
  artifactsComplete: boolean
  repeatedCheckFailures: boolean
  failureReason: string | null
  lastFailedDiagnostic: RunCheckDiagnostics | null
}

export function evaluateTerminalRunOutcome(opts: {
  checkResults: CheckResult[]
  checksValidAfterLastWrite: boolean
  testCheckPassed: boolean
  finalizeReceived: boolean
  finalizeAttempted: boolean
  budgetExhausted: boolean
  builtInToolUseCount: number
  sourceUnmodified: boolean
  finalResponse: string
  checkFailStreaks: Record<string, number>
  patchPackagePresent: boolean
  readCount: number
  writeCount: number
  checkCount: number
  lastFailedDiagnostic: RunCheckDiagnostics | null
}): TerminalRunOutcome {
  const {
    checkResults, checksValidAfterLastWrite, testCheckPassed, finalizeReceived,
    finalizeAttempted, budgetExhausted, builtInToolUseCount, sourceUnmodified,
    finalResponse, checkFailStreaks, patchPackagePresent, readCount, writeCount,
    checkCount, lastFailedDiagnostic,
  } = opts

  let terminationReason: RunTerminationReason
  if (budgetExhausted) {
    terminationReason = 'FAILED_TOOL_BUDGET_EXHAUSTED'
  } else if (!finalizeReceived) {
    terminationReason = 'FAILED_INCOMPLETE_AGENT_RUN'
  } else {
    terminationReason = 'COMPLETED'
  }

  const finalCheckResult = checkResults.length > 0 ? checkResults[checkResults.length - 1]! : null

  // Completion signal: primary truth is structured finalize evidence (project_finalize was
  // accepted and artifacts exist). The magic string is a fallback for run formats that lack
  // structured finalize tracking. When finalizeReceived && patchPackagePresent are both true
  // (already required by the gates below), this OR always resolves to true — preventing a
  // false FAIL when the agent omits the marker text after a legitimate finalize call.
  const completionSignalOk =
    (finalizeReceived && patchPackagePresent) ||
    finalResponse.trim().includes(SPRINT4A_FINAL_RESPONSE)

  // Final verification — ALL gates must be true.
  // Intermediate check failures remain in history without poisoning this result.
  // Each gate is listed explicitly so the invariant is machine-checkable.
  const finalVerificationPassed =
    terminationReason === 'COMPLETED' &&          // no budget exhaustion or incomplete run
    finalizeReceived &&                            // project_finalize was accepted (explicit, not inferred)
    patchPackagePresent &&                         // artifacts are complete
    checksValidAfterLastWrite &&                   // required checks passed after the most recent write
    testCheckPassed &&                             // final required check returned PASS
    finalCheckResult?.verdict !== 'FAIL_VERIFICATION_INTEGRITY' && // no zero-test false positive
    sourceUnmodified &&                            // source project not modified
    builtInToolUseCount === 0 &&                  // no built-in tool misuse
    completionSignalOk                             // finalize evidence (primary) or magic string (fallback)

  // patchEligibleForApplication is derived exclusively from finalVerificationPassed.
  // It is never true unless every gate above is satisfied.
  const patchEligibleForApplication = finalVerificationPassed
  const repeatedCheckFailures = Object.values(checkFailStreaks).some(n => n >= 3)

  let failureReason: string | null = null
  if (!finalVerificationPassed) {
    if (terminationReason !== 'COMPLETED') {
      failureReason = terminationReason
    } else if (!testCheckPassed || finalCheckResult?.verdict === 'FAIL_VERIFICATION_INTEGRITY') {
      failureReason = 'final check did not pass or verification integrity failure'
    } else if (!checksValidAfterLastWrite) {
      failureReason = 'checks invalidated by write after last check'
    } else if (!sourceUnmodified) {
      failureReason = 'source project was modified'
    } else if (builtInToolUseCount > 0) {
      failureReason = 'built-in tools were used'
    } else if (!patchPackagePresent) {
      failureReason = 'patch package was not generated'
    }
    // completionSignalOk is always true when finalizeReceived && patchPackagePresent are true
    // (both already gated above), so no else branch is reachable here.
  }

  return {
    terminationReason, finalVerificationPassed, patchEligibleForApplication,
    orderedCheckAttemptHistory: checkResults, finalCheckResult,
    readCount, writeCount, checkCount, finalizeAttempted,
    artifactsComplete: patchPackagePresent, repeatedCheckFailures, failureReason,
    lastFailedDiagnostic: finalVerificationPassed ? null : lastFailedDiagnostic,
  }
}

export function toRunClassification(outcome: TerminalRunOutcome): RunClassification {
  const result: RunClassification = {
    terminationReason: outcome.terminationReason,
    patchEligibleForApplication: outcome.patchEligibleForApplication,
    readCount: outcome.readCount, writeCount: outcome.writeCount, checkCount: outcome.checkCount,
    finalizeAttempted: outcome.finalizeAttempted, artifactsComplete: outcome.artifactsComplete,
    repeatedCheckFailures: outcome.repeatedCheckFailures,
  }
  if (outcome.lastFailedDiagnostic !== null) result.lastFailedDiagnostic = outcome.lastFailedDiagnostic
  return result
}
