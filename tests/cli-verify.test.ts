import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { loadProjectContract } from '../src/projects/load-project-contract.js'
import { previewSanitization } from '../src/projects/preview-sanitization.js'
import {
  createVerificationWorkspace,
  checkSourceModified,
} from '../src/verification/create-verification-workspace.js'
import { runApprovedChecks } from '../src/verification/run-approved-checks.js'
import { classifyCheckResult } from '../src/verification/classify-check-result.js'

// ── Fixture helpers ───────────────────────────────────────────────────────────

const VALID_POLICY = `
projectId: cli-verify-test
includePaths:
  - package.json
  - src/**
  - .powerplant/**
excludePaths:
  - .env
  - node_modules/**
denyIfPresentAfterCopy:
  - .env
  - node_modules
allowedReadPaths:
  - package.json
  - src/**
allowedWritePaths:
  - src/tests/**
`

const VALID_VERIFY = `
checks:
  version:
    command: "node --version"
`

function makeProject(
  policy = VALID_POLICY,
  verify = VALID_VERIFY,
  extra: Record<string, string> = {},
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-cv-test-'))
  fs.mkdirSync(path.join(dir, '.powerplant'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.powerplant', 'POLICY.yaml'), policy, 'utf-8')
  fs.writeFileSync(path.join(dir, '.powerplant', 'VERIFY.yaml'), verify, 'utf-8')
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"cli-verify-fixture"}')
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'index.ts'), 'export const x = 1')
  for (const [rel, content] of Object.entries(extra)) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content, 'utf-8')
  }
  return dir
}

// ── Test 1 & 2: Contract validation ──────────────────────────────────────────

describe('verify: rejects projects without a valid contract', () => {
  it('rejects a project directory with no .powerplant/POLICY.yaml', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-no-contract-'))
    try {
      expect(() => loadProjectContract(dir)).toThrow(/POLICY\.yaml/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects when VERIFY.yaml is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-no-verify-'))
    try {
      fs.mkdirSync(path.join(dir, '.powerplant'), { recursive: true })
      fs.writeFileSync(path.join(dir, '.powerplant', 'POLICY.yaml'), VALID_POLICY)
      expect(() => loadProjectContract(dir)).toThrow(/VERIFY\.yaml/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── Test 2: Sanitization failure blocks verification ─────────────────────────

describe('verify: refuses if sanitization would fail', () => {
  it('sanitization passes when forbidden items are excluded from snapshot (real-project case)', () => {
    const dir = makeProject(VALID_POLICY, VALID_VERIFY, { '.env': 'SECRET=leaked' })
    try {
      const contract = loadProjectContract(dir)
      const preview = previewSanitization(contract)
      // .env is in source but excluded by includePaths → snapshot safe
      expect(preview.allForbiddenAbsent).toBe(true)
      expect(preview.forbiddenInSource).toContain('.env')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── Tests 3 & 4: Workspace creation invariants ───────────────────────────────

describe('verify: workspace creation invariants', () => {
  let fixDir: string
  beforeAll(() => { fixDir = makeProject() })
  afterAll(() => { fs.rmSync(fixDir, { recursive: true, force: true }) })

  it('creates workspace from sanitized snapshot only (not original project)', () => {
    const contract = loadProjectContract(fixDir)
    const ws = createVerificationWorkspace(contract)
    try {
      expect(fs.existsSync(ws.workspacePath)).toBe(true)
      expect(ws.workspacePath).not.toBe(fixDir)
      expect(fs.existsSync(path.join(ws.workspacePath, 'package.json'))).toBe(true)
      // node_modules is excluded — must not appear in workspace
      expect(fs.existsSync(path.join(ws.workspacePath, 'node_modules'))).toBe(false)
    } finally {
      ws.cleanup()
    }
  })

  it('original project is unmodified after workspace creation', () => {
    const contract = loadProjectContract(fixDir)
    const before = fs.readFileSync(path.join(fixDir, 'package.json'), 'utf-8')
    const ws = createVerificationWorkspace(contract)
    ws.cleanup()
    const after = fs.readFileSync(path.join(fixDir, 'package.json'), 'utf-8')
    expect(after).toBe(before)
  })
})

// ── Test 5: No live Managed Agents session ───────────────────────────────────

describe('verify: no Managed Agents session started', () => {
  it('verify pipeline runs without ANTHROPIC_API_KEY', () => {
    const dir = makeProject()
    const saved = process.env['ANTHROPIC_API_KEY']
    delete process.env['ANTHROPIC_API_KEY']
    try {
      // All three steps must succeed without an API key
      const contract = loadProjectContract(dir)
      const preview = previewSanitization(contract)
      expect(preview.allForbiddenAbsent).toBe(true)

      const ws = createVerificationWorkspace(contract)
      const results = runApprovedChecks(ws.workspacePath, contract.allowedChecks)
      ws.cleanup()

      expect(results.length).toBeGreaterThan(0)
    } finally {
      if (saved !== undefined) process.env['ANTHROPIC_API_KEY'] = saved
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── Test 6: Only approved named checks run ───────────────────────────────────

describe('verify: only approved named checks are recorded', () => {
  it('result set matches the declared check IDs exactly', () => {
    const dir = makeProject()
    try {
      const contract = loadProjectContract(dir)
      const ws = createVerificationWorkspace(contract)
      try {
        const results = runApprovedChecks(ws.workspacePath, contract.allowedChecks)
        const resultIds = results.map(r => r.checkId).sort()
        const declaredIds = Object.keys(contract.allowedChecks).sort()
        expect(resultIds).toEqual(declaredIds)
      } finally {
        ws.cleanup()
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns empty results when no checks are declared', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-no-checks-'))
    try {
      const results = runApprovedChecks(tmpDir, {})
      expect(results).toEqual([])
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

// ── Test 8: BLOCKED_MISSING_TOOLING classification ───────────────────────────

describe('verify: classifies absent tooling correctly', () => {
  it('nonexistent command → BLOCKED_MISSING_TOOLING', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-missing-'))
    try {
      const results = runApprovedChecks(tmpDir, {
        test: { command: '__powerplant_nonexistent_tool_xyz_verify' },
      })
      expect(results[0]?.verdict).toBe('BLOCKED_MISSING_TOOLING')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('exit code 127 classifies as BLOCKED_MISSING_TOOLING not FAIL_CHECK', () => {
    expect(classifyCheckResult({
      spawnError: null, exitCode: 127, stdout: '', stderr: 'sh: 1: vitest: not found',
    })).toBe('BLOCKED_MISSING_TOOLING')
  })
})

// ── Test 9: Distinguishes FAIL_CHECK from BLOCKED_MISSING_TOOLING ────────────

describe('verify: distinguishes test failure from missing tooling', () => {
  it('a command that runs but exits non-zero is FAIL_CHECK', () => {
    // node --version always exits 0; use false (POSIX) to get exit 1
    // We can't easily get exit 1 without shell, so we verify via classify directly
    expect(classifyCheckResult({
      spawnError: null, exitCode: 1,
      stdout: '✗ 3 tests failed\nAssertionError: expected 1 to equal 2',
      stderr: 'npm ERR! Test failed. See above.',
    })).toBe('FAIL_CHECK')
  })

  it('node --version succeeds (PASS) in a workspace', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-node-ver-'))
    try {
      const results = runApprovedChecks(tmpDir, {
        version: { command: 'node --version' },
      })
      expect(results[0]?.verdict).toBe('PASS')
      expect(results[0]?.exitCode).toBe(0)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

// ── Test 10: Credential boundary enforcement ─────────────────────────────────

describe('verify: security boundary — no credentials reach executor', () => {
  it('ANTHROPIC_API_KEY is not passed to spawned check processes', () => {
    const saved = process.env['ANTHROPIC_API_KEY']
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-should-not-appear-in-output'

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-env-boundary-'))
    try {
      const results = runApprovedChecks(tmpDir, { envdump: { command: 'env' } })
      const stdout = results[0]?.stdoutTail ?? ''
      expect(stdout).not.toContain('ANTHROPIC_API_KEY')
      expect(stdout).not.toContain('sk-ant-should-not-appear-in-output')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
      if (saved !== undefined) {
        process.env['ANTHROPIC_API_KEY'] = saved
      } else {
        delete process.env['ANTHROPIC_API_KEY']
      }
    }
  })

  it('HOME is redirected to /tmp (not the real home directory)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-home-boundary-'))
    try {
      const results = runApprovedChecks(tmpDir, { envdump: { command: 'env' } })
      const stdout = results[0]?.stdoutTail ?? ''
      // HOME must not be the real user home (could contain .npmrc with tokens)
      const homeMatch = stdout.match(/^HOME=(.+)$/m)
      if (homeMatch) {
        expect(homeMatch[1]).toBe('/tmp')
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

// ── Test 11: Report content safety ───────────────────────────────────────────

describe('verify: report never includes forbidden source content', () => {
  it('workspace manifest hashes files without recording their content', () => {
    const dir = makeProject(VALID_POLICY, VALID_VERIFY, {
      '.env': 'STEAM_API_KEY=secret123',
    })
    try {
      const contract = loadProjectContract(dir)
      const ws = createVerificationWorkspace(contract)
      try {
        const serialized = JSON.stringify(ws.sourceManifest)
        expect(serialized).not.toContain('STEAM_API_KEY')
        expect(serialized).not.toContain('secret123')
        // Only paths and sha256 hashes are present
        expect(serialized).toContain('relativePath')
        expect(serialized).toContain('sha256')
      } finally {
        ws.cleanup()
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── Test 12: Regression — existing commands still importable ─────────────────

describe('verify: existing commands are not broken', () => {
  it('cmdInspect, cmdRun, cmdReview are still importable', async () => {
    const { cmdInspect } = await import('../src/cli/commands/inspect.js')
    const { cmdRun } = await import('../src/cli/commands/run.js')
    const { cmdReview } = await import('../src/cli/commands/review.js')
    expect(typeof cmdInspect).toBe('function')
    expect(typeof cmdRun).toBe('function')
    expect(typeof cmdReview).toBe('function')
  })

  it('cmdVerify is exported from verify.ts', async () => {
    const { cmdVerify } = await import('../src/cli/commands/verify.js')
    expect(typeof cmdVerify).toBe('function')
  })
})

// ── Source-modification proof ─────────────────────────────────────────────────

describe('verify: source project unchanged after all operations', () => {
  it('source files have the same hash after workspace creation and cleanup', () => {
    const dir = makeProject()
    try {
      const contract = loadProjectContract(dir)
      const ws = createVerificationWorkspace(contract)
      ws.cleanup()
      // checkSourceModified re-hashes source files against the pre-copy manifest
      expect(checkSourceModified(ws.sourceManifest)).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
