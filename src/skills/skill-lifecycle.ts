import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getCandidatePath, getSkillRegistryPath } from './skill-paths.js'
import { appendAuditEvent } from './skill-audit.js'
import { SkillManifestSchema } from './skill-types.js'
import type { SkillManifest } from './skill-types.js'

// ── Internal registry types ───────────────────────────────────────────────────

interface SkillRegistryVersionEntry {
  version: number
  candidateId: string
  activatedAt: string
  contentHash: string
}

interface SkillRegistryRecord {
  name: string
  activeVersion: number
  candidateId: string
  activatedAt: string
  isDisabled: boolean
  contentHash: string
  previousVersions: SkillRegistryVersionEntry[]
}

interface SkillRegistry {
  schemaVersion: 1
  skills: Record<string, SkillRegistryRecord>
}

// ── Result types ──────────────────────────────────────────────────────────────

export interface ValidateSuccess {
  success: true
  candidateId: string
  contentHash: string
  name: string
}

export interface ValidateFailure {
  success: false
  candidateId: string | null
  reason: string
}

export type ValidateResult = ValidateSuccess | ValidateFailure

export interface PromoteSuccess {
  success: true
  name: string
  version: number
  contentHash: string
  candidateId: string
}

export interface PromoteFailure {
  success: false
  reason: string
}

export type PromoteResult = PromoteSuccess | PromoteFailure

export interface DisableSuccess {
  success: true
  name: string
  version: number
}

export interface DisableFailure {
  success: false
  reason: string
}

export type DisableResult = DisableSuccess | DisableFailure

export interface RollbackSuccess {
  success: true
  name: string
  toVersion: number
  fromVersion: number
}

export interface RollbackFailure {
  success: false
  reason: string
}

export type RollbackResult = RollbackSuccess | RollbackFailure

export interface SkillSummary {
  name: string
  activeVersion: number
  candidateId: string
  activatedAt: string
  isDisabled: boolean
  contentHash: string
}

export interface SkillInspection extends SkillSummary {
  manifest: SkillManifest
  skillMdContent: string
  previousVersions: SkillRegistryVersionEntry[]
}

// ── Registry I/O ─────────────────────────────────────────────────────────────

function loadRegistry(): SkillRegistry {
  const registryPath = getSkillRegistryPath()
  if (!fs.existsSync(registryPath)) {
    return { schemaVersion: 1, skills: {} }
  }
  try {
    const raw = fs.readFileSync(registryPath, 'utf-8')
    return JSON.parse(raw) as SkillRegistry
  } catch {
    return { schemaVersion: 1, skills: {} }
  }
}

function saveRegistry(registry: SkillRegistry): void {
  const registryPath = getSkillRegistryPath()
  fs.mkdirSync(path.dirname(registryPath), { recursive: true })
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf-8')
}

// ── Content hash computation (Gate 2) ────────────────────────────────────────
//
// Hashes all files in the snapshot EXCEPT manifest.json (which is Powerplant-written
// metadata). Files are walked in sorted order by relative path for determinism.
// Hash format: SHA-256 of "<relPath>:<fileContentHash>\n" lines joined.

export function computeSkillContentHash(snapshotPath: string): string {
  const entries: { relPath: string; fileHash: string }[] = []

  function walkSync(dir: string): void {
    const names = fs.readdirSync(dir).sort()
    for (const name of names) {
      const full = path.join(dir, name)
      const rel = path.relative(snapshotPath, full)
      // Skip manifest.json — it is Powerplant-managed metadata, not user content.
      if (rel === 'manifest.json') continue
      const stat = fs.statSync(full)
      if (stat.isDirectory()) {
        walkSync(full)
      } else if (stat.isFile()) {
        const content = fs.readFileSync(full)
        const fileHash = crypto.createHash('sha256').update(content).digest('hex')
        entries.push({ relPath: rel, fileHash })
      }
    }
  }

  walkSync(snapshotPath)

  const manifest = entries.map(e => `${e.relPath}:${e.fileHash}`).join('\n')
  return crypto.createHash('sha256').update(manifest, 'utf-8').digest('hex')
}

function readCandidateManifest(candidateId: string): SkillManifest | null {
  const candidatePath = getCandidatePath(candidateId)
  const manifestPath = path.join(candidatePath, 'manifest.json')
  if (!fs.existsSync(manifestPath)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    const parsed = SkillManifestSchema.safeParse(raw)
    if (!parsed.success) return null
    return parsed.data
  } catch {
    return null
  }
}

// ── Stage 1 lifecycle operations ─────────────────────────────────────────────

/**
 * Gate 2: compute and bind the SHA-256 content hash of an imported snapshot.
 *
 * Requires the candidate to have passed Gates 0 and 1 (sha256 === null in manifest).
 * On success, writes the computed hash to manifest.sha256 and emits an `evaluated` event.
 * The hash covers all files except manifest.json (Powerplant-managed metadata).
 */
export async function validateSkill(candidateId: string): Promise<ValidateResult> {
  const candidatePath = getCandidatePath(candidateId)

  if (!fs.existsSync(candidatePath)) {
    return { success: false, candidateId, reason: `Candidate ${candidateId} not found in candidates/` }
  }

  const manifest = readCandidateManifest(candidateId)
  if (!manifest) {
    return { success: false, candidateId, reason: 'Candidate manifest is missing or invalid' }
  }

  if (manifest.sha256 !== null) {
    return {
      success: false,
      candidateId,
      reason: `Candidate ${candidateId} is already validated (sha256 already computed)`,
    }
  }

  // Gate 2: compute content hash
  const contentHash = computeSkillContentHash(candidatePath)

  // Write hash to manifest
  const updatedManifest: SkillManifest = {
    ...manifest,
    sha256: contentHash,
    evaluationPassed: true,
    evaluationAt: new Date().toISOString(),
  }
  const manifestPath = path.join(candidatePath, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(updatedManifest, null, 2), 'utf-8')

  appendAuditEvent({
    event: 'evaluated',
    command: 'powerplant skill validate',
    candidateId,
    name: manifest.name,
    passed: true,
    failedGate: null,
    contentHash,
  })

  return { success: true, candidateId, contentHash, name: manifest.name }
}

/**
 * Bind the validated snapshot to the skill registry.
 *
 * Requires the candidate to have been validated (sha256 !== null in manifest).
 * Promotion binds to the exact content hash recorded at validation time.
 * Any byte-level mutation of the snapshot after this call invalidates invocation eligibility.
 */
export function promoteSkill(candidateId: string): PromoteResult {
  const manifest = readCandidateManifest(candidateId)
  if (!manifest) {
    return { success: false, reason: `Candidate ${candidateId} not found or manifest invalid` }
  }

  if (manifest.sha256 === null) {
    return {
      success: false,
      reason: `Candidate ${candidateId} has not been validated — run validateSkill first`,
    }
  }

  const contentHash = manifest.sha256
  const registry = loadRegistry()
  const existing = registry.skills[manifest.name]

  const now = new Date().toISOString()
  let version: number
  let previousVersions: SkillRegistryVersionEntry[]
  let priorActiveVersion: number | null = null

  if (existing) {
    priorActiveVersion = existing.activeVersion
    version = existing.activeVersion + 1
    // Archive the current active entry into previousVersions
    previousVersions = [
      ...existing.previousVersions,
      {
        version: existing.activeVersion,
        candidateId: existing.candidateId,
        activatedAt: existing.activatedAt,
        contentHash: existing.contentHash,
      },
    ]
  } else {
    version = 1
    previousVersions = []
  }

  registry.skills[manifest.name] = {
    name: manifest.name,
    activeVersion: version,
    candidateId,
    activatedAt: now,
    isDisabled: false,
    contentHash,
    previousVersions,
  }

  saveRegistry(registry)

  appendAuditEvent({
    event: 'promoted',
    command: 'powerplant skill promote',
    candidateId,
    name: manifest.name,
    version,
    priorActiveVersion,
    contentHash,
  })

  return { success: true, name: manifest.name, version, contentHash, candidateId }
}

/**
 * Disable the currently active version of a promoted skill.
 *
 * A disabled skill cannot be rendered as active guidance.
 * The skill entry remains in the registry and can be re-enabled via rollback.
 */
export function disableSkill(skillName: string): DisableResult {
  const registry = loadRegistry()
  const record = registry.skills[skillName]

  if (!record) {
    return { success: false, reason: `Skill "${skillName}" is not in the registry` }
  }

  if (record.isDisabled) {
    return { success: false, reason: `Skill "${skillName}" is already disabled` }
  }

  record.isDisabled = true
  saveRegistry(registry)

  appendAuditEvent({
    event: 'disabled',
    command: 'powerplant skill disable',
    name: skillName,
    version: record.activeVersion,
    candidateId: record.candidateId,
    contentHash: record.contentHash,
  })

  return { success: true, name: skillName, version: record.activeVersion }
}

/**
 * Restore a previously promoted exact version of a skill as the active version.
 *
 * Only versions that were previously promoted (have a recorded contentHash)
 * are eligible for rollback. The current active version is moved to previousVersions.
 */
export function rollbackSkill(skillName: string, toVersion: number): RollbackResult {
  const registry = loadRegistry()
  const record = registry.skills[skillName]

  if (!record) {
    return { success: false, reason: `Skill "${skillName}" is not in the registry` }
  }

  const targetIdx = record.previousVersions.findIndex(v => v.version === toVersion)
  if (targetIdx === -1) {
    return {
      success: false,
      reason: `Version ${toVersion} of skill "${skillName}" is not in previousVersions — only promoted versions can be restored`,
    }
  }

  const target = record.previousVersions[targetIdx]!
  const fromVersion = record.activeVersion
  const now = new Date().toISOString()

  // Archive the current active entry
  const currentArchiveEntry: SkillRegistryVersionEntry = {
    version: record.activeVersion,
    candidateId: record.candidateId,
    activatedAt: record.activatedAt,
    contentHash: record.contentHash,
  }

  // Remove the target from previousVersions, add current, restore target as active
  const remainingPrevious = record.previousVersions.filter((_, i) => i !== targetIdx)

  record.activeVersion = target.version
  record.candidateId = target.candidateId
  record.activatedAt = now
  record.isDisabled = false
  record.contentHash = target.contentHash
  record.previousVersions = [...remainingPrevious, currentArchiveEntry]

  saveRegistry(registry)

  appendAuditEvent({
    event: 'rolled-back',
    command: 'powerplant skill rollback',
    name: skillName,
    fromVersion,
    toVersion,
    reason: 'operator rollback',
  })

  return { success: true, name: skillName, fromVersion, toVersion }
}

/**
 * Return a summary of all registered skills.
 */
export function listSkills(): SkillSummary[] {
  const registry = loadRegistry()
  return Object.values(registry.skills).map(record => ({
    name: record.name,
    activeVersion: record.activeVersion,
    candidateId: record.candidateId,
    activatedAt: record.activatedAt,
    isDisabled: record.isDisabled,
    contentHash: record.contentHash,
  }))
}

/**
 * Return detailed information about a specific skill.
 *
 * Looks up by skill name (from registry). Returns null if the skill is not registered.
 */
export function inspectSkill(skillName: string): SkillInspection | null {
  const registry = loadRegistry()
  const record = registry.skills[skillName]
  if (!record) return null

  const manifest = readCandidateManifest(record.candidateId)
  if (!manifest) return null

  const candidatePath = getCandidatePath(record.candidateId)
  const skillMdPath = path.join(candidatePath, 'SKILL.md')
  let skillMdContent = ''
  try {
    skillMdContent = fs.readFileSync(skillMdPath, 'utf-8')
  } catch { /* best-effort */ }

  return {
    name: record.name,
    activeVersion: record.activeVersion,
    candidateId: record.candidateId,
    activatedAt: record.activatedAt,
    isDisabled: record.isDisabled,
    contentHash: record.contentHash,
    manifest,
    skillMdContent,
    previousVersions: record.previousVersions,
  }
}

