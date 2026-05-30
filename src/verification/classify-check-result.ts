import type { CheckVerdict } from '../contracts/verification-preflight-report.js'

// Patterns in stdout+stderr that indicate the *tool binary or module itself*
// is absent — not a project test failure within a running tool.
const TOOLING_MISSING_PATTERNS: RegExp[] = [
  /command not found/i,
  /: not found/i,
  /Cannot find module 'vitest'/i,
  /Cannot find module 'typescript'/i,
  /Cannot find module '@vitest\//i,
  /\bMODULE_NOT_FOUND\b/,
  /npm ERR! missing script/i,
]

// Patterns that indicate zero tests were discovered in a test run.
// These indicate a misconfigured test runner, not an actual passing suite.
//
// IMPORTANT: Do not add patterns that match per-binary runner lines.
// Rust/cargo emits "running 0 tests" for each crate binary that has no
// tests — this is normal in a workspace and must not trigger the guard.
// Patterns here must match *summary-level* zero-test signals only.
const ZERO_TESTS_PATTERNS: RegExp[] = [
  /^# tests 0\b/m,                    // Node built-in TAP summary
  /\bNo test files found\b/i,          // vitest: no files matched the pattern
  /\bran 0 tests\b/i,                  // pytest summary: "ran 0 tests in 0.00s"
]

const SAFE_OUTPUT_TAIL_BYTES = 2048

export function tailOutput(raw: string): string {
  if (raw.length <= SAFE_OUTPUT_TAIL_BYTES) return raw
  return '…' + raw.slice(raw.length - SAFE_OUTPUT_TAIL_BYTES)
}

/**
 * Inspect the stdout/stderr of a test runner and verify that at least one
 * test was discovered. Returns FAIL_VERIFICATION_INTEGRITY when a zero-test
 * condition is detected — an exit code of 0 with no tests executed is a
 * false-green result that must not be accepted as PASS.
 */
export function classifyTestCheckIntegrity(
  stdout: string,
): 'PASS' | 'FAIL_VERIFICATION_INTEGRITY' {
  for (const pattern of ZERO_TESTS_PATTERNS) {
    if (pattern.test(stdout)) return 'FAIL_VERIFICATION_INTEGRITY'
  }
  return 'PASS'
}

export interface CheckClassificationInput {
  spawnError: Error | null
  exitCode: number | null
  stdout: string
  stderr: string
  /** When 'test', applies the zero-tests integrity guard on top of exit-code classification. */
  checkKind?: 'test' | 'typecheck'
}

export function classifyCheckResult(input: CheckClassificationInput): CheckVerdict {
  const { spawnError, exitCode, stdout, stderr, checkKind } = input

  // The executor binary itself (npm, node, etc.) was not found on PATH.
  if (spawnError !== null) {
    const code = (spawnError as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return 'BLOCKED_MISSING_TOOLING'
  }

  // Exit code 127: the POSIX shell could not locate the named command.
  if (exitCode === 127) return 'BLOCKED_MISSING_TOOLING'

  // Check combined output for tool-missing signals before checking exit code,
  // because npm may exit with 1 rather than 127 when a nested script fails.
  const combined = stdout + '\n' + stderr
  for (const pattern of TOOLING_MISSING_PATTERNS) {
    if (pattern.test(combined)) return 'BLOCKED_MISSING_TOOLING'
  }

  // No exit code and no spawn error: timeout or unexpected termination.
  if (exitCode === null) return 'FAIL_BOUNDARY'

  if (exitCode === 0) {
    // For test checks, verify at least one test was discovered.
    // An exit 0 with 0 tests is a false-green result.
    if (checkKind === 'test') {
      return classifyTestCheckIntegrity(stdout)
    }
    return 'PASS'
  }

  return 'FAIL_CHECK'
}
