import { SPRINT3V_EXECUTOR_IMAGE, SPRINT3V_WORKER_CANARY_KEY } from '../config/constants.js'

export interface ExecutorLaunchParams {
  image: string
  outputDir: string
  networkMode: string
  /** env vars to pass — must be empty for a valid launch */
  envVars: Record<string, string>
  /** mount sources to check — must not include forbidden paths */
  mounts: string[]
  user: string
}

export interface PolicyViolation {
  rule: string
  detail: string
}

const FORBIDDEN_ENV_KEYS: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_ENVIRONMENT_KEY',
  SPRINT3V_WORKER_CANARY_KEY,
]

const FORBIDDEN_MOUNT_PATTERNS: readonly string[] = [
  '/var/run/docker.sock',
  process.env['HOME'] ?? '/root',
  '/home',
  '.env',
  'node_modules',
]

export function validateLaunchPolicy(params: ExecutorLaunchParams): PolicyViolation[] {
  const violations: PolicyViolation[] = []

  if (params.image !== SPRINT3V_EXECUTOR_IMAGE) {
    violations.push({
      rule: 'approved-image',
      detail: `Image must be ${SPRINT3V_EXECUTOR_IMAGE}, got: ${params.image}`,
    })
  }

  if (params.networkMode !== 'none') {
    violations.push({
      rule: 'network-none',
      detail: `Network mode must be 'none', got: '${params.networkMode}'`,
    })
  }

  for (const key of FORBIDDEN_ENV_KEYS) {
    if (key in params.envVars) {
      violations.push({
        rule: 'no-secret-env',
        detail: `Forbidden env var would be passed: ${key}`,
      })
    }
  }

  if (Object.keys(params.envVars).length > 0) {
    violations.push({
      rule: 'empty-env',
      detail: `Executor must receive an empty environment; got vars: ${Object.keys(params.envVars).join(', ')}`,
    })
  }

  for (const mount of params.mounts) {
    for (const pattern of FORBIDDEN_MOUNT_PATTERNS) {
      if (mount.includes(pattern)) {
        violations.push({
          rule: 'no-forbidden-mount',
          detail: `Forbidden mount source: '${mount}' matches pattern '${pattern}'`,
        })
      }
    }
  }

  return violations
}

export function assertLaunchPolicyPass(params: ExecutorLaunchParams): void {
  const violations = validateLaunchPolicy(params)
  if (violations.length > 0) {
    const lines = violations.map(v => `  [${v.rule}] ${v.detail}`).join('\n')
    throw new Error(`Executor launch policy violated:\n${lines}`)
  }
}

/** Build the docker-run argv for the executor container */
export function buildDockerArgv(outputDir: string): string[] {
  return [
    'run',
    '--rm',
    '--network', 'none',
    '--read-only',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--user', '1001:1001',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m',
    '--mount', `type=bind,src=${outputDir},dst=/mnt/session/outputs`,
    SPRINT3V_EXECUTOR_IMAGE,
  ]
}
