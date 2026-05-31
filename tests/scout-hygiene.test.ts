import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { writeScoutGitignore } from '../src/cli/commands/scout.js'
import { DeterministicSource } from '../src/scout/deterministic-source.js'
import type { ScoutBundle, ScoutBundleFile } from '../src/scout/candidate-source.js'
import type { LoadedProjectContract } from '../src/projects/load-project-contract.js'

// ── #1B: .scout/ self-ignore ──────────────────────────────────────────────────

describe('writeScoutGitignore', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-hygiene-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('writes a .gitignore that ignores everything in .scout/', () => {
    writeScoutGitignore(dir)
    const gi = path.join(dir, '.gitignore')
    expect(fs.existsSync(gi)).toBe(true)
    expect(fs.readFileSync(gi, 'utf-8').trim()).toBe('*')
  })
})

// ── #2: candidate verification prefers required (hermetic) checks ─────────────

function bundle(files: ScoutBundleFile[], contract: LoadedProjectContract): ScoutBundle {
  return { projectId: 'py-demo', stack: 'node-ts', files, contract }
}

const source = new DeterministicSource()

describe('pickCheckId prefers required hermetic checks over advisory ones', () => {
  it('chooses the required check, not the advisory pytest check (Screenpipe shape)', () => {
    // scripts-syntax (required, hermetic) + tests (advisory pytest, needs venv)
    const contract = {
      allowedWritePaths: ['tests/**'],
      allowedChecks: {
        'scripts-syntax': { command: 'python3 -m compileall -q .', required: true },
        tests: { command: 'python3 -m pytest', required: false },
      },
    } as unknown as LoadedProjectContract

    const gap = source.discover(bundle([{ relativePath: 'vault_sync.py', content: 'x' }], contract))
      .find(c => c.domain === 'test-gap')
    expect(gap).toBeDefined()
    expect(gap!.verification).toEqual(['scripts-syntax']) // required, not advisory 'tests'
  })

  it('prefers required test-named check over a required non-test check', () => {
    const contract = {
      allowedWritePaths: ['tests/**'],
      allowedChecks: {
        typecheck: { command: 'npx tsc --noEmit', required: true },
        test: { command: 'npm test', required: true },
      },
    } as unknown as LoadedProjectContract

    const gap = source.discover(bundle([{ relativePath: 'sync_service.py', content: 'x' }], contract))
      .find(c => c.domain === 'test-gap')
    expect(gap).toBeDefined()
    expect(gap!.verification).toEqual(['test'])
  })

  it('falls back to an advisory check only when no required check exists', () => {
    const contract = {
      allowedWritePaths: ['tests/**'],
      allowedChecks: {
        tests: { command: 'python3 -m pytest', required: false },
      },
    } as unknown as LoadedProjectContract

    const gap = source.discover(bundle([{ relativePath: 'vault_sync.py', content: 'x' }], contract))
      .find(c => c.domain === 'test-gap')
    expect(gap).toBeDefined()
    expect(gap!.verification).toEqual(['tests'])
  })
})
