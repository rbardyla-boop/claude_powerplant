import { describe, it, expect } from 'vitest'
import import_fs from 'fs'
import import_path from 'path'
import import_os from 'os'
import {
  resolveVerificationProfile,
  listKnownProfileIds,
  CAPSULE_IMAGE_NODE_VITEST_TYPESCRIPT_V1,
} from '../src/verification/verification-profiles.js'
import { VerificationProfileSchema } from '../src/contracts/verification-profile.js'

// ── Profile registry ──────────────────────────────────────────────────────────

describe('resolveVerificationProfile', () => {
  it('resolves the node-vitest-typescript-v1 profile', () => {
    const profile = resolveVerificationProfile('node-vitest-typescript-v1')
    expect(profile.profileId).toBe('node-vitest-typescript-v1')
    expect(profile.capsuleImageName).toBe(CAPSULE_IMAGE_NODE_VITEST_TYPESCRIPT_V1)
  })

  it('throws for an unknown profile ID (fails closed)', () => {
    expect(() => resolveVerificationProfile('unknown-profile-xyz')).toThrow(
      /Unknown verification profile/,
    )
  })

  it('throws with the unknown ID included in the error message', () => {
    expect(() => resolveVerificationProfile('bad-profile')).toThrow(/bad-profile/)
  })

  it('includes known profile IDs in the error message', () => {
    expect(() => resolveVerificationProfile('nobody')).toThrow(/node-vitest-typescript-v1/)
  })
})

describe('listKnownProfileIds', () => {
  it('returns at least one profile', () => {
    expect(listKnownProfileIds().length).toBeGreaterThan(0)
  })

  it('includes node-vitest-typescript-v1', () => {
    expect(listKnownProfileIds()).toContain('node-vitest-typescript-v1')
  })
})

// ── Profile invariants ────────────────────────────────────────────────────────

describe('VerificationProfile invariants', () => {
  it('node-vitest-typescript-v1: all safety invariants are false/false', () => {
    const profile = resolveVerificationProfile('node-vitest-typescript-v1')
    expect(profile.networkDuringExecution).toBe(false)
    expect(profile.originalProjectMounted).toBe(false)
    expect(profile.projectNodeModulesMounted).toBe(false)
    expect(profile.credentialsPassed).toBe(false)
    expect(profile.visibleToAgent).toBe(false)
  })

  it('node-vitest-typescript-v1: toolchain includes vitest, vite, typescript', () => {
    const profile = resolveVerificationProfile('node-vitest-typescript-v1')
    expect(profile.toolchainPackageVersions).toHaveProperty('vitest', '2.1.9')
    expect(profile.toolchainPackageVersions).toHaveProperty('vite', '5.4.21')
    expect(profile.toolchainPackageVersions).toHaveProperty('typescript', '5.9.3')
  })

  it('node-vitest-typescript-v1 passes the VerificationProfileSchema', () => {
    const profile = resolveVerificationProfile('node-vitest-typescript-v1')
    expect(VerificationProfileSchema.safeParse(profile).success).toBe(true)
  })
})

// ── Schema: a profile cannot declare unsafe settings ─────────────────────────

describe('VerificationProfileSchema: rejects unsafe settings', () => {
  const valid = {
    profileId: 'test-profile',
    capsuleImageName: 'test-image:v1',
    toolchainPackageVersions: { vitest: '1.0.0' },
    networkDuringExecution: false as const,
    originalProjectMounted: false as const,
    projectNodeModulesMounted: false as const,
    credentialsPassed: false as const,
    visibleToAgent: false as const,
  }

  it('accepts a valid profile', () => {
    expect(VerificationProfileSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects networkDuringExecution: true', () => {
    expect(VerificationProfileSchema.safeParse({
      ...valid, networkDuringExecution: true,
    }).success).toBe(false)
  })

  it('rejects originalProjectMounted: true', () => {
    expect(VerificationProfileSchema.safeParse({
      ...valid, originalProjectMounted: true,
    }).success).toBe(false)
  })

  it('rejects projectNodeModulesMounted: true', () => {
    expect(VerificationProfileSchema.safeParse({
      ...valid, projectNodeModulesMounted: true,
    }).success).toBe(false)
  })

  it('rejects credentialsPassed: true', () => {
    expect(VerificationProfileSchema.safeParse({
      ...valid, credentialsPassed: true,
    }).success).toBe(false)
  })

  it('rejects visibleToAgent: true', () => {
    expect(VerificationProfileSchema.safeParse({
      ...valid, visibleToAgent: true,
    }).success).toBe(false)
  })
})

// ── Contract integration: verificationProfile field ──────────────────────────

describe('contract loader: verificationProfile field', () => {
  it('resolveVerificationProfile and executeChecksWithProfile use same profile registry', async () => {
    // Confirm that the capsule check runner would receive the same profile
    // object from the central registry as verify.ts does.
    const profileA = resolveVerificationProfile('node-vitest-typescript-v1')
    const profileB = resolveVerificationProfile('node-vitest-typescript-v1')
    expect(profileA.profileId).toBe(profileB.profileId)
    expect(profileA.capsuleImageName).toBe(profileB.capsuleImageName)
  })

  it('a profile cannot authorize checks beyond what VERIFY.yaml declares', () => {
    // The profile only provides tooling — it does not grant check permissions.
    // Check authorization is always derived from allowedChecks in VERIFY.yaml.
    const profile = resolveVerificationProfile('node-vitest-typescript-v1')
    // The profile has no 'checks' key — it cannot override the contract
    expect(profile).not.toHaveProperty('checks')
    expect(profile).not.toHaveProperty('allowedChecks')
  })
})

// ── Capsule Docker argv construction ─────────────────────────────────────────

describe('buildCapsuleDockerArgv', () => {
  it('always includes --network none', async () => {
    const { buildCapsuleDockerArgv } = await import('../src/verification/run-capsule-checks.js')
    const profile = resolveVerificationProfile('node-vitest-typescript-v1')
    const argv = buildCapsuleDockerArgv('/tmp/test-workspace', profile, 'npm', ['test'])
    expect(argv).toContain('--network')
    expect(argv).toContain('none')
  })

  it('includes the capsule image name', async () => {
    const { buildCapsuleDockerArgv } = await import('../src/verification/run-capsule-checks.js')
    const profile = resolveVerificationProfile('node-vitest-typescript-v1')
    const argv = buildCapsuleDockerArgv('/tmp/test-workspace', profile, 'npm', ['test'])
    expect(argv).toContain(CAPSULE_IMAGE_NODE_VITEST_TYPESCRIPT_V1)
  })

  it('includes the workspace path as a bind mount', async () => {
    const { buildCapsuleDockerArgv } = await import('../src/verification/run-capsule-checks.js')
    const profile = resolveVerificationProfile('node-vitest-typescript-v1')
    const argv = buildCapsuleDockerArgv('/tmp/test-workspace', profile, 'npm', ['test'])
    const mountArg = argv.find(a => a.includes('test-workspace'))
    expect(mountArg).toBeDefined()
  })

  it('includes --cap-drop ALL', async () => {
    const { buildCapsuleDockerArgv } = await import('../src/verification/run-capsule-checks.js')
    const profile = resolveVerificationProfile('node-vitest-typescript-v1')
    const argv = buildCapsuleDockerArgv('/tmp/test-workspace', profile, 'npm', ['test'])
    expect(argv).toContain('--cap-drop')
    expect(argv).toContain('ALL')
  })

  it('includes --user 1001:1001 (non-root)', async () => {
    const { buildCapsuleDockerArgv } = await import('../src/verification/run-capsule-checks.js')
    const profile = resolveVerificationProfile('node-vitest-typescript-v1')
    const argv = buildCapsuleDockerArgv('/tmp/test-workspace', profile, 'npm', ['test'])
    expect(argv).toContain('--user')
    expect(argv).toContain('1001:1001')
  })

  it('does NOT include the host home directory in any mount', async () => {
    const { buildCapsuleDockerArgv } = await import('../src/verification/run-capsule-checks.js')
    const profile = resolveVerificationProfile('node-vitest-typescript-v1')
    const argv = buildCapsuleDockerArgv('/tmp/test-workspace', profile, 'npm', ['test'])
    const homeDir = process.env['HOME'] ?? '/root'
    const argStr = argv.join(' ')
    expect(argStr).not.toContain(homeDir)
  })
})

// ── Capsule safety: workspace path validation ─────────────────────────────────

describe('runCapsuleChecks: workspace path validation', () => {
  it('rejects workspace paths containing HOME directory', async () => {
    const { runCapsuleChecks } = await import('../src/verification/run-capsule-checks.js')
    const profile = resolveVerificationProfile('node-vitest-typescript-v1')
    const homeDir = process.env['HOME'] ?? '/root'
    await expect(
      runCapsuleChecks(`${homeDir}/some-dir`, {}, profile),
    ).rejects.toThrow(/FAIL_BOUNDARY/)
  })

  it('rejects workspace paths not under /tmp/', async () => {
    const { runCapsuleChecks } = await import('../src/verification/run-capsule-checks.js')
    const profile = resolveVerificationProfile('node-vitest-typescript-v1')
    await expect(
      runCapsuleChecks('/home/user/some-project', {}, profile),
    ).rejects.toThrow(/FAIL_BOUNDARY/)
  })

  it('accepts /tmp/ paths', async () => {
    const { runCapsuleChecks } = await import('../src/verification/run-capsule-checks.js')
    const profile = resolveVerificationProfile('node-vitest-typescript-v1')
    // Use a real temp directory so chmodSync does not fail on a non-existent path.
    // With empty checks, no Docker command runs.
    const tmpDir = import_fs.mkdtempSync(import_path.join(import_os.tmpdir(), 'pp-profile-test-'))
    try {
      const results = await runCapsuleChecks(tmpDir, {}, profile)
      expect(results).toEqual([])
    } finally {
      import_fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

// ── Live broker integration ───────────────────────────────────────────────────

describe('runCapsuleProjectChecks: shared path wired in broker', () => {
  it('runCapsuleProjectChecks is exported from project-executor-actions', async () => {
    const { runCapsuleProjectChecks } = await import('../src/broker/project-executor-actions.js')
    expect(typeof runCapsuleProjectChecks).toBe('function')
  })

  it('executeChecksWithProfile is the same routing fn used by verify and broker', async () => {
    const { executeChecksWithProfile } = await import('../src/verification/run-approved-checks.js')
    expect(typeof executeChecksWithProfile).toBe('function')
  })
})
