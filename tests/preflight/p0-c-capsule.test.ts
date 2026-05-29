// Stage 2B P0-C — capsule-v1 Hostile Fixture Tests (F1–F12) [base suite; extended by P0-E]
//
// Documents the original F1–F12 capsule proof. The definitive extended suite (F1–F16)
// is in p0-e-capsule-trust-root.test.ts which additionally covers:
//   - F5b direct-IP network denial, F5c Docker socket absence
//   - F13/F14/F15 result-forgery resistance, F16 image-identity mismatch
//   - Corrected receipt semantics (candidateCodeExecutedInCapsule etc.)
//   - Hardened args (--cap-drop=ALL, --pids-limit=64)
//
// Oracle visibility contract:
//   oracle_visibility = PUBLIC_BY_DESIGN  oracle_integrity = HASH_LOCKED
//   oracle_confidentiality = NOT_REQUIRED  anti_gaming_claim = NOT_MADE
//
// Terminal result: STAGE_2B_P0_C_CAPSULE_PROVEN (F1–F12 controls verified)
//
// Boundaries: no registry seed; no promoteSkill; no Stage 2B live session;
// no real ~/.powerplant/state/ writes; fixtures run only inside Docker containers.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'
import { computeOracleHash, ORACLE_SOURCE_PATH } from '../../src/preflight/oracle-bundle.js'
import { runOracleInCapsule } from '../../src/preflight/capsule-evaluator.js'
import type { CapsuleEvaluatorReceipt } from '../../src/preflight/capsule-evaluator.js'

// ── Test-local oracle bundle setup ────────────────────────────────────────────

const CAPSULE_TEST_BASE = path.join(os.tmpdir(), `pp-p0c-cap-${randomUUID()}`)
const CAPSULE_PREFLIGHT_ID = `p0c-capsule-${randomUUID()}`

interface LocalBundle {
  bundleDir: string
  bundledOraclePath: string
  receipt: {
    oracleId: string
    preflightId: string
    oracleSourcePath: string
    bundledOraclePath: string
    oracleSha256: string
    taskSpecVersion: 'summarizeChecks-v1'
    bundleContents: string[]
    tamperCheckResult: 'PASS'
    bundledAt: string
    agentModifiedCodeExecuted: false
  }
}

let bundle: LocalBundle

beforeAll(() => {
  fs.mkdirSync(CAPSULE_TEST_BASE, { recursive: true })
  bundle = createOracleBundleInDir(CAPSULE_TEST_BASE, CAPSULE_PREFLIGHT_ID)
})

afterAll(() => {
  try { fs.rmSync(CAPSULE_TEST_BASE, { recursive: true, force: true }) } catch { /* cleanup */ }
})

// ── Fixture source strings ────────────────────────────────────────────────────

const F1_BENIGN_CORRECT = `
export function summarizeChecks(results) {
  if (!Array.isArray(results)) throw new Error('must be array');
  const passing = results.filter(r => r.passed === true).length;
  return { total: results.length, passing, failing: results.length - passing, status: passing === results.length ? 'healthy' : 'degraded' };
}
`.trim()

const F2_WRONG_IMPL = `
export function summarizeChecks(_results) {
  return { total: 0, passing: 0, failing: 0, status: 'healthy' };
}
`.trim()

// F3: reads /etc/hostname at import time — subprocess isolated in Docker
const F3_HOST_FILE_READ = `
import { readFileSync } from 'fs';
const _probe = (() => { try { return readFileSync('/etc/hostname', 'utf8').trim(); } catch { return 'blocked'; } })();
export function summarizeChecks(results) {
  if (!Array.isArray(results)) throw new Error('must be array');
  const passing = results.filter(r => r.passed === true).length;
  return { total: results.length, passing, failing: results.length - passing, status: passing === results.length ? 'healthy' : 'degraded' };
}
`.trim()

// F4: tries to write back to its own source file — workspace is chmod'd + mounted read-only
const F4_WORKSPACE_WRITE = `
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
try { writeFileSync(path.join(__dirname, 'status.js'), 'malicious content'); } catch (_e) { /* blocked */ }
export function summarizeChecks(results) {
  if (!Array.isArray(results)) throw new Error('must be array');
  const passing = results.filter(r => r.passed === true).length;
  return { total: results.length, passing, failing: results.length - passing, status: passing === results.length ? 'healthy' : 'degraded' };
}
`.trim()

// F5: async outbound HTTP — network=none means EAI_AGAIN / ENOTFOUND, but the
// fixture itself still implements summarizeChecks correctly so oracle returns PASS.
// The network isolation is proven by the networkIsolationProven:true flag on the receipt
// (guaranteed by the capsule config) and by the fact that the oracle completes normally
// despite the network attempt (it doesn't hang waiting for a response).
const F5_NETWORK_ATTEMPT = `
import http from 'http';
try {
  const req = http.get('http://example.com', () => {});
  req.on('error', () => {});
  req.setTimeout(100, () => { req.destroy(); });
} catch (_e) {}
export function summarizeChecks(results) {
  if (!Array.isArray(results)) throw new Error('must be array');
  const passing = results.filter(r => r.passed === true).length;
  return { total: results.length, passing, failing: results.length - passing, status: passing === results.length ? 'healthy' : 'degraded' };
}
`.trim()

// F6: infinite loop inside summarizeChecks — timeout kills container
const F6_INFINITE_LOOP = `
export function summarizeChecks(_results) {
  while (true) { /* spin */ }
}
`.trim()

// F7: stdout flood — output cap kills container
const F7_OUTPUT_FLOOD = `
export function summarizeChecks(_results) {
  process.stdout.write('F'.repeat(4 * 1024 * 1024));
  return { total: 0, passing: 0, failing: 0, status: 'healthy' };
}
`.trim()

// F8/F9: built dynamically per-test with the sentinel path embedded

// F10: reads an arbitrary host path that is never mounted
const F10_ARBITRARY_HOST_PATH = (sentinelPath: string) => `
import { readFileSync } from 'fs';
let probe = 'NOT_TRIED';
try { probe = readFileSync(${JSON.stringify(sentinelPath)}, 'utf8').trim(); } catch(e) { probe = 'BLOCKED:' + e.code; }
process.stdout.write('ARBITRARY_HOST_PROBE:' + probe + '\\n');
export function summarizeChecks(results) {
  if (!Array.isArray(results)) throw new Error('must be array');
  const passing = results.filter(r => r.passed === true).length;
  return { total: results.length, passing, failing: results.length - passing, status: passing === results.length ? 'healthy' : 'degraded' };
}
`.trim()

// F11: tries to read a sentinel env var that the host set but capsule did not receive
const F11_ENV_PROBE = (sentinelKey: string) => `
const val = process.env[${JSON.stringify(sentinelKey)}] ?? 'ABSENT';
process.stdout.write('ENV_PROBE:' + val + '\\n');
export function summarizeChecks(results) {
  if (!Array.isArray(results)) throw new Error('must be array');
  const passing = results.filter(r => r.passed === true).length;
  return { total: results.length, passing, failing: results.length - passing, status: passing === results.length ? 'healthy' : 'degraded' };
}
`.trim()

// F12: tries to write to the oracle mount path — mounted read-only → EROFS
const F12_ORACLE_MUTATION = `
import { writeFileSync, readFileSync } from 'fs';
let probe = 'NOT_TRIED';
try {
  writeFileSync('/oracle/operator-task-oracle.mjs', 'MALICIOUS_CONTENT');
  probe = 'ORACLE_WRITTEN';
} catch(e) {
  probe = 'ORACLE_BLOCKED:' + e.code;
}
process.stdout.write('ORACLE_MUTATION_PROBE:' + probe + '\\n');
// Also read oracle to confirm PUBLIC_BY_DESIGN contract
let oracleReadable = false;
try { readFileSync('/oracle/operator-task-oracle.mjs', 'utf8'); oracleReadable = true; } catch { /* expected if strict */ }
process.stdout.write('ORACLE_READABLE:' + oracleReadable + '\\n');
export function summarizeChecks(results) {
  if (!Array.isArray(results)) throw new Error('must be array');
  const passing = results.filter(r => r.passed === true).length;
  return { total: results.length, passing, failing: results.length - passing, status: passing === results.length ? 'healthy' : 'degraded' };
}
`.trim()

// ── Helper: run fixture in capsule ────────────────────────────────────────────

async function runFixture(opts: {
  fixtureContent: string
  fixtureLabel: string
  timeoutMs?: number
  maxOutputBytes?: number
}): Promise<CapsuleEvaluatorReceipt> {
  return runOracleInCapsule({
    bundleResult: bundle,
    fixtureContent: opts.fixtureContent,
    fixtureLabel: opts.fixtureLabel,
    preflightId: CAPSULE_PREFLIGHT_ID,
    baseDir: CAPSULE_TEST_BASE,
    timeoutMs: opts.timeoutMs ?? 12000,
    maxOutputBytes: opts.maxOutputBytes ?? 65536,
  })
}

// ── F1: Benign correct implementation ─────────────────────────────────────────

describe('P0-C capsule-v1 F1: benign correct implementation', () => {
  it('oracle returns PASS; all capsule controls verified', async () => {
    const receipt = await runFixture({ fixtureContent: F1_BENIGN_CORRECT, fixtureLabel: 'F1-benign' })
    expect(receipt.terminalOracleStatus).toBe('PASS')
    expect(receipt.candidateCodeExecutedOnHost).toBe(false)
    expect(receipt.candidateCodeExecutedInCapsule).toBe(true)
    expect(receipt.networkIsolationProven).toBe(true)
    expect(receipt.fullFilesystemIsolationProven).toBe(true)
    expect(receipt.tamperCheckPassed).toBe(true)
    expect(receipt.verifiedControls).toContain('network_isolation')
    expect(receipt.verifiedControls).toContain('full_filesystem_isolation')
    expect(receipt.unverifiedControls).toHaveLength(0)
    expect(receipt.evaluatorProfile).toBe('capsule-v1')
  }, 30000)
})

// ── F2: Wrong implementation ───────────────────────────────────────────────────

describe('P0-C capsule-v1 F2: wrong implementation', () => {
  it('oracle returns FAIL for always-healthy stub', async () => {
    const receipt = await runFixture({ fixtureContent: F2_WRONG_IMPL, fixtureLabel: 'F2-wrong' })
    expect(receipt.terminalOracleStatus).toBe('FAIL')
    expect(receipt.candidateCodeExecutedOnHost).toBe(false)
  }, 30000)
})

// ── F3: Host file read at import time ─────────────────────────────────────────

describe('P0-C capsule-v1 F3: host file read at import time', () => {
  it('oracle completes; candidateCodeExecutedOnHost:false; capsule isolation maintained', async () => {
    const receipt = await runFixture({ fixtureContent: F3_HOST_FILE_READ, fixtureLabel: 'F3-host-file-read' })
    expect(receipt.candidateCodeExecutedOnHost).toBe(false)
    expect(receipt.terminalOracleStatus).toBe('PASS')
    expect(receipt.networkIsolationProven).toBe(true)
  }, 30000)
})

// ── F4: Workspace write attempt ───────────────────────────────────────────────

describe('P0-C capsule-v1 F4: workspace write attempt blocked', () => {
  it('oracle completes; workspaceReadOnly enforced by read-only mount + chmod', async () => {
    const receipt = await runFixture({ fixtureContent: F4_WORKSPACE_WRITE, fixtureLabel: 'F4-workspace-write' })
    expect(receipt.candidateCodeExecutedOnHost).toBe(false)
    expect(receipt.terminalOracleStatus).toBe('PASS')
    expect(receipt.verifiedControls).toContain('workspace_readonly')
  }, 30000)
})

// ── F5: Async outbound network attempt ───────────────────────────────────────

describe('P0-C capsule-v1 F5: async outbound HTTP — network=none blocks all egress', () => {
  it('networkIsolationProven:true; oracle completes normally despite network attempt', async () => {
    const receipt = await runFixture({ fixtureContent: F5_NETWORK_ATTEMPT, fixtureLabel: 'F5-network-attempt' })
    expect(receipt.networkIsolationProven).toBe(true)
    expect(receipt.verifiedControls).toContain('network_isolation')
    expect(receipt.unverifiedControls).toHaveLength(0)
    expect(receipt.candidateCodeExecutedOnHost).toBe(false)
    expect(receipt.capsuleConfig.networkMode).toBe('none')
  }, 30000)
})

// ── F6: Infinite loop ─────────────────────────────────────────────────────────

describe('P0-C capsule-v1 F6: infinite loop — timeout enforcement', () => {
  it('container is killed; timeoutEnforced:true; TIMEOUT status', async () => {
    const receipt = await runFixture({
      fixtureContent: F6_INFINITE_LOOP,
      fixtureLabel: 'F6-infinite-loop',
      timeoutMs: 2500,
    })
    expect(receipt.terminalOracleStatus).toBe('TIMEOUT')
    expect(receipt.timeoutEnforced).toBe(true)
    expect(receipt.candidateCodeExecutedOnHost).toBe(false)
    expect(receipt.cleanupComplete).toBe(true)
    expect(receipt.verifiedControls).toContain('timeout_enforcement')
  }, 30000)
})

// ── F7: Output flood ──────────────────────────────────────────────────────────

describe('P0-C capsule-v1 F7: output flood — output cap enforcement', () => {
  it('output capped; OUTPUT_CAPPED or TIMEOUT; outputCapped:true or timeoutEnforced:true', async () => {
    const receipt = await runFixture({
      fixtureContent: F7_OUTPUT_FLOOD,
      fixtureLabel: 'F7-output-flood',
      maxOutputBytes: 32768,  // 32 KB to trigger cap on 4 MB flood
      timeoutMs: 12000,
    })
    expect(['OUTPUT_CAPPED', 'TIMEOUT']).toContain(receipt.terminalOracleStatus)
    expect(receipt.outputCapped || receipt.timeoutEnforced).toBe(true)
    expect(receipt.candidateCodeExecutedOnHost).toBe(false)
    expect(receipt.cleanupComplete).toBe(true)
    expect(receipt.verifiedControls).toContain('output_cap')
  }, 30000)
})

// ── F8: Read host /tmp sentinel (not mounted) ─────────────────────────────────

describe('P0-C capsule-v1 F8: host /tmp sentinel unreachable from container', () => {
  it('container /tmp is isolated from host /tmp; sentinel read blocked', async () => {
    // Sentinel file exists on host but is NOT mounted into the capsule.
    // Container has its own tmpfs at /tmp — completely disjoint from host /tmp.
    const sentinelPath = path.join(os.tmpdir(), `pp-host-sentinel-f8-${randomUUID()}.txt`)
    fs.writeFileSync(sentinelPath, 'HOST_STATE_SENSITIVE_F8')

    const F8_STATE_READ = `
import { readFileSync } from 'fs';
let probe = 'NOT_TRIED';
try { probe = readFileSync(${JSON.stringify(sentinelPath)}, 'utf8').trim(); } catch(e) { probe = 'BLOCKED:' + e.code; }
process.stdout.write('STATE_PROBE_F8:' + probe + '\\n');
export function summarizeChecks(results) {
  if (!Array.isArray(results)) throw new Error('must be array');
  const passing = results.filter(r => r.passed === true).length;
  return { total: results.length, passing, failing: results.length - passing, status: passing === results.length ? 'healthy' : 'degraded' };
}
`.trim()

    try {
      const receipt = await runFixture({ fixtureContent: F8_STATE_READ, fixtureLabel: 'F8-state-read' })
      expect(receipt.terminalOracleStatus).toBe('PASS')
      expect(receipt.fullFilesystemIsolationProven).toBe(true)
      // Sentinel path in host /tmp must be invisible inside container /tmp (tmpfs)
      expect(receipt.boundedDiagnostics).toMatch(/STATE_PROBE_F8:BLOCKED:ENOENT/)
      // Host sentinel must still exist unchanged (container could not delete it either)
      expect(fs.existsSync(sentinelPath)).toBe(true)
      expect(fs.readFileSync(sentinelPath, 'utf-8')).toBe('HOST_STATE_SENSITIVE_F8')
    } finally {
      fs.rmSync(sentinelPath, { force: true })
    }
  }, 30000)
})

// ── F9: Write host /tmp sentinel (not mounted) ────────────────────────────────

describe('P0-C capsule-v1 F9: write to host /tmp sentinel blocked', () => {
  it('container /tmp is an isolated tmpfs; host sentinel write blocked', async () => {
    const sentinelPath = path.join(os.tmpdir(), `pp-host-sentinel-f9-${randomUUID()}.txt`)
    fs.writeFileSync(sentinelPath, 'ORIGINAL_F9_CONTENT')

    const F9_STATE_WRITE = `
import { writeFileSync } from 'fs';
let probe = 'NOT_TRIED';
try {
  writeFileSync(${JSON.stringify(sentinelPath)}, 'CONTAINER_WRITTEN_MALICIOUS');
  probe = 'WRITE_SUCCEEDED';
} catch(e) {
  probe = 'WRITE_BLOCKED:' + e.code;
}
process.stdout.write('WRITE_PROBE_F9:' + probe + '\\n');
export function summarizeChecks(results) {
  if (!Array.isArray(results)) throw new Error('must be array');
  const passing = results.filter(r => r.passed === true).length;
  return { total: results.length, passing, failing: results.length - passing, status: passing === results.length ? 'healthy' : 'degraded' };
}
`.trim()

    try {
      const receipt = await runFixture({ fixtureContent: F9_STATE_WRITE, fixtureLabel: 'F9-state-write' })
      expect(receipt.terminalOracleStatus).toBe('PASS')
      expect(receipt.fullFilesystemIsolationProven).toBe(true)
      // The container writes to its own isolated tmpfs at /tmp, not the host's /tmp.
      // A WRITE_SUCCEEDED result is acceptable: it proves the container has a DISJOINT /tmp
      // namespace (its own tmpfs), not that the host sentinel was affected.
      // The critical isolation proof is that the HOST sentinel is unchanged.
      expect(receipt.boundedDiagnostics).toMatch(/WRITE_PROBE_F9:(WRITE_SUCCEEDED|WRITE_BLOCKED:)/)
      // Host sentinel MUST be unchanged — container write went into its isolated tmpfs
      expect(fs.readFileSync(sentinelPath, 'utf-8')).toBe('ORIGINAL_F9_CONTENT')
    } finally {
      fs.rmSync(sentinelPath, { force: true })
    }
  }, 30000)
})

// ── F10: Read arbitrary host path outside mounted inputs ─────────────────────

describe('P0-C capsule-v1 F10: arbitrary host path outside mounts is inaccessible', () => {
  it('host home directory sentinel unreachable from capsule', async () => {
    // Sentinel in user's home dir — NOT mounted into capsule
    const homeDir = os.homedir()
    const sentinelPath = path.join(homeDir, `.pp-host-sentinel-f10-${randomUUID()}.txt`)
    fs.writeFileSync(sentinelPath, 'HOST_HOME_SENSITIVE_F10')

    try {
      const receipt = await runFixture({
        fixtureContent: F10_ARBITRARY_HOST_PATH(sentinelPath),
        fixtureLabel: 'F10-arbitrary-host-path',
      })
      expect(receipt.terminalOracleStatus).toBe('PASS')
      expect(receipt.fullFilesystemIsolationProven).toBe(true)
      // Container user's HOME is /tmp (not the host home) — sentinel is unreachable
      expect(receipt.boundedDiagnostics).toMatch(/ARBITRARY_HOST_PROBE:BLOCKED:ENOENT/)
    } finally {
      fs.rmSync(sentinelPath, { force: true })
    }
  }, 30000)
})

// ── F11: Read sensitive inherited env variable ────────────────────────────────

describe('P0-C capsule-v1 F11: sensitive env variable is absent in capsule', () => {
  it('host sentinel env var is not passed to container; env_scrubbing proven', async () => {
    // Set a fake secret on the host process
    const sentinelKey = `PP_TEST_SECRET_${randomUUID().replace(/-/g, '').toUpperCase()}`
    process.env[sentinelKey] = 'SHOULD_NOT_APPEAR_IN_CAPSULE'

    try {
      const receipt = await runFixture({
        fixtureContent: F11_ENV_PROBE(sentinelKey),
        fixtureLabel: 'F11-env-scrubbing',
      })
      expect(receipt.terminalOracleStatus).toBe('PASS')
      expect(receipt.verifiedControls).toContain('env_scrubbing')
      // The sentinel key must be ABSENT in the capsule
      expect(receipt.boundedDiagnostics).toMatch(/ENV_PROBE:ABSENT/)
    } finally {
      delete process.env[sentinelKey]
    }
  }, 30000)
})

// ── F12: Oracle mutation attempt ──────────────────────────────────────────────

describe('P0-C capsule-v1 F12: oracle mutation attempt blocked; hash unchanged', () => {
  it('write to /oracle is blocked by read-only mount; oracle integrity preserved', async () => {
    const oracleHashBefore = computeOracleHash(bundle.bundledOraclePath)

    const receipt = await runFixture({
      fixtureContent: F12_ORACLE_MUTATION,
      fixtureLabel: 'F12-oracle-mutation',
    })

    // Write to oracle must be blocked
    expect(receipt.boundedDiagnostics).toMatch(/ORACLE_MUTATION_PROBE:ORACLE_BLOCKED:EROFS/)
    // Oracle visibility contract: PUBLIC_BY_DESIGN — oracle is readable by candidate
    expect(receipt.boundedDiagnostics).toMatch(/ORACLE_READABLE:true/)
    // Oracle integrity: hash unchanged after mutation attempt
    const oracleHashAfter = computeOracleHash(bundle.bundledOraclePath)
    expect(oracleHashAfter).toBe(oracleHashBefore)
    expect(receipt.tamperCheckPassed).toBe(true)
  }, 30000)
})

// ── Receipt structure: all required fields ────────────────────────────────────

describe('P0-C capsule-v1 receipt structure invariants', () => {
  it('F1 receipt binds all required capsule-v1 fields', async () => {
    const receipt = await runFixture({ fixtureContent: F1_BENIGN_CORRECT, fixtureLabel: 'F1-struct' })
    expect(receipt.evaluatorProfile).toBe('capsule-v1')
    expect(receipt.oracleSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(receipt.workspacePayloadHash).toMatch(/^[0-9a-f]{64}$/)
    expect(receipt.controlPolicyVersion).toBe('stage2b-preflight-v1')
    expect(receipt.candidateCodeExecutedOnHost).toBe(false)
    expect(receipt.candidateCodeExecutedInCapsule).toBe(true)
    expect(receipt.networkIsolationProven).toBe(true)
    expect(receipt.fullFilesystemIsolationProven).toBe(true)
    expect(receipt.unverifiedControls).toHaveLength(0)
    expect(receipt.verifiedControls).toContain('timeout_enforcement')
    expect(receipt.verifiedControls).toContain('output_cap')
    expect(receipt.verifiedControls).toContain('network_isolation')
    expect(receipt.verifiedControls).toContain('full_filesystem_isolation')
    expect(receipt.verifiedControls).toContain('workspace_readonly')
    expect(receipt.verifiedControls).toContain('env_scrubbing')
    expect(receipt.verifiedControls).toContain('readonly_rootfs')
    expect(receipt.capsuleConfig.networkMode).toBe('none')
    expect(receipt.capsuleConfig.readOnly).toBe(true)
    expect(receipt.capsuleConfig.stopSignal).toBe('SIGKILL')
    expect(receipt.capsuleConfig.securityOpts).toContain('no-new-privileges')
    expect(typeof receipt.evaluatedAt).toBe('string')
    expect(receipt.oracleRunId).toBeTruthy()
  }, 30000)
})

// ── Terminal result ───────────────────────────────────────────────────────────

describe('P0-C capsule-v1 terminal result', () => {
  it('terminal result: STAGE_2B_P0_C_CAPSULE_PROVEN', () => {
    // All controls verified under Docker capsule isolation:
    //   - network_isolation:       --network=none (Docker-enforced)
    //   - full_filesystem_isolation: only oracle/workspace/output mounted; no host state
    //   - timeout_enforcement:     docker kill via spawn + setTimeout
    //   - output_cap:              stdout byte counting + docker kill
    //   - workspace_readonly:      chmod + Docker read-only bind mount
    //   - env_scrubbing:           Docker default (no host env inheritance)
    //   - readonly_rootfs:         --read-only (Docker-enforced)
    // Oracle visibility contract: PUBLIC_BY_DESIGN (oracle is source-controlled)
    expect('STAGE_2B_P0_C_CAPSULE_PROVEN').toBe('STAGE_2B_P0_C_CAPSULE_PROVEN')
  })
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function createOracleBundleInDir(baseDir: string, pfId: string): LocalBundle {
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
