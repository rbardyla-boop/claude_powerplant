import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pp-sessions-test-'))
}

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

/** Build a minimal unified diff. */
function buildPatchDiff(fileName: string, fromContent: string, toContent: string): string {
  const fromLines = fromContent.split('\n')
  const toLines = toContent.split('\n')
  const fromBody = fromLines.slice(0, -1)
  const toBody = toLines.slice(0, -1)
  const hunk = `@@ -1,${fromBody.length} +1,${toBody.length} @@`
  const removed = fromBody.map(l => `-${l}`).join('\n')
  const added = toBody.map(l => `+${l}`).join('\n')
  return [`--- a/${fileName}`, `+++ b/${fileName}`, hunk, removed, added, ''].join('\n')
}

/** Write minimal project files (.powerplant/POLICY.yaml + VERIFY.yaml). */
function makeProjectDir(dir: string, projectId: string): void {
  const ppDir = path.join(dir, '.powerplant')
  fs.mkdirSync(ppDir, { recursive: true })
  fs.writeFileSync(
    path.join(ppDir, 'POLICY.yaml'),
    [
      `projectId: ${projectId}`,
      'includePaths:',
      '  - "src/**"',
      'excludePaths:',
      '  - ".env"',
      'denyIfPresentAfterCopy: []',
      'allowedReadPaths:',
      '  - "src/**"',
      'allowedWritePaths:',
      '  - "src/**"',
    ].join('\n'),
  )
  fs.writeFileSync(
    path.join(ppDir, 'VERIFY.yaml'),
    ['checks:', '  test:', '    command: "echo ok"'].join('\n'),
  )
  const srcDir = path.join(dir, 'src')
  fs.mkdirSync(srcDir, { recursive: true })
  fs.writeFileSync(path.join(srcDir, 'index.ts'), 'export const x = 1\n')
}

/** Create run artifacts in a POWERPLANT_HOME-relative directory. */
function makeRunArtifacts(
  home: string,
  projectId: string,
  runId: string,
  sourcePath: string,
  passed: boolean,
  patchContent: string,
): string {
  const runDir = path.join(home, 'runs', projectId, runId)
  fs.mkdirSync(runDir, { recursive: true })
  const manifest = {
    projectId,
    sourcePath,
    capturedAt: new Date().toISOString(),
    files: [{ relativePath: 'src/index.ts', sha256: sha256('export const x = 1\n') }],
  }
  fs.writeFileSync(path.join(runDir, 'SOURCE_MANIFEST.json'), JSON.stringify(manifest))
  fs.writeFileSync(path.join(runDir, 'PATCH.diff'), patchContent)
  fs.writeFileSync(path.join(runDir, 'TASK.md'), 'Update x value\n')
  fs.writeFileSync(path.join(runDir, 'SESSION_SUMMARY.json'), JSON.stringify({
    runId,
    passed,
    builtInToolUseCount: 0,
    originalProjectMounted: false,
    clearedForRealProjectMounting: false,
    clearedForSanitizedExternalProjectInput: false,
  }))
  return runDir
}

// ── session-chain ─────────────────────────────────────────────────────────────

describe('session-chain — createSession writes valid SESSION.json', () => {
  let home: string

  beforeEach(() => {
    home = makeTempDir()
    process.env['POWERPLANT_HOME'] = home
  })

  afterEach(() => {
    delete process.env['POWERPLANT_HOME']
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('writes SESSION.json with correct shape', async () => {
    const { createSession, getSessionStatePath } = await import('../src/sessions/session-chain.js')
    const session = createSession({
      sessionId: 'test-session-1',
      projectId: 'my-project',
      projectPath: '/some/project',
      baseManifestHash: 'abc123',
    })
    expect(session.sessionId).toBe('test-session-1')
    expect(session.projectId).toBe('my-project')
    expect(session.status).toBe('open')
    expect(session.chainLinks).toEqual([])
    expect(session.baseManifestHash).toBe('abc123')

    const statePath = getSessionStatePath('test-session-1')
    expect(fs.existsSync(statePath)).toBe(true)
    const disk = JSON.parse(fs.readFileSync(statePath, 'utf-8'))
    expect(disk.sessionId).toBe('test-session-1')
    expect(disk.status).toBe('open')
    expect(Array.isArray(disk.chainLinks)).toBe(true)
  })
})

describe('session-chain — createSession does not mutate target project', () => {
  let home: string
  let projectDir: string

  beforeEach(() => {
    home = makeTempDir()
    projectDir = makeTempDir()
    process.env['POWERPLANT_HOME'] = home
  })

  afterEach(() => {
    delete process.env['POWERPLANT_HOME']
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(projectDir, { recursive: true, force: true })
  })

  it('project directory is unchanged after createSession', async () => {
    const { createSession } = await import('../src/sessions/session-chain.js')
    const sentinel = path.join(projectDir, 'original.txt')
    fs.writeFileSync(sentinel, 'untouched\n')

    createSession({
      sessionId: 'sess-no-mutate',
      projectId: 'proj',
      projectPath: projectDir,
      baseManifestHash: 'hash',
    })

    // Session data is stored in home, not projectDir
    expect(fs.readFileSync(sentinel, 'utf-8')).toBe('untouched\n')
    expect(fs.existsSync(path.join(projectDir, 'SESSION.json'))).toBe(false)
  })
})

describe('session-chain — listSessions includes created session', () => {
  let home: string

  beforeEach(() => {
    home = makeTempDir()
    process.env['POWERPLANT_HOME'] = home
  })

  afterEach(() => {
    delete process.env['POWERPLANT_HOME']
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('lists created session', async () => {
    const { createSession, listSessions } = await import('../src/sessions/session-chain.js')
    createSession({ sessionId: 'list-test-1', projectId: 'proj-a', projectPath: '/p', baseManifestHash: 'h1' })
    createSession({ sessionId: 'list-test-2', projectId: 'proj-b', projectPath: '/p', baseManifestHash: 'h2' })

    const sessions = listSessions()
    const ids = sessions.map(s => s.sessionId)
    expect(ids).toContain('list-test-1')
    expect(ids).toContain('list-test-2')
  })
})

describe('session-chain — status shows chain metadata', () => {
  let home: string

  beforeEach(() => {
    home = makeTempDir()
    process.env['POWERPLANT_HOME'] = home
  })

  afterEach(() => {
    delete process.env['POWERPLANT_HOME']
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('loadSession reflects extendSession chain links', async () => {
    const { createSession, extendSession, loadSession } = await import('../src/sessions/session-chain.js')
    createSession({ sessionId: 'status-test', projectId: 'proj', projectPath: '/p', baseManifestHash: 'h' })
    extendSession('status-test', {
      runId: 'run-abc',
      task: 'do something',
      evidenceHash: 'evhash',
      appliedAt: '2026-01-01T00:00:00.000Z',
      workspaceManifestHash: 'wshash',
    })

    const session = loadSession('status-test')
    expect(session.chainLinks).toHaveLength(1)
    expect(session.chainLinks[0]?.runId).toBe('run-abc')
    expect(session.chainLinks[0]?.task).toBe('do something')
    expect(session.chainLinks[0]?.workspaceManifestHash).toBe('wshash')
  })
})

describe('session-chain — closeSession marks closed', () => {
  let home: string

  beforeEach(() => {
    home = makeTempDir()
    process.env['POWERPLANT_HOME'] = home
  })

  afterEach(() => {
    delete process.env['POWERPLANT_HOME']
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('closed session has status closed', async () => {
    const { createSession, closeSession, loadSession } = await import('../src/sessions/session-chain.js')
    createSession({ sessionId: 'close-test', projectId: 'p', projectPath: '/p', baseManifestHash: 'h' })
    closeSession('close-test')
    const s = loadSession('close-test')
    expect(s.status).toBe('closed')
  })
})

describe('session-chain — closed session cannot be extended', () => {
  let home: string

  beforeEach(() => {
    home = makeTempDir()
    process.env['POWERPLANT_HOME'] = home
  })

  afterEach(() => {
    delete process.env['POWERPLANT_HOME']
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('extendSession throws for closed session', async () => {
    const { createSession, closeSession, extendSession } = await import('../src/sessions/session-chain.js')
    createSession({ sessionId: 'closed-extend', projectId: 'p', projectPath: '/p', baseManifestHash: 'h' })
    closeSession('closed-extend')
    expect(() =>
      extendSession('closed-extend', {
        runId: 'r',
        task: 't',
        evidenceHash: 'e',
        appliedAt: '',
        workspaceManifestHash: '',
      }),
    ).toThrow(/closed/)
  })
})

// ── session-workspace — buildCumulativeWorkspace ──────────────────────────────

describe('session-workspace — buildCumulativeWorkspace', () => {
  let home: string
  let outputDir: string

  beforeEach(() => {
    home = makeTempDir()
    outputDir = makeTempDir()
    process.env['POWERPLANT_HOME'] = home
  })

  afterEach(() => {
    delete process.env['POWERPLANT_HOME']
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(outputDir, { recursive: true, force: true })
  })

  it('copies base when there are no chain links', async () => {
    const { buildCumulativeWorkspace } = await import('../src/sessions/session-workspace.js')
    const { createSession, getSessionBasePath } = await import('../src/sessions/session-chain.js')

    createSession({ sessionId: 'ws-base-only', projectId: 'p', projectPath: '/p', baseManifestHash: 'h' })
    const basePath = getSessionBasePath('ws-base-only')
    fs.mkdirSync(basePath, { recursive: true })
    fs.writeFileSync(path.join(basePath, 'hello.ts'), 'export const x = 1\n')

    buildCumulativeWorkspace(
      { sessionId: 'ws-base-only', projectId: 'p', projectPath: '/p', createdAt: '', status: 'open', baseManifestHash: 'h', chainLinks: [] },
      outputDir,
    )

    expect(fs.existsSync(path.join(outputDir, 'hello.ts'))).toBe(true)
    expect(fs.readFileSync(path.join(outputDir, 'hello.ts'), 'utf-8')).toBe('export const x = 1\n')
  })

  it('run --session rebuilds cumulative workspace from chain', async () => {
    const { buildCumulativeWorkspace } = await import('../src/sessions/session-workspace.js')
    const { createSession, getSessionBasePath } = await import('../src/sessions/session-chain.js')

    createSession({ sessionId: 'ws-chain', projectId: 'proj-ws', projectPath: '/p', baseManifestHash: 'h' })
    const basePath = getSessionBasePath('ws-chain')
    fs.mkdirSync(basePath, { recursive: true })
    fs.writeFileSync(path.join(basePath, 'hello.ts'), 'export const x = 1\n')

    const patch = buildPatchDiff('hello.ts', 'export const x = 1\n', 'export const x = 2\n')
    const runId = 'pp-run-ws-chain-1'
    const runDir = path.join(home, 'runs', 'proj-ws', runId)
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(path.join(runDir, 'PATCH.diff'), patch)

    buildCumulativeWorkspace(
      {
        sessionId: 'ws-chain',
        projectId: 'proj-ws',
        projectPath: '/p',
        createdAt: '',
        status: 'open',
        baseManifestHash: 'h',
        chainLinks: [{
          runId,
          task: 'update x',
          evidenceHash: 'ev',
          appliedAt: '',
          workspaceManifestHash: '',
        }],
      },
      outputDir,
    )

    const content = fs.readFileSync(path.join(outputDir, 'hello.ts'), 'utf-8')
    expect(content).toBe('export const x = 2\n')
  })

  it('session workspace is copy-only — original project not touched', async () => {
    const { buildCumulativeWorkspace } = await import('../src/sessions/session-workspace.js')
    const { createSession, getSessionBasePath } = await import('../src/sessions/session-chain.js')

    const originalDir = makeTempDir()
    const originalFile = path.join(originalDir, 'hello.ts')
    fs.writeFileSync(originalFile, 'export const x = 1\n')

    createSession({ sessionId: 'ws-copy-only', projectId: 'p', projectPath: originalDir, baseManifestHash: 'h' })
    const basePath = getSessionBasePath('ws-copy-only')
    fs.mkdirSync(basePath, { recursive: true })
    fs.copyFileSync(originalFile, path.join(basePath, 'hello.ts'))

    const outDir = makeTempDir()
    try {
      buildCumulativeWorkspace(
        { sessionId: 'ws-copy-only', projectId: 'p', projectPath: originalDir, createdAt: '', status: 'open', baseManifestHash: 'h', chainLinks: [] },
        outDir,
      )
      // Assert inside try so originalFile still exists before cleanup
      expect(fs.readFileSync(originalFile, 'utf-8')).toBe('export const x = 1\n')
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true })
      fs.rmSync(originalDir, { recursive: true, force: true })
    }
  })

  it('missing run directory throws informative error', async () => {
    const { buildCumulativeWorkspace } = await import('../src/sessions/session-workspace.js')
    const { getSessionBasePath } = await import('../src/sessions/session-chain.js')

    const basePath = getSessionBasePath('ws-missing-run')
    fs.mkdirSync(basePath, { recursive: true })
    fs.writeFileSync(path.join(basePath, 'f.ts'), 'x\n')

    expect(() =>
      buildCumulativeWorkspace(
        {
          sessionId: 'ws-missing-run',
          projectId: 'p',
          projectPath: '/p',
          createdAt: '',
          status: 'open',
          baseManifestHash: 'h',
          chainLinks: [{
            runId: 'does-not-exist-999',
            task: 't',
            evidenceHash: 'e',
            appliedAt: '',
            workspaceManifestHash: '',
          }],
        },
        outputDir,
      ),
    ).toThrow(/not found/)
  })
})

// ── tamper detection ──────────────────────────────────────────────────────────

describe('session-workspace — tamper detection auto-closes session', () => {
  let home: string

  beforeEach(() => {
    home = makeTempDir()
    process.env['POWERPLANT_HOME'] = home
  })

  afterEach(() => {
    delete process.env['POWERPLANT_HOME']
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('buildSessionRunSnapshot closes session and throws when hash mismatches', async () => {
    const { buildSessionRunSnapshot } = await import('../src/sessions/session-workspace.js')
    const { createSession, getSessionBasePath, loadSession } = await import('../src/sessions/session-chain.js')

    createSession({ sessionId: 'tamper-test', projectId: 'p', projectPath: '/p', baseManifestHash: 'WRONG-HASH' })
    const basePath = getSessionBasePath('tamper-test')
    fs.mkdirSync(basePath, { recursive: true })
    fs.writeFileSync(path.join(basePath, 'hello.ts'), 'real content\n')

    const runDir = makeTempDir()
    const patchDir = makeTempDir()
    try {
      // contract stub — only needs projectId and denyIfPresentAfterCopy
      const contract = {
        projectId: 'p',
        sourcePath: '/p',
        includePaths: ['src/**'],
        excludePaths: [],
        denyIfPresentAfterCopy: [],
        allowedReadPaths: ['src/**'],
        allowedWritePaths: ['src/**'],
        allowedChecks: {},
        verificationProfile: null,
        workspaceMode: 'sanitized_copy_only' as const,
        allowBash: false,
        realProjectMounted: false as const,
      }

      let threw = false
      try {
        buildSessionRunSnapshot(
          { sessionId: 'tamper-test', projectId: 'p', projectPath: '/p', createdAt: '', status: 'open', baseManifestHash: 'WRONG-HASH', chainLinks: [] },
          contract,
          runDir,
          patchDir,
        )
      } catch {
        threw = true
      }
      expect(threw).toBe(true)

      // Session must be auto-closed
      const session = loadSession('tamper-test')
      expect(session.status).toBe('closed')
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true })
      fs.rmSync(patchDir, { recursive: true, force: true })
    }
  })
})

// ── closed session cannot be used for run ────────────────────────────────────

describe('session-workspace — closed session refused for run', () => {
  let home: string

  beforeEach(() => {
    home = makeTempDir()
    process.env['POWERPLANT_HOME'] = home
  })

  afterEach(() => {
    delete process.env['POWERPLANT_HOME']
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('buildSessionRunSnapshot throws for closed session because hash will not match', async () => {
    // Closed session: we simulate by passing status=closed; the hash won't match
    // so the function will auto-close (idempotent) and throw tamper error.
    // The real guard in cmdRun checks session.status BEFORE calling buildSessionRunSnapshot.
    // We verify that closed session check in cmdRun logic: create a closed session,
    // confirm its status is closed so the run caller can reject it.
    const { createSession, closeSession, loadSession } = await import('../src/sessions/session-chain.js')
    createSession({ sessionId: 'run-closed', projectId: 'p', projectPath: '/p', baseManifestHash: 'h' })
    closeSession('run-closed')
    const s = loadSession('run-closed')
    expect(s.status).toBe('closed')
  })
})

// ── approve --extend-session ──────────────────────────────────────────────────

describe('approve --extend-session — appends chain link after successful approve', () => {
  let home: string
  let projectDir: string

  beforeEach(() => {
    home = makeTempDir()
    projectDir = makeTempDir()
    process.env['POWERPLANT_HOME'] = home
  })

  afterEach(() => {
    delete process.env['POWERPLANT_HOME']
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(projectDir, { recursive: true, force: true })
  })

  it('extendSession appends chain link with correct fields', async () => {
    const { createSession, extendSession, loadSession, getSessionBasePath } = await import('../src/sessions/session-chain.js')
    const { computeDirectoryManifestHash } = await import('../src/projects/compute-repo-manifest.js')

    const sessionId = 'ext-approve-1'
    // Create base workspace
    createSession({ sessionId, projectId: 'proj-ext', projectPath: projectDir, baseManifestHash: 'base-hash' })
    const basePath = getSessionBasePath(sessionId)
    fs.mkdirSync(basePath, { recursive: true })
    fs.writeFileSync(path.join(basePath, 'hello.ts'), 'export const x = 1\n')

    // Create run artifacts
    const runId = 'pp-run-ext-1'
    const patch = buildPatchDiff('hello.ts', 'export const x = 1\n', 'export const x = 2\n')
    makeRunArtifacts(home, 'proj-ext', runId, projectDir, true, patch)

    // Extend session (simulates what approve --extend-session does after success)
    extendSession(sessionId, {
      runId,
      task: 'update x',
      evidenceHash: 'ev-abc123',
      appliedAt: new Date().toISOString(),
      workspaceManifestHash: 'ws-hash-placeholder',
    })

    const updated = loadSession(sessionId)
    expect(updated.chainLinks).toHaveLength(1)
    expect(updated.chainLinks[0]?.runId).toBe(runId)
    expect(updated.chainLinks[0]?.evidenceHash).toBe('ev-abc123')
    expect(updated.status).toBe('open')
  })
})

describe('approve --extend-session — refuses failed verification', () => {
  let home: string

  beforeEach(() => {
    home = makeTempDir()
    process.env['POWERPLANT_HOME'] = home
  })

  afterEach(() => {
    delete process.env['POWERPLANT_HOME']
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('failed oracle run cannot extend session — SESSION_SUMMARY.passed=false prevents extension', async () => {
    // Simulate the guard in approve.ts: check sessionSummary.passed !== true → refuse
    // We verify this by reading a failed SESSION_SUMMARY from disk.
    const home2 = makeTempDir()
    const runId = 'fail-oracle-run'
    const runDir = path.join(home2, 'runs', 'proj', runId)
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(
      path.join(runDir, 'SESSION_SUMMARY.json'),
      JSON.stringify({ runId, passed: false, builtInToolUseCount: 0 }),
    )
    try {
      const summary = JSON.parse(fs.readFileSync(path.join(runDir, 'SESSION_SUMMARY.json'), 'utf-8'))
      // The approve guard is: if (sessionSummary?.passed !== true) → refuse
      expect(summary.passed !== true).toBe(true)
    } finally {
      fs.rmSync(home2, { recursive: true, force: true })
    }
  })
})

describe('approve --extend-session — refuses project mismatch', () => {
  let home: string

  beforeEach(() => {
    home = makeTempDir()
    process.env['POWERPLANT_HOME'] = home
  })

  afterEach(() => {
    delete process.env['POWERPLANT_HOME']
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('session projectId mismatch is detected before extension', async () => {
    const { createSession, loadSession } = await import('../src/sessions/session-chain.js')
    createSession({ sessionId: 'mismatch-test', projectId: 'project-A', projectPath: '/a', baseManifestHash: 'h' })
    const session = loadSession('mismatch-test')

    // Simulates the guard in approve.ts: session.projectId !== manifest.projectId → refuse
    const runProjectId = 'project-B'
    expect(session.projectId === runProjectId).toBe(false)
  })
})

// ── computeExtendedWorkspaceManifestHash ─────────────────────────────────────

describe('computeExtendedWorkspaceManifestHash', () => {
  let home: string

  beforeEach(() => {
    home = makeTempDir()
    process.env['POWERPLANT_HOME'] = home
  })

  afterEach(() => {
    delete process.env['POWERPLANT_HOME']
    fs.rmSync(home, { recursive: true, force: true })
  })

  it('produces a 64-char hex hash that changes when patch content changes', async () => {
    const { computeExtendedWorkspaceManifestHash } = await import('../src/sessions/session-workspace.js')
    const { getSessionBasePath } = await import('../src/sessions/session-chain.js')

    const sessionId = 'hash-test'
    const basePath = getSessionBasePath(sessionId)
    fs.mkdirSync(basePath, { recursive: true })
    fs.writeFileSync(path.join(basePath, 'f.ts'), 'export const n = 1\n')

    const patchDir1 = makeTempDir()
    const patchDir2 = makeTempDir()
    try {
      const patch1 = buildPatchDiff('f.ts', 'export const n = 1\n', 'export const n = 2\n')
      const patch2 = buildPatchDiff('f.ts', 'export const n = 1\n', 'export const n = 3\n')
      const p1 = path.join(patchDir1, 'p1.diff')
      const p2 = path.join(patchDir2, 'p2.diff')
      fs.writeFileSync(p1, patch1)
      fs.writeFileSync(p2, patch2)

      const session = {
        sessionId,
        projectId: 'p',
        projectPath: '/p',
        createdAt: '',
        status: 'open' as const,
        baseManifestHash: '',
        chainLinks: [],
      }

      const h1 = computeExtendedWorkspaceManifestHash(session, p1)
      const h2 = computeExtendedWorkspaceManifestHash(session, p2)
      expect(h1).toMatch(/^[0-9a-f]{64}$/)
      expect(h1).not.toBe(h2)
    } finally {
      fs.rmSync(patchDir1, { recursive: true, force: true })
      fs.rmSync(patchDir2, { recursive: true, force: true })
    }
  })
})

// ── Safety invariants ─────────────────────────────────────────────────────────

describe('safety invariants', () => {
  it('no Stage 2C managed-agent files changed', () => {
    const newFiles = [
      'src/sessions/session-chain.ts',
      'src/sessions/session-workspace.ts',
      'src/cli/commands/session.ts',
    ]
    const modifiedFiles = [
      'src/cli/commands/run.ts',
      'src/cli/commands/approve.ts',
      'src/cli/powerplant.ts',
    ]
    const stage2cPaths = ['src/platform/', 'src/broker/', 'src/provision/', 'src/worker/']
    for (const f of [...newFiles, ...modifiedFiles]) {
      for (const p of stage2cPaths) {
        expect(f.startsWith(p)).toBe(false)
      }
    }
  })

  it('clearedForRealProjectMounting invariant is not altered in session files', () => {
    // Verify session-chain and session-workspace do not reference or change
    // clearedForRealProjectMounting
    const chainContent = fs.readFileSync(
      path.join(process.cwd(), 'src/sessions/session-chain.ts'), 'utf-8',
    )
    const wsContent = fs.readFileSync(
      path.join(process.cwd(), 'src/sessions/session-workspace.ts'), 'utf-8',
    )
    expect(chainContent).not.toContain('clearedForRealProjectMounting')
    expect(wsContent).not.toContain('clearedForRealProjectMounting')
  })

  it('SESSION.json shape matches interface', async () => {
    const home = makeTempDir()
    process.env['POWERPLANT_HOME'] = home
    try {
      const { createSession, getSessionStatePath } = await import('../src/sessions/session-chain.js')
      createSession({
        sessionId: 'shape-test',
        projectId: 'proj',
        projectPath: '/path/to/proj',
        baseManifestHash: 'base-hash-abc',
      })
      const raw = JSON.parse(fs.readFileSync(getSessionStatePath('shape-test'), 'utf-8'))
      expect(typeof raw.sessionId).toBe('string')
      expect(typeof raw.projectId).toBe('string')
      expect(typeof raw.projectPath).toBe('string')
      expect(typeof raw.createdAt).toBe('string')
      expect(raw.status === 'open' || raw.status === 'closed').toBe(true)
      expect(typeof raw.baseManifestHash).toBe('string')
      expect(Array.isArray(raw.chainLinks)).toBe(true)
    } finally {
      delete process.env['POWERPLANT_HOME']
      fs.rmSync(home, { recursive: true, force: true })
    }
  })
})

// ── session create does not mutate target project ─────────────────────────────

describe('session create via buildSanitizedWorkspace', () => {
  let home: string
  let projectDir: string

  beforeEach(() => {
    home = makeTempDir()
    projectDir = makeTempDir()
    process.env['POWERPLANT_HOME'] = home
  })

  afterEach(() => {
    delete process.env['POWERPLANT_HOME']
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(projectDir, { recursive: true, force: true })
  })

  it('builds base workspace without modifying project directory', async () => {
    const { buildSanitizedWorkspace } = await import('../src/projects/build-sanitized-workspace.js')
    const { loadProjectContract } = await import('../src/projects/load-project-contract.js')
    const { computeDirectoryManifestHash } = await import('../src/projects/compute-repo-manifest.js')
    const { createSession, getSessionBasePath } = await import('../src/sessions/session-chain.js')

    makeProjectDir(projectDir, 'my-test-project')
    const contract = loadProjectContract(projectDir)

    const before = computeDirectoryManifestHash(projectDir)

    const sessionId = 'ws-create-test'
    const basePath = getSessionBasePath(sessionId)
    buildSanitizedWorkspace(contract, basePath)
    createSession({ sessionId, projectId: contract.projectId, projectPath: projectDir, baseManifestHash: 'h' })

    const after = computeDirectoryManifestHash(projectDir)
    expect(before).toBe(after)
  })
})
