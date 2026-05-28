import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  createVerificationWorkspace,
  checkSourceModified,
} from '../src/verification/create-verification-workspace.js'
import type { LoadedProjectContract } from '../src/projects/load-project-contract.js'

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeContract(dir: string): LoadedProjectContract {
  return {
    projectId: 'verify-ws-test',
    sourcePath: dir,
    includePaths: ['src/**', 'package.json', '.powerplant/**'],
    excludePaths: ['node_modules/**', '.env'],
    denyIfPresentAfterCopy: ['.env', 'node_modules'],
    workspaceMode: 'sanitized_copy_only',
    allowBash: false,
    realProjectMounted: false,
    allowedReadPaths: ['src/**', 'package.json'],
    allowedWritePaths: ['src/tests/**'],
    allowedChecks: { test: { command: 'npm test' } },
  }
}

let sourceDir: string

beforeAll(() => {
  sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-vws-test-'))

  // Files that should be included
  fs.writeFileSync(path.join(sourceDir, 'package.json'), '{"name":"test"}')
  fs.mkdirSync(path.join(sourceDir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(sourceDir, 'src', 'engine.ts'), 'export const x = 1')
  fs.mkdirSync(path.join(sourceDir, '.powerplant'), { recursive: true })
  fs.writeFileSync(path.join(sourceDir, '.powerplant', 'POLICY.yaml'), 'projectId: test\n')

  // Files that must never enter the workspace
  fs.writeFileSync(path.join(sourceDir, '.env'), 'SECRET=abc')
  fs.mkdirSync(path.join(sourceDir, 'node_modules', 'vitest'), { recursive: true })
  fs.writeFileSync(
    path.join(sourceDir, 'node_modules', 'vitest', 'index.js'),
    'module.exports = {}',
  )
})

afterAll(() => {
  fs.rmSync(sourceDir, { recursive: true, force: true })
})

// ── createVerificationWorkspace ───────────────────────────────────────────────

describe('createVerificationWorkspace: isolation', () => {
  it('creates a disposable workspace in a temp directory', () => {
    const ws = createVerificationWorkspace(makeContract(sourceDir))
    try {
      expect(fs.existsSync(ws.workspacePath)).toBe(true)
      expect(ws.workspacePath.startsWith(os.tmpdir())).toBe(true)
    } finally {
      ws.cleanup()
    }
  })

  it('workspace is a separate directory from the original project', () => {
    const ws = createVerificationWorkspace(makeContract(sourceDir))
    try {
      expect(ws.workspacePath).not.toBe(sourceDir)
      expect(ws.workspacePath).not.toBe(path.resolve(sourceDir))
    } finally {
      ws.cleanup()
    }
  })

  it('only copies files matching includePaths', () => {
    const ws = createVerificationWorkspace(makeContract(sourceDir))
    try {
      expect(fs.existsSync(path.join(ws.workspacePath, 'package.json'))).toBe(true)
      expect(fs.existsSync(path.join(ws.workspacePath, 'src', 'engine.ts'))).toBe(true)
      expect(fs.existsSync(path.join(ws.workspacePath, '.powerplant', 'POLICY.yaml'))).toBe(true)
    } finally {
      ws.cleanup()
    }
  })

  it('never copies excluded files (.env, node_modules) into workspace', () => {
    const ws = createVerificationWorkspace(makeContract(sourceDir))
    try {
      expect(fs.existsSync(path.join(ws.workspacePath, '.env'))).toBe(false)
      expect(fs.existsSync(path.join(ws.workspacePath, 'node_modules'))).toBe(false)
    } finally {
      ws.cleanup()
    }
  })

  it('cleanup removes the workspace directory', () => {
    const ws = createVerificationWorkspace(makeContract(sourceDir))
    const { workspacePath } = ws
    ws.cleanup()
    expect(fs.existsSync(workspacePath)).toBe(false)
  })
})

describe('createVerificationWorkspace: source manifest', () => {
  it('records source file SHA-256 hashes before copy', () => {
    const ws = createVerificationWorkspace(makeContract(sourceDir))
    try {
      expect(ws.sourceManifest.files.length).toBeGreaterThan(0)
      expect(ws.sourceManifest.sourcePath).toBe(makeContract(sourceDir).sourcePath)
      const pkgEntry = ws.sourceManifest.files.find(f => f.relativePath === 'package.json')
      expect(pkgEntry).toBeDefined()
      expect(pkgEntry?.sha256).toHaveLength(64)
    } finally {
      ws.cleanup()
    }
  })

  it('source manifest never contains the content of excluded files', () => {
    const ws = createVerificationWorkspace(makeContract(sourceDir))
    try {
      const serialized = JSON.stringify(ws.sourceManifest)
      expect(serialized).not.toContain('SECRET=abc')
      expect(serialized).not.toContain('module.exports')
    } finally {
      ws.cleanup()
    }
  })
})

describe('createVerificationWorkspace: FAIL_BOUNDARY on bad workspace', () => {
  it('throws FAIL_BOUNDARY if validated workspace contains forbidden content', () => {
    // Force a contract where .env is in includePaths (bad config) but also in denyIfPresentAfterCopy
    const badContract: LoadedProjectContract = {
      ...makeContract(sourceDir),
      includePaths: ['package.json', '.env', '.powerplant/**', 'src/**'],
      denyIfPresentAfterCopy: ['.env'],
    }
    expect(() => createVerificationWorkspace(badContract)).toThrow(/FAIL_BOUNDARY/)
  })
})

// ── checkSourceModified ───────────────────────────────────────────────────────

describe('checkSourceModified', () => {
  it('returns false when source files are unchanged', () => {
    const ws = createVerificationWorkspace(makeContract(sourceDir))
    const { sourceManifest } = ws
    ws.cleanup()
    expect(checkSourceModified(sourceManifest)).toBe(false)
  })

  it('returns true if a tracked file has a different hash', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-modified-'))
    try {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"original"}')
      // Manifest records wrong sha256
      const manifest = {
        sourcePath: tmpDir,
        files: [{
          relativePath: 'package.json',
          sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        }],
      }
      expect(checkSourceModified(manifest)).toBe(true)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('returns true if a tracked source file has been deleted', () => {
    const manifest = {
      sourcePath: '/nonexistent/path-that-does-not-exist',
      files: [{ relativePath: 'package.json', sha256: 'abc123' }],
    }
    expect(checkSourceModified(manifest)).toBe(true)
  })

  it('returns false for an empty manifest (no tracked files)', () => {
    expect(checkSourceModified({ sourcePath: sourceDir, files: [] })).toBe(false)
  })
})
