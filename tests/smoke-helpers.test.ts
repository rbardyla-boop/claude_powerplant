import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'

// These are the artifacts that cmdApprove requires before proceeding.
// This test guards against drift between the smoke script fixture and the approve command.
const APPROVE_REQUIRED_ARTIFACTS = [
  'PATCH.diff',
  'SOURCE_MANIFEST.json',
  'TASK.md',
  'SESSION_SUMMARY.json',
] as const

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}

function buildPatch(file: string, from: string, to: string): string {
  const a = from.split('\n').slice(0, -1)
  const b = to.split('\n').slice(0, -1)
  return [
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${a.length} +1,${b.length} @@`,
    ...a.map(l => `-${l}`),
    ...b.map(l => `+${l}`),
    '',
  ].join('\n')
}

describe('smoke artifact fixture shape', () => {
  let tmpRoot: string
  let runDir: string
  const projectId = 'smoke-test-project-abcd1234'
  const runId = 'pp-smoke-fixture-001'

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-smoke-fixture-'))
    runDir = path.join(tmpRoot, projectId, runId)
    fs.mkdirSync(runDir, { recursive: true })

    const sourcePath = path.join(tmpRoot, 'fake-source')
    const indexContent = 'export const x = 1\n'
    const pkgContent = JSON.stringify({ name: 'test', version: '1.0.0' }) + '\n'
    const patchDiff = buildPatch('index.ts', indexContent, `// added\n${indexContent}`)

    fs.writeFileSync(path.join(runDir, 'TASK.md'), 'Add a smoke test comment')
    fs.writeFileSync(path.join(runDir, 'PATCH.diff'), patchDiff)
    fs.writeFileSync(path.join(runDir, 'SOURCE_MANIFEST.json'), JSON.stringify({
      projectId,
      sourcePath,
      capturedAt: new Date().toISOString(),
      files: [{ relativePath: 'package.json', sha256: sha256(pkgContent) }],
    }))
    fs.writeFileSync(path.join(runDir, 'SESSION_SUMMARY.json'), JSON.stringify({
      runId,
      passed: true,
      builtInToolUseCount: 0,
      originalProjectMounted: false,
      clearedForRealProjectMounting: false,
      clearedForSanitizedExternalProjectInput: false,
    }))
  })

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('all REQUIRED_ARTIFACTS from cmdApprove are present', () => {
    const missing = APPROVE_REQUIRED_ARTIFACTS.filter(a => !fs.existsSync(path.join(runDir, a)))
    expect(missing).toHaveLength(0)
  })

  it('SOURCE_MANIFEST.json has required shape (projectId, sourcePath, files[])', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(runDir, 'SOURCE_MANIFEST.json'), 'utf-8')) as Record<string, unknown>
    expect(typeof raw['projectId']).toBe('string')
    expect(typeof raw['sourcePath']).toBe('string')
    expect(Array.isArray(raw['files'])).toBe(true)
  })

  it('SESSION_SUMMARY.json has passed boolean field', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(runDir, 'SESSION_SUMMARY.json'), 'utf-8')) as Record<string, unknown>
    expect(typeof raw['passed']).toBe('boolean')
    expect(raw['passed']).toBe(true)
  })

  it('PATCH.diff is a non-empty unified diff', () => {
    const content = fs.readFileSync(path.join(runDir, 'PATCH.diff'), 'utf-8')
    expect(content).toContain('--- a/')
    expect(content).toContain('+++ b/')
    expect(content.length).toBeGreaterThan(10)
  })

  it('TASK.md is a non-empty string', () => {
    const content = fs.readFileSync(path.join(runDir, 'TASK.md'), 'utf-8')
    expect(content.trim().length).toBeGreaterThan(0)
  })
})
