import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { buildPilotSnapshot } from '../src/projects/build-pilot-snapshot.js'
import { verifySourceUnchanged } from '../src/projects/verify-source-unchanged.js'
import type { ProjectContract } from '../src/projects/project-contract.js'

// We build a real snapshot from the actual pilot project (no Docker, no API)
const PILOT_SOURCE = '/home/thebackhand/Downloads/grok/powerplant_pilot_status'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pp-pilot-test-'))
}

let tempDir: string

beforeAll(() => {
  tempDir = makeTempDir()
})

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

const pilotContract: ProjectContract = {
  projectId: 'powerplant-pilot-status',
  sourcePath: PILOT_SOURCE,
  includePaths: ['package.json', 'README.md', 'src/**', 'tests/**', '.powerplant/**'],
  excludePaths: [
    '.env', '.env.*', 'private/**', 'deployment/**',
    '.git/**', 'node_modules/**', 'package-lock.json',
    'credentials*.json', '**/*.key', '**/*.pem',
  ],
  denyIfPresentAfterCopy: ['.env', 'private', 'deployment', '.git', 'node_modules', 'credentials.json'],
  workspaceMode: 'sanitized_copy_only',
  allowBash: false,
  realProjectMounted: false,
}

describe('pilot-snapshot', () => {
  it('source pilot contains forbidden canary strings before sanitization', () => {
    const envContent = fs.readFileSync(path.join(PILOT_SOURCE, '.env'), 'utf-8')
    expect(envContent).toContain('POWERPLANT_FORBIDDEN')

    const privateContent = fs.readFileSync(
      path.join(PILOT_SOURCE, 'private/secret.txt'), 'utf-8',
    )
    expect(privateContent).toContain('POWERPLANT_FORBIDDEN')

    const deployContent = fs.readFileSync(
      path.join(PILOT_SOURCE, 'deployment/release.txt'), 'utf-8',
    )
    expect(deployContent).toContain('POWERPLANT_FORBIDDEN')
  })

  it('builds a baseline and workspace without error', () => {
    const runDir = path.join(tempDir, 'run1')
    const snapshot = buildPilotSnapshot(pilotContract, runDir)
    expect(fs.existsSync(snapshot.baselinePath)).toBe(true)
    expect(fs.existsSync(snapshot.workspacePath)).toBe(true)
  })

  it('baseline excludes .env', () => {
    const runDir = path.join(tempDir, 'run2')
    const snapshot = buildPilotSnapshot(pilotContract, runDir)
    expect(fs.existsSync(path.join(snapshot.baselinePath, '.env'))).toBe(false)
  })

  it('baseline excludes private/secret.txt', () => {
    const runDir = path.join(tempDir, 'run3')
    const snapshot = buildPilotSnapshot(pilotContract, runDir)
    expect(fs.existsSync(path.join(snapshot.baselinePath, 'private'))).toBe(false)
  })

  it('baseline excludes deployment/release.txt', () => {
    const runDir = path.join(tempDir, 'run4')
    const snapshot = buildPilotSnapshot(pilotContract, runDir)
    expect(fs.existsSync(path.join(snapshot.baselinePath, 'deployment'))).toBe(false)
  })

  it('baseline does not contain any POWERPLANT_FORBIDDEN canary string', () => {
    const runDir = path.join(tempDir, 'run5')
    const snapshot = buildPilotSnapshot(pilotContract, runDir)
    function scanDir(dir: string): string[] {
      const hits: string[] = []
      for (const entry of fs.readdirSync(dir)) {
        const abs = path.join(dir, entry)
        const stat = fs.lstatSync(abs)
        if (stat.isDirectory()) hits.push(...scanDir(abs))
        else {
          try {
            const content = fs.readFileSync(abs, 'utf-8')
            if (content.includes('POWERPLANT_FORBIDDEN')) hits.push(abs)
          } catch { /* binary */ }
        }
      }
      return hits
    }
    const hits = scanDir(snapshot.baselinePath)
    expect(hits).toHaveLength(0)
  })

  it('workspace excludes .env after copy from baseline', () => {
    const runDir = path.join(tempDir, 'run6')
    const snapshot = buildPilotSnapshot(pilotContract, runDir)
    expect(fs.existsSync(path.join(snapshot.workspacePath, '.env'))).toBe(false)
  })

  it('workspace does not contain any POWERPLANT_FORBIDDEN canary string', () => {
    const runDir = path.join(tempDir, 'run7')
    const snapshot = buildPilotSnapshot(pilotContract, runDir)
    function scanDir(dir: string): string[] {
      const hits: string[] = []
      for (const entry of fs.readdirSync(dir)) {
        const abs = path.join(dir, entry)
        const stat = fs.lstatSync(abs)
        if (stat.isDirectory()) hits.push(...scanDir(abs))
        else {
          try {
            const content = fs.readFileSync(abs, 'utf-8')
            if (content.includes('POWERPLANT_FORBIDDEN')) hits.push(abs)
          } catch { /* binary */ }
        }
      }
      return hits
    }
    const hits = scanDir(snapshot.workspacePath)
    expect(hits).toHaveLength(0)
  })

  it('source manifest captures files before snapshot', () => {
    const runDir = path.join(tempDir, 'run8')
    const snapshot = buildPilotSnapshot(pilotContract, runDir)
    expect(snapshot.sourceManifest.files.length).toBeGreaterThan(0)
    const paths = snapshot.sourceManifest.files.map(f => f.relativePath)
    expect(paths).toContain('src/status.js')
    expect(paths).toContain('tests/status.test.js')
  })

  it('sanitized manifest confirms forbidden paths absent', () => {
    const runDir = path.join(tempDir, 'run9')
    const snapshot = buildPilotSnapshot(pilotContract, runDir)
    expect(snapshot.sanitizedManifest.allForbiddenAbsent).toBe(true)
  })

  it('sanitized manifest only lists permitted files', () => {
    const runDir = path.join(tempDir, 'run10')
    const snapshot = buildPilotSnapshot(pilotContract, runDir)
    for (const { relativePath } of snapshot.sanitizedManifest.files) {
      expect(relativePath).not.toContain('.env')
      expect(relativePath).not.toContain('private/')
      expect(relativePath).not.toContain('deployment/')
    }
  })

  it('rejects a symlink that is inside an included path', () => {
    // A symlink that WOULD be copied into the snapshot must be rejected.
    // (sym.ts is inside src/** which is in includePaths.)
    const runDir = path.join(tempDir, 'symlink-test')
    const fakeSourceDir = path.join(tempDir, 'fake-source-included')
    fs.mkdirSync(path.join(fakeSourceDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(fakeSourceDir, 'package.json'), '{}')
    fs.symlinkSync('/etc/passwd', path.join(fakeSourceDir, 'src', 'evil.ts'))

    const fakeContract: ProjectContract = {
      ...pilotContract,
      sourcePath: fakeSourceDir,
    }
    expect(() => buildPilotSnapshot(fakeContract, runDir)).toThrow(/Symlink rejected/)
  })

  it('skips a symlink in an excluded path (e.g. node_modules/.bin/)', () => {
    // Real projects contain symlinks in node_modules/.bin/. These are never
    // in includePaths so they must not cause a rejection.
    const runDir = path.join(tempDir, 'symlink-excluded-test')
    const fakeSourceDir = path.join(tempDir, 'fake-source-excluded')
    fs.mkdirSync(path.join(fakeSourceDir, 'node_modules', '.bin'), { recursive: true })
    fs.writeFileSync(path.join(fakeSourceDir, 'package.json'), '{}')
    fs.symlinkSync('/usr/bin/node', path.join(fakeSourceDir, 'node_modules', '.bin', 'vitest'))

    const fakeContract: ProjectContract = {
      ...pilotContract,
      sourcePath: fakeSourceDir,
    }
    // node_modules/.bin/vitest is NOT in includePaths → must not throw
    expect(() => buildPilotSnapshot(fakeContract, runDir)).not.toThrow()
  })

  it('verifySourceUnchanged returns sourceUnmodified: true when source is untouched', () => {
    const runDir = path.join(tempDir, 'verify1')
    const snapshot = buildPilotSnapshot(pilotContract, runDir)
    const result = verifySourceUnchanged(snapshot)
    expect(result.sourceUnmodified).toBe(true)
    expect(result.changedFiles).toHaveLength(0)
    expect(result.missingFiles).toHaveLength(0)
  })
})
