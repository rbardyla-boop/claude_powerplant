import { describe, expect, it } from 'vitest'
import { ArtifactManifestSchema } from '../src/contracts/artifact-manifest.js'

const validManifest = {
  status: 'succeeded' as const,
  taskId: 'task-001',
  artifacts: {
    patch: 'artifacts/PATCH.diff',
    changedFiles: 'artifacts/CHANGED_FILES.md',
    verificationReport: 'artifacts/VERIFICATION_REPORT.md',
    adversarialReview: 'artifacts/ADVERSARIAL_REVIEW.md',
    sessionSummary: 'artifacts/SESSION_SUMMARY.json',
  },
  verificationCommands: [
    { command: 'npm test', result: 'passed' },
  ],
}

describe('ArtifactManifestSchema', () => {
  it('accepts a valid succeeded manifest', () => {
    const result = ArtifactManifestSchema.safeParse(validManifest)
    expect(result.success).toBe(true)
  })

  it('rejects manifest with missing artifacts fields', () => {
    const bad = {
      ...validManifest,
      artifacts: { patch: 'artifacts/PATCH.diff' },
    }
    const result = ArtifactManifestSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })

  it('rejects manifest with negative or missing taskId', () => {
    const bad = { ...validManifest, taskId: '' }
    const result = ArtifactManifestSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })

  it('rejects invalid verificationCommands entry missing command', () => {
    const bad = {
      ...validManifest,
      verificationCommands: [{ result: 'passed' }],
    }
    const result = ArtifactManifestSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })
})
