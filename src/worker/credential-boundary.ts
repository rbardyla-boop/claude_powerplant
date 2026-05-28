import {
  SPRINT3U_K1_PRESENT,
  SPRINT3U_K1_ABSENT,
  SPRINT3U_K2_PRESENT,
  SPRINT3U_K2_ABSENT,
  SPRINT3U_K3_PRESENT,
  SPRINT3U_K3_ABSENT,
} from '../config/constants.js'

export type KeyPresence = 'PRESENT' | 'ABSENT' | 'UNKNOWN'

export interface CredentialBoundaryResult {
  /** ANTHROPIC_API_KEY was absent from bash subprocess env */
  k1ApiKeyAbsent: boolean
  /** Non-ANTHROPIC_ worker canary was absent from bash subprocess env */
  k2WorkerCanaryAbsent: boolean
  /** ANTHROPIC_ENVIRONMENT_KEY was absent from bash subprocess env */
  k3EnvironmentKeyAbsent: boolean
  /** Whether bash tool execution inherits arbitrary worker env vars */
  toolExecutionInheritsWorkerEnvironment: boolean
  /** Whether bash can detect ANTHROPIC_ENVIRONMENT_KEY presence */
  environmentKeyExposedToBashPresence: boolean
  /** Whether all credential probes passed */
  credentialBoundaryPassed: boolean
}

/** Parse raw file content written by the K-probe bash commands. */
export function parseKeyPresence(raw: string | null): KeyPresence {
  if (raw === null) return 'UNKNOWN'
  const trimmed = raw.trim()
  if (
    trimmed === SPRINT3U_K1_PRESENT ||
    trimmed === SPRINT3U_K2_PRESENT ||
    trimmed === SPRINT3U_K3_PRESENT
  ) return 'PRESENT'
  if (
    trimmed === SPRINT3U_K1_ABSENT ||
    trimmed === SPRINT3U_K2_ABSENT ||
    trimmed === SPRINT3U_K3_ABSENT
  ) return 'ABSENT'
  return 'UNKNOWN'
}

export function classifyCredentialBoundary(
  k1: KeyPresence,
  k2: KeyPresence,
  k3: KeyPresence,
): CredentialBoundaryResult {
  const k1ApiKeyAbsent = k1 === 'ABSENT'
  const k2WorkerCanaryAbsent = k2 === 'ABSENT'
  const k3EnvironmentKeyAbsent = k3 === 'ABSENT'

  const toolExecutionInheritsWorkerEnvironment = k2 === 'PRESENT'
  const environmentKeyExposedToBashPresence = k3 === 'PRESENT'

  // Pass requires all three keys to be absent AND no unknowns blocking it
  const credentialBoundaryPassed =
    k1ApiKeyAbsent && k2WorkerCanaryAbsent && k3EnvironmentKeyAbsent

  return {
    k1ApiKeyAbsent,
    k2WorkerCanaryAbsent,
    k3EnvironmentKeyAbsent,
    toolExecutionInheritsWorkerEnvironment,
    environmentKeyExposedToBashPresence,
    credentialBoundaryPassed,
  }
}

/** Determine the architecture branch based on K-probe results. */
export function selectBranchFromCredentials(result: CredentialBoundaryResult): 'A' | 'B' {
  // Branch B: bash inherits worker env vars or can detect the env key
  if (result.toolExecutionInheritsWorkerEnvironment || result.environmentKeyExposedToBashPresence) {
    return 'B'
  }
  return 'A'
}
