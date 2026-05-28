// Stage 2A — Skill Invocation Audit
//
// Append-only JSONL audit trail for synthetic promoted-guidance invocations.
// This module is the ONLY write path to skill-invocation-audit.jsonl.
// It does NOT import broker, capsule, project, network, or credential modules.

import fs from 'fs'
import path from 'path'
import { getPowerplantHome } from '../config/powerplant-home.js'
import { SKILL_INVOCATION_AUDIT_FILENAME } from '../config/constants.js'

// ── Invocation audit schema ───────────────────────────────────────────────────

export interface InvokedSkillEntry {
  skillId: string                // skill name from registry
  activeVersion: number          // registry activeVersion at invocation time
  expectedHash: string           // hash the operator declared
  registryHash: string           // hash read from registry immediately before invocation
  liveContentHash: string        // hash recomputed by renderPromptEnvelope from snapshot
  envelopeHash: string           // SHA-256 of the rendered envelope text
  enabledAtInvocation: boolean   // false if skill was disabled (pre-check step 3 would block)
}

export interface SkillInvocationRecord {
  // Identity
  invocationId: string
  syntheticScope: boolean        // true for all Stage 2A; false for Stage 2B live-broker

  // Scope classification
  runnerType: 'synthetic'        // Stage 2B would use 'live-sanitized-pilot'

  // Skills invoked
  invokedSkills: InvokedSkillEntry[]

  // Context
  invocationTimestamp: string    // ISO 8601 — before any envelope is returned to caller
  operatorSelectedSkills: boolean
  syntheticPromptProvided: boolean

  // Outcome
  finalOutcome:
    | 'COMPLETED'
    | 'SKILL_NOT_FOUND'
    | 'SKILL_DISABLED'
    | 'HASH_EXPECTATION_MISMATCH'
    | 'LIVE_HASH_MISMATCH'
    | 'DISCLAIMER_MISSING'
    | 'AUDIT_OPEN_FAILED'
    | 'SYNTHETIC_BUDGET_EXCEEDED'
    | 'PROHIBITED_BEHAVIOR_ATTEMPTED'
    | 'ERROR'
  prohibitedBehaviorAttempts: string[]
  syntheticToolCallCount: number
  syntheticBudgetLimit: number
}

// ── Path resolution ───────────────────────────────────────────────────────────

export function getSkillInvocationAuditPath(): string {
  return path.join(getPowerplantHome(), 'state', SKILL_INVOCATION_AUDIT_FILENAME)
}

// ── Append-only write ─────────────────────────────────────────────────────────

/**
 * Persist an invocation audit record to the append-only JSONL file.
 *
 * Uses appendFileSync (not async) to guarantee the write completes before
 * the function returns, ensuring audit durability before envelope exposure.
 *
 * Throws on filesystem error — caller must treat this as AUDIT_OPEN_FAILED.
 *
 * Returns the path to the audit file so callers can include it in their result.
 */
export function openInvocationAuditRecord(record: SkillInvocationRecord): string {
  const auditPath = getSkillInvocationAuditPath()
  fs.mkdirSync(path.dirname(auditPath), { recursive: true })
  // appendFileSync guarantees write completes and is acknowledged before returning
  fs.appendFileSync(auditPath, JSON.stringify(record) + '\n', 'utf-8')
  return auditPath
}
