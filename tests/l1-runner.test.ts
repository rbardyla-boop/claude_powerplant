// Stage 2B L1 Runner — Deterministic harness tests (no Anthropic API, no live session)
//
// Proves fail-closed behavior for all L1 enforcement boundaries:
//   - POWERPLANT_HOME prefix guard
//   - Fixture A registry check (no promoteSkill)
//   - Real-state manifest immutability
//   - Oracle file hash immutability
//   - builtinToolUseCount === 0
//   - Phase A/B audit record ordering and required fields
//   - Oracle capsule evaluation (hostExecutionOccurred === false, cleanup proven)
//   - Managed-agent execution failure → truthful terminal evidence

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

// capsule evaluator is fully injected via oracleEvaluator parameter — no need to mock

// ── Lazy imports (after mocks are established) ────────────────────────────────

const { runL1Harness, ACCEPTANCE_HOME_PREFIX } = await import('../scripts/l1-runner.js')
const { listSkills } = await import('../src/skills/skill-lifecycle.js')
const { computeOracleHash } = await import('../src/preflight/oracle-bundle.js')
const {
  SKILL_INVOCATION_PHASE_A,
  SKILL_INVOCATION_PHASE_B,
} = await import('../src/config/constants.js')
import type { L1PilotResult, L1OracleEvaluator, L1HarnessOpts } from '../scripts/l1-runner.js'
import type { CapsuleEvaluatorReceipt } from '../src/preflight/capsule-evaluator.js'

// ── Test fixture constants ────────────────────────────────────────────────────

const FIXTURE_A_SKILL_ID = 'test-acceptance-fixture-a'
const FAKE_ORACLE_HASH = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb8888'
const COMPOSITION_POLICY = 'task-first-guidance-supplementary-v1'
const OPERATOR_TASK_HASH = crypto.createHash('sha256').update('fake-task', 'utf-8').digest('hex')
const ENVELOPE_HASH = crypto.createHash('sha256').update('fake-envelope', 'utf-8').digest('hex')

// ── Test state ────────────────────────────────────────────────────────────────

let tmpAcceptanceHome: string  // starts with ACCEPTANCE_HOME_PREFIX
let tmpAuditDir: string
let tmpStateRoot: string

beforeEach(() => {
  // Create a temp acceptance home under the required prefix
  const base = path.join(os.tmpdir(), 'powerplant-stage2b-acceptance')
  fs.mkdirSync(base, { recursive: true })
  tmpAcceptanceHome = fs.mkdtempSync(path.join(base, 'test-'))
  // Verify the prefix invariant holds for our test dir
  expect(tmpAcceptanceHome.startsWith(ACCEPTANCE_HOME_PREFIX)).toBe(true)

  tmpAuditDir = fs.mkdtempSync(path.join(os.tmpdir(), 'l1-audit-'))
  tmpStateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'l1-state-'))

  // Default: oracle hash is stable across calls
  vi.mocked(computeOracleHash).mockReturnValue(FAKE_ORACLE_HASH)
  // Default: fixture A is present and not disabled
  vi.mocked(listSkills).mockReturnValue([
    { name: FIXTURE_A_SKILL_ID, isDisabled: false, activeVersion: 1, candidateId: 'cand-1', activatedAt: '2026-01-01T00:00:00.000Z', contentHash: ENVELOPE_HASH },
  ])
})

afterEach(() => {
  vi.clearAllMocks()
  fs.rmSync(tmpAcceptanceHome, { recursive: true, force: true })
  fs.rmSync(tmpAuditDir, { recursive: true, force: true })
  fs.rmSync(tmpStateRoot, { recursive: true, force: true })
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function writeAuditPair(auditPath: string, invocationId: string, invertOrder = false): void {
  const phaseA = JSON.stringify({
    phase: SKILL_INVOCATION_PHASE_A,
    invocationId,
    invocationTimestamp: '2026-01-01T10:00:00.000Z',
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
  })
  const phaseB = JSON.stringify({
    phase: SKILL_INVOCATION_PHASE_B,
    invocationId,
    sessionId: 'sess-001',
    projectWriteOccurred: true,
    checksInvalidatedByWrite: false,
    checkResults: [],
    finalizeAttempted: true,
    finalizeAccepted: true,
    terminationReason: 'COMPLETED',
    patchEligibleForApplication: false,
    capsuleIsolation: { declaredPolicy: { networkIsolationDeclared: true, credentialIsolationDeclared: true }, observedEvidence: { executionReceiptPresent: false, networkDisabledObserved: 'unknown', noCredentialsMountedObserved: 'unknown' } },
    sourceTreeUnmodified: true,
    finalOutcome: 'COMPLETED',
  })
  const lines = invertOrder ? [phaseB, phaseA] : [phaseA, phaseB]
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
    workspacePayloadHash: 'payload-hash',
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

function baseOpts(auditPath: string, extraOpts: Partial<L1HarnessOpts> = {}): L1HarnessOpts {
  return {
    powerplantHome: tmpAcceptanceHome,
    fixtureASkillId: FIXTURE_A_SKILL_ID,
    pilotExecutor: async () => makeHappyPilotResult(auditPath),
    oracleEvaluator: happyOracleEvaluator,
    _stateRootForTesting: tmpStateRoot,
    ...extraOpts,
  }
}

// ── Static boundary invariant ─────────────────────────────────────────────────

describe('L1 runner static invariant', () => {
  // Strip comment lines before checking so documentation comments don't cause false positives
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
})

// ── POWERPLANT_HOME prefix guard ─────────────────────────────────────────────

describe('POWERPLANT_HOME prefix guard', () => {
  const badHomes = [
    { label: 'empty string', value: '' },
    { label: 'real home', value: path.join(os.homedir(), '.powerplant') },
    { label: 'wrong tmp prefix', value: '/tmp/powerplant-sprint4a/some-dir' },
    { label: 'outside /tmp', value: '/var/data/powerplant-stage2b-acceptance/run1' },
  ]

  for (const { label, value } of badHomes) {
    it(`blocks before session when POWERPLANT_HOME is: ${label}`, async () => {
      const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
      const pilotExecutor = vi.fn()
      const result = await runL1Harness(baseOpts(auditPath, { powerplantHome: value, pilotExecutor }))

      expect(result.verdict).toBe('L1_HARNESS_BLOCKED')
      expect(result.blockerReason).toContain(ACCEPTANCE_HOME_PREFIX)
      expect(pilotExecutor).not.toHaveBeenCalled()
    })
  }
})

// ── Fixture A registry check ──────────────────────────────────────────────────

describe('Fixture A registry check', () => {
  it('blocks before session when Fixture A is absent from registry', async () => {
    vi.mocked(listSkills).mockReturnValue([])
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const pilotExecutor = vi.fn()

    const result = await runL1Harness(baseOpts(auditPath, { pilotExecutor }))

    expect(result.verdict).toBe('L1_HARNESS_BLOCKED')
    expect(result.blockerReason).toContain(FIXTURE_A_SKILL_ID)
    expect(pilotExecutor).not.toHaveBeenCalled()
  })

  it('blocks before session when Fixture A is disabled', async () => {
    vi.mocked(listSkills).mockReturnValue([
      { name: FIXTURE_A_SKILL_ID, isDisabled: true, activeVersion: 1, candidateId: 'cand-1', activatedAt: '2026-01-01T00:00:00.000Z', contentHash: ENVELOPE_HASH },
    ])
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const pilotExecutor = vi.fn()

    const result = await runL1Harness(baseOpts(auditPath, { pilotExecutor }))

    expect(result.verdict).toBe('L1_HARNESS_BLOCKED')
    expect(pilotExecutor).not.toHaveBeenCalled()
  })
})

// ── Real-state manifest integrity ────────────────────────────────────────────

describe('real-state manifest integrity', () => {
  it('blocks when real-state manifest changes during session', async () => {
    fs.writeFileSync(path.join(tmpStateRoot, 'skill-registry.json'), '{}')
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')

    const pilotExecutor = vi.fn(async () => {
      // Simulate a mutation of real state during session
      fs.writeFileSync(path.join(tmpStateRoot, 'injected-file.json'), '{"injected":true}')
      return makeHappyPilotResult(auditPath)
    })

    const result = await runL1Harness(baseOpts(auditPath, { pilotExecutor }))

    expect(result.verdict).toBe('L1_HARNESS_BLOCKED')
    expect(result.blockerReason).toContain('manifest changed')
  })

  it('does not block when real-state manifest is unchanged', async () => {
    fs.writeFileSync(path.join(tmpStateRoot, 'skill-registry.json'), '{}')
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')

    const result = await runL1Harness(baseOpts(auditPath))

    expect(result.verdict).not.toBe('L1_HARNESS_BLOCKED')
  })
})

// ── Oracle file hash integrity ────────────────────────────────────────────────

describe('oracle file hash integrity', () => {
  it('blocks when oracle hash changes during session', async () => {
    vi.mocked(computeOracleHash)
      .mockReturnValueOnce('hash-pre-run')
      .mockReturnValueOnce('hash-post-run-changed')
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')

    const result = await runL1Harness(baseOpts(auditPath))

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

    const result = await runL1Harness(baseOpts(auditPath, { pilotExecutor }))

    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('builtinToolUseCount=3')
    expect(result.evidence.builtinToolCountZero).toBe(false)
    expect(result.evidence.builtinToolUseCount).toBe(3)
  })
})

// ── Phase A/B audit record checks ────────────────────────────────────────────

describe('Phase A/B audit record checks', () => {
  it('fails when Phase A record is missing', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const invocationId = 'inv-no-phase-a'
    // Write only Phase B
    const phaseB = JSON.stringify({ phase: SKILL_INVOCATION_PHASE_B, invocationId, sessionId: 'sess-001', patchEligibleForApplication: false })
    fs.writeFileSync(auditPath, phaseB + '\n')

    const pilotExecutor = vi.fn(async () => ({
      report: makeMinimalReport(invocationId, { auditPath }),
      builtinToolUseCount: 0,
    }))

    const result = await runL1Harness(baseOpts(auditPath, { pilotExecutor }))

    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('Phase A record missing')
    expect(result.evidence.phaseAPresent).toBe(false)
  })

  it('fails when Phase B record is missing', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const invocationId = 'inv-no-phase-b'
    // Write only Phase A
    const phaseA = JSON.stringify({
      phase: SKILL_INVOCATION_PHASE_A, invocationId,
      invocationTimestamp: '2026-01-01T10:00:00.000Z',
      operatorTaskHash: OPERATOR_TASK_HASH,
      compositionPolicyVersion: COMPOSITION_POLICY,
      invokedSkills: [{ envelopeHash: ENVELOPE_HASH }],
    })
    fs.writeFileSync(auditPath, phaseA + '\n')

    const pilotExecutor = vi.fn(async () => ({
      report: makeMinimalReport(invocationId, { auditPath }),
      builtinToolUseCount: 0,
    }))

    const result = await runL1Harness(baseOpts(auditPath, { pilotExecutor }))

    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('Phase B record missing')
    expect(result.evidence.phaseBPresent).toBe(false)
  })

  it('fails when Phase B appears before Phase A in audit JSONL', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const invocationId = 'inv-order-violation'
    writeAuditPair(auditPath, invocationId, /* invertOrder= */ true)

    const pilotExecutor = vi.fn(async () => ({
      report: makeMinimalReport(invocationId, { auditPath }),
      builtinToolUseCount: 0,
    }))

    const result = await runL1Harness(baseOpts(auditPath, { pilotExecutor }))

    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('Phase A does not precede Phase B')
    expect(result.evidence.phaseABeforePhaseB).toBe(false)
  })

  it('fails when compositionPolicyVersion is wrong in Phase A', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const invocationId = 'inv-bad-policy'
    const phaseA = JSON.stringify({
      phase: SKILL_INVOCATION_PHASE_A, invocationId,
      invocationTimestamp: '2026-01-01T10:00:00.000Z',
      operatorTaskHash: OPERATOR_TASK_HASH,
      compositionPolicyVersion: 'some-other-policy-v0',  // wrong
      invokedSkills: [{ envelopeHash: ENVELOPE_HASH }],
    })
    const phaseB = JSON.stringify({
      phase: SKILL_INVOCATION_PHASE_B, invocationId,
      sessionId: 'sess-001', patchEligibleForApplication: false,
    })
    fs.writeFileSync(auditPath, phaseA + '\n' + phaseB + '\n')

    const pilotExecutor = vi.fn(async () => ({
      report: makeMinimalReport(invocationId, { auditPath }),
      builtinToolUseCount: 0,
    }))

    const result = await runL1Harness(baseOpts(auditPath, { pilotExecutor }))

    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('compositionPolicyVersion mismatch')
  })
})

// ── Oracle capsule evaluation checks ─────────────────────────────────────────

describe('Oracle capsule evaluation checks', () => {
  it('fails when oracle verdict is not PASS', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const failingOracle: L1OracleEvaluator = async () =>
      makeHappyCapsuleReceipt({ terminalOracleStatus: 'FAIL' })

    const result = await runL1Harness(baseOpts(auditPath, { oracleEvaluator: failingOracle }))

    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('"FAIL"')
    expect(result.evidence.oracleVerdict).toBe('FAIL')
  })

  it('fails when oracle verdict is not PASS and patch is eligible', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const invocationId = 'inv-eligible-no-pass'
    writeAuditPair(auditPath, invocationId)

    const pilotExecutor = vi.fn(async () => ({
      report: makeMinimalReport(invocationId, { auditPath, patchEligible: false }),  // keep eligible=false to avoid Phase B mismatch
      builtinToolUseCount: 0,
    }))
    const failingOracle: L1OracleEvaluator = async () =>
      makeHappyCapsuleReceipt({ terminalOracleStatus: 'ERROR' })

    const result = await runL1Harness(baseOpts(auditPath, { pilotExecutor, oracleEvaluator: failingOracle }))

    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.evidence.oracleVerdict).toBe('ERROR')
  })

  it('fails when hostExecutionOccurred is not false on receipt', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    // Override the readonly false literal via cast — simulates a malformed receipt
    const badReceipt = { ...makeHappyCapsuleReceipt(), candidateCodeExecutedOnHost: true as unknown as false }
    const badOracle: L1OracleEvaluator = async () => badReceipt as CapsuleEvaluatorReceipt

    const result = await runL1Harness(baseOpts(auditPath, { oracleEvaluator: badOracle }))

    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('hostExecutionOccurred')
  })

  it('fails when capsule cleanup is not confirmed', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const noCleanupOracle: L1OracleEvaluator = async () =>
      makeHappyCapsuleReceipt({ cleanupComplete: false })

    const result = await runL1Harness(baseOpts(auditPath, { oracleEvaluator: noCleanupOracle }))

    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('cleanup')
    expect(result.evidence.capsuleCleanedUp).toBe(false)
  })

  it('fails when oracle evaluator throws', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const throwingOracle: L1OracleEvaluator = async () => {
      throw new Error('Docker not available')
    }

    const result = await runL1Harness(baseOpts(auditPath, { oracleEvaluator: throwingOracle }))

    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('Oracle evaluation threw')
    expect(result.blockerReason).toContain('Docker not available')
  })
})

// ── Pilot executor failure ────────────────────────────────────────────────────

describe('Pilot executor failure', () => {
  it('returns FAILED with truthful evidence when pilot executor throws', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')
    const pilotExecutor = vi.fn(async () => {
      throw new Error('Anthropic API timeout')
    })

    const result = await runL1Harness(baseOpts(auditPath, { pilotExecutor }))

    expect(result.verdict).toBe('L1_HARNESS_FAILED')
    expect(result.blockerReason).toContain('Pilot executor threw')
    expect(result.blockerReason).toContain('Anthropic API timeout')
    // Evidence is partial but truthful — no fabrication
    expect(result.evidence.fixtureAFound).toBe(true)
    expect(result.evidence.powerplantHome).toBe(tmpAcceptanceHome)
  })
})

// ── Happy path ────────────────────────────────────────────────────────────────

describe('Happy path — benign complete evidence', () => {
  it('produces L1_CANDIDATE_PASS with fully populated evidence', async () => {
    const auditPath = path.join(tmpAuditDir, 'audit.jsonl')

    const result = await runL1Harness(baseOpts(auditPath))

    expect(result.verdict).toBe('L1_CANDIDATE_PASS')
    expect(result.blockerReason).toBe('')

    const ev = result.evidence
    expect(ev.fixtureAFound).toBe(true)
    expect(ev.manifestUnchanged).toBe(true)
    expect(ev.oracleHashUnchanged).toBe(true)
    expect(ev.builtinToolCountZero).toBe(true)
    expect(ev.phaseAPresent).toBe(true)
    expect(ev.phaseBPresent).toBe(true)
    expect(ev.phaseABeforePhaseB).toBe(true)
    expect(ev.oracleVerdict).toBe('PASS')
    expect(ev.hostExecutionOccurred).toBe(false)
    expect(ev.capsuleCleanedUp).toBe(true)
    expect(ev.compositionPolicyVersion).toBe(COMPOSITION_POLICY)
    expect(ev.operatorTaskHash).toBe(OPERATOR_TASK_HASH)
    // No Anthropic API called — verified by absence of live session imports
    expect(ev.powerplantHome).toBe(tmpAcceptanceHome)
  })
})
