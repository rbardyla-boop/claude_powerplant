import { filesOutsideWriteCeiling, checksNotDeclared, type ScoutCandidate } from './scout-candidate.js'
import type { LoadedProjectContract } from '../projects/load-project-contract.js'

// Persisted into the run's artifact directory so `review` can prove the patch
// stayed inside the candidate's declared scope.
export interface CandidateScope {
  candidateId: string
  title: string
  expectedFiles: string[]
  verification: string[]
}

export class CandidateScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CandidateScopeError'
  }
}

/**
 * Convert a scout candidate into a scoped task string, enforcing the contract
 * ceiling. Fails closed: a candidate can only NARROW intent inside the
 * contract's allowedWritePaths / allowedChecks — it can never widen them.
 *
 * The candidate file is untrusted (a user may hand-edit it), so the ceiling is
 * re-checked here against the live contract rather than trusting the
 * candidate's claimed status.
 */
export function deriveTaskFromCandidate(
  candidate: ScoutCandidate,
  contract: Pick<LoadedProjectContract, 'allowedWritePaths' | 'allowedChecks'>,
): { task: string; scope: CandidateScope } {
  if (candidate.status === 'REJECT') {
    throw new CandidateScopeError(
      `Candidate ${candidate.id} is marked REJECT and cannot be run. ` +
      `Reason: ${candidate.notes.join('; ') || 'rejected by scout'}`,
    )
  }

  const outside = filesOutsideWriteCeiling(candidate.expectedFiles, contract.allowedWritePaths)
  if (outside.length > 0) {
    throw new CandidateScopeError(
      `Candidate ${candidate.id} names files outside allowedWritePaths: ${outside.join(', ')}. ` +
      `Powerplant will not widen the write ceiling for a candidate.`,
    )
  }

  const undeclared = checksNotDeclared(candidate.verification, contract.allowedChecks)
  if (undeclared.length > 0) {
    throw new CandidateScopeError(
      `Candidate ${candidate.id} references checks not declared in VERIFY.yaml: ${undeclared.join(', ')}.`,
    )
  }

  const taskLines = [
    `${candidate.title}.`,
    '',
    candidate.whyItMatters,
    '',
    'Scope — do not exceed:',
    `- Only modify these files: ${candidate.expectedFiles.join(', ')}`,
  ]
  if (candidate.nonGoals.length > 0) {
    taskLines.push('Non-goals:')
    for (const g of candidate.nonGoals) taskLines.push(`- ${g}`)
  }

  return {
    task: taskLines.join('\n'),
    scope: {
      candidateId: candidate.id,
      title: candidate.title,
      expectedFiles: candidate.expectedFiles,
      verification: candidate.verification,
    },
  }
}
