// Stage 2A + Stage 2B — Skill Invocation Audit
//
// Append-only JSONL audit trail for promoted-guidance invocations.
// This module is the ONLY write path to skill-invocation-audit.jsonl.
// It does NOT import broker, capsule, project, network, or credential modules.
//
// Stage 2A uses SkillInvocationRecord (single combined record, syntheticScope: true).
// Stage 2B uses two-phase records: SkillInvocationPhaseARecord (pre-session)
// and SkillInvocationPhaseBRecord (post-session terminal evidence), both keyed
// by the same invocationId.

import fs from 'fs'
import path from 'path'
import { getPowerplantHome } from '../config/powerplant-home.js'
import {
  SKILL_INVOCATION_AUDIT_FILENAME,
  SKILL_INVOCATION_PHASE_A,
  SKILL_INVOCATION_PHASE_B,
  SKILL_GUIDED_PILOT_RUNNER_TYPE,
} from '../config/constants.js'
import type { CheckResult } from '../contracts/verification-preflight-report.js'

// ── Shared entry type ─────────────────────────────────────────────────────────

export interface InvokedSkillEntry {
  skillId: string                // skill name from registry
  activeVersion: number          // registry activeVersion at invocation time
  expectedHash: string           // hash the operator declared
  registryHash: string           // hash read from registry immediately before invocation
  liveContentHash: string        // hash recomputed by renderPromptEnvelope from snapshot
  envelopeHash: string           // SHA-256 of the rendered envelope text
  enabledAtInvocation: boolean   // false if skill was disabled (pre-check step 3 would block)
}

// ── Stage 2A: single combined record ─────────────────────────────────────────

export interface SkillInvocationRecord {
  // Identity
  invocationId: string
  syntheticScope: boolean        // true for all Stage 2A; false for Stage 2B live-broker

  // Scope classification
  runnerType: 'synthetic'        // Stage 2B uses 'live-sanitized-pilot' in Phase A/B records

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

// ── Stage 2B: Phase A — pre-session record ────────────────────────────────────

export interface SkillInvocationPhaseARecord {
  phase: typeof SKILL_INVOCATION_PHASE_A
  invocationId: string
  invocationTimestamp: string   // ISO 8601 — set before any broker call
  syntheticScope: false
  runnerType: typeof SKILL_GUIDED_PILOT_RUNNER_TYPE
  invokedSkills: InvokedSkillEntry[]
  runId: string
  sanitizedProjectId: string
  operatorSelectedSkills: true
}

// ── Stage 2B: Phase B — terminal completion record ───────────────────────────

export type LiveRunTerminationReason =
  | 'COMPLETED'
  | 'FAILED_INCOMPLETE_AGENT_RUN'
  | 'FAILED_TOOL_BUDGET_EXHAUSTED'
  | 'BROKER_SESSION_EXCEPTION'

export type LiveRunFinalOutcome =
  | 'COMPLETED'
  | 'FAILED_INCOMPLETE_AGENT_RUN'
  | 'FAILED_TOOL_BUDGET_EXHAUSTED'
  | 'BROKER_SESSION_EXCEPTION'
  | 'FAILED_INVOCATION_AUDIT_PERSISTENCE'

export interface CapsuleIsolationIndicators {
  executorNetworkDisabled: true
  noCredentialsPassedToExecutor: true
}

export interface SkillInvocationPhaseBRecord {
  phase: typeof SKILL_INVOCATION_PHASE_B
  invocationId: string           // links back to Phase A record
  sessionId: string              // from broker result (Managed Agent session ID)
  projectWriteOccurred: boolean
  checksInvalidatedByWrite: boolean
  checkResults: CheckResult[]
  finalizeAttempted: boolean
  finalizeAccepted: boolean
  terminationReason: LiveRunTerminationReason
  patchEligibleForApplication: boolean
  capsuleIsolationIndicators: CapsuleIsolationIndicators
  sourceTreeUnmodified: boolean
  finalOutcome: LiveRunFinalOutcome
}

// ── Path resolution ───────────────────────────────────────────────────────────

export function getSkillInvocationAuditPath(): string {
  return path.join(getPowerplantHome(), 'state', SKILL_INVOCATION_AUDIT_FILENAME)
}

// ── Stage 2A: append-only write ───────────────────────────────────────────────

/**
 * Persist a Stage 2A synthetic invocation audit record to the append-only JSONL file.
 *
 * Uses appendFileSync to guarantee the write completes before returning.
 * Throws on filesystem error — caller must treat this as AUDIT_OPEN_FAILED.
 * Returns the path to the audit file.
 */
export function openInvocationAuditRecord(record: SkillInvocationRecord): string {
  const auditPath = getSkillInvocationAuditPath()
  fs.mkdirSync(path.dirname(auditPath), { recursive: true })
  // appendFileSync guarantees write completes and is acknowledged before returning
  fs.appendFileSync(auditPath, JSON.stringify(record) + '\n', 'utf-8')
  return auditPath
}

// ── Stage 2B: Phase A write ───────────────────────────────────────────────────

/**
 * Persist a Stage 2B Phase A pre-session record before any broker session starts.
 *
 * Phase A persistence is the last gate before session creation.
 * If this throws, the broker session MUST NOT start.
 * Returns the audit file path so the caller can include it in the run report.
 */
export function appendPhaseARecord(record: SkillInvocationPhaseARecord): string {
  const auditPath = getSkillInvocationAuditPath()
  fs.mkdirSync(path.dirname(auditPath), { recursive: true })
  fs.appendFileSync(auditPath, JSON.stringify(record) + '\n', 'utf-8')
  return auditPath
}

// ── Stage 2B: Phase B write ───────────────────────────────────────────────────

/**
 * Persist a Stage 2B Phase B terminal completion record after every session.
 *
 * Phase B persistence is the last gate before any result is released.
 * If this throws, the caller MUST return FAILED_INVOCATION_AUDIT_PERSISTENCE.
 * No eligible patch, clearance, or success classification may be returned
 * until Phase B persistence succeeds.
 */
export function appendPhaseBRecord(record: SkillInvocationPhaseBRecord): void {
  const auditPath = getSkillInvocationAuditPath()
  fs.mkdirSync(path.dirname(auditPath), { recursive: true })
  fs.appendFileSync(auditPath, JSON.stringify(record) + '\n', 'utf-8')
}
