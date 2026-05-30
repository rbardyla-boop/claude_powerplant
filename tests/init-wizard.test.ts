import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import yaml from 'js-yaml'
import { generatePolicyYaml, generateProjectId } from '../src/projects/generate-policy.js'
import { generateVerifyYaml } from '../src/projects/generate-verify.js'
import { loadProjectContract } from '../src/projects/load-project-contract.js'
import { cmdInit } from '../src/cli/commands/init.js'
import type { StackId } from '../src/projects/detect-stack.js'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pp-init-'))
}

// ── generateProjectId ─────────────────────────────────────────────────────────

describe('generateProjectId', () => {
  it('format: <dirname>-<8 hex chars>', () => {
    const id = generateProjectId('/some/path/my-project')
    expect(id).toMatch(/^my-project-[0-9a-f]{8}$/)
  })

  it('two calls produce different suffixes', () => {
    const a = generateProjectId('/some/path/proj')
    const b = generateProjectId('/some/path/proj')
    expect(a).not.toBe(b)
  })
})

// ── generatePolicyYaml ────────────────────────────────────────────────────────

describe('generatePolicyYaml', () => {
  const stacks: StackId[] = ['node-ts', 'python', 'go', 'rust', 'generic']

  const REQUIRED_EXCLUDES = [
    '**/.git/**', '**/node_modules/**', '.env', '.env.*', '**/*.key', '**/*.pem',
    '**/.venv/**', '**/venv/**', '**/__pycache__/**', '**/.pytest_cache/**',
  ]

  for (const stack of stacks) {
    describe(`stack: ${stack}`, () => {
      let doc: Record<string, unknown>

      beforeEach(() => {
        doc = yaml.load(generatePolicyYaml(stack, `test-${stack}-abcd1234`)) as Record<string, unknown>
      })

      it('projectId matches', () => {
        expect(doc['projectId']).toBe(`test-${stack}-abcd1234`)
      })

      it('includePaths is non-empty', () => {
        const paths = doc['includePaths'] as string[]
        expect(Array.isArray(paths)).toBe(true)
        expect(paths.length).toBeGreaterThan(0)
      })

      it('excludePaths contains all required security entries', () => {
        const excludes = doc['excludePaths'] as string[]
        for (const entry of REQUIRED_EXCLUDES) {
          expect(excludes).toContain(entry)
        }
      })

      it('allowedReadPaths is non-empty', () => {
        const readPaths = doc['allowedReadPaths'] as string[]
        expect(Array.isArray(readPaths)).toBe(true)
        expect(readPaths.length).toBeGreaterThan(0)
      })

      it('allowedWritePaths is present', () => {
        expect(Array.isArray(doc['allowedWritePaths'])).toBe(true)
      })
    })
  }
})

// ── generateVerifyYaml ────────────────────────────────────────────────────────

describe('generateVerifyYaml', () => {
  const cases: Array<[StackId, string | undefined, string[]]> = [
    ['node-ts',  'node-vitest-typescript-v1', ['test', 'typecheck']],
    ['python',   undefined,                   ['test']],  // no capsule shipped
    ['go',       undefined,                   ['test']],  // no capsule shipped
    ['rust',     undefined,                   ['test']],  // no capsule shipped
    ['generic',  undefined,                   []],        // no capsule shipped
  ]

  for (const [stack, expectedProfile, expectedCheckKeys] of cases) {
    describe(`stack: ${stack}`, () => {
      let doc: Record<string, unknown>

      beforeEach(() => {
        doc = yaml.load(generateVerifyYaml(stack)) as Record<string, unknown>
      })

      it(`verificationProfile: ${expectedProfile ?? 'undefined (no capsule)'}`, () => {
        if (expectedProfile !== undefined) {
          expect(doc['verificationProfile']).toBe(expectedProfile)
        } else {
          expect(doc['verificationProfile']).toBeUndefined()
        }
      })

      if (expectedCheckKeys.length > 0) {
        it(`checks contains expected keys: ${expectedCheckKeys.join(', ')}`, () => {
          const checks = doc['checks'] as Record<string, unknown>
          for (const key of expectedCheckKeys) {
            expect(checks).toHaveProperty(key)
          }
        })
      } else {
        it('checks is empty (user must populate for generic)', () => {
          const checks = doc['checks'] as Record<string, unknown>
          expect(Object.keys(checks)).toHaveLength(0)
        })
      }
    })
  }
})

// ── Integration: generate → write → loadProjectContract ──────────────────────

describe('generate → write → validate integration', () => {
  let dir: string

  beforeEach(() => { dir = makeTempDir() })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  const validStacks: StackId[] = ['node-ts', 'python', 'go', 'rust']

  for (const stack of validStacks) {
    it(`${stack}: generated files pass loadProjectContract`, () => {
      const ppDir = path.join(dir, '.powerplant')
      fs.mkdirSync(ppDir)
      fs.writeFileSync(path.join(ppDir, 'POLICY.yaml'), generatePolicyYaml(stack, `test-${stack}-abcd1234`), 'utf-8')
      fs.writeFileSync(path.join(ppDir, 'VERIFY.yaml'), generateVerifyYaml(stack), 'utf-8')
      expect(() => loadProjectContract(dir)).not.toThrow()
    })
  }

  it('generic: generated VERIFY.yaml fails loadProjectContract (empty checks)', () => {
    const ppDir = path.join(dir, '.powerplant')
    fs.mkdirSync(ppDir)
    fs.writeFileSync(path.join(ppDir, 'POLICY.yaml'), generatePolicyYaml('generic', 'test-generic-abcd1234'), 'utf-8')
    fs.writeFileSync(path.join(ppDir, 'VERIFY.yaml'), generateVerifyYaml('generic'), 'utf-8')
    expect(() => loadProjectContract(dir)).toThrow(/must define at least one check/)
  })
})

// ── cmdInit ───────────────────────────────────────────────────────────────────

describe('cmdInit', () => {
  let dir: string

  beforeEach(() => { dir = makeTempDir() })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('writes POLICY.yaml and VERIFY.yaml, contract validates for node-ts', async () => {
    await cmdInit([dir, '--stack', 'node-ts'])
    expect(fs.existsSync(path.join(dir, '.powerplant', 'POLICY.yaml'))).toBe(true)
    expect(fs.existsSync(path.join(dir, '.powerplant', 'VERIFY.yaml'))).toBe(true)
    expect(() => loadProjectContract(dir)).not.toThrow()
  })

  it('existing .powerplant/ without --force exits 1 and does not overwrite', async () => {
    const ppDir = path.join(dir, '.powerplant')
    fs.mkdirSync(ppDir)
    const sentinel = path.join(ppDir, 'POLICY.yaml')
    fs.writeFileSync(sentinel, 'projectId: must-not-change', 'utf-8')

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null): never => {
      throw new Error(`process.exit(${_code})`)
    })
    try {
      await expect(cmdInit([dir])).rejects.toThrow('process.exit(1)')
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
    }

    expect(fs.readFileSync(sentinel, 'utf-8')).toBe('projectId: must-not-change')
  })

  it('--force overwrites existing .powerplant/ files', async () => {
    const ppDir = path.join(dir, '.powerplant')
    fs.mkdirSync(ppDir)
    fs.writeFileSync(path.join(ppDir, 'POLICY.yaml'), 'projectId: old', 'utf-8')
    fs.writeFileSync(path.join(ppDir, 'VERIFY.yaml'), 'checks:\n  test:\n    command: echo\n', 'utf-8')

    await cmdInit([dir, '--force', '--stack', 'node-ts'])
    const content = fs.readFileSync(path.join(ppDir, 'POLICY.yaml'), 'utf-8')
    expect(content).not.toContain('projectId: old')
    expect(() => loadProjectContract(dir)).not.toThrow()
  })

  it('non-existent project path exits 1', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null): never => {
      throw new Error(`process.exit(${_code})`)
    })
    try {
      await expect(cmdInit([path.join(dir, 'does-not-exist')])).rejects.toThrow('process.exit(1)')
    } finally {
      exitSpy.mockRestore()
    }
  })
})

// ── Subprocess portability: generated VERIFY.yaml check commands ──────────────
//
// Enforces docs/VERIFY_PROFILE_CONSTRAINTS.md:
// Non-capsule stacks run checks in an isolated subprocess without user ~/.local packages.
// Generated commands must use stdlib-portable invocations (no bare pytest/ruff/mypy).
// See: docs/VERIFY_PROFILE_CONSTRAINTS.md

describe('subprocess portability: generated VERIFY.yaml check commands', () => {
  // Bare tool names that fail when user ~/.local/bin is not in PATH.
  // Commands like `python3 -m pytest` are OK; bare `pytest` is not.
  const SUBPROCESS_UNSAFE_BARE_COMMANDS = ['pytest', 'ruff', 'mypy', 'black', 'flake8', 'pylint', 'poetry']

  const stacks: StackId[] = ['node-ts', 'python', 'go', 'rust', 'generic']

  for (const stack of stacks) {
    it(`${stack}: no check command uses a bare user-installed tool`, () => {
      const doc = yaml.load(generateVerifyYaml(stack)) as Record<string, unknown>
      const checks = (doc['checks'] ?? {}) as Record<string, { command: string }>
      for (const [checkId, check] of Object.entries(checks)) {
        const cmd = check.command
        const firstToken = cmd.trim().split(/\s+/)[0]
        expect(
          SUBPROCESS_UNSAFE_BARE_COMMANDS,
          `check '${checkId}' for stack '${stack}' uses bare tool '${firstToken}' — use 'python3 -m ${firstToken}' form instead (see docs/VERIFY_PROFILE_CONSTRAINTS.md)`
        ).not.toContain(firstToken)
      }
    })
  }
})
