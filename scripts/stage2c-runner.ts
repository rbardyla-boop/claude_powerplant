// Stage 2C Step 1 — L1 Managed-Agent Harness Skeleton Runner
//
// Authorization: Stage 2C Step 1 — Initialization and Evidence Spine Only
//   No agent is invoked. No Anthropic API transport is wired.
//
// FORBIDDEN by this authorization:
//   - Calling the Anthropic Managed Agent API
//   - Creating a live session
//   - Using ANTHROPIC_API_KEY for execution
//   - Mounting the real project source (clearedForRealProjectMounting: false)

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { STAGE2C_RUNTIME_BASE } from '../src/config/constants.js'
import { computeDirectoryManifestHash } from '../src/projects/compute-repo-manifest.js'

// ── Receipt ───────────────────────────────────────────────────────────────────

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

// ── Result ────────────────────────────────────────────────────────────────────

export type Stage2cRunnerOutcome =
  | 'SKELETON_NO_AGENT_EXECUTION'
  | 'RUNNER_BLOCKED'

export interface Stage2cRunnerResult {
  outcome: Stage2cRunnerOutcome
  blockerReason: string
  receipt: Stage2cSkeletonReceipt | null
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface Stage2cRunnerOpts {
  task: string
  dryRun: boolean
}

// ── Internal interface — injectable seams for deterministic testing only ──────

export interface Stage2cRunnerInternalOpts extends Stage2cRunnerOpts {
  _runtimeBaseForTesting?: string
  _repoPathForTesting?: string
  _gitInfoForTesting?: { branch: string | null; commitSha: string | null }
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
  const { task, dryRun } = opts
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

  // ── 4. Capture pre-run repo manifest ─────────────────────────────────────
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
