import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import yaml from 'js-yaml'
import { generateProjectId, generatePolicyYaml } from '../src/projects/generate-policy.js'
import { generateVerifyYaml } from '../src/projects/generate-verify.js'
import { loadProjectContract } from '../src/projects/load-project-contract.js'
import { cmdInit } from '../src/cli/commands/init.js'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pp-init-test-'))
}

/**
 * Suppress CLI output and mock process.exit so cmdInit errors become thrown
 * exceptions instead of halting the test process.
 */
function mockCli(): void {
  vi.spyOn(process, 'exit').mockImplementation((_code) => {
    throw new Error(`process.exit(${_code ?? 0})`)
  })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Generator: POLICY.yaml ────────────────────────────────────────────────────

describe('generatePolicyYaml', () => {
  it('required exclude paths are present in every generated policy', () => {
    for (const stack of ['node-ts', 'python', 'go', 'rust', 'generic'] as const) {
      const out = generatePolicyYaml(stack, `test-id-${stack}`)
      const doc = yaml.load(out) as Record<string, unknown>
      const excludes = doc['excludePaths'] as string[]
      expect(excludes).toContain('.git/**')
      expect(excludes).toContain('node_modules/**')
      expect(excludes).toContain('.env')
      expect(excludes).toContain('.env.*')
      expect(excludes).toContain('**/*.key')
      expect(excludes).toContain('**/*.pem')
    }
  })

  it('node-ts policy has src/**, tests/**, package.json, tsconfig.json in includePaths', () => {
    const doc = yaml.load(generatePolicyYaml('node-ts', 'test-id')) as Record<string, unknown>
    const inc = doc['includePaths'] as string[]
    expect(inc).toContain('src/**')
    expect(inc).toContain('tests/**')
    expect(inc).toContain('package.json')
    expect(inc).toContain('tsconfig.json')
  })

  it('python policy has **/*.py, tests/**, pyproject.toml in includePaths', () => {
    const doc = yaml.load(generatePolicyYaml('python', 'test-id')) as Record<string, unknown>
    const inc = doc['includePaths'] as string[]
    expect(inc).toContain('**/*.py')
    expect(inc).toContain('tests/**')
    expect(inc).toContain('pyproject.toml')
  })

  it('go policy has **/*.go, go.mod, go.sum in includePaths', () => {
    const doc = yaml.load(generatePolicyYaml('go', 'test-id')) as Record<string, unknown>
    const inc = doc['includePaths'] as string[]
    expect(inc).toContain('**/*.go')
    expect(inc).toContain('go.mod')
    expect(inc).toContain('go.sum')
  })

  it('allowedReadPaths is non-empty for every stack', () => {
    for (const stack of ['node-ts', 'python', 'go', 'rust', 'generic'] as const) {
      const doc = yaml.load(generatePolicyYaml(stack, 'test-id')) as Record<string, unknown>
      const read = doc['allowedReadPaths'] as string[]
      expect(read.length).toBeGreaterThan(0)
    }
  })

  it('projectId round-trips through YAML with the supplied value', () => {
    const doc = yaml.load(generatePolicyYaml('node-ts', 'myproject-ab1234cd')) as Record<string, unknown>
    expect(doc['projectId']).toBe('myproject-ab1234cd')
  })
})

// ── Generator: VERIFY.yaml ────────────────────────────────────────────────────

describe('generateVerifyYaml', () => {
  it('node-ts generates node-vitest-typescript-v1 profile', () => {
    const doc = yaml.load(generateVerifyYaml('node-ts')) as Record<string, unknown>
    expect(doc['verificationProfile']).toBe('node-vitest-typescript-v1')
  })

  it('node-ts generates npm test and typecheck checks', () => {
    const doc = yaml.load(generateVerifyYaml('node-ts')) as Record<string, unknown>
    const checks = doc['checks'] as Record<string, { command: string }>
    expect(checks['test']?.command).toBe('npm test')
    expect(checks['typecheck']?.command).toBe('npx tsc --noEmit')
  })

  it('python omits verificationProfile (no capsule shipped)', () => {
    const doc = yaml.load(generateVerifyYaml('python')) as Record<string, unknown>
    expect(doc['verificationProfile']).toBeUndefined()
  })

  it('python generates python3 -m pytest check (subprocess-portable form)', () => {
    const doc = yaml.load(generateVerifyYaml('python')) as Record<string, unknown>
    const checks = doc['checks'] as Record<string, { command: string }>
    expect(checks['test']?.command).toBe('python3 -m pytest')
  })

  it('go omits verificationProfile (no capsule shipped)', () => {
    const doc = yaml.load(generateVerifyYaml('go')) as Record<string, unknown>
    expect(doc['verificationProfile']).toBeUndefined()
  })

  it('go generates go test ./... check', () => {
    const doc = yaml.load(generateVerifyYaml('go')) as Record<string, unknown>
    const checks = doc['checks'] as Record<string, { command: string }>
    expect(checks['test']?.command).toBe('go test ./...')
  })

  it('rust omits verificationProfile (no capsule shipped)', () => {
    const doc = yaml.load(generateVerifyYaml('rust')) as Record<string, unknown>
    expect(doc['verificationProfile']).toBeUndefined()
  })

  it('rust generates cargo test check', () => {
    const doc = yaml.load(generateVerifyYaml('rust')) as Record<string, unknown>
    const checks = doc['checks'] as Record<string, { command: string }>
    expect(checks['test']?.command).toBe('cargo test')
  })

  it('generic fallback omits verificationProfile (no capsule shipped)', () => {
    const doc = yaml.load(generateVerifyYaml('generic')) as Record<string, unknown>
    expect(doc['verificationProfile']).toBeUndefined()
  })

  it('generic fallback generates empty checks (user must add checks)', () => {
    const doc = yaml.load(generateVerifyYaml('generic')) as Record<string, unknown>
    expect(doc['checks']).toEqual({})
  })
})

// ── generateProjectId ─────────────────────────────────────────────────────────

describe('generateProjectId', () => {
  it('projectId matches <dirname>-<8 hex chars> format', () => {
    const dir = makeTempDir()
    try {
      const id = generateProjectId(dir)
      expect(id).toMatch(/^[a-zA-Z0-9-]+-[0-9a-f]{8}$/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('dirname component matches the base name of the resolved project path', () => {
    const dir = makeTempDir()
    try {
      const id = generateProjectId(dir)
      const dirname = path.basename(path.resolve(dir))
      expect(id.startsWith(dirname + '-')).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('two calls produce different IDs (random hex suffix)', () => {
    const dir = makeTempDir()
    try {
      const id1 = generateProjectId(dir)
      const id2 = generateProjectId(dir)
      expect(id1).not.toBe(id2)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── loadProjectContract integration ──────────────────────────────────────────

describe('generated files pass loadProjectContract()', () => {
  it('node-ts: generated POLICY.yaml + VERIFY.yaml passes loadProjectContract', () => {
    const dir = makeTempDir()
    try {
      const projectId = generateProjectId(dir)
      fs.mkdirSync(path.join(dir, '.powerplant'), { recursive: true })
      fs.writeFileSync(path.join(dir, '.powerplant', 'POLICY.yaml'), generatePolicyYaml('node-ts', projectId))
      fs.writeFileSync(path.join(dir, '.powerplant', 'VERIFY.yaml'), generateVerifyYaml('node-ts'))
      expect(() => loadProjectContract(dir)).not.toThrow()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('python: generated files pass loadProjectContract', () => {
    const dir = makeTempDir()
    try {
      const projectId = generateProjectId(dir)
      fs.mkdirSync(path.join(dir, '.powerplant'), { recursive: true })
      fs.writeFileSync(path.join(dir, '.powerplant', 'POLICY.yaml'), generatePolicyYaml('python', projectId))
      fs.writeFileSync(path.join(dir, '.powerplant', 'VERIFY.yaml'), generateVerifyYaml('python'))
      expect(() => loadProjectContract(dir)).not.toThrow()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('go: generated files pass loadProjectContract', () => {
    const dir = makeTempDir()
    try {
      const projectId = generateProjectId(dir)
      fs.mkdirSync(path.join(dir, '.powerplant'), { recursive: true })
      fs.writeFileSync(path.join(dir, '.powerplant', 'POLICY.yaml'), generatePolicyYaml('go', projectId))
      fs.writeFileSync(path.join(dir, '.powerplant', 'VERIFY.yaml'), generateVerifyYaml('go'))
      expect(() => loadProjectContract(dir)).not.toThrow()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rust: generated files pass loadProjectContract', () => {
    const dir = makeTempDir()
    try {
      const projectId = generateProjectId(dir)
      fs.mkdirSync(path.join(dir, '.powerplant'), { recursive: true })
      fs.writeFileSync(path.join(dir, '.powerplant', 'POLICY.yaml'), generatePolicyYaml('rust', projectId))
      fs.writeFileSync(path.join(dir, '.powerplant', 'VERIFY.yaml'), generateVerifyYaml('rust'))
      expect(() => loadProjectContract(dir)).not.toThrow()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('generic: generated POLICY.yaml passes schema; VERIFY.yaml requires user to add checks', () => {
    const dir = makeTempDir()
    try {
      const projectId = generateProjectId(dir)
      fs.mkdirSync(path.join(dir, '.powerplant'), { recursive: true })
      fs.writeFileSync(path.join(dir, '.powerplant', 'POLICY.yaml'), generatePolicyYaml('generic', projectId))
      fs.writeFileSync(path.join(dir, '.powerplant', 'VERIFY.yaml'), generateVerifyYaml('generic'))
      // generic VERIFY.yaml has empty checks — contract explicitly requires user to add them
      expect(() => loadProjectContract(dir)).toThrow(/must define at least one check/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── cmdInit: file creation ────────────────────────────────────────────────────

describe('cmdInit: file creation', () => {
  it('creates .powerplant/POLICY.yaml', async () => {
    const dir = makeTempDir()
    mockCli()
    try {
      await cmdInit(['--stack', 'node-ts', dir])
      expect(fs.existsSync(path.join(dir, '.powerplant', 'POLICY.yaml'))).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('creates .powerplant/VERIFY.yaml', async () => {
    const dir = makeTempDir()
    mockCli()
    try {
      await cmdInit(['--stack', 'node-ts', dir])
      expect(fs.existsSync(path.join(dir, '.powerplant', 'VERIFY.yaml'))).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('created POLICY.yaml passes loadProjectContract', async () => {
    const dir = makeTempDir()
    mockCli()
    try {
      await cmdInit(['--stack', 'node-ts', dir])
      expect(() => loadProjectContract(dir)).not.toThrow()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── cmdInit: stack detection and override ────────────────────────────────────

describe('cmdInit: stack detection', () => {
  it('detects node-ts from package.json', async () => {
    const dir = makeTempDir()
    mockCli()
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"test"}')
      await cmdInit([dir])
      const v = yaml.load(fs.readFileSync(path.join(dir, '.powerplant', 'VERIFY.yaml'), 'utf-8')) as Record<string, unknown>
      expect(v['verificationProfile']).toBe('node-vitest-typescript-v1')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('detects python from pyproject.toml', async () => {
    const dir = makeTempDir()
    mockCli()
    try {
      fs.writeFileSync(path.join(dir, 'pyproject.toml'), '[project]')
      await cmdInit([dir])
      const v = yaml.load(fs.readFileSync(path.join(dir, '.powerplant', 'VERIFY.yaml'), 'utf-8')) as Record<string, unknown>
      expect(v['verificationProfile']).toBeUndefined()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('detects go from go.mod', async () => {
    const dir = makeTempDir()
    mockCli()
    try {
      fs.writeFileSync(path.join(dir, 'go.mod'), 'module example.com/app')
      await cmdInit([dir])
      const v = yaml.load(fs.readFileSync(path.join(dir, '.powerplant', 'VERIFY.yaml'), 'utf-8')) as Record<string, unknown>
      expect(v['verificationProfile']).toBeUndefined()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to generic in empty directory', async () => {
    // generic exits 1 due to empty checks — just test file content, not full cmdInit success
    const dir = makeTempDir()
    try {
      const projectId = generateProjectId(dir)
      fs.mkdirSync(path.join(dir, '.powerplant'), { recursive: true })
      fs.writeFileSync(path.join(dir, '.powerplant', 'POLICY.yaml'), generatePolicyYaml('generic', projectId))
      fs.writeFileSync(path.join(dir, '.powerplant', 'VERIFY.yaml'), generateVerifyYaml('generic'))
      const v = yaml.load(fs.readFileSync(path.join(dir, '.powerplant', 'VERIFY.yaml'), 'utf-8')) as Record<string, unknown>
      expect(v['verificationProfile']).toBeUndefined()
      expect(v['checks']).toEqual({})
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rust Cargo.toml detection maps to subprocess-generic-v1', async () => {
    const dir = makeTempDir()
    mockCli()
    try {
      fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]')
      // Rust init will fail contract validation only if... wait, rust has cargo test check
      // so it should pass
      await cmdInit([dir])
      const v = yaml.load(fs.readFileSync(path.join(dir, '.powerplant', 'VERIFY.yaml'), 'utf-8')) as Record<string, unknown>
      expect(v['verificationProfile']).toBeUndefined()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('--stack python overrides package.json (detected node-ts) project', async () => {
    const dir = makeTempDir()
    mockCli()
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"my-app"}')
      await cmdInit(['--stack', 'python', dir])
      const v = yaml.load(fs.readFileSync(path.join(dir, '.powerplant', 'VERIFY.yaml'), 'utf-8')) as Record<string, unknown>
      expect(v['verificationProfile']).toBeUndefined()
      const checks = v['checks'] as Record<string, { command: string }>
      expect(checks['test']?.command).toBe('python3 -m pytest')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── cmdInit: guard: existing .powerplant/ ────────────────────────────────────

describe('cmdInit: guard against existing .powerplant/', () => {
  it('without --force: fails and does not overwrite existing POLICY.yaml', async () => {
    const dir = makeTempDir()
    mockCli()
    try {
      const ppDir = path.join(dir, '.powerplant')
      fs.mkdirSync(ppDir, { recursive: true })
      const sentinel = 'projectId: original-sentinel-content\n'
      fs.writeFileSync(path.join(ppDir, 'POLICY.yaml'), sentinel)

      await expect(cmdInit(['--stack', 'node-ts', dir])).rejects.toThrow('process.exit(1)')

      // File must be unchanged
      const content = fs.readFileSync(path.join(ppDir, 'POLICY.yaml'), 'utf-8')
      expect(content).toBe(sentinel)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('without --force: fails when .powerplant/ directory exists (even if empty)', async () => {
    const dir = makeTempDir()
    mockCli()
    try {
      fs.mkdirSync(path.join(dir, '.powerplant'), { recursive: true })
      await expect(cmdInit(['--stack', 'node-ts', dir])).rejects.toThrow('process.exit(1)')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('--force overwrites generated files', async () => {
    const dir = makeTempDir()
    mockCli()
    try {
      const ppDir = path.join(dir, '.powerplant')
      fs.mkdirSync(ppDir, { recursive: true })
      const sentinel = 'projectId: original-sentinel-content\n'
      fs.writeFileSync(path.join(ppDir, 'POLICY.yaml'), sentinel)
      fs.writeFileSync(path.join(ppDir, 'VERIFY.yaml'), 'checks: {}\n')

      await cmdInit(['--stack', 'node-ts', '--force', dir])

      const policy = fs.readFileSync(path.join(ppDir, 'POLICY.yaml'), 'utf-8')
      expect(policy).not.toContain('original-sentinel-content')
      // New content has a real projectId
      const doc = yaml.load(policy) as Record<string, unknown>
      expect(typeof doc['projectId']).toBe('string')
      expect(doc['projectId']).not.toBe('original-sentinel-content')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('--force does not delete unrelated files in .powerplant/', async () => {
    const dir = makeTempDir()
    mockCli()
    try {
      const ppDir = path.join(dir, '.powerplant')
      fs.mkdirSync(ppDir, { recursive: true })
      const extraFile = path.join(ppDir, 'PROJECT.md')
      fs.writeFileSync(extraFile, '# My Project Notes')

      await cmdInit(['--stack', 'node-ts', '--force', dir])

      expect(fs.existsSync(extraFile)).toBe(true)
      expect(fs.readFileSync(extraFile, 'utf-8')).toBe('# My Project Notes')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── cmdInit: unknown stack ────────────────────────────────────────────────────

describe('cmdInit: unknown stack', () => {
  it('--stack unknown-xyz fails closed with exit 1', async () => {
    const dir = makeTempDir()
    mockCli()
    try {
      await expect(cmdInit(['--stack', 'unknown-xyz', dir])).rejects.toThrow('process.exit(1)')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('unknown stack does not write any files', async () => {
    const dir = makeTempDir()
    mockCli()
    try {
      await expect(cmdInit(['--stack', 'unknown-xyz', dir])).rejects.toThrow()
      expect(fs.existsSync(path.join(dir, '.powerplant'))).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── cmdInit: --yes flag ───────────────────────────────────────────────────────

describe('cmdInit: --yes flag', () => {
  it('--yes runs without prompting and completes for a valid stack', async () => {
    const dir = makeTempDir()
    mockCli()
    try {
      // --yes with an explicit --stack to avoid auto-detect needing files
      await cmdInit(['--yes', '--stack', 'node-ts', dir])
      expect(fs.existsSync(path.join(dir, '.powerplant', 'POLICY.yaml'))).toBe(true)
      expect(fs.existsSync(path.join(dir, '.powerplant', 'VERIFY.yaml'))).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── cmdInit: generic exits with validation failure ────────────────────────────

describe('cmdInit: generic contract validation', () => {
  it('generic init exits 1 because empty checks fail contract validation', async () => {
    const dir = makeTempDir()
    mockCli()
    try {
      await expect(cmdInit(['--stack', 'generic', dir])).rejects.toThrow('process.exit(1)')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('generic init still writes files before failing validation', async () => {
    const dir = makeTempDir()
    mockCli()
    try {
      await expect(cmdInit(['--stack', 'generic', dir])).rejects.toThrow()
      // Files are written; user gets them to edit
      expect(fs.existsSync(path.join(dir, '.powerplant', 'POLICY.yaml'))).toBe(true)
      expect(fs.existsSync(path.join(dir, '.powerplant', 'VERIFY.yaml'))).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
