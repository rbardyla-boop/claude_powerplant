import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { walkPayloadFiles, buildCanonicalHash, type PayloadFile } from '../src/skills/skill-hash.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-hash-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function writeFile(relPath: string, content: string | Buffer): void {
  const fp = path.join(tmpDir, relPath)
  fs.mkdirSync(path.dirname(fp), { recursive: true })
  if (typeof content === 'string') {
    fs.writeFileSync(fp, content, 'utf-8')
  } else {
    fs.writeFileSync(fp, content)
  }
}

function hash(files: PayloadFile[], contents: Map<string, Buffer>): string {
  return buildCanonicalHash(files, contents)
}

function hashDir(dir: string): string {
  const walk = walkPayloadFiles(dir)
  if (!walk.success) throw new Error(`Walk failed: ${walk.reason}`)
  const contents = new Map<string, Buffer>()
  for (const { normalizedRelPath, absPath } of walk.files) {
    contents.set(normalizedRelPath, fs.readFileSync(absPath))
  }
  return buildCanonicalHash(walk.files, contents)
}

// ── walkPayloadFiles tests ────────────────────────────────────────────────────

describe('walkPayloadFiles: basic traversal', () => {
  test('returns sorted normalized paths for a flat directory', () => {
    writeFile('b.txt', 'b')
    writeFile('a.txt', 'a')
    writeFile('c.txt', 'c')

    const result = walkPayloadFiles(tmpDir)
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.files.map(f => f.normalizedRelPath)).toEqual(['a.txt', 'b.txt', 'c.txt'])
  })

  test('normalizes path separators to POSIX /', () => {
    writeFile('sub/file.txt', 'content')

    const result = walkPayloadFiles(tmpDir)
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.files[0]?.normalizedRelPath).toBe('sub/file.txt')
  })

  test('sorts recursively across subdirectories', () => {
    writeFile('z/file.txt', 'z')
    writeFile('a/file.txt', 'a')
    writeFile('m.txt', 'm')

    const result = walkPayloadFiles(tmpDir)
    expect(result.success).toBe(true)
    if (!result.success) return

    const paths = result.files.map(f => f.normalizedRelPath)
    // 'a/file.txt' < 'm.txt' < 'z/file.txt' in byte order
    expect(paths).toEqual(['a/file.txt', 'm.txt', 'z/file.txt'])
  })

  test('excludes .powerplant-meta.json from payload', () => {
    writeFile('SKILL.md', '# Skill')
    writeFile('.powerplant-meta.json', '{"id":"test"}')

    const result = walkPayloadFiles(tmpDir)
    expect(result.success).toBe(true)
    if (!result.success) return

    const paths = result.files.map(f => f.normalizedRelPath)
    expect(paths).toContain('SKILL.md')
    expect(paths).not.toContain('.powerplant-meta.json')
  })

  test('includes all other imported regular files', () => {
    writeFile('SKILL.md', '# Skill')
    writeFile('manifest.json', '{}')
    writeFile('scripts/run.sh', 'echo hi')
    writeFile('tests/test.sh', 'echo test')
    writeFile('resources/data.json', '{}')
    writeFile('references/ref.md', '# Ref')
    writeFile('extra-file.txt', 'extra')

    const result = walkPayloadFiles(tmpDir)
    expect(result.success).toBe(true)
    if (!result.success) return

    const paths = result.files.map(f => f.normalizedRelPath)
    expect(paths).toContain('SKILL.md')
    expect(paths).toContain('manifest.json')
    expect(paths).toContain('scripts/run.sh')
    expect(paths).toContain('tests/test.sh')
    expect(paths).toContain('resources/data.json')
    expect(paths).toContain('references/ref.md')
    expect(paths).toContain('extra-file.txt')
  })

  test('rejects directory containing a symlink', () => {
    writeFile('SKILL.md', '# Skill')
    fs.symlinkSync('/etc/passwd', path.join(tmpDir, 'evil-link'))

    const result = walkPayloadFiles(tmpDir)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.reason).toMatch(/symlink/i)
  })
})

// ── canonical hash: determinism ───────────────────────────────────────────────

describe('buildCanonicalHash: identical inputs yield identical hash', () => {
  test('same files and contents always produce the same hash', () => {
    writeFile('SKILL.md', '# My Skill')
    writeFile('manifest.json', '{"name":"my-skill"}')

    const h1 = hashDir(tmpDir)
    const h2 = hashDir(tmpDir)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[a-f0-9]{64}$/)
  })

  test('hash is independent of OS filesystem enumeration order', () => {
    // Create files in one order
    writeFile('z.txt', 'z content')
    writeFile('a.txt', 'a content')
    writeFile('m.txt', 'm content')

    // Walk twice — the sorted order guarantees the same hash regardless of OS order
    const h1 = hashDir(tmpDir)
    const h2 = hashDir(tmpDir)
    expect(h1).toBe(h2)
  })
})

describe('buildCanonicalHash: byte-level identity sensitivity', () => {
  test('changing one payload byte changes the hash', () => {
    writeFile('SKILL.md', '# Original content')

    const h1 = hashDir(tmpDir)

    fs.writeFileSync(path.join(tmpDir, 'SKILL.md'), '# Original contentX', 'utf-8')
    const h2 = hashDir(tmpDir)

    expect(h1).not.toBe(h2)
  })

  test('changing a relative path changes the hash', () => {
    writeFile('SKILL.md', '# Same content')

    const walk1 = walkPayloadFiles(tmpDir)
    expect(walk1.success).toBe(true)
    if (!walk1.success) return

    const contents = new Map<string, Buffer>()
    for (const { normalizedRelPath, absPath } of walk1.files) {
      contents.set(normalizedRelPath, fs.readFileSync(absPath))
    }

    // Same content, different path name → different hash
    const filesOriginal: PayloadFile[] = [{ normalizedRelPath: 'SKILL.md', absPath: path.join(tmpDir, 'SKILL.md') }]
    const filesRenamed: PayloadFile[] = [{ normalizedRelPath: 'RENAMED.md', absPath: path.join(tmpDir, 'SKILL.md') }]
    const contentsForBoth = new Map<string, Buffer>([
      ['SKILL.md', Buffer.from('# Same content', 'utf-8')],
      ['RENAMED.md', Buffer.from('# Same content', 'utf-8')],
    ])

    const h1 = hash(filesOriginal, contentsForBoth)
    const h2 = hash(filesRenamed, contentsForBoth)

    expect(h1).not.toBe(h2)
  })

  test('adding a file changes the hash', () => {
    writeFile('SKILL.md', '# Skill')
    const h1 = hashDir(tmpDir)

    writeFile('extra.txt', 'extra')
    const h2 = hashDir(tmpDir)

    expect(h1).not.toBe(h2)
  })
})

describe('buildCanonicalHash: source-supplied manifest.json participates', () => {
  test('manifest.json included: hash differs from hash without it', () => {
    writeFile('SKILL.md', '# Skill')
    const hashWithout = hashDir(tmpDir)

    writeFile('manifest.json', '{"schemaVersion":1,"name":"test"}')
    const hashWith = hashDir(tmpDir)

    expect(hashWith).not.toBe(hashWithout)
  })
})

describe('buildCanonicalHash: .memory.md participates in hash', () => {
  test('.memory.md included in hash if supplied by source', () => {
    writeFile('SKILL.md', '# Skill')
    const hashWithout = hashDir(tmpDir)

    writeFile('.memory.md', '# Memory notes')
    const hashWith = hashDir(tmpDir)

    expect(hashWith).not.toBe(hashWithout)
  })
})

describe('buildCanonicalHash: .powerplant-meta.json excluded', () => {
  test('adding .powerplant-meta.json does not change the hash', () => {
    writeFile('SKILL.md', '# Skill')
    const hashBefore = hashDir(tmpDir)

    writeFile('.powerplant-meta.json', '{"candidateId":"test","sha256":"abc"}')
    const hashAfter = hashDir(tmpDir)

    expect(hashBefore).toBe(hashAfter)
  })
})

describe('buildCanonicalHash: extra imported files are included', () => {
  test('unknown extra files are hashed, not silently omitted', () => {
    writeFile('SKILL.md', '# Skill')
    const h1 = hashDir(tmpDir)

    writeFile('unknown-extra-file.json', '{"custom":"data"}')
    const h2 = hashDir(tmpDir)

    expect(h1).not.toBe(h2)
  })
})

describe('buildCanonicalHash: sidecar update does not change payload hash', () => {
  test('modifying .powerplant-meta.json does not change the canonical hash', () => {
    writeFile('SKILL.md', '# Skill')
    writeFile('.powerplant-meta.json', '{"version":1}')
    const h1 = hashDir(tmpDir)

    fs.writeFileSync(
      path.join(tmpDir, '.powerplant-meta.json'),
      '{"version":2,"sha256":"changed"}',
      'utf-8'
    )
    const h2 = hashDir(tmpDir)

    expect(h1).toBe(h2)
  })
})

describe('buildCanonicalHash: domain separator ensures uniqueness', () => {
  test('produces a 64-char lowercase hex string', () => {
    writeFile('SKILL.md', '# Skill')
    const h = hashDir(tmpDir)
    expect(h).toMatch(/^[a-f0-9]{64}$/)
  })

  test('empty directory yields a deterministic non-empty hash', () => {
    // Empty dirs contain no files — hash is just domain separator
    const h1 = hashDir(tmpDir)
    const h2 = hashDir(tmpDir)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[a-f0-9]{64}$/)
  })
})
