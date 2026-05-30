// Stage 2C — L1 Managed-Agent Harness Runner
//
// Authorization: Step 1  — Initialization and Evidence Spine Only (skeleton)
//               Step 2  — Deterministic Fake-Agent Adapter (fakeAgent mode)
//               Step 3  — Denied Tool Evidence Receipts and Boundary Hardening
//               Step 4  — Symlink-Safe Canonical Write-Boundary Enforcement
//               Step 5  — Oracle/Capsule Evaluator Attachment (subprocess-node-v1)
//               Step 7  — Real Managed-Agent Transport Gate and Adapter Contract
//                         (gate only; no live execution)
//               Step 8  — Enabled Managed-Agent Adapter Execution (deterministic
//                         internal test adapter only; no live transport)
//               Step 9  — Real Managed-Agent Adapter Shell and Live-Run Gate
//                         (STAGE2C_MANAGED_AGENT_LIVE=1 required; credential check
//                         shell only; live execution still blocked)
//               Step 10 — First Explicitly Gated Bounded Live Managed-Agent Path
//                         (all four gates required; live adapter via lazy SDK import;
//                         oracle suppressed; typed WRITE_FILE boundary only)
//
// FORBIDDEN by this authorization:
//   - Calling the Anthropic Managed Agent API without STAGE2C_MANAGED_AGENT_ENABLED=1
//   - Creating a live session
//   - Using ANTHROPIC_API_KEY for execution
//   - Running live managed-agent execution without STAGE2C_MANAGED_AGENT_LIVE=1
//   - Mounting the real project source (clearedForRealProjectMounting: false)
//   - Writing outside the sanitized candidate workspace

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { STAGE2C_RUNTIME_BASE } from '../src/config/constants.js'
import { computeDirectoryManifestHash } from '../src/projects/compute-repo-manifest.js'
import { createOracleBundle } from '../src/preflight/oracle-bundle.js'
import { runOracleWithFixture } from '../src/preflight/oracle-evaluator.js'
import { checkRealAdapterCredentials, createRealManagedAgentAdapter } from './stage2c-real-adapter.js'

// ── Step 6: oracle-pass fixture content ──────────────────────────────────────
//
// Valid ES module JS that passes all four summarizeChecks-v1 oracle test vectors.
// Written by the fake-agent to src/status.js so evaluateWorkspaceOracle finds it
// at the preferred path and the subprocess oracle returns PASS.
// Includes DETERMINISTIC_FAKE_AGENT_EXECUTION marker for consistency.

const ORACLE_PASS_STATUS_JS = [
  '// DETERMINISTIC_FAKE_AGENT_EXECUTION',
  'export function summarizeChecks(checks) {',
  "  if (!Array.isArray(checks)) throw new TypeError('checks must be an array')",
  '  const total = checks.length',
  "  const passing = checks.filter(c => c.passed).length",
  '  const failing = total - passing',
  "  return { total, passing, failing, status: failing === 0 ? 'healthy' : 'degraded' }",
  '}',
].join('\n') + '\n'

// ── Fake-Agent Tool Event (Step 2/3) ─────────────────────────────────────────

export interface FakeAgentToolEvent {
  tool: 'WRITE_FILE'
  targetPath: string
  allowed: boolean
  denialReason?: string   // present only when allowed === false
  bytesWritten: number
  timestamp: string
}

// ── Oracle Evaluation Result (Step 5) ────────────────────────────────────────

export interface OracleEvaluationResult {
  status: 'PASS' | 'FAIL' | 'ERROR' | 'TIMEOUT' | 'OUTPUT_CAPPED' | 'IMPORT_ERROR'
  exitCode: number | null
  summary: string | null
}

// ── Step 7/8: managed-agent transport adapter interface (internal) ────────────
//
// Step 7: gate blocks before any adapter invocation; seam exists for tests.
// Step 8: deterministic test adapter injected via seam; runner applies its
//         toolActions through the typed WRITE_FILE boundary.

export interface ManagedAgentRequest {
  task: string
  workspacePath: string
  runId: string
}

// Proposed write operation returned by an adapter. The runner validates each
// action against the workspace boundary before applying it — the adapter does
// not write directly to the filesystem.
export interface ManagedAgentToolAction {
  tool: 'WRITE_FILE'
  targetPath: string
  content: string
}

export interface ManagedAgentResult {
  transportName: string
  toolActions?: ManagedAgentToolAction[]
}

export interface ManagedAgentAdapter {
  readonly transportName: string
  run(request: ManagedAgentRequest): Promise<ManagedAgentResult> | ManagedAgentResult
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

// ── Step 5 Receipt — fake-agent + oracle evaluation ───────────────────────────

export interface Stage2cFakeAgentOracleReceipt {
  schemaVersion: 1
  stage: 'stage2c'
  step: 5
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
  oracleEvaluationAttempted: true
  oracleEvaluator: 'subprocess-node-v1'
  oracleTarget: 'sanitized_candidate_workspace'
  oracleResult: OracleEvaluationResult
  terminalOutcome: 'FAKE_AGENT_ORACLE_EVALUATED'
}

// ── Step 7 Receipt — managed-agent transport gate blocked ─────────────────────

export interface Stage2cManagedAgentBlockedReceipt {
  schemaVersion: 1
  stage: 'stage2c'
  step: 7
  runId: string
  timestamp: string
  gitBranch: string | null
  gitCommitSha: string | null
  task: string
  dryRun: false
  runDir: string
  workspacePath: string
  repoManifestHash: string | null
  agentExecutionAttempted: false
  managedAgentTransport: 'blocked_not_enabled'
  builtinToolUseCount: 0
  oracleEvaluationAttempted: false
  terminalOutcome: 'MANAGED_AGENT_BLOCKED_NOT_ENABLED'
}

// ── Step 8 Receipt — env gate active but no adapter injected ──────────────────

export interface Stage2cManagedAgentBlockedNoAdapterReceipt {
  schemaVersion: 1
  stage: 'stage2c'
  step: 8
  runId: string
  timestamp: string
  gitBranch: string | null
  gitCommitSha: string | null
  task: string
  dryRun: false
  runDir: string
  workspacePath: string
  repoManifestHashBefore: string | null
  repoManifestHashAfter: string | null
  repoManifestImmutable: boolean | 'unavailable'
  agentExecutionAttempted: false
  managedAgentTransport: 'blocked_no_adapter'
  builtinToolUseCount: 0
  oracleEvaluationAttempted: false
  terminalOutcome: 'MANAGED_AGENT_BLOCKED_NO_ADAPTER'
}

// ── Step 8 Receipt — deterministic adapter executed successfully ───────────────

export interface Stage2cManagedAgentAdapterReceipt {
  schemaVersion: 1
  stage: 'stage2c'
  step: 8
  runId: string
  timestamp: string
  gitBranch: string | null
  gitCommitSha: string | null
  task: string
  dryRun: false
  runDir: string
  workspacePath: string
  agentExecutionAttempted: true
  managedAgentTransport: string
  builtinToolUseCount: 0
  toolEvents: FakeAgentToolEvent[]
  workspaceManifestHashBefore: string
  workspaceManifestHashAfter: string
  repoManifestHashBefore: string | null
  repoManifestHashAfter: string | null
  repoManifestImmutable: boolean | 'unavailable'
  oracleEvaluationAttempted: false
  terminalOutcome: 'MANAGED_AGENT_ADAPTER_WORKSPACE_MUTATION_RECORDED'
}

// ── Step 8 Receipt — adapter tool action denied outside workspace ──────────────

export interface Stage2cManagedAgentAdapterDeniedReceipt {
  schemaVersion: 1
  stage: 'stage2c'
  step: 8
  runId: string
  timestamp: string
  gitBranch: string | null
  gitCommitSha: string | null
  task: string
  dryRun: false
  runDir: string
  workspacePath: string
  agentExecutionAttempted: true
  managedAgentTransport: string
  builtinToolUseCount: 0
  toolEvents: FakeAgentToolEvent[]
  repoManifestHashBefore: string | null
  repoManifestHashAfter: string | null
  repoManifestImmutable: boolean | 'unavailable'
  oracleEvaluationAttempted: false
  terminalOutcome: 'MANAGED_AGENT_ADAPTER_TOOL_DENIED_OUTSIDE_WORKSPACE'
}

// ── Step 9 Receipt — live gate active but credentials missing ─────────────────

export interface Stage2cManagedAgentMissingCredentialsReceipt {
  schemaVersion: 1
  stage: 'stage2c'
  step: 9
  runId: string
  timestamp: string
  gitBranch: string | null
  gitCommitSha: string | null
  task: string
  dryRun: false
  runDir: string
  workspacePath: string
  repoManifestHashBefore: string | null
  repoManifestHashAfter: string | null
  repoManifestImmutable: boolean | 'unavailable'
  agentExecutionAttempted: false
  managedAgentTransport: 'blocked_missing_credentials'
  builtinToolUseCount: 0
  oracleEvaluationAttempted: false
  terminalOutcome: 'MANAGED_AGENT_BLOCKED_MISSING_CREDENTIALS'
}

// ── Step 10 Receipt — live adapter returned a malformed/unparseable response ──
//
// Emitted when the real managed-agent adapter throws during execution (e.g.
// bad JSON, wrong shape, API error).  toolEvents is empty because no write
// was attempted.

export interface Stage2cManagedAgentAdapterInvalidResponseReceipt {
  schemaVersion: 1
  stage: 'stage2c'
  step: 10
  runId: string
  timestamp: string
  gitBranch: string | null
  gitCommitSha: string | null
  task: string
  dryRun: false
  runDir: string
  workspacePath: string
  repoManifestHashBefore: string | null
  repoManifestHashAfter: string | null
  repoManifestImmutable: boolean | 'unavailable'
  agentExecutionAttempted: true
  managedAgentTransport: string
  builtinToolUseCount: 0
  toolEvents: []
  oracleEvaluationAttempted: false
  terminalOutcome: 'MANAGED_AGENT_ADAPTER_INVALID_RESPONSE'
}

// ── Result ────────────────────────────────────────────────────────────────────

export type Stage2cRunnerOutcome =
  | 'SKELETON_NO_AGENT_EXECUTION'
  | 'FAKE_AGENT_WORKSPACE_MUTATION_RECORDED'
  | 'FAKE_AGENT_TOOL_DENIED_OUTSIDE_WORKSPACE'
  | 'FAKE_AGENT_ORACLE_EVALUATED'
  | 'FAKE_AGENT_ORACLE_FAILED'
  | 'MANAGED_AGENT_BLOCKED_NOT_ENABLED'
  | 'MANAGED_AGENT_BLOCKED_NO_ADAPTER'
  | 'MANAGED_AGENT_BLOCKED_MISSING_CREDENTIALS'
  | 'MANAGED_AGENT_ADAPTER_WORKSPACE_MUTATION_RECORDED'
  | 'MANAGED_AGENT_ADAPTER_TOOL_DENIED_OUTSIDE_WORKSPACE'
  | 'MANAGED_AGENT_ADAPTER_INVALID_RESPONSE'
  | 'RUNNER_BLOCKED'

export interface Stage2cRunnerResult {
  outcome: Stage2cRunnerOutcome
  blockerReason: string
  receipt: Stage2cSkeletonReceipt | Stage2cFakeAgentReceipt | Stage2cFakeAgentDeniedReceipt | Stage2cFakeAgentOracleReceipt | Stage2cManagedAgentBlockedReceipt | Stage2cManagedAgentBlockedNoAdapterReceipt | Stage2cManagedAgentAdapterReceipt | Stage2cManagedAgentAdapterDeniedReceipt | Stage2cManagedAgentMissingCredentialsReceipt | Stage2cManagedAgentAdapterInvalidResponseReceipt | null
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface Stage2cRunnerOpts {
  task: string
  dryRun: boolean
  fakeAgent?: boolean
  oracle?: boolean
  fixture?: 'oracle-pass'
  managedAgent?: boolean
}

// ── Internal interface — injectable seams for deterministic testing only ──────

export interface Stage2cRunnerInternalOpts extends Stage2cRunnerOpts {
  _runtimeBaseForTesting?: string
  _repoPathForTesting?: string
  _gitInfoForTesting?: { branch: string | null; commitSha: string | null }
  _fakeAgentTargetPathForTesting?: string
  _oracleEvaluatorForTesting?: (workspacePath: string) => OracleEvaluationResult
  _managedAgentAdapterForTesting?: ManagedAgentAdapter
  _managedAgentEnvGateForTesting?: string
  _managedAgentLiveGateForTesting?: string
  _credentialCheckForTesting?: () => { available: boolean; missingVars: string[] }
  // Step 10: replaces createRealManagedAgentAdapter() in the live path for tests.
  // When present, this factory is called instead of the real adapter constructor,
  // allowing tests to inject mock adapters without making API calls.
  _realAdapterFactoryForTesting?: () => ManagedAgentAdapter
}

// ── Fake-agent workspace boundary check (Step 3 + Step 4) ────────────────────
//
// Uses fs.realpathSync() to resolve canonical filesystem paths, closing the
// symlink escape vector. Symlink escapes are denied by test (Step 4).
//
// Denial reasons:
//   TARGET_OUTSIDE_WORKSPACE  — absolute path outside, same-prefix sibling,
//                               '..' traversal, or intermediate symlink whose
//                               canonical path resolves outside the workspace.
//   TARGET_SYMLINK_ESCAPE     — the target itself, or its deepest existing
//                               ancestor directory, is a symlink.

function checkWorkspaceBoundaryCanonical(
  targetPath: string,
  workspacePath: string,
): { allowed: boolean; denialReason?: string } {
  // Resolve canonical workspace root — workspace must already exist.
  let canonicalWorkspace: string
  try {
    canonicalWorkspace = fs.realpathSync(workspacePath)
  } catch {
    return { allowed: false, denialReason: 'TARGET_OUTSIDE_WORKSPACE' }
  }

  const resolvedTarget = path.resolve(targetPath)

  // ── Case A: target already exists ─────────────────────────────────────────
  if (fs.existsSync(resolvedTarget)) {
    // Deny if the target itself is a symlink.
    try {
      if (fs.lstatSync(resolvedTarget).isSymbolicLink()) {
        return { allowed: false, denialReason: 'TARGET_SYMLINK_ESCAPE' }
      }
    } catch {
      return { allowed: false, denialReason: 'TARGET_OUTSIDE_WORKSPACE' }
    }

    // Canonicalize and confirm the target is inside the canonical workspace.
    let canonicalTarget: string
    try {
      canonicalTarget = fs.realpathSync(resolvedTarget)
    } catch {
      return { allowed: false, denialReason: 'TARGET_OUTSIDE_WORKSPACE' }
    }

    const rel = path.relative(canonicalWorkspace, canonicalTarget)
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      return { allowed: false, denialReason: 'TARGET_OUTSIDE_WORKSPACE' }
    }

    return { allowed: true }
  }

  // ── Case B: target does not exist — check its deepest existing ancestor ────
  //
  // Walk up from dirname(resolvedTarget) until we find a path that exists.
  // fs.existsSync follows symlinks, so a non-dangling symlink in the ancestor
  // chain will be found and then caught by the lstatSync check below.
  let existingAncestor = path.dirname(resolvedTarget)
  while (existingAncestor !== path.dirname(existingAncestor)) {
    if (fs.existsSync(existingAncestor)) break
    existingAncestor = path.dirname(existingAncestor)
  }

  // Deny if the existing ancestor is itself a symlink.
  try {
    if (fs.lstatSync(existingAncestor).isSymbolicLink()) {
      return { allowed: false, denialReason: 'TARGET_SYMLINK_ESCAPE' }
    }
  } catch {
    return { allowed: false, denialReason: 'TARGET_OUTSIDE_WORKSPACE' }
  }

  // Canonicalize the existing ancestor to follow any intermediate symlinks
  // baked into the path up to this point.
  let canonicalAncestor: string
  try {
    canonicalAncestor = fs.realpathSync(existingAncestor)
  } catch {
    return { allowed: false, denialReason: 'TARGET_OUTSIDE_WORKSPACE' }
  }

  // Canonical ancestor must be inside canonical workspace.
  const ancestorRel = path.relative(canonicalWorkspace, canonicalAncestor)
  if (ancestorRel.startsWith('..') || path.isAbsolute(ancestorRel)) {
    return { allowed: false, denialReason: 'TARGET_OUTSIDE_WORKSPACE' }
  }

  // The non-existing suffix from ancestor to target must not escape either.
  const suffix = path.relative(existingAncestor, resolvedTarget)
  if (suffix.startsWith('..') || path.isAbsolute(suffix)) {
    return { allowed: false, denialReason: 'TARGET_OUTSIDE_WORKSPACE' }
  }

  return { allowed: true }
}

// ── Test-only export — boundary function with real filesystem fixtures ────────
//
// Exported so that unit tests can create temp dirs with symlinks and verify
// the canonical boundary check directly, without routing through the full runner.
export function _checkWriteTargetBoundaryForTesting(
  targetPath: string,
  workspacePath: string,
): { allowed: boolean; denialReason?: string } {
  return checkWorkspaceBoundaryCanonical(targetPath, workspacePath)
}

// ── Fake-agent execution (Step 2/3) — typed tool interface ───────────────────

function executeFakeAgent(params: {
  task: string
  workspacePath: string
  targetPath: string
  timestamp: string
  contentOverride?: string   // oracle-pass fixture uses this to write valid JS
}): { event: FakeAgentToolEvent; blocked: boolean } {
  const { task, workspacePath, targetPath, timestamp, contentOverride } = params

  const { allowed, denialReason } = checkWorkspaceBoundaryCanonical(targetPath, workspacePath)

  if (!allowed) {
    return {
      event: { tool: 'WRITE_FILE', targetPath, allowed: false, denialReason, bytesWritten: 0, timestamp },
      blocked: true,
    }
  }

  const content = contentOverride ?? [
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
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, encoded)

  return {
    event: { tool: 'WRITE_FILE', targetPath, allowed: true, bytesWritten: encoded.length, timestamp },
    blocked: false,
  }
}

// ── Step 8: apply a managed-agent tool action through the typed boundary ──────
//
// The adapter proposes tool actions; the runner validates each against the
// workspace boundary and applies the write.  The adapter never touches the
// filesystem directly.

function applyManagedAgentToolAction(params: {
  action: ManagedAgentToolAction
  workspacePath: string
  timestamp: string
}): { event: FakeAgentToolEvent; blocked: boolean } {
  const { action, workspacePath, timestamp } = params
  const { allowed, denialReason } = checkWorkspaceBoundaryCanonical(action.targetPath, workspacePath)

  if (!allowed) {
    return {
      event: { tool: 'WRITE_FILE', targetPath: action.targetPath, allowed: false, denialReason, bytesWritten: 0, timestamp },
      blocked: true,
    }
  }

  const encoded = Buffer.from(action.content, 'utf-8')
  fs.mkdirSync(path.dirname(action.targetPath), { recursive: true })
  fs.writeFileSync(action.targetPath, encoded)

  return {
    event: { tool: 'WRITE_FILE', targetPath: action.targetPath, allowed: true, bytesWritten: encoded.length, timestamp },
    blocked: false,
  }
}

// ── Step 5: oracle evaluation against the sanitized candidate workspace ───────
//
// Reads fixture content from the workspace (src/status.js if present, falling
// back to STAGE2C_FAKE_AGENT_OUTPUT.md), then runs the immutable subprocess
// oracle against it.  Errors are captured honestly — never fabricated as PASS.
//
// The _oracleEvaluatorForTesting seam replaces the real oracle call for unit
// tests, without exposing the seam on the public Stage2cRunnerOpts interface.

function evaluateWorkspaceOracle(
  workspacePath: string,
  runId: string,
  seam?: (workspacePath: string) => OracleEvaluationResult,
): OracleEvaluationResult {
  if (seam !== undefined) {
    try {
      return seam(workspacePath)
    } catch (err) {
      return {
        status: 'ERROR',
        exitCode: null,
        summary: (err instanceof Error ? err.message : String(err)).slice(0, 256),
      }
    }
  }

  try {
    // Prefer src/status.js (canonical oracle target); fall back to the file the
    // fake agent actually wrote.  Content is passed as fixtureContent to the
    // subprocess evaluator, which places it at workspace/src/status.js inside
    // a fresh isolated temp directory — the fake-agent workspace is not mutated.
    const statusJsPath = path.join(workspacePath, 'src', 'status.js')
    const mdPath = path.join(workspacePath, 'STAGE2C_FAKE_AGENT_OUTPUT.md')
    let fixtureContent: string
    if (fs.existsSync(statusJsPath)) {
      fixtureContent = fs.readFileSync(statusJsPath, 'utf-8')
    } else if (fs.existsSync(mdPath)) {
      fixtureContent = fs.readFileSync(mdPath, 'utf-8')
    } else {
      fixtureContent = ''
    }

    const bundleResult = createOracleBundle({ preflightId: runId })
    const evalReceipt = runOracleWithFixture({
      bundleResult,
      fixtureContent,
      fixtureLabel: 'stage2c-fake-agent-workspace',
      preflightId: runId,
    })

    return {
      status: evalReceipt.terminalOracleStatus,
      exitCode: null,
      summary: evalReceipt.boundedDiagnostics.slice(0, 256) || null,
    }
  } catch (err) {
    return {
      status: 'ERROR',
      exitCode: null,
      summary: (err instanceof Error ? err.message : String(err)).slice(0, 256),
    }
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

export async function runStage2cSkeleton(opts: Stage2cRunnerOpts): Promise<Stage2cRunnerResult> {
  return _runStage2cSkeletonInternal(opts)
}

// ── Test-only entry point — injectable seams for deterministic tests ──────────

export async function _runStage2cSkeletonForTesting(opts: Stage2cRunnerInternalOpts): Promise<Stage2cRunnerResult> {
  return _runStage2cSkeletonInternal(opts)
}

// ── Core implementation ───────────────────────────────────────────────────────

async function _runStage2cSkeletonInternal(opts: Stage2cRunnerInternalOpts): Promise<Stage2cRunnerResult> {
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

    const isOraclePassFixture = opts.fixture === 'oracle-pass'
    const defaultTarget = isOraclePassFixture
      ? path.join(workspacePath, 'src', 'status.js')
      : path.join(workspacePath, 'STAGE2C_FAKE_AGENT_OUTPUT.md')
    const targetPath = opts._fakeAgentTargetPathForTesting ?? defaultTarget
    const contentOverride = isOraclePassFixture ? ORACLE_PASS_STATUS_JS : undefined

    const { event, blocked } = executeFakeAgent({
      task: task.trim(),
      workspacePath,
      targetPath,
      timestamp,
      contentOverride,
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

    // ── Step 5: oracle evaluation branch ─────────────────────────────────────
    if (opts.oracle) {
      const oracleResult = evaluateWorkspaceOracle(workspacePath, runId, opts._oracleEvaluatorForTesting)

      const oracleReceipt: Stage2cFakeAgentOracleReceipt = {
        schemaVersion: 1,
        stage: 'stage2c',
        step: 5,
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
        oracleEvaluationAttempted: true,
        oracleEvaluator: 'subprocess-node-v1',
        oracleTarget: 'sanitized_candidate_workspace',
        oracleResult,
        terminalOutcome: 'FAKE_AGENT_ORACLE_EVALUATED',
      }

      try {
        fs.writeFileSync(
          path.join(runDir, 'stage2c-receipt.json'),
          JSON.stringify(oracleReceipt, null, 2) + '\n',
          'utf-8',
        )
      } catch (err) {
        return {
          outcome: 'RUNNER_BLOCKED',
          blockerReason: `Failed to write oracle receipt: ${err instanceof Error ? err.message : String(err)}`,
          receipt: null,
        }
      }

      return {
        outcome: 'FAKE_AGENT_ORACLE_EVALUATED',
        blockerReason: '',
        receipt: oracleReceipt,
      }
    }

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

  // ── Step 7: managed-agent transport gate ─────────────────────────────────
  //
  // Both the --managed-agent CLI flag and STAGE2C_MANAGED_AGENT_ENABLED=1 env
  // var must be present for the live path to be eligible.  In Step 7 the live
  // path is not yet wired, so even a gate-active call falls through to the
  // skeleton receipt.  The primary proof surface here is the blocked path:
  // when the gate is absent the runner emits an honest blocked receipt and
  // returns early without invoking any SDK, API client, or workspace mutation.
  if (opts.managedAgent && !dryRun) {
    const envGate = opts._managedAgentEnvGateForTesting ?? process.env['STAGE2C_MANAGED_AGENT_ENABLED']
    if (envGate !== '1') {
      let repoManifestHash: string | null
      try { repoManifestHash = computeDirectoryManifestHash(repoPath) } catch { repoManifestHash = null }

      const blockedReceipt: Stage2cManagedAgentBlockedReceipt = {
        schemaVersion: 1,
        stage: 'stage2c',
        step: 7,
        runId,
        timestamp,
        gitBranch: gitInfo.branch,
        gitCommitSha: gitInfo.commitSha,
        task: task.trim(),
        dryRun: false,
        runDir,
        workspacePath,
        repoManifestHash,
        agentExecutionAttempted: false,
        managedAgentTransport: 'blocked_not_enabled',
        builtinToolUseCount: 0,
        oracleEvaluationAttempted: false,
        terminalOutcome: 'MANAGED_AGENT_BLOCKED_NOT_ENABLED',
      }

      try {
        fs.writeFileSync(
          path.join(runDir, 'stage2c-receipt.json'),
          JSON.stringify(blockedReceipt, null, 2) + '\n',
          'utf-8',
        )
      } catch (err) {
        return {
          outcome: 'RUNNER_BLOCKED',
          blockerReason: `Failed to write blocked receipt: ${err instanceof Error ? err.message : String(err)}`,
          receipt: null,
        }
      }

      return {
        outcome: 'MANAGED_AGENT_BLOCKED_NOT_ENABLED',
        blockerReason: '',
        receipt: blockedReceipt,
      }
    }

    // ── Step 8: env gate active — check for injected test adapter ────────────
    //
    // _managedAgentAdapterForTesting bypasses live-gate and credential checks:
    // it is a direct seam for deterministic testing of the execution boundary.
    let adapter: ManagedAgentAdapter | undefined = opts._managedAgentAdapterForTesting

    if (adapter === undefined) {
      // ── Step 9/10: live gate and credential checks ───────────────────────────
      const liveGate = opts._managedAgentLiveGateForTesting ?? process.env['STAGE2C_MANAGED_AGENT_LIVE']

      if (liveGate === '1') {
        // Live gate active — check credentials via real adapter shell.
        const credCheck = opts._credentialCheckForTesting
          ? opts._credentialCheckForTesting()
          : checkRealAdapterCredentials()

        if (!credCheck.available) {
          // Credentials missing — emit fail-closed receipt, do not throw.
          let repoManifestHashBefore: string | null
          try { repoManifestHashBefore = computeDirectoryManifestHash(repoPath) } catch { repoManifestHashBefore = null }
          let repoManifestHashAfter: string | null
          try { repoManifestHashAfter = computeDirectoryManifestHash(repoPath) } catch { repoManifestHashAfter = null }
          const repoManifestImmutable: boolean | 'unavailable' =
            (repoManifestHashBefore !== null && repoManifestHashAfter !== null)
              ? repoManifestHashBefore === repoManifestHashAfter
              : 'unavailable'

          const missingCredsReceipt: Stage2cManagedAgentMissingCredentialsReceipt = {
            schemaVersion: 1,
            stage: 'stage2c',
            step: 9,
            runId,
            timestamp,
            gitBranch: gitInfo.branch,
            gitCommitSha: gitInfo.commitSha,
            task: task.trim(),
            dryRun: false,
            runDir,
            workspacePath,
            repoManifestHashBefore,
            repoManifestHashAfter,
            repoManifestImmutable,
            agentExecutionAttempted: false,
            managedAgentTransport: 'blocked_missing_credentials',
            builtinToolUseCount: 0,
            oracleEvaluationAttempted: false,
            terminalOutcome: 'MANAGED_AGENT_BLOCKED_MISSING_CREDENTIALS',
          }

          try {
            fs.writeFileSync(
              path.join(runDir, 'stage2c-receipt.json'),
              JSON.stringify(missingCredsReceipt, null, 2) + '\n',
              'utf-8',
            )
          } catch (err) {
            return {
              outcome: 'RUNNER_BLOCKED',
              blockerReason: `Failed to write missing-credentials receipt: ${err instanceof Error ? err.message : String(err)}`,
              receipt: null,
            }
          }

          return {
            outcome: 'MANAGED_AGENT_BLOCKED_MISSING_CREDENTIALS',
            blockerReason: '',
            receipt: missingCredsReceipt,
          }
        }

        // ── Step 10: all gates pass — create real (or test-factory) adapter ────
        //
        // _realAdapterFactoryForTesting replaces createRealManagedAgentAdapter
        // in tests so that mock adapters can be exercised without API calls.
        // In production (factory not injected), the real adapter is created here.
        const factory = opts._realAdapterFactoryForTesting ?? createRealManagedAgentAdapter
        adapter = factory() as ManagedAgentAdapter
      }
    }

    if (adapter === undefined) {
      // Live gate absent (or credentials present but adapter creation failed).
      // Emit blocked_no_adapter receipt.
      let repoManifestHashBefore: string | null
      try { repoManifestHashBefore = computeDirectoryManifestHash(repoPath) } catch { repoManifestHashBefore = null }
      let repoManifestHashAfter: string | null
      try { repoManifestHashAfter = computeDirectoryManifestHash(repoPath) } catch { repoManifestHashAfter = null }
      const repoManifestImmutable: boolean | 'unavailable' =
        (repoManifestHashBefore !== null && repoManifestHashAfter !== null)
          ? repoManifestHashBefore === repoManifestHashAfter
          : 'unavailable'

      const noAdapterReceipt: Stage2cManagedAgentBlockedNoAdapterReceipt = {
        schemaVersion: 1,
        stage: 'stage2c',
        step: 8,
        runId,
        timestamp,
        gitBranch: gitInfo.branch,
        gitCommitSha: gitInfo.commitSha,
        task: task.trim(),
        dryRun: false,
        runDir,
        workspacePath,
        repoManifestHashBefore,
        repoManifestHashAfter,
        repoManifestImmutable,
        agentExecutionAttempted: false,
        managedAgentTransport: 'blocked_no_adapter',
        builtinToolUseCount: 0,
        oracleEvaluationAttempted: false,
        terminalOutcome: 'MANAGED_AGENT_BLOCKED_NO_ADAPTER',
      }

      try {
        fs.writeFileSync(
          path.join(runDir, 'stage2c-receipt.json'),
          JSON.stringify(noAdapterReceipt, null, 2) + '\n',
          'utf-8',
        )
      } catch (err) {
        return {
          outcome: 'RUNNER_BLOCKED',
          blockerReason: `Failed to write no-adapter receipt: ${err instanceof Error ? err.message : String(err)}`,
          receipt: null,
        }
      }

      return {
        outcome: 'MANAGED_AGENT_BLOCKED_NO_ADAPTER',
        blockerReason: '',
        receipt: noAdapterReceipt,
      }
    }

    // ── Adapter execution — Steps 8 and 10 share this boundary ────────────────
    //
    // Test adapters (Step 8) are synchronous.  The real adapter (Step 10) is
    // async (lazy SDK import + API call).  Both paths are handled via Promise
    // detection and await.  Any exception from run() yields an
    // MANAGED_AGENT_ADAPTER_INVALID_RESPONSE receipt and no workspace mutation.
    let workspaceManifestHashBefore: string
    try { workspaceManifestHashBefore = computeDirectoryManifestHash(workspacePath) } catch { workspaceManifestHashBefore = 'EMPTY' }
    let repoManifestHashBefore: string | null
    try { repoManifestHashBefore = computeDirectoryManifestHash(repoPath) } catch { repoManifestHashBefore = null }

    const request: ManagedAgentRequest = { task: task.trim(), workspacePath, runId }
    const capturedTransportName = adapter.transportName

    let adapterResult: ManagedAgentResult
    try {
      const rawResult = adapter.run(request)
      adapterResult = rawResult instanceof Promise ? await rawResult : rawResult
    } catch (err) {
      // Adapter threw (malformed response, API error, parse failure, etc.).
      // → MANAGED_AGENT_ADAPTER_INVALID_RESPONSE (Step 10 invalid path)
      let repoManifestHashAfterErr: string | null
      try { repoManifestHashAfterErr = computeDirectoryManifestHash(repoPath) } catch { repoManifestHashAfterErr = null }
      const repoManifestImmutableErr: boolean | 'unavailable' =
        (repoManifestHashBefore !== null && repoManifestHashAfterErr !== null)
          ? repoManifestHashBefore === repoManifestHashAfterErr
          : 'unavailable'

      const invalidResponseReceipt: Stage2cManagedAgentAdapterInvalidResponseReceipt = {
        schemaVersion: 1,
        stage: 'stage2c',
        step: 10,
        runId,
        timestamp,
        gitBranch: gitInfo.branch,
        gitCommitSha: gitInfo.commitSha,
        task: task.trim(),
        dryRun: false,
        runDir,
        workspacePath,
        repoManifestHashBefore,
        repoManifestHashAfter: repoManifestHashAfterErr,
        repoManifestImmutable: repoManifestImmutableErr,
        agentExecutionAttempted: true,
        managedAgentTransport: capturedTransportName,
        builtinToolUseCount: 0,
        toolEvents: [],
        oracleEvaluationAttempted: false,
        terminalOutcome: 'MANAGED_AGENT_ADAPTER_INVALID_RESPONSE',
      }

      try {
        fs.writeFileSync(
          path.join(runDir, 'stage2c-receipt.json'),
          JSON.stringify(invalidResponseReceipt, null, 2) + '\n',
          'utf-8',
        )
      } catch (writeErr) {
        return {
          outcome: 'RUNNER_BLOCKED',
          blockerReason: `Failed to write invalid-response receipt: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
          receipt: null,
        }
      }

      return {
        outcome: 'MANAGED_AGENT_ADAPTER_INVALID_RESPONSE',
        blockerReason: '',
        receipt: invalidResponseReceipt,
      }
    }

    // Apply each proposed tool action through the boundary check.
    const toolEvents: FakeAgentToolEvent[] = []
    let anyBlocked = false
    for (const action of (adapterResult.toolActions ?? [])) {
      const { event, blocked } = applyManagedAgentToolAction({ action, workspacePath, timestamp })
      toolEvents.push(event)
      if (blocked) anyBlocked = true
    }

    // Capture repo manifest after adapter ran (both allowed and denied paths).
    let repoManifestHashAfter: string | null
    try { repoManifestHashAfter = computeDirectoryManifestHash(repoPath) } catch { repoManifestHashAfter = null }
    const repoManifestImmutable: boolean | 'unavailable' =
      (repoManifestHashBefore !== null && repoManifestHashAfter !== null)
        ? repoManifestHashBefore === repoManifestHashAfter
        : 'unavailable'

    if (anyBlocked) {
      const adapterDeniedReceipt: Stage2cManagedAgentAdapterDeniedReceipt = {
        schemaVersion: 1,
        stage: 'stage2c',
        step: 8,
        runId,
        timestamp,
        gitBranch: gitInfo.branch,
        gitCommitSha: gitInfo.commitSha,
        task: task.trim(),
        dryRun: false,
        runDir,
        workspacePath,
        agentExecutionAttempted: true,
        managedAgentTransport: adapterResult.transportName,
        builtinToolUseCount: 0,
        toolEvents,
        repoManifestHashBefore,
        repoManifestHashAfter,
        repoManifestImmutable,
        oracleEvaluationAttempted: false,
        terminalOutcome: 'MANAGED_AGENT_ADAPTER_TOOL_DENIED_OUTSIDE_WORKSPACE',
      }

      try {
        fs.writeFileSync(
          path.join(runDir, 'stage2c-receipt.json'),
          JSON.stringify(adapterDeniedReceipt, null, 2) + '\n',
          'utf-8',
        )
      } catch (err) {
        return {
          outcome: 'RUNNER_BLOCKED',
          blockerReason: `Failed to write adapter denied receipt: ${err instanceof Error ? err.message : String(err)}`,
          receipt: null,
        }
      }

      return {
        outcome: 'MANAGED_AGENT_ADAPTER_TOOL_DENIED_OUTSIDE_WORKSPACE',
        blockerReason: '',
        receipt: adapterDeniedReceipt,
      }
    }

    // All tool actions succeeded.
    let workspaceManifestHashAfter: string
    try { workspaceManifestHashAfter = computeDirectoryManifestHash(workspacePath) } catch { workspaceManifestHashAfter = 'EMPTY' }

    const adapterReceipt: Stage2cManagedAgentAdapterReceipt = {
      schemaVersion: 1,
      stage: 'stage2c',
      step: 8,
      runId,
      timestamp,
      gitBranch: gitInfo.branch,
      gitCommitSha: gitInfo.commitSha,
      task: task.trim(),
      dryRun: false,
      runDir,
      workspacePath,
      agentExecutionAttempted: true,
      managedAgentTransport: adapterResult.transportName,
      builtinToolUseCount: 0,
      toolEvents,
      workspaceManifestHashBefore,
      workspaceManifestHashAfter,
      repoManifestHashBefore,
      repoManifestHashAfter,
      repoManifestImmutable,
      oracleEvaluationAttempted: false,
      terminalOutcome: 'MANAGED_AGENT_ADAPTER_WORKSPACE_MUTATION_RECORDED',
    }

    try {
      fs.writeFileSync(
        path.join(runDir, 'stage2c-receipt.json'),
        JSON.stringify(adapterReceipt, null, 2) + '\n',
        'utf-8',
      )
    } catch (err) {
      return {
        outcome: 'RUNNER_BLOCKED',
        blockerReason: `Failed to write adapter receipt: ${err instanceof Error ? err.message : String(err)}`,
        receipt: null,
      }
    }

    return {
      outcome: 'MANAGED_AGENT_ADAPTER_WORKSPACE_MUTATION_RECORDED',
      blockerReason: '',
      receipt: adapterReceipt,
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
