// Stage 2A — Synthetic Promoted Guidance Pilot
//
// Structural synthetic boundary: this module is physically incapable of reaching
// external project files, cloud API, broker session, capsule execution, or finalize.
//
// What this module does NOT import (import-graph containment):
//   - loadProjectContract          — not imported
//   - buildPilotSnapshot           — not imported
//   - runProjectPilotBrokerSession  — not imported
//   - runCapsuleChecks              — not imported
//   - buildCapsuleDockerArgv        — not imported
//   - Anthropic (SDK client)        — not imported
//   - Any module from src/broker/   — not imported
//   - Any module from src/verification/ — not imported
//   - Any module from src/projects/  — not imported
//
// The absence of these imports is verifiable by static analysis of this file.
// That structural absence — not a runtime flag — is the synthetic boundary guarantee.

import crypto from 'crypto'
import { randomUUID } from 'crypto'
import { listSkills, computeSkillContentHash } from '../skills/skill-lifecycle.js'
import { renderPromptEnvelope, SKILL_AUTHORITY_DISCLAIMER } from '../skills/skill-envelope.js'
import { getCandidatePath } from '../skills/skill-paths.js'
import {
  openInvocationAuditRecord,
  type SkillInvocationRecord,
  type InvokedSkillEntry,
} from '../skills/skill-invocation-audit.js'

// ── Error codes ───────────────────────────────────────────────────────────────

export class SyntheticInvocationError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_REQUEST'
      | 'SKILL_NOT_FOUND'
      | 'SKILL_DISABLED'
      | 'HASH_EXPECTATION_MISMATCH'
      | 'LIVE_HASH_MISMATCH'
      | 'DISCLAIMER_MISSING'
      | 'ENVELOPE_HASH_FAILED'
      | 'AUDIT_OPEN_FAILED'
      | 'SYNTHETIC_BUDGET_EXCEEDED',
    message: string
  ) {
    super(message)
    this.name = 'SyntheticInvocationError'
  }
}

// ── Input / output types ──────────────────────────────────────────────────────

export interface SkillInvocationRequest {
  skillId: string       // skill name from registry
  expectedHash: string  // hash the operator declares; must match registry and live hash
}

export interface RenderedSkillEnvelope {
  skillId: string
  version: number
  liveContentHash: string
  envelopeHash: string
  envelopeText: string
}

export interface SyntheticGuidanceRunResult {
  invocationId: string
  syntheticScope: true                          // literal true — cannot represent live sessions
  renderedEnvelopes: RenderedSkillEnvelope[]
  auditRecordPath: string
  auditRecordPersistedBeforeExposure: true       // literal true — guaranteed by call ordering
  prohibitedBehaviorAttempts: string[]
  syntheticToolCallCount: number
  syntheticBudgetLimit: number
}

// ── Internal collect-phase result ─────────────────────────────────────────────

interface CollectedEnvelope {
  skillId: string
  version: number
  registryHash: string
  liveContentHash: string
  envelopeHash: string
  envelopeText: string
  enabledAtInvocation: boolean
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Run a synthetic promoted-guidance pilot invocation.
 *
 * Mandatory invocation ordering (from Stage 2A plan §8):
 *
 *   Step 1:  Validate all skillRequests (non-empty, correct shape)
 *   Step 2:  For each skill: registry lookup
 *   Step 3:  For each skill: disabled check
 *   Step 4:  For each skill: hash expectation check (expectedHash vs registryHash)
 *   Step 5:  For each skill: renderPromptEnvelope (live hash recomputation)
 *   Step 6:  For each rendered envelope: disclaimer present check
 *   Step 7:  For each envelope: compute envelopeHash
 *            ↑ Steps 1-7: ALL must pass for ALL skills before continuing ↑
 *   Step 8:  openInvocationAuditRecord — appendFileSync before any envelope returned
 *            → if this throws: throw AUDIT_OPEN_FAILED — return nothing to caller
 *            ↑ Step 8 MUST complete durably before step 9 ↑
 *   Step 9:  Return SyntheticGuidanceRunResult (envelope text exposed to caller)
 *
 * Batch atomicity: if ANY skill fails steps 2–7, NO envelope is produced for ANY skill,
 * and no audit record is written.
 *
 * Budget enforcement: syntheticBudget <= 0 is evaluated after all per-skill checks pass.
 * The audit record with SYNTHETIC_BUDGET_EXCEEDED outcome is persisted (step 8),
 * then the error is thrown (before step 9 returns envelopes).
 *
 * This function structurally cannot:
 *   - load an external project contract
 *   - build a sanitized workspace
 *   - create a Managed Agent session via cloud API
 *   - invoke broker tools or reach project_finalize
 *   - execute capsule checks
 *   - access credentials or network
 *   - mutate broker state (checksValidAfterLastWrite, testCheckPassed)
 */
export async function runSyntheticPromotedGuidancePilot(opts: {
  skillRequests: SkillInvocationRequest[]
  syntheticPrompt?: string
  syntheticBudget?: number
}): Promise<SyntheticGuidanceRunResult> {
  const { skillRequests, syntheticPrompt, syntheticBudget = 5 } = opts
  const invocationId = randomUUID()
  const invocationTimestamp = new Date().toISOString()

  // ── Step 1: Validate request shape ───────────────────────────────────────────

  if (!skillRequests || skillRequests.length === 0) {
    throw new SyntheticInvocationError(
      'INVALID_REQUEST',
      'skillRequests must be a non-empty array'
    )
  }

  for (const req of skillRequests) {
    if (!req.skillId || typeof req.skillId !== 'string' || req.skillId.trim() === '') {
      throw new SyntheticInvocationError(
        'INVALID_REQUEST',
        `skillRequest has missing or empty skillId`
      )
    }
    if (!req.expectedHash || typeof req.expectedHash !== 'string' || req.expectedHash.trim() === '') {
      throw new SyntheticInvocationError(
        'INVALID_REQUEST',
        `skillRequest for "${req.skillId}" has missing or empty expectedHash`
      )
    }
  }

  // ── Phase 1 (Steps 2–7): Collect — all checks for ALL skills, no side effects ─
  //
  // All skills must pass all checks before any audit write or any result return.
  // If any skill fails, the entire batch is aborted (all-or-nothing atomicity).

  const allSkills = listSkills()
  const collected: CollectedEnvelope[] = []

  for (const request of skillRequests) {

    // Step 2: Registry lookup
    // listSkills() returns SkillSummary[] with fields: name, activeVersion, candidateId,
    // activatedAt, isDisabled, contentHash
    const record = allSkills.find(s => s.name === request.skillId)
    if (!record) {
      throw new SyntheticInvocationError(
        'SKILL_NOT_FOUND',
        `Skill "${request.skillId}" is not in the registry`
      )
    }

    // Step 3: Enabled check
    if (record.isDisabled) {
      throw new SyntheticInvocationError(
        'SKILL_DISABLED',
        `Skill "${request.skillId}" is disabled and cannot be invoked`
      )
    }

    // Step 4: Hash expectation check (operator's declared hash vs registry hash)
    if (record.contentHash !== request.expectedHash) {
      throw new SyntheticInvocationError(
        'HASH_EXPECTATION_MISMATCH',
        `Skill "${request.skillId}": expectedHash does not match registry hash`
      )
    }

    // Step 5: Live hash reverification via renderPromptEnvelope
    // renderPromptEnvelope recomputes the live content hash from the snapshot.
    // If the snapshot was mutated after promotion, it returns null.
    // renderPromptEnvelope returns SkillEnvelope | null:
    //   { skillName: string, version: number, contentHash: string, text: string }
    const envelope = renderPromptEnvelope(request.skillId)
    if (!envelope) {
      // Re-verify live hash explicitly to provide a precise error message.
      const liveHash = (() => {
        try {
          return computeSkillContentHash(getCandidatePath(record.candidateId))
        } catch {
          return null
        }
      })()

      if (liveHash !== record.contentHash) {
        throw new SyntheticInvocationError(
          'LIVE_HASH_MISMATCH',
          `Skill "${request.skillId}": live content hash does not match promoted hash (snapshot mutated after promotion)`
        )
      }

      throw new SyntheticInvocationError(
        'LIVE_HASH_MISMATCH',
        `Skill "${request.skillId}": renderPromptEnvelope failed — snapshot may be incomplete or mutated`
      )
    }

    // Step 6: Disclaimer present check
    if (!envelope.text.includes(SKILL_AUTHORITY_DISCLAIMER)) {
      throw new SyntheticInvocationError(
        'DISCLAIMER_MISSING',
        `Skill "${request.skillId}": rendered envelope does not contain SKILL_AUTHORITY_DISCLAIMER`
      )
    }

    // Step 7: Compute envelopeHash (SHA-256 of full envelope text)
    let envelopeHash: string
    try {
      envelopeHash = crypto.createHash('sha256').update(envelope.text, 'utf-8').digest('hex')
    } catch (err) {
      throw new SyntheticInvocationError(
        'ENVELOPE_HASH_FAILED',
        `Skill "${request.skillId}": failed to compute envelope hash: ${(err as Error).message}`
      )
    }

    // envelope.contentHash is the live hash recomputed by renderPromptEnvelope
    // envelope.version is the activeVersion from the registry record
    collected.push({
      skillId: request.skillId,
      version: envelope.version,
      registryHash: record.contentHash,
      liveContentHash: envelope.contentHash,
      envelopeHash,
      envelopeText: envelope.text,
      enabledAtInvocation: true,  // confirmed by step 3 check above
    })
  }

  // ── Phase 2: Validate — all checks passed for all skills ─────────────────────
  // All envelopes are in memory. No result returned yet. No audit record written yet.

  // Build invokedSkills for the audit record
  const invokedSkills: InvokedSkillEntry[] = collected.map(c => ({
    skillId: c.skillId,
    activeVersion: c.version,
    expectedHash: skillRequests.find(r => r.skillId === c.skillId)!.expectedHash,
    registryHash: c.registryHash,
    liveContentHash: c.liveContentHash,
    envelopeHash: c.envelopeHash,
    enabledAtInvocation: c.enabledAtInvocation,
  }))

  // ── Budget check — evaluated after all per-skill checks pass ─────────────────
  //
  // Budget exhaustion outcome is written to the audit record (step 8), then thrown.
  // The audit record is persisted before the exception propagates to the caller.

  const isBudgetExhausted = syntheticBudget <= 0
  const finalOutcome: SkillInvocationRecord['finalOutcome'] =
    isBudgetExhausted ? 'SYNTHETIC_BUDGET_EXCEEDED' : 'COMPLETED'

  const auditRecord: SkillInvocationRecord = {
    invocationId,
    syntheticScope: true,
    runnerType: 'synthetic',
    invokedSkills,
    invocationTimestamp,
    operatorSelectedSkills: true,
    syntheticPromptProvided: syntheticPrompt !== undefined,
    finalOutcome,
    prohibitedBehaviorAttempts: [],
    syntheticToolCallCount: 0,
    syntheticBudgetLimit: syntheticBudget,
  }

  // ── Phase 3: Persist — Step 8: open invocation audit record ──────────────────
  //
  // CRITICAL ordering requirement (plan §8, §10 Condition 2):
  //   openInvocationAuditRecord MUST be called before any return statement
  //   that provides envelope text. If appendFileSync throws, AUDIT_OPEN_FAILED
  //   is thrown and envelope text is never returned to the caller.

  let auditPath: string
  try {
    auditPath = openInvocationAuditRecord(auditRecord)
    // ↑ appendFileSync completes synchronously — audit is durable before continuing
  } catch (err) {
    throw new SyntheticInvocationError(
      'AUDIT_OPEN_FAILED',
      `Failed to persist invocation audit record: ${(err as Error).message}`
    )
  }

  // After audit persistence: throw budget exhaustion now (record is on disk)
  if (isBudgetExhausted) {
    throw new SyntheticInvocationError(
      'SYNTHETIC_BUDGET_EXCEEDED',
      `Synthetic budget exhausted: budget was ${syntheticBudget}`
    )
  }

  // ── Phase 4: Return — Step 9: expose envelopes to caller (test infrastructure) ─
  //
  // Audit record is durably persisted on disk. Envelope text is now returned.
  //
  // The synthetic session (test infrastructure caller) structurally cannot:
  //   - read or write a project           (no project path, not imported)
  //   - invoke broker tools               (broker loop not imported)
  //   - execute capsule checks            (runCapsuleChecks not imported)
  //   - reach project_finalize            (handleFinalize is broker-internal, not exported)
  //   - access network or credentials     (no Anthropic client, no .env read)
  //   - mutate verification records       (BrokerState is broker-internal, not exported)
  //
  // Enforced by import-graph structure (see module header), not runtime flags.

  const renderedEnvelopes: RenderedSkillEnvelope[] = collected.map(c => ({
    skillId: c.skillId,
    version: c.version,
    liveContentHash: c.liveContentHash,
    envelopeHash: c.envelopeHash,
    envelopeText: c.envelopeText,
  }))

  return {
    invocationId,
    syntheticScope: true,
    renderedEnvelopes,
    auditRecordPath: auditPath,
    auditRecordPersistedBeforeExposure: true,
    prohibitedBehaviorAttempts: [],
    syntheticToolCallCount: 0,
    syntheticBudgetLimit: syntheticBudget,
  }
}
