import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { getSkillAuditLogPath } from './skill-paths.js'
import type { SkillAuditEvent } from './skill-types.js'

// Distribute Omit over the discriminated union so each variant's specific fields are preserved.
type WithoutInfra<T> = Omit<T, 'eventId' | 'at'>
type AuditPayload =
  | WithoutInfra<Extract<SkillAuditEvent, { event: 'imported' }>>
  | WithoutInfra<Extract<SkillAuditEvent, { event: 'import-rejected' }>>
  | WithoutInfra<Extract<SkillAuditEvent, { event: 'evaluated' }>>
  | WithoutInfra<Extract<SkillAuditEvent, { event: 'promoted' }>>
  | WithoutInfra<Extract<SkillAuditEvent, { event: 'rolled-back' }>>
  | WithoutInfra<Extract<SkillAuditEvent, { event: 'quarantined' }>>

export function appendAuditEvent(payload: AuditPayload): SkillAuditEvent {
  // Spread is safe here: payload is a variant of AuditPayload which is a
  // subset of SkillAuditEvent minus the two infra fields we're adding.
  const event = {
    eventId: randomUUID(),
    at: new Date().toISOString(),
    ...(payload as object),
  } as SkillAuditEvent

  const auditPath = getSkillAuditLogPath()
  fs.mkdirSync(path.dirname(auditPath), { recursive: true })
  fs.appendFileSync(auditPath, JSON.stringify(event) + '\n', 'utf-8')

  return event
}
