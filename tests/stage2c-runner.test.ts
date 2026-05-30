// Stage 2C — Runner tests (no Anthropic API, no live session)
//
// Step 1 proves fail-closed behavior and honest receipt discipline for:
//   - Dry-run receipt emission
//   - Agent execution not attempted (agentExecutionAttempted === false)
//   - Builtin tool count is zero (builtinToolUseCount === 0)
//   - Terminal outcome is SKELETON_NO_AGENT_EXECUTION
//   - Real repo manifest captured or honestly null
//   - Invalid/missing task fails closed (RUNNER_BLOCKED)
//   - Static boundary: no @anthropic-ai/sdk import, no promoteSkill call
//
// Step 2 proves fake-agent adapter discipline:
//   - Deterministic workspace mutation recorded
//   - Typed tool event emitted
//   - Boundary enforcement blocks outside-workspace writes
//   - Real repo manifest immutability preserved
//   - Dry-run bypass: fakeAgent + dryRun still returns SKELETON_NO_AGENT_EXECUTION
//
// Step 3 proves denied tool evidence receipts and boundary hardening:
//   - Denied writes emit a receipt (not null)
//   - Denied tool event has allowed: false and a denialReason
//   - Denied write creates no outside file
//   - Canonical boundary check rejects traversal and same-prefix siblings
//   - builtinToolUseCount is zero in both allowed and denied paths
//   - repoManifestImmutable is honestly preserved in both paths
//
// Step 4 proves symlink-safe write-boundary enforcement:
//   - Symlink directory inside workspace pointing outside is denied (by test)
//   - Symlink file target inside workspace pointing outside is denied (by test)
//   - Nested symlink escape is denied (by test)
//   - Ordinary nested directory write inside workspace still succeeds
//   - Existing normal file inside workspace can be overwritten
//   - Same-prefix sibling and '..' traversal remain denied
//
// Step 7 proves the real managed-agent transport gate and adapter contract:
//   - --managed-agent without env gate emits honest blocked receipt (not null)
//   - Blocked path does not call adapter, write workspace files, or run oracle
//   - builtinToolUseCount: 0 and repo immutability recorded in blocked receipt
//   - dry-run wins over --managed-agent (Step 1 behavior unchanged)
//   - fake-agent paths remain unchanged
//   - Static: public opts expose no test seams; env gate required before adapter
//
// Step 8 proves the enabled managed-agent adapter execution boundary:
//   - env gate + no adapter → MANAGED_AGENT_BLOCKED_NO_ADAPTER (honest receipt)
//   - env gate + test adapter → MANAGED_AGENT_ADAPTER_WORKSPACE_MUTATION_RECORDED
//   - adapter called exactly once when both gates satisfied
//   - adapter writes only through typed tool event path (boundary enforced)
//   - successful receipt records agentExecutionAttempted: true, builtinToolUseCount: 0
//   - successful receipt records repo immutability
//   - adapter outside-workspace attempt → denied receipt, not null
//   - dry-run wins over env gate and managed-agent flag
//   - oracle suppressed in all managed-agent Step 8 paths (oracleEvaluationAttempted: false)
//   - fake-agent oracle-pass compatibility unchanged
//   - no SDK import added; public Stage2cRunnerOpts exposes no test seams

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const { _runStage2cSkeletonForTesting, _checkWriteTargetBoundaryForTesting } =
  await import('../scripts/stage2c-runner.js')

import type {
  Stage2cRunnerInternalOpts,
  Stage2cSkeletonReceipt,
  Stage2cFakeAgentReceipt,
  Stage2cFakeAgentDeniedReceipt,
  Stage2cFakeAgentOracleReceipt,
  Stage2cManagedAgentBlockedReceipt,
  Stage2cManagedAgentBlockedNoAdapterReceipt,
  Stage2cManagedAgentAdapterReceipt,
  Stage2cManagedAgentAdapterDeniedReceipt,
  Stage2cManagedAgentMissingCredentialsReceipt,
  Stage2cManagedAgentAdapterInvalidResponseReceipt,
  OracleEvaluationResult,
  FakeAgentToolEvent,
  ManagedAgentAdapter,
  ManagedAgentRequest,
  ManagedAgentResult,
} from '../scripts/stage2c-runner.js'

// ── Test state ────────────────────────────────────────────────────────────────

let tmpBase: string   // injected as _runtimeBaseForTesting
let tmpRepo: string   // injected as _repoPathForTesting

const FAKE_GIT = { branch: 'feat/stage2c-l1-managed-agent-harness', commitSha: 'abc1234' }
const VALID_TASK = 'add a status endpoint to the sample project'

beforeEach(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2c-base-'))
  tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2c-repo-'))
})

afterEach(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true })
  fs.rmSync(tmpRepo, { recursive: true, force: true })
})

function baseOpts(overrides: Partial<Stage2cRunnerInternalOpts> = {}): Stage2cRunnerInternalOpts {
  return {
    task: VALID_TASK,
    dryRun: true,
    _runtimeBaseForTesting: tmpBase,
    _repoPathForTesting: tmpRepo,
    _gitInfoForTesting: FAKE_GIT,
    ...overrides,
  }
}

// ── Invariant: no live API in source ─────────────────────────────────────────

describe('stage2c-runner static invariants', () => {
  const src = fs.readFileSync(path.resolve('scripts/stage2c-runner.ts'), 'utf-8')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

  it('does not import @anthropic-ai/sdk', async () => {
    expect(src).not.toContain('@anthropic-ai/sdk')
  })

  it('does not reference ANTHROPIC_API_KEY in executable code', async () => {
    expect(src).not.toContain('ANTHROPIC_API_KEY')
  })

  it('does not call or import promoteSkill', async () => {
    expect(src).not.toContain('promoteSkill')
  })

  it('production runStage2cSkeleton does not expose injectable seams', async () => {
    const full = fs.readFileSync(path.resolve('scripts/stage2c-runner.ts'), 'utf-8')
    expect(full).toMatch(/export async function runStage2cSkeleton\(opts: Stage2cRunnerOpts\)/)
    const match = full.match(/export interface Stage2cRunnerOpts \{[\s\S]*?\n\}/)
    expect(match).not.toBeNull()
    expect(match![0]).not.toContain('_runtimeBaseForTesting')
    expect(match![0]).not.toContain('_repoPathForTesting')
    expect(match![0]).not.toContain('_gitInfoForTesting')
    expect(match![0]).not.toContain('_oracleEvaluatorForTesting')
    expect(match![0]).not.toContain('_managedAgentAdapterForTesting')
    expect(match![0]).not.toContain('_managedAgentEnvGateForTesting')
  })
})

// ── Task validation — fail closed ─────────────────────────────────────────────

describe('task validation', () => {
  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
  ])('blocks on %s', async (_label, task) => {
    const result = await _runStage2cSkeletonForTesting(baseOpts({ task }))
    expect(result.outcome).toBe('RUNNER_BLOCKED')
    expect(result.blockerReason).toContain('non-empty')
    expect(result.receipt).toBeNull()
  })
})

// ── Receipt shape — happy path ────────────────────────────────────────────────

describe('receipt shape — happy path', () => {
  it('emits SKELETON_NO_AGENT_EXECUTION with all required fields', async () => {
    const result = await _runStage2cSkeletonForTesting(baseOpts())
    expect(result.outcome).toBe('SKELETON_NO_AGENT_EXECUTION')
    expect(result.blockerReason).toBe('')
    const r = result.receipt!
    expect(r).not.toBeNull()
    expect(r.schemaVersion).toBe(1)
    expect(r.stage).toBe('stage2c')
    expect(r.step).toBe(1)
    expect(r.task).toBe(VALID_TASK)
    expect(r.dryRun).toBe(true)
    expect(r.terminalOutcome).toBe('SKELETON_NO_AGENT_EXECUTION')
  })

  it('agent execution is not attempted', async () => {
    const r = (await _runStage2cSkeletonForTesting(baseOpts())).receipt!
    expect(r.agentExecutionAttempted).toBe(false)
  })

  it('builtin tool use count is zero', async () => {
    const r = (await _runStage2cSkeletonForTesting(baseOpts())).receipt!
    expect(r.builtinToolUseCount).toBe(0)
  })

  it('managed agent transport is not_wired', async () => {
    const r = (await _runStage2cSkeletonForTesting(baseOpts())).receipt!
    expect(r.managedAgentTransport).toBe('not_wired')
  })

  it('run id is a non-empty UUID-shaped string', async () => {
    const r = (await _runStage2cSkeletonForTesting(baseOpts())).receipt!
    expect(r.runId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('timestamp is a parseable ISO 8601 string', async () => {
    const r = (await _runStage2cSkeletonForTesting(baseOpts())).receipt!
    expect(() => new Date(r.timestamp)).not.toThrow()
    expect(isNaN(new Date(r.timestamp).getTime())).toBe(false)
  })

  it('gitBranch and gitCommitSha come from injected git info', async () => {
    const r = (await _runStage2cSkeletonForTesting(baseOpts())).receipt!
    expect(r.gitBranch).toBe(FAKE_GIT.branch)
    expect(r.gitCommitSha).toBe(FAKE_GIT.commitSha)
  })

  it('gitBranch and gitCommitSha are null when git info is unavailable', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      baseOpts({ _gitInfoForTesting: { branch: null, commitSha: null } }),
    )).receipt!
    expect(r.gitBranch).toBeNull()
    expect(r.gitCommitSha).toBeNull()
  })

  it('task is trimmed before recording', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      baseOpts({ task: '  fix the bug  ' }),
    )).receipt!
    expect(r.task).toBe('fix the bug')
  })
})

// ── Run directory and workspace ───────────────────────────────────────────────

describe('run directory and workspace', () => {
  it('creates a unique run directory under the runtime base', async () => {
    const r = (await _runStage2cSkeletonForTesting(baseOpts())).receipt!
    expect(r.runDir.startsWith(tmpBase)).toBe(true)
    expect(fs.existsSync(r.runDir)).toBe(true)
  })

  it('creates the workspace subdirectory inside the run dir', async () => {
    const r = (await _runStage2cSkeletonForTesting(baseOpts())).receipt!
    expect(r.workspacePath.startsWith(r.runDir)).toBe(true)
    expect(fs.existsSync(r.workspacePath)).toBe(true)
  })

  it('writes the receipt JSON file into the run directory', async () => {
    const r = (await _runStage2cSkeletonForTesting(baseOpts())).receipt!
    const receiptFile = path.join(r.runDir, 'stage2c-receipt.json')
    expect(fs.existsSync(receiptFile)).toBe(true)
    const persisted = JSON.parse(fs.readFileSync(receiptFile, 'utf-8')) as Stage2cSkeletonReceipt
    expect(persisted.runId).toBe(r.runId)
    expect(persisted.terminalOutcome).toBe('SKELETON_NO_AGENT_EXECUTION')
  })

  it('two runs produce distinct run directories', async () => {
    const r1 = (await _runStage2cSkeletonForTesting(baseOpts())).receipt!
    const r2 = (await _runStage2cSkeletonForTesting(baseOpts())).receipt!
    expect(r1.runDir).not.toBe(r2.runDir)
    expect(r1.runId).not.toBe(r2.runId)
  })
})

// ── Repo manifest capture ─────────────────────────────────────────────────────

describe('repo manifest capture', () => {
  it('captures a non-null hash when the repo path has files', async () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const r = (await _runStage2cSkeletonForTesting(baseOpts())).receipt as Stage2cSkeletonReceipt
    expect(r.repoManifestHash).not.toBeNull()
    expect(typeof r.repoManifestHash).toBe('string')
  })

  it('returns EMPTY hash when the repo dir is empty', async () => {
    const r = (await _runStage2cSkeletonForTesting(baseOpts())).receipt as Stage2cSkeletonReceipt
    expect(r.repoManifestHash).toBe('EMPTY')
  })

  it('reports null hash honestly when repo path does not exist', async () => {
    const nonExistentRepo = path.join(os.tmpdir(), 'no-such-dir-stage2c-' + Date.now())
    // computeDirectoryManifestHash returns 'EMPTY' for non-existent dir,
    // so repoManifestHash is 'EMPTY' (not null) — still honest, not fabricated
    const r = (await _runStage2cSkeletonForTesting(
      baseOpts({ _repoPathForTesting: nonExistentRepo }),
    )).receipt as Stage2cSkeletonReceipt
    // 'EMPTY' or null are both honest; neither is a fabricated hash
    expect(r.repoManifestHash === null || r.repoManifestHash === 'EMPTY').toBe(true)
  })

  it('does not fabricate a hash value', async () => {
    const r = (await _runStage2cSkeletonForTesting(baseOpts())).receipt as Stage2cSkeletonReceipt
    // any non-null value must look like a real SHA-256 hex or the sentinel 'EMPTY'
    if (r.repoManifestHash !== null) {
      const isValidSha256 = /^[a-f0-9]{64}$/.test(r.repoManifestHash)
      const isEmpty = r.repoManifestHash === 'EMPTY'
      expect(isValidSha256 || isEmpty).toBe(true)
    }
  })
})

// ── Step 2 helper ─────────────────────────────────────────────────────────────

function fakeAgentOpts(overrides: Partial<Stage2cRunnerInternalOpts> = {}): Stage2cRunnerInternalOpts {
  return {
    task: VALID_TASK,
    dryRun: false,
    fakeAgent: true,
    _runtimeBaseForTesting: tmpBase,
    _repoPathForTesting: tmpRepo,
    _gitInfoForTesting: FAKE_GIT,
    ...overrides,
  }
}

// ── Step 2: fake-agent receipt shape ─────────────────────────────────────────

describe('fake-agent receipt shape', () => {
  it('emits FAKE_AGENT_WORKSPACE_MUTATION_RECORDED with all required fields', async () => {
    const result = await _runStage2cSkeletonForTesting(fakeAgentOpts())
    expect(result.outcome).toBe('FAKE_AGENT_WORKSPACE_MUTATION_RECORDED')
    expect(result.blockerReason).toBe('')
    const r = result.receipt as Stage2cFakeAgentReceipt
    expect(r).not.toBeNull()
    expect(r.schemaVersion).toBe(1)
    expect(r.stage).toBe('stage2c')
    expect(r.step).toBe(2)
    expect(r.task).toBe(VALID_TASK)
    expect(r.dryRun).toBe(false)
    expect(r.terminalOutcome).toBe('FAKE_AGENT_WORKSPACE_MUTATION_RECORDED')
  })

  it('agentExecutionAttempted is true', async () => {
    const r = (await _runStage2cSkeletonForTesting(fakeAgentOpts())).receipt as Stage2cFakeAgentReceipt
    expect(r.agentExecutionAttempted).toBe(true)
  })

  it('builtinToolUseCount is zero', async () => {
    const r = (await _runStage2cSkeletonForTesting(fakeAgentOpts())).receipt as Stage2cFakeAgentReceipt
    expect(r.builtinToolUseCount).toBe(0)
  })

  it('managedAgentTransport is deterministic_fake_agent', async () => {
    const r = (await _runStage2cSkeletonForTesting(fakeAgentOpts())).receipt as Stage2cFakeAgentReceipt
    expect(r.managedAgentTransport).toBe('deterministic_fake_agent')
  })

  it('task is trimmed in receipt', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      fakeAgentOpts({ task: '  fix the bug  ' }),
    )).receipt as Stage2cFakeAgentReceipt
    expect(r.task).toBe('fix the bug')
  })

  it('writes the receipt JSON to the run directory', async () => {
    const r = (await _runStage2cSkeletonForTesting(fakeAgentOpts())).receipt as Stage2cFakeAgentReceipt
    const receiptFile = path.join(r.runDir, 'stage2c-receipt.json')
    expect(fs.existsSync(receiptFile)).toBe(true)
    const persisted = JSON.parse(fs.readFileSync(receiptFile, 'utf-8')) as Stage2cFakeAgentReceipt
    expect(persisted.runId).toBe(r.runId)
    expect(persisted.terminalOutcome).toBe('FAKE_AGENT_WORKSPACE_MUTATION_RECORDED')
  })
})

// ── Step 2: tool events ───────────────────────────────────────────────────────

describe('fake-agent tool events', () => {
  it('records at least one structured tool event', async () => {
    const r = (await _runStage2cSkeletonForTesting(fakeAgentOpts())).receipt as Stage2cFakeAgentReceipt
    expect(r.toolEvents.length).toBeGreaterThanOrEqual(1)
  })

  it('tool event has correct shape', async () => {
    const r = (await _runStage2cSkeletonForTesting(fakeAgentOpts())).receipt as Stage2cFakeAgentReceipt
    const ev = r.toolEvents[0] as FakeAgentToolEvent
    expect(ev.tool).toBe('WRITE_FILE')
    expect(typeof ev.targetPath).toBe('string')
    expect(ev.targetPath.length).toBeGreaterThan(0)
    expect(typeof ev.allowed).toBe('boolean')
    expect(typeof ev.bytesWritten).toBe('number')
    expect(typeof ev.timestamp).toBe('string')
  })

  it('tool event allowed is true for workspace write', async () => {
    const r = (await _runStage2cSkeletonForTesting(fakeAgentOpts())).receipt as Stage2cFakeAgentReceipt
    expect(r.toolEvents[0]!.allowed).toBe(true)
  })

  it('tool event bytesWritten is positive', async () => {
    const r = (await _runStage2cSkeletonForTesting(fakeAgentOpts())).receipt as Stage2cFakeAgentReceipt
    expect(r.toolEvents[0]!.bytesWritten).toBeGreaterThan(0)
  })

  it('tool event timestamp is parseable ISO 8601', async () => {
    const r = (await _runStage2cSkeletonForTesting(fakeAgentOpts())).receipt as Stage2cFakeAgentReceipt
    expect(isNaN(new Date(r.toolEvents[0]!.timestamp).getTime())).toBe(false)
  })
})

// ── Step 2: workspace mutation ────────────────────────────────────────────────

describe('fake-agent workspace mutation', () => {
  it('writes STAGE2C_FAKE_AGENT_OUTPUT.md inside workspace', async () => {
    const r = (await _runStage2cSkeletonForTesting(fakeAgentOpts())).receipt as Stage2cFakeAgentReceipt
    const outputFile = path.join(r.workspacePath, 'STAGE2C_FAKE_AGENT_OUTPUT.md')
    expect(fs.existsSync(outputFile)).toBe(true)
  })

  it('file content includes task text', async () => {
    const r = (await _runStage2cSkeletonForTesting(fakeAgentOpts())).receipt as Stage2cFakeAgentReceipt
    const content = fs.readFileSync(path.join(r.workspacePath, 'STAGE2C_FAKE_AGENT_OUTPUT.md'), 'utf-8')
    expect(content).toContain(VALID_TASK)
  })

  it('file content includes fake-agent marker', async () => {
    const r = (await _runStage2cSkeletonForTesting(fakeAgentOpts())).receipt as Stage2cFakeAgentReceipt
    const content = fs.readFileSync(path.join(r.workspacePath, 'STAGE2C_FAKE_AGENT_OUTPUT.md'), 'utf-8')
    expect(content).toContain('DETERMINISTIC_FAKE_AGENT_EXECUTION')
  })

  it('workspaceManifestHashBefore is EMPTY (workspace was empty before agent ran)', async () => {
    const r = (await _runStage2cSkeletonForTesting(fakeAgentOpts())).receipt as Stage2cFakeAgentReceipt
    expect(r.workspaceManifestHashBefore).toBe('EMPTY')
  })

  it('workspaceManifestHashAfter is a real SHA-256 hex', async () => {
    const r = (await _runStage2cSkeletonForTesting(fakeAgentOpts())).receipt as Stage2cFakeAgentReceipt
    expect(/^[a-f0-9]{64}$/.test(r.workspaceManifestHashAfter)).toBe(true)
  })

  it('before and after workspace hashes differ (mutation was recorded)', async () => {
    const r = (await _runStage2cSkeletonForTesting(fakeAgentOpts())).receipt as Stage2cFakeAgentReceipt
    expect(r.workspaceManifestHashBefore).not.toBe(r.workspaceManifestHashAfter)
  })
})

// ── Step 2: real repo immutability ───────────────────────────────────────────

describe('fake-agent real repo immutability', () => {
  it('repo manifest is immutable or unavailable (never fabricated)', async () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const r = (await _runStage2cSkeletonForTesting(fakeAgentOpts())).receipt as Stage2cFakeAgentReceipt
    expect(r.repoManifestImmutable === true || r.repoManifestImmutable === 'unavailable').toBe(true)
  })

  it('repoManifestImmutable is true when repo path has files', async () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const r = (await _runStage2cSkeletonForTesting(fakeAgentOpts())).receipt as Stage2cFakeAgentReceipt
    expect(r.repoManifestImmutable).toBe(true)
  })

  it('repoManifestHashBefore equals repoManifestHashAfter when repo is unmodified', async () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const r = (await _runStage2cSkeletonForTesting(fakeAgentOpts())).receipt as Stage2cFakeAgentReceipt
    expect(r.repoManifestHashBefore).toBe(r.repoManifestHashAfter)
  })
})

// ── Step 3: denied receipt shape ─────────────────────────────────────────────

describe('fake-agent denied receipt shape', () => {
  it('denied outside-workspace write emits a receipt, not null', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const result = await _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    )
    expect(result.outcome).toBe('FAKE_AGENT_TOOL_DENIED_OUTSIDE_WORKSPACE')
    expect(result.receipt).not.toBeNull()
    expect(result.blockerReason).toBe('')
  })

  it('denied receipt has correct terminal outcome and agent fields', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const r = (await _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    )).receipt as Stage2cFakeAgentDeniedReceipt
    expect(r.terminalOutcome).toBe('FAKE_AGENT_TOOL_DENIED_OUTSIDE_WORKSPACE')
    expect(r.agentExecutionAttempted).toBe(true)
    expect(r.managedAgentTransport).toBe('deterministic_fake_agent')
    expect(r.schemaVersion).toBe(1)
    expect(r.stage).toBe('stage2c')
    expect(r.step).toBe(2)
  })

  it('denied receipt builtinToolUseCount is zero', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const r = (await _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    )).receipt as Stage2cFakeAgentDeniedReceipt
    expect(r.builtinToolUseCount).toBe(0)
  })

  it('denied receipt is written to the run directory', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const r = (await _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    )).receipt as Stage2cFakeAgentDeniedReceipt
    const receiptFile = path.join(r.runDir, 'stage2c-receipt.json')
    expect(fs.existsSync(receiptFile)).toBe(true)
    const persisted = JSON.parse(fs.readFileSync(receiptFile, 'utf-8')) as Stage2cFakeAgentDeniedReceipt
    expect(persisted.terminalOutcome).toBe('FAKE_AGENT_TOOL_DENIED_OUTSIDE_WORKSPACE')
  })
})

// ── Step 3: denied tool event ─────────────────────────────────────────────────

describe('fake-agent denied tool event', () => {
  it('denied tool event has allowed: false', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const r = (await _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    )).receipt as Stage2cFakeAgentDeniedReceipt
    const ev = r.toolEvents[0] as FakeAgentToolEvent
    expect(ev.allowed).toBe(false)
  })

  it('denied tool event has a non-empty denialReason', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const r = (await _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    )).receipt as Stage2cFakeAgentDeniedReceipt
    const ev = r.toolEvents[0] as FakeAgentToolEvent
    expect(typeof ev.denialReason).toBe('string')
    expect(ev.denialReason!.length).toBeGreaterThan(0)
  })

  it('denied tool event denialReason is TARGET_OUTSIDE_WORKSPACE', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const r = (await _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    )).receipt as Stage2cFakeAgentDeniedReceipt
    expect(r.toolEvents[0]!.denialReason).toBe('TARGET_OUTSIDE_WORKSPACE')
  })

  it('denied tool event bytesWritten is zero', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const r = (await _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    )).receipt as Stage2cFakeAgentDeniedReceipt
    expect(r.toolEvents[0]!.bytesWritten).toBe(0)
  })

  it('denied tool event tool is WRITE_FILE', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const r = (await _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    )).receipt as Stage2cFakeAgentDeniedReceipt
    expect(r.toolEvents[0]!.tool).toBe('WRITE_FILE')
  })
})

// ── Step 3: boundary hardening ────────────────────────────────────────────────

describe('fake-agent boundary hardening', () => {
  it('denied write creates no outside file', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    await _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    )
    expect(fs.existsSync(outsidePath)).toBe(false)
  })

  it('blocks path-traversal write (../.. escape)', async () => {
    // path.resolve normalizes '..' before path.relative sees it,
    // so '/workspace/../outside' → '/outside' which is outside workspace.
    const traversalPath = path.join(tmpBase, '..', 'traversal-escape.txt')
    const result = await _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: traversalPath }),
    )
    expect(result.outcome).toBe('FAKE_AGENT_TOOL_DENIED_OUTSIDE_WORKSPACE')
    expect(result.receipt).not.toBeNull()
    expect(fs.existsSync(path.resolve(traversalPath))).toBe(false)
  })

  it('blocks same-prefix sibling path (workspace-evil attack)', async () => {
    // '/tmp/workspaceXXX-evil/foo' is a sibling, not a child.
    // path.relative('/tmp/workspaceXXX', '/tmp/workspaceXXX-evil/foo') = '../workspaceXXX-evil/foo'
    // which starts with '..' — caught by the boundary check.
    const siblingDir = tmpBase + '-evil'
    const siblingPath = path.join(siblingDir, 'attack.txt')
    const result = await _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: siblingPath }),
    )
    expect(result.outcome).toBe('FAKE_AGENT_TOOL_DENIED_OUTSIDE_WORKSPACE')
    expect(result.receipt).not.toBeNull()
    expect(fs.existsSync(siblingPath)).toBe(false)
  })

  it('allowed write still succeeds after hardening', async () => {
    const result = await _runStage2cSkeletonForTesting(fakeAgentOpts())
    expect(result.outcome).toBe('FAKE_AGENT_WORKSPACE_MUTATION_RECORDED')
    expect(result.receipt).not.toBeNull()
  })

  it('allowed tool event has no denialReason', async () => {
    const r = (await _runStage2cSkeletonForTesting(fakeAgentOpts())).receipt as Stage2cFakeAgentReceipt
    expect(r.toolEvents[0]!.denialReason).toBeUndefined()
  })
})

// ── Step 3: repo immutability in denied path ──────────────────────────────────

describe('fake-agent denied path repo immutability', () => {
  it('repoManifestImmutable is true when repo has files and denied write cannot mutate it', async () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const r = (await _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    )).receipt as Stage2cFakeAgentDeniedReceipt
    expect(r.repoManifestImmutable === true || r.repoManifestImmutable === 'unavailable').toBe(true)
  })

  it('repoManifestHashBefore equals repoManifestHashAfter in denied path', async () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const r = (await _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    )).receipt as Stage2cFakeAgentDeniedReceipt
    expect(r.repoManifestHashBefore).toBe(r.repoManifestHashAfter)
  })
})

// ── Step 3: builtinToolUseCount zero in both paths ────────────────────────────

describe('builtinToolUseCount invariant', () => {
  it.each([
    ['allowed fake-agent write', fakeAgentOpts()],
  ] as Array<[string, Stage2cRunnerInternalOpts]>)('is zero for %s', async (_label, opts) => {
    const r = (await _runStage2cSkeletonForTesting(opts)).receipt as Stage2cFakeAgentReceipt
    expect(r.builtinToolUseCount).toBe(0)
  })

  it('is zero for denied fake-agent write', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const r = (await _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    )).receipt as Stage2cFakeAgentDeniedReceipt
    expect(r.builtinToolUseCount).toBe(0)
  })
})

// ── Step 2: dry-run bypass ────────────────────────────────────────────────────

describe('fake-agent dry-run bypass', () => {
  it('fakeAgent + dryRun still emits SKELETON_NO_AGENT_EXECUTION', async () => {
    const result = await _runStage2cSkeletonForTesting(
      fakeAgentOpts({ dryRun: true }),
    )
    expect(result.outcome).toBe('SKELETON_NO_AGENT_EXECUTION')
    const r = result.receipt as Stage2cSkeletonReceipt
    expect(r.agentExecutionAttempted).toBe(false)
    expect(r.managedAgentTransport).toBe('not_wired')
    expect(r.terminalOutcome).toBe('SKELETON_NO_AGENT_EXECUTION')
  })

  it('fakeAgent + dryRun does not write STAGE2C_FAKE_AGENT_OUTPUT.md', async () => {
    const result = await _runStage2cSkeletonForTesting(fakeAgentOpts({ dryRun: true }))
    const r = result.receipt as Stage2cSkeletonReceipt
    const outputFile = path.join(r.workspacePath, 'STAGE2C_FAKE_AGENT_OUTPUT.md')
    expect(fs.existsSync(outputFile)).toBe(false)
  })
})

// ── Step 2: task validation (fail-closed with fakeAgent) ──────────────────────

describe('fake-agent task validation', () => {
  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
  ])('blocks on %s even with fakeAgent: true', async (_label, task) => {
    const result = await _runStage2cSkeletonForTesting(fakeAgentOpts({ task }))
    expect(result.outcome).toBe('RUNNER_BLOCKED')
    expect(result.blockerReason).toContain('non-empty')
    expect(result.receipt).toBeNull()
  })
})

// ── Step 4: write-target boundary — symlink escape enforcement ────────────────
//
// These tests use _checkWriteTargetBoundaryForTesting to create real filesystem
// fixtures (symlinks) and verify that the canonical boundary check denies
// each escape vector. Symlink escapes are denied by test, not by claim.

describe('write-target boundary — symlink escape enforcement (Step 4)', () => {
  let wsDir: string
  let outsideDir: string
  let outsideFile: string

  beforeEach(() => {
    wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2c-ws4-'))
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2c-out4-'))
    outsideFile = path.join(outsideDir, 'outside.txt')
    fs.writeFileSync(outsideFile, 'outside content\n')
  })

  afterEach(() => {
    fs.rmSync(wsDir, { recursive: true, force: true })
    fs.rmSync(outsideDir, { recursive: true, force: true })
  })

  // ── Allowed cases ────────────────────────────────────────────────────────────

  it('allows write to non-existing file directly inside workspace', async () => {
    const target = path.join(wsDir, 'output.txt')
    const result = _checkWriteTargetBoundaryForTesting(target, wsDir)
    expect(result.allowed).toBe(true)
  })

  it('allows write to non-existing file in a non-existing nested subdirectory', async () => {
    const target = path.join(wsDir, 'nested', 'deep', 'output.txt')
    const result = _checkWriteTargetBoundaryForTesting(target, wsDir)
    expect(result.allowed).toBe(true)
  })

  it('allows overwrite of an existing regular file inside workspace', async () => {
    const target = path.join(wsDir, 'existing.txt')
    fs.writeFileSync(target, 'initial content')
    const result = _checkWriteTargetBoundaryForTesting(target, wsDir)
    expect(result.allowed).toBe(true)
  })

  it('allows write into an existing subdirectory inside workspace', async () => {
    const subdir = path.join(wsDir, 'subdir')
    fs.mkdirSync(subdir)
    const target = path.join(subdir, 'output.txt')
    const result = _checkWriteTargetBoundaryForTesting(target, wsDir)
    expect(result.allowed).toBe(true)
  })

  // ── Symlink escape cases — denied by test ────────────────────────────────────

  it('denies symlink directory inside workspace pointing outside', async () => {
    // wsDir/evil_link -> outsideDir
    const symlinkDir = path.join(wsDir, 'evil_link')
    fs.symlinkSync(outsideDir, symlinkDir)

    const target = path.join(symlinkDir, 'output.txt')
    const result = _checkWriteTargetBoundaryForTesting(target, wsDir)
    expect(result.allowed).toBe(false)
    expect(result.denialReason).toBe('TARGET_SYMLINK_ESCAPE')
  })

  it('denies symlink file target inside workspace pointing outside', async () => {
    // wsDir/evil_link.txt -> outsideFile
    const symlinkFile = path.join(wsDir, 'evil_link.txt')
    fs.symlinkSync(outsideFile, symlinkFile)

    const result = _checkWriteTargetBoundaryForTesting(symlinkFile, wsDir)
    expect(result.allowed).toBe(false)
    expect(result.denialReason).toBe('TARGET_SYMLINK_ESCAPE')
  })

  it('denies nested symlink escape inside a real subdirectory', async () => {
    // wsDir/subdir/ (real) + wsDir/subdir/evil_link -> outsideDir
    const subdir = path.join(wsDir, 'subdir')
    fs.mkdirSync(subdir)
    const symlinkDir = path.join(subdir, 'evil_link')
    fs.symlinkSync(outsideDir, symlinkDir)

    const target = path.join(symlinkDir, 'output.txt')
    const result = _checkWriteTargetBoundaryForTesting(target, wsDir)
    expect(result.allowed).toBe(false)
    expect(result.denialReason).toBe('TARGET_SYMLINK_ESCAPE')
  })

  it('denies a target whose canonical path escapes via intermediate symlink', async () => {
    // wsDir/evil_link -> outsideDir ; target = wsDir/evil_link/file.txt
    // outsideDir/file.txt exists (so existsSync sees the path as live)
    const symlinkDir = path.join(wsDir, 'evil_link')
    fs.symlinkSync(outsideDir, symlinkDir)
    const escapedFile = path.join(outsideDir, 'file.txt')
    fs.writeFileSync(escapedFile, 'reached outside\n')

    const target = path.join(symlinkDir, 'file.txt')  // existsSync = true via symlink
    const result = _checkWriteTargetBoundaryForTesting(target, wsDir)
    expect(result.allowed).toBe(false)
    // existsSync follows symlink so the file "exists"; intermediate symlink is
    // detected by realpathSync showing canonical path is outside workspace.
    expect(['TARGET_SYMLINK_ESCAPE', 'TARGET_OUTSIDE_WORKSPACE']).toContain(result.denialReason)
  })

  // ── Other denial cases (regression) ─────────────────────────────────────────

  it('denies absolute path outside workspace (no symlinks)', async () => {
    const target = path.join(outsideDir, 'output.txt')
    const result = _checkWriteTargetBoundaryForTesting(target, wsDir)
    expect(result.allowed).toBe(false)
    expect(result.denialReason).toBe('TARGET_OUTSIDE_WORKSPACE')
  })

  it('denies same-prefix sibling path', async () => {
    const siblingDir = wsDir + '-evil'
    const target = path.join(siblingDir, 'attack.txt')
    const result = _checkWriteTargetBoundaryForTesting(target, wsDir)
    expect(result.allowed).toBe(false)
    expect(result.denialReason).toBe('TARGET_OUTSIDE_WORKSPACE')
  })

  it('denies .. traversal', async () => {
    // path.resolve normalizes '..' before realpathSync sees it
    const target = path.join(wsDir, '..', 'escape.txt')
    const result = _checkWriteTargetBoundaryForTesting(target, wsDir)
    expect(result.allowed).toBe(false)
    expect(result.denialReason).toBe('TARGET_OUTSIDE_WORKSPACE')
  })
})

// ── CLI entry static invariants ───────────────────────────────────────────────

describe('stage2c-run.ts static invariants', () => {
  function nonCommentLines(filePath: string): string {
    return fs.readFileSync(path.resolve(filePath), 'utf-8')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  }

  it('does not import or call _runStage2cSkeletonForTesting in non-comment code', async () => {
    const src = nonCommentLines('src/cli/stage2c-run.ts')
    expect(src).not.toContain('_runStage2cSkeletonForTesting')
  })

  it('imports and calls only the production runStage2cSkeleton entry point', async () => {
    const src = nonCommentLines('src/cli/stage2c-run.ts')
    expect(src).toContain('runStage2cSkeleton')
  })

  it('does not import @anthropic-ai/sdk', async () => {
    const src = nonCommentLines('src/cli/stage2c-run.ts')
    expect(src).not.toContain('@anthropic-ai/sdk')
  })
})

// ── Step 5: oracle evaluation helpers ────────────────────────────────────────

const PASS_ORACLE: OracleEvaluationResult = { status: 'PASS', exitCode: null, summary: 'oracle passed' }
const FAIL_ORACLE: OracleEvaluationResult = { status: 'FAIL', exitCode: null, summary: 'oracle failed' }
const ERROR_ORACLE: OracleEvaluationResult = { status: 'ERROR', exitCode: null, summary: 'oracle error' }

function oracleOpts(
  oracleResult: OracleEvaluationResult = PASS_ORACLE,
  overrides: Partial<Stage2cRunnerInternalOpts> = {},
): Stage2cRunnerInternalOpts {
  return {
    task: VALID_TASK,
    dryRun: false,
    fakeAgent: true,
    oracle: true,
    _runtimeBaseForTesting: tmpBase,
    _repoPathForTesting: tmpRepo,
    _gitInfoForTesting: FAKE_GIT,
    _oracleEvaluatorForTesting: () => oracleResult,
    ...overrides,
  }
}

// ── Step 5: oracle receipt shape ──────────────────────────────────────────────

describe('fake-agent oracle receipt shape', () => {
  it('emits FAKE_AGENT_ORACLE_EVALUATED outcome', async () => {
    const result = await _runStage2cSkeletonForTesting(oracleOpts())
    expect(result.outcome).toBe('FAKE_AGENT_ORACLE_EVALUATED')
    expect(result.blockerReason).toBe('')
  })

  it('oracle receipt has correct schema fields', async () => {
    const r = (await _runStage2cSkeletonForTesting(oracleOpts())).receipt as Stage2cFakeAgentOracleReceipt
    expect(r.schemaVersion).toBe(1)
    expect(r.stage).toBe('stage2c')
    expect(r.step).toBe(5)
    expect(r.dryRun).toBe(false)
    expect(r.managedAgentTransport).toBe('deterministic_fake_agent')
    expect(r.terminalOutcome).toBe('FAKE_AGENT_ORACLE_EVALUATED')
  })

  it('oracle receipt records oracleEvaluationAttempted: true', async () => {
    const r = (await _runStage2cSkeletonForTesting(oracleOpts())).receipt as Stage2cFakeAgentOracleReceipt
    expect(r.oracleEvaluationAttempted).toBe(true)
  })

  it('oracle receipt records oracle evaluator identity', async () => {
    const r = (await _runStage2cSkeletonForTesting(oracleOpts())).receipt as Stage2cFakeAgentOracleReceipt
    expect(r.oracleEvaluator).toBe('subprocess-node-v1')
    expect(r.oracleTarget).toBe('sanitized_candidate_workspace')
  })

  it('oracle receipt records oracleResult from evaluator without fabrication', async () => {
    const r = (await _runStage2cSkeletonForTesting(oracleOpts(FAIL_ORACLE))).receipt as Stage2cFakeAgentOracleReceipt
    expect(r.oracleResult.status).toBe('FAIL')
    expect(r.oracleResult.summary).toBe('oracle failed')
    expect(r.oracleResult.exitCode).toBeNull()
  })

  it('oracle receipt is written to the run directory', async () => {
    const r = (await _runStage2cSkeletonForTesting(oracleOpts())).receipt as Stage2cFakeAgentOracleReceipt
    const receiptFile = path.join(r.runDir, 'stage2c-receipt.json')
    expect(fs.existsSync(receiptFile)).toBe(true)
    const persisted = JSON.parse(fs.readFileSync(receiptFile, 'utf-8'))
    expect(persisted.terminalOutcome).toBe('FAKE_AGENT_ORACLE_EVALUATED')
    expect(persisted.oracleEvaluationAttempted).toBe(true)
  })
})

// ── Step 5: oracle receipt preserves fake-agent evidence ─────────────────────

describe('fake-agent oracle receipt — fake-agent evidence preserved', () => {
  it('toolEvents are preserved in oracle receipt', async () => {
    const r = (await _runStage2cSkeletonForTesting(oracleOpts())).receipt as Stage2cFakeAgentOracleReceipt
    expect(r.toolEvents.length).toBeGreaterThanOrEqual(1)
    expect(r.toolEvents[0]!.tool).toBe('WRITE_FILE')
    expect(r.toolEvents[0]!.allowed).toBe(true)
  })

  it('agentExecutionAttempted is true in oracle receipt', async () => {
    const r = (await _runStage2cSkeletonForTesting(oracleOpts())).receipt as Stage2cFakeAgentOracleReceipt
    expect(r.agentExecutionAttempted).toBe(true)
  })

  it('builtinToolUseCount is zero in oracle receipt', async () => {
    const r = (await _runStage2cSkeletonForTesting(oracleOpts())).receipt as Stage2cFakeAgentOracleReceipt
    expect(r.builtinToolUseCount).toBe(0)
  })

  it('workspace manifest hashes are captured in oracle receipt', async () => {
    const r = (await _runStage2cSkeletonForTesting(oracleOpts())).receipt as Stage2cFakeAgentOracleReceipt
    expect(r.workspaceManifestHashBefore).toBe('EMPTY')
    expect(/^[a-f0-9]{64}$/.test(r.workspaceManifestHashAfter)).toBe(true)
    expect(r.workspaceManifestHashBefore).not.toBe(r.workspaceManifestHashAfter)
  })
})

// ── Step 5: oracle result honesty ─────────────────────────────────────────────

describe('fake-agent oracle result honesty', () => {
  it('PASS result is recorded as PASS, not modified', async () => {
    const r = (await _runStage2cSkeletonForTesting(oracleOpts(PASS_ORACLE))).receipt as Stage2cFakeAgentOracleReceipt
    expect(r.oracleResult.status).toBe('PASS')
  })

  it('FAIL result is recorded as FAIL, not promoted to PASS', async () => {
    const r = (await _runStage2cSkeletonForTesting(oracleOpts(FAIL_ORACLE))).receipt as Stage2cFakeAgentOracleReceipt
    expect(r.oracleResult.status).toBe('FAIL')
    expect(r.terminalOutcome).toBe('FAKE_AGENT_ORACLE_EVALUATED')  // harness still ran
  })

  it('ERROR result is captured honestly, not fabricated as PASS', async () => {
    const result = await _runStage2cSkeletonForTesting(oracleOpts(ERROR_ORACLE))
    const r = result.receipt as Stage2cFakeAgentOracleReceipt
    expect(r.oracleResult.status).toBe('ERROR')
    expect(r.oracleResult.status).not.toBe('PASS')
    expect(result.outcome).toBe('FAKE_AGENT_ORACLE_EVALUATED')
  })

  it('oracle seam exception is captured as ERROR, harness does not throw', async () => {
    const result = await _runStage2cSkeletonForTesting(
      oracleOpts(PASS_ORACLE, {
        _oracleEvaluatorForTesting: () => { throw new Error('seam threw deliberately') },
      }),
    )
    expect(result.outcome).toBe('FAKE_AGENT_ORACLE_EVALUATED')
    const r = result.receipt as Stage2cFakeAgentOracleReceipt
    expect(r.oracleResult.status).toBe('ERROR')
    expect(r.oracleResult.summary).toContain('seam threw deliberately')
  })
})

// ── Step 5: oracle suppression in non-oracle paths ───────────────────────────

describe('oracle suppression in non-oracle paths', () => {
  it('denied fake-agent write does not run oracle', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-oracle-${Date.now()}.txt`)
    let oracleCalled = false
    const result = await _runStage2cSkeletonForTesting(
      oracleOpts(PASS_ORACLE, {
        _fakeAgentTargetPathForTesting: outsidePath,
        _oracleEvaluatorForTesting: () => { oracleCalled = true; return PASS_ORACLE },
      }),
    )
    expect(result.outcome).toBe('FAKE_AGENT_TOOL_DENIED_OUTSIDE_WORKSPACE')
    expect(oracleCalled).toBe(false)
  })

  it('dry-run does not run oracle even when oracle flag is set', async () => {
    let oracleCalled = false
    const result = await _runStage2cSkeletonForTesting(
      oracleOpts(PASS_ORACLE, {
        dryRun: true,
        _oracleEvaluatorForTesting: () => { oracleCalled = true; return PASS_ORACLE },
      }),
    )
    expect(result.outcome).toBe('SKELETON_NO_AGENT_EXECUTION')
    expect(oracleCalled).toBe(false)
  })

  it('fake-agent without oracle still emits FAKE_AGENT_WORKSPACE_MUTATION_RECORDED', async () => {
    const result = await _runStage2cSkeletonForTesting(fakeAgentOpts())
    expect(result.outcome).toBe('FAKE_AGENT_WORKSPACE_MUTATION_RECORDED')
    const r = result.receipt as Stage2cFakeAgentReceipt
    expect((r as unknown as Record<string, unknown>)['oracleEvaluationAttempted']).toBeUndefined()
  })
})

// ── Step 5: real repo immutability across oracle evaluation ───────────────────

describe('real repo immutability — oracle path', () => {
  it('repoManifestImmutable is true when repo has files and oracle ran', async () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const r = (await _runStage2cSkeletonForTesting(oracleOpts())).receipt as Stage2cFakeAgentOracleReceipt
    expect(r.repoManifestImmutable).toBe(true)
  })

  it('repoManifestHashBefore equals repoManifestHashAfter when oracle ran', async () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const r = (await _runStage2cSkeletonForTesting(oracleOpts())).receipt as Stage2cFakeAgentOracleReceipt
    expect(r.repoManifestHashBefore).toBe(r.repoManifestHashAfter)
  })
})

// ── Step 6 helper ─────────────────────────────────────────────────────────────

function oraclePassOpts(overrides: Partial<Stage2cRunnerInternalOpts> = {}): Stage2cRunnerInternalOpts {
  return {
    task: VALID_TASK,
    dryRun: false,
    fakeAgent: true,
    oracle: true,
    fixture: 'oracle-pass',
    _runtimeBaseForTesting: tmpBase,
    _repoPathForTesting: tmpRepo,
    _gitInfoForTesting: FAKE_GIT,
    ...overrides,
  }
}

// ── Step 6: real oracle PASS via oracle-pass fixture ─────────────────────────
//
// These tests run without _oracleEvaluatorForTesting, so the real subprocess
// oracle (subprocess-node-v1) executes against the workspace.

describe('oracle-pass fixture — real oracle PASS path', () => {
  it('oracle-pass fixture produces FAKE_AGENT_ORACLE_EVALUATED outcome', async () => {
    const result = await _runStage2cSkeletonForTesting(oraclePassOpts())
    expect(result.outcome).toBe('FAKE_AGENT_ORACLE_EVALUATED')
    expect(result.blockerReason).toBe('')
  })

  it('oracle-pass fixture produces oracleResult.status PASS from real oracle', async () => {
    const r = (await _runStage2cSkeletonForTesting(oraclePassOpts())).receipt as Stage2cFakeAgentOracleReceipt
    expect(r.oracleResult.status).toBe('PASS')
  })

  it('PASS is from real oracle evaluator, not fabricated (oracleEvaluator and target fields present)', async () => {
    const r = (await _runStage2cSkeletonForTesting(oraclePassOpts())).receipt as Stage2cFakeAgentOracleReceipt
    expect(r.oracleEvaluationAttempted).toBe(true)
    expect(r.oracleEvaluator).toBe('subprocess-node-v1')
    expect(r.oracleTarget).toBe('sanitized_candidate_workspace')
  })

  it('oracle-pass receipt has correct schema and transport fields', async () => {
    const r = (await _runStage2cSkeletonForTesting(oraclePassOpts())).receipt as Stage2cFakeAgentOracleReceipt
    expect(r.schemaVersion).toBe(1)
    expect(r.stage).toBe('stage2c')
    expect(r.step).toBe(5)
    expect(r.agentExecutionAttempted).toBe(true)
    expect(r.managedAgentTransport).toBe('deterministic_fake_agent')
    expect(r.builtinToolUseCount).toBe(0)
    expect(r.terminalOutcome).toBe('FAKE_AGENT_ORACLE_EVALUATED')
  })

  it('oracle-pass receipt preserves typed WRITE_FILE tool event with allowed: true', async () => {
    const r = (await _runStage2cSkeletonForTesting(oraclePassOpts())).receipt as Stage2cFakeAgentOracleReceipt
    expect(r.toolEvents.length).toBeGreaterThanOrEqual(1)
    const ev = r.toolEvents[0]!
    expect(ev.tool).toBe('WRITE_FILE')
    expect(ev.allowed).toBe(true)
    expect(ev.bytesWritten).toBeGreaterThan(0)
    expect(ev.targetPath.endsWith('status.js')).toBe(true)
    expect(ev.denialReason).toBeUndefined()
  })

  it('oracle-pass receipt captures workspace manifest hashes', async () => {
    const r = (await _runStage2cSkeletonForTesting(oraclePassOpts())).receipt as Stage2cFakeAgentOracleReceipt
    expect(r.workspaceManifestHashBefore).toBe('EMPTY')
    expect(/^[a-f0-9]{64}$/.test(r.workspaceManifestHashAfter)).toBe(true)
    expect(r.workspaceManifestHashBefore).not.toBe(r.workspaceManifestHashAfter)
  })

  it('oracle-pass receipt captures real repo manifest hashes', async () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const r = (await _runStage2cSkeletonForTesting(oraclePassOpts())).receipt as Stage2cFakeAgentOracleReceipt
    expect(r.repoManifestHashBefore).not.toBeNull()
    expect(r.repoManifestHashAfter).not.toBeNull()
    expect(r.repoManifestHashBefore).toBe(r.repoManifestHashAfter)
  })

  it('repoManifestImmutable is true in oracle-pass PASS path', async () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const r = (await _runStage2cSkeletonForTesting(oraclePassOpts())).receipt as Stage2cFakeAgentOracleReceipt
    expect(r.repoManifestImmutable).toBe(true)
  })

  it('oracle-pass writes src/status.js inside workspace', async () => {
    const r = (await _runStage2cSkeletonForTesting(oraclePassOpts())).receipt as Stage2cFakeAgentOracleReceipt
    const statusFile = path.join(r.workspacePath, 'src', 'status.js')
    expect(fs.existsSync(statusFile)).toBe(true)
  })

  it('oracle-pass src/status.js contains DETERMINISTIC_FAKE_AGENT_EXECUTION marker', async () => {
    const r = (await _runStage2cSkeletonForTesting(oraclePassOpts())).receipt as Stage2cFakeAgentOracleReceipt
    const content = fs.readFileSync(path.join(r.workspacePath, 'src', 'status.js'), 'utf-8')
    expect(content).toContain('DETERMINISTIC_FAKE_AGENT_EXECUTION')
  })

  it('oracle-pass receipt is persisted to run directory', async () => {
    const r = (await _runStage2cSkeletonForTesting(oraclePassOpts())).receipt as Stage2cFakeAgentOracleReceipt
    const receiptFile = path.join(r.runDir, 'stage2c-receipt.json')
    expect(fs.existsSync(receiptFile)).toBe(true)
    const persisted = JSON.parse(fs.readFileSync(receiptFile, 'utf-8'))
    expect(persisted.oracleResult.status).toBe('PASS')
    expect(persisted.terminalOutcome).toBe('FAKE_AGENT_ORACLE_EVALUATED')
  })
})

// ── Step 6: default fake-agent + real oracle captures FAIL honestly ───────────
//
// Proves the default Markdown write path still fails when the real oracle runs.

describe('default fake-agent + real oracle — FAIL honestly captured', () => {
  it('default fake-agent without oracle-pass fixture produces oracleResult.status FAIL', async () => {
    // Uses the real oracle (no seam), Markdown content → oracle FAIL
    const opts: Stage2cRunnerInternalOpts = {
      task: VALID_TASK,
      dryRun: false,
      fakeAgent: true,
      oracle: true,
      _runtimeBaseForTesting: tmpBase,
      _repoPathForTesting: tmpRepo,
      _gitInfoForTesting: FAKE_GIT,
    }
    const r = (await _runStage2cSkeletonForTesting(opts)).receipt as Stage2cFakeAgentOracleReceipt
    expect(r.oracleResult.status).toBe('FAIL')
    expect(r.terminalOutcome).toBe('FAKE_AGENT_ORACLE_EVALUATED')
  })
})

// ── Step 6: oracle-pass dry-run suppression ──────────────────────────────────

describe('oracle-pass dry-run suppression', () => {
  it('oracle-pass + dryRun emits SKELETON_NO_AGENT_EXECUTION, oracle not called', async () => {
    let oracleCalled = false
    const result = await _runStage2cSkeletonForTesting(
      oraclePassOpts({
        dryRun: true,
        _oracleEvaluatorForTesting: () => { oracleCalled = true; return PASS_ORACLE },
      }),
    )
    expect(result.outcome).toBe('SKELETON_NO_AGENT_EXECUTION')
    expect(oracleCalled).toBe(false)
  })

  it('oracle-pass + dryRun receipt has agentExecutionAttempted: false', async () => {
    const result = await _runStage2cSkeletonForTesting(oraclePassOpts({ dryRun: true }))
    const r = result.receipt as Stage2cSkeletonReceipt
    expect(r.agentExecutionAttempted).toBe(false)
    expect(r.managedAgentTransport).toBe('not_wired')
  })

  it('oracle-pass + dryRun does not write src/status.js', async () => {
    const result = await _runStage2cSkeletonForTesting(oraclePassOpts({ dryRun: true }))
    const r = result.receipt as Stage2cSkeletonReceipt
    const statusFile = path.join(r.workspacePath, 'src', 'status.js')
    expect(fs.existsSync(statusFile)).toBe(false)
  })
})

// ── Step 6: oracle-pass denied-write suppression ─────────────────────────────

describe('oracle-pass denied write — oracle suppressed', () => {
  it('oracle-pass + outside-workspace write emits denied receipt, oracle not called', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-pass6-${Date.now()}.txt`)
    let oracleCalled = false
    const result = await _runStage2cSkeletonForTesting(
      oraclePassOpts({
        _fakeAgentTargetPathForTesting: outsidePath,
        _oracleEvaluatorForTesting: () => { oracleCalled = true; return PASS_ORACLE },
      }),
    )
    expect(result.outcome).toBe('FAKE_AGENT_TOOL_DENIED_OUTSIDE_WORKSPACE')
    expect(oracleCalled).toBe(false)
  })

  it('oracle-pass + denied write produces non-null receipt with denied tool event', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-pass6b-${Date.now()}.txt`)
    const result = await _runStage2cSkeletonForTesting(
      oraclePassOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    )
    const r = result.receipt as Stage2cFakeAgentDeniedReceipt
    expect(r).not.toBeNull()
    expect(r.toolEvents[0]!.allowed).toBe(false)
    expect(r.toolEvents[0]!.denialReason).toBe('TARGET_OUTSIDE_WORKSPACE')
  })

  it('oracle-pass + denied write creates no outside file', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-pass6c-${Date.now()}.txt`)
    await _runStage2cSkeletonForTesting(
      oraclePassOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    )
    expect(fs.existsSync(outsidePath)).toBe(false)
  })
})

// ── Step 6: static invariant — fixture field is not a testing seam ────────────

describe('oracle-pass static invariants', () => {
  it('Stage2cRunnerOpts interface contains fixture field', async () => {
    const src = fs.readFileSync(path.resolve('scripts/stage2c-runner.ts'), 'utf-8')
    const match = src.match(/export interface Stage2cRunnerOpts \{[\s\S]*?\n\}/)
    expect(match).not.toBeNull()
    expect(match![0]).toContain('fixture')
  })

  it('Stage2cRunnerOpts fixture is not a testing seam (no underscore prefix)', async () => {
    const src = fs.readFileSync(path.resolve('scripts/stage2c-runner.ts'), 'utf-8')
    const match = src.match(/export interface Stage2cRunnerOpts \{[\s\S]*?\n\}/)
    expect(match).not.toBeNull()
    // fixture is a public feature flag, not an injectable testing seam
    expect(match![0]).not.toContain('_runtimeBaseForTesting')
    expect(match![0]).not.toContain('_oracleEvaluatorForTesting')
  })

  it('ORACLE_PASS_STATUS_JS is not exported (internal constant only)', async () => {
    const src = fs.readFileSync(path.resolve('scripts/stage2c-runner.ts'), 'utf-8')
    // The constant must not be exported — it is an internal implementation detail
    expect(src).not.toMatch(/^export const ORACLE_PASS_STATUS_JS/m)
  })
})

// ── Step 7 helper ─────────────────────────────────────────────────────────────

function managedAgentOpts(overrides: Partial<Stage2cRunnerInternalOpts> = {}): Stage2cRunnerInternalOpts {
  return {
    task: VALID_TASK,
    dryRun: false,
    managedAgent: true,
    _runtimeBaseForTesting: tmpBase,
    _repoPathForTesting: tmpRepo,
    _gitInfoForTesting: FAKE_GIT,
    ...overrides,
  }
}

// ── Step 7: managed-agent blocked receipt shape ───────────────────────────────

describe('managed-agent transport gate — blocked (no env gate)', () => {
  it('emits MANAGED_AGENT_BLOCKED_NOT_ENABLED outcome', async () => {
    const result = await _runStage2cSkeletonForTesting(managedAgentOpts())
    expect(result.outcome).toBe('MANAGED_AGENT_BLOCKED_NOT_ENABLED')
    expect(result.blockerReason).toBe('')
  })

  it('blocked receipt is not null', async () => {
    const result = await _runStage2cSkeletonForTesting(managedAgentOpts())
    expect(result.receipt).not.toBeNull()
  })

  it('blocked receipt has step: 7', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentOpts())).receipt as Stage2cManagedAgentBlockedReceipt
    expect(r.step).toBe(7)
  })

  it('blocked receipt agentExecutionAttempted is false', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentOpts())).receipt as Stage2cManagedAgentBlockedReceipt
    expect(r.agentExecutionAttempted).toBe(false)
  })

  it('blocked receipt managedAgentTransport is blocked_not_enabled', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentOpts())).receipt as Stage2cManagedAgentBlockedReceipt
    expect(r.managedAgentTransport).toBe('blocked_not_enabled')
  })

  it('blocked receipt builtinToolUseCount is zero', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentOpts())).receipt as Stage2cManagedAgentBlockedReceipt
    expect(r.builtinToolUseCount).toBe(0)
  })

  it('blocked receipt oracleEvaluationAttempted is false', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentOpts())).receipt as Stage2cManagedAgentBlockedReceipt
    expect(r.oracleEvaluationAttempted).toBe(false)
  })

  it('blocked receipt terminalOutcome is MANAGED_AGENT_BLOCKED_NOT_ENABLED', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentOpts())).receipt as Stage2cManagedAgentBlockedReceipt
    expect(r.terminalOutcome).toBe('MANAGED_AGENT_BLOCKED_NOT_ENABLED')
  })

  it('blocked receipt has correct schema and stage fields', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentOpts())).receipt as Stage2cManagedAgentBlockedReceipt
    expect(r.schemaVersion).toBe(1)
    expect(r.stage).toBe('stage2c')
    expect(r.dryRun).toBe(false)
    expect(r.task).toBe(VALID_TASK)
    expect(r.runId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('blocked path does not write any workspace files', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentOpts())).receipt as Stage2cManagedAgentBlockedReceipt
    expect(fs.readdirSync(r.workspacePath).length).toBe(0)
  })

  it('blocked receipt is written to the run directory', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentOpts())).receipt as Stage2cManagedAgentBlockedReceipt
    const receiptFile = path.join(r.runDir, 'stage2c-receipt.json')
    expect(fs.existsSync(receiptFile)).toBe(true)
    const persisted = JSON.parse(fs.readFileSync(receiptFile, 'utf-8'))
    expect(persisted.terminalOutcome).toBe('MANAGED_AGENT_BLOCKED_NOT_ENABLED')
    expect(persisted.agentExecutionAttempted).toBe(false)
  })

  it('blocked path does not call adapter', async () => {
    let adapterCalled = false
    const spyAdapter: ManagedAgentAdapter = {
      transportName: 'test-spy',
      run: () => { adapterCalled = true; return { transportName: 'test-spy' } },
    }
    await _runStage2cSkeletonForTesting(managedAgentOpts({ _managedAgentAdapterForTesting: spyAdapter }))
    expect(adapterCalled).toBe(false)
  })
})

// ── Step 7: oracle suppression in blocked path ────────────────────────────────

describe('managed-agent blocked — oracle suppression', () => {
  it('blocked path does not run oracle even if --oracle is present', async () => {
    let oracleCalled = false
    const result = await _runStage2cSkeletonForTesting(
      managedAgentOpts({
        oracle: true,
        _oracleEvaluatorForTesting: () => { oracleCalled = true; return PASS_ORACLE },
      }),
    )
    expect(result.outcome).toBe('MANAGED_AGENT_BLOCKED_NOT_ENABLED')
    expect(oracleCalled).toBe(false)
  })

  it('blocked receipt oracleEvaluationAttempted is false even with oracle flag', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentOpts({ oracle: true }),
    )).receipt as Stage2cManagedAgentBlockedReceipt
    expect(r.oracleEvaluationAttempted).toBe(false)
  })
})

// ── Step 7: repo immutability in blocked path ─────────────────────────────────

describe('managed-agent blocked — repo immutability', () => {
  it('blocked receipt captures repo manifest hash when repo has files', async () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const r = (await _runStage2cSkeletonForTesting(managedAgentOpts())).receipt as Stage2cManagedAgentBlockedReceipt
    expect(r.repoManifestHash).not.toBeNull()
    expect(typeof r.repoManifestHash).toBe('string')
  })

  it('blocked receipt repoManifestHash is honest (SHA-256 hex, EMPTY, or null)', async () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const r = (await _runStage2cSkeletonForTesting(managedAgentOpts())).receipt as Stage2cManagedAgentBlockedReceipt
    if (r.repoManifestHash !== null) {
      const isValidSha256 = /^[a-f0-9]{64}$/.test(r.repoManifestHash)
      const isEmpty = r.repoManifestHash === 'EMPTY'
      expect(isValidSha256 || isEmpty).toBe(true)
    }
  })
})

// ── Step 7: dry-run wins over --managed-agent ─────────────────────────────────

describe('managed-agent dry-run bypass', () => {
  it('managedAgent + dryRun emits SKELETON_NO_AGENT_EXECUTION', async () => {
    const result = await _runStage2cSkeletonForTesting(managedAgentOpts({ dryRun: true }))
    expect(result.outcome).toBe('SKELETON_NO_AGENT_EXECUTION')
  })

  it('managedAgent + dryRun receipt has agentExecutionAttempted: false and managedAgentTransport: not_wired', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentOpts({ dryRun: true }))).receipt as Stage2cSkeletonReceipt
    expect(r.agentExecutionAttempted).toBe(false)
    expect(r.managedAgentTransport).toBe('not_wired')
    expect(r.terminalOutcome).toBe('SKELETON_NO_AGENT_EXECUTION')
  })

  it('managedAgent + dryRun does not write any workspace files', async () => {
    const result = await _runStage2cSkeletonForTesting(managedAgentOpts({ dryRun: true }))
    const r = result.receipt as Stage2cSkeletonReceipt
    expect(fs.readdirSync(r.workspacePath).length).toBe(0)
  })
})

// ── Step 7: static invariants ─────────────────────────────────────────────────

describe('stage2c-runner static invariants — Step 7', () => {
  it('public Stage2cRunnerOpts contains managedAgent but not adapter or env-gate seams', async () => {
    const src = fs.readFileSync(path.resolve('scripts/stage2c-runner.ts'), 'utf-8')
    const match = src.match(/export interface Stage2cRunnerOpts \{[\s\S]*?\n\}/)
    expect(match).not.toBeNull()
    expect(match![0]).toContain('managedAgent')
    expect(match![0]).not.toContain('_managedAgentAdapterForTesting')
    expect(match![0]).not.toContain('_managedAgentEnvGateForTesting')
  })

  it('STAGE2C_MANAGED_AGENT_ENABLED env gate is present in executable code', async () => {
    const src = fs.readFileSync(path.resolve('scripts/stage2c-runner.ts'), 'utf-8')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(src).toContain('STAGE2C_MANAGED_AGENT_ENABLED')
  })

  it('@anthropic-ai/sdk is not imported in runner (no live SDK without gate)', async () => {
    const src = fs.readFileSync(path.resolve('scripts/stage2c-runner.ts'), 'utf-8')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(src).not.toContain('@anthropic-ai/sdk')
  })
})

// ── Step 8 helpers ────────────────────────────────────────────────────────────

function managedAgentEnabledOpts(overrides: Partial<Stage2cRunnerInternalOpts> = {}): Stage2cRunnerInternalOpts {
  return {
    task: VALID_TASK,
    dryRun: false,
    managedAgent: true,
    _runtimeBaseForTesting: tmpBase,
    _repoPathForTesting: tmpRepo,
    _gitInfoForTesting: FAKE_GIT,
    _managedAgentEnvGateForTesting: '1',
    ...overrides,
  }
}

// Deterministic test adapter — proposes a WRITE_FILE inside workspace.
function makeDeterministicAdapter(overrides: Partial<ManagedAgentResult> = {}): ManagedAgentAdapter & { callCount: number } {
  const adapter = {
    transportName: 'deterministic-test-adapter-v1',
    callCount: 0,
    run(request: ManagedAgentRequest): ManagedAgentResult {
      adapter.callCount++
      return {
        transportName: 'deterministic-test-adapter-v1',
        toolActions: [{
          tool: 'WRITE_FILE' as const,
          targetPath: path.join(request.workspacePath, 'STAGE2C_MANAGED_AGENT_OUTPUT.md'),
          content: [
            '# STAGE2C Managed Agent Output',
            '',
            `**Task:** ${request.task}`,
            '',
            '**Marker:** DETERMINISTIC_MANAGED_AGENT_EXECUTION',
            '',
            'This file was written by the Stage 2C deterministic managed-agent test adapter.',
            'No real agent was invoked. No Anthropic API transport was used.',
            'builtinToolUseCount: 0',
          ].join('\n') + '\n',
        }],
        ...overrides,
      }
    },
  }
  return adapter
}

// Evil adapter — proposes a WRITE_FILE outside the workspace.
function makeEvilAdapter(outsidePath: string): ManagedAgentAdapter {
  return {
    transportName: 'evil-test-adapter',
    run(): ManagedAgentResult {
      return {
        transportName: 'evil-test-adapter',
        toolActions: [{
          tool: 'WRITE_FILE' as const,
          targetPath: outsidePath,
          content: 'escaped the workspace\n',
        }],
      }
    },
  }
}

// ── Step 8: env gate active, no adapter — blocked_no_adapter ─────────────────

describe('managed-agent enabled, no adapter — blocked_no_adapter', () => {
  it('emits MANAGED_AGENT_BLOCKED_NO_ADAPTER outcome', async () => {
    const result = await _runStage2cSkeletonForTesting(managedAgentEnabledOpts())
    expect(result.outcome).toBe('MANAGED_AGENT_BLOCKED_NO_ADAPTER')
    expect(result.blockerReason).toBe('')
  })

  it('no-adapter receipt is not null', async () => {
    expect((await _runStage2cSkeletonForTesting(managedAgentEnabledOpts())).receipt).not.toBeNull()
  })

  it('no-adapter receipt has step: 8', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentEnabledOpts())).receipt as Stage2cManagedAgentBlockedNoAdapterReceipt
    expect(r.step).toBe(8)
  })

  it('no-adapter receipt agentExecutionAttempted is false', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentEnabledOpts())).receipt as Stage2cManagedAgentBlockedNoAdapterReceipt
    expect(r.agentExecutionAttempted).toBe(false)
  })

  it('no-adapter receipt managedAgentTransport is blocked_no_adapter', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentEnabledOpts())).receipt as Stage2cManagedAgentBlockedNoAdapterReceipt
    expect(r.managedAgentTransport).toBe('blocked_no_adapter')
  })

  it('no-adapter receipt builtinToolUseCount is zero', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentEnabledOpts())).receipt as Stage2cManagedAgentBlockedNoAdapterReceipt
    expect(r.builtinToolUseCount).toBe(0)
  })

  it('no-adapter receipt oracleEvaluationAttempted is false', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentEnabledOpts())).receipt as Stage2cManagedAgentBlockedNoAdapterReceipt
    expect(r.oracleEvaluationAttempted).toBe(false)
  })

  it('no-adapter receipt terminalOutcome is MANAGED_AGENT_BLOCKED_NO_ADAPTER', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentEnabledOpts())).receipt as Stage2cManagedAgentBlockedNoAdapterReceipt
    expect(r.terminalOutcome).toBe('MANAGED_AGENT_BLOCKED_NO_ADAPTER')
  })

  it('no-adapter path does not write any workspace files', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentEnabledOpts())).receipt as Stage2cManagedAgentBlockedNoAdapterReceipt
    expect(fs.readdirSync(r.workspacePath).length).toBe(0)
  })

  it('no-adapter receipt is persisted to run directory', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentEnabledOpts())).receipt as Stage2cManagedAgentBlockedNoAdapterReceipt
    const receiptFile = path.join(r.runDir, 'stage2c-receipt.json')
    expect(fs.existsSync(receiptFile)).toBe(true)
    const persisted = JSON.parse(fs.readFileSync(receiptFile, 'utf-8'))
    expect(persisted.terminalOutcome).toBe('MANAGED_AGENT_BLOCKED_NO_ADAPTER')
    expect(persisted.agentExecutionAttempted).toBe(false)
  })

  it('no-adapter receipt captures repoManifestHashBefore and After', async () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const r = (await _runStage2cSkeletonForTesting(managedAgentEnabledOpts())).receipt as Stage2cManagedAgentBlockedNoAdapterReceipt
    expect(r.repoManifestHashBefore).not.toBeNull()
    expect(r.repoManifestHashAfter).not.toBeNull()
  })

  it('no-adapter receipt repoManifestImmutable is true when repo has files', async () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const r = (await _runStage2cSkeletonForTesting(managedAgentEnabledOpts())).receipt as Stage2cManagedAgentBlockedNoAdapterReceipt
    expect(r.repoManifestImmutable).toBe(true)
  })
})

// ── Step 8: no-adapter oracle suppression ─────────────────────────────────────

describe('managed-agent enabled no-adapter — oracle suppression', () => {
  it('no-adapter path does not run oracle even with --oracle flag', async () => {
    let oracleCalled = false
    const result = await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({
        oracle: true,
        _oracleEvaluatorForTesting: () => { oracleCalled = true; return PASS_ORACLE },
      }),
    )
    expect(result.outcome).toBe('MANAGED_AGENT_BLOCKED_NO_ADAPTER')
    expect(oracleCalled).toBe(false)
  })
})

// ── Step 8: enabled deterministic adapter — successful execution ──────────────

describe('managed-agent enabled adapter — successful execution', () => {
  it('emits MANAGED_AGENT_ADAPTER_WORKSPACE_MUTATION_RECORDED', async () => {
    const result = await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({ _managedAgentAdapterForTesting: makeDeterministicAdapter() }),
    )
    expect(result.outcome).toBe('MANAGED_AGENT_ADAPTER_WORKSPACE_MUTATION_RECORDED')
    expect(result.blockerReason).toBe('')
  })

  it('deterministic adapter is called exactly once', async () => {
    const adapter = makeDeterministicAdapter()
    await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({ _managedAgentAdapterForTesting: adapter }),
    )
    expect(adapter.callCount).toBe(1)
  })

  it('adapter is not called when env gate is absent (Step 7 remains unchanged)', async () => {
    const adapter = makeDeterministicAdapter()
    await _runStage2cSkeletonForTesting(
      managedAgentOpts({ _managedAgentAdapterForTesting: adapter }),
    )
    expect(adapter.callCount).toBe(0)
  })

  it('successful receipt agentExecutionAttempted is true', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({ _managedAgentAdapterForTesting: makeDeterministicAdapter() }),
    )).receipt as Stage2cManagedAgentAdapterReceipt
    expect(r.agentExecutionAttempted).toBe(true)
  })

  it('successful receipt managedAgentTransport matches adapter.transportName', async () => {
    const adapter = makeDeterministicAdapter()
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({ _managedAgentAdapterForTesting: adapter }),
    )).receipt as Stage2cManagedAgentAdapterReceipt
    expect(r.managedAgentTransport).toBe(adapter.transportName)
  })

  it('successful receipt builtinToolUseCount is zero', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({ _managedAgentAdapterForTesting: makeDeterministicAdapter() }),
    )).receipt as Stage2cManagedAgentAdapterReceipt
    expect(r.builtinToolUseCount).toBe(0)
  })

  it('successful receipt toolEvents has a typed WRITE_FILE event', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({ _managedAgentAdapterForTesting: makeDeterministicAdapter() }),
    )).receipt as Stage2cManagedAgentAdapterReceipt
    expect(r.toolEvents.length).toBeGreaterThanOrEqual(1)
    const ev = r.toolEvents[0] as FakeAgentToolEvent
    expect(ev.tool).toBe('WRITE_FILE')
    expect(ev.allowed).toBe(true)
    expect(ev.bytesWritten).toBeGreaterThan(0)
    expect(ev.denialReason).toBeUndefined()
  })

  it('workspace file is actually written by the runner through the typed boundary', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({ _managedAgentAdapterForTesting: makeDeterministicAdapter() }),
    )).receipt as Stage2cManagedAgentAdapterReceipt
    const outputFile = path.join(r.workspacePath, 'STAGE2C_MANAGED_AGENT_OUTPUT.md')
    expect(fs.existsSync(outputFile)).toBe(true)
    const content = fs.readFileSync(outputFile, 'utf-8')
    expect(content).toContain('DETERMINISTIC_MANAGED_AGENT_EXECUTION')
  })

  it('successful receipt workspaceManifestHashBefore is EMPTY and After is SHA-256', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({ _managedAgentAdapterForTesting: makeDeterministicAdapter() }),
    )).receipt as Stage2cManagedAgentAdapterReceipt
    expect(r.workspaceManifestHashBefore).toBe('EMPTY')
    expect(/^[a-f0-9]{64}$/.test(r.workspaceManifestHashAfter)).toBe(true)
    expect(r.workspaceManifestHashBefore).not.toBe(r.workspaceManifestHashAfter)
  })

  it('successful receipt records repo immutability', async () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({ _managedAgentAdapterForTesting: makeDeterministicAdapter() }),
    )).receipt as Stage2cManagedAgentAdapterReceipt
    expect(r.repoManifestImmutable).toBe(true)
    expect(r.repoManifestHashBefore).toBe(r.repoManifestHashAfter)
  })

  it('successful receipt oracleEvaluationAttempted is false', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({ _managedAgentAdapterForTesting: makeDeterministicAdapter() }),
    )).receipt as Stage2cManagedAgentAdapterReceipt
    expect(r.oracleEvaluationAttempted).toBe(false)
  })

  it('oracle suppressed even with --oracle flag on managed-agent path', async () => {
    let oracleCalled = false
    const result = await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({
        _managedAgentAdapterForTesting: makeDeterministicAdapter(),
        oracle: true,
        _oracleEvaluatorForTesting: () => { oracleCalled = true; return PASS_ORACLE },
      }),
    )
    expect(result.outcome).toBe('MANAGED_AGENT_ADAPTER_WORKSPACE_MUTATION_RECORDED')
    expect(oracleCalled).toBe(false)
  })

  it('successful receipt is persisted to run directory', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({ _managedAgentAdapterForTesting: makeDeterministicAdapter() }),
    )).receipt as Stage2cManagedAgentAdapterReceipt
    const receiptFile = path.join(r.runDir, 'stage2c-receipt.json')
    expect(fs.existsSync(receiptFile)).toBe(true)
    const persisted = JSON.parse(fs.readFileSync(receiptFile, 'utf-8'))
    expect(persisted.terminalOutcome).toBe('MANAGED_AGENT_ADAPTER_WORKSPACE_MUTATION_RECORDED')
    expect(persisted.agentExecutionAttempted).toBe(true)
  })

  it('successful receipt has step: 8', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({ _managedAgentAdapterForTesting: makeDeterministicAdapter() }),
    )).receipt as Stage2cManagedAgentAdapterReceipt
    expect(r.step).toBe(8)
    expect(r.schemaVersion).toBe(1)
    expect(r.stage).toBe('stage2c')
  })
})

// ── Step 8: adapter outside-workspace attempt — denied receipt ────────────────

describe('managed-agent adapter — denied outside workspace', () => {
  it('outside-workspace adapter attempt emits MANAGED_AGENT_ADAPTER_TOOL_DENIED_OUTSIDE_WORKSPACE', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-ma-${Date.now()}.txt`)
    const result = await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({ _managedAgentAdapterForTesting: makeEvilAdapter(outsidePath) }),
    )
    expect(result.outcome).toBe('MANAGED_AGENT_ADAPTER_TOOL_DENIED_OUTSIDE_WORKSPACE')
    expect(result.blockerReason).toBe('')
  })

  it('denied adapter receipt is not null', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-ma-${Date.now()}.txt`)
    const result = await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({ _managedAgentAdapterForTesting: makeEvilAdapter(outsidePath) }),
    )
    expect(result.receipt).not.toBeNull()
  })

  it('denied adapter receipt agentExecutionAttempted is true', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-ma-${Date.now()}.txt`)
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({ _managedAgentAdapterForTesting: makeEvilAdapter(outsidePath) }),
    )).receipt as Stage2cManagedAgentAdapterDeniedReceipt
    expect(r.agentExecutionAttempted).toBe(true)
  })

  it('denied adapter tool event has allowed: false', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-ma-${Date.now()}.txt`)
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({ _managedAgentAdapterForTesting: makeEvilAdapter(outsidePath) }),
    )).receipt as Stage2cManagedAgentAdapterDeniedReceipt
    expect(r.toolEvents[0]!.allowed).toBe(false)
  })

  it('denied adapter tool event denialReason is TARGET_OUTSIDE_WORKSPACE', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-ma-${Date.now()}.txt`)
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({ _managedAgentAdapterForTesting: makeEvilAdapter(outsidePath) }),
    )).receipt as Stage2cManagedAgentAdapterDeniedReceipt
    expect(r.toolEvents[0]!.denialReason).toBe('TARGET_OUTSIDE_WORKSPACE')
  })

  it('denied adapter attempt creates no file at the outside path', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-ma-${Date.now()}.txt`)
    await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({ _managedAgentAdapterForTesting: makeEvilAdapter(outsidePath) }),
    )
    expect(fs.existsSync(outsidePath)).toBe(false)
  })

  it('denied adapter receipt repoManifestImmutable is preserved', async () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const outsidePath = path.join(os.tmpdir(), `evil-ma-${Date.now()}.txt`)
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({ _managedAgentAdapterForTesting: makeEvilAdapter(outsidePath) }),
    )).receipt as Stage2cManagedAgentAdapterDeniedReceipt
    expect(r.repoManifestImmutable).toBe(true)
  })

  it('denied adapter receipt oracleEvaluationAttempted is false', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-ma-${Date.now()}.txt`)
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({ _managedAgentAdapterForTesting: makeEvilAdapter(outsidePath) }),
    )).receipt as Stage2cManagedAgentAdapterDeniedReceipt
    expect(r.oracleEvaluationAttempted).toBe(false)
  })
})

// ── Step 8: dry-run wins over env gate and managed-agent flag ─────────────────

describe('managed-agent Step 8 — dry-run bypasses env gate', () => {
  it('dryRun + managedAgent + env gate emits SKELETON_NO_AGENT_EXECUTION', async () => {
    const adapter = makeDeterministicAdapter()
    const result = await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({
        dryRun: true,
        _managedAgentAdapterForTesting: adapter,
      }),
    )
    expect(result.outcome).toBe('SKELETON_NO_AGENT_EXECUTION')
    expect(adapter.callCount).toBe(0)
  })

  it('dryRun + env gate does not write any workspace files', async () => {
    const result = await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({
        dryRun: true,
        _managedAgentAdapterForTesting: makeDeterministicAdapter(),
      }),
    )
    const r = result.receipt as Stage2cSkeletonReceipt
    expect(fs.readdirSync(r.workspacePath).length).toBe(0)
  })
})

// ── Step 8: static invariants ─────────────────────────────────────────────────

describe('stage2c-runner static invariants — Step 8', () => {
  it('no @anthropic-ai/sdk import was added', async () => {
    const src = fs.readFileSync(path.resolve('scripts/stage2c-runner.ts'), 'utf-8')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(src).not.toContain('@anthropic-ai/sdk')
  })

  it('public Stage2cRunnerOpts exposes no test seams', async () => {
    const src = fs.readFileSync(path.resolve('scripts/stage2c-runner.ts'), 'utf-8')
    const match = src.match(/export interface Stage2cRunnerOpts \{[\s\S]*?\n\}/)
    expect(match).not.toBeNull()
    expect(match![0]).not.toContain('_runtimeBaseForTesting')
    expect(match![0]).not.toContain('_repoPathForTesting')
    expect(match![0]).not.toContain('_gitInfoForTesting')
    expect(match![0]).not.toContain('_oracleEvaluatorForTesting')
    expect(match![0]).not.toContain('_managedAgentAdapterForTesting')
    expect(match![0]).not.toContain('_managedAgentEnvGateForTesting')
  })

  it('ManagedAgentToolAction is exported (visible to test adapters)', async () => {
    const src = fs.readFileSync(path.resolve('scripts/stage2c-runner.ts'), 'utf-8')
    expect(src).toContain('export interface ManagedAgentToolAction')
  })
})

// ── Step 9 helper ─────────────────────────────────────────────────────────────

function managedAgentEnabledLiveOpts(overrides: Partial<Stage2cRunnerInternalOpts> = {}): Stage2cRunnerInternalOpts {
  return {
    task: VALID_TASK,
    dryRun: false,
    managedAgent: true,
    _runtimeBaseForTesting: tmpBase,
    _repoPathForTesting: tmpRepo,
    _gitInfoForTesting: FAKE_GIT,
    _managedAgentEnvGateForTesting: '1',
    _managedAgentLiveGateForTesting: '1',
    _credentialCheckForTesting: () => ({ available: false, missingVars: ['ANTHROPIC_API_KEY'] }),
    ...overrides,
  }
}

// ── Step 9: missing-credentials receipt shape ─────────────────────────────────

describe('managed-agent live gate active — missing credentials receipt', () => {
  it('emits MANAGED_AGENT_BLOCKED_MISSING_CREDENTIALS outcome', async () => {
    const result = await _runStage2cSkeletonForTesting(managedAgentEnabledLiveOpts())
    expect(result.outcome).toBe('MANAGED_AGENT_BLOCKED_MISSING_CREDENTIALS')
    expect(result.blockerReason).toBe('')
  })

  it('missing-credentials receipt is not null', async () => {
    expect((await _runStage2cSkeletonForTesting(managedAgentEnabledLiveOpts())).receipt).not.toBeNull()
  })

  it('missing-credentials receipt has step: 9', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentEnabledLiveOpts())).receipt as Stage2cManagedAgentMissingCredentialsReceipt
    expect(r.step).toBe(9)
  })

  it('missing-credentials receipt agentExecutionAttempted is false', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentEnabledLiveOpts())).receipt as Stage2cManagedAgentMissingCredentialsReceipt
    expect(r.agentExecutionAttempted).toBe(false)
  })

  it('missing-credentials receipt managedAgentTransport is blocked_missing_credentials', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentEnabledLiveOpts())).receipt as Stage2cManagedAgentMissingCredentialsReceipt
    expect(r.managedAgentTransport).toBe('blocked_missing_credentials')
  })

  it('missing-credentials receipt builtinToolUseCount is zero', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentEnabledLiveOpts())).receipt as Stage2cManagedAgentMissingCredentialsReceipt
    expect(r.builtinToolUseCount).toBe(0)
  })

  it('missing-credentials receipt oracleEvaluationAttempted is false', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentEnabledLiveOpts())).receipt as Stage2cManagedAgentMissingCredentialsReceipt
    expect(r.oracleEvaluationAttempted).toBe(false)
  })

  it('missing-credentials receipt terminalOutcome is MANAGED_AGENT_BLOCKED_MISSING_CREDENTIALS', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentEnabledLiveOpts())).receipt as Stage2cManagedAgentMissingCredentialsReceipt
    expect(r.terminalOutcome).toBe('MANAGED_AGENT_BLOCKED_MISSING_CREDENTIALS')
  })

  it('missing-credentials receipt has correct schema and stage fields', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentEnabledLiveOpts())).receipt as Stage2cManagedAgentMissingCredentialsReceipt
    expect(r.schemaVersion).toBe(1)
    expect(r.stage).toBe('stage2c')
    expect(r.dryRun).toBe(false)
    expect(r.task).toBe(VALID_TASK)
    expect(r.runId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('missing-credentials path does not write any workspace files', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentEnabledLiveOpts())).receipt as Stage2cManagedAgentMissingCredentialsReceipt
    expect(fs.readdirSync(r.workspacePath).length).toBe(0)
  })

  it('missing-credentials receipt is persisted to run directory', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentEnabledLiveOpts())).receipt as Stage2cManagedAgentMissingCredentialsReceipt
    const receiptFile = path.join(r.runDir, 'stage2c-receipt.json')
    expect(fs.existsSync(receiptFile)).toBe(true)
    const persisted = JSON.parse(fs.readFileSync(receiptFile, 'utf-8'))
    expect(persisted.terminalOutcome).toBe('MANAGED_AGENT_BLOCKED_MISSING_CREDENTIALS')
    expect(persisted.agentExecutionAttempted).toBe(false)
  })

  it('missing-credentials receipt captures repoManifestHashBefore and After', async () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const r = (await _runStage2cSkeletonForTesting(managedAgentEnabledLiveOpts())).receipt as Stage2cManagedAgentMissingCredentialsReceipt
    expect(r.repoManifestHashBefore).not.toBeNull()
    expect(r.repoManifestHashAfter).not.toBeNull()
  })

  it('missing-credentials receipt repoManifestImmutable is true when repo has files', async () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const r = (await _runStage2cSkeletonForTesting(managedAgentEnabledLiveOpts())).receipt as Stage2cManagedAgentMissingCredentialsReceipt
    expect(r.repoManifestImmutable).toBe(true)
  })
})

// ── Step 9: oracle suppression in missing-credentials path ────────────────────

describe('managed-agent missing-credentials — oracle suppression', () => {
  it('missing-credentials path does not run oracle even with --oracle flag', async () => {
    let oracleCalled = false
    const result = await _runStage2cSkeletonForTesting(
      managedAgentEnabledLiveOpts({
        oracle: true,
        _oracleEvaluatorForTesting: () => { oracleCalled = true; return PASS_ORACLE },
      }),
    )
    expect(result.outcome).toBe('MANAGED_AGENT_BLOCKED_MISSING_CREDENTIALS')
    expect(oracleCalled).toBe(false)
  })
})

// ── Step 9: credential check invocation guards ────────────────────────────────

describe('managed-agent credential check invocation guards', () => {
  it('credentials check not invoked when env gate absent (no matter live gate state)', async () => {
    let checkCalled = false
    await _runStage2cSkeletonForTesting(
      managedAgentOpts({
        _managedAgentLiveGateForTesting: '1',
        _credentialCheckForTesting: () => { checkCalled = true; return { available: false, missingVars: [] } },
      }),
    )
    expect(checkCalled).toBe(false)
  })

  it('credentials check not invoked when live gate absent (env gate set, no adapter)', async () => {
    let checkCalled = false
    await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({
        _credentialCheckForTesting: () => { checkCalled = true; return { available: false, missingVars: [] } },
      }),
    )
    expect(checkCalled).toBe(false)
  })

  it('credentials check invoked exactly once when both gates set and no test adapter', async () => {
    let checkCount = 0
    await _runStage2cSkeletonForTesting(
      managedAgentEnabledLiveOpts({
        _credentialCheckForTesting: () => { checkCount++; return { available: false, missingVars: ['ANTHROPIC_API_KEY'] } },
      }),
    )
    expect(checkCount).toBe(1)
  })

  it('credentials check not invoked when test adapter is present (Step 8 path bypasses it)', async () => {
    let checkCalled = false
    await _runStage2cSkeletonForTesting(
      managedAgentEnabledLiveOpts({
        _managedAgentAdapterForTesting: makeDeterministicAdapter(),
        _credentialCheckForTesting: () => { checkCalled = true; return { available: false, missingVars: [] } },
      }),
    )
    expect(checkCalled).toBe(false)
  })
})

// ── Step 9: workspace non-mutation in missing-credentials path ────────────────

describe('managed-agent missing-credentials — workspace non-mutation', () => {
  it('no workspace files written when credentials are missing', async () => {
    const r = (await _runStage2cSkeletonForTesting(managedAgentEnabledLiveOpts())).receipt as Stage2cManagedAgentMissingCredentialsReceipt
    expect(fs.readdirSync(r.workspacePath).length).toBe(0)
  })

  it('repoManifestHashBefore equals repoManifestHashAfter in missing-credentials path', async () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const r = (await _runStage2cSkeletonForTesting(managedAgentEnabledLiveOpts())).receipt as Stage2cManagedAgentMissingCredentialsReceipt
    expect(r.repoManifestHashBefore).toBe(r.repoManifestHashAfter)
  })
})

// ── Step 9: Step 8 paths remain unchanged ────────────────────────────────────

describe('managed-agent Step 9 — Step 8 compatibility', () => {
  it('no live gate + no adapter still emits MANAGED_AGENT_BLOCKED_NO_ADAPTER (Step 8 unchanged)', async () => {
    const result = await _runStage2cSkeletonForTesting(managedAgentEnabledOpts())
    expect(result.outcome).toBe('MANAGED_AGENT_BLOCKED_NO_ADAPTER')
  })

  it('test adapter with both gates executes successfully (Step 8 adapter path unchanged)', async () => {
    const result = await _runStage2cSkeletonForTesting(
      managedAgentEnabledLiveOpts({ _managedAgentAdapterForTesting: makeDeterministicAdapter() }),
    )
    expect(result.outcome).toBe('MANAGED_AGENT_ADAPTER_WORKSPACE_MUTATION_RECORDED')
  })

  it('fake-agent oracle-pass fixture still produces PASS (unchanged)', async () => {
    const result = await _runStage2cSkeletonForTesting(oraclePassOpts())
    expect(result.outcome).toBe('FAKE_AGENT_ORACLE_EVALUATED')
    const r = result.receipt as Stage2cFakeAgentOracleReceipt
    expect(r.oracleResult.status).toBe('PASS')
  })
})

// ── Step 9: static invariants ─────────────────────────────────────────────────

describe('stage2c-runner static invariants — Step 9', () => {
  it('@anthropic-ai/sdk is not imported in runner', async () => {
    const src = fs.readFileSync(path.resolve('scripts/stage2c-runner.ts'), 'utf-8')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(src).not.toContain('@anthropic-ai/sdk')
  })

  it('STAGE2C_MANAGED_AGENT_LIVE env gate is present in runner executable code', async () => {
    const src = fs.readFileSync(path.resolve('scripts/stage2c-runner.ts'), 'utf-8')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(src).toContain('STAGE2C_MANAGED_AGENT_LIVE')
  })

  it('stage2c-real-adapter.ts has no top-level @anthropic-ai/sdk import (lazy only)', async () => {
    const src = fs.readFileSync(path.resolve('scripts/stage2c-real-adapter.ts'), 'utf-8')
    // Top-level static imports start the line with 'import '
    const topLevelImports = src.split('\n').filter(l => l.match(/^import\s/)).join('\n')
    expect(topLevelImports).not.toContain('@anthropic-ai/sdk')
  })

  it('stage2c-real-adapter.ts contains a lazy @anthropic-ai/sdk dynamic import (Step 10)', async () => {
    const src = fs.readFileSync(path.resolve('scripts/stage2c-real-adapter.ts'), 'utf-8')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(src).toContain("import('@anthropic-ai/sdk')")
  })

  it('stage2c-real-adapter.ts exists as the real adapter shell', async () => {
    expect(fs.existsSync(path.resolve('scripts/stage2c-real-adapter.ts'))).toBe(true)
  })

  it('public Stage2cRunnerOpts exposes no Step 9 test seams', async () => {
    const src = fs.readFileSync(path.resolve('scripts/stage2c-runner.ts'), 'utf-8')
    const match = src.match(/export interface Stage2cRunnerOpts \{[\s\S]*?\n\}/)
    expect(match).not.toBeNull()
    expect(match![0]).not.toContain('_managedAgentLiveGateForTesting')
    expect(match![0]).not.toContain('_credentialCheckForTesting')
  })

  it('Stage2cManagedAgentMissingCredentialsReceipt is exported', async () => {
    const src = fs.readFileSync(path.resolve('scripts/stage2c-runner.ts'), 'utf-8')
    expect(src).toContain('export interface Stage2cManagedAgentMissingCredentialsReceipt')
  })
})

// ── Step 10 helpers ───────────────────────────────────────────────────────────

const REAL_TRANSPORT = 'real-managed-agent-v1'

// Opts with all gates passing + injectable factory (no test adapter injected).
function managedAgentAllGatesOpts(
  factoryOverride?: () => ManagedAgentAdapter,
  overrides: Partial<Stage2cRunnerInternalOpts> = {},
): Stage2cRunnerInternalOpts {
  return {
    task: VALID_TASK,
    dryRun: false,
    managedAgent: true,
    _runtimeBaseForTesting: tmpBase,
    _repoPathForTesting: tmpRepo,
    _gitInfoForTesting: FAKE_GIT,
    _managedAgentEnvGateForTesting: '1',
    _managedAgentLiveGateForTesting: '1',
    _credentialCheckForTesting: () => ({ available: true, missingVars: [] }),
    ...(factoryOverride ? { _realAdapterFactoryForTesting: factoryOverride } : {}),
    ...overrides,
  }
}

// Factory that returns a throwing adapter (simulates malformed/invalid response).
function makeThrowingAdapterFactory(
  transportName = REAL_TRANSPORT,
  message = 'MANAGED_AGENT_ADAPTER_INVALID_RESPONSE: simulated bad response',
): () => ManagedAgentAdapter {
  return () => ({
    transportName,
    run(): Promise<ManagedAgentResult> {
      return Promise.reject(new Error(message))
    },
  })
}

// Factory that returns a valid adapter writing inside the workspace.
function makeValidRealAdapterFactory(): () => ManagedAgentAdapter {
  return () => ({
    transportName: REAL_TRANSPORT,
    run(request: ManagedAgentRequest): ManagedAgentResult {
      return {
        transportName: REAL_TRANSPORT,
        toolActions: [{
          tool: 'WRITE_FILE' as const,
          targetPath: path.join(request.workspacePath, 'STAGE2C_REAL_AGENT_OUTPUT.md'),
          content: '# Stage 2C Real Agent Output\nbuiltinToolUseCount: 0\n',
        }],
      }
    },
  })
}

// Factory that returns an adapter proposing an outside-workspace write.
function makeEvilRealAdapterFactory(outsidePath: string): () => ManagedAgentAdapter {
  return () => makeEvilAdapter(outsidePath)
}

// ── Step 10: gate-preservation tests ─────────────────────────────────────────
//
// Proves that adding Step 10 does not break Step 7–9 gate behaviors.

describe('managed-agent Step 10 — existing gate behaviors preserved', () => {
  it('no env gate still emits MANAGED_AGENT_BLOCKED_NOT_ENABLED', async () => {
    const result = await _runStage2cSkeletonForTesting(managedAgentOpts())
    expect(result.outcome).toBe('MANAGED_AGENT_BLOCKED_NOT_ENABLED')
  })

  it('enabled gate without live gate still emits MANAGED_AGENT_BLOCKED_NO_ADAPTER', async () => {
    const result = await _runStage2cSkeletonForTesting(managedAgentEnabledOpts())
    expect(result.outcome).toBe('MANAGED_AGENT_BLOCKED_NO_ADAPTER')
  })

  it('live gate without credentials still emits MANAGED_AGENT_BLOCKED_MISSING_CREDENTIALS', async () => {
    const result = await _runStage2cSkeletonForTesting(managedAgentEnabledLiveOpts())
    expect(result.outcome).toBe('MANAGED_AGENT_BLOCKED_MISSING_CREDENTIALS')
  })

  it('fake-agent oracle-pass fixture still PASSes (Step 6 unchanged)', async () => {
    const result = await _runStage2cSkeletonForTesting(oraclePassOpts())
    expect(result.outcome).toBe('FAKE_AGENT_ORACLE_EVALUATED')
    const r = result.receipt as Stage2cFakeAgentOracleReceipt
    expect(r.oracleResult.status).toBe('PASS')
  })

  it('deterministic test adapter still executes via Step 8 path', async () => {
    const result = await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({ _managedAgentAdapterForTesting: makeDeterministicAdapter() }),
    )
    expect(result.outcome).toBe('MANAGED_AGENT_ADAPTER_WORKSPACE_MUTATION_RECORDED')
  })
})

// ── Step 10: real adapter factory gating ──────────────────────────────────────

describe('managed-agent Step 10 — real adapter factory not called until all gates pass', () => {
  it('factory not called when env gate absent', async () => {
    let factoryCalled = false
    await _runStage2cSkeletonForTesting(
      managedAgentOpts({
        _realAdapterFactoryForTesting: () => {
          factoryCalled = true
          return makeDeterministicAdapter()
        },
      }),
    )
    expect(factoryCalled).toBe(false)
  })

  it('factory not called when live gate absent (env gate set)', async () => {
    let factoryCalled = false
    await _runStage2cSkeletonForTesting(
      managedAgentEnabledOpts({
        _realAdapterFactoryForTesting: () => {
          factoryCalled = true
          return makeDeterministicAdapter()
        },
      }),
    )
    expect(factoryCalled).toBe(false)
  })

  it('factory not called when credentials missing (both gates set)', async () => {
    let factoryCalled = false
    await _runStage2cSkeletonForTesting(
      managedAgentEnabledLiveOpts({
        _realAdapterFactoryForTesting: () => {
          factoryCalled = true
          return makeDeterministicAdapter()
        },
      }),
    )
    expect(factoryCalled).toBe(false)
  })

  it('factory called exactly once when all gates pass and credentials available', async () => {
    let factoryCallCount = 0
    await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(() => {
        factoryCallCount++
        return makeDeterministicAdapter()
      }),
    )
    expect(factoryCallCount).toBe(1)
  })

  it('factory not called when test adapter is already injected (Step 8 path)', async () => {
    let factoryCalled = false
    await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(
        () => { factoryCalled = true; return makeDeterministicAdapter() },
        { _managedAgentAdapterForTesting: makeDeterministicAdapter() },
      ),
    )
    expect(factoryCalled).toBe(false)
  })
})

// ── Step 10: invalid response receipt ─────────────────────────────────────────

describe('managed-agent Step 10 — invalid response receipt shape', () => {
  it('throwing adapter yields MANAGED_AGENT_ADAPTER_INVALID_RESPONSE outcome', async () => {
    const result = await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeThrowingAdapterFactory()),
    )
    expect(result.outcome).toBe('MANAGED_AGENT_ADAPTER_INVALID_RESPONSE')
    expect(result.blockerReason).toBe('')
  })

  it('invalid response receipt is not null', async () => {
    const result = await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeThrowingAdapterFactory()),
    )
    expect(result.receipt).not.toBeNull()
  })

  it('invalid response receipt has step: 10', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeThrowingAdapterFactory()),
    )).receipt as Stage2cManagedAgentAdapterInvalidResponseReceipt
    expect(r.step).toBe(10)
    expect(r.schemaVersion).toBe(1)
    expect(r.stage).toBe('stage2c')
  })

  it('invalid response receipt agentExecutionAttempted is true', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeThrowingAdapterFactory()),
    )).receipt as Stage2cManagedAgentAdapterInvalidResponseReceipt
    expect(r.agentExecutionAttempted).toBe(true)
  })

  it('invalid response receipt managedAgentTransport matches adapter transportName', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeThrowingAdapterFactory(REAL_TRANSPORT)),
    )).receipt as Stage2cManagedAgentAdapterInvalidResponseReceipt
    expect(r.managedAgentTransport).toBe(REAL_TRANSPORT)
  })

  it('invalid response receipt builtinToolUseCount is zero', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeThrowingAdapterFactory()),
    )).receipt as Stage2cManagedAgentAdapterInvalidResponseReceipt
    expect(r.builtinToolUseCount).toBe(0)
  })

  it('invalid response receipt toolEvents is empty array', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeThrowingAdapterFactory()),
    )).receipt as Stage2cManagedAgentAdapterInvalidResponseReceipt
    expect(r.toolEvents).toEqual([])
  })

  it('invalid response receipt oracleEvaluationAttempted is false', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeThrowingAdapterFactory()),
    )).receipt as Stage2cManagedAgentAdapterInvalidResponseReceipt
    expect(r.oracleEvaluationAttempted).toBe(false)
  })

  it('invalid response terminalOutcome is MANAGED_AGENT_ADAPTER_INVALID_RESPONSE', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeThrowingAdapterFactory()),
    )).receipt as Stage2cManagedAgentAdapterInvalidResponseReceipt
    expect(r.terminalOutcome).toBe('MANAGED_AGENT_ADAPTER_INVALID_RESPONSE')
  })

  it('invalid response creates no workspace files', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeThrowingAdapterFactory()),
    )).receipt as Stage2cManagedAgentAdapterInvalidResponseReceipt
    expect(fs.readdirSync(r.workspacePath).length).toBe(0)
  })

  it('invalid response receipt repo is immutable', async () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeThrowingAdapterFactory()),
    )).receipt as Stage2cManagedAgentAdapterInvalidResponseReceipt
    expect(r.repoManifestImmutable).toBe(true)
  })

  it('invalid response receipt is persisted to run directory', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeThrowingAdapterFactory()),
    )).receipt as Stage2cManagedAgentAdapterInvalidResponseReceipt
    const receiptFile = path.join(r.runDir, 'stage2c-receipt.json')
    expect(fs.existsSync(receiptFile)).toBe(true)
    const persisted = JSON.parse(fs.readFileSync(receiptFile, 'utf-8'))
    expect(persisted.terminalOutcome).toBe('MANAGED_AGENT_ADAPTER_INVALID_RESPONSE')
    expect(persisted.agentExecutionAttempted).toBe(true)
    expect(persisted.toolEvents).toEqual([])
  })
})

// ── Step 10: valid adapter via factory seam ───────────────────────────────────

describe('managed-agent Step 10 — valid in-workspace write via factory seam', () => {
  it('yields MANAGED_AGENT_ADAPTER_WORKSPACE_MUTATION_RECORDED', async () => {
    const result = await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeValidRealAdapterFactory()),
    )
    expect(result.outcome).toBe('MANAGED_AGENT_ADAPTER_WORKSPACE_MUTATION_RECORDED')
    expect(result.blockerReason).toBe('')
  })

  it('valid adapter receipt agentExecutionAttempted is true', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeValidRealAdapterFactory()),
    )).receipt as Stage2cManagedAgentAdapterReceipt
    expect(r.agentExecutionAttempted).toBe(true)
  })

  it('valid adapter receipt managedAgentTransport is real transport name', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeValidRealAdapterFactory()),
    )).receipt as Stage2cManagedAgentAdapterReceipt
    expect(r.managedAgentTransport).toBe(REAL_TRANSPORT)
  })

  it('valid adapter receipt builtinToolUseCount is zero', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeValidRealAdapterFactory()),
    )).receipt as Stage2cManagedAgentAdapterReceipt
    expect(r.builtinToolUseCount).toBe(0)
  })

  it('valid adapter receipt has a typed WRITE_FILE event with allowed: true', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeValidRealAdapterFactory()),
    )).receipt as Stage2cManagedAgentAdapterReceipt
    expect(r.toolEvents.length).toBeGreaterThanOrEqual(1)
    expect(r.toolEvents[0]!.tool).toBe('WRITE_FILE')
    expect(r.toolEvents[0]!.allowed).toBe(true)
    expect(r.toolEvents[0]!.bytesWritten).toBeGreaterThan(0)
    expect(r.toolEvents[0]!.denialReason).toBeUndefined()
  })

  it('workspace file is written through the typed boundary', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeValidRealAdapterFactory()),
    )).receipt as Stage2cManagedAgentAdapterReceipt
    const outputFile = path.join(r.workspacePath, 'STAGE2C_REAL_AGENT_OUTPUT.md')
    expect(fs.existsSync(outputFile)).toBe(true)
  })

  it('valid adapter receipt records workspace manifest change', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeValidRealAdapterFactory()),
    )).receipt as Stage2cManagedAgentAdapterReceipt
    expect(r.workspaceManifestHashBefore).toBe('EMPTY')
    expect(/^[a-f0-9]{64}$/.test(r.workspaceManifestHashAfter)).toBe(true)
    expect(r.workspaceManifestHashBefore).not.toBe(r.workspaceManifestHashAfter)
  })

  it('valid adapter receipt records repo immutability', async () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeValidRealAdapterFactory()),
    )).receipt as Stage2cManagedAgentAdapterReceipt
    expect(r.repoManifestImmutable).toBe(true)
    expect(r.repoManifestHashBefore).toBe(r.repoManifestHashAfter)
  })

  it('valid adapter receipt oracleEvaluationAttempted is false', async () => {
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeValidRealAdapterFactory()),
    )).receipt as Stage2cManagedAgentAdapterReceipt
    expect(r.oracleEvaluationAttempted).toBe(false)
  })
})

// ── Step 10: outside-workspace adapter via factory seam ───────────────────────

describe('managed-agent Step 10 — outside-workspace write via factory seam', () => {
  it('yields MANAGED_AGENT_ADAPTER_TOOL_DENIED_OUTSIDE_WORKSPACE', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-step10-${Date.now()}.txt`)
    const result = await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeEvilRealAdapterFactory(outsidePath)),
    )
    expect(result.outcome).toBe('MANAGED_AGENT_ADAPTER_TOOL_DENIED_OUTSIDE_WORKSPACE')
    expect(result.blockerReason).toBe('')
  })

  it('denied receipt agentExecutionAttempted is true', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-step10-${Date.now()}.txt`)
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeEvilRealAdapterFactory(outsidePath)),
    )).receipt as Stage2cManagedAgentAdapterDeniedReceipt
    expect(r.agentExecutionAttempted).toBe(true)
  })

  it('denied receipt tool event has allowed: false and denialReason', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-step10-${Date.now()}.txt`)
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeEvilRealAdapterFactory(outsidePath)),
    )).receipt as Stage2cManagedAgentAdapterDeniedReceipt
    expect(r.toolEvents[0]!.allowed).toBe(false)
    expect(r.toolEvents[0]!.denialReason).toBe('TARGET_OUTSIDE_WORKSPACE')
  })

  it('denied adapter attempt creates no file at the outside path', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-step10-${Date.now()}.txt`)
    await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeEvilRealAdapterFactory(outsidePath)),
    )
    expect(fs.existsSync(outsidePath)).toBe(false)
  })

  it('denied receipt builtinToolUseCount is zero', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-step10-${Date.now()}.txt`)
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeEvilRealAdapterFactory(outsidePath)),
    )).receipt as Stage2cManagedAgentAdapterDeniedReceipt
    expect(r.builtinToolUseCount).toBe(0)
  })

  it('denied receipt repo is immutable', async () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const outsidePath = path.join(os.tmpdir(), `evil-step10-${Date.now()}.txt`)
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeEvilRealAdapterFactory(outsidePath)),
    )).receipt as Stage2cManagedAgentAdapterDeniedReceipt
    expect(r.repoManifestImmutable).toBe(true)
  })

  it('denied receipt oracleEvaluationAttempted is false', async () => {
    const outsidePath = path.join(os.tmpdir(), `evil-step10-${Date.now()}.txt`)
    const r = (await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeEvilRealAdapterFactory(outsidePath)),
    )).receipt as Stage2cManagedAgentAdapterDeniedReceipt
    expect(r.oracleEvaluationAttempted).toBe(false)
  })
})

// ── Step 10: dry-run wins over all live flags ─────────────────────────────────

describe('managed-agent Step 10 — dry-run wins over all gates', () => {
  it('dryRun + all gates + factory emits SKELETON_NO_AGENT_EXECUTION', async () => {
    let factoryCalled = false
    const result = await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(
        () => { factoryCalled = true; return makeDeterministicAdapter() },
        { dryRun: true },
      ),
    )
    expect(result.outcome).toBe('SKELETON_NO_AGENT_EXECUTION')
    expect(factoryCalled).toBe(false)
  })

  it('dryRun + all gates does not write any workspace files', async () => {
    const result = await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeValidRealAdapterFactory(), { dryRun: true }),
    )
    const r = result.receipt as Stage2cSkeletonReceipt
    expect(fs.readdirSync(r.workspacePath).length).toBe(0)
  })
})

// ── Step 10: oracle suppressed in all paths ───────────────────────────────────

describe('managed-agent Step 10 — oracle suppressed', () => {
  it('invalid response path oracleEvaluationAttempted is false even with oracle flag', async () => {
    let oracleCalled = false
    const result = await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeThrowingAdapterFactory(), {
        oracle: true,
        _oracleEvaluatorForTesting: () => { oracleCalled = true; return PASS_ORACLE },
      }),
    )
    expect(result.outcome).toBe('MANAGED_AGENT_ADAPTER_INVALID_RESPONSE')
    expect(oracleCalled).toBe(false)
  })

  it('valid adapter path oracleEvaluationAttempted is false even with oracle flag', async () => {
    let oracleCalled = false
    const result = await _runStage2cSkeletonForTesting(
      managedAgentAllGatesOpts(makeValidRealAdapterFactory(), {
        oracle: true,
        _oracleEvaluatorForTesting: () => { oracleCalled = true; return PASS_ORACLE },
      }),
    )
    expect(result.outcome).toBe('MANAGED_AGENT_ADAPTER_WORKSPACE_MUTATION_RECORDED')
    expect(oracleCalled).toBe(false)
  })
})

// ── Step 10: static invariants ────────────────────────────────────────────────

describe('stage2c-runner static invariants — Step 10', () => {
  it('runner does not import @anthropic-ai/sdk', async () => {
    const src = fs.readFileSync(path.resolve('scripts/stage2c-runner.ts'), 'utf-8')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(src).not.toContain('@anthropic-ai/sdk')
  })

  it('runner imports createRealManagedAgentAdapter from real adapter', async () => {
    const src = fs.readFileSync(path.resolve('scripts/stage2c-runner.ts'), 'utf-8')
      .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(src).toContain('createRealManagedAgentAdapter')
  })

  it('MANAGED_AGENT_ADAPTER_INVALID_RESPONSE is in Stage2cRunnerOutcome', async () => {
    const src = fs.readFileSync(path.resolve('scripts/stage2c-runner.ts'), 'utf-8')
    expect(src).toContain("'MANAGED_AGENT_ADAPTER_INVALID_RESPONSE'")
  })

  it('Stage2cManagedAgentAdapterInvalidResponseReceipt is exported', async () => {
    const src = fs.readFileSync(path.resolve('scripts/stage2c-runner.ts'), 'utf-8')
    expect(src).toContain('export interface Stage2cManagedAgentAdapterInvalidResponseReceipt')
  })

  it('public Stage2cRunnerOpts exposes no Step 10 test seams', async () => {
    const src = fs.readFileSync(path.resolve('scripts/stage2c-runner.ts'), 'utf-8')
    const match = src.match(/export interface Stage2cRunnerOpts \{[\s\S]*?\n\}/)
    expect(match).not.toBeNull()
    expect(match![0]).not.toContain('_realAdapterFactoryForTesting')
    expect(match![0]).not.toContain('_managedAgentAdapterForTesting')
    expect(match![0]).not.toContain('_credentialCheckForTesting')
  })

  it('_realAdapterFactoryForTesting is only on Stage2cRunnerInternalOpts', async () => {
    const src = fs.readFileSync(path.resolve('scripts/stage2c-runner.ts'), 'utf-8')
    expect(src).toContain('_realAdapterFactoryForTesting')
    // Must NOT appear in Stage2cRunnerOpts block
    const optsBlock = src.match(/export interface Stage2cRunnerOpts \{[\s\S]*?\n\}/)
    expect(optsBlock![0]).not.toContain('_realAdapterFactoryForTesting')
  })
})
