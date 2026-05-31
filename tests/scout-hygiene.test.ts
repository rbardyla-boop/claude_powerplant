import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { writeScoutGitignore } from '../src/cli/commands/scout.js'
import { DeterministicSource } from '../src/scout/deterministic-source.js'
import { renderCandidatesMarkdown, renderCandidatesJson } from '../src/scout/render-candidates.js'
import type { ScoutBundle, ScoutBundleFile } from '../src/scout/candidate-source.js'
import type { ScoutReport } from '../src/scout/scan.js'
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
const discover = (b: ScoutBundle) => source.discover(b).candidates

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

    const gap = discover(bundle([{ relativePath: 'vault_sync.py', content: 'x' }], contract))
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

    const gap = discover(bundle([{ relativePath: 'sync_service.py', content: 'x' }], contract))
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

    const gap = discover(bundle([{ relativePath: 'vault_sync.py', content: 'x' }], contract))
      .find(c => c.domain === 'test-gap')
    expect(gap).toBeDefined()
    expect(gap!.verification).toEqual(['tests'])
  })
})

// ── suppressed-candidate reporting (audit-only ceiling) ───────────────────────

describe('suppressed candidate reporting', () => {
  // Audit-only contract (Pipeline shape): only one specific file is writable.
  const AUDIT_ONLY = {
    allowedWritePaths: ['tests/POWERPLANT_AUDIT.md'],
    allowedChecks: { 'syntax-check': { command: 'python3 -m compileall -q .', required: true } },
  } as unknown as LoadedProjectContract

  it('reports out-of-ceiling test-gaps as an aggregate suppression note, not candidates', () => {
    const result = source.discover(bundle([
      { relativePath: 'engine.py', content: 'x' },
      { relativePath: 'simulator.py', content: 'x' },
      { relativePath: 'orchestrator.py', content: 'x' },
    ], AUDIT_ONLY))

    // No actionable candidates (test files are outside the audit-only ceiling).
    expect(result.candidates).toEqual([])
    // One aggregate note covering all three suppressed test-gaps.
    expect(result.suppressed).toHaveLength(1)
    const note = result.suppressed[0]!
    expect(note.domain).toBe('test-gap')
    expect(note.reason).toBe('outside allowedWritePaths')
    expect(note.count).toBe(3)
    expect(note.example).toMatch(/^tests\/test_.*\.py$/)
  })

  it('does NOT suppress when the test dir is in-ceiling (candidates produced, no notes)', () => {
    const inCeiling = {
      allowedWritePaths: ['tests/**'],
      allowedChecks: { 'syntax-check': { command: 'python3 -m compileall -q .', required: true } },
    } as unknown as LoadedProjectContract

    const result = source.discover(bundle([{ relativePath: 'engine.py', content: 'x' }], inCeiling))
    expect(result.candidates.some(c => c.domain === 'test-gap')).toBe(true)
    expect(result.suppressed).toEqual([])
  })

  it('suppressed findings never become candidate entries', () => {
    const result = source.discover(bundle([{ relativePath: 'engine.py', content: 'x' }], AUDIT_ONLY))
    // The suppressed module must not appear as a candidate expectedFile anywhere.
    const allExpected = result.candidates.flatMap(c => c.expectedFiles)
    expect(allExpected).not.toContain('tests/test_engine.py')
  })
})

describe('suppressed rendering', () => {
  const report: ScoutReport = {
    projectId: 'pipeline-x', stack: 'python', generatedAt: '2026-05-31T00:00:00.000Z',
    sourceIds: ['deterministic-v1'], bundleFileCount: 147, candidates: [],
    suppressed: [{ domain: 'test-gap', reason: 'outside allowedWritePaths', count: 12, example: 'tests/test_engine.py' }],
  }

  it('CANDIDATES.md renders a Suppressed section with count, reason, example', () => {
    const md = renderCandidatesMarkdown(report)
    expect(md).toContain('Suppressed — not actionable under this contract')
    expect(md).toContain('outside allowedWritePaths')
    expect(md).toContain('12')
    expect(md).toContain('tests/test_engine.py')
    // 0 actionable candidates is stated, pointing at the Suppressed section.
    expect(md).toMatch(/No actionable candidates under this contract/i)
  })

  it('candidates.json carries suppressed[]', () => {
    const parsed = JSON.parse(renderCandidatesJson(report)) as ScoutReport
    expect(parsed.suppressed).toHaveLength(1)
    expect(parsed.suppressed[0]!.count).toBe(12)
    expect(parsed.suppressed[0]!.reason).toBe('outside allowedWritePaths')
  })
})
