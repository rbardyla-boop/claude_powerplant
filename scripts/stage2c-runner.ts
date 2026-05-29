// Stage 2C — L1 Managed-Agent Harness Runner
//
// Authorization: Step 1 — Initialization and Evidence Spine Only (skeleton)
//               Step 2 — Deterministic Fake-Agent Adapter (fakeAgent mode)
//               Step 3 — Denied Tool Evidence Receipts and Boundary Hardening
//   No real agent is invoked. No Anthropic API transport is wired.
//
// FORBIDDEN by this authorization:
//   - Calling the Anthropic Managed Agent API
//   - Creating a live session
//   - Using ANTHROPIC_API_KEY for execution
//   - Mounting the real project source (clearedForRealProjectMounting: false)
//   - Writing outside the sanitized candidate workspace

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { STAGE2C_RUNTIME_BASE } from '../src/config/constants.js'
import { computeDirectoryManifestHash } from '../src/projects/compute-repo-manifest.js'

// ── Fake-Agent Tool Event (Step 2/3) ─────────────────────────────────────────

export interface FakeAgentToolEvent {
  tool: 'WRITE_FILE'
  targetPath: string
  allowed: boolean
  denialReason?: string   // present only when allowed === false
  bytesWritten: number
  timestamp: string
}

// ── Step 1 Receipt ────────────────────────────────────────────────────────────

export interface Stage2cSkeletonReceipt {
  schemaVersion: 1
  stage: 'stage2c'
  step: 1
  runId: string
  timestamp: string
  gitBranch: string | null
  gitCommitSha: string | null
  task: string
  dryRun: boolean
  runDir: string
  workspacePath: string
  repoManifestHash: string | null
  agentExecutionAttempted: false
  managedAgentTransport: 'not_wired'
  builtinToolUseCount: 0
  terminalOutcome: 'SKELETON_NO_AGENT_EXECUTION'
}

// ── Step 2 Receipt ────────────────────────────────────────────────────────────

export interface Stage2cFakeAgentReceipt {
  schemaVersion: 1
  stage: 'stage2c'
  step: 2
  runId: string
  timestamp: string
  gitBranch: string | null
  gitCommitSha: string | null
  task: string
  dryRun: false
  runDir: string
  workspacePath: string
  agentExecutionAttempted: true
  managedAgentTransport: 'deterministic_fake_agent'
  builtinToolUseCount: 0
  toolEvents: FakeAgentToolEvent[]
  workspaceManifestHashBefore: string
  workspaceManifestHashAfter: string
  repoManifestHashBefore: string | null
  repoManifestHashAfter: string | null
  repoManifestImmutable: boolean | 'unavailable'
  terminalOutcome: 'FAKE_AGENT_WORKSPACE_MUTATION_RECORDED'
}

// ── Step 3 Receipt — denied fake-agent tool attempt ───────────────────────────

export interface Stage2cFakeAgentDeniedReceipt {
  schemaVersion: 1
  stage: 'stage2c'
  step: 2
  runId: string
  timestamp: string
  gitBranch: string | null
  gitCommitSha: string | null
  task: string
  dryRun: false
  runDir: string
  workspacePath: string
  agentExecutionAttempted: true
  managedAgentTransport: 'deterministic_fake_agent'
  builtinToolUseCount: 0
  toolEvents: FakeAgentToolEvent[]
  repoManifestHashBefore: string | null
  repoManifestHashAfter: string | null
  repoManifestImmutable: boolean | 'unavailable'
  terminalOutcome: 'FAKE_AGENT_TOOL_DENIED_OUTSIDE_WORKSPACE'
}

// ── Result ────────────────────────────────────────────────────────────────────

export type Stage2cRunnerOutcome =
  | 'SKELETON_NO_AGENT_EXECUTION'
  | 'FAKE_AGENT_WORKSPACE_MUTATION_RECORDED'
  | 'FAKE_AGENT_TOOL_DENIED_OUTSIDE_WORKSPACE'
  | 'RUNNER_BLOCKED'

export interface Stage2cRunnerResult {
  outcome: Stage2cRunnerOutcome
  blockerReason: string
  receipt: Stage2cSkeletonReceipt | Stage2cFakeAgentReceipt | Stage2cFakeAgentDeniedReceipt | null
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface Stage2cRunnerOpts {
  task: string
  dryRun: boolean
  fakeAgent?: boolean
}

// ── Internal interface — injectable seams for deterministic testing only ──────

export interface Stage2cRunnerInternalOpts extends Stage2cRunnerOpts {
  _runtimeBaseForTesting?: string
  _repoPathForTesting?: string
  _gitInfoForTesting?: { branch: string | null; commitSha: string | null }
  _fakeAgentTargetPathForTesting?: string
}

// ── Fake-agent workspace boundary check (Step 3) ─────────────────────────────
//
// Uses path.relative() so that same-prefix siblings (/workspace-evil), absolute
// outside paths, and '..' traversal are all caught uniformly.
//
// KNOWN LIMITATION: path.resolve() normalizes '..' segments but does NOT follow
// symlinks. A symlink inside the workspace that points outside is not caught here.
// Real transport must additionally call fs.realpathSync() on both paths.

function checkWorkspaceBoundary(
  targetPath: string,
  workspacePath: string,
): { allowed: boolean; denialReason?: string } {
  const resolvedTarget = path.resolve(targetPath)
  const resolvedWorkspace = path.resolve(workspacePath)

  const rel = path.relative(resolvedWorkspace, resolvedTarget)

  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return { allowed: false, denialReason: 'TARGET_OUTSIDE_WORKSPACE' }
  }

  return { allowed: true }
}

// ── Fake-agent execution (Step 2/3) — typed tool interface ───────────────────

function executeFakeAgent(params: {
  task: string
  workspacePath: string
  targetPath: string
  timestamp: string
}): { event: FakeAgentToolEvent; blocked: boolean } {
  const { task, workspacePath, targetPath, timestamp } = params

  const { allowed, denialReason } = checkWorkspaceBoundary(targetPath, workspacePath)

  if (!allowed) {
    return {
      event: { tool: 'WRITE_FILE', targetPath, allowed: false, denialReason, bytesWritten: 0, timestamp },
      blocked: true,
    }
  }

  const content = [
    '# STAGE2C Fake Agent Output',
    '',
    `**Task:** ${task}`,
    '',
    '**Marker:** DETERMINISTIC_FAKE_AGENT_EXECUTION',
    '',
    'This file was written by the Stage 2C deterministic fake-agent adapter.',
    'No real agent was invoked. No Anthropic API transport was used.',
    'builtinToolUseCount: 0',
  ].join('\n') + '\n'

  const encoded = Buffer.from(content, 'utf-8')
  fs.writeFileSync(targetPath, encoded)

  return {
    event: { tool: 'WRITE_FILE', targetPath, allowed: true, bytesWritten: encoded.length, timestamp },
    blocked: false,
  }
}

// ── Git info capture ──────────────────────────────────────────────────────────

function captureGitInfo(): { branch: string | null; commitSha: string | null } {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    const commitSha = execSync('git rev-parse HEAD', {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    return { branch: branch || null, commitSha: commitSha || null }
  } catch {
    return { branch: null, commitSha: null }
  }
}

// ── Production entry point — no injectable seams ─────────────────────────────

export function runStage2cSkeleton(opts: Stage2cRunnerOpts): Stage2cRunnerResult {
  return _runStage2cSkeletonInternal(opts)
}

// ── Test-only entry point — injectable seams for deterministic tests ──────────

export function _runStage2cSkeletonForTesting(opts: Stage2cRunnerInternalOpts): Stage2cRunnerResult {
  return _runStage2cSkeletonInternal(opts)
}

// ── Core implementation ───────────────────────────────────────────────────────

function _runStage2cSkeletonInternal(opts: Stage2cRunnerInternalOpts): Stage2cRunnerResult {
  const { task, dryRun, fakeAgent } = opts
  const runtimeBase = opts._runtimeBaseForTesting ?? STAGE2C_RUNTIME_BASE
  const repoPath = opts._repoPathForTesting ?? process.cwd()
  const gitInfo = opts._gitInfoForTesting ?? captureGitInfo()

  // ── 1. Validate task — fail closed ────────────────────────────────────────
  if (!task || !task.trim()) {
    return {
      outcome: 'RUNNER_BLOCKED',
      blockerReason: 'task must be a non-empty string',
      receipt: null,
    }
  }

  // ── 2. Create unique run directory ────────────────────────────────────────
  const runId = crypto.randomUUID()
  const timestamp = new Date().toISOString()

  let runDir: string
  try {
    fs.mkdirSync(runtimeBase, { recursive: true })
    runDir = path.join(runtimeBase, `run-${Date.now()}-${runId.slice(0, 8)}`)
    fs.mkdirSync(runDir, { recursive: true })
  } catch (err) {
    return {
      outcome: 'RUNNER_BLOCKED',
      blockerReason: `Failed to create run directory: ${err instanceof Error ? err.message : String(err)}`,
      receipt: null,
    }
  }

  // ── 3. Prepare workspace path (unpopulated in Step 1) ─────────────────────
  const workspacePath = path.join(runDir, 'workspace')
  try {
    fs.mkdirSync(workspacePath, { recursive: true })
  } catch (err) {
    return {
      outcome: 'RUNNER_BLOCKED',
      blockerReason: `Failed to create workspace directory: ${err instanceof Error ? err.message : String(err)}`,
      receipt: null,
    }
  }

  // ── 4. Step 2/3: fake-agent execution path ───────────────────────────────
  if (fakeAgent && !dryRun) {
    let workspaceManifestHashBefore: string
    try { workspaceManifestHashBefore = computeDirectoryManifestHash(workspacePath) } catch { workspaceManifestHashBefore = 'EMPTY' }

    let repoManifestHashBefore: string | null
    try { repoManifestHashBefore = computeDirectoryManifestHash(repoPath) } catch { repoManifestHashBefore = null }

    const targetPath = opts._fakeAgentTargetPathForTesting
      ?? path.join(workspacePath, 'STAGE2C_FAKE_AGENT_OUTPUT.md')

    const { event, blocked } = executeFakeAgent({
      task: task.trim(),
      workspacePath,
      targetPath,
      timestamp,
    })

    // Capture repo manifest after agent attempt (covers both allowed and denied paths).
    let repoManifestHashAfter: string | null
    try { repoManifestHashAfter = computeDirectoryManifestHash(repoPath) } catch { repoManifestHashAfter = null }

    const repoManifestImmutable: boolean | 'unavailable' =
      (repoManifestHashBefore !== null && repoManifestHashAfter !== null)
        ? repoManifestHashBefore === repoManifestHashAfter
        : 'unavailable'

    // ── Step 3: emit a receipt on denial — do not return null ────────────────
    if (blocked) {
      const deniedReceipt: Stage2cFakeAgentDeniedReceipt = {
        schemaVersion: 1,
        stage: 'stage2c',
        step: 2,
        runId,
        timestamp,
        gitBranch: gitInfo.branch,
        gitCommitSha: gitInfo.commitSha,
        task: task.trim(),
        dryRun: false,
        runDir,
        workspacePath,
        agentExecutionAttempted: true,
        managedAgentTransport: 'deterministic_fake_agent',
        builtinToolUseCount: 0,
        toolEvents: [event],
        repoManifestHashBefore,
        repoManifestHashAfter,
        repoManifestImmutable,
        terminalOutcome: 'FAKE_AGENT_TOOL_DENIED_OUTSIDE_WORKSPACE',
      }

      try {
        fs.writeFileSync(
          path.join(runDir, 'stage2c-receipt.json'),
          JSON.stringify(deniedReceipt, null, 2) + '\n',
          'utf-8',
        )
      } catch (err) {
        return {
          outcome: 'RUNNER_BLOCKED',
          blockerReason: `Failed to write denied receipt: ${err instanceof Error ? err.message : String(err)}`,
          receipt: null,
        }
      }

      return {
        outcome: 'FAKE_AGENT_TOOL_DENIED_OUTSIDE_WORKSPACE',
        blockerReason: '',
        receipt: deniedReceipt,
      }
    }

    // ── Allowed path: workspace write succeeded ───────────────────────────────
    let workspaceManifestHashAfter: string
    try { workspaceManifestHashAfter = computeDirectoryManifestHash(workspacePath) } catch { workspaceManifestHashAfter = 'EMPTY' }

    const fakeAgentReceipt: Stage2cFakeAgentReceipt = {
      schemaVersion: 1,
      stage: 'stage2c',
      step: 2,
      runId,
      timestamp,
      gitBranch: gitInfo.branch,
      gitCommitSha: gitInfo.commitSha,
      task: task.trim(),
      dryRun: false,
      runDir,
      workspacePath,
      agentExecutionAttempted: true,
      managedAgentTransport: 'deterministic_fake_agent',
      builtinToolUseCount: 0,
      toolEvents: [event],
      workspaceManifestHashBefore,
      workspaceManifestHashAfter,
      repoManifestHashBefore,
      repoManifestHashAfter,
      repoManifestImmutable,
      terminalOutcome: 'FAKE_AGENT_WORKSPACE_MUTATION_RECORDED',
    }

    try {
      fs.writeFileSync(
        path.join(runDir, 'stage2c-receipt.json'),
        JSON.stringify(fakeAgentReceipt, null, 2) + '\n',
        'utf-8',
      )
    } catch (err) {
      return {
        outcome: 'RUNNER_BLOCKED',
        blockerReason: `Failed to write receipt: ${err instanceof Error ? err.message : String(err)}`,
        receipt: null,
      }
    }

    return {
      outcome: 'FAKE_AGENT_WORKSPACE_MUTATION_RECORDED',
      blockerReason: '',
      receipt: fakeAgentReceipt,
    }
  }

  // ── 4. Step 1: capture pre-run repo manifest ──────────────────────────────
  let repoManifestHash: string | null
  try {
    repoManifestHash = computeDirectoryManifestHash(repoPath)
  } catch {
    repoManifestHash = null
  }

  // ── 5. Emit honest skeleton receipt — no fabricated fields ────────────────
  const receipt: Stage2cSkeletonReceipt = {
    schemaVersion: 1,
    stage: 'stage2c',
    step: 1,
    runId,
    timestamp,
    gitBranch: gitInfo.branch,
    gitCommitSha: gitInfo.commitSha,
    task: task.trim(),
    dryRun,
    runDir,
    workspacePath,
    repoManifestHash,
    agentExecutionAttempted: false,
    managedAgentTransport: 'not_wired',
    builtinToolUseCount: 0,
    terminalOutcome: 'SKELETON_NO_AGENT_EXECUTION',
  }

  // ── 6. Write receipt to run directory ─────────────────────────────────────
  try {
    fs.writeFileSync(
      path.join(runDir, 'stage2c-receipt.json'),
      JSON.stringify(receipt, null, 2) + '\n',
      'utf-8',
    )
  } catch (err) {
    return {
      outcome: 'RUNNER_BLOCKED',
      blockerReason: `Failed to write receipt: ${err instanceof Error ? err.message : String(err)}`,
      receipt: null,
    }
  }

  return {
    outcome: 'SKELETON_NO_AGENT_EXECUTION',
    blockerReason: '',
    receipt,
  }
}
