import { describe, it, expect } from 'vitest'
import {
  classifyCheckResult,
  classifyTestCheckIntegrity,
} from '../src/verification/classify-check-result.js'
import { CheckVerdictSchema } from '../src/contracts/verification-preflight-report.js'

// ── classifyTestCheckIntegrity ────────────────────────────────────────────────

describe('classifyTestCheckIntegrity', () => {
  it('returns FAIL_VERIFICATION_INTEGRITY for stdout containing "# tests 0"', () => {
    const stdout = '# tests 0\n# pass 0\n# fail 0'
    expect(classifyTestCheckIntegrity(stdout)).toBe('FAIL_VERIFICATION_INTEGRITY')
  })

  it('returns PASS for stdout containing "# tests 25"', () => {
    const stdout = '# tests 25\n# pass 25\n# fail 0'
    expect(classifyTestCheckIntegrity(stdout)).toBe('PASS')
  })

  it('returns FAIL_VERIFICATION_INTEGRITY for "No test files found" in stdout', () => {
    const stdout = 'No test files found, exiting with code 0'
    expect(classifyTestCheckIntegrity(stdout)).toBe('FAIL_VERIFICATION_INTEGRITY')
  })

  it('returns PASS for stdout with actual test output and no zero-test patterns', () => {
    const stdout = 'ok 1 - adds correctly\nok 2 - handles edge case\n# tests 2\n# pass 2'
    expect(classifyTestCheckIntegrity(stdout)).toBe('PASS')
  })
})

// ── classifyCheckResult with checkKind: 'test' ────────────────────────────────

describe('classifyCheckResult with checkKind: "test"', () => {
  it('returns FAIL_VERIFICATION_INTEGRITY when exit code is 0 but stdout has "# tests 0"', () => {
    expect(classifyCheckResult({
      spawnError: null,
      exitCode: 0,
      stdout: '# tests 0\n# pass 0',
      stderr: '',
      checkKind: 'test',
    })).toBe('FAIL_VERIFICATION_INTEGRITY')
  })

  it('returns PASS when exit code is 0 and real test count is present', () => {
    expect(classifyCheckResult({
      spawnError: null,
      exitCode: 0,
      stdout: '# tests 25\n# pass 25',
      stderr: '',
      checkKind: 'test',
    })).toBe('PASS')
  })

  it('returns FAIL_CHECK for non-zero exit even with checkKind: "test"', () => {
    expect(classifyCheckResult({
      spawnError: null,
      exitCode: 1,
      stdout: '# tests 5\n# fail 2',
      stderr: '',
      checkKind: 'test',
    })).toBe('FAIL_CHECK')
  })
})

// ── classifyCheckResult backwards compatibility ───────────────────────────────

describe('classifyCheckResult backwards compatibility', () => {
  it('returns PASS for exit code 0 without checkKind (backwards compat)', () => {
    expect(classifyCheckResult({
      spawnError: null,
      exitCode: 0,
      stdout: 'some output',
      stderr: '',
    })).toBe('PASS')
  })

  it('returns PASS for checkKind: "typecheck" with exit code 0 (not subject to test-count check)', () => {
    expect(classifyCheckResult({
      spawnError: null,
      exitCode: 0,
      stdout: '# tests 0',  // this pattern should be ignored for typecheck
      stderr: '',
      checkKind: 'typecheck',
    })).toBe('PASS')
  })
})

// ── BrokerState invalidation logic ───────────────────────────────────────────

describe('BrokerState: checksValidAfterLastWrite lifecycle', () => {
  it('starts false, becomes true after PASS check, becomes false again after write', () => {
    // Simulate broker state
    let checksValidAfterLastWrite = false
    let testCheckPassed = false
    let lastWriteAt: number | null = null
    let lastCheckPassedAt: number | null = null

    // Initial state
    expect(checksValidAfterLastWrite).toBe(false)

    // Simulate handleWriteFile
    const doWrite = () => {
      checksValidAfterLastWrite = false
      lastWriteAt = Date.now()
    }

    // Simulate handleRunCheck with PASS
    const doPassCheck = () => {
      testCheckPassed = true
      checksValidAfterLastWrite = true
      lastCheckPassedAt = Date.now()
    }

    // After a write, still false
    doWrite()
    expect(checksValidAfterLastWrite).toBe(false)
    expect(lastWriteAt).not.toBeNull()

    // After a PASS check, becomes true
    doPassCheck()
    expect(checksValidAfterLastWrite).toBe(true)
    expect(testCheckPassed).toBe(true)
    expect(lastCheckPassedAt).not.toBeNull()

    // After another write, invalidated again
    doWrite()
    expect(checksValidAfterLastWrite).toBe(false)
  })
})

// ── handleFinalize guard: checksValidAfterLastWrite ───────────────────────────

describe('handleFinalize guard', () => {
  it('rejects when checksValidAfterLastWrite is false', () => {
    const state = {
      testCheckPassed: true,
      checksValidAfterLastWrite: false,
      finalizeReceived: false,
    }

    function callFinalize() {
      if (!state.testCheckPassed) {
        throw new Error('project_finalize rejected: test check has not passed')
      }
      if (!state.checksValidAfterLastWrite) {
        throw new Error(
          'project_finalize rejected: all required checks must pass after the most recent write. ' +
          'Call project_run_check again after your last project_write_file.',
        )
      }
      if (state.finalizeReceived) {
        throw new Error('project_finalize already called — duplicate call rejected')
      }
      state.finalizeReceived = true
      return 'finalized'
    }

    expect(() => callFinalize()).toThrow(/all required checks must pass after the most recent write/)
  })

  it('rejects when checksValidAfterLastWrite is false even if testCheckPassed is true (write happened after check)', () => {
    // This simulates: check passed, then write happened, then finalize called
    const state = {
      testCheckPassed: true,
      checksValidAfterLastWrite: false, // write happened after check
      finalizeReceived: false,
    }

    function callFinalize() {
      if (!state.testCheckPassed) {
        throw new Error('project_finalize rejected: test check has not passed')
      }
      if (!state.checksValidAfterLastWrite) {
        throw new Error(
          'project_finalize rejected: all required checks must pass after the most recent write.',
        )
      }
      state.finalizeReceived = true
      return 'finalized'
    }

    // testCheckPassed is true but checksValidAfterLastWrite is false — must reject
    expect(state.testCheckPassed).toBe(true)
    expect(() => callFinalize()).toThrow(/all required checks must pass after the most recent write/)
  })

  it('accepts when both testCheckPassed and checksValidAfterLastWrite are true', () => {
    const state = {
      testCheckPassed: true,
      checksValidAfterLastWrite: true,
      finalizeReceived: false,
    }

    function callFinalize() {
      if (!state.testCheckPassed) {
        throw new Error('project_finalize rejected: test check has not passed')
      }
      if (!state.checksValidAfterLastWrite) {
        throw new Error(
          'project_finalize rejected: all required checks must pass after the most recent write.',
        )
      }
      state.finalizeReceived = true
      return 'finalized'
    }

    expect(() => callFinalize()).not.toThrow()
    expect(state.finalizeReceived).toBe(true)
  })
})

// ── CheckVerdictSchema enum includes FAIL_VERIFICATION_INTEGRITY ──────────────

describe('CheckVerdictSchema enum', () => {
  it('includes FAIL_VERIFICATION_INTEGRITY as a valid verdict', () => {
    const result = CheckVerdictSchema.safeParse('FAIL_VERIFICATION_INTEGRITY')
    expect(result.success).toBe(true)
  })

  it('still includes all original verdicts', () => {
    for (const v of ['PASS', 'FAIL_CHECK', 'BLOCKED_MISSING_TOOLING', 'FAIL_BOUNDARY']) {
      expect(CheckVerdictSchema.safeParse(v).success).toBe(true)
    }
  })

  it('rejects unknown verdict strings', () => {
    expect(CheckVerdictSchema.safeParse('UNKNOWN_VERDICT').success).toBe(false)
  })
})
