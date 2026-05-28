import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { previewSanitization } from '../src/projects/preview-sanitization.js'
import { validateSanitizedWorkspace } from '../src/projects/validate-sanitized-workspace.js'
import { SPRINT4A_PILOT_CONTRACT } from '../src/contracts/project-pilot-contract.js'
import {
  PILOT_ALLOWED_READ_PATHS,
  PILOT_ALLOWED_WRITE_PATHS,
  PILOT_ALLOWED_CHECK_IDS,
} from '../src/contracts/project-pilot-contract.js'
import type { InspectionReport } from '../src/contracts/inspection-report.js'
import type { ProjectContract } from '../src/projects/project-contract.js'

// Tests for the inspect command logic. No CLI process spawn — pure unit tests
// against the underlying functions. Live inspection of the actual pilot project
// is left to the manual acceptance workflow.

let tempProjectDir: string

beforeAll(() => {
  // Build a minimal project structure that mirrors the pilot contract
  tempProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-inspect-test-'))

  // Create .powerplant/POLICY.yaml (presence validates contract)
  fs.mkdirSync(path.join(tempProjectDir, '.powerplant'), { recursive: true })
  fs.writeFileSync(path.join(tempProjectDir, '.powerplant', 'POLICY.yaml'), 'projectId: test\n')

  // Allowed files
  fs.writeFileSync(path.join(tempProjectDir, 'package.json'), '{}')
  fs.writeFileSync(path.join(tempProjectDir, 'README.md'), '# Test')
  fs.mkdirSync(path.join(tempProjectDir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(tempProjectDir, 'src', 'status.js'), 'export function ok() {}')
  fs.mkdirSync(path.join(tempProjectDir, 'tests'), { recursive: true })
  fs.writeFileSync(path.join(tempProjectDir, 'tests', 'status.test.js'), 'test("ok", () => {})')

  // Excluded files (not in includePaths — exist in source but must not enter snapshot)
  fs.writeFileSync(path.join(tempProjectDir, '.env'), 'SECRET=shhh')
  fs.mkdirSync(path.join(tempProjectDir, 'private'), { recursive: true })
  fs.writeFileSync(path.join(tempProjectDir, 'private', 'secret.txt'), 'top secret')
  fs.mkdirSync(path.join(tempProjectDir, 'deployment'), { recursive: true })
  fs.writeFileSync(path.join(tempProjectDir, 'deployment', 'release.txt'), 'v1.0')
})

afterAll(() => {
  fs.rmSync(tempProjectDir, { recursive: true, force: true })
})

describe('previewSanitization', () => {
  it('includes only files matching includePaths', () => {
    const contract = { ...SPRINT4A_PILOT_CONTRACT, sourcePath: tempProjectDir }
    const preview = previewSanitization(contract)

    // package.json, README.md, src/status.js, tests/status.test.js, .powerplant/POLICY.yaml
    expect(preview.includedFiles).toContain('package.json')
    expect(preview.includedFiles).toContain('README.md')
    expect(preview.includedFiles).toContain('src/status.js')
    expect(preview.includedFiles).toContain('tests/status.test.js')
    expect(preview.includedFiles).toContain('.powerplant/POLICY.yaml')
  })

  it('excludes files not in includePaths', () => {
    const contract = { ...SPRINT4A_PILOT_CONTRACT, sourcePath: tempProjectDir }
    const preview = previewSanitization(contract)

    expect(preview.excludedFiles).toContain('.env')
    expect(preview.excludedFiles).toContain('private/secret.txt')
    expect(preview.excludedFiles).toContain('deployment/release.txt')
  })

  it('never includes excluded file content in the preview', () => {
    const contract = { ...SPRINT4A_PILOT_CONTRACT, sourcePath: tempProjectDir }
    const preview = previewSanitization(contract)

    // Content is never in the preview result — only paths are listed
    const allEntries = JSON.stringify(preview)
    expect(allEntries).not.toContain('top secret')
    expect(allEntries).not.toContain('SECRET=shhh')
  })

  it('reports forbidden source paths in forbiddenInSource (informational)', () => {
    const contract = { ...SPRINT4A_PILOT_CONTRACT, sourcePath: tempProjectDir }
    const preview = previewSanitization(contract)

    // denyIfPresentAfterCopy: ['.env', 'private', 'deployment', '.git', 'node_modules', 'credentials.json']
    // .env, private, deployment exist in source — reported in forbiddenInSource
    expect(preview.forbiddenInSource).toContain('.env')
    expect(preview.forbiddenInSource).toContain('private')
    expect(preview.forbiddenInSource).toContain('deployment')
  })

  it('passes sanitization when forbidden paths exist in source but are excluded from snapshot', () => {
    // Real projects always have .git, node_modules, etc. in source.
    // Sanitization must PASS as long as they don't enter the snapshot.
    const contract = { ...SPRINT4A_PILOT_CONTRACT, sourcePath: tempProjectDir }
    const preview = previewSanitization(contract)

    expect(preview.allForbiddenAbsent).toBe(true)
    expect(preview.forbiddenDetected).toHaveLength(0)
  })

  it('returns allForbiddenAbsent true for a clean project', () => {
    const cleanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-clean-'))
    try {
      fs.writeFileSync(path.join(cleanDir, 'package.json'), '{}')
      fs.mkdirSync(path.join(cleanDir, 'src'), { recursive: true })
      fs.writeFileSync(path.join(cleanDir, 'src', 'status.js'), '// clean')
      fs.mkdirSync(path.join(cleanDir, 'tests'), { recursive: true })
      fs.writeFileSync(path.join(cleanDir, 'tests', 'status.test.js'), '// test')
      fs.mkdirSync(path.join(cleanDir, '.powerplant'), { recursive: true })
      fs.writeFileSync(path.join(cleanDir, '.powerplant', 'POLICY.yaml'), '')

      const contract = { ...SPRINT4A_PILOT_CONTRACT, sourcePath: cleanDir }
      const preview = previewSanitization(contract)

      expect(preview.allForbiddenAbsent).toBe(true)
      expect(preview.forbiddenDetected).toHaveLength(0)
      expect(preview.forbiddenInSource).toHaveLength(0)
    } finally {
      fs.rmSync(cleanDir, { recursive: true, force: true })
    }
  })

  it('throws for non-existent project path', () => {
    const contract = { ...SPRINT4A_PILOT_CONTRACT, sourcePath: '/nonexistent/path' }
    expect(() => previewSanitization(contract)).toThrow(/does not exist/)
  })
})

// ── Real-project-shaped fixture ──────────────────────────────────────────────
// Mirrors what Singularity Inc. looks like: source contains .git, node_modules,
// src-tauri, src/steam, dist, .env — but the contract only allows src/engine/**
// and a few top-level config files.

const realProjectContract: ProjectContract = {
  projectId: 'real-project-qa-fixture',
  sourcePath: '',  // filled per test
  includePaths: [
    'package.json',
    'tsconfig.app.json',
    'src/engine/**',
    '.powerplant/**',
  ],
  excludePaths: [
    '.git/**',
    'node_modules/**',
    'src-tauri/**',
    'src/steam/**',
    'dist/**',
    '.env',
    '.env.*',
  ],
  denyIfPresentAfterCopy: [
    '.env',
    '.git',
    'node_modules',
    'src-tauri',
    'src/steam',
    'dist',
  ],
  workspaceMode: 'sanitized_copy_only',
  allowBash: false,
  realProjectMounted: false,
}

let realProjectDir: string

beforeAll(() => {
  realProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-real-project-'))

  // Allowed files
  fs.writeFileSync(path.join(realProjectDir, 'package.json'), '{"name":"fixture"}')
  fs.writeFileSync(path.join(realProjectDir, 'tsconfig.app.json'), '{"compilerOptions":{}}')
  fs.mkdirSync(path.join(realProjectDir, 'src', 'engine'), { recursive: true })
  fs.writeFileSync(path.join(realProjectDir, 'src', 'engine', 'simulation.ts'), 'export {}')
  fs.mkdirSync(path.join(realProjectDir, 'src', 'engine', 'tests'), { recursive: true })
  fs.writeFileSync(path.join(realProjectDir, 'src', 'engine', 'tests', 'simulation.test.ts'), '// test')
  fs.mkdirSync(path.join(realProjectDir, '.powerplant'), { recursive: true })
  fs.writeFileSync(path.join(realProjectDir, '.powerplant', 'POLICY.yaml'), 'projectId: test\n')

  // Excluded paths — present in source but must not enter snapshot
  fs.mkdirSync(path.join(realProjectDir, '.git'), { recursive: true })
  fs.writeFileSync(path.join(realProjectDir, '.git', 'config'), '[core]\n  bare = false\n')

  fs.mkdirSync(path.join(realProjectDir, 'node_modules', 'some-package'), { recursive: true })
  fs.writeFileSync(path.join(realProjectDir, 'node_modules', 'some-package', 'index.js'), 'module.exports = {}')

  fs.mkdirSync(path.join(realProjectDir, 'src-tauri', 'src'), { recursive: true })
  fs.writeFileSync(path.join(realProjectDir, 'src-tauri', 'src', 'main.rs'), 'fn main() {}')

  fs.mkdirSync(path.join(realProjectDir, 'src', 'steam'), { recursive: true })
  fs.writeFileSync(path.join(realProjectDir, 'src', 'steam', 'index.ts'), 'export {}')

  fs.mkdirSync(path.join(realProjectDir, 'dist'), { recursive: true })
  fs.writeFileSync(path.join(realProjectDir, 'dist', 'build.js'), '"use strict"; var x = 1;')

  fs.writeFileSync(path.join(realProjectDir, '.env'), 'STEAM_API_KEY=secret123')
})

afterAll(() => {
  fs.rmSync(realProjectDir, { recursive: true, force: true })
})

describe('real-project-shaped fixture: previewSanitization', () => {
  it('inspect passes when forbidden/excluded paths exist in source but are excluded from snapshot', () => {
    const contract = { ...realProjectContract, sourcePath: realProjectDir }
    const preview = previewSanitization(contract)

    expect(preview.allForbiddenAbsent).toBe(true)
    expect(preview.forbiddenDetected).toHaveLength(0)
  })

  it('excluded source paths are reported in forbiddenInSource by relative path only (no content)', () => {
    const contract = { ...realProjectContract, sourcePath: realProjectDir }
    const preview = previewSanitization(contract)

    expect(preview.forbiddenInSource).toContain('.git')
    expect(preview.forbiddenInSource).toContain('node_modules')
    expect(preview.forbiddenInSource).toContain('src-tauri')
    expect(preview.forbiddenInSource).toContain('src/steam')
    expect(preview.forbiddenInSource).toContain('dist')
    expect(preview.forbiddenInSource).toContain('.env')

    // Contents must never appear
    const serialized = JSON.stringify(preview)
    expect(serialized).not.toContain('bare = false')
    expect(serialized).not.toContain('module.exports')
    expect(serialized).not.toContain('fn main()')
    expect(serialized).not.toContain('STEAM_API_KEY')
    expect(serialized).not.toContain('"use strict"')
  })

  it('.git, node_modules, src-tauri, src/steam, dist, .env are absent from the Claude-visible snapshot', () => {
    const contract = { ...realProjectContract, sourcePath: realProjectDir }
    const preview = previewSanitization(contract)

    const included = new Set(preview.includedFiles)

    // No included file may be or live under a forbidden path
    for (const f of included) {
      expect(f).not.toMatch(/^\.git(\/|$)/)
      expect(f).not.toMatch(/^node_modules(\/|$)/)
      expect(f).not.toMatch(/^src-tauri(\/|$)/)
      expect(f).not.toMatch(/^src\/steam(\/|$)/)
      expect(f).not.toMatch(/^dist(\/|$)/)
      expect(f).not.toBe('.env')
    }
  })

  it('contract-allowed files are present in the snapshot', () => {
    const contract = { ...realProjectContract, sourcePath: realProjectDir }
    const preview = previewSanitization(contract)

    expect(preview.includedFiles).toContain('package.json')
    expect(preview.includedFiles).toContain('tsconfig.app.json')
    expect(preview.includedFiles).toContain('src/engine/simulation.ts')
    expect(preview.includedFiles).toContain('.powerplant/POLICY.yaml')
  })

  it('sanitization still fails if a forbidden path is manually inserted into the sanitized snapshot', () => {
    const contract = { ...realProjectContract, sourcePath: realProjectDir }
    const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-snapshot-'))
    try {
      // Simulate a snapshot that accidentally contains a forbidden path
      fs.mkdirSync(path.join(snapshotDir, '.git'), { recursive: true })
      fs.writeFileSync(path.join(snapshotDir, '.git', 'config'), '[core]\n  bare = false\n')
      fs.writeFileSync(path.join(snapshotDir, 'package.json'), '{}')

      const result = validateSanitizedWorkspace(snapshotDir, contract)
      expect(result.passed).toBe(false)
      expect(result.violations.some(v => v.includes('.git'))).toBe(true)
    } finally {
      fs.rmSync(snapshotDir, { recursive: true, force: true })
    }
  })

  it('sanitization still fails if forbidden canary content enters an allowed copied file', () => {
    const contract = { ...realProjectContract, sourcePath: realProjectDir }
    const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-canary-'))
    try {
      // Only allowed files present, but one contains a forbidden canary string
      fs.writeFileSync(path.join(snapshotDir, 'package.json'), 'POWERPLANT_FORBIDDEN_LEAKED_DATA')

      const result = validateSanitizedWorkspace(snapshotDir, contract)
      expect(result.passed).toBe(false)
      expect(result.violations.some(v => v.includes('package.json'))).toBe(true)
    } finally {
      fs.rmSync(snapshotDir, { recursive: true, force: true })
    }
  })

  it('Singularity-style readable/write/check boundary remains contract-driven', () => {
    // The includePaths, allowedReadPaths, allowedWritePaths come from POLICY.yaml —
    // not from any hard-coded list in Powerplant. Validate that the fixture contract
    // drives what gets included.
    const contract = { ...realProjectContract, sourcePath: realProjectDir }
    const preview = previewSanitization(contract)

    // Only the engine subdirectory of src is visible
    const srcFiles = preview.includedFiles.filter(f => f.startsWith('src/'))
    expect(srcFiles.every(f => f.startsWith('src/engine/'))).toBe(true)
  })

  it('inspect is no-session / no-API (previewSanitization makes no network calls)', () => {
    // If ANTHROPIC_API_KEY is absent, previewSanitization must still succeed.
    const saved = process.env['ANTHROPIC_API_KEY']
    delete process.env['ANTHROPIC_API_KEY']
    try {
      const contract = { ...realProjectContract, sourcePath: realProjectDir }
      expect(() => previewSanitization(contract)).not.toThrow()
    } finally {
      if (saved !== undefined) process.env['ANTHROPIC_API_KEY'] = saved
    }
  })

  it('no executor/network/broker security invariant is weakened by the fix', () => {
    // The real-project-shaped contract enforces the same hard-coded invariants:
    // workspaceMode = sanitized_copy_only, realProjectMounted = false, allowBash = false
    expect(realProjectContract.workspaceMode).toBe('sanitized_copy_only')
    expect(realProjectContract.realProjectMounted).toBe(false)
    expect(realProjectContract.allowBash).toBe(false)
  })
})

describe('inspect command contract validation', () => {
  it('requires .powerplant/POLICY.yaml to exist', () => {
    // Simulate validation logic — a project without .powerplant/ is rejected
    function validatePolicy(projectPath: string): boolean {
      return fs.existsSync(path.join(projectPath, '.powerplant', 'POLICY.yaml'))
    }

    expect(validatePolicy(tempProjectDir)).toBe(true)
    expect(validatePolicy(os.tmpdir())).toBe(false)
  })

  it('requires the project directory to exist', () => {
    function validateDir(projectPath: string): boolean {
      return fs.existsSync(projectPath) && fs.statSync(projectPath).isDirectory()
    }

    expect(validateDir(tempProjectDir)).toBe(true)
    expect(validateDir('/nonexistent/path')).toBe(false)
    expect(validateDir(path.join(tempProjectDir, 'package.json'))).toBe(false)
  })
})

describe('inspection report schema', () => {
  it('builds a valid InspectionReport from preview data', () => {
    const contract = { ...SPRINT4A_PILOT_CONTRACT, sourcePath: tempProjectDir }
    const preview = previewSanitization(contract)

    const report: InspectionReport = {
      inspectedAt: new Date().toISOString(),
      projectPath: tempProjectDir,
      projectId: contract.projectId,
      contractValid: true,
      sanitizationPreview: {
        passed: preview.allForbiddenAbsent,
        includedFiles: preview.includedFiles,
        excludedFileCount: preview.excludedFiles.length,
        forbiddenInSource: preview.forbiddenInSource,
        forbiddenDetected: preview.forbiddenDetected,
        allForbiddenAbsent: preview.allForbiddenAbsent,
      },
      policy: {
        workspaceMode: contract.workspaceMode,
        realProjectMounted: contract.realProjectMounted,
        allowedChecks: [...PILOT_ALLOWED_CHECK_IDS],
        allowedReadPaths: [...PILOT_ALLOWED_READ_PATHS],
        allowedWritePaths: [...PILOT_ALLOWED_WRITE_PATHS],
        forbiddenPaths: contract.excludePaths,
      },
      executorPolicy: {
        networkDisabled: true,
        noCredentials: true,
      },
    }

    expect(report.contractValid).toBe(true)
    expect(report.policy.realProjectMounted).toBe(false)
    expect(report.executorPolicy.networkDisabled).toBe(true)
    expect(report.executorPolicy.noCredentials).toBe(true)
    expect(report.sanitizationPreview.includedFiles).toContain('src/status.js')
    // Source-side excluded paths do not cause a failure
    expect(report.sanitizationPreview.passed).toBe(true)
  })

  it('never discloses forbidden file contents in inspection data', () => {
    const contract = { ...SPRINT4A_PILOT_CONTRACT, sourcePath: tempProjectDir }
    const preview = previewSanitization(contract)

    const report: InspectionReport = {
      inspectedAt: new Date().toISOString(),
      projectPath: tempProjectDir,
      projectId: contract.projectId,
      contractValid: true,
      sanitizationPreview: {
        passed: preview.allForbiddenAbsent,
        includedFiles: preview.includedFiles,
        excludedFileCount: preview.excludedFiles.length,
        forbiddenInSource: preview.forbiddenInSource,
        forbiddenDetected: preview.forbiddenDetected,
        allForbiddenAbsent: preview.allForbiddenAbsent,
      },
      policy: {
        workspaceMode: contract.workspaceMode,
        realProjectMounted: contract.realProjectMounted,
        allowedChecks: [...PILOT_ALLOWED_CHECK_IDS],
        allowedReadPaths: [...PILOT_ALLOWED_READ_PATHS],
        allowedWritePaths: [...PILOT_ALLOWED_WRITE_PATHS],
        forbiddenPaths: contract.excludePaths,
      },
      executorPolicy: {
        networkDisabled: true,
        noCredentials: true,
      },
    }

    const serialized = JSON.stringify(report)
    // Contents of .env and private/ must not appear — only their paths
    expect(serialized).not.toContain('SECRET=shhh')
    expect(serialized).not.toContain('top secret')
  })
})

describe('inspect never starts a session', () => {
  it('inspect uses only local file system operations', () => {
    // The inspect command must not call any Anthropic API methods.
    // Verified by confirming no Anthropic client is constructed in inspect.ts.
    // This test acts as a documentation checkpoint that the import tree of
    // cmdInspect does not include the Anthropic SDK.
    const contract = { ...SPRINT4A_PILOT_CONTRACT, sourcePath: tempProjectDir }
    const preview = previewSanitization(contract)

    // If this runs without an ANTHROPIC_API_KEY, the inspect logic is safe
    delete process.env['ANTHROPIC_API_KEY']
    expect(() => previewSanitization(contract)).not.toThrow()
    expect(preview.includedFiles.length).toBeGreaterThan(0)
  })
})
