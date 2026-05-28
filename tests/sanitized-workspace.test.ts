import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  buildSanitizedWorkspace,
  matchesGlob,
} from '../src/projects/build-sanitized-workspace.js'
import { validateSanitizedWorkspace } from '../src/projects/validate-sanitized-workspace.js'
import type { ProjectContract } from '../src/projects/project-contract.js'

// ── matchesGlob unit tests ──────────────────────────────────────────────────

describe('matchesGlob', () => {
  it('matches exact filename', () => {
    expect(matchesGlob('package.json', 'package.json')).toBe(true)
    expect(matchesGlob('package.json', 'tsconfig.json')).toBe(false)
  })

  it('matches dir/**', () => {
    expect(matchesGlob('src/index.ts', 'src/**')).toBe(true)
    expect(matchesGlob('src/deep/file.ts', 'src/**')).toBe(true)
    expect(matchesGlob('lib/index.ts', 'src/**')).toBe(false)
  })

  it('matches **/*.ext', () => {
    expect(matchesGlob('src/index.ts', '**/*.ts')).toBe(true)
    expect(matchesGlob('deep/nested/file.ts', '**/*.ts')).toBe(true)
    expect(matchesGlob('file.js', '**/*.ts')).toBe(false)
  })

  it('matches .env.* dotfile pattern', () => {
    expect(matchesGlob('.env.local', '.env.*')).toBe(true)
    expect(matchesGlob('.env.production', '.env.*')).toBe(true)
    expect(matchesGlob('.env', '.env.*')).toBe(false)
  })
})

// ── buildSanitizedWorkspace tests ──────────────────────────────────────────

function makeFixture(tmpDir: string): void {
  // Allowed files
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true })
  fs.mkdirSync(path.join(tmpDir, 'tests'), { recursive: true })
  fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), 'export const x = 1')
  fs.writeFileSync(path.join(tmpDir, 'tests', 'main.test.ts'), '// test')
  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"fixture"}')
  fs.writeFileSync(path.join(tmpDir, 'POWERPLANT_TOKEN.txt'), 'POWERPLANT_ALLOWED_TOKEN')

  // Forbidden files (canary strings)
  fs.writeFileSync(path.join(tmpDir, '.env'), 'POWERPLANT_FORBIDDEN_ENV_CANARY')
  fs.writeFileSync(path.join(tmpDir, 'credentials.json'), 'POWERPLANT_FORBIDDEN_CREDENTIAL_CANARY')
  fs.mkdirSync(path.join(tmpDir, 'private'), { recursive: true })
  fs.writeFileSync(path.join(tmpDir, 'private', 'secret.txt'), 'POWERPLANT_FORBIDDEN_PRIVATE_CANARY')
  fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true })
  fs.writeFileSync(path.join(tmpDir, 'data', 'state.json'), 'POWERPLANT_FORBIDDEN_RUNTIME_CANARY')
}

const testContract: ProjectContract = {
  projectId: 'test-fixture',
  sourcePath: '',  // filled per test
  includePaths: ['src/**', 'tests/**', 'package.json', 'POWERPLANT_TOKEN.txt'],
  excludePaths: ['.env', 'credentials*.json', 'private/**', 'data/**'],
  denyIfPresentAfterCopy: ['.env', 'credentials.json', 'private', 'data'],
  workspaceMode: 'sanitized_copy_only',
  allowBash: true,
  realProjectMounted: false,
}

describe('buildSanitizedWorkspace', () => {
  let tmpSource: string
  let tmpDest: string

  beforeEach(() => {
    tmpSource = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-src-'))
    tmpDest = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-dest-'))
    makeFixture(tmpSource)
  })

  afterEach(() => {
    fs.rmSync(tmpSource, { recursive: true, force: true })
    fs.rmSync(tmpDest, { recursive: true, force: true })
  })

  it('copies allowed files', () => {
    const contract = { ...testContract, sourcePath: tmpSource }
    buildSanitizedWorkspace(contract, tmpDest)
    expect(fs.existsSync(path.join(tmpDest, 'src', 'index.ts'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDest, 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDest, 'POWERPLANT_TOKEN.txt'))).toBe(true)
  })

  it('does not copy .env', () => {
    const contract = { ...testContract, sourcePath: tmpSource }
    buildSanitizedWorkspace(contract, tmpDest)
    expect(fs.existsSync(path.join(tmpDest, '.env'))).toBe(false)
  })

  it('does not copy credentials.json', () => {
    const contract = { ...testContract, sourcePath: tmpSource }
    buildSanitizedWorkspace(contract, tmpDest)
    expect(fs.existsSync(path.join(tmpDest, 'credentials.json'))).toBe(false)
  })

  it('does not copy private/secret.txt', () => {
    const contract = { ...testContract, sourcePath: tmpSource }
    buildSanitizedWorkspace(contract, tmpDest)
    expect(fs.existsSync(path.join(tmpDest, 'private'))).toBe(false)
  })

  it('does not copy data/', () => {
    const contract = { ...testContract, sourcePath: tmpSource }
    buildSanitizedWorkspace(contract, tmpDest)
    expect(fs.existsSync(path.join(tmpDest, 'data'))).toBe(false)
  })

  it('does not modify source files after copy', () => {
    const contract = { ...testContract, sourcePath: tmpSource }
    const before = fs.readFileSync(path.join(tmpSource, 'package.json'), 'utf-8')
    buildSanitizedWorkspace(contract, tmpDest)
    const after = fs.readFileSync(path.join(tmpSource, 'package.json'), 'utf-8')
    expect(after).toBe(before)
  })

  it('rejects symlink inputs', () => {
    const contract = { ...testContract, sourcePath: tmpSource }
    const linkPath = path.join(tmpSource, 'src', 'symlink.ts')
    fs.symlinkSync('/etc/passwd', linkPath)
    expect(() => buildSanitizedWorkspace(contract, tmpDest)).toThrow(/Symlink rejected/)
  })

  it('returns manifest listing only copied files', () => {
    const contract = { ...testContract, sourcePath: tmpSource }
    const { manifest } = buildSanitizedWorkspace(contract, tmpDest)
    const paths = manifest.files.map(f => f.relativePath)
    expect(paths).toContain('package.json')
    expect(paths).toContain('POWERPLANT_TOKEN.txt')
    expect(paths).not.toContain('.env')
    expect(paths).not.toContain('credentials.json')
  })
})

// ── validateSanitizedWorkspace tests ───────────────────────────────────────

describe('validateSanitizedWorkspace', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-validate-'))
    fs.writeFileSync(path.join(tmpDir, 'POWERPLANT_TOKEN.txt'), 'POWERPLANT_ALLOWED_TOKEN')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const contract: ProjectContract = {
    projectId: 'test',
    sourcePath: '',
    includePaths: ['POWERPLANT_TOKEN.txt'],
    excludePaths: [],
    denyIfPresentAfterCopy: ['.env', 'credentials.json'],
    workspaceMode: 'sanitized_copy_only',
    allowBash: true,
    realProjectMounted: false,
  }

  it('passes a clean workspace', () => {
    const result = validateSanitizedWorkspace(tmpDir, contract)
    expect(result.passed).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it('fails if a denied path is present', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'POWERPLANT_ALLOWED_TOKEN')
    const result = validateSanitizedWorkspace(tmpDir, contract)
    expect(result.passed).toBe(false)
    expect(result.violations.some(v => v.includes('.env'))).toBe(true)
  })

  it('fails if a forbidden canary string is found in any file', () => {
    fs.writeFileSync(path.join(tmpDir, 'leaked.txt'), 'POWERPLANT_FORBIDDEN_ENV_CANARY')
    const result = validateSanitizedWorkspace(tmpDir, contract)
    expect(result.passed).toBe(false)
    expect(result.violations.some(v => v.includes('leaked.txt'))).toBe(true)
  })
})
