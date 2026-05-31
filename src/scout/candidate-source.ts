import type { StackId } from '../projects/detect-stack.js'
import type { LoadedProjectContract } from '../projects/load-project-contract.js'
import type { ProposedCandidate, ScoutDomain } from './scout-candidate.js'

// ── ScoutBundle ───────────────────────────────────────────────────────────────
// The sanitized view a CandidateSource is allowed to reason over. This is the
// SAME bundle the agent sees at run time (built from the contract's
// includePaths minus excludePaths) — Scout gets no privileged repo-wide read.
// "No policy, no scout": this bundle only exists because a contract was loaded.
export interface ScoutBundleFile {
  /** Path relative to the sanitized snapshot root. */
  relativePath: string
  /** UTF-8 contents. Binary and oversized files are omitted (see scan.ts). */
  content: string
}

export interface ScoutBundle {
  projectId: string
  stack: StackId
  /** Text files that entered the sanitized snapshot. */
  files: ScoutBundleFile[]
  /** Read/write ceilings and declared checks — the bounds every candidate must respect. */
  contract: LoadedProjectContract
}

// ── SuppressionNote ───────────────────────────────────────────────────────────
// Candidate-shaped evidence a source found but did NOT propose, because the
// contract blocked it (e.g. a test-gap whose test file is outside
// allowedWritePaths). Informational only: aggregated by reason, never a
// candidate, never written to .scout/candidates/, never runnable. This is how
// Scout explains "0 candidates" honestly without weakening the ceiling.
export interface SuppressionNote {
  domain: ScoutDomain
  /** Why it was suppressed, e.g. "outside allowedWritePaths". */
  reason: string
  /** How many findings this note aggregates. */
  count: number
  /** One representative would-be target path (illustrative). */
  example: string
}

// ── DiscoveryResult ───────────────────────────────────────────────────────────
// What a CandidateSource returns: proposed candidates plus any suppressed
// (contract-blocked) findings. Suppressions are kept strictly separate from
// candidates so they can never be promoted or run.
export interface DiscoveryResult {
  candidates: ProposedCandidate[]
  suppressed: SuppressionNote[]
}

// ── CandidateSource ───────────────────────────────────────────────────────────
// A pluggable affordance discoverer. The deterministic source ships now; an
// LLM-backed source can be added later behind this same interface without
// touching the command, the schema, or normalization.
//
// A source PROPOSES candidates (with a self-assessed risk) but never assigns a
// final status — the scan normalizes every proposal against the contract.
export interface CandidateSource {
  /** Stable identifier for provenance (e.g. 'deterministic-v1'). */
  readonly id: string
  /** Discover affordances in the sanitized bundle. Must not mutate anything. */
  discover(bundle: ScoutBundle): DiscoveryResult
}
