import { describe, it, expect } from 'vitest'
import { deriveTaskFromCandidate, CandidateScopeError } from '../src/scout/derive-task.js'
import type { ScoutCandidate } from '../src/scout/scout-candidate.js'
import type { LoadedProjectContract } from '../src/projects/load-project-contract.js'

const CONTRACT = {
  allowedWritePaths: ['src/**', 'tests/**'],
  allowedChecks: { test: { command: 'npm test', required: true } },
} as unknown as LoadedProjectContract

function candidate(overrides: Partial<ScoutCandidate> = {}): ScoutCandidate {
  return {
    id: 'scout-001',
    title: 'Add a --version command',
    domain: 'cli-affordance',
    whyItMatters: 'No way to confirm the running build.',
    repoEvidence: ['no --version handler'],
    risk: 'LOW',
    status: 'RECOMMENDED',
    expectedFiles: ['src/cli/powerplant.ts'],
    verification: ['test'],
    nonGoals: ['do not change command semantics'],
    notes: [],
    ...overrides,
  }
}

describe('deriveTaskFromCandidate', () => {
  it('produces a scoped task referencing files and non-goals', () => {
    const { task, scope } = deriveTaskFromCandidate(candidate(), CONTRACT)
    expect(task).toContain('Add a --version command')
    expect(task).toContain('src/cli/powerplant.ts')
    expect(task).toContain('do not change command semantics')
    expect(scope.candidateId).toBe('scout-001')
    expect(scope.expectedFiles).toEqual(['src/cli/powerplant.ts'])
  })

  it('fails closed when a file is outside the write ceiling (does NOT widen it)', () => {
    expect(() => deriveTaskFromCandidate(candidate({ expectedFiles: ['docs/x.md'] }), CONTRACT))
      .toThrow(CandidateScopeError)
  })

  it('fails closed when a check is not declared in the contract', () => {
    expect(() => deriveTaskFromCandidate(candidate({ verification: ['lint'] }), CONTRACT))
      .toThrow(CandidateScopeError)
  })

  it('refuses to run a REJECT candidate', () => {
    expect(() => deriveTaskFromCandidate(candidate({ status: 'REJECT' }), CONTRACT))
      .toThrow(/REJECT/)
  })

  it('re-enforces the ceiling even when a hand-edited file claims RECOMMENDED', () => {
    // Untrusted candidate: status says RECOMMENDED but it names a forbidden path.
    const tampered = candidate({ status: 'RECOMMENDED', expectedFiles: ['.env'] })
    expect(() => deriveTaskFromCandidate(tampered, CONTRACT)).toThrow(CandidateScopeError)
  })
})
