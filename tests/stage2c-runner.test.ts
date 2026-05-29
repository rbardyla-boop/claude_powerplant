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
  FakeAgentToolEvent,
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

  it('does not import @anthropic-ai/sdk', () => {
    expect(src).not.toContain('@anthropic-ai/sdk')
  })

  it('does not reference ANTHROPIC_API_KEY in executable code', () => {
    expect(src).not.toContain('ANTHROPIC_API_KEY')
  })

  it('does not call or import promoteSkill', () => {
    expect(src).not.toContain('promoteSkill')
  })

  it('production runStage2cSkeleton does not expose injectable seams', () => {
    const full = fs.readFileSync(path.resolve('scripts/stage2c-runner.ts'), 'utf-8')
    expect(full).toMatch(/export function runStage2cSkeleton\(opts: Stage2cRunnerOpts\)/)
    const match = full.match(/export interface Stage2cRunnerOpts \{[\s\S]*?\n\}/)
    expect(match).not.toBeNull()
    expect(match![0]).not.toContain('_runtimeBaseForTesting')
    expect(match![0]).not.toContain('_repoPathForTesting')
    expect(match![0]).not.toContain('_gitInfoForTesting')
  })
})

// ── Task validation — fail closed ─────────────────────────────────────────────

describe('task validation', () => {
  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
  ])('blocks on %s', (_label, task) => {
    const result = _runStage2cSkeletonForTesting(baseOpts({ task }))
    expect(result.outcome).toBe('RUNNER_BLOCKED')
    expect(result.blockerReason).toContain('non-empty')
    expect(result.receipt).toBeNull()
  })
})

// ── Receipt shape — happy path ────────────────────────────────────────────────

describe('receipt shape — happy path', () => {
  it('emits SKELETON_NO_AGENT_EXECUTION with all required fields', () => {
    const result = _runStage2cSkeletonForTesting(baseOpts())
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

  it('agent execution is not attempted', () => {
    const r = _runStage2cSkeletonForTesting(baseOpts()).receipt!
    expect(r.agentExecutionAttempted).toBe(false)
  })

  it('builtin tool use count is zero', () => {
    const r = _runStage2cSkeletonForTesting(baseOpts()).receipt!
    expect(r.builtinToolUseCount).toBe(0)
  })

  it('managed agent transport is not_wired', () => {
    const r = _runStage2cSkeletonForTesting(baseOpts()).receipt!
    expect(r.managedAgentTransport).toBe('not_wired')
  })

  it('run id is a non-empty UUID-shaped string', () => {
    const r = _runStage2cSkeletonForTesting(baseOpts()).receipt!
    expect(r.runId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('timestamp is a parseable ISO 8601 string', () => {
    const r = _runStage2cSkeletonForTesting(baseOpts()).receipt!
    expect(() => new Date(r.timestamp)).not.toThrow()
    expect(isNaN(new Date(r.timestamp).getTime())).toBe(false)
  })

  it('gitBranch and gitCommitSha come from injected git info', () => {
    const r = _runStage2cSkeletonForTesting(baseOpts()).receipt!
    expect(r.gitBranch).toBe(FAKE_GIT.branch)
    expect(r.gitCommitSha).toBe(FAKE_GIT.commitSha)
  })

  it('gitBranch and gitCommitSha are null when git info is unavailable', () => {
    const r = _runStage2cSkeletonForTesting(
      baseOpts({ _gitInfoForTesting: { branch: null, commitSha: null } }),
    ).receipt!
    expect(r.gitBranch).toBeNull()
    expect(r.gitCommitSha).toBeNull()
  })

  it('task is trimmed before recording', () => {
    const r = _runStage2cSkeletonForTesting(
      baseOpts({ task: '  fix the bug  ' }),
    ).receipt!
    expect(r.task).toBe('fix the bug')
  })
})

// ── Run directory and workspace ───────────────────────────────────────────────

describe('run directory and workspace', () => {
  it('creates a unique run directory under the runtime base', () => {
    const r = _runStage2cSkeletonForTesting(baseOpts()).receipt!
    expect(r.runDir.startsWith(tmpBase)).toBe(true)
    expect(fs.existsSync(r.runDir)).toBe(true)
  })

  it('creates the workspace subdirectory inside the run dir', () => {
    const r = _runStage2cSkeletonForTesting(baseOpts()).receipt!
    expect(r.workspacePath.startsWith(r.runDir)).toBe(true)
    expect(fs.existsSync(r.workspacePath)).toBe(true)
  })

  it('writes the receipt JSON file into the run directory', () => {
    const r = _runStage2cSkeletonForTesting(baseOpts()).receipt!
    const receiptFile = path.join(r.runDir, 'stage2c-receipt.json')
    expect(fs.existsSync(receiptFile)).toBe(true)
    const persisted = JSON.parse(fs.readFileSync(receiptFile, 'utf-8')) as Stage2cSkeletonReceipt
    expect(persisted.runId).toBe(r.runId)
    expect(persisted.terminalOutcome).toBe('SKELETON_NO_AGENT_EXECUTION')
  })

  it('two runs produce distinct run directories', () => {
    const r1 = _runStage2cSkeletonForTesting(baseOpts()).receipt!
    const r2 = _runStage2cSkeletonForTesting(baseOpts()).receipt!
    expect(r1.runDir).not.toBe(r2.runDir)
    expect(r1.runId).not.toBe(r2.runId)
  })
})

// ── Repo manifest capture ─────────────────────────────────────────────────────

describe('repo manifest capture', () => {
  it('captures a non-null hash when the repo path has files', () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const r = _runStage2cSkeletonForTesting(baseOpts()).receipt as Stage2cSkeletonReceipt
    expect(r.repoManifestHash).not.toBeNull()
    expect(typeof r.repoManifestHash).toBe('string')
  })

  it('returns EMPTY hash when the repo dir is empty', () => {
    const r = _runStage2cSkeletonForTesting(baseOpts()).receipt as Stage2cSkeletonReceipt
    expect(r.repoManifestHash).toBe('EMPTY')
  })

  it('reports null hash honestly when repo path does not exist', () => {
    const nonExistentRepo = path.join(os.tmpdir(), 'no-such-dir-stage2c-' + Date.now())
    // computeDirectoryManifestHash returns 'EMPTY' for non-existent dir,
    // so repoManifestHash is 'EMPTY' (not null) — still honest, not fabricated
    const r = _runStage2cSkeletonForTesting(
      baseOpts({ _repoPathForTesting: nonExistentRepo }),
    ).receipt as Stage2cSkeletonReceipt
    // 'EMPTY' or null are both honest; neither is a fabricated hash
    expect(r.repoManifestHash === null || r.repoManifestHash === 'EMPTY').toBe(true)
  })

  it('does not fabricate a hash value', () => {
    const r = _runStage2cSkeletonForTesting(baseOpts()).receipt as Stage2cSkeletonReceipt
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
  it('emits FAKE_AGENT_WORKSPACE_MUTATION_RECORDED with all required fields', () => {
    const result = _runStage2cSkeletonForTesting(fakeAgentOpts())
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

  it('agentExecutionAttempted is true', () => {
    const r = _runStage2cSkeletonForTesting(fakeAgentOpts()).receipt as Stage2cFakeAgentReceipt
    expect(r.agentExecutionAttempted).toBe(true)
  })

  it('builtinToolUseCount is zero', () => {
    const r = _runStage2cSkeletonForTesting(fakeAgentOpts()).receipt as Stage2cFakeAgentReceipt
    expect(r.builtinToolUseCount).toBe(0)
  })

  it('managedAgentTransport is deterministic_fake_agent', () => {
    const r = _runStage2cSkeletonForTesting(fakeAgentOpts()).receipt as Stage2cFakeAgentReceipt
    expect(r.managedAgentTransport).toBe('deterministic_fake_agent')
  })

  it('task is trimmed in receipt', () => {
    const r = _runStage2cSkeletonForTesting(
      fakeAgentOpts({ task: '  fix the bug  ' }),
    ).receipt as Stage2cFakeAgentReceipt
    expect(r.task).toBe('fix the bug')
  })

  it('writes the receipt JSON to the run directory', () => {
    const r = _runStage2cSkeletonForTesting(fakeAgentOpts()).receipt as Stage2cFakeAgentReceipt
    const receiptFile = path.join(r.runDir, 'stage2c-receipt.json')
    expect(fs.existsSync(receiptFile)).toBe(true)
    const persisted = JSON.parse(fs.readFileSync(receiptFile, 'utf-8')) as Stage2cFakeAgentReceipt
    expect(persisted.runId).toBe(r.runId)
    expect(persisted.terminalOutcome).toBe('FAKE_AGENT_WORKSPACE_MUTATION_RECORDED')
  })
})

// ── Step 2: tool events ───────────────────────────────────────────────────────

describe('fake-agent tool events', () => {
  it('records at least one structured tool event', () => {
    const r = _runStage2cSkeletonForTesting(fakeAgentOpts()).receipt as Stage2cFakeAgentReceipt
    expect(r.toolEvents.length).toBeGreaterThanOrEqual(1)
  })

  it('tool event has correct shape', () => {
    const r = _runStage2cSkeletonForTesting(fakeAgentOpts()).receipt as Stage2cFakeAgentReceipt
    const ev = r.toolEvents[0] as FakeAgentToolEvent
    expect(ev.tool).toBe('WRITE_FILE')
    expect(typeof ev.targetPath).toBe('string')
    expect(ev.targetPath.length).toBeGreaterThan(0)
    expect(typeof ev.allowed).toBe('boolean')
    expect(typeof ev.bytesWritten).toBe('number')
    expect(typeof ev.timestamp).toBe('string')
  })

  it('tool event allowed is true for workspace write', () => {
    const r = _runStage2cSkeletonForTesting(fakeAgentOpts()).receipt as Stage2cFakeAgentReceipt
    expect(r.toolEvents[0]!.allowed).toBe(true)
  })

  it('tool event bytesWritten is positive', () => {
    const r = _runStage2cSkeletonForTesting(fakeAgentOpts()).receipt as Stage2cFakeAgentReceipt
    expect(r.toolEvents[0]!.bytesWritten).toBeGreaterThan(0)
  })

  it('tool event timestamp is parseable ISO 8601', () => {
    const r = _runStage2cSkeletonForTesting(fakeAgentOpts()).receipt as Stage2cFakeAgentReceipt
    expect(isNaN(new Date(r.toolEvents[0]!.timestamp).getTime())).toBe(false)
  })
})

// ── Step 2: workspace mutation ────────────────────────────────────────────────

describe('fake-agent workspace mutation', () => {
  it('writes STAGE2C_FAKE_AGENT_OUTPUT.md inside workspace', () => {
    const r = _runStage2cSkeletonForTesting(fakeAgentOpts()).receipt as Stage2cFakeAgentReceipt
    const outputFile = path.join(r.workspacePath, 'STAGE2C_FAKE_AGENT_OUTPUT.md')
    expect(fs.existsSync(outputFile)).toBe(true)
  })

  it('file content includes task text', () => {
    const r = _runStage2cSkeletonForTesting(fakeAgentOpts()).receipt as Stage2cFakeAgentReceipt
    const content = fs.readFileSync(path.join(r.workspacePath, 'STAGE2C_FAKE_AGENT_OUTPUT.md'), 'utf-8')
    expect(content).toContain(VALID_TASK)
  })

  it('file content includes fake-agent marker', () => {
    const r = _runStage2cSkeletonForTesting(fakeAgentOpts()).receipt as Stage2cFakeAgentReceipt
    const content = fs.readFileSync(path.join(r.workspacePath, 'STAGE2C_FAKE_AGENT_OUTPUT.md'), 'utf-8')
    expect(content).toContain('DETERMINISTIC_FAKE_AGENT_EXECUTION')
  })

  it('workspaceManifestHashBefore is EMPTY (workspace was empty before agent ran)', () => {
    const r = _runStage2cSkeletonForTesting(fakeAgentOpts()).receipt as Stage2cFakeAgentReceipt
    expect(r.workspaceManifestHashBefore).toBe('EMPTY')
  })

  it('workspaceManifestHashAfter is a real SHA-256 hex', () => {
    const r = _runStage2cSkeletonForTesting(fakeAgentOpts()).receipt as Stage2cFakeAgentReceipt
    expect(/^[a-f0-9]{64}$/.test(r.workspaceManifestHashAfter)).toBe(true)
  })

  it('before and after workspace hashes differ (mutation was recorded)', () => {
    const r = _runStage2cSkeletonForTesting(fakeAgentOpts()).receipt as Stage2cFakeAgentReceipt
    expect(r.workspaceManifestHashBefore).not.toBe(r.workspaceManifestHashAfter)
  })
})

// ── Step 2: real repo immutability ───────────────────────────────────────────

describe('fake-agent real repo immutability', () => {
  it('repo manifest is immutable or unavailable (never fabricated)', () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const r = _runStage2cSkeletonForTesting(fakeAgentOpts()).receipt as Stage2cFakeAgentReceipt
    expect(r.repoManifestImmutable === true || r.repoManifestImmutable === 'unavailable').toBe(true)
  })

  it('repoManifestImmutable is true when repo path has files', () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const r = _runStage2cSkeletonForTesting(fakeAgentOpts()).receipt as Stage2cFakeAgentReceipt
    expect(r.repoManifestImmutable).toBe(true)
  })

  it('repoManifestHashBefore equals repoManifestHashAfter when repo is unmodified', () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const r = _runStage2cSkeletonForTesting(fakeAgentOpts()).receipt as Stage2cFakeAgentReceipt
    expect(r.repoManifestHashBefore).toBe(r.repoManifestHashAfter)
  })
})

// ── Step 3: denied receipt shape ─────────────────────────────────────────────

describe('fake-agent denied receipt shape', () => {
  it('denied outside-workspace write emits a receipt, not null', () => {
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const result = _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    )
    expect(result.outcome).toBe('FAKE_AGENT_TOOL_DENIED_OUTSIDE_WORKSPACE')
    expect(result.receipt).not.toBeNull()
    expect(result.blockerReason).toBe('')
  })

  it('denied receipt has correct terminal outcome and agent fields', () => {
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const r = _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    ).receipt as Stage2cFakeAgentDeniedReceipt
    expect(r.terminalOutcome).toBe('FAKE_AGENT_TOOL_DENIED_OUTSIDE_WORKSPACE')
    expect(r.agentExecutionAttempted).toBe(true)
    expect(r.managedAgentTransport).toBe('deterministic_fake_agent')
    expect(r.schemaVersion).toBe(1)
    expect(r.stage).toBe('stage2c')
    expect(r.step).toBe(2)
  })

  it('denied receipt builtinToolUseCount is zero', () => {
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const r = _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    ).receipt as Stage2cFakeAgentDeniedReceipt
    expect(r.builtinToolUseCount).toBe(0)
  })

  it('denied receipt is written to the run directory', () => {
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const r = _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    ).receipt as Stage2cFakeAgentDeniedReceipt
    const receiptFile = path.join(r.runDir, 'stage2c-receipt.json')
    expect(fs.existsSync(receiptFile)).toBe(true)
    const persisted = JSON.parse(fs.readFileSync(receiptFile, 'utf-8')) as Stage2cFakeAgentDeniedReceipt
    expect(persisted.terminalOutcome).toBe('FAKE_AGENT_TOOL_DENIED_OUTSIDE_WORKSPACE')
  })
})

// ── Step 3: denied tool event ─────────────────────────────────────────────────

describe('fake-agent denied tool event', () => {
  it('denied tool event has allowed: false', () => {
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const r = _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    ).receipt as Stage2cFakeAgentDeniedReceipt
    const ev = r.toolEvents[0] as FakeAgentToolEvent
    expect(ev.allowed).toBe(false)
  })

  it('denied tool event has a non-empty denialReason', () => {
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const r = _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    ).receipt as Stage2cFakeAgentDeniedReceipt
    const ev = r.toolEvents[0] as FakeAgentToolEvent
    expect(typeof ev.denialReason).toBe('string')
    expect(ev.denialReason!.length).toBeGreaterThan(0)
  })

  it('denied tool event denialReason is TARGET_OUTSIDE_WORKSPACE', () => {
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const r = _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    ).receipt as Stage2cFakeAgentDeniedReceipt
    expect(r.toolEvents[0]!.denialReason).toBe('TARGET_OUTSIDE_WORKSPACE')
  })

  it('denied tool event bytesWritten is zero', () => {
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const r = _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    ).receipt as Stage2cFakeAgentDeniedReceipt
    expect(r.toolEvents[0]!.bytesWritten).toBe(0)
  })

  it('denied tool event tool is WRITE_FILE', () => {
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const r = _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    ).receipt as Stage2cFakeAgentDeniedReceipt
    expect(r.toolEvents[0]!.tool).toBe('WRITE_FILE')
  })
})

// ── Step 3: boundary hardening ────────────────────────────────────────────────

describe('fake-agent boundary hardening', () => {
  it('denied write creates no outside file', () => {
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    )
    expect(fs.existsSync(outsidePath)).toBe(false)
  })

  it('blocks path-traversal write (../.. escape)', () => {
    // path.resolve normalizes '..' before path.relative sees it,
    // so '/workspace/../outside' → '/outside' which is outside workspace.
    const traversalPath = path.join(tmpBase, '..', 'traversal-escape.txt')
    const result = _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: traversalPath }),
    )
    expect(result.outcome).toBe('FAKE_AGENT_TOOL_DENIED_OUTSIDE_WORKSPACE')
    expect(result.receipt).not.toBeNull()
    expect(fs.existsSync(path.resolve(traversalPath))).toBe(false)
  })

  it('blocks same-prefix sibling path (workspace-evil attack)', () => {
    // '/tmp/workspaceXXX-evil/foo' is a sibling, not a child.
    // path.relative('/tmp/workspaceXXX', '/tmp/workspaceXXX-evil/foo') = '../workspaceXXX-evil/foo'
    // which starts with '..' — caught by the boundary check.
    const siblingDir = tmpBase + '-evil'
    const siblingPath = path.join(siblingDir, 'attack.txt')
    const result = _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: siblingPath }),
    )
    expect(result.outcome).toBe('FAKE_AGENT_TOOL_DENIED_OUTSIDE_WORKSPACE')
    expect(result.receipt).not.toBeNull()
    expect(fs.existsSync(siblingPath)).toBe(false)
  })

  it('allowed write still succeeds after hardening', () => {
    const result = _runStage2cSkeletonForTesting(fakeAgentOpts())
    expect(result.outcome).toBe('FAKE_AGENT_WORKSPACE_MUTATION_RECORDED')
    expect(result.receipt).not.toBeNull()
  })

  it('allowed tool event has no denialReason', () => {
    const r = _runStage2cSkeletonForTesting(fakeAgentOpts()).receipt as Stage2cFakeAgentReceipt
    expect(r.toolEvents[0]!.denialReason).toBeUndefined()
  })
})

// ── Step 3: repo immutability in denied path ──────────────────────────────────

describe('fake-agent denied path repo immutability', () => {
  it('repoManifestImmutable is true when repo has files and denied write cannot mutate it', () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const r = _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    ).receipt as Stage2cFakeAgentDeniedReceipt
    expect(r.repoManifestImmutable === true || r.repoManifestImmutable === 'unavailable').toBe(true)
  })

  it('repoManifestHashBefore equals repoManifestHashAfter in denied path', () => {
    fs.writeFileSync(path.join(tmpRepo, 'example.ts'), 'export const x = 1\n')
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const r = _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    ).receipt as Stage2cFakeAgentDeniedReceipt
    expect(r.repoManifestHashBefore).toBe(r.repoManifestHashAfter)
  })
})

// ── Step 3: builtinToolUseCount zero in both paths ────────────────────────────

describe('builtinToolUseCount invariant', () => {
  it.each([
    ['allowed fake-agent write', fakeAgentOpts()],
  ] as Array<[string, Stage2cRunnerInternalOpts]>)('is zero for %s', (_label, opts) => {
    const r = _runStage2cSkeletonForTesting(opts).receipt as Stage2cFakeAgentReceipt
    expect(r.builtinToolUseCount).toBe(0)
  })

  it('is zero for denied fake-agent write', () => {
    const outsidePath = path.join(os.tmpdir(), `evil-${Date.now()}.txt`)
    const r = _runStage2cSkeletonForTesting(
      fakeAgentOpts({ _fakeAgentTargetPathForTesting: outsidePath }),
    ).receipt as Stage2cFakeAgentDeniedReceipt
    expect(r.builtinToolUseCount).toBe(0)
  })
})

// ── Step 2: dry-run bypass ────────────────────────────────────────────────────

describe('fake-agent dry-run bypass', () => {
  it('fakeAgent + dryRun still emits SKELETON_NO_AGENT_EXECUTION', () => {
    const result = _runStage2cSkeletonForTesting(
      fakeAgentOpts({ dryRun: true }),
    )
    expect(result.outcome).toBe('SKELETON_NO_AGENT_EXECUTION')
    const r = result.receipt as Stage2cSkeletonReceipt
    expect(r.agentExecutionAttempted).toBe(false)
    expect(r.managedAgentTransport).toBe('not_wired')
    expect(r.terminalOutcome).toBe('SKELETON_NO_AGENT_EXECUTION')
  })

  it('fakeAgent + dryRun does not write STAGE2C_FAKE_AGENT_OUTPUT.md', () => {
    const result = _runStage2cSkeletonForTesting(fakeAgentOpts({ dryRun: true }))
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
  ])('blocks on %s even with fakeAgent: true', (_label, task) => {
    const result = _runStage2cSkeletonForTesting(fakeAgentOpts({ task }))
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

  it('allows write to non-existing file directly inside workspace', () => {
    const target = path.join(wsDir, 'output.txt')
    const result = _checkWriteTargetBoundaryForTesting(target, wsDir)
    expect(result.allowed).toBe(true)
  })

  it('allows write to non-existing file in a non-existing nested subdirectory', () => {
    const target = path.join(wsDir, 'nested', 'deep', 'output.txt')
    const result = _checkWriteTargetBoundaryForTesting(target, wsDir)
    expect(result.allowed).toBe(true)
  })

  it('allows overwrite of an existing regular file inside workspace', () => {
    const target = path.join(wsDir, 'existing.txt')
    fs.writeFileSync(target, 'initial content')
    const result = _checkWriteTargetBoundaryForTesting(target, wsDir)
    expect(result.allowed).toBe(true)
  })

  it('allows write into an existing subdirectory inside workspace', () => {
    const subdir = path.join(wsDir, 'subdir')
    fs.mkdirSync(subdir)
    const target = path.join(subdir, 'output.txt')
    const result = _checkWriteTargetBoundaryForTesting(target, wsDir)
    expect(result.allowed).toBe(true)
  })

  // ── Symlink escape cases — denied by test ────────────────────────────────────

  it('denies symlink directory inside workspace pointing outside', () => {
    // wsDir/evil_link -> outsideDir
    const symlinkDir = path.join(wsDir, 'evil_link')
    fs.symlinkSync(outsideDir, symlinkDir)

    const target = path.join(symlinkDir, 'output.txt')
    const result = _checkWriteTargetBoundaryForTesting(target, wsDir)
    expect(result.allowed).toBe(false)
    expect(result.denialReason).toBe('TARGET_SYMLINK_ESCAPE')
  })

  it('denies symlink file target inside workspace pointing outside', () => {
    // wsDir/evil_link.txt -> outsideFile
    const symlinkFile = path.join(wsDir, 'evil_link.txt')
    fs.symlinkSync(outsideFile, symlinkFile)

    const result = _checkWriteTargetBoundaryForTesting(symlinkFile, wsDir)
    expect(result.allowed).toBe(false)
    expect(result.denialReason).toBe('TARGET_SYMLINK_ESCAPE')
  })

  it('denies nested symlink escape inside a real subdirectory', () => {
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

  it('denies a target whose canonical path escapes via intermediate symlink', () => {
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

  it('denies absolute path outside workspace (no symlinks)', () => {
    const target = path.join(outsideDir, 'output.txt')
    const result = _checkWriteTargetBoundaryForTesting(target, wsDir)
    expect(result.allowed).toBe(false)
    expect(result.denialReason).toBe('TARGET_OUTSIDE_WORKSPACE')
  })

  it('denies same-prefix sibling path', () => {
    const siblingDir = wsDir + '-evil'
    const target = path.join(siblingDir, 'attack.txt')
    const result = _checkWriteTargetBoundaryForTesting(target, wsDir)
    expect(result.allowed).toBe(false)
    expect(result.denialReason).toBe('TARGET_OUTSIDE_WORKSPACE')
  })

  it('denies .. traversal', () => {
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

  it('does not import or call _runStage2cSkeletonForTesting in non-comment code', () => {
    const src = nonCommentLines('src/cli/stage2c-run.ts')
    expect(src).not.toContain('_runStage2cSkeletonForTesting')
  })

  it('imports and calls only the production runStage2cSkeleton entry point', () => {
    const src = nonCommentLines('src/cli/stage2c-run.ts')
    expect(src).toContain('runStage2cSkeleton')
  })

  it('does not import @anthropic-ai/sdk', () => {
    const src = nonCommentLines('src/cli/stage2c-run.ts')
    expect(src).not.toContain('@anthropic-ai/sdk')
  })
})
