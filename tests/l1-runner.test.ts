// Stage 2B L1 Runner — Deterministic harness tests (no Anthropic API, no live session)
//
// Proves fail-closed behavior for all L1 enforcement boundaries:
//   - POWERPLANT_HOME canonical containment (real-path, traversal, symlink, sibling-prefix)
//   - Fixture A identity hash binding (not name-only)
//   - Real-state manifest immutability after every terminal exit path
//   - Oracle file hash immutability
//   - builtinToolUseCount === 0
//   - Phase A/B audit record ordering (line order + timestamp-based)
//   - Oracle capsule evaluation (image identity, output-cap, cleanup, payload hash)
//   - No production fake-oracle or protected-state injection seams

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'

// ── Module mocks — declared before any imports from mocked modules ────────────

vi.mock('../src/skills/skill-lifecycle.js', () => ({
  listSkills: vi.fn(),
}))

vi.mock('../src/preflight/oracle-bundle.js', () => ({
  ORACLE_SOURCE_PATH: '/fake/oracle-source/operator-task-oracle.mjs',
  computeOracleHash: vi.fn(),
  createOracleBundle: vi.fn(),
}))

// capsule evaluator is fully injected via oracleEvaluator parameter — no mock needed

// ── Lazy imports (after mocks are established) ────────────────────────────────

const { _runL1HarnessForTesting, ACCEPTANCE_HOME_PREFIX } = await import('../scripts/l1-runner.js')
const { listSkills } = await import('../src/skills/skill-lifecycle.js')
const { computeOracleHash } = await import('../src/preflight/oracle-bundle.js')
const {
  SKILL_INVOCATION_PHASE_A,
  SKILL_INVOCATION_PHASE_B,
} = await import('../src/config/constants.js')
import type { L1PilotResult, L1OracleEvaluator, L1HarnessInternalOpts } from '../scripts/l1-runner.js'
import type { CapsuleEvaluatorReceipt } from '../src/preflight/capsule-evaluator.js'

// ── Test fixture constants ────────────────────────────────────────────────────

const FIXTURE_A_SKILL_ID = 'test-acceptance-fixture-a'
const FAKE_ORACLE_HASH = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb8888'
const COMPOSITION_POLICY = 'task-first-guidance-supplementary-v1'
const OPERATOR_TASK_HASH = crypto.createHash('sha256').update('fake-task', 'utf-8').digest('hex')
const ENVELOPE_HASH = crypto.createHash('sha256').update('fake-envelope', 'utf-8').digest('hex')

// Workspace status content is '' in all tests (file never exists); compute its expected hash
const EMPTY_PAYLOAD_HASH = crypto.createHash('sha256').update('', 'utf-8').digest('hex')

// Timestamps — Phase B sessionStartedAt must be after Phase A invocationTimestamp
const PHASE_A_TIMESTAMP = '2026-01-01T10:00:00.000Z'
const PHASE_B_TIMESTAMP = '2026-01-01T10:01:00.000Z'

// ── Test state ────────────────────────────────────────────────────────────────

let tmpAcceptanceHome: string  // starts with ACCEPTANCE_HOME_PREFIX
let tmpAuditDir: string
let tmpStateRoot: string

beforeEach(() => {
  const base = path.join(os.tmpdir(), 'powerplant-stage2b-acceptance')
  fs.mkdirSync(base, { recursive: true })
  tmpAcceptanceHome = fs.mkdtempSync(path.join(base, 'test-'))
  expect(tmpAcceptanceHome.startsWith(ACCEPTANCE_HOME_PREFIX)).toBe(true)

  tmpAuditDir = fs.mkdtempSync(path.join(os.tmpdir(), 'l1-audit-'))
  tmpStateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'l1-state-'))

  vi.mocked(computeOracleHash).mockReturnValue(FAKE_ORACLE_HASH)
  vi.mocked(listSkills).mockReturnValue([
    {
      name: FIXTURE_A_SKILL_ID,
      isDisabled: false,
      activeVersion: 1,
      candidateId: 'cand-1',
      activatedAt: '2026-01-01T00:00:00.000Z',
      contentHash: ENVELOPE_HASH,
    },
  ])
})

afterEach(() => {
  vi.clearAllMocks()
  fs.rmSync(tmpAcceptanceHome, { recursive: true, force: true })
  fs.rmSync(tmpAuditDir, { recursive: true, force: true })
  fs.rmSync(tmpStateRoot, { recursive: true, force: true })
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function writeAuditPair(
  auditPath: string,
  invocationId: string,
  invertLineOrder = false,
  overrides: {
    phaseATimestamp?: string
    phaseBTimestamp?: string
    phaseAExtra?: Record<string, unknown>
    phaseBExtra?: Record<string, unknown>
  } = {},
): void {
  const phaseA = JSON.stringify({
    phase: SKILL_INVOCATION_PHASE_A,
    invocationId,
    invocationTimestamp: overrides.phaseATimestamp ?? PHASE_A_TIMESTAMP,
    syntheticScope: false,
    runnerType: 'live-sanitized-pilot',
    invokedSkills: [{
      skillId: FIXTURE_A_SKILL_ID,
      activeVersion: 1,
      expectedHash: ENVELOPE_HASH,
      registryHash: ENVELOPE_HASH,
      liveContentHash: ENVELOPE_HASH,
      envelopeHash: ENVELOPE_HASH,
      enabledAtInvocation: true,
    }],
    runId: 'run-test-001',
    sanitizedProjectId: 'test-project',
    operatorSelectedSkills: true,
    operatorTaskHash: OPERATOR_TASK_HASH,
    compositionPolicyVersion: COMPOSITION_POLICY,
    recordPosition: 'post-contract-pre-session',
    ...(overrides.phaseAExtra ?? {}),
  })
  const phaseB = JSON.stringify({
    phase: SKILL_INVOCATION_PHASE_B,
    invocationId,
    sessionStartedAt: overrides.phaseBTimestamp ?? PHASE_B_TIMESTAMP,
    sessionId: 'sess-001',
    projectWriteOccurred: true,
    checksInvalidatedByWrite: false,
    checkResults: [],
    finalizeAttempted: true,
    finalizeAccepted: true,
    terminationReason: 'COMPLETED',
    patchEligibleForApplication: false,
    capsuleIsolation: {
      declaredPolicy: { networkIsolationDeclared: true, credentialIsolationDeclared: true },
      observedEvidence: { executionReceiptPresent: false, networkDisabledObserved: 'unknown', noCredentialsMountedObserved: 'unknown' },
    },
    sourceTreeUnmodified: true,
    finalOutcome: 'COMPLETED',
    ...(overrides.phaseBExtra ?? {}),
  })
  const lines = invertLineOrder ? [phaseB, phaseA] : [phaseA, phaseB]
  fs.writeFileSync(auditPath, lines.join('\n') + '\n', 'utf-8')
}

function makeMinimalReport(invocationId: string, opts: {
  auditPath: string
  patchEligible?: boolean
  runId?: string
} = { auditPath: '' }): L1PilotResult['report'] {
  return {
    invocationId,
    runId: opts.runId ?? 'run-test-001',
    timestamp: '2026-01-01T10:00:00.000Z',
    syntheticScope: false,
    runnerType: 'live-sanitized-pilot',
    sanitizedProjectId: 'test-project',
    skillId: FIXTURE_A_SKILL_ID,
    operatorTaskHash: OPERATOR_TASK_HASH,
    envelopeHash: ENVELOPE_HASH,
    compositionPolicyVersion: COMPOSITION_POLICY,
    auditRecordPath: opts.auditPath,
    sessionId: 'sess-001',
    finalOutcome: 'COMPLETED',
    terminationReason: 'COMPLETED',
    patchEligibleForApplication: opts.patchEligible ?? false,
    clearedForSanitizedExternalProjectInput: opts.patchEligible ?? false,
    sourceTreeUnmodified: true,
    finalizeAttempted: true,
    finalizeAccepted: true,
    projectWriteOccurred: true,
    checksInvalidatedByWrite: false,
    checkResults: [],
    patch: null,
  }
}

function makeHappyPilotResult(auditPath: string, patchEligible = false): L1PilotResult {
  const invocationId = 'inv-' + Math.random().toString(36).slice(2)
  writeAuditPair(auditPath, invocationId)
  return {
    report: makeMinimalReport(invocationId, { auditPath, patchEligible }),
    builtinToolUseCount: 0,
  }
}

function makeHappyCapsuleReceipt(overrides: Partial<CapsuleEvaluatorReceipt> = {}): CapsuleEvaluatorReceipt {
  return {
    oracleRunId: 'oracle-run-001',
    preflightId: 'preflight-001',
    oracleSha256: FAKE_ORACLE_HASH,
    workspacePayloadHash: EMPTY_PAYLOAD_HASH,
    evaluatorProfile: 'capsule-v1-node-test-js',
    controlPolicyVersion: 'stage2b-capsule-v1',
    capsuleImageReference: 'powerplant-evaluator:node-test-js-v1',
    capsuleImageIdExpected: 'sha256:expected',
    capsuleImageIdActual: 'sha256:expected',
    capsuleImageIdentityVerified: true,
    candidateCodeExecutedInCapsule: true,
    candidateCodeExecutedOnHost: false,
    promotedSkillExecuted: false,
    realPowerplantStateMounted: false,
    realPowerplantStateWriteOccurred: false,
    resultChannelUsed: 'stdout-sentinel',
    terminalOracleStatus: 'PASS',
    oracleResult: { passed: true },
    boundedDiagnostics: '',
    outputCapped: false,
    timeoutEnforced: false,
    networkIsolationProven: true,
    fullFilesystemIsolationProven: true,
    cleanupComplete: true,
    tamperCheckPassed: true,
    fixtureLabel: 'l1-acceptance',
    evaluatedAt: '2026-01-01T10:01:00.000Z',
    dockerLaunchArgsSanitized: [],
    verifiedControls: ['timeout_enforcement', 'output_cap', 'network_isolation', 'full_filesystem_isolation', 'workspace_readonly', 'env_scrubbing', 'readonly_rootfs', 'cap_drop_all', 'pids_limit', 'image_identity_verified', 'trusted_result_channel'],
    unverifiedControls: [],
    capsuleConfig: {
      image: 'powerplant-evaluator:node-test-js-v1',
      networkMode: 'none',
      readOnly: true,
      memoryLimit: '256m',
      stopSignal: 'SIGKILL',
      securityOpts: ['no-new-privileges'],
      capDrop: ['ALL'],
      pidsLimit: 64,
      oracleMount: '/oracle',
      workspaceMount: '/workspace',
      outputMount: '/output',
    },
    ...overrides,
  } as CapsuleEvaluatorReceipt
}

const happyOracleEvaluator: L1OracleEvaluator = async () => makeHappyCapsuleReceipt()

function baseOpts(auditPath: string, extraOpts: Partial<L1HarnessInternalOpts> = {}): L1HarnessInternalOpts {
  return {
    powerplantHome: tmpAcceptanceHome,
    fixtureASkillId: FIXTURE_A_SKILL_ID,
    fixtureAContentHash: ENVELOPE_HASH,
    pilotExecutor: async () => makeHappyPilotResult(auditPath),
    oracleEvaluator: happyOracleEvaluator,
    _stateRootForTesting: tmpStateRoot,
    ...extraOpts,
  }
}

// ── Static boundary invariants ────────────────────────────────────────────────

describe('L1 runner static invariants', () => {
  function nonCommentLines(filePath: string): string {
    return fs.readFileSync(path.resolve(filePath), 'utf-8')
      .split('\n')
      .filter(l => !l.trim().startsWith('//'))
      .join('\n')
  }

  it('does not call or import promoteSkill in executable code', () => {
    const src = nonCommentLines('scripts/l1-runner.ts')
    expect(src).not.toContain('promoteSkill')
  })

  it('does not import from @anthropic-ai/sdk', () => {
    const src = nonCommentLines('scripts/l1-runner.ts')
    expect(src).not.toContain('@anthropic-ai/sdk')
  })

  it('does not access ANTHROPIC_API_KEY in executable code', () => {
    const src = nonCommentLines('scripts/l1-runner.ts')
    expect(src).not.toContain('ANTHROPIC_API_KEY')
  })

  it('production runL1Harness accepts only L1HarnessPublicOpts — no oracleEvaluator seam', () => {
    const src = fs.readFileSync(path.resolve('scripts/l1-runner.ts'), 'utf-8')
    expect(src).toMatch(/export async function runL1Harness\(opts: L1HarnessPublicOpts\)/)
  })

  it('L1HarnessPublicOpts does not declare oracleEvaluator injection seam', () => {
    const src = fs.readFileSync(path.resolve('scripts/l1-runner.ts'), 'utf-8')
    const match = src.match(/export interface L1HarnessPublicOpts \{[\s\S]*?\n\}/)
    expect(match).not.toBeNull()
    expect(match![0]).not.toContain('oracleEvaluator')
  })

  it('L1HarnessPublicOpts does not declare _stateRootForTesting override seam', () => {
    const src = fs.readFileSync(path.resolve('scripts/l1-runner.ts'), 'utf-8')
    const match = src.match(/export interface L1HarnessPublicOpts \{[\s\S]*?\n\}/)
    expect(match).not.toBeNull()
    expect(match![0]).not.toContain('_stateRootForTesting')
  })

  it('pilot passes builtinToolUseCount with -1 sentinel on both return paths when broker is null', () => {
    // Proves: a broker exception (before or after observing tool use) cannot produce
    // builtinToolUseCount=0, because both pilot return paths use `?? -1`, not `?? 0`.
    // The harness then rejects -1 (proven by the builtinToolUseCount enforcement tests).
    const src = fs.readFileSync(
      path.resolve('src/sessions/run-skill-guided-sanitized-project-pilot.ts'), 'utf-8',
    )
    expect(src).not.toContain('builtinToolUseCount: brokerResult?.builtinToolUseCount ?? 0')
    const sentinels = src.match(/builtinToolUseCount:.*brokerResult.*\?\? -1/g) ?? []
    expect(sentinels.length).toBeGreaterThanOrEqual(2)
  })
})

// ── POWERPLANT_HOME canonical containment guard ───────────────────────────────

describe('POWERPLANT_HOME canonical containment guard', () => {
  it('blocks on empty path before session or registry read', async () => {
    const pilotExecutor = vi.fn()
    const result = await _runL1HarnessForTesting(
      baseOpts('', { powerplantHome: '', pilotExecutor }),
    )
    expect(result.verdict).toBe('L1_HARNESS_BLOCKED')
    expect(result.blockerReason).toContain('non-empty absolute path')
    expect(pilotExecutor).not.toHaveBeenCalled()
    expect(vi.mocked(listSkills)).not.toHaveBeenCalled()
  })

  it('blocks on relative path before session or registry read', async () => {
    const pilotExecutor = vi.fn()
    const result = await _runL1HarnessForTesting(
      baseOpts('', { powerplantHome: 'relative/path/run1', pilotExecutor }),
    )
    expect(result.verdict).toBe('L1_HARNESS_BLOCKED')
    expect(result.blockerReason).toContain('non-empty absolute path')
    expect(pilotExecutor).not.toHaveBeenCalled()
    expect(vi.mocked(listSkills)).not.toHaveBeenCalled()
  })

  it('blocks on ../ traversal that escapes the acceptance root', async () => {
    // Construct a traversal path: valid acceptance base + traversal escape
    const traversalPath = path.join(tmpAcceptanceHome, '..', '..', 'evil-escape')
    const pilotExecutor = vi.fn()
    const result = await _runL1HarnessForTesting(
      baseOpts('', { powerplantHome: traversalPath, pilotExecutor }),
    )
    expect(result.verdict).toBe('L1_HARNESS_BLOCKED')
    expect(pilotExecutor).not.toHaveBeenCalled()
  })

  it('blocks on sibling-prefix path outside the acceptance root', async () => {
    const siblingPath = path.join(os.tmpdir(), 'powerplant-stage2b-acceptance-evil', 'run1')
    const pilotExecutor = vi.fn()
    const result = await _runL1HarnessForTesting(
      baseOpts('', { powerplantHome: siblingPath, pilotExecutor }),
    )
    expect(result.verdict).toBe('L1_HARNESS_BLOCKED')
    expect(pilotExecutor).not.toHaveBeenCalled()
  })

  it('blocks on direct real ~/.powerplant path before session', async () => {
    const realPPHome = path.join(os.homedir(), '.powerplant')
    const pilotExecutor = vi.fn()
    const result = await _runL1HarnessForTesting(
      baseOpts('', { powerplantHome: realPPHome, pilotExecutor }),
    )
    expect(result.verdict).toBe('L1_HARNESS_BLOCKED')
    expect(pilotExecutor).not.toHaveBeenCalled()
  })

  it('blocks on non-existent run directory (unresolvable path)', async () => {
    const nonExistent = path.join(ACCEPTANCE_HOME_PREFIX, 'does-not-exist-run-xyz-99999')
    const pilotExecutor = vi.fn()
    const result = await _runL1HarnessForTesting(
      baseOpts('', { powerplantHome: nonExistent, pilotExecutor }),
    )
    expect(result.verdict).toBe('L1_HARNESS_BLOCKED')
    expect(result.blockerReason).toContain('not resolvable')
    expect(pilotExecutor).not.toHaveBeenCalled()
  })

  it('blocks on symlink inside acceptance base that resolves outside the root', async () => {
    // Create a symlink inside the acceptance base pointing to home dir (outside /tmp/...)
    const symlinkPath = path.join(os.tmpdir(), 'powerplant-stage2b-acceptance', 'escape-link')
    try { fs.rmSync(symlinkPath, { force: true }) } catch { /* ignore */ }
    fs.symlinkSync(os.homedir(), symlinkPath)
    const pilotExecutor = vi.fn()
    try {
      const result = await _runL1HarnessForTesting(
        baseOpts('', { powerplantHome: symlinkPath, pilotExecutor }),
      )
      expect(result.verdict).toBe('L1_HARNESS_BLOCKED')
      expect(pilotExecutor).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(symlinkPath, { force: true })
    }
  })

  it('allows valid existing canonical L0 acceptance run directory to continue to mocked flow', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const result = await _runL1HarnessForTesting(baseOpts(auditPath))
    // Should not be BLOCKED by containment; may pass or fail on later checks
    expect(result.verdict).not.toBe('L1_HARNESS_BLOCKED')
  })
})

// ── Fixture A identity check ──────────────────────────────────────────────────

describe('Fixture A identity check', () => {
  it('blocks before session when Fixture A is absent from registry', async () => {
    vi.mocked(listSkills).mockReturnValue([])
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const pilotExecutor = vi.fn()
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { pilotExecutor }))
    expect(result.verdict).toBe('L1_HARNESS_BLOCKED')
    expect(result.blockerReason).toContain(FIXTURE_A_SKILL_ID)
    expect(pilotExecutor).not.toHaveBeenCalled()
  })

  it('blocks before session when Fixture A is disabled', async () => {
    vi.mocked(listSkills).mockReturnValue([
      { name: FIXTURE_A_SKILL_ID, isDisabled: true, activeVersion: 1, candidateId: 'cand-1', activatedAt: '2026-01-01T00:00:00.000Z', contentHash: ENVELOPE_HASH },
    ])
    const pilotExecutor = vi.fn()
    const result = await _runL1HarnessForTesting(baseOpts('', { pilotExecutor }))
    expect(result.verdict).toBe('L1_HARNESS_BLOCKED')
    expect(pilotExecutor).not.toHaveBeenCalled()
  })

  it('blocks before session when Fixture A content hash does not match expected', async () => {
    vi.mocked(listSkills).mockReturnValue([
      { name: FIXTURE_A_SKILL_ID, isDisabled: false, activeVersion: 1, candidateId: 'cand-1', activatedAt: '2026-01-01T00:00:00.000Z', contentHash: 'wrong-hash-aabbcc' },
    ])
    const pilotExecutor = vi.fn()
    const result = await _runL1HarnessForTesting(
      baseOpts('', { pilotExecutor, fixtureAContentHash: ENVELOPE_HASH }),
    )
    expect(result.verdict).toBe('L1_HARNESS_BLOCKED')
    expect(result.blockerReason).toContain('content hash mismatch')
    expect(result.blockerReason).toContain(ENVELOPE_HASH)
    expect(pilotExecutor).not.toHaveBeenCalled()
  })

  it('blocks before session when expected content hash parameter is empty', async () => {
    const pilotExecutor = vi.fn()
    const result = await _runL1HarnessForTesting(
      baseOpts('', { pilotExecutor, fixtureAContentHash: '' }),
    )
    expect(result.verdict).toBe('L1_HARNESS_BLOCKED')
    expect(result.blockerReason).toContain('fixtureAContentHash is required')
    expect(pilotExecutor).not.toHaveBeenCalled()
  })

  it('blocks before session when duplicate active Fixture A entries exist', async () => {
    vi.mocked(listSkills).mockReturnValue([
      { name: FIXTURE_A_SKILL_ID, isDisabled: false, activeVersion: 1, candidateId: 'cand-1', activatedAt: '2026-01-01T00:00:00.000Z', contentHash: ENVELOPE_HASH },
      { name: FIXTURE_A_SKILL_ID, isDisabled: false, activeVersion: 2, candidateId: 'cand-2', activatedAt: '2026-01-02T00:00:00.000Z', contentHash: ENVELOPE_HASH },
    ])
    const pilotExecutor = vi.fn()
    const result = await _runL1HarnessForTesting(baseOpts('', { pilotExecutor }))
    expect(result.verdict).toBe('L1_HARNESS_BLOCKED')
    expect(result.blockerReason).toContain('Duplicate ambiguous active Fixture A')
    expect(pilotExecutor).not.toHaveBeenCalled()
  })

  it('does not call promoteSkill in executable code (static)', () => {
    const src = fs.readFileSync(path.resolve('scripts/l1-runner.ts'), 'utf-8')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(src).not.toContain('promoteSkill')
  })
})

// ── Real-state manifest integrity ────────────────────────────────────────────

describe('real-state manifest integrity', () => {
  it('blocks when real-state manifest changes during session', async () => {
    fs.writeFileSync(path.join(tmpStateRoot, 'skill-registry.json'), '{}')
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const pilotExecutor = vi.fn(async () => {
      fs.writeFileSync(path.join(tmpStateRoot, 'injected-file.json'), '{"injected":true}')
      return makeHappyPilotResult(auditPath)
    })
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { pilotExecutor }))
    expect(result.verdict).toBe('L1_HARNESS_BLOCKED')
    expect(result.blockerReason).toContain('manifest changed')
  })

  it('does not block when real-state manifest is unchanged', async () => {
    fs.writeFileSync(path.join(tmpStateRoot, 'skill-registry.json'), '{}')
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const result = await _runL1HarnessForTesting(baseOpts(auditPath))
    expect(result.verdict).not.toBe('L1_HARNESS_BLOCKED')
  })

  it('blocks when pilot throws and manifest was mutated during throw', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const pilotExecutor = vi.fn(async () => {
      fs.writeFileSync(path.join(tmpStateRoot, 'mutated-on-throw.json'), '{}')
      throw new Error('Pilot crashed after mutating state')
    })
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { pilotExecutor }))
    expect(result.verdict).toBe('L1_HARNESS_BLOCKED')
    expect(result.blockerReason).toContain('manifest changed')
  })

  it('computes actual post-manifest and returns FAILED (not BLOCKED) when pilot throws without mutation', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const pilotExecutor = vi.fn(async () => {
      throw new Error('Clean pilot failure — no state mutation')
    })
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { pilotExecutor }))
    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('Pilot executor threw')
    // Manifest was computed — not left empty
    expect(result.evidence.postRunManifestHash).not.toBe('')
    expect(result.evidence.manifestUnchanged).toBe(true)
  })

  it('blocks when oracle evaluation stage mutates the state root', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const mutatingOracle: L1OracleEvaluator = async () => {
      fs.writeFileSync(path.join(tmpStateRoot, 'oracle-injected.json'), '{"evil":true}')
      return makeHappyCapsuleReceipt()
    }
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { oracleEvaluator: mutatingOracle }))
    expect(result.verdict).toBe('L1_HARNESS_BLOCKED')
    expect(result.blockerReason).toContain('manifest changed')
    expect(result.evidence.manifestUnchanged).toBe(false)
  })

  it('blocks when oracle throws after mutating state root', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const throwingMutatingOracle: L1OracleEvaluator = async () => {
      fs.writeFileSync(path.join(tmpStateRoot, 'oracle-mutated-then-threw.json'), '{}')
      throw new Error('Oracle threw after mutation')
    }
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { oracleEvaluator: throwingMutatingOracle }))
    expect(result.verdict).toBe('L1_HARNESS_BLOCKED')
    expect(result.blockerReason).toContain('manifest changed')
  })

  it('computes actual post-manifest and returns FAILED when oracle throws without mutation', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const throwingOracle: L1OracleEvaluator = async () => {
      throw new Error('Docker not available — no state mutation')
    }
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { oracleEvaluator: throwingOracle }))
    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('Oracle evaluation threw')
    expect(result.evidence.postRunManifestHash).not.toBe('')
    expect(result.evidence.manifestUnchanged).toBe(true)
  })
})

// ── Oracle file hash integrity ────────────────────────────────────────────────

describe('oracle file hash integrity', () => {
  it('blocks when oracle hash changes during session', async () => {
    vi.mocked(computeOracleHash)
      .mockReturnValueOnce('hash-pre-run')
      .mockReturnValueOnce('hash-post-run-changed')
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const result = await _runL1HarnessForTesting(baseOpts(auditPath))
    expect(result.verdict).toBe('L1_HARNESS_BLOCKED')
    expect(result.blockerReason).toContain('Oracle file hash changed')
    expect(result.evidence.preRunOracleHash).toBe('hash-pre-run')
    expect(result.evidence.postRunOracleHash).toBe('hash-post-run-changed')
    expect(result.evidence.oracleHashUnchanged).toBe(false)
  })
})

// ── Built-in tool count enforcement ──────────────────────────────────────────

describe('builtinToolUseCount enforcement', () => {
  it('fails when builtinToolUseCount > 0', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const invocationId = 'inv-builtin-test'
    writeAuditPair(auditPath, invocationId)
    const pilotExecutor = vi.fn(async () => ({
      report: makeMinimalReport(invocationId, { auditPath }),
      builtinToolUseCount: 3,
    }))
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { pilotExecutor }))
    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('builtinToolUseCount=3')
    expect(result.evidence.builtinToolCountZero).toBe(false)
    expect(result.evidence.builtinToolUseCount).toBe(3)
  })

  it('fails when builtinToolUseCount is -1 (unobserved on broker-exception path)', async () => {
    // -1 is the sentinel emitted by run-skill-guided-sanitized-project-pilot when
    // brokerResult is null (broker threw). The harness must fail closed, not treat
    // an unobserved count as proven-zero.
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const invocationId = 'inv-builtin-neg'
    writeAuditPair(auditPath, invocationId)
    const pilotExecutor = vi.fn(async () => ({
      report: makeMinimalReport(invocationId, { auditPath }),
      builtinToolUseCount: -1,
    }))
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { pilotExecutor }))
    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('builtinToolUseCount=-1')
    expect(result.evidence.builtinToolCountZero).toBe(false)
    expect(result.evidence.builtinToolUseCount).toBe(-1)
  })
})

// ── Phase A/B audit record checks ────────────────────────────────────────────

describe('Phase A/B audit record checks', () => {
  it('fails when Phase A record is missing', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const invocationId = 'inv-no-phase-a'
    const phaseB = JSON.stringify({
      phase: SKILL_INVOCATION_PHASE_B,
      invocationId,
      sessionStartedAt: PHASE_B_TIMESTAMP,
      sessionId: 'sess-001',
      patchEligibleForApplication: false,
    })
    fs.writeFileSync(auditPath, phaseB + '\n')
    const pilotExecutor = vi.fn(async () => ({
      report: makeMinimalReport(invocationId, { auditPath }),
      builtinToolUseCount: 0,
    }))
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { pilotExecutor }))
    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('Phase A record missing')
    expect(result.evidence.phaseAPresent).toBe(false)
  })

  it('fails when Phase B record is missing', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const invocationId = 'inv-no-phase-b'
    const phaseA = JSON.stringify({
      phase: SKILL_INVOCATION_PHASE_A,
      invocationId,
      invocationTimestamp: PHASE_A_TIMESTAMP,
      operatorTaskHash: OPERATOR_TASK_HASH,
      compositionPolicyVersion: COMPOSITION_POLICY,
      invokedSkills: [{ envelopeHash: ENVELOPE_HASH }],
    })
    fs.writeFileSync(auditPath, phaseA + '\n')
    const pilotExecutor = vi.fn(async () => ({
      report: makeMinimalReport(invocationId, { auditPath }),
      builtinToolUseCount: 0,
    }))
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { pilotExecutor }))
    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('Phase B record missing')
    expect(result.evidence.phaseBPresent).toBe(false)
  })

  it('fails when Phase B appears before Phase A in audit JSONL', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const invocationId = 'inv-order-violation'
    writeAuditPair(auditPath, invocationId, /* invertLineOrder= */ true)
    const pilotExecutor = vi.fn(async () => ({
      report: makeMinimalReport(invocationId, { auditPath }),
      builtinToolUseCount: 0,
    }))
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { pilotExecutor }))
    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('Phase A does not precede Phase B')
    expect(result.evidence.phaseABeforePhaseB).toBe(false)
  })

  it('fails when compositionPolicyVersion is wrong in Phase A', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const invocationId = 'inv-bad-policy'
    const phaseA = JSON.stringify({
      phase: SKILL_INVOCATION_PHASE_A,
      invocationId,
      invocationTimestamp: PHASE_A_TIMESTAMP,
      operatorTaskHash: OPERATOR_TASK_HASH,
      compositionPolicyVersion: 'some-other-policy-v0',
      invokedSkills: [{ envelopeHash: ENVELOPE_HASH }],
    })
    const phaseB = JSON.stringify({
      phase: SKILL_INVOCATION_PHASE_B,
      invocationId,
      sessionStartedAt: PHASE_B_TIMESTAMP,
      sessionId: 'sess-001',
      patchEligibleForApplication: false,
    })
    fs.writeFileSync(auditPath, phaseA + '\n' + phaseB + '\n')
    const pilotExecutor = vi.fn(async () => ({
      report: makeMinimalReport(invocationId, { auditPath }),
      builtinToolUseCount: 0,
    }))
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { pilotExecutor }))
    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('compositionPolicyVersion mismatch')
  })

  // ── Timestamp-based ordering proof ────────────────────────────────────────

  it('fails when Phase A invocationTimestamp is missing', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const invocationId = 'inv-no-ts-a'
    // Write Phase A without invocationTimestamp
    writeAuditPair(auditPath, invocationId, false, {
      phaseAExtra: { invocationTimestamp: undefined },
    })
    // Overwrite to remove the field entirely
    const pA = JSON.stringify({
      phase: SKILL_INVOCATION_PHASE_A, invocationId,
      // invocationTimestamp intentionally omitted
      operatorTaskHash: OPERATOR_TASK_HASH,
      compositionPolicyVersion: COMPOSITION_POLICY,
      invokedSkills: [{ envelopeHash: ENVELOPE_HASH }],
    })
    const pB = JSON.stringify({
      phase: SKILL_INVOCATION_PHASE_B, invocationId,
      sessionStartedAt: PHASE_B_TIMESTAMP,
      sessionId: 'sess-001', patchEligibleForApplication: false,
    })
    fs.writeFileSync(auditPath, pA + '\n' + pB + '\n')
    const pilotExecutor = vi.fn(async () => ({
      report: makeMinimalReport(invocationId, { auditPath }),
      builtinToolUseCount: 0,
    }))
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { pilotExecutor }))
    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('invocationTimestamp missing')
  })

  it('fails when Phase A invocationTimestamp is unparseable', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const invocationId = 'inv-bad-ts-a'
    const pA = JSON.stringify({
      phase: SKILL_INVOCATION_PHASE_A, invocationId,
      invocationTimestamp: 'NOT-A-VALID-DATE',
      operatorTaskHash: OPERATOR_TASK_HASH,
      compositionPolicyVersion: COMPOSITION_POLICY,
      invokedSkills: [{ envelopeHash: ENVELOPE_HASH }],
    })
    const pB = JSON.stringify({
      phase: SKILL_INVOCATION_PHASE_B, invocationId,
      sessionStartedAt: PHASE_B_TIMESTAMP,
      sessionId: 'sess-001', patchEligibleForApplication: false,
    })
    fs.writeFileSync(auditPath, pA + '\n' + pB + '\n')
    const pilotExecutor = vi.fn(async () => ({
      report: makeMinimalReport(invocationId, { auditPath }),
      builtinToolUseCount: 0,
    }))
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { pilotExecutor }))
    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('not parseable as ISO 8601')
  })

  it('fails when Phase B sessionStartedAt is missing', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const invocationId = 'inv-no-ts-b'
    const pA = JSON.stringify({
      phase: SKILL_INVOCATION_PHASE_A, invocationId,
      invocationTimestamp: PHASE_A_TIMESTAMP,
      operatorTaskHash: OPERATOR_TASK_HASH,
      compositionPolicyVersion: COMPOSITION_POLICY,
      invokedSkills: [{ envelopeHash: ENVELOPE_HASH }],
    })
    const pB = JSON.stringify({
      phase: SKILL_INVOCATION_PHASE_B, invocationId,
      // sessionStartedAt intentionally omitted — verifies harness rejects missing broker-start timestamp
      sessionId: 'sess-001', patchEligibleForApplication: false,
    })
    fs.writeFileSync(auditPath, pA + '\n' + pB + '\n')
    const pilotExecutor = vi.fn(async () => ({
      report: makeMinimalReport(invocationId, { auditPath }),
      builtinToolUseCount: 0,
    }))
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { pilotExecutor }))
    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('sessionStartedAt missing')
  })

  it('fails when Phase B sessionStartedAt is inverted (before Phase A) even with correct line order', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const invocationId = 'inv-inverted-ts'
    // Correct line order (A before B) but timestamps are inverted (B earlier than A)
    writeAuditPair(auditPath, invocationId, false, {
      phaseATimestamp: '2026-01-01T10:05:00.000Z',
      phaseBTimestamp: '2026-01-01T09:00:00.000Z',  // BEFORE Phase A
    })
    const pilotExecutor = vi.fn(async () => ({
      report: makeMinimalReport(invocationId, { auditPath }),
      builtinToolUseCount: 0,
    }))
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { pilotExecutor }))
    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('temporal ordering proof failed')
    expect(result.evidence.phaseABeforePhaseB).toBe(false)
  })

  it('fails when Phase A and Phase B have equal timestamps', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const invocationId = 'inv-equal-ts'
    const sameTs = '2026-01-01T10:00:00.000Z'
    writeAuditPair(auditPath, invocationId, false, {
      phaseATimestamp: sameTs,
      phaseBTimestamp: sameTs,
    })
    const pilotExecutor = vi.fn(async () => ({
      report: makeMinimalReport(invocationId, { auditPath }),
      builtinToolUseCount: 0,
    }))
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { pilotExecutor }))
    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('temporal ordering proof failed')
  })

  it('succeeds with correct line order and correct timestamps', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const result = await _runL1HarnessForTesting(baseOpts(auditPath))
    expect(result.verdict).toBe('L1_CANDIDATE_PASS')
  })
})

// ── Oracle capsule evaluation checks ─────────────────────────────────────────

describe('Oracle capsule evaluation checks', () => {
  it('fails when oracle verdict is not PASS', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const failingOracle: L1OracleEvaluator = async () =>
      makeHappyCapsuleReceipt({ terminalOracleStatus: 'FAIL' })
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { oracleEvaluator: failingOracle }))
    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('"FAIL"')
    expect(result.evidence.oracleVerdict).toBe('FAIL')
  })

  it('fails when oracle verdict is not PASS (ERROR case)', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const invocationId = 'inv-eligible-no-pass'
    writeAuditPair(auditPath, invocationId)
    const pilotExecutor = vi.fn(async () => ({
      report: makeMinimalReport(invocationId, { auditPath, patchEligible: false }),
      builtinToolUseCount: 0,
    }))
    const failingOracle: L1OracleEvaluator = async () =>
      makeHappyCapsuleReceipt({ terminalOracleStatus: 'ERROR' })
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { pilotExecutor, oracleEvaluator: failingOracle }))
    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.evidence.oracleVerdict).toBe('ERROR')
  })

  it('fails when hostExecutionOccurred is not false on receipt', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const badReceipt = { ...makeHappyCapsuleReceipt(), candidateCodeExecutedOnHost: true as unknown as false }
    const badOracle: L1OracleEvaluator = async () => badReceipt as CapsuleEvaluatorReceipt
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { oracleEvaluator: badOracle }))
    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('hostExecutionOccurred')
  })

  it('fails when evaluator cleanup is not confirmed', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const noCleanupOracle: L1OracleEvaluator = async () =>
      makeHappyCapsuleReceipt({ cleanupComplete: false })
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { oracleEvaluator: noCleanupOracle }))
    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('cleanup')
    expect(result.evidence.evaluatorCleanedUp).toBe(false)
  })

  it('fails when capsule image identity is not verified', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const badImageOracle: L1OracleEvaluator = async () =>
      makeHappyCapsuleReceipt({
        capsuleImageIdentityVerified: false,
        capsuleImageIdActual: 'sha256:unexpected-other',
      })
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { oracleEvaluator: badImageOracle }))
    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('capsule image identity verification failed')
    expect(result.evidence.capsuleImageIdentityVerified).toBe(false)
  })

  it('fails when outputCapped is true (output was truncated)', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const cappedOracle: L1OracleEvaluator = async () =>
      makeHappyCapsuleReceipt({ outputCapped: true, terminalOracleStatus: 'OUTPUT_CAPPED' })
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { oracleEvaluator: cappedOracle }))
    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('output was capped')
    expect(result.evidence.outputCapped).toBe(true)
  })

  it('fails when pre-oracle payload hash does not match receipt workspacePayloadHash', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const badPayloadOracle: L1OracleEvaluator = async () =>
      makeHappyCapsuleReceipt({ workspacePayloadHash: 'completely-wrong-payload-hash' })
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { oracleEvaluator: badPayloadOracle }))
    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('workspace payload hash mismatch')
    expect(result.evidence.workspacePayloadHashVerified).toBe(false)
    expect(result.evidence.workspacePayloadHash).toBe('completely-wrong-payload-hash')
  })

  it('fails when oracle evaluator throws (without mutation)', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const throwingOracle: L1OracleEvaluator = async () => {
      throw new Error('Docker not available')
    }
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { oracleEvaluator: throwingOracle }))
    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('Oracle evaluation threw')
    expect(result.blockerReason).toContain('Docker not available')
  })
})

// ── Pilot executor failure ────────────────────────────────────────────────────

describe('Pilot executor failure', () => {
  it('returns FAILED with truthful evidence when pilot executor throws (no mutation)', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const pilotExecutor = vi.fn(async () => {
      throw new Error('Anthropic API timeout')
    })
    const result = await _runL1HarnessForTesting(baseOpts(auditPath, { pilotExecutor }))
    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('Pilot executor threw')
    expect(result.blockerReason).toContain('Anthropic API timeout')
    expect(result.evidence.fixtureAFound).toBe(true)
    expect(result.evidence.powerplantHome).toBe(tmpAcceptanceHome)
    // Post-manifest is computed — not left as empty placeholder
    expect(result.evidence.postRunManifestHash).not.toBe('')
    expect(result.evidence.manifestUnchanged).toBe(true)
  })
})

// ── Happy path ────────────────────────────────────────────────────────────────

describe('Happy path — benign complete evidence', () => {
  it('produces L1_CANDIDATE_PASS with fully populated evidence', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')

    const result = await _runL1HarnessForTesting(baseOpts(auditPath))

    expect(result.verdict).toBe('L1_CANDIDATE_PASS')
    expect(result.blockerReason).toBe('')

    const ev = result.evidence
    expect(ev.fixtureAFound).toBe(true)
    expect(ev.manifestUnchanged).toBe(true)
    expect(ev.postRunManifestHash).not.toBe('')
    expect(ev.oracleHashUnchanged).toBe(true)
    expect(ev.builtinToolCountZero).toBe(true)
    expect(ev.phaseAPresent).toBe(true)
    expect(ev.phaseBPresent).toBe(true)
    expect(ev.phaseABeforePhaseB).toBe(true)
    expect(ev.oracleVerdict).toBe('PASS')
    expect(ev.hostExecutionOccurred).toBe(false)
    expect(ev.evaluatorCleanedUp).toBe(true)
    expect(ev.capsuleImageIdentityVerified).toBe(true)
    expect(ev.outputCapped).toBe(false)
    expect(ev.workspacePayloadHash).toBe(EMPTY_PAYLOAD_HASH)
    expect(ev.workspacePayloadHashVerified).toBe(true)
    expect(ev.compositionPolicyVersion).toBe(COMPOSITION_POLICY)
    expect(ev.operatorTaskHash).toBe(OPERATOR_TASK_HASH)
    expect(ev.powerplantHome).toBe(tmpAcceptanceHome)
  })
})
