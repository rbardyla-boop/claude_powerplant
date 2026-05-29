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
// Two-hash composition model (Blocker 1):
//   operatorTaskHash  = SHA-256 of the immutable operator task text (TASK_DESCRIPTION)
//   envelopeHash      = SHA-256 of the rendered skill guidance envelope text
//   agentMessage      = operator task (verbatim) + clearly delimited guidance section
//   The task must appear verbatim in agentMessage; guidance is supplementary and subordinate.
//
// Broker-authoritative truth model (Blocker 2):
//   patchEligibleForApplication comes from brokerResult.classification.patchEligibleForApplication.
//   Wrapper never re-derives patch eligibility independently.
//
// Isolation evidence model (Blocker 3):
//   CapsuleIsolationRecord separates declaredPolicy from observedEvidence.
//   Static policy declarations must not populate observedEvidence fields.
//
// Phase A chronology (Blocker 4 — Option B):
//   loadProjectContract() and buildPilotSnapshot() execute before appendPhaseARecord().
//   Phase A record documents this explicitly via recordPosition: 'post-contract-pre-session'.
//
// Single terminal funnel requirement (Audit 2A):
//   Phase A persists before any broker call.
//   EVERY session-started terminal outcome routes through one Phase B write.
//   No eligible result is released until Phase B persistence succeeds.

import crypto from 'crypto'
import { randomUUID } from 'crypto'
import { performance } from 'perf_hooks'
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
  type CapsuleIsolationRecord,
} from '../skills/skill-invocation-audit.js'
import { runProjectPilotBrokerSession } from '../broker/project-tool-broker.js'
import { loadProjectContract } from '../projects/load-project-contract.js'
import { buildPilotSnapshot } from '../projects/build-pilot-snapshot.js'
import { verifySourceUnchanged } from '../projects/verify-source-unchanged.js'
import type { ProjectBrokerSessionResult } from '../broker/project-tool-broker.js'
import type { CheckResult } from '../contracts/verification-preflight-report.js'
import {
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
      | 'PHASE_A_AUDIT_FAILED'
      | 'AGENT_MESSAGE_COMPOSITION_FAILED'
      | 'SESSION_START_TIMESTAMP_TIMEOUT',
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
  operatorTaskHash: string
  envelopeHash: string
  compositionPolicyVersion: string
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

// ── Composition constants ─────────────────────────────────────────────────────
//
// The composition policy ensures the operator task appears verbatim and the
// skill guidance is clearly labelled as supplementary and subordinate.
// Changing this policy version constant signals a breaking composition change.

const TASK_FIRST_COMPOSITION_POLICY_VERSION = 'task-first-guidance-supplementary-v1'

const GUIDANCE_SECTION_HEADER = '[OPERATOR-APPROVED SKILL GUIDANCE — SUPPLEMENTARY ONLY]'
const GUIDANCE_SECTION_FOOTER = '[END SKILL GUIDANCE — OPERATOR TASK ABOVE TAKES PRECEDENCE]'

// ── Capsule isolation policy ──────────────────────────────────────────────────
//
// These are operator-declared policy controls. They are NOT per-run observations.
// Per-run observedEvidence defaults to 'unknown' because this implementation does
// not capture a runtime receipt from the executor environment.

const CAPSULE_DECLARED_POLICY: CapsuleIsolationRecord = {
  declaredPolicy: {
    networkIsolationDeclared: true,
    credentialIsolationDeclared: true,
  },
  observedEvidence: {
    executionReceiptPresent: false,
    networkDisabledObserved: 'unknown',
    noCredentialsMountedObserved: 'unknown',
  },
}

// ── Bounded session-start timestamp capture ───────────────────────────────────
//
// The strict temporal invariant requires:
//   Date.parse(phaseB.sessionStartedAt) > Date.parse(phaseA.invocationTimestamp)
//
// In fast execution both may land on the same millisecond.  The repair yields
// briefly between observations and uses a monotonic budget so that a frozen or
// regressed wall clock cannot cause an unbounded spin.
//
// Wall-clock truth (Date.now) and timeout measurement (performance.now) are
// deliberately separate: a frozen wall clock cannot defeat the timeout, and a
// frozen monotonic clock cannot forge a false sessionStartedAt.

const SESSION_START_TIMEOUT_BUDGET_MS = 500
const SESSION_START_YIELD_INTERVAL_MS = 1

async function awaitStrictlyAfterTimestamp(invocationTimestamp: string): Promise<string> {
  const tsA = Date.parse(invocationTimestamp)
  const budgetStart = performance.now()
  while (true) {
    const observedMs = Date.now()
    if (observedMs > tsA) {
      return new Date(observedMs).toISOString()
    }
    const elapsed = performance.now() - budgetStart
    if (elapsed >= SESSION_START_TIMEOUT_BUDGET_MS) {
      throw new SkillGuidedInvocationError(
        'SESSION_START_TIMESTAMP_TIMEOUT',
        `sessionStartedAt could not be observed strictly after invocationTimestamp within ${SESSION_START_TIMEOUT_BUDGET_MS}ms: wall clock did not advance past Phase A timestamp`
      )
    }
    await new Promise<void>(resolve => setTimeout(resolve, SESSION_START_YIELD_INTERVAL_MS))
  }
}

// ── Budget-exhaustion error detection ────────────────────────────────────────

function isBudgetExhaustionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return (
    err.message.includes('exceeded') &&
    err.message.toLowerCase().includes('custom tool calls')
  )
}

// ── Agent message composition ─────────────────────────────────────────────────
//
// Composes the agent message with the operator task first (verbatim) and the
// skill guidance clearly delimited as supplementary and subordinate.
// Throws AGENT_MESSAGE_COMPOSITION_FAILED if the task is not present in the result.

function composeAgentMessage(operatorTask: string, envelopeText: string): string {
  const composed = [
    operatorTask,
    '',
    GUIDANCE_SECTION_HEADER,
    envelopeText,
    GUIDANCE_SECTION_FOOTER,
  ].join('\n')

  if (!composed.includes(operatorTask)) {
    throw new SkillGuidedInvocationError(
      'AGENT_MESSAGE_COMPOSITION_FAILED',
      'Composed agent message does not contain the operator task verbatim'
    )
  }

  return composed
}

// ── Terminal outcome from broker result ───────────────────────────────────────
//
// Blocker 2: all terminal truth flows from broker-authoritative fields.
// Wrapper never independently re-derives patch eligibility from check history.

function deriveTerminationReason(
  brokerResult: ProjectBrokerSessionResult,
  budgetExhausted: boolean,
): LiveRunTerminationReason {
  if (budgetExhausted) return 'FAILED_TOOL_BUDGET_EXHAUSTED'
  if (brokerResult.finalizeAccepted) return 'COMPLETED'
  return 'FAILED_INCOMPLETE_AGENT_RUN'
}

function deriveProjectWriteOccurred(brokerResult: ProjectBrokerSessionResult): boolean {
  return (brokerResult.customToolCounts[SPRINT4A_TOOL_WRITE_FILE] ?? 0) > 0
}

// checksInvalidatedByWrite is a factual display field, not an eligibility gate.
// It reflects broker state: write occurred AND checks were not valid after last write.
function deriveChecksInvalidatedByWrite(
  writeOccurred: boolean,
  brokerResult: ProjectBrokerSessionResult,
): boolean {
  return writeOccurred && !brokerResult.checksValidAfterLastWrite
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
 *   Step 8:     Load contract and build snapshot (post-contract-load, pre-session).
 *   Step 9:     Append Phase A audit record (appendFileSync before broker call).
 *               recordPosition: 'post-contract-pre-session' documents the ordering truth.
 *               Phase A failure → SkillGuidedInvocationError('PHASE_A_AUDIT_FAILED')
 *               → no broker session started, no envelope exposed.
 *   Step 10:    Run broker session with composed agentMessage (task + guidance).
 *               Budget exhaustion throws; other exceptions are caught.
 *   Step 11:    Construct Phase B record from broker-authoritative state.
 *               patchEligibleForApplication comes from brokerResult.classification.
 *   Step 12:    Append Phase B audit record (appendFileSync — last gate).
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

  // Step 7: Compute envelopeHash (SHA-256 of guidance envelope text only)
  // and operatorTaskHash (SHA-256 of immutable operator task text).
  // These two hashes are recorded independently in Phase A.
  let envelopeHash: string
  let operatorTaskHash: string
  try {
    envelopeHash = crypto.createHash('sha256').update(envelope.text, 'utf-8').digest('hex')
    operatorTaskHash = crypto.createHash('sha256').update(TASK_DESCRIPTION, 'utf-8').digest('hex')
  } catch (err) {
    throw new SkillGuidedInvocationError('ENVELOPE_HASH_FAILED' as never, `Failed to compute hashes: ${(err as Error).message}`)
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

  // ── Step 8: Load contract and build snapshot (pre-session) ─────────────────
  // These execute before Phase A is written. Phase A records this ordering
  // explicitly via recordPosition: 'post-contract-pre-session'.

  const contract = loadProjectContract(pilotSourcePath)
  const snapshot = buildPilotSnapshot(contract, runDir)

  // ── Step 9: Append Phase A audit record — LAST GATE before broker session ──
  // recordPosition documents the truthful ordering: contract/snapshot were
  // loaded before this record was written.

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
    operatorTaskHash,
    compositionPolicyVersion: TASK_FIRST_COMPOSITION_POLICY_VERSION,
    recordPosition: 'post-contract-pre-session',
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

  // ── Step 10: Compose agent message and run broker session ───────────────────
  //
  // Blocker 1 composition: operator task appears verbatim first; skill guidance
  // follows as a clearly delimited supplementary section. The guidance cannot
  // override broker policy, verification requirements, or the operator task.
  // The envelopeHash (guidance-only) and operatorTaskHash remain independently
  // auditable — agentMessage SHA-256 ≠ envelopeHash.

  const agentMessage = composeAgentMessage(TASK_DESCRIPTION, envelope.text)

  let brokerResult: ProjectBrokerSessionResult | null = null
  let brokerException: Error | null = null
  let budgetExhausted = false

  // Guarantee sessionStartedAt is strictly after invocationTimestamp.
  // Uses a bounded yielding helper: wall-clock truth from Date.now(),
  // timeout measurement from monotonic performance.now().
  // Throws SESSION_START_TIMESTAMP_TIMEOUT before broker invocation if the
  // budget is exhausted, so a frozen wall clock fails closed rather than hangs.
  const sessionStartedAt = await awaitStrictlyAfterTimestamp(invocationTimestamp)

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
      agentMessage,
    })
  } catch (err) {
    brokerException = err instanceof Error ? err : new Error(String(err))
    budgetExhausted = isBudgetExhaustionError(brokerException)
  }

  // ── Step 11: Derive Phase B fields from broker-authoritative state ──────────
  //
  // Blocker 2: patchEligibleForApplication flows from brokerResult.classification,
  // which is set by evaluateTerminalRunOutcome inside the broker. The wrapper
  // must not independently re-derive patch eligibility from check history.
  //
  // CRITICAL: No field in phaseBRecord may be derived from envelope.text or
  // any other skill-text source.

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
    // Use broker-authoritative values directly — no re-derivation
    finalizeAttempted = brokerResult.finalizeAttempted
    finalizeAccepted = brokerResult.finalizeAccepted
    writeOccurred = deriveProjectWriteOccurred(brokerResult)
    checksInvalidated = deriveChecksInvalidatedByWrite(writeOccurred, brokerResult)
    terminationReason = deriveTerminationReason(brokerResult, false)
    // Blocker 2: patchEligibleForApplication from broker classification, not re-derived
    patchEligible = brokerResult.classification.patchEligibleForApplication &&
      sourceVerification.sourceUnmodified
    phaseBFinalOutcome = finalizeAccepted && brokerResult.passed ? 'COMPLETED' : 'FAILED_INCOMPLETE_AGENT_RUN'
  } else {
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

  // ── Step 12: Append Phase B audit record — LAST GATE before result release ──
  //
  // Blocker 3: capsuleIsolation uses the two-layer model — declaredPolicy reflects
  // operator configuration; observedEvidence reflects per-run runtime receipts.
  // No static assertion is written as observed evidence.

  const phaseBRecord: SkillInvocationPhaseBRecord = {
    phase: SKILL_INVOCATION_PHASE_B,
    invocationId,
    sessionStartedAt,
    sessionId,
    projectWriteOccurred: writeOccurred,
    checksInvalidatedByWrite: checksInvalidated,
    checkResults,
    finalizeAttempted,
    finalizeAccepted,
    terminationReason,
    patchEligibleForApplication: patchEligible,
    capsuleIsolation: CAPSULE_DECLARED_POLICY,
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

  if (!phaseBPersisted) {
    return {
      invocationId,
      runId,
      timestamp: invocationTimestamp,
      syntheticScope: false,
      runnerType: SKILL_GUIDED_PILOT_RUNNER_TYPE,
      sanitizedProjectId: contract.projectId,
      skillId: skillRequest.skillId,
      operatorTaskHash,
      envelopeHash,
      compositionPolicyVersion: TASK_FIRST_COMPOSITION_POLICY_VERSION,
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

  return {
    invocationId,
    runId,
    timestamp: invocationTimestamp,
    syntheticScope: false,
    runnerType: SKILL_GUIDED_PILOT_RUNNER_TYPE,
    sanitizedProjectId: contract.projectId,
    skillId: skillRequest.skillId,
    operatorTaskHash,
    envelopeHash,
    compositionPolicyVersion: TASK_FIRST_COMPOSITION_POLICY_VERSION,
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
