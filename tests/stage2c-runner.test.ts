// Stage 2C Step 1 — Skeleton runner tests (no Anthropic API, no live session)
//
// Proves fail-closed behavior and honest receipt discipline for:
//   - Dry-run receipt emission
//   - Agent execution not attempted (agentExecutionAttempted === false)
//   - Builtin tool count is zero (builtinToolUseCount === 0)
//   - Terminal outcome is SKELETON_NO_AGENT_EXECUTION
//   - Real repo manifest captured or honestly null
//   - Invalid/missing task fails closed (RUNNER_BLOCKED)
//   - Static boundary: no @anthropic-ai/sdk import, no promoteSkill call

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const { _runStage2cSkeletonForTesting } =
  await import('../scripts/stage2c-runner.js')

import type {
  Stage2cRunnerInternalOpts,
  Stage2cSkeletonReceipt,
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
    const r = _runStage2cSkeletonForTesting(baseOpts()).receipt!
    expect(r.repoManifestHash).not.toBeNull()
    expect(typeof r.repoManifestHash).toBe('string')
  })

  it('returns EMPTY hash when the repo dir is empty', () => {
    const r = _runStage2cSkeletonForTesting(baseOpts()).receipt!
    expect(r.repoManifestHash).toBe('EMPTY')
  })

  it('reports null hash honestly when repo path does not exist', () => {
    const nonExistentRepo = path.join(os.tmpdir(), 'no-such-dir-stage2c-' + Date.now())
    // computeDirectoryManifestHash returns 'EMPTY' for non-existent dir,
    // so repoManifestHash is 'EMPTY' (not null) — still honest, not fabricated
    const r = _runStage2cSkeletonForTesting(
      baseOpts({ _repoPathForTesting: nonExistentRepo }),
    ).receipt!
    // 'EMPTY' or null are both honest; neither is a fabricated hash
    expect(r.repoManifestHash === null || r.repoManifestHash === 'EMPTY').toBe(true)
  })

  it('does not fabricate a hash value', () => {
    const r = _runStage2cSkeletonForTesting(baseOpts()).receipt!
    // any non-null value must look like a real SHA-256 hex or the sentinel 'EMPTY'
    if (r.repoManifestHash !== null) {
      const isValidSha256 = /^[a-f0-9]{64}$/.test(r.repoManifestHash)
      const isEmpty = r.repoManifestHash === 'EMPTY'
      expect(isValidSha256 || isEmpty).toBe(true)
    }
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
