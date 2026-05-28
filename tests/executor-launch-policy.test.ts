import { describe, it, expect } from 'vitest'
import {
  validateLaunchPolicy,
  assertLaunchPolicyPass,
  buildDockerArgv,
} from '../src/broker/executor-launch-policy.js'
import { SPRINT3V_EXECUTOR_IMAGE } from '../src/config/constants.js'

const validParams = {
  image: SPRINT3V_EXECUTOR_IMAGE,
  outputDir: '/tmp/sprint3v-test/outputs',
  networkMode: 'none',
  envVars: {},
  mounts: ['/tmp/sprint3v-test/outputs'],
  user: '1001:1001',
}

describe('validateLaunchPolicy', () => {
  it('returns no violations for valid params', () => {
    const violations = validateLaunchPolicy(validParams)
    expect(violations).toHaveLength(0)
  })

  it('rejects network modes other than none', () => {
    const violations = validateLaunchPolicy({ ...validParams, networkMode: 'host' })
    expect(violations.some(v => v.rule === 'network-none')).toBe(true)
  })

  it('rejects bridge network mode', () => {
    const violations = validateLaunchPolicy({ ...validParams, networkMode: 'bridge' })
    expect(violations.some(v => v.rule === 'network-none')).toBe(true)
  })

  it('rejects ANTHROPIC_API_KEY in env vars', () => {
    const violations = validateLaunchPolicy({
      ...validParams,
      envVars: { ANTHROPIC_API_KEY: 'sk-ant-xxx' },
    })
    expect(violations.some(v => v.rule === 'no-secret-env')).toBe(true)
  })

  it('rejects ANTHROPIC_ENVIRONMENT_KEY in env vars', () => {
    const violations = validateLaunchPolicy({
      ...validParams,
      envVars: { ANTHROPIC_ENVIRONMENT_KEY: 'ek-xxx' },
    })
    expect(violations.some(v => v.rule === 'no-secret-env')).toBe(true)
  })

  it('rejects POWERPLANT_WORKER_SECRET_CANARY in env vars', () => {
    const violations = validateLaunchPolicy({
      ...validParams,
      envVars: { POWERPLANT_WORKER_SECRET_CANARY: 'secret' },
    })
    expect(violations.some(v => v.rule === 'no-secret-env')).toBe(true)
  })

  it('rejects any non-empty env var map', () => {
    const violations = validateLaunchPolicy({
      ...validParams,
      envVars: { PATH: '/usr/bin' },
    })
    expect(violations.some(v => v.rule === 'empty-env')).toBe(true)
  })

  it('rejects Docker socket mount', () => {
    const violations = validateLaunchPolicy({
      ...validParams,
      mounts: ['/var/run/docker.sock'],
    })
    expect(violations.some(v => v.rule === 'no-forbidden-mount')).toBe(true)
  })

  it('rejects .env file mount pattern', () => {
    const violations = validateLaunchPolicy({
      ...validParams,
      mounts: ['/home/user/project/.env'],
    })
    expect(violations.some(v => v.rule === 'no-forbidden-mount')).toBe(true)
  })

  it('rejects home directory mount', () => {
    const violations = validateLaunchPolicy({
      ...validParams,
      mounts: ['/home/user'],
    })
    expect(violations.some(v => v.rule === 'no-forbidden-mount')).toBe(true)
  })

  it('rejects wrong executor image', () => {
    const violations = validateLaunchPolicy({ ...validParams, image: 'my-other-image:latest' })
    expect(violations.some(v => v.rule === 'approved-image')).toBe(true)
  })
})

describe('assertLaunchPolicyPass', () => {
  it('does not throw for valid params', () => {
    expect(() => assertLaunchPolicyPass(validParams)).not.toThrow()
  })

  it('throws with all violations listed when policy fails', () => {
    expect(() =>
      assertLaunchPolicyPass({
        ...validParams,
        networkMode: 'host',
        envVars: { ANTHROPIC_API_KEY: 'sk-ant-xxx' },
      }),
    ).toThrow(/network-none/)
  })
})

describe('buildDockerArgv', () => {
  it('includes --network none', () => {
    const argv = buildDockerArgv('/tmp/outputs')
    expect(argv).toContain('--network')
    const idx = argv.indexOf('--network')
    expect(argv[idx + 1]).toBe('none')
  })

  it('includes --read-only', () => {
    const argv = buildDockerArgv('/tmp/outputs')
    expect(argv).toContain('--read-only')
  })

  it('includes --cap-drop ALL', () => {
    const argv = buildDockerArgv('/tmp/outputs')
    expect(argv).toContain('--cap-drop')
    const idx = argv.indexOf('--cap-drop')
    expect(argv[idx + 1]).toBe('ALL')
  })

  it('includes --security-opt no-new-privileges', () => {
    const argv = buildDockerArgv('/tmp/outputs')
    expect(argv).toContain('--security-opt')
    const idx = argv.indexOf('--security-opt')
    expect(argv[idx + 1]).toBe('no-new-privileges')
  })

  it('mounts only the output directory', () => {
    const argv = buildDockerArgv('/tmp/outputs')
    const mountIdx = argv.indexOf('--mount')
    expect(mountIdx).toBeGreaterThan(-1)
    const mountSpec = argv[mountIdx + 1]!
    expect(mountSpec).toContain('/tmp/outputs')
    expect(mountSpec).toContain('/mnt/session/outputs')
  })

  it('does not contain any -e or --env flag', () => {
    const argv = buildDockerArgv('/tmp/outputs')
    expect(argv).not.toContain('-e')
    expect(argv).not.toContain('--env')
    expect(argv).not.toContain('--env-file')
  })

  it('does not mount home, docker socket, or project paths', () => {
    const argv = buildDockerArgv('/tmp/outputs')
    const full = argv.join(' ')
    expect(full).not.toContain('/home')
    expect(full).not.toContain('/var/run/docker.sock')
    expect(full).not.toContain('ANTHROPIC')
  })

  it('uses non-root user 1001:1001', () => {
    const argv = buildDockerArgv('/tmp/outputs')
    const idx = argv.indexOf('--user')
    expect(idx).toBeGreaterThan(-1)
    expect(argv[idx + 1]).toBe('1001:1001')
  })

  it('ends with the executor image name', () => {
    const argv = buildDockerArgv('/tmp/outputs')
    expect(argv[argv.length - 1]).toBe(SPRINT3V_EXECUTOR_IMAGE)
  })
})
