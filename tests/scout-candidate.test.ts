import { describe, it, expect } from 'vitest'
import {
  ProposedCandidateSchema,
  normalizeCandidate,
  filesOutsideWriteCeiling,
  checksNotDeclared,
  type ProposedCandidate,
} from '../src/scout/scout-candidate.js'

const CONTRACT = {
  allowedWritePaths: ['src/**', 'tests/**'],
  allowedChecks: { test: { command: 'npm test', required: true } },
}

function proposed(overrides: Partial<ProposedCandidate> = {}): ProposedCandidate {
  return {
    id: 'scout-001',
    title: 'Add --version command',
    domain: 'cli-affordance',
    whyItMatters: 'CLI has no version affordance.',
    repoEvidence: ['package.json has a version field', 'no --version case in router'],
    risk: 'LOW',
    expectedFiles: ['src/cli/powerplant.ts'],
    verification: ['test'],
    nonGoals: ['do not change command semantics'],
    ...overrides,
  }
}

describe('ProposedCandidateSchema', () => {
  it('accepts a well-formed proposal', () => {
    expect(ProposedCandidateSchema.safeParse(proposed()).success).toBe(true)
  })

  const rejections: Array<[string, Partial<ProposedCandidate>]> = [
    ['empty repoEvidence (no candidate without evidence)', { repoEvidence: [] }],
    ['empty verification (must be verifiable)', { verification: [] }],
    ['empty expectedFiles (must be scope-checkable)', { expectedFiles: [] }],
    ['malformed id', { id: 'feature-1' as ProposedCandidate['id'] }],
    ['out-of-whitelist domain', { domain: 'trading-strategy' as ProposedCandidate['domain'] }],
  ]
  it.each(rejections)('rejects %s', (_label, override) => {
    expect(ProposedCandidateSchema.safeParse(proposed(override)).success).toBe(false)
  })
})

describe('ceiling predicates', () => {
  it('flags files outside allowedWritePaths', () => {
    expect(filesOutsideWriteCeiling(['src/a.ts', 'docs/b.md'], ['src/**'])).toEqual(['docs/b.md'])
    expect(filesOutsideWriteCeiling(['src/a.ts'], ['src/**'])).toEqual([])
  })

  it('flags checks not declared in the contract', () => {
    expect(checksNotDeclared(['test', 'lint'], { test: {} })).toEqual(['lint'])
    expect(checksNotDeclared(['test'], { test: {} })).toEqual([])
  })
})

describe('normalizeCandidate verdict assignment', () => {
  // [label, risk/overrides, expected status]
  const cases: Array<[string, Partial<ProposedCandidate>, string]> = [
    ['low-risk + verifiable + in-ceiling', { risk: 'LOW' }, 'RECOMMENDED'],
    ['medium-risk defers to user (no council yet)', { risk: 'MEDIUM' }, 'NEEDS_USER_DECISION'],
    ['high-risk needs authorization', { risk: 'HIGH' }, 'NEEDS_USER_DECISION'],
    ['source-rejected', { risk: 'REJECT' }, 'REJECT'],
    ['file outside write ceiling', { expectedFiles: ['docs/x.md'] }, 'REJECT'],
    ['undeclared verification check', { verification: ['lint'] }, 'REJECT'],
  ]
  it.each(cases)('%s -> %s', (_label, override, expectedStatus) => {
    const result = normalizeCandidate(proposed(override), CONTRACT)
    expect(result.status).toBe(expectedStatus)
  })

  it('records a reason note for every non-RECOMMENDED verdict', () => {
    expect(normalizeCandidate(proposed({ expectedFiles: ['docs/x.md'] }), CONTRACT).notes.length)
      .toBeGreaterThan(0)
  })

  it('a source cannot self-promote: status is always derived, never copied', () => {
    // Even though the proposal claims LOW risk, an undeclared check forces REJECT.
    const result = normalizeCandidate(proposed({ risk: 'LOW', verification: ['ghost'] }), CONTRACT)
    expect(result.status).toBe('REJECT')
  })
})
