import { describe, it, expect } from 'vitest'
import { classifyCheckResult, tailOutput } from '../src/verification/classify-check-result.js'

// ── classifyCheckResult ───────────────────────────────────────────────────────

describe('classifyCheckResult: PASS', () => {
  it('returns PASS for exit code 0', () => {
    expect(classifyCheckResult({
      spawnError: null, exitCode: 0, stdout: '5 tests passed', stderr: '',
    })).toBe('PASS')
  })

  it('returns PASS for exit code 0 even with output', () => {
    expect(classifyCheckResult({
      spawnError: null, exitCode: 0,
      stdout: 'all checks passed\nno errors found',
      stderr: 'some warnings',
    })).toBe('PASS')
  })
})

describe('classifyCheckResult: FAIL_CHECK', () => {
  it('returns FAIL_CHECK for exit code 1 with test failure output', () => {
    expect(classifyCheckResult({
      spawnError: null, exitCode: 1,
      stdout: '✗ 3 tests failed\nExpected: 1\nReceived: 2',
      stderr: '',
    })).toBe('FAIL_CHECK')
  })

  it('returns FAIL_CHECK for exit code 2', () => {
    expect(classifyCheckResult({
      spawnError: null, exitCode: 2,
      stdout: 'TypeScript error TS2322: Type error',
      stderr: '',
    })).toBe('FAIL_CHECK')
  })

  it('returns FAIL_CHECK for non-zero exit with generic error', () => {
    expect(classifyCheckResult({
      spawnError: null, exitCode: 1,
      stdout: 'assertion failed at line 42',
      stderr: 'npm ERR! Test failed. See above.',
    })).toBe('FAIL_CHECK')
  })

  it('does not misclassify test output containing "not found" as BLOCKED', () => {
    // "not found" appears in a test assertion, not in a tool-missing message
    expect(classifyCheckResult({
      spawnError: null, exitCode: 1,
      stdout: 'Expected element with id "submit-btn" to be found in the DOM',
      stderr: '',
    })).toBe('FAIL_CHECK')
  })
})

describe('classifyCheckResult: BLOCKED_MISSING_TOOLING', () => {
  it('returns BLOCKED_MISSING_TOOLING for exit code 127', () => {
    expect(classifyCheckResult({
      spawnError: null, exitCode: 127, stdout: '', stderr: 'sh: 1: vitest: not found',
    })).toBe('BLOCKED_MISSING_TOOLING')
  })

  it('returns BLOCKED_MISSING_TOOLING for ENOENT spawnError', () => {
    const err = Object.assign(new Error('spawn npm ENOENT'), { code: 'ENOENT' })
    expect(classifyCheckResult({
      spawnError: err, exitCode: null, stdout: '', stderr: '',
    })).toBe('BLOCKED_MISSING_TOOLING')
  })

  it('returns BLOCKED_MISSING_TOOLING for "command not found" in stderr', () => {
    expect(classifyCheckResult({
      spawnError: null, exitCode: 1, stdout: '',
      stderr: 'bash: vitest: command not found',
    })).toBe('BLOCKED_MISSING_TOOLING')
  })

  it('returns BLOCKED_MISSING_TOOLING for ": not found" pattern (dash shell style)', () => {
    expect(classifyCheckResult({
      spawnError: null, exitCode: 127, stdout: '',
      stderr: 'tsc: not found',
    })).toBe('BLOCKED_MISSING_TOOLING')
  })

  it('returns BLOCKED_MISSING_TOOLING for Cannot find module vitest', () => {
    expect(classifyCheckResult({
      spawnError: null, exitCode: 1, stdout: '',
      stderr: "Error: Cannot find module 'vitest'",
    })).toBe('BLOCKED_MISSING_TOOLING')
  })

  it('returns BLOCKED_MISSING_TOOLING for Cannot find module typescript', () => {
    expect(classifyCheckResult({
      spawnError: null, exitCode: 1, stdout: '',
      stderr: "Error: Cannot find module 'typescript'",
    })).toBe('BLOCKED_MISSING_TOOLING')
  })

  it('returns BLOCKED_MISSING_TOOLING for @vitest scope module', () => {
    expect(classifyCheckResult({
      spawnError: null, exitCode: 1, stdout: '',
      stderr: "Cannot find module '@vitest/runner'",
    })).toBe('BLOCKED_MISSING_TOOLING')
  })

  it('returns BLOCKED_MISSING_TOOLING for MODULE_NOT_FOUND in stderr', () => {
    expect(classifyCheckResult({
      spawnError: null, exitCode: 1, stdout: '',
      stderr: "code: 'MODULE_NOT_FOUND'",
    })).toBe('BLOCKED_MISSING_TOOLING')
  })

  it('returns BLOCKED_MISSING_TOOLING for npm ERR! missing script', () => {
    expect(classifyCheckResult({
      spawnError: null, exitCode: 1, stdout: '',
      stderr: "npm ERR! missing script: test",
    })).toBe('BLOCKED_MISSING_TOOLING')
  })

  it('prioritises ENOENT over exit code when both indicate missing tooling', () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    expect(classifyCheckResult({
      spawnError: err, exitCode: null, stdout: '', stderr: '',
    })).toBe('BLOCKED_MISSING_TOOLING')
  })
})

describe('classifyCheckResult: FAIL_BOUNDARY', () => {
  it('returns FAIL_BOUNDARY for null exit code and null error', () => {
    expect(classifyCheckResult({
      spawnError: null, exitCode: null, stdout: '', stderr: '',
    })).toBe('FAIL_BOUNDARY')
  })

  it('returns FAIL_BOUNDARY for null exit code with non-ENOENT error (e.g. timeout)', () => {
    const err = Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })
    expect(classifyCheckResult({
      spawnError: err, exitCode: null, stdout: '', stderr: '',
    })).toBe('FAIL_BOUNDARY')
  })
})

// ── tailOutput ───────────────────────────────────────────────────────────────

describe('tailOutput', () => {
  it('returns the string unchanged when it fits', () => {
    expect(tailOutput('hello')).toBe('hello')
  })

  it('truncates and prepends ellipsis when output exceeds 2048 bytes', () => {
    const long = 'x'.repeat(3000)
    const result = tailOutput(long)
    expect(result.startsWith('…')).toBe(true)
    expect(result.length).toBeLessThanOrEqual(2049) // '…' + 2048
  })

  it('returns empty string unchanged', () => {
    expect(tailOutput('')).toBe('')
  })
})
