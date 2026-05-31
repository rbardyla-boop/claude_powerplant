import { describe, it, expect } from 'vitest'
import {
  ProposedCandidateSchema,
  normalizeCandidate,
  filesOutsideWriteCeiling,
  checksNotDeclared,
  checkCommandCoversPath,
  classifyVerificationCoverage,
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

describe('checkCommandCoversPath', () => {
  const cases: Array<[string, string, boolean]> = [
    ['python3 -m compileall -q .', 'tests/test_x.py', true],
    ['python3 -m py_compile main.py orchestrator.py', 'tests/test_x.py', false],
    ['python3 -m py_compile main.py tests/test_x.py', 'tests/test_x.py', true],
    ['grep typecheck package.json', 'src/engine/tests/foo.test.ts', false],
    ['python3 -m pytest', 'tests/test_x.py', true],
    ['npm run typecheck', 'src/engine/tests/foo.test.ts', true],
    ['echo ok', 'tests/test_x.py', false],
  ]
  it.each(cases)('%s vs %s -> %s', (cmd, path, expected) => {
    expect(checkCommandCoversPath(cmd, path)).toBe(expected)
  })
})

describe('classifyVerificationCoverage', () => {
  it('strong: Screenpipe required compileall covers the generated Python test', () => {
    const cov = classifyVerificationCoverage(
      ['scripts-syntax'], ['tests/test_ai_provider.py'],
      { 'scripts-syntax': { command: 'python3 -m compileall -q .', required: true } },
    )
    expect(cov.strength).toBe('strong')
  })

  it('weak: poly required py_compile does not cover tests/test_config.py', () => {
    const cov = classifyVerificationCoverage(
      ['syntax-check'], ['tests/test_config.py'],
      { 'syntax-check': { command: 'python3 -m py_compile main.py monitor/exit_monitor.py orchestrator.py', required: true } },
    )
    expect(cov.strength).toBe('weak')
  })

  it('weak: Sinularity required grep does not cover src/engine/tests/*.test.ts', () => {
    const cov = classifyVerificationCoverage(
      ['scripts-present'], ['src/engine/tests/foo.test.ts'],
      { 'scripts-present': { command: 'grep typecheck package.json', required: true } },
    )
    expect(cov.strength).toBe('weak')
  })

  it('advisory-only: selected check is advisory (no required check available)', () => {
    const cov = classifyVerificationCoverage(
      ['tests'], ['tests/test_x.py'],
      { tests: { command: 'python3 -m pytest', required: false } },
    )
    expect(cov.strength).toBe('advisory-only')
  })

  it('normalizeCandidate attaches verificationCoverage (does not change status)', () => {
    const weakContract = {
      allowedWritePaths: ['tests/**'],
      allowedChecks: { 'scripts-present': { command: 'grep x package.json', required: true } },
    }
    const result = normalizeCandidate(
      proposed({ expectedFiles: ['tests/test_foo.py'], verification: ['scripts-present'] }),
      weakContract,
    )
    expect(result.status).toBe('RECOMMENDED') // still recommended — coverage is a signal, not a gate
    expect(result.verificationCoverage!.strength).toBe('weak')
  })
})
