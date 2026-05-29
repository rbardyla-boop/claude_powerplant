// Stage 2B L1 — Fail-closed acceptance harness (non-live)
//
// Authorization: Stage 2B L1 Harness Trust-Boundary Repair Authorization — NO LIVE EXECUTION
//
// Enforcement boundaries:
//   - POWERPLANT_HOME must be a canonical descendant run directory inside
//     /tmp/powerplant-stage2b-acceptance/ — verified via realpathSync + path.relative
//   - Symlinks, traversal, relative paths, direct real-state paths rejected before
//     any registry or environment read
//   - Fixture A verified by immutable content hash from L0 receipt, not name only
//   - Duplicate/ambiguous active Fixture A entries rejected
//   - Pre/post real-state manifest equality enforced after every terminal exit path,
//     including pilot throw, oracle throw, and oracle-stage mutation
//   - Phase A/B timestamps validated (Phase A invocationTimestamp < Phase B sessionStartedAt)
//     in addition to JSONL line ordering
//   - Capsule image identity verified (capsuleImageIdentityVerified === true)
//   - Output-cap proof asserted (outputCapped === false for clean PASS)
//   - Independent workspace payload hash computed before oracle and compared to receipt
//   - Evaluator cleanup confirmed (cleanupComplete === true)
//   - builtinToolUseCount === 0 enforced
//   - Docker capsule oracle evaluation only (no host execution)
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

// ACCEPTANCE_HOME_PREFIX uses os.tmpdir() so the acceptance root is portable
// across environments where the OS temp root differs from /tmp (e.g. /tmp/claude-1000).
// Containment is preserved: the harness still requires POWERPLANT_HOME to be a
// strict descendant of this directory, symlink and traversal escapes still blocked.
export const ACCEPTANCE_HOME_PREFIX = path.join(os.tmpdir(), 'powerplant-stage2b-acceptance') + path.sep
const ACCEPTANCE_BASE_DIR = ACCEPTANCE_HOME_PREFIX.slice(0, -1)
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
  // Execution provenance — mapped from capsule receipt
  hostExecutionOccurred: false | null
  evaluatorCleanedUp: boolean | null
  capsuleImageIdentityVerified: boolean | null
  outputCapped: boolean | null
  // Workspace payload integrity
  workspacePayloadHash: string | null
  workspacePayloadHashVerified: boolean | null
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

// ── Public production interface — no injectable bypass seams ──────────────────

export interface L1HarnessPublicOpts {
  powerplantHome: string
  fixtureASkillId: string
  /** Expected content hash of Fixture A — must come from the L0 acceptance receipt */
  fixtureAContentHash: string
  pilotExecutor: L1PilotExecutor
}

// ── Internal interface — injectable seams for deterministic testing only ──────

export interface L1HarnessInternalOpts extends L1HarnessPublicOpts {
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

interface AuditPairEntry<T> {
  record: T
  lineIndex: number
  raw: Record<string, unknown>
}

interface AuditPair {
  phaseA: AuditPairEntry<SkillInvocationPhaseARecord> | null
  phaseB: AuditPairEntry<SkillInvocationPhaseBRecord> | null
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
        phaseA = { record: rec as unknown as SkillInvocationPhaseARecord, lineIndex: idx, raw: rec }
      }
      if (rec['phase'] === SKILL_INVOCATION_PHASE_B) {
        phaseB = { record: rec as unknown as SkillInvocationPhaseBRecord, lineIndex: idx, raw: rec }
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
    evaluatorCleanedUp: null,
    capsuleImageIdentityVerified: null,
    outputCapped: null,
    workspacePayloadHash: null,
    workspacePayloadHashVerified: null,
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

// ── Production entry point — no injectable seams ─────────────────────────────

export async function runL1Harness(opts: L1HarnessPublicOpts): Promise<L1HarnessResult> {
  return _runL1HarnessInternal(opts)
}

// ── Test-only entry point — injectable seams for deterministic tests ──────────

export async function _runL1HarnessForTesting(opts: L1HarnessInternalOpts): Promise<L1HarnessResult> {
  return _runL1HarnessInternal(opts)
}

// ── Core implementation ───────────────────────────────────────────────────────

async function _runL1HarnessInternal(opts: L1HarnessInternalOpts): Promise<L1HarnessResult> {
  const { powerplantHome, fixtureASkillId, fixtureAContentHash, pilotExecutor } = opts
  const evalOracle = opts.oracleEvaluator ?? defaultOracleEvaluator
  const stateRoot = opts._stateRootForTesting ?? path.join(os.homedir(), '.powerplant', 'state')

  // ── 1. POWERPLANT_HOME canonical containment check ───────────────────────────
  // Rejects empty paths, relative paths, non-existent targets, symlink escapes,
  // traversal escapes, and any path that resolves to or inside the real Powerplant home.
  // No registry read or session invocation may occur before containment is proven.

  if (!powerplantHome || !path.isAbsolute(powerplantHome)) {
    return blocked(
      `POWERPLANT_HOME must be a non-empty absolute path, got: ${powerplantHome || '(empty)'}`,
      { powerplantHome, fixtureASkillId },
    )
  }

  if (!fs.existsSync(ACCEPTANCE_BASE_DIR)) {
    return blocked(
      `L1 acceptance root ${ACCEPTANCE_BASE_DIR} does not exist — run L0 acceptance bootstrap first`,
      { powerplantHome, fixtureASkillId },
    )
  }

  let resolvedBase: string
  try {
    resolvedBase = fs.realpathSync(ACCEPTANCE_BASE_DIR)
  } catch {
    return blocked(
      `L1 acceptance root ${ACCEPTANCE_BASE_DIR} is not resolvable`,
      { powerplantHome, fixtureASkillId },
    )
  }

  let resolvedHome: string
  try {
    resolvedHome = fs.realpathSync(powerplantHome)
  } catch {
    return blocked(
      `POWERPLANT_HOME ${powerplantHome} does not exist or is not resolvable — symlinks or traversal rejected`,
      { powerplantHome, fixtureASkillId },
    )
  }

  // Must be a strict child of the acceptance root (path.relative returns non-empty, non-'..',  non-'.')
  const rel = path.relative(resolvedBase, resolvedHome)
  if (!rel || rel === '.' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return blocked(
      `POWERPLANT_HOME must be a descendant run directory strictly inside ${ACCEPTANCE_BASE_DIR}; ` +
      `resolved path escapes the acceptance root or equals it`,
      { powerplantHome, fixtureASkillId },
    )
  }

  // Must not resolve to or inside the protected real Powerplant home
  const realPPHome = path.join(os.homedir(), '.powerplant')
  let resolvedRealPPHome: string | null = null
  try { resolvedRealPPHome = fs.realpathSync(realPPHome) } catch { /* doesn't exist yet */ }
  if (resolvedRealPPHome !== null) {
    if (
      resolvedHome === resolvedRealPPHome ||
      resolvedHome.startsWith(resolvedRealPPHome + path.sep)
    ) {
      return blocked(
        `POWERPLANT_HOME resolves to or inside the protected real Powerplant home ${realPPHome}`,
        { powerplantHome, fixtureASkillId },
      )
    }
  }

  // ── 2. Fixture A registry check — hash-bound, no promoteSkill ────────────────
  // Must check expected hash before any registry is read.

  if (!fixtureAContentHash) {
    return blocked(
      'fixtureAContentHash is required — must be the immutable content hash from the L0 acceptance receipt',
      { powerplantHome, fixtureASkillId },
    )
  }

  let fixtureBlockReason: string | null = null
  let fixtureAFound = false
  const prevHome = process.env['POWERPLANT_HOME']
  try {
    process.env['POWERPLANT_HOME'] = powerplantHome
    const skills = listSkills()
    const activeMatches = skills.filter(s => s.name === fixtureASkillId && !s.isDisabled)
    if (activeMatches.length === 0) {
      fixtureBlockReason = `Fixture A "${fixtureASkillId}" not found or disabled in isolated registry — run acceptance-bootstrap first`
    } else if (activeMatches.length > 1) {
      fixtureBlockReason = `Duplicate ambiguous active Fixture A entries for "${fixtureASkillId}" in isolated registry`
    } else {
      const fixtureSkill = activeMatches[0]!
      if (fixtureSkill.contentHash !== fixtureAContentHash) {
        fixtureBlockReason = `Fixture A content hash mismatch: expected ${fixtureAContentHash}, got ${fixtureSkill.contentHash}`
      } else {
        fixtureAFound = true
      }
    }
  } finally {
    if (prevHome === undefined) delete process.env['POWERPLANT_HOME']
    else process.env['POWERPLANT_HOME'] = prevHome
  }

  if (fixtureBlockReason !== null) {
    return blocked(fixtureBlockReason, { powerplantHome, fixtureASkillId, fixtureAFound })
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

  // ── 5. Execute pilot via injected executor ─────────────────────────────────────
  // Post-manifest is computed in both success and throw paths.
  let pilotResult: L1PilotResult
  try {
    pilotResult = await pilotExecutor()
  } catch (err) {
    const postPilotManifestHash = computeStateManifestHash(stateRoot)
    const manifestUnchanged = preRunManifestHash === postPilotManifestHash
    if (!manifestUnchanged) {
      return blocked(
        'Real-state manifest changed during failed pilot execution — real Powerplant state root was mutated',
        {
          powerplantHome, fixtureASkillId, fixtureAFound,
          preRunManifestHash, postRunManifestHash: postPilotManifestHash, manifestUnchanged: false,
          preRunOracleHash, postRunOracleHash: preRunOracleHash, oracleHashUnchanged: true,
        },
      )
    }
    return {
      verdict: 'L1_HARNESS_FAILED',
      blockerReason: `Pilot executor threw: ${err instanceof Error ? err.message : String(err)}`,
      evidence: emptyEvidence({
        powerplantHome, fixtureASkillId, fixtureAFound,
        preRunOracleHash, postRunOracleHash: preRunOracleHash, oracleHashUnchanged: true,
        preRunManifestHash, postRunManifestHash: postPilotManifestHash, manifestUnchanged,
      }),
    }
  }

  const { report, builtinToolUseCount } = pilotResult

  // ── 6. Post-pilot real-state manifest check ────────────────────────────────────
  const postPilotManifestHash = computeStateManifestHash(stateRoot)
  const manifestAfterPilot = preRunManifestHash === postPilotManifestHash

  if (!manifestAfterPilot) {
    return blocked(
      'Real-state manifest changed during session — real Powerplant state root was mutated',
      {
        powerplantHome, fixtureASkillId, fixtureAFound,
        preRunManifestHash, postRunManifestHash: postPilotManifestHash, manifestUnchanged: false,
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
        preRunManifestHash, postRunManifestHash: postPilotManifestHash, manifestUnchanged: true,
        preRunOracleHash, postRunOracleHash, oracleHashUnchanged: false,
      },
    )
  }

  // ── 8. Built-in tool count ─────────────────────────────────────────────────────
  const builtinToolCountZero = builtinToolUseCount === 0

  const baseEvidence: Partial<L1HarnessEvidence> = {
    powerplantHome, fixtureASkillId, fixtureAFound,
    preRunManifestHash, postRunManifestHash: postPilotManifestHash, manifestUnchanged: true,
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

  // ── 9. Phase A/B audit record checks — line ordering ─────────────────────────
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

  // ── 10. Required Phase A field checks ──────────────────────────────────────────
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

  // ── 11. Timestamp-based ordering proof ─────────────────────────────────────────
  // JSONL line ordering alone is insufficient; timestamps must be validated.
  // Phase A invocationTimestamp must precede Phase B sessionStartedAt (broker session start).
  // This proves Phase A was recorded before the broker/session began.
  const phaseATimestamp = phaseA!.raw['invocationTimestamp']
  const phaseBTimestamp = phaseB!.raw['sessionStartedAt']

  if (typeof phaseATimestamp !== 'string' || !phaseATimestamp) {
    return failed('Phase A invocationTimestamp missing or not a string — required for temporal proof', emptyEvidence(withPhases))
  }
  const tsA = Date.parse(phaseATimestamp)
  if (isNaN(tsA)) {
    return failed(
      `Phase A invocationTimestamp "${phaseATimestamp}" is not parseable as ISO 8601`,
      emptyEvidence(withPhases),
    )
  }

  if (typeof phaseBTimestamp !== 'string' || !phaseBTimestamp) {
    return failed('Phase B sessionStartedAt missing — required for temporal ordering proof', emptyEvidence(withPhases))
  }
  const tsB = Date.parse(phaseBTimestamp)
  if (isNaN(tsB)) {
    return failed(
      `Phase B sessionStartedAt "${phaseBTimestamp}" is not parseable as ISO 8601`,
      emptyEvidence(withPhases),
    )
  }

  if (tsA >= tsB) {
    return failed(
      `Phase A invocationTimestamp (${phaseATimestamp}) does not precede Phase B sessionStartedAt (${phaseBTimestamp}) — temporal ordering proof failed`,
      emptyEvidence({ ...withPhases, phaseABeforePhaseB: false }),
    )
  }

  // ── 12. Phase B eligibility cross-check ────────────────────────────────────────
  const pB = phaseB!.record
  if (pB.patchEligibleForApplication !== report.patchEligibleForApplication) {
    return failed(
      `Phase B patchEligibleForApplication (${pB.patchEligibleForApplication}) disagrees with report (${report.patchEligibleForApplication})`,
      emptyEvidence(withPhases),
    )
  }

  // ── 13. Oracle evaluation — with independent workspace payload hash ─────────────
  const workspaceStatusPath = path.join(SPRINT4A_RUNTIME_BASE, report.runId, 'workspace', WORKSPACE_STATUS_REL)
  const patchedStatusContent = fs.existsSync(workspaceStatusPath)
    ? fs.readFileSync(workspaceStatusPath, 'utf-8')
    : ''

  // Independent hash computed BEFORE oracle receives the content
  const preOraclePayloadHash = crypto.createHash('sha256').update(patchedStatusContent, 'utf-8').digest('hex')

  const preflightId = randomUUID()
  let capsuleReceipt: CapsuleEvaluatorReceipt | null = null
  let oracleVerdict: string | null = null
  let postOracleManifestHash: string

  try {
    capsuleReceipt = await evalOracle({ patchedStatusContent, preflightId })
    oracleVerdict = capsuleReceipt.terminalOracleStatus
    postOracleManifestHash = computeStateManifestHash(stateRoot)
  } catch (err) {
    postOracleManifestHash = computeStateManifestHash(stateRoot)
    const manifestUnchanged = preRunManifestHash === postOracleManifestHash
    if (!manifestUnchanged) {
      return blocked(
        'Real-state manifest changed during oracle evaluation (oracle threw) — real Powerplant state root was mutated',
        {
          powerplantHome, fixtureASkillId, fixtureAFound,
          preRunManifestHash, postRunManifestHash: postOracleManifestHash, manifestUnchanged: false,
          preRunOracleHash, postRunOracleHash, oracleHashUnchanged: true,
        },
      )
    }
    return failed(
      `Oracle evaluation threw: ${err instanceof Error ? err.message : String(err)}`,
      emptyEvidence({
        ...withPhases,
        preRunManifestHash, postRunManifestHash: postOracleManifestHash, manifestUnchanged,
        capsuleReceipt: null, oracleVerdict: null,
      }),
    )
  }

  // Final manifest check — covers the complete run including oracle evaluation
  const finalManifestUnchanged = preRunManifestHash === postOracleManifestHash
  if (!finalManifestUnchanged) {
    return blocked(
      'Real-state manifest changed during oracle evaluation — real Powerplant state root was mutated',
      {
        powerplantHome, fixtureASkillId, fixtureAFound,
        preRunManifestHash, postRunManifestHash: postOracleManifestHash, manifestUnchanged: false,
        preRunOracleHash, postRunOracleHash, oracleHashUnchanged: true,
      },
    )
  }

  // Extract capsule receipt evidence fields
  const hostExecutionOccurred = capsuleReceipt!.candidateCodeExecutedOnHost
  const evaluatorCleanedUp = capsuleReceipt!.cleanupComplete
  const capsuleImageIdentityVerified = capsuleReceipt!.capsuleImageIdentityVerified
  const outputCapped = capsuleReceipt!.outputCapped
  const workspacePayloadHashFromReceipt = capsuleReceipt!.workspacePayloadHash
  const workspacePayloadHashVerified = preOraclePayloadHash === workspacePayloadHashFromReceipt

  const finalEvidence: L1HarnessEvidence = emptyEvidence({
    ...withPhases,
    preRunManifestHash, postRunManifestHash: postOracleManifestHash, manifestUnchanged: true,
    capsuleReceipt,
    hostExecutionOccurred,
    evaluatorCleanedUp,
    capsuleImageIdentityVerified,
    outputCapped,
    workspacePayloadHash: workspacePayloadHashFromReceipt,
    workspacePayloadHashVerified,
    oracleVerdict,
  })

  // ── 14. Capsule receipt assertion checks ────────────────────────────────────────
  if ((hostExecutionOccurred as unknown) !== false) {
    return failed('hostExecutionOccurred is not false on capsule receipt', finalEvidence)
  }
  if (!evaluatorCleanedUp) {
    return failed('evaluator cleanup not confirmed on receipt (cleanupComplete !== true)', finalEvidence)
  }
  if (!capsuleImageIdentityVerified) {
    return failed('capsule image identity verification failed (capsuleImageIdentityVerified !== true)', finalEvidence)
  }
  if (outputCapped) {
    return failed(
      'output was capped during oracle evaluation — oracle did not run to completion within output limits',
      finalEvidence,
    )
  }
  if (!workspacePayloadHashVerified) {
    return failed(
      `Independent workspace payload hash mismatch: computed ${preOraclePayloadHash}, receipt has ${workspacePayloadHashFromReceipt}`,
      finalEvidence,
    )
  }
  if (oracleVerdict !== 'PASS') {
    return failed(`Oracle verdict is "${oracleVerdict}" — required "PASS"`, finalEvidence)
  }

  return { verdict: 'L1_CANDIDATE_PASS', blockerReason: '', evidence: finalEvidence }
}
