// Stage 2B P0-C — Isolated Oracle Evaluator
//
// Runs the immutable oracle against a synthetic workspace fixture in a subprocess.
// Enforces: subprocess isolation, timeout, output cap, workspace read-only, cleanup.
//
// Evaluator profile: subprocess-node-v1
// Network isolation: NOT proven by this evaluator — requires a capsule/container.
//   P0-C verdict is therefore STAGE_2B_LIVE_ACCEPTANCE_BLOCKED_PENDING_ORACLE_CAPSULE.
//
// hostExecutionOccurred is always false: agent-written code never runs in the
// Powerplant host process.  The subprocess is a separate OS process.

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { randomUUID } from 'crypto'
import {
  STAGE2B_PREFLIGHT_BASE,
  STAGE2B_PREFLIGHT_EVALUATOR_PROFILE_ID,
  STAGE2B_PREFLIGHT_CONTROL_POLICY_VERSION,
} from '../config/constants.js'
import { computeOracleHash } from './oracle-bundle.js'
import type { OracleBundleResult } from './oracle-bundle.js'

const MAX_OUTPUT_BYTES_DEFAULT = 65536  // 64 KB
const TIMEOUT_MS_DEFAULT = 5000

export interface EvaluatorReceipt {
  oracleRunId: string
  preflightId: string
  oracleSha256: string
  workspacePayloadHash: string
  evaluatorProfileId: string
  controlPolicyVersion: string
  hostExecutionOccurred: false
  terminalOracleStatus: 'PASS' | 'FAIL' | 'ERROR' | 'TIMEOUT' | 'OUTPUT_CAPPED' | 'IMPORT_ERROR'
  oracleResult: unknown
  boundedDiagnostics: string
  outputCapped: boolean
  outputExceededBuffer: boolean
  timeoutEnforced: boolean
  workspaceReadOnly: boolean
  networkIsolationProven: false
  cleanupComplete: boolean
  tamperCheckPassed: boolean
  fixtureLabel: string
  evaluatedAt: string
  controls: {
    subprocess_isolation: true
    timeout: true
    output_cap: true
    workspace_readonly: boolean
    network_isolation: false
    cleanup: boolean
  }
  unverifiedControls: ['network_isolation', 'full_filesystem_isolation']
}

function computePayloadHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex')
}

function chmodRecursive(dir: string, fileMode: number, dirMode: number): void {
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
}

function restoreWritable(dir: string): void {
  try {
    chmodRecursive(dir, 0o644, 0o755)
  } catch {
    // best-effort; cleanup may still succeed
  }
}

export function runOracleWithFixture(opts: {
  bundleResult: OracleBundleResult
  fixtureContent: string
  fixtureLabel: string
  preflightId: string
  timeoutMs?: number
  maxOutputBytes?: number
}): EvaluatorReceipt {
  const {
    bundleResult,
    fixtureContent,
    fixtureLabel,
    preflightId,
    timeoutMs = TIMEOUT_MS_DEFAULT,
    maxOutputBytes = MAX_OUTPUT_BYTES_DEFAULT,
  } = opts

  const oracleRunId = randomUUID()
  const runDir = path.join(STAGE2B_PREFLIGHT_BASE, preflightId, 'oracle-workspaces', oracleRunId)
  const workspaceDir = path.join(runDir, 'workspace')
  const outputFile = path.join(runDir, 'oracle-result.json')

  // Tamper-check the oracle before spawning
  const tamperCheck = computeOracleHash(bundleResult.bundledOraclePath)
  const tamperCheckPassed = tamperCheck === bundleResult.receipt.oracleSha256
  const workspacePayloadHash = computePayloadHash(fixtureContent)

  let terminalOracleStatus: EvaluatorReceipt['terminalOracleStatus'] = 'ERROR'
  let oracleResult: unknown = null
  let boundedDiagnostics = ''
  let outputCapped = false
  let outputExceededBuffer = false
  let timeoutEnforced = false
  let workspaceReadOnly = false
  let cleanupComplete = false

  try {
    // Create isolated workspace
    fs.mkdirSync(path.join(workspaceDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(workspaceDir, 'package.json'), JSON.stringify({ type: 'module' }))
    fs.writeFileSync(path.join(workspaceDir, 'src', 'status.js'), fixtureContent)

    // Write a writable output file location BEFORE making workspace read-only
    fs.writeFileSync(outputFile, '')

    // Make workspace read-only (dirs: r-xr-xr-x, files: r--r--r--)
    chmodRecursive(workspaceDir, 0o444, 0o555)
    workspaceReadOnly = true

    // Spawn oracle as subprocess — code under evaluation NEVER runs in host process
    const result = spawnSync(
      'node',
      [bundleResult.bundledOraclePath, workspaceDir, outputFile],
      {
        timeout: timeoutMs,
        maxBuffer: maxOutputBytes,
        encoding: 'utf-8',
      },
    )

    if (result.error) {
      const errCode = (result.error as NodeJS.ErrnoException).code
      if (errCode === 'ETIMEDOUT' || result.signal === 'SIGTERM') {
        timeoutEnforced = true
        terminalOracleStatus = 'TIMEOUT'
      } else if (errCode === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || errCode === 'ENOBUFS') {
        outputCapped = true
        outputExceededBuffer = true
        terminalOracleStatus = 'OUTPUT_CAPPED'
      } else {
        terminalOracleStatus = 'ERROR'
      }
      boundedDiagnostics = String(result.error).slice(0, 512)
    } else if (result.signal === 'SIGTERM' || result.signal === 'SIGKILL') {
      timeoutEnforced = true
      terminalOracleStatus = 'TIMEOUT'
      boundedDiagnostics = `Subprocess killed with signal ${result.signal}`
    } else {
      // Try to read the oracle result from the output file
      const rawDiag = (result.stdout ?? '').slice(0, 512) + (result.stderr ?? '').slice(0, 512)
      boundedDiagnostics = rawDiag

      if (result.stdout && result.stdout.length >= maxOutputBytes) {
        outputCapped = true
        outputExceededBuffer = true
        terminalOracleStatus = 'OUTPUT_CAPPED'
      } else {
        try {
          const raw = fs.readFileSync(outputFile, 'utf-8').trim()
          if (raw) {
            oracleResult = JSON.parse(raw)
            const parsed = oracleResult as { status?: string }
            if (parsed.status === 'PASS') terminalOracleStatus = 'PASS'
            else if (parsed.status === 'FAIL') terminalOracleStatus = 'FAIL'
            else terminalOracleStatus = 'ERROR'
          } else {
            terminalOracleStatus = 'ERROR'
          }
        } catch {
          terminalOracleStatus = 'ERROR'
        }
      }
    }
  } finally {
    // Restore permissions before cleanup
    restoreWritable(workspaceDir)
    try {
      fs.rmSync(runDir, { recursive: true, force: true })
      cleanupComplete = true
    } catch {
      cleanupComplete = false
    }
  }

  const receipt: EvaluatorReceipt = {
    oracleRunId,
    preflightId,
    oracleSha256: bundleResult.receipt.oracleSha256,
    workspacePayloadHash,
    evaluatorProfileId: STAGE2B_PREFLIGHT_EVALUATOR_PROFILE_ID,
    controlPolicyVersion: STAGE2B_PREFLIGHT_CONTROL_POLICY_VERSION,
    hostExecutionOccurred: false,
    terminalOracleStatus,
    oracleResult,
    boundedDiagnostics,
    outputCapped,
    outputExceededBuffer,
    timeoutEnforced,
    workspaceReadOnly,
    networkIsolationProven: false,
    cleanupComplete,
    tamperCheckPassed,
    fixtureLabel,
    evaluatedAt: new Date().toISOString(),
    controls: {
      subprocess_isolation: true,
      timeout: true,
      output_cap: true,
      workspace_readonly: workspaceReadOnly,
      network_isolation: false,
      cleanup: cleanupComplete,
    },
    unverifiedControls: ['network_isolation', 'full_filesystem_isolation'],
  }

  // Persist receipt to the preflight base for audit
  const receiptsDir = path.join(STAGE2B_PREFLIGHT_BASE, preflightId, 'receipts')
  fs.mkdirSync(receiptsDir, { recursive: true })
  fs.writeFileSync(path.join(receiptsDir, `${oracleRunId}.json`), JSON.stringify(receipt, null, 2))

  return receipt
}
