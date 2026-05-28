import { describe, test, expect } from 'vitest'
import { SkillManifestSchema, SkillMemorySchema, SkillRegistryEntrySchema, SkillAuditEventSchema, SKILL_NAME_REGEX } from '../src/skills/skill-types.js'

const VALID_UUID = '00000000-0000-0000-0000-000000000001'
const VALID_DATETIME = '2026-05-28T00:00:00.000Z'

describe('SKILL_NAME_REGEX', () => {
  test('accepts single-segment lowercase names', () => {
    expect(SKILL_NAME_REGEX.test('skill')).toBe(true)
  })

  test('accepts multi-segment kebab names', () => {
    expect(SKILL_NAME_REGEX.test('my-skill')).toBe(true)
    expect(SKILL_NAME_REGEX.test('test-skill-v2')).toBe(true)
  })

  test('rejects names with uppercase', () => {
    expect(SKILL_NAME_REGEX.test('MySkill')).toBe(false)
    expect(SKILL_NAME_REGEX.test('MY-SKILL')).toBe(false)
  })

  test('rejects names with spaces', () => {
    expect(SKILL_NAME_REGEX.test('my skill')).toBe(false)
    expect(SKILL_NAME_REGEX.test('Invalid Name With Spaces')).toBe(false)
  })

  test('rejects names with leading or trailing hyphens', () => {
    expect(SKILL_NAME_REGEX.test('-skill')).toBe(false)
    expect(SKILL_NAME_REGEX.test('skill-')).toBe(false)
  })

  test('rejects names with consecutive hyphens', () => {
    expect(SKILL_NAME_REGEX.test('my--skill')).toBe(false)
  })

  test('rejects names with path separators', () => {
    expect(SKILL_NAME_REGEX.test('my/skill')).toBe(false)
    expect(SKILL_NAME_REGEX.test('my\\skill')).toBe(false)
  })

  test('rejects empty string', () => {
    expect(SKILL_NAME_REGEX.test('')).toBe(false)
  })
})

describe('SkillManifestSchema', () => {
  const validManifest = {
    schemaVersion: 1 as const,
    id: VALID_UUID,
    name: 'test-skill',
    version: 1,
    description: 'A test skill',
    tags: [],
    createdAt: VALID_DATETIME,
    promotedAt: null,
    sourceRunId: null,
    sha256: null,
    evaluationPassed: false,
    evaluationAt: null,
  }

  test('accepts a valid manifest with sha256: null', () => {
    expect(SkillManifestSchema.safeParse(validManifest).success).toBe(true)
  })

  test('accepts a valid sha256 hash string', () => {
    const withHash = { ...validManifest, sha256: 'a'.repeat(64) }
    expect(SkillManifestSchema.safeParse(withHash).success).toBe(true)
  })

  test('rejects an invalid sha256 (wrong length)', () => {
    const bad = { ...validManifest, sha256: 'abc123' }
    expect(SkillManifestSchema.safeParse(bad).success).toBe(false)
  })

  test('rejects an invalid sha256 (uppercase)', () => {
    const bad = { ...validManifest, sha256: 'A'.repeat(64) }
    expect(SkillManifestSchema.safeParse(bad).success).toBe(false)
  })

  test('rejects a non-kebab-case name', () => {
    const bad = { ...validManifest, name: 'Invalid Name' }
    expect(SkillManifestSchema.safeParse(bad).success).toBe(false)
  })

  test('rejects a non-UUID id', () => {
    const bad = { ...validManifest, id: 'not-a-uuid' }
    expect(SkillManifestSchema.safeParse(bad).success).toBe(false)
  })

  test('rejects version 0', () => {
    const bad = { ...validManifest, version: 0 }
    expect(SkillManifestSchema.safeParse(bad).success).toBe(false)
  })

  test('rejects missing required fields', () => {
    const { id: _id, ...withoutId } = validManifest
    expect(SkillManifestSchema.safeParse(withoutId).success).toBe(false)
  })

  test('rejects schemaVersion other than 1', () => {
    const bad = { ...validManifest, schemaVersion: 2 }
    expect(SkillManifestSchema.safeParse(bad).success).toBe(false)
  })
})

describe('SkillMemorySchema', () => {
  const validMemory = {
    schemaVersion: 1 as const,
    skillName: 'test-skill',
    validatedObservations: ['Works on projects with package.json'],
    knownFailures: [],
    pendingHypotheses: ['May improve monorepo tasks'],
  }

  test('accepts valid memory', () => {
    expect(SkillMemorySchema.safeParse(validMemory).success).toBe(true)
  })

  test('rejects invalid skillName', () => {
    const bad = { ...validMemory, skillName: 'Invalid Name' }
    expect(SkillMemorySchema.safeParse(bad).success).toBe(false)
  })

  test('rejects missing sections', () => {
    const { pendingHypotheses: _ph, ...withoutHypotheses } = validMemory
    expect(SkillMemorySchema.safeParse(withoutHypotheses).success).toBe(false)
  })
})

describe('SkillRegistryEntrySchema', () => {
  const validEntry = {
    name: 'test-skill',
    activeVersion: 2,
    candidateId: VALID_UUID,
    activatedAt: VALID_DATETIME,
    previousVersions: [
      { version: 1, candidateId: VALID_UUID, activatedAt: VALID_DATETIME },
    ],
  }

  test('accepts a valid registry entry', () => {
    expect(SkillRegistryEntrySchema.safeParse(validEntry).success).toBe(true)
  })

  test('rejects version 0', () => {
    const bad = { ...validEntry, activeVersion: 0 }
    expect(SkillRegistryEntrySchema.safeParse(bad).success).toBe(false)
  })
})

describe('SkillAuditEventSchema', () => {
  const baseFields = {
    eventId: VALID_UUID,
    at: VALID_DATETIME,
    command: 'powerplant skill import',
  }

  test('accepts imported event', () => {
    const event = {
      ...baseFields,
      event: 'imported' as const,
      candidateId: VALID_UUID,
      name: 'test-skill',
      contentHash: null,
    }
    expect(SkillAuditEventSchema.safeParse(event).success).toBe(true)
  })

  test('accepts import-rejected event with null candidateId (Gate 0)', () => {
    const event = {
      ...baseFields,
      event: 'import-rejected' as const,
      sourcePath: '/tmp/test-skill',
      failedGate: 'GATE_0',
      reason: 'Symlink not permitted',
      candidateId: null,
    }
    expect(SkillAuditEventSchema.safeParse(event).success).toBe(true)
  })

  test('accepts import-rejected event with candidateId (Gate 1)', () => {
    const event = {
      ...baseFields,
      event: 'import-rejected' as const,
      sourcePath: '/tmp/test-skill',
      failedGate: 'GATE_1',
      reason: 'SKILL.md is missing',
      candidateId: VALID_UUID,
    }
    expect(SkillAuditEventSchema.safeParse(event).success).toBe(true)
  })

  test('rejects an event with an unknown discriminant', () => {
    const event = { ...baseFields, event: 'unknown-event' }
    expect(SkillAuditEventSchema.safeParse(event).success).toBe(false)
  })
})
