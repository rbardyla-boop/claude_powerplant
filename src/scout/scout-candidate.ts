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

// ── Verification coverage ─────────────────────────────────────────────────────
// Whether the candidate's selected required check actually covers/syntax-checks
// the expected write path — a pre-spend decision signal, NOT a gate. A candidate
// stays RECOMMENDED regardless; this just marks how meaningful its verification is.
//   strong         — a required check covers the expected path
//   weak           — the selected required check does NOT cover the expected path
//   advisory-only  — no required check was available; coverage rests on advisory
export const COVERAGE_STRENGTHS = ['strong', 'weak', 'advisory-only'] as const
export type CoverageStrength = (typeof COVERAGE_STRENGTHS)[number]

export const VerificationCoverageSchema = z.object({
  strength: z.enum(COVERAGE_STRENGTHS),
  reason: z.string(),
})
export type VerificationCoverage = z.infer<typeof VerificationCoverageSchema>

// ── ScoutCandidate ──────────────────────────────────────────────────────────
// A normalized candidate: status assigned, notes recording why. This is the
// artifact written to .scout/candidates.json and consumed by `run --candidate`.
export const ScoutCandidateSchema = ProposedCandidateSchema.extend({
  status: z.enum(SCOUT_STATUSES),
  // Human-readable reasons the verdict was assigned (e.g. why it was rejected).
  notes: z.array(z.string()),
  // Optional so hand-edited / older candidate files still parse.
  verificationCoverage: VerificationCoverageSchema.optional(),
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

// ── Verification coverage classification ──────────────────────────────────────

/**
 * Heuristic: would running `command` plausibly validate/syntax-check `path`?
 * A signal, not a guarantee — it inspects the command shape only.
 */
export function checkCommandCoversPath(command: string, path: string): boolean {
  const cmd = command.toLowerCase()
  // compileall recursively byte-compiles the project tree → covers any source under it.
  if (cmd.includes('compileall')) return true
  // py_compile only compiles the explicitly-named files → covered iff path is named.
  if (cmd.includes('py_compile')) return command.includes(path)
  // Test runners / type checkers discover & check test files broadly.
  if (/\b(pytest|vitest|jest|mocha|tsc)\b/.test(cmd)
    || cmd.includes('npm test') || cmd.includes('npm run test') || cmd.includes('npm run typecheck')) return true
  if (/\bgo test\b/.test(cmd)) return /_test\.go$/.test(path)
  // grep / echo / presence checks cover nothing.
  return false
}

/**
 * Classify how meaningfully a candidate's selected check verifies its expected
 * write path. Decision signal for pre-spend review — never changes status.
 */
export function classifyVerificationCoverage(
  verification: readonly string[],
  expectedFiles: readonly string[],
  allowedChecks: Readonly<Record<string, { command: string; required: boolean }>>,
): VerificationCoverage {
  const checkId = verification[0]
  const path = expectedFiles[0] ?? '(unknown)'
  const check = checkId ? allowedChecks[checkId] : undefined
  if (!check) {
    return { strength: 'weak', reason: `selected check \`${checkId ?? '(none)'}\` is not declared in VERIFY.yaml` }
  }
  if (!check.required) {
    return { strength: 'advisory-only', reason: `selected check \`${checkId}\` is advisory — no required check available for \`${path}\`` }
  }
  if (checkCommandCoversPath(check.command, path)) {
    return { strength: 'strong', reason: `required check \`${checkId}\` covers \`${path}\`` }
  }
  return { strength: 'weak', reason: `selected required check \`${checkId}\` does not appear to cover expected path \`${path}\`` }
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

  const verificationCoverage = classifyVerificationCoverage(
    proposed.verification,
    proposed.expectedFiles,
    contract.allowedChecks,
  )

  return { ...proposed, status, notes, verificationCoverage }
}
