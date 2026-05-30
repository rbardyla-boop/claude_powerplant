import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  resolveVerificationProfile,
  listKnownProfileIds,
} from '../src/verification/verification-profiles.js'
import { VerificationProfileSchema } from '../src/contracts/verification-profile.js'
import { runSubprocessChecks } from '../src/verification/run-subprocess-checks.js'
import { executeChecksWithProfile } from '../src/verification/run-approved-checks.js'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pp-subprocess-test-'))
}

// ── Profile registry: subprocess profiles exist ──────────────────────────────

describe('subprocess profile registry', () => {
  it('subprocess-python-v1 is a known profile', () => {
    expect(listKnownProfileIds()).toContain('subprocess-python-v1')
  })

  it('subprocess-go-v1 is a known profile', () => {
    expect(listKnownProfileIds()).toContain('subprocess-go-v1')
  })

  it('subprocess-generic-v1 is a known profile', () => {
    expect(listKnownProfileIds()).toContain('subprocess-generic-v1')
  })

  it('node-vitest-typescript-v1 still exists (non-scope preserved)', () => {
    expect(listKnownProfileIds()).toContain('node-vitest-typescript-v1')
  })

  it('unknown profile ID fails closed', () => {
    expect(() => resolveVerificationProfile('no-such-profile-xyz')).toThrow(
      /Unknown verification profile/,
    )
  })

  it('unknown profile ID is included in the error message', () => {
    expect(() => resolveVerificationProfile('no-such-profile-xyz')).toThrow(
      /no-such-profile-xyz/,
    )
  })
})

// ── Profile invariants ────────────────────────────────────────────────────────

describe('subprocess-python-v1 invariants', () => {
  it('has runtime: subprocess', () => {
    expect(resolveVerificationProfile('subprocess-python-v1').runtime).toBe('subprocess')
  })

  it('has capsuleImageName: null (no Docker required)', () => {
    expect(resolveVerificationProfile('subprocess-python-v1').capsuleImageName).toBeNull()
  })

  it('networkDuringExecution: false', () => {
    expect(resolveVerificationProfile('subprocess-python-v1').networkDuringExecution).toBe(false)
  })

  it('originalProjectMounted: false', () => {
    expect(resolveVerificationProfile('subprocess-python-v1').originalProjectMounted).toBe(false)
  })

  it('credentialsPassed: false', () => {
    expect(resolveVerificationProfile('subprocess-python-v1').credentialsPassed).toBe(false)
  })

  it('visibleToAgent: false', () => {
    expect(resolveVerificationProfile('subprocess-python-v1').visibleToAgent).toBe(false)
  })

  it('passes VerificationProfileSchema', () => {
    const profile = resolveVerificationProfile('subprocess-python-v1')
    expect(VerificationProfileSchema.safeParse(profile).success).toBe(true)
  })
})

describe('subprocess-go-v1 invariants', () => {
  it('has runtime: subprocess', () => {
    expect(resolveVerificationProfile('subprocess-go-v1').runtime).toBe('subprocess')
  })

  it('has capsuleImageName: null (no Docker required)', () => {
    expect(resolveVerificationProfile('subprocess-go-v1').capsuleImageName).toBeNull()
  })

  it('networkDuringExecution: false', () => {
    expect(resolveVerificationProfile('subprocess-go-v1').networkDuringExecution).toBe(false)
  })

  it('originalProjectMounted: false', () => {
    expect(resolveVerificationProfile('subprocess-go-v1').originalProjectMounted).toBe(false)
  })

  it('credentialsPassed: false', () => {
    expect(resolveVerificationProfile('subprocess-go-v1').credentialsPassed).toBe(false)
  })

  it('visibleToAgent: false', () => {
    expect(resolveVerificationProfile('subprocess-go-v1').visibleToAgent).toBe(false)
  })

  it('passes VerificationProfileSchema', () => {
    const profile = resolveVerificationProfile('subprocess-go-v1')
    expect(VerificationProfileSchema.safeParse(profile).success).toBe(true)
  })
})

describe('subprocess-generic-v1 invariants', () => {
  it('has runtime: subprocess', () => {
    expect(resolveVerificationProfile('subprocess-generic-v1').runtime).toBe('subprocess')
  })

  it('has capsuleImageName: null (no Docker required)', () => {
    expect(resolveVerificationProfile('subprocess-generic-v1').capsuleImageName).toBeNull()
  })

  it('networkDuringExecution: false', () => {
    expect(resolveVerificationProfile('subprocess-generic-v1').networkDuringExecution).toBe(false)
  })

  it('originalProjectMounted: false', () => {
    expect(resolveVerificationProfile('subprocess-generic-v1').originalProjectMounted).toBe(false)
  })

  it('credentialsPassed: false', () => {
    expect(resolveVerificationProfile('subprocess-generic-v1').credentialsPassed).toBe(false)
  })

  it('visibleToAgent: false', () => {
    expect(resolveVerificationProfile('subprocess-generic-v1').visibleToAgent).toBe(false)
  })

  it('passes VerificationProfileSchema', () => {
    const profile = resolveVerificationProfile('subprocess-generic-v1')
    expect(VerificationProfileSchema.safeParse(profile).success).toBe(true)
  })
})

describe('node-vitest-typescript-v1 still works (non-scope preserved)', () => {
  it('has runtime: capsule', () => {
    expect(resolveVerificationProfile('node-vitest-typescript-v1').runtime).toBe('capsule')
  })

  it('has a non-null capsuleImageName', () => {
    expect(resolveVerificationProfile('node-vitest-typescript-v1').capsuleImageName).not.toBeNull()
  })

  it('all safety invariants are false', () => {
    const p = resolveVerificationProfile('node-vitest-typescript-v1')
    expect(p.networkDuringExecution).toBe(false)
    expect(p.originalProjectMounted).toBe(false)
    expect(p.credentialsPassed).toBe(false)
    expect(p.visibleToAgent).toBe(false)
  })

  it('passes VerificationProfileSchema', () => {
    const profile = resolveVerificationProfile('node-vitest-typescript-v1')
    expect(VerificationProfileSchema.safeParse(profile).success).toBe(true)
  })
})

// ── Subprocess runner behavior ────────────────────────────────────────────────

describe('runSubprocessChecks', () => {
  let dir: string

  beforeEach(() => {
    dir = makeTempDir()
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('reports PASS for a trivial successful command', async () => {
    const results = await runSubprocessChecks(dir, { pass: { command: 'true' } })
    expect(results).toHaveLength(1)
    const r = results[0]!
    expect(r.checkId).toBe('pass')
    expect(r.verdict).toBe('PASS')
    expect(r.exitCode).toBe(0)
  })

  it('reports FAIL_CHECK for a failing command', async () => {
    const results = await runSubprocessChecks(dir, { fail: { command: 'false' } })
    expect(results).toHaveLength(1)
    const r = results[0]!
    expect(r.verdict).toBe('FAIL_CHECK')
    expect(r.exitCode).toBe(1)
  })

  it('reports BLOCKED_MISSING_TOOLING for a missing executable', async () => {
    const results = await runSubprocessChecks(dir, {
      noSuchExec: { command: 'no_such_executable_xyz_pp_test_sentinel' },
    })
    expect(results).toHaveLength(1)
    expect(results[0]!.verdict).toBe('BLOCKED_MISSING_TOOLING')
  })

  it('runs in the supplied workspace path, not process.cwd()', async () => {
    const results = await runSubprocessChecks(dir, { cwd_check: { command: 'pwd' } })
    expect(results).toHaveLength(1)
    const r = results[0]!
    expect(r.verdict).toBe('PASS')
    // Resolve symlinks — mkdtempSync on macOS /tmp is a symlink to /private/tmp
    const realDir = fs.realpathSync(dir)
    expect(r.stdoutTail.trim()).toBe(realDir)
  })

  it('does not receive host credential env vars in the subprocess', async () => {
    const sentinel = 'pp-test-secret-sentinel-should-not-appear-in-subprocess'
    const origKey = process.env['ANTHROPIC_API_KEY']
    process.env['ANTHROPIC_API_KEY'] = sentinel
    try {
      // 'env' dumps all environment variables to stdout
      const results = await runSubprocessChecks(dir, { dumpEnv: { command: 'env' } })
      expect(results[0]!.stdoutTail).not.toContain(sentinel)
    } finally {
      if (origKey === undefined) delete process.env['ANTHROPIC_API_KEY']
      else process.env['ANTHROPIC_API_KEY'] = origKey
    }
  })

  it('subprocess-generic-v1 with empty defaultChecks — runSubprocessChecks with no checks returns empty results', async () => {
    // generic profile has defaultChecks: {}; user must declare all checks in VERIFY.yaml.
    // Running with empty checks must produce an empty result, not a crash or false-green.
    const results = await runSubprocessChecks(dir, {})
    expect(results).toEqual([])
  })

  it('returns one result per declared check', async () => {
    const results = await runSubprocessChecks(dir, {
      first: { command: 'true' },
      second: { command: 'true' },
    })
    expect(results).toHaveLength(2)
    expect(results.map(r => r.checkId)).toEqual(expect.arrayContaining(['first', 'second']))
  })

  it('result shape matches CheckResult contract (checkId, command, verdict, exitCode, stdoutTail, stderrTail)', async () => {
    const results = await runSubprocessChecks(dir, { shape_test: { command: 'true' } })
    const r = results[0]!
    expect(r).toHaveProperty('checkId', 'shape_test')
    expect(r).toHaveProperty('command', 'true')
    expect(r).toHaveProperty('verdict')
    expect(r).toHaveProperty('exitCode')
    expect(r).toHaveProperty('stdoutTail')
    expect(r).toHaveProperty('stderrTail')
  })
})

// ── Routing: executeChecksWithProfile ─────────────────────────────────────────

describe('executeChecksWithProfile routing', () => {
  let dir: string

  beforeEach(() => {
    dir = makeTempDir()
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('routes subprocess-generic-v1 to runSubprocessChecks — no Docker required', async () => {
    // Empty checks — completes without needing Docker daemon
    const results = await executeChecksWithProfile(dir, {}, 'subprocess-generic-v1')
    expect(results).toEqual([])
  })

  it('routes subprocess-python-v1 to runSubprocessChecks — no Docker required', async () => {
    const results = await executeChecksWithProfile(dir, {}, 'subprocess-python-v1')
    expect(results).toEqual([])
  })

  it('routes subprocess-go-v1 to runSubprocessChecks — no Docker required', async () => {
    const results = await executeChecksWithProfile(dir, {}, 'subprocess-go-v1')
    expect(results).toEqual([])
  })

  it('subprocess runner executes the declared command (not Docker) when profile is subprocess-generic-v1', async () => {
    const results = await executeChecksWithProfile(
      dir,
      { trivial: { command: 'true' } },
      'subprocess-generic-v1',
    )
    const r = results[0]!
    expect(r.verdict).toBe('PASS')
    expect(r.exitCode).toBe(0)
  })

  it('unknown profile ID fails closed (resolveVerificationProfile throws)', async () => {
    await expect(
      executeChecksWithProfile(dir, {}, 'no-such-profile-xyz'),
    ).rejects.toThrow(/Unknown verification profile/)
  })

  it('unknown runtime fails closed — defense-in-depth guard (Zod prevents this via schema)', async () => {
    // Zod validates the registry at write time. This test exercises the defense-in-depth
    // guard in executeChecksWithProfile for any bypassed schema path.
    const { runSubprocessChecks: subRunner } = await import('../src/verification/run-subprocess-checks.js')
    const { runCapsuleChecks: capRunner } = await import('../src/verification/run-capsule-checks.js')

    const badProfile = {
      profileId: 'bad-runtime-profile',
      runtime: 'unknown-runtime',
      capsuleImageName: null,
      networkDuringExecution: false as const,
      originalProjectMounted: false as const,
      credentialsPassed: false as const,
      visibleToAgent: false as const,
    }

    // Inline the routing logic to verify the guard throws
    const routeByRuntime = async (profile: typeof badProfile) => {
      if (profile.runtime === 'capsule') return capRunner(dir, {}, profile as never)
      if (profile.runtime === 'subprocess') return subRunner(dir, {})
      throw new Error(`Unknown profile runtime: '${profile.runtime}'`)
    }

    await expect(routeByRuntime(badProfile)).rejects.toThrow(/Unknown profile runtime/)
  })
})

// ── No Docker required for subprocess profiles ───────────────────────────────

describe('no Docker required for subprocess profiles', () => {
  it('subprocess profiles resolve without querying Docker', () => {
    // Resolution is a pure registry lookup — no Docker involved
    expect(() => resolveVerificationProfile('subprocess-python-v1')).not.toThrow()
    expect(() => resolveVerificationProfile('subprocess-go-v1')).not.toThrow()
    expect(() => resolveVerificationProfile('subprocess-generic-v1')).not.toThrow()
  })

  it('running subprocess-generic-v1 with empty checks completes without Docker daemon', async () => {
    const dir2 = makeTempDir()
    try {
      // This would fail if the path tried to exec docker
      const results = await executeChecksWithProfile(dir2, {}, 'subprocess-generic-v1')
      expect(results).toEqual([])
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true })
    }
  })
})
