/**
 * Bounded, safe extraction of actionable diagnostics from check runner output.
 *
 * Safety invariants:
 *   - No absolute host paths in any returned field.
 *   - No node_modules/** contents or .vite/** cache paths.
 *   - All output is bounded (capped) before returning.
 *   - Source: stdoutTail/stderrTail only — already bounded upstream by tailOutput().
 *
 * Used by BOTH the live project_run_check broker handler and powerplant verify
 * so the agent and operator see identical diagnostics from the same code path.
 */

const MAX_FAILING_TESTS = 3
const MAX_TS_ERRORS = 5
const MAX_FIELD_CHARS = 300

export interface TestFailureEntry {
  file?: string
  name?: string
  message?: string
  expected?: string
  received?: string
  location?: string
}

export interface TypescriptErrorEntry {
  file: string
  line: number
  col: number
  code: string
  message: string
}

export interface CheckDiagnostics {
  runnerKind: 'test' | 'typecheck'
  verdict: string
  exitCode: number | null
  failingTests?: TestFailureEntry[]
  typescriptErrors?: TypescriptErrorEntry[]
  truncated: boolean
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function stripAbsolutePath(raw: string): string {
  const anchor = raw.match(/(?:\/src\/|\/tests?\/|\/lib\/|\/dist\/)/)
  if (anchor && anchor.index !== undefined) {
    return raw.slice(anchor.index + 1)
  }
  return raw.replace(/^\/(?:[^/]+\/)+/, '')
}

function cap(s: string): string {
  if (s.length <= MAX_FIELD_CHARS) return s
  return s.slice(0, MAX_FIELD_CHARS) + '…'
}

function isNodeModulesLine(line: string): boolean {
  return /node_modules/.test(line)
}

// ── Vitest output parser ───────────────────────────────────────────────────────
//
// Handles Vitest default (non-TAP) reporter and TAP reporter output.
//
// Vitest default CI patterns:
//   " FAIL  src/foo.test.ts > Suite > test name"  — failing entry with file+test
//   "AssertionError: expected false to be true"    — error message
//   "- Expected  - 1" / "+ Received  + 1"          — diff header (skip as value)
//   "- true" / "+ false"                           — diff values
//   " ❯ src/foo.test.ts:25:5"                      — location
//
// Vitest emits the FAIL line TWICE per failure (once as header, once before detail).
// The second occurrence with the same file+name is treated as a continuation.

function extractTestFailures(stdout: string): { failures: TestFailureEntry[]; truncated: boolean } {
  const lines = stdout.split('\n')
  const failures: TestFailureEntry[] = []
  let truncated = false

  const failLineRe = /^\s+FAIL\s{2,}(.+?)\s*>\s+(.+)$/
  const failFileOnlyRe = /^\s+FAIL\s{2,}(\S.+)$/

  let current: TestFailureEntry | null = null
  let inDiff = false
  let diffExpected: string | null = null
  let diffReceived: string | null = null

  for (const line of lines) {
    if (isNodeModulesLine(line)) continue

    const failMatch = line.match(failLineRe)
    if (failMatch) {
      const fullPath = failMatch[1]!.trim()
      const rest = failMatch[2]!.trim()
      const parts = rest.split(' > ')
      const testName = parts[parts.length - 1]!.trim()
      const entryFile = cap(stripAbsolutePath(fullPath))
      const entryName = cap(testName)

      // Deduplicate — Vitest emits the same line before the error details block.
      if (current && current.file === entryFile && current.name === entryName) {
        inDiff = false
        diffExpected = null
        diffReceived = null
        continue
      }

      if (current) {
        if (diffExpected !== null && !current.expected) current.expected = cap(diffExpected)
        if (diffReceived !== null && !current.received) current.received = cap(diffReceived)
        failures.push(current)
        if (failures.length >= MAX_FAILING_TESTS) { truncated = true; break }
      }
      current = { file: entryFile, name: entryName }
      inDiff = false; diffExpected = null; diffReceived = null
      continue
    }

    if (!current) {
      const fileOnlyMatch = line.match(failFileOnlyRe)
      if (fileOnlyMatch) {
        current = { file: cap(stripAbsolutePath(fileOnlyMatch[1]!.trim())) }
        inDiff = false; diffExpected = null; diffReceived = null
        continue
      }
    }

    if (!current) continue

    const errMatch = line.match(/^\s*(AssertionError|Error|TypeError|RangeError|ReferenceError):\s*(.+)$/)
    if (errMatch && !current.message) { current.message = cap(errMatch[2]!.trim()); continue }

    // Diff header lines "- Expected  - N" and "+ Received  + N" — mark inDiff but don't capture as value
    if (/^\s*[-+]\s+(?:Expected|Received)\s+[-+]\s+\d+/.test(line)) { inDiff = true; continue }

    const expLabelMatch = line.match(/^\s+Expected\s*[→:]\s+(.+)$/)
    if (expLabelMatch) { current.expected = cap(expLabelMatch[1]!.trim()); continue }
    const recLabelMatch = line.match(/^\s+Received\s*[→:]\s+(.+)$/)
    if (recLabelMatch) { current.received = cap(recLabelMatch[1]!.trim()); continue }

    if (inDiff) {
      const minusMatch = line.match(/^- (.+)$/)
      if (minusMatch && diffExpected === null) { diffExpected = minusMatch[1]!.trim(); continue }
      const plusMatch = line.match(/^\+ (.+)$/)
      if (plusMatch && diffReceived === null) { diffReceived = plusMatch[1]!.trim(); continue }
    }

    const locMatch = line.match(/(?:❯|at)\s+([\w./\-]+\.(?:ts|js|mjs|cjs)):\d+:\d+/)
    if (locMatch && !current.location && !isNodeModulesLine(locMatch[1]!)) {
      const lineColMatch = line.slice(line.indexOf(locMatch[1]!) + locMatch[1]!.length).match(/:\d+:\d+/)
      if (lineColMatch) {
        current.location = cap(stripAbsolutePath(locMatch[1]!.trim()) + lineColMatch[0])
      }
      continue
    }
  }

  if (current && failures.length < MAX_FAILING_TESTS) {
    if (diffExpected !== null && !current.expected) current.expected = cap(diffExpected)
    if (diffReceived !== null && !current.received) current.received = cap(diffReceived)
    failures.push(current)
  }

  // TAP reporter fallback (if default reporter produced nothing)
  if (failures.length === 0) {
    const tapFailRe = /^not ok \d+ - (.+)$/
    let tapCurrent: TestFailureEntry | null = null
    for (const line of lines) {
      if (isNodeModulesLine(line)) continue
      const tapMatch = line.match(tapFailRe)
      if (tapMatch) {
        if (tapCurrent) { failures.push(tapCurrent); if (failures.length >= MAX_FAILING_TESTS) { truncated = true; break } }
        tapCurrent = { name: cap(tapMatch[1]!.trim()) }; continue
      }
      if (!tapCurrent) continue
      const msgMatch = line.match(/^\s+message:\s*(.+)$/)
      if (msgMatch) { tapCurrent.message = cap(msgMatch[1]!.trim()); continue }
      const expMatch = line.match(/^\s+expected:\s*(.+)$/)
      if (expMatch) { tapCurrent.expected = cap(expMatch[1]!.trim()); continue }
      const actMatch = line.match(/^\s+actual:\s*(.+)$/)
      if (actMatch) { tapCurrent.received = cap(actMatch[1]!.trim()); continue }
      const atMatch = line.match(/^\s+at:\s*(.+)$/)
      if (atMatch && !isNodeModulesLine(atMatch[1]!)) { tapCurrent.location = cap(stripAbsolutePath(atMatch[1]!.trim())); continue }
    }
    if (tapCurrent && failures.length < MAX_FAILING_TESTS) failures.push(tapCurrent)
  }

  return { failures, truncated }
}

// ── TypeScript output parser ───────────────────────────────────────────────────

function extractTsErrors(stdout: string, stderr: string): { errors: TypescriptErrorEntry[]; truncated: boolean } {
  const lines = (stdout + '\n' + stderr).split('\n')
  const errors: TypescriptErrorEntry[] = []
  let truncated = false

  // Format 1: "src/file.ts(42,5): error TS2322: message"
  const fmt1 = /^(.+\.(?:ts|tsx|mts|cts))\((\d+),(\d+)\):\s+error (TS\d+):\s+(.+)$/
  // Format 2: "src/file.ts:42:5 - error TS2322: message"
  const fmt2 = /^(.+\.(?:ts|tsx|mts|cts)):(\d+):(\d+)\s+-\s+error (TS\d+):\s+(.+)$/

  for (const line of lines) {
    if (isNodeModulesLine(line)) continue
    const m = line.match(fmt1) ?? line.match(fmt2)
    if (m) {
      const [, rawFile, ln, col, code, message] = m as [string, string, string, string, string, string]
      errors.push({
        file: cap(stripAbsolutePath(rawFile.trim())),
        line: parseInt(ln, 10),
        col: parseInt(col, 10),
        code: code.trim(),
        message: cap(message.trim()),
      })
      if (errors.length >= MAX_TS_ERRORS) { truncated = true; break }
    }
  }

  return { errors, truncated }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Extract bounded, actionable diagnostics from a completed check run.
 * Operates purely on the already-bounded stdoutTail/stderrTail strings.
 * Never reads files or accesses node_modules or .vite cache paths.
 */
export function extractCheckDiagnostics(
  kind: 'test' | 'typecheck',
  verdict: string,
  exitCode: number | null,
  stdoutTail: string,
  stderrTail: string,
): CheckDiagnostics {
  if (kind === 'test') {
    const { failures, truncated } = extractTestFailures(stdoutTail + '\n' + stderrTail)
    return { runnerKind: 'test', verdict, exitCode, failingTests: failures.length > 0 ? failures : undefined, truncated }
  }
  const { errors, truncated } = extractTsErrors(stdoutTail, stderrTail)
  return { runnerKind: 'typecheck', verdict, exitCode, typescriptErrors: errors.length > 0 ? errors : undefined, truncated }
}

/**
 * Format CheckDiagnostics as a concise human-readable summary for the agent-visible
 * `summary` field in RunCheckResult.
 */
export function formatDiagnosticSummary(diag: CheckDiagnostics): string {
  const header = `${diag.verdict} (exit ${diag.exitCode ?? 'null'})`

  if (diag.runnerKind === 'test' && diag.failingTests && diag.failingTests.length > 0) {
    const lines: string[] = [header, '']
    for (const t of diag.failingTests) {
      if (t.file) lines.push(`  File: ${t.file}`)
      if (t.name) lines.push(`  Test: ${t.name}`)
      if (t.message) lines.push(`  Error: ${t.message}`)
      if (t.expected !== undefined) lines.push(`  Expected: ${t.expected}`)
      if (t.received !== undefined) lines.push(`  Received: ${t.received}`)
      if (t.location) lines.push(`  At: ${t.location}`)
      lines.push('')
    }
    if (diag.truncated) lines.push('  (additional failures truncated)')
    lines.push('Fix the failing test file and call project_run_check again.')
    return lines.join('\n')
  }

  if (diag.runnerKind === 'typecheck' && diag.typescriptErrors && diag.typescriptErrors.length > 0) {
    const lines: string[] = [header, '']
    for (const e of diag.typescriptErrors) lines.push(`  ${e.file}:${e.line}:${e.col} — ${e.code}: ${e.message}`)
    if (diag.truncated) lines.push('  (additional errors truncated)')
    lines.push('')
    lines.push('Fix the TypeScript errors and call project_run_check again.')
    return lines.join('\n')
  }

  return header
}
