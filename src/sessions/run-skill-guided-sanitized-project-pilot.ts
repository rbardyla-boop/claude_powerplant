// Stage 2B — Skill-Guided Sanitized Project Pilot
//
// Entry point for skill-guided live sanitized-project broker sessions.
//
// What this module DOES import (explicitly bounded):
//   - Skill lifecycle machinery (skill-lifecycle, skill-envelope, skill-invocation-audit)
//   - Broker session runner (runProjectPilotBrokerSession) — the permitted insertion point
//   - Snapshot + contract builders (loadProjectContract, buildPilotSnapshot)
//   - Source verification (verifySourceUnchanged)
//   - Config constants
//
// What this module does NOT modify:
//   - project-tool-broker.ts enforcement semantics (write-invalidation, finalize gating,
//     check authorization, capsule isolation, budget guard)
//   - run-capsule-checks.ts or run-approved-checks.ts
//   - classify-check-result.ts
//   - load-project-contract.ts
//   - build-pilot-snapshot.ts
//
// Single terminal funnel requirement (Audit 2A):
//   Phase A persists before any broker call.
//   EVERY session-started terminal outcome routes through one Phase B write.
//   No eligible result is released until Phase B persistence succeeds.

import crypto from 'crypto'
import { randomUUID } from 'crypto'
import { listSkills, computeSkillContentHash } from '../skills/skill-lifecycle.js'
import { renderPromptEnvelope, SKILL_AUTHORITY_DISCLAIMER } from '../skills/skill-envelope.js'
import { getCandidatePath } from '../skills/skill-paths.js'
import {
  appendPhaseARecord,
  appendPhaseBRecord,
  type InvokedSkillEntry,
  type SkillInvocationPhaseARecord,
  type SkillInvocationPhaseBRecord,
  type LiveRunTerminationReason,
  type LiveRunFinalOutcome,
  type CapsuleIsolationIndicators,
} from '../skills/skill-invocation-audit.js'
import { runProjectPilotBrokerSession } from '../broker/project-tool-broker.js'
import { loadProjectContract } from '../projects/load-project-contract.js'
import { buildPilotSnapshot } from '../projects/build-pilot-snapshot.js'
import { verifySourceUnchanged } from '../projects/verify-source-unchanged.js'
import type { ProjectBrokerSessionResult } from '../broker/project-tool-broker.js'
import type { CheckResult } from '../contracts/verification-preflight-report.js'
import {
  SPRINT4A_TOOL_FINALIZE,
  SPRINT4A_TOOL_WRITE_FILE,
  SPRINT4A_MAX_TOOL_CALLS,
  SPRINT4A_FINAL_RESPONSE,
  SKILL_GUIDED_PILOT_RUNNER_TYPE,
  SKILL_INVOCATION_PHASE_A,
  SKILL_INVOCATION_PHASE_B,
} from '../config/constants.js'
import type Anthropic from '@anthropic-ai/sdk'
import type { Sprint4aState } from '../platform/sprint4a-state.js'
import fs from 'fs'
import path from 'path'
import { SPRINT4A_RUNTIME_BASE } from '../config/constants.js'

// ── Error class ───────────────────────────────────────────────────────────────

export class SkillGuidedInvocationError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_REQUEST'
      | 'SKILL_NOT_FOUND'
      | 'SKILL_DISABLED'
      | 'HASH_EXPECTATION_MISMATCH'
      | 'LIVE_HASH_MISMATCH'
      | 'DISCLAIMER_MISSING'
      | 'ENVELOPE_HASH_FAILED'
      | 'PHASE_A_AUDIT_FAILED',
    message: string
  ) {
    super(message)
    this.name = 'SkillGuidedInvocationError'
  }
}

// ── Public API types ──────────────────────────────────────────────────────────

export interface SkillGuidedInvocationRequest {
  skillId: string       // skill name from registry
  expectedHash: string  // hash the operator declares; must match registry and live hash
}

export interface SkillGuidedRunReport {
  invocationId: string
  runId: string
  timestamp: string
  syntheticScope: false
  runnerType: typeof SKILL_GUIDED_PILOT_RUNNER_TYPE
  sanitizedProjectId: string
  skillId: string
  envelopeHash: string
  auditRecordPath: string
  sessionId: string | null
  finalOutcome: LiveRunFinalOutcome
  terminationReason: LiveRunTerminationReason | null
  patchEligibleForApplication: boolean
  clearedForSanitizedExternalProjectInput: boolean
  sourceTreeUnmodified: boolean
  finalizeAttempted: boolean
  finalizeAccepted: boolean
  projectWriteOccurred: boolean
  checksInvalidatedByWrite: boolean
  checkResults: CheckResult[]
  patch: {
    patchDir: string
    patchFiles: string[]
  } | null
}

// ── Capsule isolation constants (hardcoded; never derived from skill text) ────

const CAPSULE_ISOLATION: CapsuleIsolationIndicators = {
  executorNetworkDisabled: true,
  noCredentialsPassedToExecutor: true,
}

// ── Budget-exhaustion error detection ────────────────────────────────────────

function isBudgetExhaustionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return (
    err.message.includes('exceeded') &&
    err.message.toLowerCase().includes('custom tool calls')
  )
}

// ── Terminal outcome derivation from broker result ────────────────────────────
//
// Since project-tool-broker.ts is not modified, these fields are derived from
// the broker result fields that ARE exposed by ProjectBrokerSessionResult.

function deriveFinalizeAttempted(brokerResult: ProjectBrokerSessionResult): boolean {
  return (brokerResult.customToolCounts[SPRINT4A_TOOL_FINALIZE] ?? 0) > 0
}

function deriveFinalizeAccepted(brokerResult: ProjectBrokerSessionResult): boolean {
  return brokerResult.patchPackage !== null
}

function deriveProjectWriteOccurred(brokerResult: ProjectBrokerSessionResult): boolean {
  return (brokerResult.customToolCounts[SPRINT4A_TOOL_WRITE_FILE] ?? 0) > 0
}

function deriveChecksInvalidatedByWrite(
  writeOccurred: boolean,
  finalizeAttempted: boolean,
  finalizeAccepted: boolean,
): boolean {
  // A write always invalidates check evidence. If writes occurred AND finalize was
  // attempted but rejected (gate 2 fired because checksValidAfterLastWrite was false
  // OR gate 1 fired because checks were never re-run after the write), checks were
  // invalidated. If finalize was accepted, writes were healed by subsequent checks.
  if (!writeOccurred) return false
  if (finalizeAccepted) return false
  if (finalizeAttempted) return true
  // Writes occurred but finalize was never attempted — checks were invalidated
  // but the agent didn't try to finalize. Conservative: true.
  return true
}

function deriveTerminationReason(
  brokerResult: ProjectBrokerSessionResult,
  budgetExhausted: boolean,
): LiveRunTerminationReason {
  if (budgetExhausted) return 'FAILED_TOOL_BUDGET_EXHAUSTED'
  if (brokerResult.patchPackage !== null) return 'COMPLETED'
  return 'FAILED_INCOMPLETE_AGENT_RUN'
}

function derivePatchEligible(
  brokerResult: ProjectBrokerSessionResult,
  sourceUnmodified: boolean,
): boolean {
  if (!sourceUnmodified) return false
  if (!brokerResult.passed) return false
  if (brokerResult.patchPackage === null) return false
  if (brokerResult.builtinToolUseCount !== 0) return false
  const checksPassed =
    brokerResult.checkResults !== null &&
    brokerResult.checkResults.length > 0 &&
    brokerResult.checkResults.every(r => r.verdict === 'PASS')
  return checksPassed
}

// ── Main function ─────────────────────────────────────────────────────────────

const TASK_DESCRIPTION = `Add a new exported function summarizeChecks(results) to src/status.js.

Input: An array of objects shaped as: { name: string, passed: boolean }

Output:
{
  total: number,
  passing: number,
  failing: number,
  status: "healthy" | "degraded"
}

Rules:
- Empty arrays are valid and return status "healthy".
- Reject non-array input.
- Reject entries without a non-empty string name or boolean passed value.
- Add deterministic tests in tests/status.test.js.
- Do not change package dependencies.
- Run the approved test check.
- Finalize only after tests pass.`

/**
 * Run a skill-guided sanitized-project broker session.
 *
 * Mandatory invocation ordering:
 *   Steps 1-7:  Skill validation — all checks for the skill; no side effects.
 *   Step 8:     Append Phase A audit record (appendFileSync before broker call).
 *               Phase A failure → SkillGuidedInvocationError('PHASE_A_AUDIT_FAILED')
 *               → no broker session started, no envelope exposed.
 *   Step 9:     Run broker session with agentMessage = rendered envelope text.
 *               Budget exhaustion throws; other exceptions are caught.
 *   Step 10:    Construct Phase B record from trusted broker state (never from skill text).
 *   Step 11:    Append Phase B audit record (appendFileSync — last gate).
 *               Phase B failure → return FAILED_INVOCATION_AUDIT_PERSISTENCE.
 *               All results are released only after Phase B succeeds.
 */
export async function runSkillGuidedSanitizedProjectPilot(opts: {
  skillRequest: SkillGuidedInvocationRequest
  pilotSourcePath: string
  controlClient: Anthropic
  state: Sprint4aState
}): Promise<SkillGuidedRunReport> {
  const { skillRequest, pilotSourcePath, controlClient, state } = opts
  const agent = state.agent!
  const invocationId = randomUUID()
  const invocationTimestamp = new Date().toISOString()
  const runId = `stage2b-${Date.now()}`

  const runtimeBase = SPRINT4A_RUNTIME_BASE
  fs.mkdirSync(runtimeBase, { recursive: true })
  const runDir = path.join(runtimeBase, runId)
  const patchDir = path.join(runtimeBase, 'runs', 'powerplant-pilot-status', runId)
  fs.mkdirSync(runDir, { recursive: true })
  fs.mkdirSync(patchDir, { recursive: true })

  // ── Step 1: Validate request shape ─────────────────────────────────────────

  if (!skillRequest.skillId || typeof skillRequest.skillId !== 'string' || skillRequest.skillId.trim() === '') {
    throw new SkillGuidedInvocationError('INVALID_REQUEST', 'skillRequest has missing or empty skillId')
  }
  if (!skillRequest.expectedHash || typeof skillRequest.expectedHash !== 'string' || skillRequest.expectedHash.trim() === '') {
    throw new SkillGuidedInvocationError('INVALID_REQUEST', `skillRequest for "${skillRequest.skillId}" has missing or empty expectedHash`)
  }

  // ── Steps 2-7: Skill validation (collect phase — no side effects) ───────────

  const allSkills = listSkills()

  // Step 2: Registry lookup
  const record = allSkills.find(s => s.name === skillRequest.skillId)
  if (!record) {
    throw new SkillGuidedInvocationError('SKILL_NOT_FOUND', `Skill "${skillRequest.skillId}" is not in the registry`)
  }

  // Step 3: Enabled check
  if (record.isDisabled) {
    throw new SkillGuidedInvocationError('SKILL_DISABLED', `Skill "${skillRequest.skillId}" is disabled and cannot be invoked`)
  }

  // Step 4: Hash expectation check
  if (record.contentHash !== skillRequest.expectedHash) {
    throw new SkillGuidedInvocationError('HASH_EXPECTATION_MISMATCH', `Skill "${skillRequest.skillId}": expectedHash does not match registry hash`)
  }

  // Step 5: Live hash reverification via renderPromptEnvelope
  const envelope = renderPromptEnvelope(skillRequest.skillId)
  if (!envelope) {
    const liveHash = (() => {
      try { return computeSkillContentHash(getCandidatePath(record.candidateId)) } catch { return null }
    })()
    if (liveHash !== record.contentHash) {
      throw new SkillGuidedInvocationError('LIVE_HASH_MISMATCH', `Skill "${skillRequest.skillId}": live content hash does not match promoted hash`)
    }
    throw new SkillGuidedInvocationError('LIVE_HASH_MISMATCH', `Skill "${skillRequest.skillId}": renderPromptEnvelope failed`)
  }

  // Step 6: Disclaimer present check
  if (!envelope.text.includes(SKILL_AUTHORITY_DISCLAIMER)) {
    throw new SkillGuidedInvocationError('DISCLAIMER_MISSING', `Skill "${skillRequest.skillId}": rendered envelope does not contain SKILL_AUTHORITY_DISCLAIMER`)
  }

  // Step 7: Compute envelopeHash (SHA-256 of full envelope text)
  let envelopeHash: string
  try {
    envelopeHash = crypto.createHash('sha256').update(envelope.text, 'utf-8').digest('hex')
  } catch (err) {
    throw new SkillGuidedInvocationError('ENVELOPE_HASH_FAILED' as never, `Failed to compute envelope hash: ${(err as Error).message}`)
  }

  const invokedSkillEntry: InvokedSkillEntry = {
    skillId: skillRequest.skillId,
    activeVersion: envelope.version,
    expectedHash: skillRequest.expectedHash,
    registryHash: record.contentHash,
    liveContentHash: envelope.contentHash,
    envelopeHash,
    enabledAtInvocation: true,
  }

  // ── Load contract BEFORE Phase A (contract is pre-session, not skill-influenced) ─

  const contract = loadProjectContract(pilotSourcePath)
  const snapshot = buildPilotSnapshot(contract, runDir)

  // ── Step 8: Append Phase A audit record — LAST GATE before broker session ──

  const phaseARecord: SkillInvocationPhaseARecord = {
    phase: SKILL_INVOCATION_PHASE_A,
    invocationId,
    invocationTimestamp,
    syntheticScope: false,
    runnerType: SKILL_GUIDED_PILOT_RUNNER_TYPE,
    invokedSkills: [invokedSkillEntry],
    runId,
    sanitizedProjectId: contract.projectId,
    operatorSelectedSkills: true,
  }

  let auditPath: string
  try {
    auditPath = appendPhaseARecord(phaseARecord)
  } catch (err) {
    throw new SkillGuidedInvocationError(
      'PHASE_A_AUDIT_FAILED',
      `Failed to persist Phase A audit record: ${(err as Error).message}`
    )
  }

  // ── Step 9: Run broker session (skill envelope as agentMessage) ─────────────
  //
  // From this point, every exit path MUST attempt Phase B before returning.
  // The envelope text enters only as agentMessage prompt text — it cannot
  // influence broker state, finalize guards, capsule isolation, or check commands.

  let brokerResult: ProjectBrokerSessionResult | null = null
  let brokerException: Error | null = null
  let budgetExhausted = false

  try {
    brokerResult = await runProjectPilotBrokerSession({
      client: controlClient,
      agentId: agent.id,
      agentVersion: agent.version,
      environmentId: state.environmentId,
      snapshot,
      contract,
      runId,
      outputDir: path.join(runDir, 'executor-outputs'),
      patchDir,
      taskDescription: TASK_DESCRIPTION,
      agentMessage: envelope.text,
    })
  } catch (err) {
    brokerException = err instanceof Error ? err : new Error(String(err))
    budgetExhausted = isBudgetExhaustionError(brokerException)
  }

  // ── Step 10: Derive terminal fields from trusted broker state ───────────────
  //
  // CRITICAL: No field in phaseBRecord may be derived from envelope.text or
  // any other skill-text source. All fields come from broker result counters,
  // classification data, and post-session file verification.

  const sourceVerification = brokerResult
    ? verifySourceUnchanged(snapshot)
    : { sourceUnmodified: false }

  let sessionId: string
  let checkResults: CheckResult[]
  let finalizeAttempted: boolean
  let finalizeAccepted: boolean
  let writeOccurred: boolean
  let checksInvalidated: boolean
  let terminationReason: LiveRunTerminationReason
  let patchEligible: boolean
  let phaseBFinalOutcome: LiveRunFinalOutcome

  if (brokerResult !== null) {
    sessionId = brokerResult.sessionId
    checkResults = brokerResult.checkResults ?? []
    finalizeAttempted = deriveFinalizeAttempted(brokerResult)
    finalizeAccepted = deriveFinalizeAccepted(brokerResult)
    writeOccurred = deriveProjectWriteOccurred(brokerResult)
    checksInvalidated = deriveChecksInvalidatedByWrite(writeOccurred, finalizeAttempted, finalizeAccepted)
    terminationReason = deriveTerminationReason(brokerResult, false)
    patchEligible = derivePatchEligible(brokerResult, sourceVerification.sourceUnmodified)
    phaseBFinalOutcome = finalizeAccepted && brokerResult.passed ? 'COMPLETED' : 'FAILED_INCOMPLETE_AGENT_RUN'
  } else {
    // Broker threw — session may have started but we have no result
    sessionId = ''
    checkResults = []
    finalizeAttempted = false
    finalizeAccepted = false
    writeOccurred = false
    checksInvalidated = false
    terminationReason = budgetExhausted
      ? 'FAILED_TOOL_BUDGET_EXHAUSTED'
      : 'BROKER_SESSION_EXCEPTION'
    patchEligible = false
    phaseBFinalOutcome = budgetExhausted
      ? 'FAILED_TOOL_BUDGET_EXHAUSTED'
      : 'BROKER_SESSION_EXCEPTION'
  }

  // ── Step 11: Append Phase B audit record — LAST GATE before result release ──
  //
  // This is the mandatory single terminal funnel. No clearance, eligibility flag,
  // or patch reference is returned until this append succeeds.

  const phaseBRecord: SkillInvocationPhaseBRecord = {
    phase: SKILL_INVOCATION_PHASE_B,
    invocationId,
    sessionId,
    projectWriteOccurred: writeOccurred,
    checksInvalidatedByWrite: checksInvalidated,
    checkResults,
    finalizeAttempted,
    finalizeAccepted,
    terminationReason,
    patchEligibleForApplication: patchEligible,
    capsuleIsolationIndicators: CAPSULE_ISOLATION,
    sourceTreeUnmodified: sourceVerification.sourceUnmodified,
    finalOutcome: phaseBFinalOutcome,
  }

  let phaseBPersisted = false
  try {
    appendPhaseBRecord(phaseBRecord)
    phaseBPersisted = true
  } catch {
    // Phase B persistence failed — must return FAILED_INVOCATION_AUDIT_PERSISTENCE
  }

  // ── Single release gate ─────────────────────────────────────────────────────
  //
  // If Phase B failed: return failure, discard all broker results (even if broker
  // finalize was accepted and patch artifacts exist on disk at patchDir).
  // Staged artifacts are forensic-only; they are not surfaced as eligible.

  if (!phaseBPersisted) {
    return {
      invocationId,
      runId,
      timestamp: invocationTimestamp,
      syntheticScope: false,
      runnerType: SKILL_GUIDED_PILOT_RUNNER_TYPE,
      sanitizedProjectId: contract.projectId,
      skillId: skillRequest.skillId,
      envelopeHash,
      auditRecordPath: auditPath,
      sessionId: null,
      finalOutcome: 'FAILED_INVOCATION_AUDIT_PERSISTENCE',
      terminationReason: null,
      patchEligibleForApplication: false,
      clearedForSanitizedExternalProjectInput: false,
      sourceTreeUnmodified: false,
      finalizeAttempted: false,
      finalizeAccepted: false,
      projectWriteOccurred: false,
      checksInvalidatedByWrite: false,
      checkResults: [],
      patch: null,
    }
  }

  // Phase B succeeded — release result reflecting broker outcome

  return {
    invocationId,
    runId,
    timestamp: invocationTimestamp,
    syntheticScope: false,
    runnerType: SKILL_GUIDED_PILOT_RUNNER_TYPE,
    sanitizedProjectId: contract.projectId,
    skillId: skillRequest.skillId,
    envelopeHash,
    auditRecordPath: auditPath,
    sessionId: brokerResult?.sessionId ?? null,
    finalOutcome: phaseBFinalOutcome,
    terminationReason,
    patchEligibleForApplication: patchEligible,
    clearedForSanitizedExternalProjectInput: patchEligible,
    sourceTreeUnmodified: sourceVerification.sourceUnmodified,
    finalizeAttempted,
    finalizeAccepted,
    projectWriteOccurred: writeOccurred,
    checksInvalidatedByWrite: checksInvalidated,
    checkResults,
    patch: brokerResult?.patchPackage
      ? { patchDir: brokerResult.patchPackage.patchDir, patchFiles: brokerResult.patchPackage.patchFiles }
      : null,
  }
}
