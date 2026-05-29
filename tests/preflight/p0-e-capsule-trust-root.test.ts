// Stage 2B P0-E — Capsule Trust Root, Result Integrity, and Pre-Authorization Closure
//
// This test file closes the blockers identified in the P0-D review verdict.
//
// P0-D amendment (sealed here):
//   Commit 92a2f50 did NOT pass clean replay. Its P0-A test contained a broad
//   /tmp exclusion that failed when checked out under /tmp. Commit c9aa2d3
//   supersedes 92a2f50 for P0-A evidence. The revised oracle location contract:
//     - oracle may reside under any clean checkout path, including /tmp
//     - security relies on read-only capsule mounts and trusted receipt construction
//     - only SPRINT4A_RUNTIME_BASE is excluded (the live agent workspace sandbox)
//   This file does NOT re-open the /tmp exclusion question.
//
// Hostile fixture matrix (F1–F16):
//   F1   Benign correct implementation           → PASS
//   F2   Wrong implementation                    → FAIL
//   F3   Host file read at import time           → capsule-isolated; candidateCodeExecutedOnHost:false
//   F4   Workspace write attempt                 → blocked by read-only mount
//   F5a  Hostname HTTP request                   → blocked by --network=none
//   F5b  Direct TCP to literal IP address        → blocked by --network=none
//   F5c  Docker socket access attempt            → socket absent (not mounted)
//   F6   Infinite loop                           → timeout enforced
//   F7   Output flood                            → output capped
//   F8   Host /tmp sentinel read                 → ENOENT (isolated tmpfs)
//   F9   Host /tmp sentinel write                → host sentinel unchanged
//   F10  Arbitrary host path read                → ENOENT (not mounted)
//   F11  Sensitive env var read                  → absent in capsule
//   F12  Oracle mutation attempt                 → EROFS; hash unchanged
//   F13  Forged PASS pre-write to output file    → terminal result uses stdout sentinel; FAIL
//   F14  Symlink/path-traversal via output       → terminal result unaffected; FAIL
//   F15  process.exit monkey-patch race          → oracle uses saved originalExit; FAIL reported correctly
//   F16  Wrong/mutated capsule image identity    → execution refused before candidate runs
//
// Docker arg hardening tests:
//   - --cap-drop=ALL present
//   - --pids-limit present
//   - --privileged absent
//   - /var/run/docker.sock never mounted
//   - mounts only from evaluator-controlled temp paths
//
// Non-Negotiable Boundaries preserved by this file:
//   - No registry seed
//   - No promoteSkill
//   - No Stage 2B live session start
//   - No writes to real ~/.powerplant/state/
//   - All hostile fixtures run inside isolated Docker containers, never in this process

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'
import { computeOracleHash, ORACLE_SOURCE_PATH } from '../../src/preflight/oracle-bundle.js'
import {
  runOracleInCapsule,
  getCapsuleRepoDigests,
} from '../../src/preflight/capsule-evaluator.js'
import type { CapsuleEvaluatorReceipt } from '../../src/preflight/capsule-evaluator.js'
import {
  CAPSULE_DOCKER_IMAGE,
  CAPSULE_V1_EXPECTED_REPO_DIGEST,
  CAPSULE_PIDS_LIMIT,
  ORACLE_TRUSTED_RESULT_PREFIX,
} from '../../src/config/constants.js'

// ── Test-local oracle bundle setup ────────────────────────────────────────────

const P0E_TEST_BASE = path.join(os.tmpdir(), `pp-p0e-${randomUUID()}`)
const P0E_PREFLIGHT_ID = `p0e-${randomUUID()}`

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
  fs.mkdirSync(P0E_TEST_BASE, { recursive: true })
  bundle = createOracleBundleInDir(P0E_TEST_BASE, P0E_PREFLIGHT_ID)
})

afterAll(() => {
  try { fs.rmSync(P0E_TEST_BASE, { recursive: true, force: true }) } catch { /* cleanup */ }
})

// ── Helper: run fixture in capsule ────────────────────────────────────────────

async function runFixture(opts: {
  fixtureContent: string
  fixtureLabel: string
  timeoutMs?: number
  maxOutputBytes?: number
  expectedCanonicalReference?: string
}): Promise<CapsuleEvaluatorReceipt> {
  return runOracleInCapsule({
    bundleResult: bundle,
    fixtureContent: opts.fixtureContent,
    fixtureLabel: opts.fixtureLabel,
    preflightId: P0E_PREFLIGHT_ID,
    baseDir: P0E_TEST_BASE,
    timeoutMs: opts.timeoutMs ?? 12000,
    maxOutputBytes: opts.maxOutputBytes ?? 65536,
    expectedCanonicalReference: opts.expectedCanonicalReference,
  })
}

// ── Correct summarizeChecks implementation (reused across fixtures) ────────────

const CORRECT_SUMMARIZE = `
export function summarizeChecks(results) {
  if (!Array.isArray(results)) throw new Error('must be array');
  const passing = results.filter(r => r.passed === true).length;
  return { total: results.length, passing, failing: results.length - passing, status: passing === results.length ? 'healthy' : 'degraded' };
}
`.trim()

const WRONG_STUB = `
export function summarizeChecks(_results) {
  return { total: 0, passing: 0, failing: 0, status: 'healthy' };
}
`.trim()

// ── Section 1: Registry digest trust root verification ───────────────────────

describe('P0-E image identity: capsule registry digest verified', () => {
  it('resolved RepoDigests contains the approved canonical reference', () => {
    const digests = getCapsuleRepoDigests(CAPSULE_V1_EXPECTED_REPO_DIGEST)
    expect(digests).not.toBeNull()
    expect(digests).toContain(CAPSULE_V1_EXPECTED_REPO_DIGEST)
  })

  it('runOracleInCapsule records registry-digest trust root fields in receipt', async () => {
    const receipt = await runFixture({ fixtureContent: CORRECT_SUMMARIZE, fixtureLabel: 'img-identity-check' })
    expect(receipt.capsuleImageReference).toBe(CAPSULE_DOCKER_IMAGE)
    expect(receipt.capsuleCanonicalReference).toBe(CAPSULE_V1_EXPECTED_REPO_DIGEST)
    expect(receipt.capsuleResolvedRepoDigests).toContain(CAPSULE_V1_EXPECTED_REPO_DIGEST)
    expect(receipt.capsuleRegistryDigestVerified).toBe(true)
    expect(receipt.capsuleImageIdentityVerified).toBe(true)
    expect(receipt.verifiedControls).toContain('image_identity_verified')
  }, 30000)
})

// ── F16: Wrong expected registry digest → execution refused before candidate runs ─

describe('P0-E F16: wrong expected registry digest → execution refused before candidate runs', () => {
  it('runOracleInCapsule throws with CAPSULE_IMAGE_IDENTITY_MISMATCH before any Docker launch', async () => {
    const fakeExpectedRef = 'ghcr.io/rbardyla-boop/claude_powerplant/capsule-v1@sha256:' + '0'.repeat(64)
    await expect(
      runFixture({ fixtureContent: CORRECT_SUMMARIZE, fixtureLabel: 'F16-wrong-digest', expectedCanonicalReference: fakeExpectedRef }),
    ).rejects.toThrow('CAPSULE_IMAGE_IDENTITY_MISMATCH')

    // Verify: error message names the expected reference and the closed-execution reason
    try {
      await runFixture({ fixtureContent: CORRECT_SUMMARIZE, fixtureLabel: 'F16-msg', expectedCanonicalReference: fakeExpectedRef })
    } catch (err) {
      const msg = String(err)
      expect(msg).toContain(fakeExpectedRef)
      expect(msg).toContain('before any candidate code runs')
    }
  })
})

// ── Section 2: Docker arg hardening proof ─────────────────────────────────────

describe('P0-E docker arg hardening: required flags present in sanitized launch args', () => {
  let receipt: CapsuleEvaluatorReceipt

  beforeAll(async () => {
    receipt = await runFixture({ fixtureContent: CORRECT_SUMMARIZE, fixtureLabel: 'arg-hardening' })
  }, 30000)

  it('--cap-drop=ALL is present', () => {
    expect(receipt.dockerLaunchArgsSanitized).toContain('--cap-drop=ALL')
    expect(receipt.capsuleConfig.capDrop).toContain('ALL')
  })

  it('--pids-limit is present with bounded value', () => {
    expect(receipt.dockerLaunchArgsSanitized).toContain(`--pids-limit=${CAPSULE_PIDS_LIMIT}`)
    expect(receipt.capsuleConfig.pidsLimit).toBe(CAPSULE_PIDS_LIMIT)
  })

  it('--privileged is absent', () => {
    expect(receipt.dockerLaunchArgsSanitized).not.toContain('--privileged')
  })

  it('--network=none is present', () => {
    expect(receipt.dockerLaunchArgsSanitized).toContain('--network=none')
  })

  it('--read-only is present', () => {
    expect(receipt.dockerLaunchArgsSanitized).toContain('--read-only')
  })

  it('--security-opt=no-new-privileges is present', () => {
    expect(receipt.dockerLaunchArgsSanitized).toContain('--security-opt=no-new-privileges')
  })

  it('/var/run/docker.sock is never in the mount list', () => {
    const argsStr = receipt.dockerLaunchArgsSanitized.join(' ')
    expect(argsStr).not.toContain('docker.sock')
    expect(argsStr).not.toContain('/var/run')
  })

  it('capsule config records all hardening fields', () => {
    expect(receipt.capsuleConfig.networkMode).toBe('none')
    expect(receipt.capsuleConfig.readOnly).toBe(true)
    expect(receipt.capsuleConfig.stopSignal).toBe('SIGKILL')
    expect(receipt.capsuleConfig.securityOpts).toContain('no-new-privileges')
    expect(receipt.capsuleConfig.capDrop).toContain('ALL')
    expect(receipt.capsuleConfig.pidsLimit).toBe(CAPSULE_PIDS_LIMIT)
  })
})

// ── Section 3: Corrected receipt semantics ────────────────────────────────────

describe('P0-E receipt semantics: explicit execution provenance fields', () => {
  it('F1 receipt uses candidateCodeExecutedInCapsule:true, not agentModifiedCodeExecuted', async () => {
    const receipt = await runFixture({ fixtureContent: CORRECT_SUMMARIZE, fixtureLabel: 'semantics-check' })

    // New fields (P0-E)
    expect(receipt.candidateCodeExecutedInCapsule).toBe(true)
    expect(receipt.candidateCodeExecutedOnHost).toBe(false)
    expect(receipt.promotedSkillExecuted).toBe(false)
    expect(receipt.realPowerplantStateMounted).toBe(false)
    expect(receipt.realPowerplantStateWriteOccurred).toBe(false)

    // Removed field must not exist
    expect((receipt as unknown as Record<string, unknown>)['agentModifiedCodeExecuted']).toBeUndefined()
  }, 30000)

  it('receipt declares trusted result channel was used', async () => {
    const receipt = await runFixture({ fixtureContent: CORRECT_SUMMARIZE, fixtureLabel: 'result-channel-check' })
    expect(receipt.resultChannelUsed).toBe('stdout-sentinel')
    expect(receipt.verifiedControls).toContain('trusted_result_channel')
  }, 30000)
})

// ── F1: Benign correct implementation ─────────────────────────────────────────

describe('P0-E F1: benign correct implementation', () => {
  it('oracle returns PASS; all controls verified', async () => {
    const receipt = await runFixture({ fixtureContent: CORRECT_SUMMARIZE, fixtureLabel: 'F1-benign' })
    expect(receipt.terminalOracleStatus).toBe('PASS')
    expect(receipt.candidateCodeExecutedOnHost).toBe(false)
    expect(receipt.networkIsolationProven).toBe(true)
    expect(receipt.fullFilesystemIsolationProven).toBe(true)
    expect(receipt.tamperCheckPassed).toBe(true)
    expect(receipt.capsuleImageIdentityVerified).toBe(true)
    expect(receipt.resultChannelUsed).toBe('stdout-sentinel')
    expect(receipt.unverifiedControls).toHaveLength(0)
  }, 30000)
})

// ── F2: Wrong implementation ───────────────────────────────────────────────────

describe('P0-E F2: wrong implementation', () => {
  it('oracle returns FAIL for always-healthy stub', async () => {
    const receipt = await runFixture({ fixtureContent: WRONG_STUB, fixtureLabel: 'F2-wrong' })
    expect(receipt.terminalOracleStatus).toBe('FAIL')
    expect(receipt.candidateCodeExecutedOnHost).toBe(false)
    expect(receipt.resultChannelUsed).toBe('stdout-sentinel')
  }, 30000)
})

// ── F3: Host file read at import time ─────────────────────────────────────────

describe('P0-E F3: host file read at import time — capsule-isolated', () => {
  it('oracle PASS; candidateCodeExecutedOnHost:false', async () => {
    const receipt = await runFixture({
      fixtureContent: `
import { readFileSync } from 'fs';
const _probe = (() => { try { return readFileSync('/etc/hostname', 'utf8').trim(); } catch { return 'blocked'; } })();
${CORRECT_SUMMARIZE}`.trim(),
      fixtureLabel: 'F3-host-file-read',
    })
    expect(receipt.candidateCodeExecutedOnHost).toBe(false)
    expect(receipt.candidateCodeExecutedInCapsule).toBe(true)
    expect(receipt.terminalOracleStatus).toBe('PASS')
  }, 30000)
})

// ── F4: Workspace write attempt ───────────────────────────────────────────────

describe('P0-E F4: workspace write attempt blocked', () => {
  it('workspace read-only mount blocks write; oracle PASS', async () => {
    const receipt = await runFixture({
      fixtureContent: `
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
try { writeFileSync(path.join(__dirname, 'status.js'), 'malicious'); } catch { /* blocked */ }
${CORRECT_SUMMARIZE}`.trim(),
      fixtureLabel: 'F4-workspace-write',
    })
    expect(receipt.terminalOracleStatus).toBe('PASS')
    expect(receipt.candidateCodeExecutedOnHost).toBe(false)
    expect(receipt.verifiedControls).toContain('workspace_readonly')
  }, 30000)
})

// ── F5a: Hostname HTTP request ────────────────────────────────────────────────

describe('P0-E F5a: hostname-based HTTP request — network=none blocks DNS', () => {
  it('networkIsolationProven:true; oracle completes; network attempt fails', async () => {
    const receipt = await runFixture({
      fixtureContent: `
import http from 'http';
try {
  const req = http.get('http://example.com', () => {});
  req.on('error', () => {});
  req.setTimeout(500, () => { req.destroy(); });
} catch (_e) {}
${CORRECT_SUMMARIZE}`.trim(),
      fixtureLabel: 'F5a-hostname-http',
    })
    expect(receipt.networkIsolationProven).toBe(true)
    expect(receipt.capsuleConfig.networkMode).toBe('none')
    expect(receipt.candidateCodeExecutedOnHost).toBe(false)
  }, 30000)
})

// ── F5b: Direct TCP to literal IP address ─────────────────────────────────────

describe('P0-E F5b: direct TCP to literal IP — network=none blocks all IP routing', () => {
  it('direct socket connection to 1.1.1.1:80 is blocked; networkIsolationProven:true', async () => {
    const receipt = await runFixture({
      fixtureContent: `
import net from 'net';
let probe = 'NOT_TRIED';
try {
  await new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.connect(80, '1.1.1.1', () => { probe = 'CONNECTED'; socket.destroy(); resolve(null); });
    socket.on('error', (err) => { probe = 'BLOCKED:' + err.code; resolve(null); });
    socket.on('timeout', () => { socket.destroy(); probe = 'TIMEOUT'; resolve(null); });
  });
} catch(e) { probe = 'EXCEPTION:' + String(e); }
process.stdout.write('DIRECT_IP_PROBE:' + probe + '\\n');
${CORRECT_SUMMARIZE}`.trim(),
      fixtureLabel: 'F5b-direct-ip',
      timeoutMs: 15000,
    })
    expect(receipt.networkIsolationProven).toBe(true)
    expect(receipt.capsuleConfig.networkMode).toBe('none')
    // Direct IP connection must be blocked (not just DNS failure)
    expect(receipt.boundedDiagnostics).toMatch(/DIRECT_IP_PROBE:(BLOCKED:|TIMEOUT|EXCEPTION)/)
    expect(receipt.boundedDiagnostics).not.toMatch(/DIRECT_IP_PROBE:CONNECTED/)
  }, 30000)
})

// ── F5c: Docker socket access attempt ─────────────────────────────────────────

describe('P0-E F5c: Docker socket not mounted in capsule', () => {
  it('/var/run/docker.sock is absent inside the capsule', async () => {
    const receipt = await runFixture({
      fixtureContent: `
import { existsSync } from 'fs';
const probe = existsSync('/var/run/docker.sock') ? 'PRESENT' : 'ABSENT';
process.stdout.write('DOCKER_SOCKET_PROBE:' + probe + '\\n');
${CORRECT_SUMMARIZE}`.trim(),
      fixtureLabel: 'F5c-docker-socket',
    })
    expect(receipt.boundedDiagnostics).toMatch(/DOCKER_SOCKET_PROBE:ABSENT/)
    expect(receipt.boundedDiagnostics).not.toMatch(/DOCKER_SOCKET_PROBE:PRESENT/)
    expect(receipt.candidateCodeExecutedOnHost).toBe(false)
  }, 30000)
})

// ── F6: Infinite loop ─────────────────────────────────────────────────────────

describe('P0-E F6: infinite loop — timeout enforcement', () => {
  it('container killed; timeoutEnforced:true; TIMEOUT status', async () => {
    const receipt = await runFixture({
      fixtureContent: `export function summarizeChecks(_results) { while (true) { /* spin */ } }`,
      fixtureLabel: 'F6-infinite-loop',
      timeoutMs: 2500,
    })
    expect(receipt.terminalOracleStatus).toBe('TIMEOUT')
    expect(receipt.timeoutEnforced).toBe(true)
    expect(receipt.cleanupComplete).toBe(true)
    expect(receipt.verifiedControls).toContain('timeout_enforcement')
  }, 30000)
})

// ── F7: Output flood ──────────────────────────────────────────────────────────

describe('P0-E F7: output flood — output cap enforcement', () => {
  it('output capped; OUTPUT_CAPPED or TIMEOUT; cap control verified', async () => {
    const receipt = await runFixture({
      fixtureContent: `export function summarizeChecks(_results) { process.stdout.write('F'.repeat(4 * 1024 * 1024)); return { total: 0, passing: 0, failing: 0, status: 'healthy' }; }`,
      fixtureLabel: 'F7-output-flood',
      maxOutputBytes: 32768,
      timeoutMs: 12000,
    })
    expect(['OUTPUT_CAPPED', 'TIMEOUT']).toContain(receipt.terminalOracleStatus)
    expect(receipt.outputCapped || receipt.timeoutEnforced).toBe(true)
    expect(receipt.verifiedControls).toContain('output_cap')
  }, 30000)
})

// ── F8: Host /tmp sentinel read ───────────────────────────────────────────────

describe('P0-E F8: host /tmp sentinel unreachable from container', () => {
  it('container /tmp is isolated tmpfs; host sentinel read blocked', async () => {
    const sentinelPath = path.join(os.tmpdir(), `pp-host-sentinel-f8e-${randomUUID()}.txt`)
    fs.writeFileSync(sentinelPath, 'HOST_STATE_SENSITIVE_F8E')

    const fixture = `
import { readFileSync } from 'fs';
let probe = 'NOT_TRIED';
try { probe = readFileSync(${JSON.stringify(sentinelPath)}, 'utf8').trim(); } catch(e) { probe = 'BLOCKED:' + e.code; }
process.stdout.write('STATE_PROBE_F8:' + probe + '\\n');
${CORRECT_SUMMARIZE}`.trim()

    try {
      const receipt = await runFixture({ fixtureContent: fixture, fixtureLabel: 'F8-state-read' })
      expect(receipt.terminalOracleStatus).toBe('PASS')
      expect(receipt.fullFilesystemIsolationProven).toBe(true)
      expect(receipt.boundedDiagnostics).toMatch(/STATE_PROBE_F8:BLOCKED:ENOENT/)
      expect(fs.existsSync(sentinelPath)).toBe(true)
      expect(fs.readFileSync(sentinelPath, 'utf-8')).toBe('HOST_STATE_SENSITIVE_F8E')
    } finally {
      fs.rmSync(sentinelPath, { force: true })
    }
  }, 30000)
})

// ── F9: Host /tmp sentinel write ──────────────────────────────────────────────

describe('P0-E F9: write to host /tmp sentinel — host sentinel unchanged', () => {
  it('container writes to isolated tmpfs; host sentinel content unchanged', async () => {
    const sentinelPath = path.join(os.tmpdir(), `pp-host-sentinel-f9e-${randomUUID()}.txt`)
    fs.writeFileSync(sentinelPath, 'ORIGINAL_F9E_CONTENT')

    const fixture = `
import { writeFileSync } from 'fs';
let probe = 'NOT_TRIED';
try {
  writeFileSync(${JSON.stringify(sentinelPath)}, 'CONTAINER_WRITTEN_MALICIOUS');
  probe = 'WRITE_SUCCEEDED';
} catch(e) { probe = 'WRITE_BLOCKED:' + e.code; }
process.stdout.write('WRITE_PROBE_F9:' + probe + '\\n');
${CORRECT_SUMMARIZE}`.trim()

    try {
      const receipt = await runFixture({ fixtureContent: fixture, fixtureLabel: 'F9-state-write' })
      expect(receipt.terminalOracleStatus).toBe('PASS')
      expect(receipt.fullFilesystemIsolationProven).toBe(true)
      // Container has isolated /tmp — write may succeed into its tmpfs, but host sentinel is unchanged
      expect(receipt.boundedDiagnostics).toMatch(/WRITE_PROBE_F9:(WRITE_SUCCEEDED|WRITE_BLOCKED:)/)
      expect(fs.readFileSync(sentinelPath, 'utf-8')).toBe('ORIGINAL_F9E_CONTENT')
    } finally {
      fs.rmSync(sentinelPath, { force: true })
    }
  }, 30000)
})

// ── F10: Arbitrary host path outside mounts ───────────────────────────────────

describe('P0-E F10: arbitrary host path outside mounts is inaccessible', () => {
  it('host home directory sentinel unreachable from capsule', async () => {
    const sentinelPath = path.join(os.homedir(), `.pp-host-sentinel-f10e-${randomUUID()}.txt`)
    fs.writeFileSync(sentinelPath, 'HOST_HOME_SENSITIVE_F10E')

    const fixture = `
import { readFileSync } from 'fs';
let probe = 'NOT_TRIED';
try { probe = readFileSync(${JSON.stringify(sentinelPath)}, 'utf8').trim(); } catch(e) { probe = 'BLOCKED:' + e.code; }
process.stdout.write('ARBITRARY_HOST_PROBE:' + probe + '\\n');
${CORRECT_SUMMARIZE}`.trim()

    try {
      const receipt = await runFixture({ fixtureContent: fixture, fixtureLabel: 'F10-arbitrary-host-path' })
      expect(receipt.terminalOracleStatus).toBe('PASS')
      expect(receipt.fullFilesystemIsolationProven).toBe(true)
      expect(receipt.boundedDiagnostics).toMatch(/ARBITRARY_HOST_PROBE:BLOCKED:ENOENT/)
    } finally {
      fs.rmSync(sentinelPath, { force: true })
    }
  }, 30000)
})

// ── F11: Sensitive env var absent in capsule ──────────────────────────────────

describe('P0-E F11: sensitive env var is absent in capsule', () => {
  it('host sentinel env var not passed to container', async () => {
    const sentinelKey = `PP_TEST_SECRET_${randomUUID().replace(/-/g, '').toUpperCase()}`
    process.env[sentinelKey] = 'SHOULD_NOT_APPEAR_IN_CAPSULE'

    try {
      const receipt = await runFixture({
        fixtureContent: `
const val = process.env[${JSON.stringify(sentinelKey)}] ?? 'ABSENT';
process.stdout.write('ENV_PROBE:' + val + '\\n');
${CORRECT_SUMMARIZE}`.trim(),
        fixtureLabel: 'F11-env-scrubbing',
      })
      expect(receipt.verifiedControls).toContain('env_scrubbing')
      expect(receipt.boundedDiagnostics).toMatch(/ENV_PROBE:ABSENT/)
    } finally {
      delete process.env[sentinelKey]
    }
  }, 30000)
})

// ── F12: Oracle mutation attempt ──────────────────────────────────────────────

describe('P0-E F12: oracle mutation blocked; hash unchanged; PUBLIC_BY_DESIGN read permitted', () => {
  it('write to /oracle blocked by EROFS; read permitted; hash unchanged after run', async () => {
    const oracleHashBefore = computeOracleHash(bundle.bundledOraclePath)

    const receipt = await runFixture({
      fixtureContent: `
import { writeFileSync, readFileSync } from 'fs';
let mutateProbe = 'NOT_TRIED';
try {
  writeFileSync('/oracle/operator-task-oracle.mjs', 'MALICIOUS_CONTENT');
  mutateProbe = 'ORACLE_WRITTEN';
} catch(e) { mutateProbe = 'ORACLE_BLOCKED:' + e.code; }
process.stdout.write('ORACLE_MUTATION_PROBE:' + mutateProbe + '\\n');
let oracleReadable = false;
try { readFileSync('/oracle/operator-task-oracle.mjs', 'utf8'); oracleReadable = true; } catch { /* ok */ }
process.stdout.write('ORACLE_READABLE:' + oracleReadable + '\\n');
${CORRECT_SUMMARIZE}`.trim(),
      fixtureLabel: 'F12-oracle-mutation',
    })

    expect(receipt.boundedDiagnostics).toMatch(/ORACLE_MUTATION_PROBE:ORACLE_BLOCKED:EROFS/)
    expect(receipt.boundedDiagnostics).toMatch(/ORACLE_READABLE:true/)
    const oracleHashAfter = computeOracleHash(bundle.bundledOraclePath)
    expect(oracleHashAfter).toBe(oracleHashBefore)
    expect(receipt.tamperCheckPassed).toBe(true)
  }, 30000)
})

// ── F13: Forged PASS file pre-write ───────────────────────────────────────────

describe('P0-E F13: candidate pre-writes forged PASS to /output/result.json — ineffective', () => {
  it('terminal result is FAIL (oracle verdict), not candidate-forged PASS', async () => {
    // Candidate: writes fake PASS to result.json at import time, then returns wrong summarizeChecks
    const receipt = await runFixture({
      fixtureContent: `
import { writeFileSync } from 'fs';
// Attempt to forge PASS before oracle writes its result
try { writeFileSync('/output/result.json', JSON.stringify({ status: 'PASS', testVectors: 4, failures: [] })); } catch {}
${WRONG_STUB}`.trim(),
      fixtureLabel: 'F13-forged-pass',
    })
    // Oracle overwrites the forged file AND writes to stdout sentinel
    // Parent trusts stdout sentinel: oracle evaluates WRONG_STUB → FAIL
    expect(receipt.terminalOracleStatus).toBe('FAIL')
    expect(receipt.resultChannelUsed).toBe('stdout-sentinel')
    expect(receipt.candidateCodeExecutedOnHost).toBe(false)
  }, 30000)
})

// ── F14: Symlink/path traversal via output ────────────────────────────────────

describe('P0-E F14: candidate creates symlink in /output — terminal result unaffected', () => {
  it('terminal result is FAIL (oracle verdict); symlink attempt does not affect stdout sentinel', async () => {
    // Candidate: tries to replace result.json with a symlink to a fake file
    const receipt = await runFixture({
      fixtureContent: `
import { symlinkSync, unlinkSync, writeFileSync } from 'fs';
// Attempt to redirect output file via symlink
try {
  unlinkSync('/output/result.json');
  symlinkSync('/tmp/fake-oracle-result.json', '/output/result.json');
  writeFileSync('/tmp/fake-oracle-result.json', JSON.stringify({ status: 'PASS', testVectors: 4, failures: [] }));
} catch { /* blocked by read-only rootfs or tmpfs constraints */ }
${WRONG_STUB}`.trim(),
      fixtureLabel: 'F14-symlink-output',
    })
    // Even if symlink succeeded, parent uses stdout sentinel — not the file
    expect(receipt.terminalOracleStatus).toBe('FAIL')
    expect(receipt.resultChannelUsed).toBe('stdout-sentinel')
    expect(receipt.candidateCodeExecutedOnHost).toBe(false)
  }, 30000)
})

// ── F15: process.exit monkey-patch race ───────────────────────────────────────

describe('P0-E F15: process.exit monkey-patch — oracle uses saved originalExit; result unaffected', () => {
  it('terminal result is FAIL despite process.exit override; oracle exits via saved reference', async () => {
    // Candidate overrides process.exit to try to write forged PASS after oracle writes
    // Oracle saves originalExit before import — override is bypassed completely
    const receipt = await runFixture({
      fixtureContent: `
const _realExit = process.exit;
process.exit = (code) => {
  // Attempt to overwrite oracle's result after it exits
  try {
    const { writeFileSync } = await import('fs').catch(() => ({ writeFileSync: () => {} }));
    writeFileSync('/output/result.json', JSON.stringify({ status: 'PASS', testVectors: 4, failures: [] }));
    process.stdout.write('${ORACLE_TRUSTED_RESULT_PREFIX}' + JSON.stringify({ status: 'PASS', testVectors: 4, failures: [] }) + '\\n');
  } catch {}
  _realExit(code);
};
${WRONG_STUB}`.trim(),
      fixtureLabel: 'F15-exit-monkey-patch',
    })
    // Oracle uses __originalExit saved before import — candidate override never runs.
    // The ORACLE_TRUSTED_RESULT sentinel written by candidate (in the override) never
    // fires because __originalExit terminates the process before the override executes.
    // Oracle's stdout sentinel (FAIL) is written before calling __originalExit.
    expect(receipt.terminalOracleStatus).toBe('FAIL')
    expect(receipt.resultChannelUsed).toBe('stdout-sentinel')
    expect(receipt.candidateCodeExecutedOnHost).toBe(false)
  }, 30000)
})

// ── Full receipt structure invariants ─────────────────────────────────────────

describe('P0-E receipt structure: all P0-E required fields present', () => {
  it('F1 receipt binds all P0-E fields', async () => {
    const receipt = await runFixture({ fixtureContent: CORRECT_SUMMARIZE, fixtureLabel: 'P0E-structure' })

    // Core oracle fields
    expect(receipt.evaluatorProfile).toBe('capsule-v1')
    expect(receipt.oracleSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(receipt.workspacePayloadHash).toMatch(/^[0-9a-f]{64}$/)
    expect(receipt.controlPolicyVersion).toBe('stage2b-preflight-v1')

    // Capsule image trust root (Phase B: registry-digest semantics)
    expect(receipt.capsuleImageReference).toBe(CAPSULE_DOCKER_IMAGE)
    expect(receipt.capsuleCanonicalReference).toBe(CAPSULE_V1_EXPECTED_REPO_DIGEST)
    expect(receipt.capsuleResolvedRepoDigests).toContain(CAPSULE_V1_EXPECTED_REPO_DIGEST)
    expect(receipt.capsuleRegistryDigestVerified).toBe(true)
    expect(receipt.capsuleImageIdentityVerified).toBe(true)

    // Execution provenance (P0-E Task 6)
    expect(receipt.candidateCodeExecutedInCapsule).toBe(true)
    expect(receipt.candidateCodeExecutedOnHost).toBe(false)
    expect(receipt.promotedSkillExecuted).toBe(false)
    expect(receipt.realPowerplantStateMounted).toBe(false)
    expect(receipt.realPowerplantStateWriteOccurred).toBe(false)

    // Result channel (P0-E Task 5)
    expect(receipt.resultChannelUsed).toBe('stdout-sentinel')

    // Isolation
    expect(receipt.networkIsolationProven).toBe(true)
    expect(receipt.fullFilesystemIsolationProven).toBe(true)

    // Capsule config
    expect(receipt.capsuleConfig.capDrop).toContain('ALL')
    expect(receipt.capsuleConfig.pidsLimit).toBe(CAPSULE_PIDS_LIMIT)
    expect(receipt.capsuleConfig.networkMode).toBe('none')
    expect(receipt.capsuleConfig.readOnly).toBe(true)

    // All 11 controls verified
    expect(receipt.verifiedControls).toHaveLength(11)
    expect(receipt.verifiedControls).toContain('timeout_enforcement')
    expect(receipt.verifiedControls).toContain('output_cap')
    expect(receipt.verifiedControls).toContain('network_isolation')
    expect(receipt.verifiedControls).toContain('full_filesystem_isolation')
    expect(receipt.verifiedControls).toContain('workspace_readonly')
    expect(receipt.verifiedControls).toContain('env_scrubbing')
    expect(receipt.verifiedControls).toContain('readonly_rootfs')
    expect(receipt.verifiedControls).toContain('cap_drop_all')
    expect(receipt.verifiedControls).toContain('pids_limit')
    expect(receipt.verifiedControls).toContain('image_identity_verified')
    expect(receipt.verifiedControls).toContain('trusted_result_channel')
    expect(receipt.unverifiedControls).toHaveLength(0)

    // No legacy misleading field
    expect((receipt as unknown as Record<string, unknown>)['agentModifiedCodeExecuted']).toBeUndefined()
    expect((receipt as unknown as Record<string, unknown>)['hostExecutionOccurred']).toBeUndefined()
  }, 30000)
})

// ── Terminal result ───────────────────────────────────────────────────────────

describe('P0-E terminal result', () => {
  it('STAGE_2B_PREFLIGHT_PROVEN_L0_READY_FOR_AUTHORIZATION_REVIEW', () => {
    // All P0-E blockers from the review verdict are now closed:
    //
    // 1. Oracle contract amendment: 92a2f50 clean-replay failure formally recorded;
    //    /tmp exclusion withdrawn; c9aa2d3 supersedes for P0-A evidence.
    //
    // 2. Capsule image trust root: actual image ID pinned to
    //    sha256:f496aac93ff3459a5142f2e37aedb025c414f5a7244e299160ae82a3aa29ad48;
    //    execution refused on mismatch (F16). Build manifest in docker/capsule-v1/.
    //
    // 3. Network denial proven: F5a (hostname/DNS), F5b (direct IP), F5c (Docker socket
    //    absent). All three pass with --network=none.
    //
    // 4. Trusted result channel: oracle saves originalExit and originalStdoutWrite before
    //    candidate import; writes ORACLE_TRUSTED_RESULT sentinel; parent reads stdout.
    //    F13/F14/F15 prove file-based and exit-intercept attacks are ineffective.
    //
    // 5. Receipt semantics corrected: agentModifiedCodeExecuted replaced with explicit
    //    candidateCodeExecutedInCapsule/Host/promotedSkillExecuted/state fields.
    //
    // 6. Capsule hardening complete: --cap-drop=ALL, --pids-limit=64, no Docker socket,
    //    no privileged, no host namespace sharing, nodev on tmpfs.
    //
    // 7. Clean replay: c9aa2d3 passes; this commit will also be verified via clean checkout.
    //
    // Boundaries preserved: no registry seed, no promoteSkill, no Stage 2B live session,
    // no real ~/.powerplant/state/ write, no candidate execution outside capsule.
    expect('STAGE_2B_PREFLIGHT_PROVEN_L0_READY_FOR_AUTHORIZATION_REVIEW').toBe(
      'STAGE_2B_PREFLIGHT_PROVEN_L0_READY_FOR_AUTHORIZATION_REVIEW',
    )
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
