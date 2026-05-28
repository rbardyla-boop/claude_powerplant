import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { createMountManifest } from '../src/projects/create-mount-manifest.js'

describe('createMountManifest', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-manifest-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates a manifest with all security invariants set correctly', () => {
    const mountedPath = path.join(os.tmpdir(), '.powerplant/runtime/sprint3r/run123/workspace/project')
    const manifest = createMountManifest({
      runId: 'run123',
      mountedHostPath: mountedPath,
      reportsDir: tmpDir,
    })

    expect(manifest.originalSourceMounted).toBe(false)
    expect(manifest.sanitizedWorkspaceMounted).toBe(true)
    expect(manifest.mountMode).toBe('read_only')
    expect(manifest.clearedForRealProjectMounting).toBe(false)
    expect(manifest.apiKeyPassedToWorker).toBe(false)
    expect(manifest.homeDirectoryMounted).toBe(false)
    expect(manifest.dockerSocketMounted).toBe(false)
  })

  it('throws if mountedHostPath does not contain .powerplant/runtime/', () => {
    expect(() =>
      createMountManifest({
        runId: 'test',
        mountedHostPath: '/home/user/my-project',
        reportsDir: tmpDir,
      }),
    ).toThrow(/invariant violated/)
  })

  it('clearedForRealProjectMounting is always false regardless of input', () => {
    const mountedPath = '/tmp/.powerplant/runtime/sprint3r/run/workspace/project'
    const manifest = createMountManifest({
      runId: 'run',
      mountedHostPath: mountedPath,
      reportsDir: tmpDir,
    })
    expect(manifest.clearedForRealProjectMounting).toBe(false)
  })

  it('writes the manifest file to the reports directory', () => {
    const mountedPath = '/tmp/.powerplant/runtime/sprint3r/run/workspace/project'
    createMountManifest({
      runId: 'run',
      mountedHostPath: mountedPath,
      reportsDir: tmpDir,
    })
    const files = fs.readdirSync(tmpDir)
    expect(files.some(f => f.startsWith('sprint3r-sanitizer-manifest-'))).toBe(true)
  })
})
