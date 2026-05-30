import type { VerificationProfile } from '../contracts/verification-profile.js'

export const CAPSULE_IMAGE_NODE_VITEST_TYPESCRIPT_V1 =
  'powerplant-verifier:node-vitest-typescript-v1' as const

const BUILT_IN_PROFILES: Record<string, VerificationProfile> = {
  'node-vitest-typescript-v1': {
    profileId: 'node-vitest-typescript-v1',
    runtime: 'capsule',
    capsuleImageName: CAPSULE_IMAGE_NODE_VITEST_TYPESCRIPT_V1,
    toolchainPackageVersions: {
      vitest: '2.1.9',
      vite: '5.4.21',
      typescript: '5.9.3',
    },
    networkDuringExecution: false,
    originalProjectMounted: false,
    projectNodeModulesMounted: false,
    credentialsPassed: false,
    visibleToAgent: false,
  },
  'subprocess-python-v1': {
    profileId: 'subprocess-python-v1',
    runtime: 'subprocess',
    capsuleImageName: null,
    defaultChecks: { test: 'pytest', lint: 'ruff check .' },
    networkDuringExecution: false,
    originalProjectMounted: false,
    credentialsPassed: false,
    visibleToAgent: false,
  },
  'subprocess-go-v1': {
    profileId: 'subprocess-go-v1',
    runtime: 'subprocess',
    capsuleImageName: null,
    defaultChecks: { test: 'go test ./...', build: 'go build ./...' },
    networkDuringExecution: false,
    originalProjectMounted: false,
    credentialsPassed: false,
    visibleToAgent: false,
  },
  'subprocess-generic-v1': {
    profileId: 'subprocess-generic-v1',
    runtime: 'subprocess',
    capsuleImageName: null,
    defaultChecks: {},
    networkDuringExecution: false,
    originalProjectMounted: false,
    credentialsPassed: false,
    visibleToAgent: false,
  },
}

/**
 * Resolve a verification profile by ID.
 *
 * Only built-in reviewed profiles are accepted.
 * Unknown profile IDs fail closed with a descriptive error.
 */
export function resolveVerificationProfile(profileId: string): VerificationProfile {
  const profile = BUILT_IN_PROFILES[profileId]
  if (!profile) {
    const known = Object.keys(BUILT_IN_PROFILES).join(', ')
    throw new Error(
      `Unknown verification profile: '${profileId}'. Known profiles: ${known}`,
    )
  }
  return profile
}

export function listKnownProfileIds(): string[] {
  return Object.keys(BUILT_IN_PROFILES)
}
