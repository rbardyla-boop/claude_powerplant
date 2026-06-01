import fs from 'fs'
import path from 'path'
import { z } from 'zod'
import {
  VerificationCoverageSchema,
  classifyVerificationCoverage,
  type ScoutCandidate,
} from './scout-candidate.js'
import type { LoadedProjectContract } from '../projects/load-project-contract.js'

// ── Feature Trial record (v1.5 Feature Lab traceability) ──────────────────────
// A FEATURE_TRIAL.json links a scout candidate to the run it drives: which
// candidate, which expected files, which non-goals, how meaningfully the change
// is verified, and the write ceiling actually in force. It is EVIDENCE ONLY — a
// superset of CANDIDATE_SCOPE.json carrying the extra context Feature Lab needs
// for candidate → trial → patch → review traceability.
//
// It grants no writes, changes no candidate status, and approves nothing. The
// embedded `claim` says so explicitly so the artifact cannot be mistaken for an
// authorization.

/** The trial record is evidence, never an approval. Embedded verbatim. */
export const FEATURE_TRIAL_CLAIM = 'This is a trial record, not approval.' as const

export const FeatureTrialSchema = z.object({
  candidateId: z.string(),
  candidateTitle: z.string(),
  source: z.string(),
  expectedFiles: z.array(z.string()),
  nonGoals: z.array(z.string()),
  verificationCoverage: VerificationCoverageSchema,
  scopeCeiling: z.array(z.string()),
  createdAt: z.string(),
  claim: z.literal(FEATURE_TRIAL_CLAIM),
})
export type FeatureTrial = z.infer<typeof FeatureTrialSchema>

type TrialContract = Pick<LoadedProjectContract, 'allowedWritePaths' | 'allowedChecks'>

/**
 * Build the evidence-only trial record for a candidate-driven run. Pure: no IO,
 * deterministic given `createdAt`.
 *
 * Authoritative, not asserted: `verificationCoverage` and `scopeCeiling` are
 * (re)derived from the LIVE contract, never copied from the (untrusted) candidate
 * file. A hand-edited or malicious candidate therefore cannot inject a misleading
 * coverage strength or a wider ceiling — the trial reflects what Powerplant
 * itself computed against the contract. `expectedFiles`/`nonGoals` are recorded
 * as proposed (they are already re-checked against the ceiling by
 * deriveTaskFromCandidate before this runs); recording them grants no write
 * access — the record is inert.
 */
export function buildFeatureTrial(
  candidate: ScoutCandidate,
  contract: TrialContract,
  opts: { createdAt?: string; source?: string } = {},
): FeatureTrial {
  return {
    candidateId: candidate.id,
    candidateTitle: candidate.title,
    source: opts.source ?? 'scout',
    expectedFiles: [...candidate.expectedFiles],
    nonGoals: [...candidate.nonGoals],
    // Recompute from the live contract — do NOT trust candidate.verificationCoverage.
    verificationCoverage: classifyVerificationCoverage(
      candidate.verification,
      candidate.expectedFiles,
      contract.allowedChecks,
    ),
    // The ceiling actually in force for this run, taken from the contract.
    scopeCeiling: [...contract.allowedWritePaths],
    createdAt: opts.createdAt ?? new Date().toISOString(),
    claim: FEATURE_TRIAL_CLAIM,
  }
}

/**
 * Write FEATURE_TRIAL.json into a run's artifact directory, beside
 * CANDIDATE_SCOPE.json. Evidence only — does not affect run/approve behavior.
 * Returns the written path.
 */
export function writeFeatureTrialArtifact(patchDir: string, trial: FeatureTrial): string {
  const filePath = path.join(patchDir, 'FEATURE_TRIAL.json')
  fs.writeFileSync(filePath, JSON.stringify(trial, null, 2) + '\n', 'utf-8')
  return filePath
}
