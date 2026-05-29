#!/usr/bin/env node
// Stage 2B P0-A operator-task oracle for the summarizeChecks acceptance task.
//
// This file is the source-controlled oracle artifact. It must be:
//   - Outside every Stage 2B agent allowed-write path
//   - Hash-locked before any acceptance session begins (see oracle-bundle.ts)
//   - Independent of skill guidance
//
// Task spec: summarizeChecks-v1
//
// Usage: node operator-task-oracle.mjs <workspacePath> <outputPath>
//
// <workspacePath>  Absolute path to the workspace directory under evaluation.
//                  Must contain src/status.js and package.json.
// <outputPath>     Absolute path where the oracle writes its advisory JSON result.
//
// Trusted result channel (P0-E):
//   Oracle writes ORACLE_TRUSTED_RESULT:<json> to stdout using function references
//   saved BEFORE candidate code is imported. This prevents monkey-patching of
//   process.exit or process.stdout.write from affecting result integrity.
//   The parent evaluator uses stdout as the primary PASS/FAIL source; the output
//   file at <outputPath> is advisory only.
//
// Result JSON written to stdout (primary) and <outputPath> (advisory):
//   { status: 'PASS' | 'FAIL' | 'ERROR', testVectors: number, failures: Failure[] }

import path from 'path'
import { writeFileSync, existsSync } from 'fs'
import { pathToFileURL } from 'url'

// ── Save original process functions BEFORE any candidate code runs ────────────
// These references cannot be intercepted by candidate monkey-patching of
// process.exit, process.stdout.write, or Object.defineProperty tricks.
// They are used exclusively for trusted result emission.
const __originalExit = process.exit.bind(process)
const __originalStdoutWrite = process.stdout.write.bind(process.stdout)

const [, , workspacePath, outputPath] = process.argv

function writeResult(result) {
  // Primary trusted channel: stdout sentinel using saved reference.
  // Oracle always writes this LAST, after all candidate code completes.
  // The parent evaluator reads stdout for the authoritative PASS/FAIL verdict.
  __originalStdoutWrite(`ORACLE_TRUSTED_RESULT:${JSON.stringify(result)}\n`)
  // Advisory secondary channel: output file (not used by parent for trust).
  if (outputPath) {
    try { writeFileSync(outputPath, JSON.stringify(result, null, 2)) } catch { /* advisory */ }
  }
}

function exitProcess(code) {
  // Use saved reference to bypass any candidate override of process.exit.
  __originalExit(code)
}

if (!workspacePath || !outputPath) {
  writeResult({ status: 'ERROR', error: 'Usage: node operator-task-oracle.mjs <workspacePath> <outputPath>', testVectors: 0, failures: [] })
  exitProcess(1)
}

const statusPath = path.resolve(workspacePath, 'src', 'status.js')

if (!existsSync(statusPath)) {
  writeResult({ status: 'FAIL', reason: `src/status.js not found at ${statusPath}`, testVectors: 0, failures: [] })
  exitProcess(0)
}

let summarizeChecks
try {
  const mod = await import(pathToFileURL(statusPath).href)
  summarizeChecks = mod.summarizeChecks
} catch (err) {
  writeResult({ status: 'FAIL', reason: `Failed to import src/status.js: ${String(err)}`, testVectors: 0, failures: [] })
  exitProcess(0)
}

if (typeof summarizeChecks !== 'function') {
  writeResult({ status: 'FAIL', reason: 'summarizeChecks is not exported as a function from src/status.js', testVectors: 0, failures: [] })
  exitProcess(0)
}

const failures = []

// TV1: empty array → { total:0, passing:0, failing:0, status:'healthy' }
try {
  const r = summarizeChecks([])
  if (r?.total !== 0 || r?.passing !== 0 || r?.failing !== 0 || r?.status !== 'healthy') {
    failures.push({ tv: 'TV1-empty-array', expected: { total: 0, passing: 0, failing: 0, status: 'healthy' }, got: r })
  }
} catch (e) {
  failures.push({ tv: 'TV1-empty-array', error: String(e) })
}

// TV2: all passing → status 'healthy', counts correct
try {
  const r = summarizeChecks([{ name: 'a', passed: true }, { name: 'b', passed: true }])
  if (r?.total !== 2 || r?.passing !== 2 || r?.failing !== 0 || r?.status !== 'healthy') {
    failures.push({ tv: 'TV2-all-passing', expected: { total: 2, passing: 2, failing: 0, status: 'healthy' }, got: r })
  }
} catch (e) {
  failures.push({ tv: 'TV2-all-passing', error: String(e) })
}

// TV3: mixed → status 'degraded', counts correct
try {
  const r = summarizeChecks([{ name: 'a', passed: true }, { name: 'b', passed: false }])
  if (r?.total !== 2 || r?.passing !== 1 || r?.failing !== 1 || r?.status !== 'degraded') {
    failures.push({ tv: 'TV3-mixed', expected: { total: 2, passing: 1, failing: 1, status: 'degraded' }, got: r })
  }
} catch (e) {
  failures.push({ tv: 'TV3-mixed', error: String(e) })
}

// TV4: non-array input → must throw
let nonArrayThrew = false
try {
  summarizeChecks(null)
} catch {
  nonArrayThrew = true
}
if (!nonArrayThrew) {
  failures.push({ tv: 'TV4-non-array', error: 'Expected throw for non-array input — did not throw' })
}

writeResult({ status: failures.length === 0 ? 'PASS' : 'FAIL', testVectors: 4, failures })
exitProcess(0)
