import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { getPowerplantHome } from '../config/powerplant-home.js'

// ── Production state path ─────────────────────────────────────────────────────

const OPERATOR_STATE_FILENAME = 'project-operator.json'

export function operatorStatePath(): string {
  return path.join(getPowerplantHome(), 'state', 'managed-agents', OPERATOR_STATE_FILENAME)
}

export function quarantineDir(): string {
  return path.join(getPowerplantHome(), 'state', 'quarantine')
}

// ── Schema ────────────────────────────────────────────────────────────────────

export const OperatorStateSchema = z.object({
  schemaVersion: z.literal(1),
  resourcePurpose: z.literal('project-operator'),
  agent: z.object({
    id: z.string().min(1),
    version: z.number(),
    name: z.string(),
  }),
  environment: z.object({
    id: z.string().min(1),
    name: z.string(),
  }),
  toolSchemaVersion: z.number().int(),
  createdAt: z.string(),
  // Set by setup --repair after live API validation. null means unverified.
  validatedAt: z.string().nullable(),
})

export type OperatorState = z.infer<typeof OperatorStateSchema>

// ── Production ID validation ──────────────────────────────────────────────────

/**
 * Return true only if the resource ID matches Anthropic's production ID format.
 *
 * Real IDs: agent_01TwEqQhAxjicW3jmcyS7cPq, env_01RVPv347xgnbujjXFj721Uv
 * Mock IDs: agent-test, env-test, agent_test, my-agent
 *
 * Pattern: lowercase_prefix + underscore + 20+ alphanumeric characters.
 */
export function looksLikeProductionId(id: string): boolean {
  return /^[a-z]+_[A-Za-z0-9]{20,}$/.test(id)
}

export function isStatePlausible(state: OperatorState): boolean {
  return (
    looksLikeProductionId(state.agent.id) &&
    looksLikeProductionId(state.environment.id)
  )
}

export function isStateValidated(state: OperatorState): boolean {
  return isStatePlausible(state) && state.validatedAt !== null
}

// ── Load / save ───────────────────────────────────────────────────────────────

export function loadOperatorState(): OperatorState | null {
  const fp = operatorStatePath()
  if (!fs.existsSync(fp)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'))
    const result = OperatorStateSchema.safeParse(raw)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function saveOperatorState(state: OperatorState): void {
  const fp = operatorStatePath()
  fs.mkdirSync(path.dirname(fp), { recursive: true })
  fs.writeFileSync(fp, JSON.stringify(state, null, 2), 'utf-8')
}

// ── Quarantine ────────────────────────────────────────────────────────────────

export interface QuarantineRecord {
  quarantinedAt: string
  reason: string
  originalPath: string
  payload: unknown
}

/**
 * Move invalid state to the quarantine directory with a timestamp record.
 * The original state file is removed; the quarantine record is preserved for
 * audit purposes. Secrets are never stored in either location.
 */
export function quarantineOperatorState(reason: string): boolean {
  const fp = operatorStatePath()
  if (!fs.existsSync(fp)) return false

  let payload: unknown
  try {
    payload = JSON.parse(fs.readFileSync(fp, 'utf-8'))
  } catch {
    payload = null
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const qDir = path.join(quarantineDir(), ts)
  fs.mkdirSync(qDir, { recursive: true })

  const record: QuarantineRecord = {
    quarantinedAt: new Date().toISOString(),
    reason,
    originalPath: fp,
    payload,
  }
  fs.writeFileSync(
    path.join(qDir, 'quarantine-record.json'),
    JSON.stringify(record, null, 2),
    'utf-8',
  )
  fs.rmSync(fp)
  return true
}

/**
 * Quarantine a legacy state file (cloud-smoke.json or sprint4a-pilot.json) that
 * contains mock/invalid resource IDs.
 */
export function quarantineLegacyFile(filePath: string, reason: string): boolean {
  if (!fs.existsSync(filePath)) return false

  let payload: unknown
  try {
    payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    payload = null
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const basename = path.basename(filePath, '.json')
  const qDir = path.join(quarantineDir(), `${ts}-${basename}`)
  fs.mkdirSync(qDir, { recursive: true })

  const record: QuarantineRecord = {
    quarantinedAt: new Date().toISOString(),
    reason,
    originalPath: filePath,
    payload,
  }
  fs.writeFileSync(
    path.join(qDir, 'quarantine-record.json'),
    JSON.stringify(record, null, 2),
    'utf-8',
  )
  fs.rmSync(filePath)
  return true
}
