// Stage 2B L1 — Fail-closed acceptance harness (non-live)
//
// Authorization: Stage 2B L1 Harness Implementation Authorization — NO LIVE EXECUTION
//
// Enforcement boundaries:
//   - POWERPLANT_HOME must be under /tmp/powerplant-stage2b-acceptance/
//   - Fixture A must already be in the isolated registry (no promoteSkill invoked here)
//   - Pre/post real-state manifest equality enforced
//   - Pre/post oracle SHA equality enforced
//   - builtinToolUseCount === 0 enforced
//   - Phase A before Phase B in audit JSONL enforced
//   - Docker capsule oracle evaluation only (no host execution)
//   - hostExecutionOccurred === false required on receipt
//   - capsule cleanup required on receipt
//   - Any missing or contradictory evidence → fails closed
//
// FORBIDDEN by this authorization:
//   - Calling the Anthropic Managed Agent API
//   - Creating a live session
//   - Using ANTHROPIC_API_KEY for execution
//   - Invoking promoteSkill

import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import {
  SPRINT4A_RUNTIME_BASE,
  SKILL_INVOCATION_PHASE_A,
  SKILL_INVOCATION_PHASE_B,
} from '../src/config/constants.js'
import { listSkills } from '../src/skills/skill-lifecycle.js'
import {
  ORACLE_SOURCE_PATH,
  computeOracleHash,
  createOracleBundle,
} from '../src/preflight/oracle-bundle.js'
import { runOracleInCapsule } from '../src/preflight/capsule-evaluator.js'
import type { CapsuleEvaluatorReceipt } from '../src/preflight/capsule-evaluator.js'
import type { SkillGuidedRunReport } from '../src/sessions/run-skill-guided-sanitized-project-pilot.js'
import type {
  SkillInvocationPhaseARecord,
  SkillInvocationPhaseBRecord,
} from '../src/skills/skill-invocation-audit.js'

// ── Constants ─────────────────────────────────────────────────────────────────

export const ACCEPTANCE_HOME_PREFIX = '/tmp/powerplant-stage2b-acceptance/'
const REQUIRED_COMPOSITION_POLICY = 'task-first-guidance-supplementary-v1'
const WORKSPACE_STATUS_REL = path.join('src', 'status.js')

// ── Injection interfaces ──────────────────────────────────────────────────────

export interface L1PilotResult {
  report: SkillGuidedRunReport
  /** builtinToolUseCount from the broker session — not exposed on SkillGuidedRunReport */
  builtinToolUseCount: number
}

export type L1PilotExecutor = () => Promise<L1PilotResult>

export type L1OracleEvaluator = (opts: {
  patchedStatusContent: string
  preflightId: string
}) => Promise<CapsuleEvaluatorReceipt>

// ── Evidence and result types ─────────────────────────────────────────────────

export interface L1HarnessEvidence {
  powerplantHome: string
  fixtureASkillId: string
  fixtureAFound: boolean
  preRunManifestHash: string
  postRunManifestHash: string
  manifestUnchanged: boolean
  preRunOracleHash: string
  postRunOracleHash: string
  oracleHashUnchanged: boolean
  builtinToolUseCount: number
  builtinToolCountZero: boolean
  operatorTaskHash: string | null
  envelopeHash: string | null
  compositionPolicyVersion: string | null
  patchEligibleForApplication: boolean | null
  phaseAPresent: boolean
  phaseBPresent: boolean
  phaseABeforePhaseB: boolean
  capsuleReceipt: CapsuleEvaluatorReceipt | null
  hostExecutionOccurred: false | null
  capsuleCleanedUp: boolean | null
  oracleVerdict: string | null
}

export type L1HarnessVerdict =
  | 'L1_CANDIDATE_PASS'
  | 'L1_HARNESS_FAILED'
  | 'L1_HARNESS_BLOCKED'

export interface L1HarnessResult {
  verdict: L1HarnessVerdict
  blockerReason: string
  evidence: L1HarnessEvidence
}

export interface L1HarnessOpts {
  powerplantHome: string
  fixtureASkillId: string
  pilotExecutor: L1PilotExecutor
  oracleEvaluator?: L1OracleEvaluator
  /** For deterministic tests only — overrides real ~/.powerplant/state/ */
  _stateRootForTesting?: string
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function computeStateManifestHash(stateDir: string): string {
  if (!fs.existsSync(stateDir)) return 'EMPTY'
  const entries: Array<{ rel: string; hash: string }> = []

  function walk(dir: string, base: string): void {
    const names = (() => {
      try { return fs.readdirSync(dir).sort() }
      catch { return [] as string[] }
    })()
    for (const name of names) {
      const full = path.join(dir, name)
      const rel = path.relative(base, full)
      try {
        if (fs.statSync(full).isDirectory()) {
          walk(full, base)
        } else {
          const content = fs.readFileSync(full)
          entries.push({ rel, hash: crypto.createHash('sha256').update(content).digest('hex') })
        }
      } catch { /* skip unreadable files */ }
    }
  }

  walk(stateDir, stateDir)
  if (entries.length === 0) return 'EMPTY'
  const manifest = entries.map(e => `${e.rel}:${e.hash}`).join('\n')
  return crypto.createHash('sha256').update(manifest, 'utf-8').digest('hex')
}

interface AuditPair {
  phaseA: { record: SkillInvocationPhaseARecord; lineIndex: number } | null
  phaseB: { record: SkillInvocationPhaseBRecord; lineIndex: number } | null
}

function readAuditPair(auditPath: string, invocationId: string): AuditPair {
  if (!fs.existsSync(auditPath)) return { phaseA: null, phaseB: null }

  let phaseA: AuditPair['phaseA'] = null
  let phaseB: AuditPair['phaseB'] = null

  const raw = fs.readFileSync(auditPath, 'utf-8').trim()
  raw.split('\n').filter(Boolean).forEach((line, idx) => {
    try {
      const rec = JSON.parse(line) as Record<string, unknown>
      if (rec['invocationId'] !== invocationId) return
      if (rec['phase'] === SKILL_INVOCATION_PHASE_A) {
        phaseA = { record: rec as unknown as SkillInvocationPhaseARecord, lineIndex: idx }
      }
      if (rec['phase'] === SKILL_INVOCATION_PHASE_B) {
        phaseB = { record: rec as unknown as SkillInvocationPhaseBRecord, lineIndex: idx }
      }
    } catch { /* skip malformed lines */ }
  })

  return { phaseA, phaseB }
}

async function defaultOracleEvaluator(opts: {
  patchedStatusContent: string
  preflightId: string
}): Promise<CapsuleEvaluatorReceipt> {
  const bundleResult = createOracleBundle({ preflightId: opts.preflightId })
  return runOracleInCapsule({
    bundleResult,
    fixtureContent: opts.patchedStatusContent,
    fixtureLabel: 'l1-acceptance',
    preflightId: opts.preflightId,
  })
}

function emptyEvidence(partial: Partial<L1HarnessEvidence> = {}): L1HarnessEvidence {
  return {
    powerplantHome: '',
    fixtureASkillId: '',
    fixtureAFound: false,
    preRunManifestHash: '',
    postRunManifestHash: '',
    manifestUnchanged: false,
    preRunOracleHash: '',
    postRunOracleHash: '',
    oracleHashUnchanged: false,
    builtinToolUseCount: -1,
    builtinToolCountZero: false,
    operatorTaskHash: null,
    envelopeHash: null,
    compositionPolicyVersion: null,
    patchEligibleForApplication: null,
    phaseAPresent: false,
    phaseBPresent: false,
    phaseABeforePhaseB: false,
    capsuleReceipt: null,
    hostExecutionOccurred: null,
    capsuleCleanedUp: null,
    oracleVerdict: null,
    ...partial,
  }
}

function blocked(reason: string, partial: Partial<L1HarnessEvidence> = {}): L1HarnessResult {
  return { verdict: 'L1_HARNESS_BLOCKED', blockerReason: reason, evidence: emptyEvidence(partial) }
}

function failed(reason: string, evidence: L1HarnessEvidence): L1HarnessResult {
  return { verdict: 'L1_HARNESS_FAILED', blockerReason: reason, evidence }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runL1Harness(opts: L1HarnessOpts): Promise<L1HarnessResult> {
  const { powerplantHome, fixtureASkillId, pilotExecutor } = opts
  const evalOracle = opts.oracleEvaluator ?? defaultOracleEvaluator
  const stateRoot = opts._stateRootForTesting ?? path.join(os.homedir(), '.powerplant', 'state')

  // ── 1. POWERPLANT_HOME prefix guard ──────────────────────────────────────────
  if (!powerplantHome || !powerplantHome.startsWith(ACCEPTANCE_HOME_PREFIX)) {
    return blocked(
      `POWERPLANT_HOME must start with ${ACCEPTANCE_HOME_PREFIX}, got: ${powerplantHome || '(empty)'}`,
      { powerplantHome, fixtureASkillId },
    )
  }

  // ── 2. Fixture A registry check — no promoteSkill ─────────────────────────────
  const prevHome = process.env['POWERPLANT_HOME']
  let fixtureAFound = false
  try {
    process.env['POWERPLANT_HOME'] = powerplantHome
    const skills = listSkills()
    fixtureAFound = skills.some(s => s.name === fixtureASkillId && !s.isDisabled)
  } finally {
    if (prevHome === undefined) delete process.env['POWERPLANT_HOME']
    else process.env['POWERPLANT_HOME'] = prevHome
  }

  if (!fixtureAFound) {
    return blocked(
      `Fixture A "${fixtureASkillId}" not found (or disabled) in isolated registry under ${powerplantHome} — run acceptance-bootstrap first`,
      { powerplantHome, fixtureASkillId, fixtureAFound },
    )
  }

  // ── 3. Oracle file hash (pre-run) ─────────────────────────────────────────────
  let preRunOracleHash: string
  try {
    preRunOracleHash = computeOracleHash(ORACLE_SOURCE_PATH)
  } catch {
    return blocked(
      `Oracle file not found or unreadable: ${ORACLE_SOURCE_PATH}`,
      { powerplantHome, fixtureASkillId, fixtureAFound },
    )
  }

  // ── 4. Real-state manifest hash (pre-run) ─────────────────────────────────────
  const preRunManifestHash = computeStateManifestHash(stateRoot)

  // ── 5. Execute pilot via injected executor ────────────────────────────────────
  let pilotResult: L1PilotResult
  try {
    pilotResult = await pilotExecutor()
  } catch (err) {
    return {
      verdict: 'L1_HARNESS_FAILED',
      blockerReason: `Pilot executor threw: ${err instanceof Error ? err.message : String(err)}`,
      evidence: emptyEvidence({
        powerplantHome, fixtureASkillId, fixtureAFound,
        preRunOracleHash, postRunOracleHash: '', oracleHashUnchanged: false,
        preRunManifestHash, postRunManifestHash: '', manifestUnchanged: false,
      }),
    }
  }

  const { report, builtinToolUseCount } = pilotResult

  // ── 6. Post-run real-state manifest check ─────────────────────────────────────
  const postRunManifestHash = computeStateManifestHash(stateRoot)
  const manifestUnchanged = preRunManifestHash === postRunManifestHash

  if (!manifestUnchanged) {
    return blocked(
      'Real-state manifest changed during session — real Powerplant state root was mutated',
      {
        powerplantHome, fixtureASkillId, fixtureAFound,
        preRunManifestHash, postRunManifestHash, manifestUnchanged: false,
        preRunOracleHash, postRunOracleHash: preRunOracleHash, oracleHashUnchanged: true,
      },
    )
  }

  // ── 7. Post-run oracle hash check ─────────────────────────────────────────────
  let postRunOracleHash: string
  try {
    postRunOracleHash = computeOracleHash(ORACLE_SOURCE_PATH)
  } catch {
    postRunOracleHash = 'ERROR_UNREADABLE'
  }
  const oracleHashUnchanged = preRunOracleHash === postRunOracleHash

  if (!oracleHashUnchanged) {
    return blocked(
      'Oracle file hash changed during session — oracle may have been tampered with',
      {
        powerplantHome, fixtureASkillId, fixtureAFound,
        preRunManifestHash, postRunManifestHash, manifestUnchanged: true,
        preRunOracleHash, postRunOracleHash, oracleHashUnchanged: false,
      },
    )
  }

  // ── 8. Built-in tool count ────────────────────────────────────────────────────
  const builtinToolCountZero = builtinToolUseCount === 0

  const baseEvidence: Partial<L1HarnessEvidence> = {
    powerplantHome, fixtureASkillId, fixtureAFound,
    preRunManifestHash, postRunManifestHash, manifestUnchanged: true,
    preRunOracleHash, postRunOracleHash, oracleHashUnchanged: true,
    builtinToolUseCount, builtinToolCountZero,
    operatorTaskHash: report.operatorTaskHash,
    envelopeHash: report.envelopeHash,
    compositionPolicyVersion: report.compositionPolicyVersion,
    patchEligibleForApplication: report.patchEligibleForApplication,
  }

  if (!builtinToolCountZero) {
    return failed(
      `Non-broker tool use detected: builtinToolUseCount=${builtinToolUseCount}`,
      emptyEvidence(baseEvidence),
    )
  }

  // ── 9. Phase A/B audit record checks ─────────────────────────────────────────
  const { phaseA, phaseB } = readAuditPair(report.auditRecordPath, report.invocationId)
  const phaseAPresent = phaseA !== null
  const phaseBPresent = phaseB !== null
  const phaseABeforePhaseB = phaseAPresent && phaseBPresent
    ? phaseA!.lineIndex < phaseB!.lineIndex
    : false

  const withPhases: Partial<L1HarnessEvidence> = { ...baseEvidence, phaseAPresent, phaseBPresent, phaseABeforePhaseB }

  if (!phaseAPresent) return failed('Phase A record missing from audit JSONL', emptyEvidence(withPhases))
  if (!phaseBPresent) return failed('Phase B record missing from audit JSONL', emptyEvidence(withPhases))
  if (!phaseABeforePhaseB) return failed('Phase A does not precede Phase B in audit JSONL', emptyEvidence(withPhases))

  // ── 10. Required Phase A field checks ────────────────────────────────────────
  const pA = phaseA!.record
  if (!pA.operatorTaskHash) {
    return failed('operatorTaskHash missing from Phase A record', emptyEvidence(withPhases))
  }
  const envelopeHashFromAudit = pA.invokedSkills[0]?.envelopeHash
  if (!envelopeHashFromAudit) {
    return failed('envelopeHash missing from Phase A invokedSkills[0]', emptyEvidence(withPhases))
  }
  if (pA.compositionPolicyVersion !== REQUIRED_COMPOSITION_POLICY) {
    return failed(
      `compositionPolicyVersion mismatch: expected "${REQUIRED_COMPOSITION_POLICY}", got "${pA.compositionPolicyVersion}"`,
      emptyEvidence(withPhases),
    )
  }

  // ── 11. Phase B eligibility cross-check ──────────────────────────────────────
  const pB = phaseB!.record
  if (pB.patchEligibleForApplication !== report.patchEligibleForApplication) {
    return failed(
      `Phase B patchEligibleForApplication (${pB.patchEligibleForApplication}) disagrees with report (${report.patchEligibleForApplication})`,
      emptyEvidence(withPhases),
    )
  }

  // ── 12. Oracle evaluation ─────────────────────────────────────────────────────
  const workspaceStatusPath = path.join(SPRINT4A_RUNTIME_BASE, report.runId, 'workspace', WORKSPACE_STATUS_REL)
  const patchedStatusContent = fs.existsSync(workspaceStatusPath)
    ? fs.readFileSync(workspaceStatusPath, 'utf-8')
    : ''

  const preflightId = randomUUID()
  let capsuleReceipt: CapsuleEvaluatorReceipt | null = null
  let oracleVerdict: string | null = null

  try {
    capsuleReceipt = await evalOracle({ patchedStatusContent, preflightId })
    oracleVerdict = capsuleReceipt.terminalOracleStatus
  } catch (err) {
    return failed(
      `Oracle evaluation threw: ${err instanceof Error ? err.message : String(err)}`,
      emptyEvidence({ ...withPhases, capsuleReceipt: null, oracleVerdict: null }),
    )
  }

  const hostExecutionOccurred = capsuleReceipt.candidateCodeExecutedOnHost
  const capsuleCleanedUp = capsuleReceipt.cleanupComplete

  const finalEvidence: L1HarnessEvidence = emptyEvidence({
    ...withPhases,
    capsuleReceipt,
    hostExecutionOccurred,
    capsuleCleanedUp,
    oracleVerdict,
  })

  // hostExecutionOccurred is typed false on the receipt but validate it defensively
  if ((hostExecutionOccurred as unknown) !== false) {
    return failed('hostExecutionOccurred is not false on capsule receipt', finalEvidence)
  }
  if (!capsuleCleanedUp) {
    return failed('capsule cleanup not confirmed on receipt (cleanupComplete !== true)', finalEvidence)
  }
  if (oracleVerdict !== 'PASS') {
    return failed(`Oracle verdict is "${oracleVerdict}" — required "PASS"`, finalEvidence)
  }
  if (report.patchEligibleForApplication && oracleVerdict !== 'PASS') {
    // Redundant guard — belt-and-suspenders for the broker-eligible-but-oracle-fail case
    return failed(
      'patchEligibleForApplication === true but oracle verdict is not PASS',
      finalEvidence,
    )
  }

  return { verdict: 'L1_CANDIDATE_PASS', blockerReason: '', evidence: finalEvidence }
}
