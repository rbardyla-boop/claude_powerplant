/**
 * Bounded, safe extraction of actionable diagnostics from check runner output.
 * No absolute paths, no node_modules content, all output bounded.
 */

import type { RunCheckDiagnostics, TestFailureEntry, TypescriptErrorEntry } from '../contracts/project-tool-contracts.js'

const MAX_FAILING_TESTS = 3
const MAX_TS_ERRORS = 5
const MAX_FIELD_CHARS = 300

function stripAbsolutePath(raw: string): string {
  const anchor = raw.match(/(?:\/src\/|\/tests?\/|\/lib\/|\/dist\/)/)
  if (anchor && anchor.index !== undefined) return raw.slice(anchor.index + 1)
  return raw.replace(/^\/(?:[^/]+\/)+/, '')
}

function cap(s: string): string {
  return s.length <= MAX_FIELD_CHARS ? s : s.slice(0, MAX_FIELD_CHARS) + '…'
}

function isNodeModulesLine(line: string): boolean {
  return /node_modules/.test(line)
}

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
      const entryFile = cap(stripAbsolutePath(failMatch[1]!.trim()))
      const parts = failMatch[2]!.trim().split(' > ')
      const entryName = cap(parts[parts.length - 1]!.trim())
      if (current && current.file === entryFile && current.name === entryName) { inDiff = false; diffExpected = null; diffReceived = null; continue }
      if (current) {
        if (diffExpected !== null && !current.expected) current.expected = cap(diffExpected)
        if (diffReceived !== null && !current.received) current.received = cap(diffReceived)
        failures.push(current)
        if (failures.length >= MAX_FAILING_TESTS) { truncated = true; break }
      }
      current = { file: entryFile, name: entryName }
      inDiff = false; diffExpected = null; diffReceived = null; continue
    }
    if (!current) {
      const m = line.match(failFileOnlyRe)
      if (m) { current = { file: cap(stripAbsolutePath(m[1]!.trim())) }; inDiff = false; diffExpected = null; diffReceived = null; continue }
    }
    if (!current) continue
    const errM = line.match(/^\s*(AssertionError|Error|TypeError|RangeError|ReferenceError):\s*(.+)$/)
    if (errM && !current.message) { current.message = cap(errM[2]!.trim()); continue }
    if (/^\s*[-+]\s+(?:Expected|Received)\s+[-+]\s+\d+/.test(line)) { inDiff = true; continue }
    const expL = line.match(/^\s+Expected\s*[->:]\s+(.+)$/)
    if (expL) { current.expected = cap(expL[1]!.trim()); continue }
    const recL = line.match(/^\s+Received\s*[->:]\s+(.+)$/)
    if (recL) { current.received = cap(recL[1]!.trim()); continue }
    if (inDiff) {
      const mm = line.match(/^- (.+)$/)
      if (mm && diffExpected === null) { diffExpected = mm[1]!.trim(); continue }
      const pm = line.match(/^\+ (.+)$/)
      if (pm && diffReceived === null) { diffReceived = pm[1]!.trim(); continue }
    }
    const locM = line.match(/(?:❯|at)\s+([\w./\-]+\.(?:ts|js|mjs|cjs)):\d+:\d+/)
    if (locM && !current.location && !isNodeModulesLine(locM[1]!)) {
      const lc = line.slice(line.indexOf(locM[1]!) + locM[1]!.length).match(/:\d+:\d+/)
      if (lc) current.location = cap(stripAbsolutePath(locM[1]!.trim()) + lc[0])
      continue
    }
  }
  if (current && failures.length < MAX_FAILING_TESTS) {
    if (diffExpected !== null && !current.expected) current.expected = cap(diffExpected)
    if (diffReceived !== null && !current.received) current.received = cap(diffReceived)
    failures.push(current)
  }
  if (failures.length === 0) {
    const tapRe = /^not ok \d+ - (.+)$/
    let tc: TestFailureEntry | null = null
    for (const line of lines) {
      if (isNodeModulesLine(line)) continue
      const tm = line.match(tapRe)
      if (tm) {
        if (tc) { failures.push(tc); if (failures.length >= MAX_FAILING_TESTS) { truncated = true; break } }
        tc = { name: cap(tm[1]!.trim()) }; continue
      }
      if (!tc) continue
      const msgM = line.match(/^\s+message:\s*(.+)$/); if (msgM) { tc.message = cap(msgM[1]!.trim()); continue }
      const expM = line.match(/^\s+expected:\s*(.+)$/); if (expM) { tc.expected = cap(expM[1]!.trim()); continue }
      const actM = line.match(/^\s+actual:\s*(.+)$/); if (actM) { tc.received = cap(actM[1]!.trim()); continue }
      const atM = line.match(/^\s+at:\s*(.+)$/)
      if (atM && !isNodeModulesLine(atM[1]!)) { tc.location = cap(stripAbsolutePath(atM[1]!.trim())); continue }
    }
    if (tc && failures.length < MAX_FAILING_TESTS) failures.push(tc)
  }
  return { failures, truncated }
}

function extractTsErrors(stdout: string, stderr: string): { errors: TypescriptErrorEntry[]; truncated: boolean } {
  const lines = (stdout + '\n' + stderr).split('\n')
  const errors: TypescriptErrorEntry[] = []
  let truncated = false
  const f1 = /^(.+\.(?:ts|tsx|mts|cts))\((\d+),(\d+)\):\s+error (TS\d+):\s+(.+)$/
  const f2 = /^(.+\.(?:ts|tsx|mts|cts)):(\d+):(\d+)\s+-\s+error (TS\d+):\s+(.+)$/
  for (const line of lines) {
    if (isNodeModulesLine(line)) continue
    const m = line.match(f1) ?? line.match(f2)
    if (m) {
      const [, rawFile, ln, col, code, message] = m as [string, string, string, string, string, string]
      errors.push({ file: cap(stripAbsolutePath(rawFile.trim())), line: parseInt(ln, 10), col: parseInt(col, 10), code: code.trim(), message: cap(message.trim()) })
      if (errors.length >= MAX_TS_ERRORS) { truncated = true; break }
    }
  }
  return { errors, truncated }
}

export function extractCheckDiagnostics(kind: 'test' | 'typecheck', verdict: string, exitCode: number | null, stdoutTail: string, stderrTail: string): RunCheckDiagnostics {
  if (kind === 'test') {
    const { failures, truncated } = extractTestFailures(stdoutTail + '\n' + stderrTail)
    return { runnerKind: 'test', verdict, exitCode, failingTests: failures.length > 0 ? failures : undefined, truncated }
  }
  const { errors, truncated } = extractTsErrors(stdoutTail, stderrTail)
  return { runnerKind: 'typecheck', verdict, exitCode, typescriptErrors: errors.length > 0 ? errors : undefined, truncated }
}

export function formatDiagnosticSummary(diag: RunCheckDiagnostics): string {
  const header = `${diag.verdict} (exit ${diag.exitCode ?? 'null'})`
  if (diag.runnerKind === 'test' && diag.failingTests && diag.failingTests.length > 0) {
    const lines = [header, '']
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
    const lines = [header, '']
    for (const e of diag.typescriptErrors) lines.push(`  ${e.file}:${e.line}:${e.col} — ${e.code}: ${e.message}`)
    if (diag.truncated) lines.push('  (additional errors truncated)')
    lines.push('')
    lines.push('Fix the TypeScript errors and call project_run_check again.')
    return lines.join('\n')
  }
  return header
}
