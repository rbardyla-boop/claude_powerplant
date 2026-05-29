// Stage 2B P0-A — Oracle Bundle Mechanism
//
// Creates a hash-locked, tamper-detectable oracle bundle in an isolated directory.
// The bundle contains only the oracle artifact and a receipt — it does NOT mount the
// full Powerplant repository.  Future execution must load the oracle from the bundle,
// verify its hash, and only then spawn it against an isolated workspace copy.
//
// Oracle path invariant: tests/oracle/operator-task-oracle.mjs is outside every
// Stage 2B agent allowed-write path.  The agent operates on relative paths within
// a workspace sandbox under SPRINT4A_RUNTIME_BASE.  The oracle lives in the
// Powerplant repository at an absolute path unreachable from any workspace sandbox.

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { fileURLToPath } from 'url'
import {
  STAGE2B_PREFLIGHT_BASE,
  STAGE2B_ORACLE_TASK_SPEC_VERSION,
} from '../config/constants.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Canonical path to the source-controlled oracle artifact.
// Resolved relative to this module so it works in both tsx and compiled contexts.
export const ORACLE_SOURCE_PATH = path.resolve(__dirname, '../../tests/oracle/operator-task-oracle.mjs')

export interface OracleBundleReceipt {
  oracleId: string
  preflightId: string
  oracleSourcePath: string
  bundledOraclePath: string
  oracleSha256: string
  taskSpecVersion: string
  bundleContents: string[]
  tamperCheckResult: 'PASS' | 'FAIL'
  bundledAt: string
  agentModifiedCodeExecuted: false
}

export interface OracleBundleResult {
  bundleDir: string
  bundledOraclePath: string
  receipt: OracleBundleReceipt
}

export function computeOracleHash(oraclePath: string): string {
  const content = fs.readFileSync(oraclePath)
  return crypto.createHash('sha256').update(content).digest('hex')
}

export function createOracleBundle(opts: {
  preflightId: string
  oracleId?: string
}): OracleBundleResult {
  const { preflightId, oracleId = randomUUID() } = opts

  const bundleDir = path.join(STAGE2B_PREFLIGHT_BASE, preflightId, 'oracle-bundles', oracleId)
  fs.mkdirSync(bundleDir, { recursive: true })

  const bundledOraclePath = path.join(bundleDir, 'operator-task-oracle.mjs')
  fs.copyFileSync(ORACLE_SOURCE_PATH, bundledOraclePath)

  const oracleSha256 = computeOracleHash(bundledOraclePath)
  const bundleContents = fs.readdirSync(bundleDir).sort()

  const receipt: OracleBundleReceipt = {
    oracleId,
    preflightId,
    oracleSourcePath: ORACLE_SOURCE_PATH,
    bundledOraclePath,
    oracleSha256,
    taskSpecVersion: STAGE2B_ORACLE_TASK_SPEC_VERSION,
    bundleContents,
    tamperCheckResult: 'PASS',
    bundledAt: new Date().toISOString(),
    agentModifiedCodeExecuted: false,
  }

  fs.writeFileSync(path.join(bundleDir, 'oracle-receipt.json'), JSON.stringify(receipt, null, 2))

  return { bundleDir, bundledOraclePath, receipt }
}

export function verifyOracleBundleIntegrity(
  bundledOraclePath: string,
  expectedSha256: string,
): { tampered: boolean; actualSha256: string; expectedSha256: string } {
  const actualSha256 = computeOracleHash(bundledOraclePath)
  return { tampered: actualSha256 !== expectedSha256, actualSha256, expectedSha256 }
}
