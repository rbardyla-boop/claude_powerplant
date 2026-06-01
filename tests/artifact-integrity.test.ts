/**
 * Regression tests for the newline-escape artifact-integrity guard.
 *
 * Surfaced by dogfood run pp-run-1780221427722 (poly trading bot): an agent
 * emitted a large Python file whose line separators were literal "\n" escapes,
 * producing a 16 KB single-line invalid-Python artifact that still "passed"
 * verification (the checks ran against the existing repo, not the new file).
 *
 * Invariant under test: a source file written with escaped line separators must
 * be rejected before it is materialized, and a normally-formatted multiline file
 * must pass through untouched and diff as real newline-separated content.
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  detectNewlineEscapeCorruption,
  detectQuoteEscapeCorruption,
  detectArtifactCorruption,
} from '../src/projects/detect-artifact-corruption.js'

const execFileAsync = promisify(execFile)

// A normally-formatted multiline Python module (real newlines).
const CLEAN_PY = [
  '#!/usr/bin/env python3',
  '"""Module docstring."""',
  'import os',
  '',
  'def add(a, b):',
  '    return a + b',
  '',
  'class Thing:',
  '    def method(self):',
  '        return "line1\\nline2"  # legitimate escaped newline in a string',
  '',
].join('\n')

// The corruption signature: the whole body collapsed into one physical line with
// literal "\n" escapes standing in for line separators (mirrors the 16 KB poly
// artifact — a long single physical line, not a short snippet).
const CORRUPT_PY =
  '#!/usr/bin/env python3\n' +
  '"""docstring"""\\nimport os\\n\\n' +
  Array.from({ length: 30 }, (_, i) =>
    `def func_${i}(a, b):\\n    result = a + b\\n    return result`,
  ).join('\\n\\n') +
  '\\n'

describe('detectNewlineEscapeCorruption', () => {
  it('flags a source file collapsed to one escaped line', () => {
    const r = detectNewlineEscapeCorruption('tests/test_x.py', CORRUPT_PY)
    expect(r.corrupt).toBe(true)
    expect(r.reason).toMatch(/real newline/i)
  })

  it('passes a normally-formatted multiline source file', () => {
    expect(detectNewlineEscapeCorruption('src/x.py', CLEAN_PY).corrupt).toBe(false)
  })

  it('does not flag legitimate "\\n" inside string literals when real newlines exist', () => {
    const src = Array.from({ length: 40 }, (_, i) => `line_${i} = "a\\nb"`).join('\n')
    expect(detectNewlineEscapeCorruption('src/strings.py', src).corrupt).toBe(false)
  })

  it('ignores non-source extensions (single-line JSON/CSV data is legitimate)', () => {
    const json = '{"a":"x\\ny\\nz","b":"p\\nq\\nr","c":"1\\n2\\n3\\n4\\n5"}'.repeat(10)
    expect(detectNewlineEscapeCorruption('data/fixture.json', json).corrupt).toBe(false)
  })

  it('does not flag a short single-line source file', () => {
    expect(detectNewlineEscapeCorruption('src/x.py', 'x = 1\n').corrupt).toBe(false)
  })

  it('does not flag a long minified single line with no escaped newlines', () => {
    const minified = 'const x=' + '1+'.repeat(500) + '1;'
    expect(detectNewlineEscapeCorruption('src/bundle.js', minified).corrupt).toBe(false)
  })

  it('covers multiple code extensions', () => {
    for (const ext of ['.ts', '.go', '.rs', '.java', '.rb']) {
      expect(detectNewlineEscapeCorruption(`f${ext}`, CORRUPT_PY).corrupt).toBe(true)
    }
  })
})

// A real multi-section Markdown audit report (real newlines).
const CLEAN_MD = [
  '# Steam Beta Release-Readiness Audit',
  '',
  '## Gate 1: Stability',
  '- Boots without panic',
  '- Save/load round-trips',
  '',
  '## Gate 2: Packaging',
  '- No secrets in the bundle',
  '- Version visible in-app',
].join('\n')

// The corruption signature on a Markdown deliverable: the whole report collapsed
// to one physical line with literal "\n" escapes (mirrors the Steam-beta audit
// run that materialized docs/STEAM_BETA_AUDIT.md as a single escaped line).
const CORRUPT_MD =
  '# Steam Beta Release-Readiness Audit\\n\\n' +
  Array.from({ length: 30 }, (_, i) =>
    `## Gate ${i}\\n- finding ${i}\\n- evidence ${i}`,
  ).join('\\n\\n') +
  '\\n'

describe('detectNewlineEscapeCorruption: document deliverables', () => {
  it('rejects a corrupt single-line escaped Markdown audit doc', () => {
    const r = detectNewlineEscapeCorruption('docs/STEAM_BETA_AUDIT.md', CORRUPT_MD)
    expect(r.corrupt).toBe(true)
    expect(r.reason).toMatch(/real newline/i)
  })

  it('accepts a normal multi-section Markdown report', () => {
    expect(detectNewlineEscapeCorruption('docs/STEAM_BETA_AUDIT.md', CLEAN_MD).corrupt).toBe(false)
  })

  it('accepts single-line Markdown with only a few escaped "\\n" snippets', () => {
    // >200 chars, <=2 real newlines, but fewer than 5 escaped "\n" → below threshold.
    const md =
      '# Note\n\nThis documents an escape example like `a\\nb\\nc\\nd` in one code span, ' +
      'padding text '.repeat(20) + 'end.'
    expect(detectNewlineEscapeCorruption('docs/note.md', md).corrupt).toBe(false)
  })

  it('covers .markdown / .txt / .rst deliverable extensions', () => {
    for (const ext of ['.markdown', '.txt', '.rst']) {
      expect(detectNewlineEscapeCorruption(`docs/report${ext}`, CORRUPT_MD).corrupt).toBe(true)
    }
  })

  it('still ignores single-line data files (JSON unaffected by the doc extension addition)', () => {
    const json = '{"a":"x\\ny\\nz","b":"p\\nq\\nr","c":"1\\n2\\n3\\n4\\n5"}'.repeat(10)
    expect(detectNewlineEscapeCorruption('docs/data.json', json).corrupt).toBe(false)
  })
})

// Class 2 corruption: a MULTI-LINE source file whose quotes are escaped as \"
// throughout (mirrors the Steam App-ID fix run pp-run-1780272564172 steam.rs).
const CORRUPT_RS = [
  'fn get_app_id() -> u32 {',
  '    std::env::var(\\"STEAM_APP_ID\\").ok().and_then(|s| s.parse::<u32>().ok()).unwrap_or(480)',
  '}',
  'const A: &[&str] = &[\\"X\\", \\"Y\\", \\"Z\\", \\"W\\", \\"V\\"];',
  'fn log() { eprintln!(\\"[Steam] init failed\\"); eprintln!(\\"[Steam] retry\\"); }',
].join('\n')

// Legit Rust: one string literal containing a couple of escaped quotes.
const LEGIT_RS = [
  'fn main() {',
  '    let s = "he said \\"hello\\"";',
  '    println!("{}", s);',
  '    let name = "singularity";',
  '}',
].join('\n')

// Legit Rust with MANY escaped quotes, but balanced ~1:1 by real quotes (not dominant).
const LEGIT_RS_MANY = Array.from(
  { length: 20 },
  (_, i) => `    let s${i} = "value \\"${i}\\" end";`,
).join('\n')

describe('detectQuoteEscapeCorruption: escaped-quote source (Class 2)', () => {
  it('rejects a multi-line .rs whose quotes are escaped throughout', () => {
    const r = detectQuoteEscapeCorruption('src-tauri/src/steam.rs', CORRUPT_RS)
    expect(r.corrupt).toBe(true)
    expect(r.reason).toMatch(/escaped quote/i)
  })

  it('accepts normal Rust with a string containing a few escaped quotes', () => {
    expect(detectQuoteEscapeCorruption('src/main.rs', LEGIT_RS).corrupt).toBe(false)
  })

  it('accepts Rust with many escaped quotes when real quotes are not dominated (ratio guard)', () => {
    expect(detectQuoteEscapeCorruption('src/x.rs', LEGIT_RS_MANY).corrupt).toBe(false)
  })

  it('does not apply to JSON (escaped quotes are legitimate there)', () => {
    const json = '{\\"a\\":\\"x\\",\\"b\\":\\"y\\",\\"c\\":\\"z\\",\\"d\\":\\"w\\",\\"e\\":\\"v\\"}'
    expect(detectQuoteEscapeCorruption('config/data.json', json).corrupt).toBe(false)
  })

  it('covers the source extensions that need it (.ts/.go/.java)', () => {
    for (const ext of ['.ts', '.go', '.java']) {
      expect(detectQuoteEscapeCorruption(`f${ext}`, CORRUPT_RS).corrupt).toBe(true)
    }
  })
})

describe('detectArtifactCorruption: combined entry point', () => {
  it('catches escaped-quote Rust (Class 2)', () => {
    expect(detectArtifactCorruption('src-tauri/src/steam.rs', CORRUPT_RS).corrupt).toBe(true)
  })
  it('still catches escaped-newline Python (Class 1)', () => {
    expect(detectArtifactCorruption('tests/test_x.py', CORRUPT_PY).corrupt).toBe(true)
  })
  it('still catches escaped-newline Markdown (Class 1 on doc)', () => {
    expect(detectArtifactCorruption('docs/STEAM_BETA_AUDIT.md', CORRUPT_MD).corrupt).toBe(true)
  })
  it('passes clean multiline source and a clean Markdown doc', () => {
    expect(detectArtifactCorruption('src/main.rs', LEGIT_RS).corrupt).toBe(false)
    expect(detectArtifactCorruption('docs/x.md', CLEAN_MD).corrupt).toBe(false)
  })
  it('passes JSON with escaped quotes (outside both guards)', () => {
    const json = '{\\"a\\":\\"x\\",\\"b\\":\\"y\\",\\"c\\":\\"z\\",\\"d\\":\\"w\\",\\"e\\":\\"v\\"}'
    expect(detectArtifactCorruption('config/data.json', json).corrupt).toBe(false)
  })
})

describe('clean multiline content diffs as real newlines', () => {
  it('produces a multi-line addition diff, not one escaped line', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-artifact-'))
    try {
      const workFile = path.join(dir, 'clean.py')
      fs.writeFileSync(workFile, CLEAN_PY, 'utf-8')

      let stdout = ''
      try {
        const r = await execFileAsync('diff', ['-u', '--label', '/dev/null', '--label', 'b/clean.py', '/dev/null', workFile])
        stdout = r.stdout
      } catch (err: unknown) {
        const e = err as { code?: number; stdout?: string }
        if (e.code === 1) stdout = e.stdout ?? ''
        else throw err
      }

      const addedLines = stdout.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'))
      // Real newlines → many '+' lines; the corruption would yield ~1 giant line.
      expect(addedLines.length).toBeGreaterThan(5)
      expect(addedLines.some(l => l === '+def add(a, b):')).toBe(true)
      // No single added line should carry the escaped-separator signature.
      expect(addedLines.every(l => (l.match(/\\n/g) ?? []).length < 5)).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
