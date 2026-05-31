import { describe, it, expect } from 'vitest'
import { DeterministicSource } from '../src/scout/deterministic-source.js'
import { normalizeCandidate } from '../src/scout/scout-candidate.js'
import type { ScoutBundle, ScoutBundleFile } from '../src/scout/candidate-source.js'
import type { LoadedProjectContract } from '../src/projects/load-project-contract.js'

const CONTRACT = {
  allowedWritePaths: ['src/**', 'tests/**'],
  allowedChecks: { test: { command: 'npm test', required: true } },
} as unknown as LoadedProjectContract

// Mirrors Screenpipe-to-Obsidian: only the test dir is writable.
const PY_TESTS_ONLY = {
  allowedWritePaths: ['tests/**'],
  allowedChecks: { 'scripts-syntax': { command: 'python3 -m compileall -q .', required: true } },
} as unknown as LoadedProjectContract

function bundle(
  files: ScoutBundleFile[],
  projectId = 'powerplant-abc',
  contract: LoadedProjectContract = CONTRACT,
): ScoutBundle {
  return { projectId, stack: 'node-ts', files, contract }
}

const ROUTER_WITH_VERSION =
  "const [, , command] = process.argv\nswitch (command) {\n  case '--version': break\n  case 'run': break\n}"
const ROUTER_NO_VERSION =
  "const [, , command] = process.argv\nswitch (command) {\n  case 'run': break\n  case 'doctor': break\n}"
const PKG_WITH_VERSION = JSON.stringify({ name: 'x', version: '1.0.0' })

const source = new DeterministicSource()
// discover() returns { candidates, suppressed }; most tests assert on candidates.
const discover = (b: ScoutBundle) => source.discover(b).candidates

describe('DeterministicSource: missing --version', () => {
  it('proposes a candidate when the router has no --version handler', () => {
    const out = discover(bundle([
      { relativePath: 'src/cli/powerplant.ts', content: ROUTER_NO_VERSION },
      { relativePath: 'package.json', content: PKG_WITH_VERSION },
    ]))
    const versionCandidate = out.find(c => c.domain === 'cli-affordance')
    expect(versionCandidate).toBeDefined()
    expect(versionCandidate!.expectedFiles).toContain('src/cli/powerplant.ts')
    expect(versionCandidate!.verification).toContain('test')
  })

  it('does NOT propose when --version already exists (negative case)', () => {
    const out = discover(bundle([
      { relativePath: 'src/cli/powerplant.ts', content: ROUTER_WITH_VERSION },
      { relativePath: 'package.json', content: PKG_WITH_VERSION },
    ]))
    expect(out.find(c => c.domain === 'cli-affordance')).toBeUndefined()
  })

  it('does NOT propose when package.json has no version field', () => {
    const out = discover(bundle([
      { relativePath: 'src/cli/powerplant.ts', content: ROUTER_NO_VERSION },
      { relativePath: 'package.json', content: '{"name":"x"}' },
    ]))
    expect(out.find(c => c.domain === 'cli-affordance')).toBeUndefined()
  })
})

describe('DeterministicSource: stack-aware test gaps', () => {
  it('Python: untested module -> RECOMMENDED test candidate when tests/** is writable', () => {
    const out = discover(bundle(
      [
        { relativePath: 'vault_sync.py', content: 'def sync(): ...' },
        { relativePath: 'requirements.txt', content: 'requests' },
      ],
      'py-demo', PY_TESTS_ONLY,
    ))
    const gap = out.find(c => c.domain === 'test-gap')
    expect(gap).toBeDefined()
    // Expected write is a test file, never product code.
    expect(gap!.expectedFiles).toEqual(['tests/test_vault_sync.py'])
    expect(gap!.expectedFiles.every(f => f.startsWith('tests/'))).toBe(true)
    // End-to-end verdict is RECOMMENDED (low-risk, in-ceiling, declared check).
    expect(normalizeCandidate(gap!, PY_TESTS_ONLY).status).toBe('RECOMMENDED')
  })

  it('Python: covered module -> no candidate', () => {
    const out = discover(bundle(
      [
        { relativePath: 'vault_sync.py', content: 'def sync(): ...' },
        { relativePath: 'tests/test_vault_sync.py', content: 'def test_sync(): ...' },
      ],
      'py-demo', PY_TESTS_ONLY,
    ))
    expect(out.find(c => c.domain === 'test-gap')).toBeUndefined()
  })

  it('Python: emits nothing when the test dir is outside the write ceiling', () => {
    const docsOnly = {
      allowedWritePaths: ['docs/**'],
      allowedChecks: { test: { command: '', required: true } },
    } as unknown as LoadedProjectContract
    const out = discover(bundle([{ relativePath: 'vault_sync.py', content: 'x' }], 'py-demo', docsOnly))
    expect(out.find(c => c.domain === 'test-gap')).toBeUndefined()
  })

  it('caps test-gap candidates at 3 even with many untested modules', () => {
    const files = Array.from({ length: 8 }, (_, i) => ({ relativePath: `mod_${i}.py`, content: 'x' }))
    const gaps = discover(bundle(files, 'py-demo', PY_TESTS_ONLY)).filter(c => c.domain === 'test-gap')
    expect(gaps.length).toBeLessThanOrEqual(3)
  })

  it('prioritizes app-facing module names within the cap', () => {
    const files = [
      { relativePath: 'zzz.py', content: 'x' },
      { relativePath: 'aaa.py', content: 'x' },
      { relativePath: 'config.py', content: 'x' },      // hint: config
      { relativePath: 'sync_engine.py', content: 'x' },  // hint: sync
      { relativePath: 'provider.py', content: 'x' },     // hint: provider
      { relativePath: 'bbb.py', content: 'x' },
    ]
    const titles = discover(bundle(files, 'py-demo', PY_TESTS_ONLY))
      .filter(c => c.domain === 'test-gap')
      .map(c => c.title)
    expect(titles.some(t => t.includes('config.py'))).toBe(true)
    expect(titles.some(t => t.includes('sync_engine.py'))).toBe(true)
    expect(titles.some(t => t.includes('provider.py'))).toBe(true)
  })

  it('TypeScript: untested src module -> bounded test candidate', () => {
    const gap = discover(bundle([
      { relativePath: 'src/cli/commands/doctor.ts', content: 'export const cmdDoctor = () => {}' },
      { relativePath: 'tests/cli-run.test.ts', content: 'covered run' },
    ])).filter(c => c.domain === 'test-gap').find(c => c.title.includes('doctor.ts'))
    expect(gap).toBeDefined()
    expect(gap!.expectedFiles).toEqual(['tests/doctor.test.ts'])
  })

  it('Rust: never emits a test-gap candidate (skipped, not falsely RECOMMENDED)', () => {
    const out = discover(bundle([
      { relativePath: 'src/main.rs', content: 'fn main() {}' },
      { relativePath: 'src-tauri/src/lib.rs', content: 'pub fn x() {}' },
    ], 'rust-demo', PY_TESTS_ONLY))
    expect(out.find(c => c.domain === 'test-gap')).toBeUndefined()
  })

  it('subsumes the old CLI-command behavior: uncovered command flagged, covered one skipped', () => {
    const titles = discover(bundle([
      { relativePath: 'src/cli/commands/doctor.ts', content: 'x' },
      { relativePath: 'src/cli/commands/run.ts', content: 'x' },
      { relativePath: 'tests/cli-run.test.ts', content: 'covered' },
    ])).filter(c => c.domain === 'test-gap').map(c => c.title)
    expect(titles.some(t => t.includes('doctor.ts'))).toBe(true)
    expect(titles.some(t => t.includes('commands/run.ts'))).toBe(false) // 'run' covered
  })
})

describe('DeterministicSource: candidate-quality ranking', () => {
  const testGapTitles = (files: ScoutBundleFile[]): string[] =>
    discover(bundle(files, 'py-demo', PY_TESTS_ONLY))
      .filter(c => c.domain === 'test-gap')
      .map(c => c.title)

  const orderOf = (titles: string[], needle: string): number =>
    titles.findIndex(t => t.includes(needle))

  it('ranks an app-facing module ahead of a generic one', () => {
    const titles = testGapTitles([
      { relativePath: 'misc.py', content: 'x' },
      { relativePath: 'provider.py', content: 'x' },
    ])
    expect(orderOf(titles, 'provider.py')).toBeLessThan(orderOf(titles, 'misc.py'))
  })

  it('penalizes hook/script-located modules below plain app modules', () => {
    const titles = testGapTitles([
      { relativePath: 'app_core.py', content: 'x' },
      { relativePath: 'hooks/cleanup.py', content: 'x' },
    ])
    expect(orderOf(titles, 'app_core.py')).toBeLessThan(orderOf(titles, 'hooks/cleanup.py'))
  })

  it('down-ranks a hyphenated (non-importable) Python file below an importable module', () => {
    const titles = testGapTitles([
      { relativePath: 'weird-name.py', content: 'x' },
      { relativePath: 'cleanup_legacy.py', content: 'x' },
    ])
    expect(orderOf(titles, 'cleanup_legacy.py')).toBeLessThan(orderOf(titles, 'weird-name.py'))
  })

  it('down-ranks but does NOT exclude awkward candidates (evidence preserved)', () => {
    // Only an awkward candidate exists — it must still be emitted, not dropped.
    const titles = testGapTitles([
      { relativePath: '.claude/hooks/guard-sensitive-write.py', content: 'x' },
    ])
    expect(titles.some(t => t.includes('guard-sensitive-write'))).toBe(true)
  })

  it('keeps the .claude hook script out of the top 3 when better modules exist (Screenpipe case)', () => {
    const titles = testGapTitles([
      { relativePath: 'ai_provider.py', content: 'x' },
      { relativePath: 'vault_sync.py', content: 'x' },
      { relativePath: 'gui.py', content: 'x' },
      { relativePath: '.claude/hooks/guard-sensitive-write.py', content: 'x' },
    ])
    expect(titles.length).toBeLessThanOrEqual(3)
    expect(titles.some(t => t.includes('ai_provider.py'))).toBe(true)
    expect(titles.some(t => t.includes('vault_sync.py'))).toBe(true)
    expect(titles.some(t => t.includes('guard-sensitive-write'))).toBe(false)
  })
})

describe('DeterministicSource: README/router mismatch', () => {
  it('flags a documented command the router does not handle', () => {
    const out = discover(bundle(
      [
        { relativePath: 'src/cli/powerplant.ts', content: ROUTER_WITH_VERSION },
        { relativePath: 'package.json', content: PKG_WITH_VERSION },
        { relativePath: 'README.md', content: 'Run `powerplant deploy` to ship.' },
      ],
      'powerplant-abc',
    ))
    const docs = out.find(c => c.domain === 'docs-mismatch')
    expect(docs).toBeDefined()
    expect(docs!.title).toContain('deploy')
  })

  it('does not throw when projectId contains regex metacharacters', () => {
    // projectId is user-controlled (POLICY.yaml) and feeds the docs regex.
    expect(() =>
      discover(bundle(
        [
          { relativePath: 'src/cli/powerplant.ts', content: ROUTER_WITH_VERSION },
          { relativePath: 'package.json', content: PKG_WITH_VERSION },
          { relativePath: 'README.md', content: 'docs' },
        ],
        'my(app[x-demo',
      )),
    ).not.toThrow()
  })

  it('does not flag commands the router DOES handle', () => {
    const out = discover(bundle(
      [
        { relativePath: 'src/cli/powerplant.ts', content: ROUTER_WITH_VERSION },
        { relativePath: 'package.json', content: PKG_WITH_VERSION },
        { relativePath: 'README.md', content: 'Use `powerplant run` to start.' },
      ],
      'powerplant-abc',
    ))
    expect(out.find(c => c.domain === 'docs-mismatch')).toBeUndefined()
  })
})

describe('DeterministicSource: id assignment', () => {
  it('assigns sequential scout-NNN ids', () => {
    const out = discover(bundle([
      { relativePath: 'src/cli/powerplant.ts', content: ROUTER_NO_VERSION },
      { relativePath: 'package.json', content: PKG_WITH_VERSION },
      { relativePath: 'src/cli/commands/doctor.ts', content: 'x' },
    ]))
    expect(out.length).toBeGreaterThan(0)
    expect(out[0]!.id).toMatch(/^scout-\d{3}$/)
    const ids = out.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length) // unique
  })
})
