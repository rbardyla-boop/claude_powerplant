import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { SkillManifestSchema, SKILL_NAME_REGEX } from './skill-types.js'
import type { SkillManifest } from './skill-types.js'

// ── Result types ──────────────────────────────────────────────────────────────

export interface Gate1Success {
  success: true
  manifest: SkillManifest
}

export interface Gate1Failure {
  success: false
  reason: string
}

export type Gate1Result = Gate1Success | Gate1Failure

// ── YAML frontmatter extraction ───────────────────────────────────────────────

function extractFrontmatterField(content: string, field: string): string | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fmMatch || !fmMatch[1]) return null
  const block = fmMatch[1]
  const lineMatch = block.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'))
  if (!lineMatch || !lineMatch[1]) return null
  return lineMatch[1].trim()
}

function extractFrontmatterTags(content: string): string[] {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fmMatch || !fmMatch[1]) return []
  const block = fmMatch[1]
  // Support both inline `tags: [a, b]` and block list `tags:\n  - a`
  const inline = block.match(/^tags:\s*\[([^\]]*)\]/m)
  if (inline && inline[1] != null) {
    return inline[1].split(',').map(s => s.trim()).filter(Boolean)
  }
  const blockList = [...block.matchAll(/^  - (.+)$/gm)].map(m => m[1]?.trim() ?? '')
  return blockList.filter(Boolean)
}

// ── Gate 1: schema and identity validation ────────────────────────────────────

export async function validateCandidateSchema(
  snapshotPath: string,
  candidateId: string
): Promise<Gate1Result> {
  // All reads happen from snapshotPath — never from the original source.

  const skillMdPath = path.join(snapshotPath, 'SKILL.md')
  if (!fs.existsSync(skillMdPath)) {
    return { success: false, reason: 'SKILL.md is missing from the skill package' }
  }

  let skillMdContent: string
  try {
    skillMdContent = fs.readFileSync(skillMdPath, 'utf-8')
  } catch {
    return { success: false, reason: 'SKILL.md could not be read' }
  }

  if (skillMdContent.trim().length === 0) {
    return { success: false, reason: 'SKILL.md is empty' }
  }

  const manifestPath = path.join(snapshotPath, 'manifest.json')

  if (fs.existsSync(manifestPath)) {
    // Validate existing manifest.json.
    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    } catch {
      return { success: false, reason: 'manifest.json is not valid JSON' }
    }

    const parsed = SkillManifestSchema.safeParse(raw)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return {
        success: false,
        reason: `manifest.json validation failed: ${issue?.message ?? parsed.error.message} (at ${issue?.path.join('.') ?? 'root'})`,
      }
    }

    // Ensure sha256 is null — imported packages must not supply a trusted hash.
    // Gate 2 will compute and write the real hash.
    const manifest = parsed.data
    if (manifest.sha256 !== null) {
      return {
        success: false,
        reason:
          'manifest.json must not supply sha256 — Powerplant computes this at Gate 2. Set sha256 to null.',
      }
    }

    return { success: true, manifest: { ...manifest, id: candidateId } }
  }

  // No manifest.json — build a skeleton from SKILL.md frontmatter.
  const fmName = extractFrontmatterField(skillMdContent, 'name')
  const fmDescription = extractFrontmatterField(skillMdContent, 'description')
  const fmTags = extractFrontmatterTags(skillMdContent)

  const skillName = fmName ?? path.basename(snapshotPath)
  if (!SKILL_NAME_REGEX.test(skillName)) {
    return {
      success: false,
      reason: `Derived skill name "${skillName}" is not valid kebab-case. Add a name field to SKILL.md frontmatter.`,
    }
  }

  const firstLine = skillMdContent.trim().split('\n')[0] ?? ''
  const description = fmDescription ?? firstLine.replace(/^#+\s*/, '')
  if (!description) {
    return { success: false, reason: 'Cannot derive description from SKILL.md — add a description field to frontmatter.' }
  }

  const skeletonManifest: SkillManifest = {
    schemaVersion: 1,
    id: candidateId,
    name: skillName,
    version: 1,
    description,
    tags: fmTags,
    createdAt: new Date().toISOString(),
    promotedAt: null,
    sourceRunId: null,
    sha256: null,
    evaluationPassed: false,
    evaluationAt: null,
  }

  return { success: true, manifest: skeletonManifest }
}
