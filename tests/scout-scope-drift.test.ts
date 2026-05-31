import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { buildReviewRenderState } from '../src/cli/commands/review.js'

let artifactDir: string

beforeEach(() => {
  artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-scope-drift-'))
})
afterEach(() => {
  fs.rmSync(artifactDir, { recursive: true, force: true })
})

function writeScope(expectedFiles: string[]): void {
  fs.writeFileSync(
    path.join(artifactDir, 'CANDIDATE_SCOPE.json'),
    JSON.stringify({ candidateId: 'scout-001', title: 't', expectedFiles, verification: ['test'] }),
  )
}

function writeDiff(files: string[]): void {
  const body = files
    .map(f => `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -1 +1 @@\n-old\n+new`)
    .join('\n')
  fs.writeFileSync(path.join(artifactDir, 'PATCH.diff'), body)
}

describe('review scope drift', () => {
  it('reports no drift when the patch stays inside expected files', () => {
    writeScope(['src/cli/powerplant.ts'])
    writeDiff(['src/cli/powerplant.ts'])
    const state = buildReviewRenderState('pp-run-1', artifactDir)
    expect(state.scopeDrift).toBeDefined()
    expect(state.scopeDrift!.status).toBe('none')
    expect(state.scopeDrift!.unexpected).toEqual([])
  })

  it('flags files touched outside the declared scope', () => {
    writeScope(['src/cli/powerplant.ts'])
    writeDiff(['src/cli/powerplant.ts', 'src/cli/commands/run.ts'])
    const state = buildReviewRenderState('pp-run-2', artifactDir)
    expect(state.scopeDrift!.status).toBe('drift')
    expect(state.scopeDrift!.unexpected).toEqual(['src/cli/commands/run.ts'])
  })

  it('honors glob patterns in expected files', () => {
    writeScope(['src/**'])
    writeDiff(['src/a.ts', 'src/b/c.ts'])
    const state = buildReviewRenderState('pp-run-3', artifactDir)
    expect(state.scopeDrift!.status).toBe('none')
  })

  it('records expected files the patch never touched as missing', () => {
    writeScope(['src/a.ts', 'tests/a.test.ts'])
    writeDiff(['src/a.ts'])
    const state = buildReviewRenderState('pp-run-4', artifactDir)
    expect(state.scopeDrift!.missing).toEqual(['tests/a.test.ts'])
    expect(state.scopeDrift!.status).toBe('none') // missing is informational, not drift
  })

  it('omits scopeDrift entirely for non-candidate runs', () => {
    writeDiff(['src/a.ts']) // no CANDIDATE_SCOPE.json
    const state = buildReviewRenderState('pp-run-5', artifactDir)
    expect(state.scopeDrift).toBeUndefined()
  })
})
