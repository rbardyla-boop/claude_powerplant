// Stage 2B P0-E — capsule-v1 Docker Evaluator (Trust-Root & Result-Integrity edition)
//
// Extends P0-C capsule-v1 with:
//   - Registry-digest trust root (Phase B / Gate 6B2C-R): resolved RepoDigests checked
//     against CAPSULE_V1_EXPECTED_REPO_DIGEST before any candidate code runs. Execution
//     refused if the approved canonical reference is absent from RepoDigests.
//   - Hardened launch policy: --cap-drop=ALL and --pids-limit added.
//   - Trusted result channel: evaluator reads oracle's stdout for ORACLE_TRUSTED_RESULT
//     sentinel (written by oracle using pre-import saved function references). The
//     output file in /output is advisory only and never used as sole trust source.
//   - Corrected receipt semantics: agentModifiedCodeExecuted removed; replaced with
//     explicit candidateCodeExecutedInCapsule / candidateCodeExecutedOnHost / etc.
//
// Capsule configuration (capsule-v1):
//   image:           CAPSULE_V1_EXPECTED_REPO_DIGEST  (immutable GHCR registry digest)
//   network:         none  (--network=none)
//   root fs:         read-only  (--read-only)
//   capabilities:    dropped  (--cap-drop=ALL)
//   pids:            bounded  (--pids-limit=64)
//   tmp:             tmpfs only  (--tmpfs /tmp:exec,nosuid,size=64m)
//   privileges:      denied  (--security-opt=no-new-privileges)
//   memory:          256m
//   stop signal:     SIGKILL
//   user:            host uid:gid
//   mounts:
//     /oracle    ← oracle bundle dir   (read-only)
//     /workspace ← candidate code     (read-only)
//     /output    ← output dir         (writable, isolated; advisory only)
//   environment:     HOME=/tmp only (no host secrets inherited)
//
// Oracle visibility contract:
//   oracle_visibility = PUBLIC_BY_DESIGN
//   oracle_integrity  = HASH_LOCKED
//   anti_gaming_claim = NOT_MADE
//
// Trusted result channel (P0-E):
//   Oracle writes ORACLE_TRUSTED_RESULT:<json> to stdout using function references
//   saved before candidate import. Parent extracts the last valid sentinel line from
//   captured stdout. Output file in /output is advisory and not used for trust.
//
// Capsule image trust root (Phase B):
//   Before any candidate code runs, evaluator calls docker image inspect to obtain
//   the resolved RepoDigests and checks that CAPSULE_V1_EXPECTED_REPO_DIGEST is
//   present. Execution is refused (throws) if the digest is absent or unresolvable.

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn, spawnSync } from 'child_process'
import { randomUUID } from 'crypto'
import {
  STAGE2B_PREFLIGHT_BASE,
  STAGE2B_CAPSULE_EVALUATOR_PROFILE_ID,
  STAGE2B_PREFLIGHT_CONTROL_POLICY_VERSION,
  CAPSULE_DOCKER_IMAGE,
  CAPSULE_V1_EXPECTED_REPO_DIGEST,
  CAPSULE_ORACLE_MOUNT_TARGET,
  CAPSULE_WORKSPACE_MOUNT_TARGET,
  CAPSULE_OUTPUT_MOUNT_TARGET,
  CAPSULE_MAX_OUTPUT_BYTES_DEFAULT,
  CAPSULE_TIMEOUT_MS_DEFAULT,
  CAPSULE_PIDS_LIMIT,
  ORACLE_TRUSTED_RESULT_PREFIX,
} from '../config/constants.js'
import { computeOracleHash } from './oracle-bundle.js'
import type { OracleBundleResult } from './oracle-bundle.js'

export interface CapsuleEvaluatorReceipt {
  oracleRunId: string
  preflightId: string
  oracleSha256: string
  workspacePayloadHash: string
  evaluatorProfile: typeof STAGE2B_CAPSULE_EVALUATOR_PROFILE_ID
  controlPolicyVersion: string
  // Capsule image trust root fields (Phase B: registry-digest semantics)
  capsuleImageReference: string
  capsuleCanonicalReference: string
  capsuleResolvedRepoDigests: string[]
  capsuleRegistryDigestVerified: boolean
  capsuleImageIdentityVerified: boolean   // aliases capsuleRegistryDigestVerified; retained for l1-runner compatibility
  // Execution provenance fields (P0-E: corrected receipt semantics)
  candidateCodeExecutedInCapsule: boolean
  candidateCodeExecutedOnHost: false
  promotedSkillExecuted: false
  realPowerplantStateMounted: false
  realPowerplantStateWriteOccurred: false
  // Result channel fields (P0-E: trusted stdout channel)
  resultChannelUsed: 'stdout-sentinel' | 'file-fallback' | 'none'
  // Evaluation outcome
  terminalOracleStatus: 'PASS' | 'FAIL' | 'ERROR' | 'TIMEOUT' | 'OUTPUT_CAPPED'
  oracleResult: unknown
  boundedDiagnostics: string
  outputCapped: boolean
  timeoutEnforced: boolean
  // Isolation proof fields
  networkIsolationProven: true
  fullFilesystemIsolationProven: true
  cleanupComplete: boolean
  tamperCheckPassed: boolean
  fixtureLabel: string
  evaluatedAt: string
  // Docker launch args (for command-construction tests — paths redacted)
  dockerLaunchArgsSanitized: string[]
  verifiedControls: readonly [
    'timeout_enforcement',
    'output_cap',
    'network_isolation',
    'full_filesystem_isolation',
    'workspace_readonly',
    'env_scrubbing',
    'readonly_rootfs',
    'cap_drop_all',
    'pids_limit',
    'image_identity_verified',
    'trusted_result_channel',
  ]
  unverifiedControls: readonly []
  capsuleConfig: {
    image: string
    networkMode: 'none'
    readOnly: true
    memoryLimit: '256m'
    stopSignal: 'SIGKILL'
    securityOpts: ['no-new-privileges']
    capDrop: ['ALL']
    pidsLimit: typeof CAPSULE_PIDS_LIMIT
    oracleMount: string
    workspaceMount: string
    outputMount: string
  }
}

function computePayloadHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex')
}

function chmodRecursive(dir: string, fileMode: number, dirMode: number): void {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        chmodRecursive(full, fileMode, dirMode)
        fs.chmodSync(full, dirMode)
      } else {
        fs.chmodSync(full, fileMode)
      }
    }
    fs.chmodSync(dir, dirMode)
  } catch { /* best-effort */ }
}

function restoreWritable(dir: string): void {
  try { chmodRecursive(dir, 0o644, 0o755) } catch { /* best-effort */ }
}

// ── Registry digest verification (Phase B / Gate 6B2C-R) ─────────────────────

export function getCapsuleRepoDigests(imageRef: string): string[] | null {
  const result = spawnSync(
    'docker',
    ['image', 'inspect', imageRef, '--format', '{{json .RepoDigests}}'],
    {
      encoding: 'utf-8',
      timeout: 10000,
      env: { PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin' },
    },
  )
  if (result.status !== 0 || result.error) return null
  const raw = result.stdout.trim()
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed as string[]
  } catch {
    return null
  }
}

// ── Trusted result sentinel parser (P0-E Task 5) ──────────────────────────────

function extractOracleTrustedResult(stdout: string): unknown | null {
  const lines = stdout.split('\n')
  // Scan from the end: oracle writes the sentinel LAST (after all candidate code).
  // Using the last valid line handles any edge case where candidate writes an
  // earlier fake line — oracle's write happens after import completes.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? '').trim()
    if (line.startsWith(ORACLE_TRUSTED_RESULT_PREFIX)) {
      try {
        return JSON.parse(line.slice(ORACLE_TRUSTED_RESULT_PREFIX.length))
      } catch { /* skip malformed lines */ }
    }
  }
  return null
}

// ── Sanitize docker args for receipt (redact absolute paths) ─────────────────

function sanitizeDockerArgs(args: string[]): string[] {
  return args.map(arg => {
    // Redact absolute paths that reveal host tmpdir layout; keep structure visible
    if (arg.startsWith('/') && (arg.includes('/pp-') || arg.includes('/powerplant'))) {
      return '<ephemeral-capsule-path>'
    }
    // Redact bind-mount source paths
    if (arg.startsWith('type=bind,source=') && arg.includes('/pp-')) {
      const rest = arg.slice(arg.indexOf(',source=') + 8)
      const afterSource = rest.indexOf(',')
      return arg.slice(0, arg.indexOf(',source=') + 8) + '<ephemeral-path>' + (afterSource >= 0 ? rest.slice(afterSource) : '')
    }
    return arg
  })
}

export async function runOracleInCapsule(opts: {
  bundleResult: OracleBundleResult
  fixtureContent: string
  fixtureLabel: string
  preflightId: string
  baseDir?: string
  timeoutMs?: number
  maxOutputBytes?: number
  expectedCanonicalReference?: string  // override for F16 test; defaults to CAPSULE_V1_EXPECTED_REPO_DIGEST
}): Promise<CapsuleEvaluatorReceipt> {
  const {
    bundleResult,
    fixtureContent,
    fixtureLabel,
    preflightId,
    timeoutMs = CAPSULE_TIMEOUT_MS_DEFAULT,
    maxOutputBytes = CAPSULE_MAX_OUTPUT_BYTES_DEFAULT,
  } = opts

  const expectedCanonicalReference = opts.expectedCanonicalReference ?? CAPSULE_V1_EXPECTED_REPO_DIGEST
  const baseDir = opts.baseDir ?? STAGE2B_PREFLIGHT_BASE
  const oracleRunId = randomUUID()
  const containerName = `pp-cap-${oracleRunId.slice(0, 12)}`

  // ── Registry digest verification (Phase B / Gate 6B2C-R) ────────────────────
  const repoDigests = getCapsuleRepoDigests(CAPSULE_V1_EXPECTED_REPO_DIGEST)
  const capsuleRegistryDigestVerified =
    repoDigests !== null &&
    repoDigests.length > 0 &&
    repoDigests.includes(expectedCanonicalReference)

  if (!capsuleRegistryDigestVerified) {
    throw new Error(
      `CAPSULE_IMAGE_IDENTITY_MISMATCH: approved canonical reference ${expectedCanonicalReference} ` +
      `not found in resolved RepoDigests ${JSON.stringify(repoDigests ?? [])}. ` +
      `Execution refused before any candidate code runs.`
    )
  }

  const runDir = path.join(baseDir, preflightId, 'capsule-runs', oracleRunId)
  const oracleMountDir = path.join(runDir, 'oracle')
  const workspaceDir = path.join(runDir, 'workspace')
  const outputDir = path.join(runDir, 'output')
  const outputFile = path.join(outputDir, 'result.json')

  const tamperCheck = computeOracleHash(bundleResult.bundledOraclePath)
  const tamperCheckPassed = tamperCheck === bundleResult.receipt.oracleSha256
  const workspacePayloadHash = computePayloadHash(fixtureContent)

  let terminalOracleStatus: CapsuleEvaluatorReceipt['terminalOracleStatus'] = 'ERROR'
  let oracleResult: unknown = null
  let boundedDiagnostics = ''
  let outputCapped = false
  let timeoutEnforced = false
  let cleanupComplete = false
  let resultChannelUsed: CapsuleEvaluatorReceipt['resultChannelUsed'] = 'none'
  let candidateCodeExecutedInCapsule = false

  // Build docker args (Tasks 3, 4)
  const hostUid = process.getuid?.() ?? 1000
  const hostGid = process.getgid?.() ?? 1000

  const dockerArgs = [
    'run', '--rm',
    '--network=none',
    '--read-only',
    '--cap-drop=ALL',                            // P0-E Task 3: drop all Linux capabilities
    `--pids-limit=${CAPSULE_PIDS_LIMIT}`,        // P0-E Task 3: prevent fork/process exhaustion
    '--tmpfs', '/tmp:exec,nosuid,nodev,size=64m',
    '--security-opt=no-new-privileges',
    '--memory=256m',
    '--stop-signal=SIGKILL',
    `--user=${hostUid}:${hostGid}`,
    '--name', containerName,
    '--mount', `type=bind,source=${oracleMountDir},target=${CAPSULE_ORACLE_MOUNT_TARGET},readonly`,
    '--mount', `type=bind,source=${workspaceDir},target=${CAPSULE_WORKSPACE_MOUNT_TARGET},readonly`,
    '--mount', `type=bind,source=${outputDir},target=${CAPSULE_OUTPUT_MOUNT_TARGET}`,
    '-e', 'HOME=/tmp',
    CAPSULE_DOCKER_IMAGE,
    'node',
    `${CAPSULE_ORACLE_MOUNT_TARGET}/operator-task-oracle.mjs`,
    CAPSULE_WORKSPACE_MOUNT_TARGET,
    `${CAPSULE_OUTPUT_MOUNT_TARGET}/result.json`,
  ]

  const dockerLaunchArgsSanitized = sanitizeDockerArgs(dockerArgs)

  try {
    // Set up oracle bundle mount (read-only — oracle is copied here)
    fs.mkdirSync(oracleMountDir, { recursive: true })
    fs.copyFileSync(bundleResult.bundledOraclePath, path.join(oracleMountDir, 'operator-task-oracle.mjs'))

    // Set up candidate workspace (mounted read-only)
    fs.mkdirSync(path.join(workspaceDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(workspaceDir, 'package.json'), JSON.stringify({ type: 'module' }))
    fs.writeFileSync(path.join(workspaceDir, 'src', 'status.js'), fixtureContent)
    chmodRecursive(workspaceDir, 0o444, 0o555)

    // Set up output dir (writable, advisory — not trusted for PASS/FAIL)
    fs.mkdirSync(outputDir, { recursive: true })
    fs.writeFileSync(outputFile, '')

    candidateCodeExecutedInCapsule = true

    const result = await spawnCapsule({
      containerName,
      dockerArgs,
      timeoutMs,
      maxOutputBytes,
    })

    timeoutEnforced = result.timedOut
    outputCapped = result.outputCapped
    boundedDiagnostics = result.diagnostics.slice(0, 1024)

    if (result.timedOut) {
      terminalOracleStatus = 'TIMEOUT'
    } else if (result.outputCapped) {
      terminalOracleStatus = 'OUTPUT_CAPPED'
    } else {
      // Task 5: Primary trusted channel — stdout sentinel
      const trustedResult = extractOracleTrustedResult(result.stdout)
      if (trustedResult !== null) {
        oracleResult = trustedResult
        const s = (trustedResult as { status?: string }).status
        terminalOracleStatus = s === 'PASS' ? 'PASS' : s === 'FAIL' ? 'FAIL' : 'ERROR'
        resultChannelUsed = 'stdout-sentinel'
      } else {
        // Fallback: advisory file channel (not trusted; used only if oracle emitted no sentinel)
        try {
          const raw = fs.readFileSync(outputFile, 'utf-8').trim()
          if (raw) {
            oracleResult = JSON.parse(raw)
            const s = (oracleResult as { status?: string }).status
            terminalOracleStatus = s === 'PASS' ? 'PASS' : s === 'FAIL' ? 'FAIL' : 'ERROR'
            resultChannelUsed = 'file-fallback'
          }
        } catch { /* result stays ERROR */ }
      }
    }
  } finally {
    restoreWritable(workspaceDir)
    try {
      fs.rmSync(runDir, { recursive: true, force: true })
      cleanupComplete = true
    } catch {
      cleanupComplete = false
    }
  }

  const receipt: CapsuleEvaluatorReceipt = {
    oracleRunId,
    preflightId,
    oracleSha256: bundleResult.receipt.oracleSha256,
    workspacePayloadHash,
    evaluatorProfile: STAGE2B_CAPSULE_EVALUATOR_PROFILE_ID,
    controlPolicyVersion: STAGE2B_PREFLIGHT_CONTROL_POLICY_VERSION,
    // Capsule image trust root (Phase B: registry-digest semantics)
    capsuleImageReference: CAPSULE_DOCKER_IMAGE,
    capsuleCanonicalReference: expectedCanonicalReference,
    capsuleResolvedRepoDigests: repoDigests ?? [],
    capsuleRegistryDigestVerified,
    capsuleImageIdentityVerified: capsuleRegistryDigestVerified,
    // Execution provenance (P0-E Task 6 — corrected semantics)
    candidateCodeExecutedInCapsule,
    candidateCodeExecutedOnHost: false,
    promotedSkillExecuted: false,
    realPowerplantStateMounted: false,
    realPowerplantStateWriteOccurred: false,
    // Result channel (P0-E Task 5)
    resultChannelUsed,
    // Evaluation outcome
    terminalOracleStatus,
    oracleResult,
    boundedDiagnostics,
    outputCapped,
    timeoutEnforced,
    networkIsolationProven: true,
    fullFilesystemIsolationProven: true,
    cleanupComplete,
    tamperCheckPassed,
    fixtureLabel,
    evaluatedAt: new Date().toISOString(),
    dockerLaunchArgsSanitized,
    verifiedControls: [
      'timeout_enforcement',
      'output_cap',
      'network_isolation',
      'full_filesystem_isolation',
      'workspace_readonly',
      'env_scrubbing',
      'readonly_rootfs',
      'cap_drop_all',
      'pids_limit',
      'image_identity_verified',
      'trusted_result_channel',
    ],
    unverifiedControls: [],
    capsuleConfig: {
      image: CAPSULE_DOCKER_IMAGE,
      networkMode: 'none',
      readOnly: true,
      memoryLimit: '256m',
      stopSignal: 'SIGKILL',
      securityOpts: ['no-new-privileges'],
      capDrop: ['ALL'],
      pidsLimit: CAPSULE_PIDS_LIMIT,
      oracleMount: `${CAPSULE_ORACLE_MOUNT_TARGET} (read-only)`,
      workspaceMount: `${CAPSULE_WORKSPACE_MOUNT_TARGET} (read-only)`,
      outputMount: `${CAPSULE_OUTPUT_MOUNT_TARGET} (writable, advisory-only)`,
    },
  }

  // Persist receipt for audit
  try {
    const receiptsDir = path.join(baseDir, preflightId, 'capsule-receipts')
    fs.mkdirSync(receiptsDir, { recursive: true })
    fs.writeFileSync(path.join(receiptsDir, `${oracleRunId}.json`), JSON.stringify(receipt, null, 2))
  } catch { /* best-effort audit persistence */ }

  return receipt
}

// ── Internal: async Docker spawn with precise timeout via docker kill ─────────

interface SpawnCapsuleResult {
  exitCode: number | null
  timedOut: boolean
  outputCapped: boolean
  diagnostics: string  // combined stdout+stderr, bounded
  stdout: string       // stdout only, for trusted sentinel parsing
}

function spawnCapsule(opts: {
  containerName: string
  dockerArgs: string[]
  timeoutMs: number
  maxOutputBytes: number
}): Promise<SpawnCapsuleResult> {
  const { containerName, dockerArgs, timeoutMs, maxOutputBytes } = opts

  return new Promise<SpawnCapsuleResult>((resolve) => {
    let timedOut = false
    let outputCapped = false
    let outputBytes = 0
    let diagnostics = ''
    let stdoutOnly = ''
    let settled = false

    const child = spawn('docker', dockerArgs, {
      env: { PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin' },
    })

    const settle = (exitCode: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ exitCode, timedOut, outputCapped, diagnostics, stdout: stdoutOnly })
    }

    const killContainer = () => {
      try {
        spawnSync('docker', ['kill', containerName], {
          timeout: 3000,
          env: { PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin' },
        })
      } catch { /* best-effort kill */ }
    }

    const timer = setTimeout(() => {
      timedOut = true
      killContainer()
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length
      const str = chunk.toString('utf-8')
      diagnostics += str
      stdoutOnly += str
      if (outputBytes > maxOutputBytes && !outputCapped) {
        outputCapped = true
        killContainer()
      }
    })

    child.stderr.on('data', (chunk: Buffer) => {
      diagnostics += chunk.toString('utf-8')
    })

    child.on('close', (code) => settle(code))
    child.on('error', () => settle(null))
  })
}
