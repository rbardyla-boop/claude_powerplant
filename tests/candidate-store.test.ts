import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { validateCandidateSchema } from '../src/skills/candidate-store.js'

const VALID_UUID = '00000000-0000-0000-0000-000000000001'
const VALID_MANIFEST = {
  schemaVersion: 1 as const,
  id: VALID_UUID,
  name: 'test-skill',
  version: 1,
  description: 'A test skill',
  tags: [],
  createdAt: '2026-05-28T00:00:00.000Z',
  promotedAt: null,
  sourceRunId: null,
  sha256: null,
  evaluationPassed: false,
  evaluationAt: null,
}

let tmpSnapshot: string

beforeEach(() => {
  tmpSnapshot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-snapshot-test-'))
})

afterEach(() => {
  fs.rmSync(tmpSnapshot, { recursive: true, force: true })
})

function writeSkillMd(content: string): void {
  fs.writeFileSync(path.join(tmpSnapshot, 'SKILL.md'), content, 'utf-8')
}

function writeManifest(obj: unknown): void {
  fs.writeFileSync(
    path.join(tmpSnapshot, 'manifest.json'),
    JSON.stringify(obj, null, 2),
    'utf-8'
  )
}

describe('validateCandidateSchema — reads from snapshot only', () => {
  test('accepts a valid snapshot with SKILL.md and manifest.json', async () => {
    writeSkillMd('# Test Skill\n')
    writeManifest(VALID_MANIFEST)

    const result = await validateCandidateSchema(tmpSnapshot, VALID_UUID)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.manifest.name).toBe('test-skill')
      expect(result.manifest.id).toBe(VALID_UUID)
      expect(result.manifest.sha256).toBeNull()
    }
  })

  test('overrides the id from manifest with the provided candidateId', async () => {
    writeSkillMd('# Test\n')
    const differentId = '00000000-0000-0000-0000-000000000099'
    writeManifest({ ...VALID_MANIFEST, id: differentId })

    const result = await validateCandidateSchema(tmpSnapshot, VALID_UUID)

    expect(result.success).toBe(true)
    if (result.success) {
      // candidateId parameter wins — the snapshot's id is replaced
      expect(result.manifest.id).toBe(VALID_UUID)
    }
  })

  test('fails when SKILL.md is missing', async () => {
    writeManifest(VALID_MANIFEST)

    const result = await validateCandidateSchema(tmpSnapshot, VALID_UUID)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toMatch(/SKILL\.md/i)
    }
  })

  test('fails when SKILL.md is empty', async () => {
    writeSkillMd('   ')
    writeManifest(VALID_MANIFEST)

    const result = await validateCandidateSchema(tmpSnapshot, VALID_UUID)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toMatch(/empty/i)
    }
  })

  test('fails when manifest.json is not valid JSON', async () => {
    writeSkillMd('# Test\n')
    fs.writeFileSync(path.join(tmpSnapshot, 'manifest.json'), '{ invalid json }', 'utf-8')

    const result = await validateCandidateSchema(tmpSnapshot, VALID_UUID)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toMatch(/not valid JSON/i)
    }
  })

  test('fails when manifest has an invalid name (not kebab-case)', async () => {
    writeSkillMd('# Test\n')
    writeManifest({ ...VALID_MANIFEST, name: 'Invalid Name' })

    const result = await validateCandidateSchema(tmpSnapshot, VALID_UUID)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toMatch(/kebab-case|validation failed/i)
    }
  })

  test('fails when manifest supplies a non-null sha256', async () => {
    writeSkillMd('# Test\n')
    writeManifest({ ...VALID_MANIFEST, sha256: 'a'.repeat(64) })

    const result = await validateCandidateSchema(tmpSnapshot, VALID_UUID)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toMatch(/sha256/i)
    }
  })

  test('fails when manifest is missing required fields', async () => {
    writeSkillMd('# Test\n')
    const { description: _d, ...withoutDescription } = VALID_MANIFEST
    writeManifest(withoutDescription)

    const result = await validateCandidateSchema(tmpSnapshot, VALID_UUID)

    expect(result.success).toBe(false)
  })
})

describe('validateCandidateSchema — no manifest.json (skeleton generation)', () => {
  test('builds a skeleton manifest from SKILL.md frontmatter', async () => {
    writeSkillMd(`---
name: frontmatter-skill
description: Derived from frontmatter.
tags: [test, qa]
---

# Frontmatter Skill

Some content.
`)

    const result = await validateCandidateSchema(tmpSnapshot, VALID_UUID)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.manifest.name).toBe('frontmatter-skill')
      expect(result.manifest.description).toBe('Derived from frontmatter.')
      expect(result.manifest.tags).toContain('test')
      expect(result.manifest.sha256).toBeNull()
      expect(result.manifest.evaluationPassed).toBe(false)
    }
  })

  test('skeleton manifest uses candidateId as the id', async () => {
    writeSkillMd('---\nname: some-skill\ndescription: test\ntags: []\n---\n# Test\n')

    const result = await validateCandidateSchema(tmpSnapshot, VALID_UUID)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.manifest.id).toBe(VALID_UUID)
    }
  })

  test('fails if frontmatter name is not kebab-case', async () => {
    writeSkillMd('---\nname: Bad Name Here\ndescription: test\ntags: []\n---\n# Test\n')

    const result = await validateCandidateSchema(tmpSnapshot, VALID_UUID)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toMatch(/kebab-case|valid/i)
    }
  })
})
