import { describe, it, expect } from 'vitest'
import { ProjectContractSchema } from '../src/projects/project-contract.js'

const validContract = {
  projectId: 'test-project',
  sourcePath: '/tmp/test',
  includePaths: ['src/**', 'package.json'],
  excludePaths: ['.env', '.git/**'],
  denyIfPresentAfterCopy: ['.env', '.git'],
  workspaceMode: 'sanitized_copy_only' as const,
  allowBash: true,
  realProjectMounted: false as const,
}

describe('ProjectContractSchema', () => {
  it('parses a valid contract', () => {
    const result = ProjectContractSchema.safeParse(validContract)
    expect(result.success).toBe(true)
  })

  it('rejects realProjectMounted: true', () => {
    const result = ProjectContractSchema.safeParse({
      ...validContract,
      realProjectMounted: true,
    })
    expect(result.success).toBe(false)
  })

  it('rejects workspaceMode other than sanitized_copy_only', () => {
    const result = ProjectContractSchema.safeParse({
      ...validContract,
      workspaceMode: 'full_mount',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty includePaths', () => {
    const result = ProjectContractSchema.safeParse({
      ...validContract,
      includePaths: [],
    })
    expect(result.success).toBe(false)
  })

  it('requires projectId to be non-empty', () => {
    const result = ProjectContractSchema.safeParse({
      ...validContract,
      projectId: '',
    })
    expect(result.success).toBe(false)
  })
})
