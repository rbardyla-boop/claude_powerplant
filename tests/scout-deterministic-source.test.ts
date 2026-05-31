import { describe, it, expect } from 'vitest'
import { DeterministicSource } from '../src/scout/deterministic-source.js'
import type { ScoutBundle, ScoutBundleFile } from '../src/scout/candidate-source.js'
import type { LoadedProjectContract } from '../src/projects/load-project-contract.js'

const CONTRACT = {
  allowedWritePaths: ['src/**', 'tests/**'],
  allowedChecks: { test: { command: 'npm test', required: true } },
} as unknown as LoadedProjectContract

function bundle(files: ScoutBundleFile[], projectId = 'powerplant-abc'): ScoutBundle {
  return { projectId, stack: 'node-ts', files, contract: CONTRACT }
}

const ROUTER_WITH_VERSION =
  "const [, , command] = process.argv\nswitch (command) {\n  case '--version': break\n  case 'run': break\n}"
const ROUTER_NO_VERSION =
  "const [, , command] = process.argv\nswitch (command) {\n  case 'run': break\n  case 'doctor': break\n}"
const PKG_WITH_VERSION = JSON.stringify({ name: 'x', version: '1.0.0' })

const source = new DeterministicSource()

describe('DeterministicSource: missing --version', () => {
  it('proposes a candidate when the router has no --version handler', () => {
    const out = source.discover(bundle([
      { relativePath: 'src/cli/powerplant.ts', content: ROUTER_NO_VERSION },
      { relativePath: 'package.json', content: PKG_WITH_VERSION },
    ]))
    const versionCandidate = out.find(c => c.domain === 'cli-affordance')
    expect(versionCandidate).toBeDefined()
    expect(versionCandidate!.expectedFiles).toContain('src/cli/powerplant.ts')
    expect(versionCandidate!.verification).toContain('test')
  })

  it('does NOT propose when --version already exists (negative case)', () => {
    const out = source.discover(bundle([
      { relativePath: 'src/cli/powerplant.ts', content: ROUTER_WITH_VERSION },
      { relativePath: 'package.json', content: PKG_WITH_VERSION },
    ]))
    expect(out.find(c => c.domain === 'cli-affordance')).toBeUndefined()
  })

  it('does NOT propose when package.json has no version field', () => {
    const out = source.discover(bundle([
      { relativePath: 'src/cli/powerplant.ts', content: ROUTER_NO_VERSION },
      { relativePath: 'package.json', content: '{"name":"x"}' },
    ]))
    expect(out.find(c => c.domain === 'cli-affordance')).toBeUndefined()
  })
})

describe('DeterministicSource: CLI command test gaps', () => {
  it('proposes a test for an uncovered command, skips covered ones', () => {
    const out = source.discover(bundle([
      { relativePath: 'src/cli/powerplant.ts', content: ROUTER_WITH_VERSION },
      { relativePath: 'package.json', content: PKG_WITH_VERSION },
      { relativePath: 'src/cli/commands/doctor.ts', content: 'export const cmdDoctor = () => {}' },
      { relativePath: 'src/cli/commands/run.ts', content: 'export const cmdRun = () => {}' },
      { relativePath: 'tests/cli-run.test.ts', content: 'test covered' },
    ]))
    const gaps = out.filter(c => c.domain === 'test-gap')
    const titles = gaps.map(c => c.title)
    expect(titles.some(t => t.includes('doctor'))).toBe(true)
    expect(titles.some(t => t.includes('run'))).toBe(false) // covered by cli-run.test.ts
    const doctorGap = gaps.find(c => c.title.includes('doctor'))!
    expect(doctorGap.expectedFiles).toEqual(['tests/cli-doctor.test.ts'])
  })
})

describe('DeterministicSource: README/router mismatch', () => {
  it('flags a documented command the router does not handle', () => {
    const out = source.discover(bundle(
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
      source.discover(bundle(
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
    const out = source.discover(bundle(
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
    const out = source.discover(bundle([
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
