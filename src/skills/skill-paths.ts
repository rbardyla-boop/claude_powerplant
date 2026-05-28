import path from 'path'
import { getPowerplantHome } from '../config/powerplant-home.js'

export function getSkillsDir(): string {
  return path.join(getPowerplantHome(), 'skills')
}

export function getCandidatesDir(): string {
  return path.join(getSkillsDir(), 'candidates')
}

// Powerplant-controlled staging directory. Skill packages are copied here during
// Gate 0/1 ingestion and are NOT yet visible as candidates. Only after both gates
// pass and the atomic rename succeeds does the package appear under candidates/.
export function getStagingDir(): string {
  return path.join(getSkillsDir(), '.staging')
}

export function getStagingPath(candidateId: string): string {
  return path.join(getStagingDir(), candidateId)
}

export function getValidatedDir(): string {
  return path.join(getSkillsDir(), 'validated')
}

export function getSkillQuarantineDir(): string {
  return path.join(getSkillsDir(), 'quarantine')
}

export function getSkillAuditLogPath(): string {
  return path.join(getPowerplantHome(), 'state', 'skill-audit.jsonl')
}

export function getSkillRegistryPath(): string {
  return path.join(getPowerplantHome(), 'state', 'skill-registry.json')
}

export function getCandidatePath(candidateId: string): string {
  return path.join(getCandidatesDir(), candidateId)
}

export function getSkillQuarantineCandidatePath(candidateId: string): string {
  return path.join(getSkillQuarantineDir(), candidateId)
}

// Powerplant-owned metadata file within a candidate directory.
// This is always distinct from any user-supplied manifest.json in the snapshot.
export function getCandidateMetaPath(candidateId: string): string {
  return path.join(getCandidatePath(candidateId), '.powerplant-meta.json')
}

// Reserved filename that must not appear in imported skill packages.
export const POWERPLANT_META_FILENAME = '.powerplant-meta.json' as const
