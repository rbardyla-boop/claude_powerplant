import { z } from 'zod'

// Skill name: lowercase kebab-case, no leading/trailing hyphens, no consecutive hyphens
export const SKILL_NAME_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

const skillNameSchema = z.string().regex(SKILL_NAME_REGEX, {
  message: 'Skill name must be lowercase kebab-case (e.g. my-skill)',
})

export const SkillManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  name: skillNameSchema,
  version: z.number().int().positive(),
  description: z.string().min(1),
  tags: z.array(z.string()),
  createdAt: z.string().datetime(),
  promotedAt: z.string().datetime().nullable(),
  sourceRunId: z.string().nullable(),
  // Powerplant computes this — never trust a value supplied by the imported package.
  // null until Gate 2 runs.
  sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  evaluationPassed: z.boolean(),
  evaluationAt: z.string().datetime().nullable(),
}).strict() // Reject unknown fields — prevents executable/shell-command/network fields

export type SkillManifest = z.infer<typeof SkillManifestSchema>

export const SkillMemorySchema = z.object({
  schemaVersion: z.literal(1),
  skillName: skillNameSchema,
  validatedObservations: z.array(z.string()),
  knownFailures: z.array(z.string()),
  // Never injected into prompts — requires explicit human promotion to validatedObservations.
  pendingHypotheses: z.array(z.string()),
})

export type SkillMemory = z.infer<typeof SkillMemorySchema>

export const SkillRegistryEntrySchema = z.object({
  name: skillNameSchema,
  activeVersion: z.number().int().positive(),
  candidateId: z.string().uuid(),
  activatedAt: z.string().datetime(),
  previousVersions: z.array(
    z.object({
      version: z.number().int().positive(),
      candidateId: z.string().uuid(),
      activatedAt: z.string().datetime(),
    })
  ),
})

export type SkillRegistryEntry = z.infer<typeof SkillRegistryEntrySchema>

// Each SkillAuditEvent variant carries eventId + at as required infrastructure fields.
// The appendAuditEvent() function generates these; callers provide only the payload.

const baseEvent = z.object({
  eventId: z.string().uuid(),
  at: z.string().datetime(),
  command: z.string(),
})

export const SkillAuditEventSchema = z.discriminatedUnion('event', [
  // Successful import — Gates 0 and 1 both passed.
  baseEvent.extend({
    event: z.literal('imported'),
    candidateId: z.string().uuid(),
    name: z.string(),
    contentHash: z.string().nullable(),
  }),

  // Import rejected at Gate 0 (no snapshot created) or Gate 1 (snapshot moved to quarantine).
  // candidateId is null for Gate 0 rejections.
  baseEvent.extend({
    event: z.literal('import-rejected'),
    sourcePath: z.string(),
    failedGate: z.string(),
    reason: z.string(),
    candidateId: z.string().uuid().nullable(),
  }),

  // Evaluation result after Gates 1-5.
  baseEvent.extend({
    event: z.literal('evaluated'),
    candidateId: z.string().uuid(),
    name: z.string(),
    passed: z.boolean(),
    failedGate: z.string().nullable(),
    contentHash: z.string(),
  }),

  // Successful promotion to validated/.
  baseEvent.extend({
    event: z.literal('promoted'),
    candidateId: z.string().uuid(),
    name: z.string(),
    version: z.number().int().positive(),
    priorActiveVersion: z.number().int().positive().nullable(),
    contentHash: z.string(),
  }),

  // Registry pointer moved back to a prior validated version.
  baseEvent.extend({
    event: z.literal('rolled-back'),
    name: z.string(),
    fromVersion: z.number().int().positive(),
    toVersion: z.number().int().positive(),
    reason: z.string(),
  }),

  // Candidate or active skill moved to quarantine/.
  baseEvent.extend({
    event: z.literal('quarantined'),
    candidateId: z.string().uuid(),
    name: z.string(),
    reason: z.string(),
    contentHash: z.string().nullable(),
  }),

  // Active skill version disabled by operator action.
  baseEvent.extend({
    event: z.literal('disabled'),
    name: z.string(),
    version: z.number().int().positive(),
    candidateId: z.string().uuid(),
    contentHash: z.string(),
  }),
])

export type SkillAuditEvent = z.infer<typeof SkillAuditEventSchema>
