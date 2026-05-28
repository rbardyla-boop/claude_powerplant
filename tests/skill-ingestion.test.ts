import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  ingestSkillPackage,
  copyToSnapshot,
  DEFAULT_GATE0_LIMITS,
  type IngestionSuccess,
  type ValidatedFileEntry,
} from '../src/skills/skill-ingestion.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const FIXTURE_DIR = path.join(process.cwd(), 'fixtures', 'skills')
let tmpPowerplantHome: string
let tmpSourceDir: string

function fixturePath(name: string): string {
  return path.join(FIXTURE_DIR, name)
}

function makeTmpSourceDir(name: string): string {
  const dir = path.join(tmpSourceDir, name)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function writeFile(dir: string, relPath: string, content: string): void {
  const fp = path.join(dir, relPath)
  fs.mkdirSync(path.dirname(fp), { recursive: true })
  fs.writeFileSync(fp, content, 'utf-8')
}

function readAuditLog(): string {
  const auditPath = path.join(tmpPowerplantHome, 'state', 'skill-audit.jsonl')
  if (!fs.existsSync(auditPath)) return ''
  return fs.readFileSync(auditPath, 'utf-8')
}

function getCandidatesDir(): string {
  return path.join(tmpPowerplantHome, 'skills', 'candidates')
}

function getQuarantineDir(): string {
  return path.join(tmpPowerplantHome, 'skills', 'quarantine')
}

beforeEach(() => {
  tmpPowerplantHome = fs.mkdtempSync(path.join(os.tmpdir(), 'powerplant-test-'))
  tmpSourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-source-test-'))
  process.env['POWERPLANT_HOME'] = tmpPowerplantHome
})

afterEach(() => {
  delete process.env['POWERPLANT_HOME']
  fs.rmSync(tmpPowerplantHome, { recursive: true, force: true })
  fs.rmSync(tmpSourceDir, { recursive: true, force: true })
})

// ── Gate 0 rejection tests ────────────────────────────────────────────────────
// Each Gate 0 rejection must:
//   1. Return success: false with failedGate: 'GATE_0'
//   2. Have candidateId: null (no snapshot was created)
//   3. Create NO files in candidates/
//   4. Write an import-rejected audit event with failedGate: 'GATE_0'

describe('Gate 0: symlink rejection', () => {
  test('rejects a package containing a symlink and creates no snapshot', async () => {
    const src = makeTmpSourceDir('symlink-test')
    writeFile(src, 'SKILL.md', '# Test\n')
    writeFile(src, 'manifest.json', JSON.stringify({
      schemaVersion: 1, id: '00000000-0000-0000-0000-000000000001', name: 'test-skill',
      version: 1, description: 'test', tags: [], createdAt: '2026-01-01T00:00:00.000Z',
      promotedAt: null, sourceRunId: null, sha256: null, evaluationPassed: false, evaluationAt: null,
    }))
    // Create a symlink inside the package
    fs.symlinkSync('/etc/passwd', path.join(src, 'malicious-link'))

    const result = await ingestSkillPackage(src)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.failedGate).toBe('GATE_0')
      expect(result.candidateId).toBeNull()
      expect(result.reason).toContain('Symlink')
    }

    // No candidate snapshot created
    expect(fs.existsSync(getCandidatesDir())).toBe(false)

    // Audit event written with correct gate
    const auditLog = readAuditLog()
    expect(auditLog).toBeTruthy()
    const event = JSON.parse(auditLog.trim().split('\n')[0] ?? '')
    expect(event.event).toBe('import-rejected')
    expect(event.failedGate).toBe('GATE_0')
    expect(event.candidateId).toBeNull()
  })
})

describe('Gate 0: oversized file rejection', () => {
  test('rejects a package with a file exceeding the size limit', async () => {
    const src = makeTmpSourceDir('oversized-test')
    writeFile(src, 'SKILL.md', '# Test\n')
    // Write a file larger than 512 KB
    const oversizedContent = Buffer.alloc(DEFAULT_GATE0_LIMITS.maxFileSizeBytes + 1, 'x')
    fs.writeFileSync(path.join(src, 'large-file.txt'), oversizedContent)

    const result = await ingestSkillPackage(src)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.failedGate).toBe('GATE_0')
      expect(result.candidateId).toBeNull()
      expect(result.reason).toMatch(/size limit|exceeds/i)
    }

    expect(fs.existsSync(getCandidatesDir())).toBe(false)

    const auditLog = readAuditLog()
    const event = JSON.parse(auditLog.trim().split('\n')[0] ?? '')
    expect(event.event).toBe('import-rejected')
    expect(event.failedGate).toBe('GATE_0')
    expect(event.candidateId).toBeNull()
  })
})

describe('Gate 0: file count limit rejection', () => {
  test('rejects a package exceeding the file count limit', async () => {
    const src = makeTmpSourceDir('toomany-test')
    writeFile(src, 'SKILL.md', '# Test\n')
    // Create more files than the limit
    for (let i = 0; i < DEFAULT_GATE0_LIMITS.maxFileCount + 1; i++) {
      writeFile(src, `file-${i}.txt`, 'x')
    }

    const result = await ingestSkillPackage(src)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.failedGate).toBe('GATE_0')
      expect(result.candidateId).toBeNull()
      expect(result.reason).toMatch(/file count|limit/i)
    }

    expect(fs.existsSync(getCandidatesDir())).toBe(false)
  })
})

describe('Gate 0: depth limit rejection', () => {
  test('rejects a package exceeding directory depth limit', async () => {
    const src = makeTmpSourceDir('deep-test')
    writeFile(src, 'SKILL.md', '# Test\n')
    // Create a directory chain exceeding maxDepth
    let deepDir = src
    for (let i = 0; i <= DEFAULT_GATE0_LIMITS.maxDepth + 1; i++) {
      deepDir = path.join(deepDir, `level-${i}`)
      fs.mkdirSync(deepDir, { recursive: true })
    }
    writeFile(deepDir, 'file.txt', 'content')

    const result = await ingestSkillPackage(src)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.failedGate).toBe('GATE_0')
      expect(result.candidateId).toBeNull()
    }

    expect(fs.existsSync(getCandidatesDir())).toBe(false)
  })
})

describe('Gate 0: hardlink rejection', () => {
  test('rejects a package containing a hardlinked file (nlink > 1)', async () => {
    const src = makeTmpSourceDir('hardlink-test')
    writeFile(src, 'SKILL.md', '# Test\n')
    const original = path.join(src, 'original.txt')
    writeFile(src, 'original.txt', 'content')
    const linked = path.join(src, 'hardlinked.txt')

    try {
      fs.linkSync(original, linked)
    } catch {
      // Platform does not support hardlink creation in this context — skip test
      console.log('Skipping hardlink test: platform limitation')
      return
    }

    const result = await ingestSkillPackage(src)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.failedGate).toBe('GATE_0')
      expect(result.candidateId).toBeNull()
      expect(result.reason).toContain('nlink')
    }

    expect(fs.existsSync(getCandidatesDir())).toBe(false)

    const auditLog = readAuditLog()
    const event = JSON.parse(auditLog.trim().split('\n')[0] ?? '')
    expect(event.event).toBe('import-rejected')
    expect(event.failedGate).toBe('GATE_0')
    expect(event.candidateId).toBeNull()
  })
})

describe('Gate 0: unsupported entry type rejection', () => {
  test('rejects a package containing a FIFO (mkfifo)', async () => {
    const src = makeTmpSourceDir('fifo-test')
    writeFile(src, 'SKILL.md', '# Test\n')
    const fifoPath = path.join(src, 'test.fifo')

    // Attempt to create a FIFO; skip if platform does not support it
    const { execFileSync } = await import('child_process')
    try {
      execFileSync('mkfifo', [fifoPath])
    } catch {
      console.log('Skipping FIFO test: mkfifo unavailable')
      return
    }

    const result = await ingestSkillPackage(src)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.failedGate).toBe('GATE_0')
      expect(result.candidateId).toBeNull()
      expect(result.reason).toMatch(/unsupported entry/i)
    }

    expect(fs.existsSync(getCandidatesDir())).toBe(false)

    const auditLog = readAuditLog()
    const event = JSON.parse(auditLog.trim().split('\n')[0] ?? '')
    expect(event.event).toBe('import-rejected')
    expect(event.failedGate).toBe('GATE_0')
    expect(event.candidateId).toBeNull()
  })
})

describe('Gate 0: nonexistent source', () => {
  test('rejects a source path that does not exist', async () => {
    const result = await ingestSkillPackage('/nonexistent/path/to/skill')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.failedGate).toBe('GATE_0')
      expect(result.candidateId).toBeNull()
    }
  })
})

// ── Gate 0 → Gate 1 boundary: ordering proof ─────────────────────────────────

describe('Gate 0 rejection stops all later processing', () => {
  test('a Gate 0 rejection leaves no candidate hash in the audit log', async () => {
    const src = makeTmpSourceDir('gate0-ordering-test')
    writeFile(src, 'SKILL.md', '# Test\n')
    fs.symlinkSync('/tmp', path.join(src, 'bad-link'))

    const result = await ingestSkillPackage(src)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.failedGate).toBe('GATE_0')

    // No candidates directory — snapshot was never created
    expect(fs.existsSync(getCandidatesDir())).toBe(false)
    // No quarantine directory — Gate 1 was never reached
    expect(fs.existsSync(getQuarantineDir())).toBe(false)

    // The audit event must have null candidateId — no identity was ever assigned
    const auditLog = readAuditLog()
    const event = JSON.parse(auditLog.trim().split('\n')[0] ?? '')
    expect(event.candidateId).toBeNull()
    expect(event.failedGate).toBe('GATE_0')
  })
})

// ── Successful ingestion ──────────────────────────────────────────────────────

describe('successful ingestion (Gates 0 and 1)', () => {
  test('valid-minimal fixture is accepted and snapshot is isolated from source', async () => {
    const src = fixturePath('valid-minimal')
    const result = await ingestSkillPackage(src)

    expect(result.success).toBe(true)
    const success = result as IngestionSuccess

    expect(success.name).toBe('minimal-skill')
    expect(success.gatesCompleted).toEqual(['GATE_0', 'GATE_1'])
    expect(success.candidateId).toMatch(/^[0-9a-f-]{36}$/)

    // Snapshot exists in candidates/ with the original content intact
    expect(fs.existsSync(success.candidatePath)).toBe(true)
    expect(fs.existsSync(path.join(success.candidatePath, 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(success.candidatePath, 'manifest.json'))).toBe(true)

    // Powerplant-owned metadata is stored separately — snapshot content unchanged
    expect(fs.existsSync(path.join(success.candidatePath, '.powerplant-meta.json'))).toBe(true)

    // Audit log records 'imported' event
    const auditLog = readAuditLog()
    const event = JSON.parse(auditLog.trim().split('\n')[0] ?? '')
    expect(event.event).toBe('imported')
    expect(event.name).toBe('minimal-skill')
    expect(event.candidateId).toBe(success.candidateId)
    expect(event.contentHash).toBeNull() // Gate 2 not yet run
  })

  test('valid-minimal: source manifest.json is preserved unchanged in snapshot', async () => {
    const src = fixturePath('valid-minimal')
    const srcManifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf-8'))

    const result = await ingestSkillPackage(src)
    expect(result.success).toBe(true)
    const success = result as IngestionSuccess

    // snapshot manifest.json must be byte-for-byte identical to the source
    const snapshotManifest = JSON.parse(
      fs.readFileSync(path.join(success.candidatePath, 'manifest.json'), 'utf-8')
    )
    expect(snapshotManifest).toEqual(srcManifest)

    // Powerplant metadata has the normalized id (candidateId parameter)
    const meta = JSON.parse(
      fs.readFileSync(path.join(success.candidatePath, '.powerplant-meta.json'), 'utf-8')
    )
    expect(meta.id).toBe(success.candidateId)
    expect(meta.name).toBe('minimal-skill')
    expect(meta.sha256).toBeNull()
  })

  test('skill-no-manifest: snapshot file tree is unchanged; skeleton in .powerplant-meta.json', async () => {
    const src = fixturePath('skill-no-manifest')
    const srcFiles = fs.readdirSync(src).sort()

    const result = await ingestSkillPackage(src)
    expect(result.success).toBe(true)
    const success = result as IngestionSuccess

    expect(success.name).toBe('no-manifest-skill')

    // Source had only SKILL.md
    expect(srcFiles).toEqual(['SKILL.md'])

    // Snapshot has SKILL.md + Powerplant metadata — no injected manifest.json
    const snapshotFiles = fs.readdirSync(success.candidatePath).sort()
    expect(snapshotFiles).toContain('SKILL.md')
    expect(snapshotFiles).toContain('.powerplant-meta.json')
    expect(snapshotFiles).not.toContain('manifest.json')

    // SKILL.md content is preserved exactly
    const srcContent = fs.readFileSync(path.join(src, 'SKILL.md'), 'utf-8')
    const snapContent = fs.readFileSync(path.join(success.candidatePath, 'SKILL.md'), 'utf-8')
    expect(snapContent).toBe(srcContent)

    // Powerplant metadata is the skeleton derived from frontmatter
    const meta = JSON.parse(
      fs.readFileSync(path.join(success.candidatePath, '.powerplant-meta.json'), 'utf-8')
    )
    expect(meta.name).toBe('no-manifest-skill')
    expect(meta.sha256).toBeNull()
    expect(meta.evaluationPassed).toBe(false)
  })

  test('snapshot immutability: mutating source after import does not change snapshot', async () => {
    const src = makeTmpSourceDir('immutability-test')
    writeFile(src, 'SKILL.md', '# Original Content\n')
    writeFile(src, 'manifest.json', JSON.stringify({
      schemaVersion: 1, id: '00000000-0000-0000-0000-000000000005', name: 'immutable-skill',
      version: 1, description: 'Test', tags: [], createdAt: '2026-01-01T00:00:00.000Z',
      promotedAt: null, sourceRunId: null, sha256: null, evaluationPassed: false, evaluationAt: null,
    }))

    const result = await ingestSkillPackage(src)
    expect(result.success).toBe(true)
    const success = result as IngestionSuccess

    // Mutate the original source
    fs.writeFileSync(path.join(src, 'SKILL.md'), '# TAMPERED\n', 'utf-8')

    // Snapshot must be unchanged
    const snapshotContent = fs.readFileSync(
      path.join(success.candidatePath, 'SKILL.md'),
      'utf-8'
    )
    expect(snapshotContent).toBe('# Original Content\n')
  })
})

// ── Gate 1 failure ────────────────────────────────────────────────────────────

describe('Gate 1 rejection', () => {
  test('rejects a package with invalid skill name in manifest, candidateId is set', async () => {
    const src = fixturePath('gate1-invalid-name')
    const result = await ingestSkillPackage(src)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.failedGate).toBe('GATE_1')
      // Gate 0 passed, so a candidateId was assigned
      expect(result.candidateId).not.toBeNull()
      expect(result.reason).toMatch(/kebab-case|Skill name/i)
    }

    // Candidate moved to quarantine (not in candidates/)
    const candidatesDir = getCandidatesDir()
    if (fs.existsSync(candidatesDir)) {
      const children = fs.readdirSync(candidatesDir)
      expect(children.length).toBe(0)
    }

    // Audit event has Gate 1
    const auditLog = readAuditLog()
    const event = JSON.parse(auditLog.trim().split('\n')[0] ?? '')
    expect(event.event).toBe('import-rejected')
    expect(event.failedGate).toBe('GATE_1')
    expect(event.candidateId).not.toBeNull()
  })

  test('rejects a package missing SKILL.md', async () => {
    const src = fixturePath('gate1-missing-skillmd')
    const result = await ingestSkillPackage(src)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.failedGate).toBe('GATE_1')
      expect(result.reason).toMatch(/SKILL\.md/i)
    }
  })

  test('rejects a package with malformed manifest.json', async () => {
    const src = fixturePath('gate1-malformed-manifest')
    const result = await ingestSkillPackage(src)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.failedGate).toBe('GATE_1')
      expect(result.reason).toMatch(/not valid JSON/i)
    }
  })

  test('rejects a manifest that supplies a non-null sha256', async () => {
    const src = makeTmpSourceDir('sha256-supplied-test')
    writeFile(src, 'SKILL.md', '# Test\n')
    writeFile(src, 'manifest.json', JSON.stringify({
      schemaVersion: 1, id: '00000000-0000-0000-0000-000000000007', name: 'test-skill',
      version: 1, description: 'Test', tags: [], createdAt: '2026-01-01T00:00:00.000Z',
      promotedAt: null, sourceRunId: null,
      sha256: 'a'.repeat(64),  // Attempting to supply a hash — must be rejected
      evaluationPassed: false, evaluationAt: null,
    }))

    const result = await ingestSkillPackage(src)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.failedGate).toBe('GATE_1')
      expect(result.reason).toMatch(/sha256/i)
    }
  })
})

// ── Gate 0: reserved filename protection ──────────────────────────────────────

describe('Gate 0: reserved .powerplant-meta.json filename', () => {
  test('rejects a package containing .powerplant-meta.json (spoof-prevention)', async () => {
    const src = makeTmpSourceDir('reserved-filename-test')
    writeFile(src, 'SKILL.md', '# Test\n')
    writeFile(src, '.powerplant-meta.json', JSON.stringify({ spoofed: true }))

    const result = await ingestSkillPackage(src)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.failedGate).toBe('GATE_0')
      expect(result.candidateId).toBeNull()
      expect(result.reason).toMatch(/\.powerplant-meta\.json.*reserved/i)
    }

    expect(fs.existsSync(getCandidatesDir())).toBe(false)
  })
})

// ── Copy-time TOCTOU protection — deterministic test ─────────────────────────
// Tests copyToSnapshot directly with a crafted ValidatedFileEntry whose
// recorded mtimeMs differs from the actual file — no filesystem timing needed.

describe('copyToSnapshot: deterministic TOCTOU mtime protection', () => {
  test('rejects a file whose recorded mtimeMs does not match the real file mtime', async () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toctou-src-'))
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toctou-dest-'))
    try {
      const filePath = path.join(srcDir, 'file.txt')
      fs.writeFileSync(filePath, 'content')
      const actualStat = fs.lstatSync(filePath)

      // Craft an entry whose recorded mtime is in the future — simulates the
      // race condition where a file is modified between walk and copy.
      const entries: ValidatedFileEntry[] = [{
        relativePath: 'file.txt',
        absolutePath: filePath,
        sizeBytes: actualStat.size,
        mtimeMs: actualStat.mtimeMs + 9999,
      }]

      const result = await copyToSnapshot(entries, destDir)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.reason).toMatch(/modified during ingestion/i)
      }
      // No file was copied to the destination
      expect(fs.readdirSync(destDir)).toHaveLength(0)
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true })
      fs.rmSync(destDir, { recursive: true, force: true })
    }
  })

  test('accepts a file whose mtimeMs matches exactly', async () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toctou-ok-src-'))
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toctou-ok-dest-'))
    try {
      const filePath = path.join(srcDir, 'file.txt')
      fs.writeFileSync(filePath, 'content')
      const actualStat = fs.lstatSync(filePath)

      const entries: ValidatedFileEntry[] = [{
        relativePath: 'file.txt',
        absolutePath: filePath,
        sizeBytes: actualStat.size,
        mtimeMs: actualStat.mtimeMs,
      }]

      const result = await copyToSnapshot(entries, destDir)

      expect(result.success).toBe(true)
      expect(fs.existsSync(path.join(destDir, 'file.txt'))).toBe(true)
      expect(fs.readFileSync(path.join(destDir, 'file.txt'), 'utf-8')).toBe('content')
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true })
      fs.rmSync(destDir, { recursive: true, force: true })
    }
  })
})
