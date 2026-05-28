import { describe, it, expect } from 'vitest'
import {
  parseKeyPresence,
  classifyCredentialBoundary,
  selectBranchFromCredentials,
} from '../src/worker/credential-boundary.js'
import {
  SPRINT3U_K1_PRESENT,
  SPRINT3U_K1_ABSENT,
  SPRINT3U_K2_PRESENT,
  SPRINT3U_K2_ABSENT,
  SPRINT3U_K3_PRESENT,
  SPRINT3U_K3_ABSENT,
} from '../src/config/constants.js'

describe('parseKeyPresence', () => {
  it('returns PRESENT for K1 present token', () => {
    expect(parseKeyPresence(SPRINT3U_K1_PRESENT)).toBe('PRESENT')
  })

  it('returns ABSENT for K1 absent token', () => {
    expect(parseKeyPresence(SPRINT3U_K1_ABSENT)).toBe('ABSENT')
  })

  it('returns PRESENT for K2 present token', () => {
    expect(parseKeyPresence(SPRINT3U_K2_PRESENT)).toBe('PRESENT')
  })

  it('returns ABSENT for K2 absent token', () => {
    expect(parseKeyPresence(SPRINT3U_K2_ABSENT)).toBe('ABSENT')
  })

  it('returns PRESENT for K3 present token', () => {
    expect(parseKeyPresence(SPRINT3U_K3_PRESENT)).toBe('PRESENT')
  })

  it('returns ABSENT for K3 absent token', () => {
    expect(parseKeyPresence(SPRINT3U_K3_ABSENT)).toBe('ABSENT')
  })

  it('returns UNKNOWN for null (file not found)', () => {
    expect(parseKeyPresence(null)).toBe('UNKNOWN')
  })

  it('returns UNKNOWN for unrecognised content', () => {
    expect(parseKeyPresence('some unexpected value')).toBe('UNKNOWN')
  })

  it('trims whitespace before comparing', () => {
    expect(parseKeyPresence(`${SPRINT3U_K1_ABSENT}\n`)).toBe('ABSENT')
    expect(parseKeyPresence(`  ${SPRINT3U_K2_PRESENT}  `)).toBe('PRESENT')
  })
})

describe('classifyCredentialBoundary', () => {
  it('passes when all three keys are absent', () => {
    const result = classifyCredentialBoundary('ABSENT', 'ABSENT', 'ABSENT')
    expect(result.k1ApiKeyAbsent).toBe(true)
    expect(result.k2WorkerCanaryAbsent).toBe(true)
    expect(result.k3EnvironmentKeyAbsent).toBe(true)
    expect(result.toolExecutionInheritsWorkerEnvironment).toBe(false)
    expect(result.environmentKeyExposedToBashPresence).toBe(false)
    expect(result.credentialBoundaryPassed).toBe(true)
  })

  it('fails when K1 is present (API key in bash env)', () => {
    const result = classifyCredentialBoundary('PRESENT', 'ABSENT', 'ABSENT')
    expect(result.k1ApiKeyAbsent).toBe(false)
    expect(result.credentialBoundaryPassed).toBe(false)
  })

  it('fails when K2 is present (worker canary in bash env)', () => {
    const result = classifyCredentialBoundary('ABSENT', 'PRESENT', 'ABSENT')
    expect(result.k2WorkerCanaryAbsent).toBe(false)
    expect(result.toolExecutionInheritsWorkerEnvironment).toBe(true)
    expect(result.credentialBoundaryPassed).toBe(false)
  })

  it('fails when K3 is present (env key detectable in bash)', () => {
    const result = classifyCredentialBoundary('ABSENT', 'ABSENT', 'PRESENT')
    expect(result.k3EnvironmentKeyAbsent).toBe(false)
    expect(result.environmentKeyExposedToBashPresence).toBe(true)
    expect(result.credentialBoundaryPassed).toBe(false)
  })

  it('fails when all three are present', () => {
    const result = classifyCredentialBoundary('PRESENT', 'PRESENT', 'PRESENT')
    expect(result.credentialBoundaryPassed).toBe(false)
    expect(result.toolExecutionInheritsWorkerEnvironment).toBe(true)
    expect(result.environmentKeyExposedToBashPresence).toBe(true)
  })

  it('fails when any key is UNKNOWN', () => {
    const result = classifyCredentialBoundary('UNKNOWN', 'ABSENT', 'ABSENT')
    expect(result.credentialBoundaryPassed).toBe(false)
  })
})

describe('selectBranchFromCredentials', () => {
  it('returns A when credential boundary passes', () => {
    const result = classifyCredentialBoundary('ABSENT', 'ABSENT', 'ABSENT')
    expect(selectBranchFromCredentials(result)).toBe('A')
  })

  it('returns B when worker canary is inherited', () => {
    const result = classifyCredentialBoundary('ABSENT', 'PRESENT', 'ABSENT')
    expect(selectBranchFromCredentials(result)).toBe('B')
  })

  it('returns B when environment key is detectable', () => {
    const result = classifyCredentialBoundary('ABSENT', 'ABSENT', 'PRESENT')
    expect(selectBranchFromCredentials(result)).toBe('B')
  })
})
