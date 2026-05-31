import type { StackId } from '../projects/detect-stack.js'
import type { LoadedProjectContract } from '../projects/load-project-contract.js'
import type { ProposedCandidate } from './scout-candidate.js'

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
  discover(bundle: ScoutBundle): ProposedCandidate[]
}
