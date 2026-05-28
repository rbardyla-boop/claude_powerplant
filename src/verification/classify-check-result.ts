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

const SAFE_OUTPUT_TAIL_BYTES = 2048

export function tailOutput(raw: string): string {
  if (raw.length <= SAFE_OUTPUT_TAIL_BYTES) return raw
  return '…' + raw.slice(raw.length - SAFE_OUTPUT_TAIL_BYTES)
}

export interface CheckClassificationInput {
  spawnError: Error | null
  exitCode: number | null
  stdout: string
  stderr: string
}

export function classifyCheckResult(input: CheckClassificationInput): CheckVerdict {
  const { spawnError, exitCode, stdout, stderr } = input

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

  if (exitCode === 0) return 'PASS'

  return 'FAIL_CHECK'
}
