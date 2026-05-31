import { z } from 'zod'
import { matchesGlob } from '../projects/build-sanitized-workspace.js'
import type { LoadedProjectContract } from '../projects/load-project-contract.js'

// ── Whitelisted affordance domains ────────────────────────────────────────────
// Scout finds repo affordances, never product strategy. Anything outside this
// set is structurally impossible to emit — the schema rejects it. This is the
// hard cap that prevents Scout from becoming a roadmap generator.
export const SCOUT_DOMAINS = [
  'cli-affordance',
  'test-gap',
  'config-validation',
  'error-message',
  'docs-mismatch',
  'policy-exclusion',
  'verification-contract',
  'artifact-safety',
  'developer-workflow',
] as const
export type ScoutDomain = (typeof SCOUT_DOMAINS)[number]

export const SCOUT_RISKS = ['LOW', 'MEDIUM', 'HIGH', 'REJECT'] as const
export type ScoutRisk = (typeof SCOUT_RISKS)[number]

export const SCOUT_STATUSES = ['RECOMMENDED', 'DEFER', 'REJECT', 'NEEDS_USER_DECISION'] as const
export type ScoutStatus = (typeof SCOUT_STATUSES)[number]

// ── ProposedCandidate ─────────────────────────────────────────────────────────
// What a CandidateSource emits. A source proposes a self-assessed `risk` but
// never a `status` — the verdict is assigned by normalization against the
// project contract. Sources cannot self-certify "RECOMMENDED".
export const ProposedCandidateSchema = z.object({
  id: z.string().regex(/^scout-\d{3,}$/, "id must look like 'scout-001'"),
  title: z.string().min(1).max(120),
  domain: z.enum(SCOUT_DOMAINS),
  whyItMatters: z.string().min(1),
  // Evidence-bound: a candidate with no repo evidence cannot exist.
  repoEvidence: z.array(z.string().min(1)).min(1),
  risk: z.enum(SCOUT_RISKS),
  // Files the patch is expected to touch. Must be non-empty so scope-drift is checkable.
  expectedFiles: z.array(z.string().min(1)).min(1),
  // Named check IDs that verify the change. Must be non-empty so unverifiable
  // candidates cannot be proposed.
  verification: z.array(z.string().min(1)).min(1),
  nonGoals: z.array(z.string()),
})
export type ProposedCandidate = z.infer<typeof ProposedCandidateSchema>

// ── ScoutCandidate ──────────────────────────────────────────────────────────
// A normalized candidate: status assigned, notes recording why. This is the
// artifact written to .scout/candidates.json and consumed by `run --candidate`.
export const ScoutCandidateSchema = ProposedCandidateSchema.extend({
  status: z.enum(SCOUT_STATUSES),
  // Human-readable reasons the verdict was assigned (e.g. why it was rejected).
  notes: z.array(z.string()),
})
export type ScoutCandidate = z.infer<typeof ScoutCandidateSchema>

// ── Ceiling predicates (shared with run --candidate) ──────────────────────────

/** Files (relative paths) NOT covered by any allowedWritePaths glob. */
export function filesOutsideWriteCeiling(
  expectedFiles: readonly string[],
  allowedWritePaths: readonly string[],
): string[] {
  return expectedFiles.filter(
    file => !allowedWritePaths.some(glob => matchesGlob(file, glob)),
  )
}

/** Check IDs NOT declared in the contract's allowedChecks. */
export function checksNotDeclared(
  verification: readonly string[],
  allowedChecks: Readonly<Record<string, unknown>>,
): string[] {
  return verification.filter(checkId => !(checkId in allowedChecks))
}

// ── Normalization (the enforcement point) ─────────────────────────────────────
// A candidate's verdict is bounded by repo evidence and the contract. No
// candidate is RECOMMENDED unless it is low-risk, verifiable with declared
// checks, and stays inside the write ceiling. This is what keeps Scout's output
// honest: a source cannot promote its own idea.
export function normalizeCandidate(
  proposed: ProposedCandidate,
  contract: Pick<LoadedProjectContract, 'allowedWritePaths' | 'allowedChecks'>,
): ScoutCandidate {
  const notes: string[] = []

  const outsideCeiling = filesOutsideWriteCeiling(proposed.expectedFiles, contract.allowedWritePaths)
  const undeclaredChecks = checksNotDeclared(proposed.verification, contract.allowedChecks)

  let status: ScoutStatus
  if (proposed.risk === 'REJECT') {
    status = 'REJECT'
    notes.push('Source assessed this affordance as out of scope for Scout.')
  } else if (outsideCeiling.length > 0) {
    // Cannot be built safely — it names files the contract forbids writing.
    status = 'REJECT'
    notes.push(
      `Expected files outside allowedWritePaths (cannot be patched safely): ${outsideCeiling.join(', ')}`,
    )
  } else if (undeclaredChecks.length > 0) {
    // If Powerplant cannot verify it, it should not build it.
    status = 'REJECT'
    notes.push(
      `Verification references checks not declared in VERIFY.yaml: ${undeclaredChecks.join(', ')}`,
    )
  } else if (proposed.risk === 'HIGH') {
    status = 'NEEDS_USER_DECISION'
    notes.push('High-risk affordance — requires explicit user authorization before a run.')
  } else if (proposed.risk === 'MEDIUM') {
    // Medium-risk candidates need the council, which is not yet wired. Until
    // then a human decides. (See Scout Mode roadmap: council slice.)
    status = 'NEEDS_USER_DECISION'
    notes.push('Medium-risk affordance — council review pending; user decides.')
  } else {
    status = 'RECOMMENDED'
  }

  return { ...proposed, status, notes }
}
