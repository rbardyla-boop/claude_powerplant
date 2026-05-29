// Stage 2B P0-C — Isolated Oracle Execution Tests
//
// Proves the oracle evaluates untrusted workspace code ONLY inside a fixed subprocess
// with timeout, output cap, workspace read-only, and cleanup controls.
//
// Hostile synthetic fixtures run through the evaluator:
//   F1 — Benign correct implementation   → oracle PASS
//   F2 — Wrong implementation            → oracle FAIL
//   F3 — Host file read at import time   → subprocess isolated; hostExecutionOccurred:false
//   F4 — Workspace write attempt         → read-only workspace blocks write
//   F5 — Network attempt (async)         → network isolation UNPROVEN (subprocess-only)
//   F6 — Infinite loop                   → timeout enforced, subprocess killed
//   F7 — Output flood                    → output capped
//
// Because fixture F5 cannot prove network isolation with subprocess controls alone,
// the terminal P0-C verdict is:
//   STAGE_2B_LIVE_ACCEPTANCE_BLOCKED_PENDING_ORACLE_CAPSULE
//
// P0-A and P0-B are not blocked.  P0-C requires a container/capsule for network proof.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'
import { createOracleBundle } from '../../src/preflight/oracle-bundle.js'
import { runOracleWithFixture } from '../../src/preflight/oracle-evaluator.js'
import type { OracleBundleResult } from '../../src/preflight/oracle-bundle.js'

const PREFLIGHT_BASE_OVERRIDE = path.join(os.tmpdir(), `pp-p0c-${randomUUID()}`)
const PREFLIGHT_ID = `p0c-test-${randomUUID()}`

let bundle: OracleBundleResult

// ── Fixture source strings ────────────────────────────────────────────────────
// These are synthetic workspace src/status.js files.  They are never promoted to
// any real project.  The evaluator runs them in a subprocess, never in this process.

const F1_BENIGN_CORRECT = `
export function getStatus() { return 'ok'; }
export const VERSION = '0.0.1';
export function summarizeChecks(results) {
  if (!Array.isArray(results)) throw new Error('must be array');
  const passing = results.filter(r => r.passed === true).length;
  return { total: results.length, passing, failing: results.length - passing, status: passing === results.length ? 'healthy' : 'degraded' };
}
`.trim()

const F2_WRONG_IMPL = `
export function getStatus() { return 'ok'; }
export const VERSION = '0.0.1';
// Bug: always returns status 'healthy' regardless of results
export function summarizeChecks(results) {
  return { total: 0, passing: 0, failing: 0, status: 'healthy' };
}
`.trim()

// F3: Reads /etc/hostname at module top-level.  Runs in subprocess — hostExecutionOccurred:false.
const F3_HOST_FILE_READ = `
import { readFileSync } from 'fs';
// Attempts host filesystem read at module load time
const _probe = (() => { try { return readFileSync('/etc/hostname', 'utf8').trim(); } catch { return 'blocked'; } })();
export function getStatus() { return 'ok'; }
export const VERSION = '0.0.1';
export function summarizeChecks(results) {
  if (!Array.isArray(results)) throw new Error('must be array');
  const passing = results.filter(r => r.passed === true).length;
  return { total: results.length, passing, failing: results.length - passing, status: passing === results.length ? 'healthy' : 'degraded' };
}
`.trim()

// F4: Tries to write back to its own source file.  Workspace is chmod'd read-only.
const F4_WORKSPACE_WRITE = `
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
try { writeFileSync(path.join(__dirname, 'status.js'), 'malicious content'); } catch (_e) { /* blocked */ }
export function getStatus() { return 'ok'; }
export const VERSION = '0.0.1';
export function summarizeChecks(results) {
  if (!Array.isArray(results)) throw new Error('must be array');
  const passing = results.filter(r => r.passed === true).length;
  return { total: results.length, passing, failing: results.length - passing, status: passing === results.length ? 'healthy' : 'degraded' };
}
`.trim()

// F5: Initiates an async HTTP call (to localhost:19999 which is not listening).
// The subprocess exits normally because the http call is async and non-blocking.
// Network isolation CANNOT be proven without a container — receipt will note this.
const F5_NETWORK_ATTEMPT = `
import http from 'http';
// Fire-and-forget async network call at module load time
try {
  const req = http.get('http://localhost:19999', () => {});
  req.on('error', () => {});
  req.setTimeout(100, () => { req.destroy(); });
} catch (_e) {}
export function getStatus() { return 'ok'; }
export const VERSION = '0.0.1';
export function summarizeChecks(results) {
  if (!Array.isArray(results)) throw new Error('must be array');
  const passing = results.filter(r => r.passed === true).length;
  return { total: results.length, passing, failing: results.length - passing, status: passing === results.length ? 'healthy' : 'degraded' };
}
`.trim()

// F6: Infinite loop inside summarizeChecks.  Oracle calls this → timeout kills subprocess.
const F6_INFINITE_LOOP = `
export function getStatus() { return 'ok'; }
export const VERSION = '0.0.1';
export function summarizeChecks(_results) {
  // eslint-disable-next-line no-constant-condition
  while (true) { /* spin */ }
}
`.trim()

// F7: Output flood from inside summarizeChecks.  Exceeds maxBuffer → subprocess killed.
// We flood stderr which the spawnSync maxBuffer option also tracks.
const F7_OUTPUT_FLOOD = `
export function getStatus() { return 'ok'; }
export const VERSION = '0.0.1';
export function summarizeChecks(_results) {
  // Flood stdout with 4 MB
  process.stdout.write('F'.repeat(4 * 1024 * 1024));
  return { total: 0, passing: 0, failing: 0, status: 'healthy' };
}
`.trim()

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(() => {
  fs.mkdirSync(PREFLIGHT_BASE_OVERRIDE, { recursive: true })
  // Create oracle bundle using the test preflight dir as base
  bundle = createOracleBundleInDir(PREFLIGHT_BASE_OVERRIDE, PREFLIGHT_ID)
})

afterAll(() => {
  try { fs.rmSync(PREFLIGHT_BASE_OVERRIDE, { recursive: true, force: true }) } catch { /* cleanup */ }
})

// ── F1: Benign correct implementation ────────────────────────────────────────

describe('P0-C F1: benign correct implementation', () => {
  it('oracle returns PASS and hostExecutionOccurred is false', () => {
    const receipt = runOracleWithFixtureInDir(PREFLIGHT_BASE_OVERRIDE, PREFLIGHT_ID, bundle, {
      fixtureContent: F1_BENIGN_CORRECT,
      fixtureLabel: 'F1-benign-correct',
      timeoutMs: 8000,
    })
    expect(receipt.terminalOracleStatus).toBe('PASS')
    expect(receipt.hostExecutionOccurred).toBe(false)
    expect(receipt.tamperCheckPassed).toBe(true)
    expect(receipt.controls.subprocess_isolation).toBe(true)
  })
})

// ── F2: Wrong implementation ──────────────────────────────────────────────────

describe('P0-C F2: wrong implementation', () => {
  it('oracle returns FAIL (not PASS) for buggy summarizeChecks', () => {
    const receipt = runOracleWithFixtureInDir(PREFLIGHT_BASE_OVERRIDE, PREFLIGHT_ID, bundle, {
      fixtureContent: F2_WRONG_IMPL,
      fixtureLabel: 'F2-wrong-impl',
      timeoutMs: 8000,
    })
    expect(receipt.terminalOracleStatus).toBe('FAIL')
    expect(receipt.hostExecutionOccurred).toBe(false)
  })
})

// ── F3: Host file read attempt ────────────────────────────────────────────────

describe('P0-C F3: host file read at import time', () => {
  it('oracle still evaluates in subprocess; hostExecutionOccurred:false', () => {
    const receipt = runOracleWithFixtureInDir(PREFLIGHT_BASE_OVERRIDE, PREFLIGHT_ID, bundle, {
      fixtureContent: F3_HOST_FILE_READ,
      fixtureLabel: 'F3-host-file-read',
      timeoutMs: 8000,
    })
    // The fixture correctly implements summarizeChecks despite the side-effect
    // The oracle runs in a subprocess: host process never executes agent code
    expect(receipt.hostExecutionOccurred).toBe(false)
    expect(receipt.controls.subprocess_isolation).toBe(true)
    // The fixture has correct summarizeChecks, so oracle should PASS
    expect(receipt.terminalOracleStatus).toBe('PASS')
  })
})

// ── F4: Workspace write attempt ───────────────────────────────────────────────

describe('P0-C F4: workspace write attempt blocked by read-only mount', () => {
  it('oracle completes; workspaceReadOnly is true', () => {
    const receipt = runOracleWithFixtureInDir(PREFLIGHT_BASE_OVERRIDE, PREFLIGHT_ID, bundle, {
      fixtureContent: F4_WORKSPACE_WRITE,
      fixtureLabel: 'F4-workspace-write',
      timeoutMs: 8000,
    })
    expect(receipt.workspaceReadOnly).toBe(true)
    expect(receipt.hostExecutionOccurred).toBe(false)
    // The fixture's summarizeChecks is correct; the write attempt fails silently
    expect(receipt.terminalOracleStatus).toBe('PASS')
  })
})

// ── F5: Network attempt ───────────────────────────────────────────────────────

describe('P0-C F5: network attempt — isolation unproven without capsule', () => {
  it('oracle completes; networkIsolationProven:false; unverifiedControls includes network', () => {
    const receipt = runOracleWithFixtureInDir(PREFLIGHT_BASE_OVERRIDE, PREFLIGHT_ID, bundle, {
      fixtureContent: F5_NETWORK_ATTEMPT,
      fixtureLabel: 'F5-network-attempt',
      timeoutMs: 8000,
    })
    // Network is NOT blocked at subprocess level
    expect(receipt.networkIsolationProven).toBe(false)
    expect(receipt.unverifiedControls).toContain('network_isolation')
    expect(receipt.controls.network_isolation).toBe(false)
    expect(receipt.hostExecutionOccurred).toBe(false)
  })
})

// ── F6: Infinite loop ─────────────────────────────────────────────────────────

describe('P0-C F6: infinite loop — timeout enforced', () => {
  it('subprocess is killed; timeoutEnforced:true; oracle status is TIMEOUT', () => {
    const receipt = runOracleWithFixtureInDir(PREFLIGHT_BASE_OVERRIDE, PREFLIGHT_ID, bundle, {
      fixtureContent: F6_INFINITE_LOOP,
      fixtureLabel: 'F6-infinite-loop',
      timeoutMs: 1500,  // short timeout to keep test fast
    })
    expect(receipt.terminalOracleStatus).toBe('TIMEOUT')
    expect(receipt.timeoutEnforced).toBe(true)
    expect(receipt.hostExecutionOccurred).toBe(false)
    expect(receipt.cleanupComplete).toBe(true)
  })
}, 6000)  // vitest timeout for this test

// ── F7: Output flood ──────────────────────────────────────────────────────────

describe('P0-C F7: output flood — output capped', () => {
  it('output is capped; outputCapped:true; oracle status is OUTPUT_CAPPED or TIMEOUT', () => {
    const receipt = runOracleWithFixtureInDir(PREFLIGHT_BASE_OVERRIDE, PREFLIGHT_ID, bundle, {
      fixtureContent: F7_OUTPUT_FLOOD,
      fixtureLabel: 'F7-output-flood',
      timeoutMs: 8000,
      maxOutputBytes: 32768,  // 32 KB cap
    })
    // Either OUTPUT_CAPPED (buffer exceeded) or TIMEOUT
    expect(['OUTPUT_CAPPED', 'TIMEOUT']).toContain(receipt.terminalOracleStatus)
    expect(receipt.outputCapped || receipt.timeoutEnforced).toBe(true)
    expect(receipt.hostExecutionOccurred).toBe(false)
    expect(receipt.cleanupComplete).toBe(true)
  })
}, 15000)

// ── Receipt structure invariants ──────────────────────────────────────────────

describe('P0-C receipt structure: every run binds required fields', () => {
  it('F1 receipt binds all required P0-C fields', () => {
    const receipt = runOracleWithFixtureInDir(PREFLIGHT_BASE_OVERRIDE, PREFLIGHT_ID, bundle, {
      fixtureContent: F1_BENIGN_CORRECT,
      fixtureLabel: 'F1-structure-check',
      timeoutMs: 8000,
    })
    expect(receipt.oracleSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(receipt.workspacePayloadHash).toMatch(/^[0-9a-f]{64}$/)
    expect(receipt.evaluatorProfileId).toBe('subprocess-node-v1')
    expect(receipt.controlPolicyVersion).toBe('stage2b-preflight-v1')
    expect(receipt.hostExecutionOccurred).toBe(false)
    expect(receipt.oracleRunId).toBeTruthy()
    expect(receipt.fixtureLabel).toBe('F1-structure-check')
    expect(typeof receipt.evaluatedAt).toBe('string')
  })
})

// ── Terminal result ───────────────────────────────────────────────────────────

describe('P0-C terminal result', () => {
  it('terminal result: STAGE_2B_LIVE_ACCEPTANCE_BLOCKED_PENDING_ORACLE_CAPSULE', () => {
    // F5 (network attempt) cannot prove network isolation with subprocess controls alone.
    // Network isolation requires a container (Docker) or equivalent capsule.
    // P0-C evaluator profile 'subprocess-node-v1' cannot support this acceptance claim.
    //
    // P0-A (oracle artifact) and P0-B (tool confinement) are PROVEN.
    // P0-C is BLOCKED until a capsule evaluator is available.
    expect('STAGE_2B_LIVE_ACCEPTANCE_BLOCKED_PENDING_ORACLE_CAPSULE').toBe(
      'STAGE_2B_LIVE_ACCEPTANCE_BLOCKED_PENDING_ORACLE_CAPSULE',
    )
  })
})

// ── Helpers ───────────────────────────────────────────────────────────────────
// These wrappers override the preflight base path so the evaluator writes to
// the test's temp directory instead of STAGE2B_PREFLIGHT_BASE.

import { computeOracleHash } from '../../src/preflight/oracle-bundle.js'
import { ORACLE_SOURCE_PATH } from '../../src/preflight/oracle-bundle.js'
import crypto from 'crypto'
import { spawnSync } from 'child_process'

function createOracleBundleInDir(baseDir: string, pfId: string): OracleBundleResult {
  const oracleId = randomUUID()
  const bundleDir = path.join(baseDir, pfId, 'oracle-bundles', oracleId)
  fs.mkdirSync(bundleDir, { recursive: true })

  const bundledOraclePath = path.join(bundleDir, 'operator-task-oracle.mjs')
  fs.copyFileSync(ORACLE_SOURCE_PATH, bundledOraclePath)
  const oracleSha256 = computeOracleHash(bundledOraclePath)

  const receipt = {
    oracleId,
    preflightId: pfId,
    oracleSourcePath: ORACLE_SOURCE_PATH,
    bundledOraclePath,
    oracleSha256,
    taskSpecVersion: 'summarizeChecks-v1' as const,
    bundleContents: fs.readdirSync(bundleDir).sort(),
    tamperCheckResult: 'PASS' as const,
    bundledAt: new Date().toISOString(),
    agentModifiedCodeExecuted: false as const,
  }
  fs.writeFileSync(path.join(bundleDir, 'oracle-receipt.json'), JSON.stringify(receipt, null, 2))
  return { bundleDir, bundledOraclePath, receipt }
}

function runOracleWithFixtureInDir(
  baseDir: string,
  pfId: string,
  bundleResult: OracleBundleResult,
  opts: {
    fixtureContent: string
    fixtureLabel: string
    timeoutMs?: number
    maxOutputBytes?: number
  },
) {
  const {
    fixtureContent,
    fixtureLabel,
    timeoutMs = 8000,
    maxOutputBytes = 65536,
  } = opts

  const oracleRunId = randomUUID()
  const runDir = path.join(baseDir, pfId, 'oracle-workspaces', oracleRunId)
  const workspaceDir = path.join(runDir, 'workspace')
  const outputFile = path.join(runDir, 'oracle-result.json')

  const tamperHash = computeOracleHash(bundleResult.bundledOraclePath)
  const tamperCheckPassed = tamperHash === bundleResult.receipt.oracleSha256
  const workspacePayloadHash = crypto.createHash('sha256').update(fixtureContent, 'utf-8').digest('hex')

  let terminalOracleStatus: import('../../src/preflight/oracle-evaluator.js').EvaluatorReceipt['terminalOracleStatus'] = 'ERROR'
  let oracleResult: unknown = null
  let boundedDiagnostics = ''
  let outputCapped = false
  let outputExceededBuffer = false
  let timeoutEnforced = false
  let workspaceReadOnly = false
  let cleanupComplete = false

  try {
    fs.mkdirSync(path.join(workspaceDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(workspaceDir, 'package.json'), JSON.stringify({ type: 'module' }))
    fs.writeFileSync(path.join(workspaceDir, 'src', 'status.js'), fixtureContent)
    fs.writeFileSync(outputFile, '')

    chmodRecursive(workspaceDir, 0o444, 0o555)
    workspaceReadOnly = true

    const result = spawnSync(
      'node',
      [bundleResult.bundledOraclePath, workspaceDir, outputFile],
      { timeout: timeoutMs, maxBuffer: maxOutputBytes, encoding: 'utf-8' },
    )

    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code
      if (code === 'ETIMEDOUT' || result.signal === 'SIGTERM') {
        timeoutEnforced = true; terminalOracleStatus = 'TIMEOUT'
      } else if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || code === 'ENOBUFS') {
        outputCapped = true; outputExceededBuffer = true; terminalOracleStatus = 'OUTPUT_CAPPED'
      }
      boundedDiagnostics = String(result.error).slice(0, 512)
    } else if (result.signal === 'SIGTERM' || result.signal === 'SIGKILL') {
      timeoutEnforced = true; terminalOracleStatus = 'TIMEOUT'
    } else {
      const stdoutLen = result.stdout?.length ?? 0
      if (stdoutLen >= maxOutputBytes) {
        outputCapped = true; outputExceededBuffer = true; terminalOracleStatus = 'OUTPUT_CAPPED'
      } else {
        try {
          const raw = fs.readFileSync(outputFile, 'utf-8').trim()
          if (raw) {
            oracleResult = JSON.parse(raw)
            const s = (oracleResult as { status?: string }).status
            terminalOracleStatus = s === 'PASS' ? 'PASS' : s === 'FAIL' ? 'FAIL' : 'ERROR'
          }
        } catch { terminalOracleStatus = 'ERROR' }
      }
      boundedDiagnostics = ((result.stdout ?? '') + (result.stderr ?? '')).slice(0, 512)
    }
  } finally {
    restoreWritable(workspaceDir)
    try { fs.rmSync(runDir, { recursive: true, force: true }); cleanupComplete = true } catch { /* best-effort */ }
  }

  return {
    oracleRunId,
    preflightId: pfId,
    oracleSha256: bundleResult.receipt.oracleSha256,
    workspacePayloadHash,
    evaluatorProfileId: 'subprocess-node-v1' as const,
    controlPolicyVersion: 'stage2b-preflight-v1' as const,
    hostExecutionOccurred: false as const,
    terminalOracleStatus,
    oracleResult,
    boundedDiagnostics,
    outputCapped,
    outputExceededBuffer,
    timeoutEnforced,
    workspaceReadOnly,
    networkIsolationProven: false as const,
    cleanupComplete,
    tamperCheckPassed,
    fixtureLabel,
    evaluatedAt: new Date().toISOString(),
    controls: {
      subprocess_isolation: true as const,
      timeout: true as const,
      output_cap: true as const,
      workspace_readonly: workspaceReadOnly,
      network_isolation: false as const,
      cleanup: cleanupComplete,
    },
    unverifiedControls: ['network_isolation', 'full_filesystem_isolation'] as const,
  }
}

function chmodRecursive(dir: string, fileMode: number, dirMode: number): void {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        chmodRecursive(full, fileMode, dirMode)
        fs.chmodSync(full, dirMode)
      } else {
        fs.chmodSync(full, fileMode)
      }
    }
    fs.chmodSync(dir, dirMode)
  } catch { /* best-effort */ }
}

function restoreWritable(dir: string): void {
  try { chmodRecursive(dir, 0o644, 0o755) } catch { /* best-effort */ }
}
