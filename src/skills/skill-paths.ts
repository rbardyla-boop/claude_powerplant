import path from 'path'
import { getPowerplantHome } from '../config/powerplant-home.js'

export function getSkillsDir(): string {
  return path.join(getPowerplantHome(), 'skills')
}

export function getCandidatesDir(): string {
  return path.join(getSkillsDir(), 'candidates')
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
