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
  type Gate0CopyHooks,
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

// ── Helpers for adversarial copy tests ───────────────────────────────────────

function makeValidatedEntry(filePath: string): ValidatedFileEntry {
  const stat = fs.lstatSync(filePath)
  return {
    relativePath: path.basename(filePath),
    absolutePath: filePath,
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
    ino: stat.ino,
    dev: stat.dev,
  }
}

// ── Adversarial copy tests — deterministic, no sleeps ────────────────────────
// These tests exercise handle-based copyToSnapshot using injected hooks
// and crafted ValidatedFileEntry values. No filesystem timing is needed.

describe('copyToSnapshot: pre-open mtime mismatch (stale validation)', () => {
  test('rejects a file whose recorded mtimeMs does not match the real file mtime', async () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toctou-src-'))
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toctou-dest-'))
    try {
      const filePath = path.join(srcDir, 'file.txt')
      fs.writeFileSync(filePath, 'content')
      const stat = fs.lstatSync(filePath)

      const entries: ValidatedFileEntry[] = [{
        relativePath: 'file.txt',
        absolutePath: filePath,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs + 9999,  // deliberately stale
        ino: stat.ino,
        dev: stat.dev,
      }]

      const result = await copyToSnapshot(entries, destDir, DEFAULT_GATE0_LIMITS)

      expect(result.success).toBe(false)
      if (!result.success) expect(result.reason).toMatch(/modified during ingestion/i)
      expect(fs.readdirSync(destDir)).toHaveLength(0)
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true })
      fs.rmSync(destDir, { recursive: true, force: true })
    }
  })

  test('accepts a file whose identity matches exactly', async () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toctou-ok-src-'))
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toctou-ok-dest-'))
    try {
      const filePath = path.join(srcDir, 'file.txt')
      fs.writeFileSync(filePath, 'content')

      const result = await copyToSnapshot([makeValidatedEntry(filePath)], destDir, DEFAULT_GATE0_LIMITS)

      expect(result.success).toBe(true)
      expect(fs.existsSync(path.join(destDir, 'file.txt'))).toBe(true)
      expect(fs.readFileSync(path.join(destDir, 'file.txt'), 'utf-8')).toBe('content')
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true })
      fs.rmSync(destDir, { recursive: true, force: true })
    }
  })
})

describe('copyToSnapshot: post-open inode identity check', () => {
  test('rejects a file whose recorded inode differs from the opened file', async () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inode-src-'))
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inode-dest-'))
    try {
      const filePath = path.join(srcDir, 'file.txt')
      fs.writeFileSync(filePath, 'content')
      const stat = fs.lstatSync(filePath)

      // Supply a wrong inode — simulates detecting that a different file was
      // substituted at the same path after the walk recorded the original inode.
      const entries: ValidatedFileEntry[] = [{
        relativePath: 'file.txt',
        absolutePath: filePath,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        ino: stat.ino + 999999,  // deliberate mismatch
        dev: stat.dev,
      }]

      const result = await copyToSnapshot(entries, destDir, DEFAULT_GATE0_LIMITS)

      expect(result.success).toBe(false)
      if (!result.success) expect(result.reason).toMatch(/replaced.*inode/i)
      expect(fs.readdirSync(destDir)).toHaveLength(0)
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true })
      fs.rmSync(destDir, { recursive: true, force: true })
    }
  })
})

describe('copyToSnapshot: beforeOpen hook — symlink substitution', () => {
  test('rejects entry substituted with a symlink before open (O_NOFOLLOW path)', async () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subst-src-'))
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subst-dest-'))
    try {
      const filePath = path.join(srcDir, 'file.txt')
      fs.writeFileSync(filePath, 'content')

      const entry = makeValidatedEntry(filePath)

      const hooks: Gate0CopyHooks = {
        beforeOpen: () => {
          // Replace the file with a symlink — simulates substitution after walk
          // but before open
          fs.unlinkSync(filePath)
          fs.symlinkSync('/etc/hostname', filePath)
        },
      }

      const result = await copyToSnapshot([entry], destDir, DEFAULT_GATE0_LIMITS, hooks)

      expect(result.success).toBe(false)
      if (!result.success) {
        // O_NOFOLLOW causes ELOOP, or inode mismatch catches a regular-file replacement
        expect(result.reason).toMatch(/symlink|replaced|inode/i)
      }
      expect(fs.readdirSync(destDir)).toHaveLength(0)
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true })
      fs.rmSync(destDir, { recursive: true, force: true })
    }
  })
})

describe('copyToSnapshot: afterWrite hook — source mutation during copy window', () => {
  test('rejects import when source is mutated after writing to destination', async () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutate-src-'))
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutate-dest-'))
    try {
      const filePath = path.join(srcDir, 'file.txt')
      fs.writeFileSync(filePath, 'original-content')

      const entry = makeValidatedEntry(filePath)

      const hooks: Gate0CopyHooks = {
        afterWrite: () => {
          // Append bytes to source after copy but before post-copy fstat —
          // changes both size and mtime deterministically
          fs.appendFileSync(filePath, '-TAMPERED-DURING-COPY')
        },
      }

      const result = await copyToSnapshot([entry], destDir, DEFAULT_GATE0_LIMITS, hooks)

      expect(result.success).toBe(false)
      if (!result.success) expect(result.reason).toMatch(/changed during copying/i)

      // Destination file must be removed (quarantined/unlinked)
      expect(fs.readdirSync(destDir)).toHaveLength(0)
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true })
      fs.rmSync(destDir, { recursive: true, force: true })
    }
  })
})

describe('copyToSnapshot: exclusive destination creation', () => {
  test('fails closed when destination file unexpectedly already exists', async () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'excl-src-'))
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'excl-dest-'))
    try {
      const filePath = path.join(srcDir, 'file.txt')
      fs.writeFileSync(filePath, 'original')
      const entry = makeValidatedEntry(filePath)

      // Pre-create the destination to simulate an unexpected collision
      fs.writeFileSync(path.join(destDir, 'file.txt'), 'existing-content')

      const result = await copyToSnapshot([entry], destDir, DEFAULT_GATE0_LIMITS)

      expect(result.success).toBe(false)
      if (!result.success) expect(result.reason).toMatch(/destination already exists/i)

      // Existing file must be untouched
      expect(fs.readFileSync(path.join(destDir, 'file.txt'), 'utf-8')).toBe('existing-content')
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true })
      fs.rmSync(destDir, { recursive: true, force: true })
    }
  })
})

// ── Bounded-copy adversarial tests ───────────────────────────────────────────
// These tests prove that Gate 0 never reads/writes past its configured budgets,
// even when the source grows after initial validation. The afterChunk hook injects
// growth between chunk writes without any timing dependence.

describe('bounded copy: source grows beyond validated entry size during copy', () => {
  test('rejects growth and leaves no accepted destination file', async () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grow-size-src-'))
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grow-size-dest-'))
    try {
      const filePath = path.join(srcDir, 'file.txt')
      fs.writeFileSync(filePath, 'x'.repeat(50))
      const entry = makeValidatedEntry(filePath)  // entry.sizeBytes = 50

      let hookFired = false
      const hooks: Gate0CopyHooks = {
        afterChunk: () => {
          if (!hookFired) {
            hookFired = true
            // Append after the first chunk is written — source now 200 bytes
            fs.appendFileSync(filePath, 'y'.repeat(150))
          }
        },
      }

      const result = await copyToSnapshot([entry], destDir, DEFAULT_GATE0_LIMITS, hooks)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.reason).toMatch(/grew beyond validated size/i)
      }
      // Partial destination must be cleaned up
      expect(fs.readdirSync(destDir)).toHaveLength(0)
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true })
      fs.rmSync(destDir, { recursive: true, force: true })
    }
  })
})

describe('bounded copy: source grows beyond maxFileSizeBytes during copy', () => {
  test('rejects growth past the per-file budget ceiling', async () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grow-maxfile-src-'))
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grow-maxfile-dest-'))
    try {
      const filePath = path.join(srcDir, 'file.txt')
      // Use a custom limit with a very small maxFileSizeBytes for testability.
      // sizeBytes in the crafted entry is larger than the actual file so the
      // entry.sizeBytes check does not fire first — only maxFileSizeBytes fires.
      const CUSTOM_MAX = 80
      const customLimits = { ...DEFAULT_GATE0_LIMITS, maxFileSizeBytes: CUSTOM_MAX }
      fs.writeFileSync(filePath, 'x'.repeat(60))
      const actualStat = fs.lstatSync(filePath)
      // Craft entry with sizeBytes = 10 MB so entry.sizeBytes guard won't fire
      const entry: ValidatedFileEntry = {
        relativePath: 'file.txt',
        absolutePath: filePath,
        sizeBytes: 10 * 1024 * 1024,
        mtimeMs: actualStat.mtimeMs,
        ino: actualStat.ino,
        dev: actualStat.dev,
      }

      let hookFired = false
      const hooks: Gate0CopyHooks = {
        afterChunk: () => {
          if (!hookFired) {
            hookFired = true
            // Grow source past CUSTOM_MAX
            fs.appendFileSync(filePath, 'z'.repeat(60))  // now 120 bytes > 80
          }
        },
      }

      const result = await copyToSnapshot([entry], destDir, customLimits, hooks)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.reason).toMatch(/exceeded max file size/i)
      }
      expect(fs.readdirSync(destDir)).toHaveLength(0)
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true })
      fs.rmSync(destDir, { recursive: true, force: true })
    }
  })
})

describe('bounded copy: cumulative package bytes exceed maxTotalSizeBytes', () => {
  test('rejects second file when cumulative bytes exceed total budget', async () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grow-total-src-'))
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grow-total-dest-'))
    try {
      // Two files of 40 bytes each; total budget = 60 bytes
      const customLimits = { ...DEFAULT_GATE0_LIMITS, maxTotalSizeBytes: 60 }
      const f1 = path.join(srcDir, 'file1.txt')
      const f2 = path.join(srcDir, 'file2.txt')
      fs.writeFileSync(f1, 'x'.repeat(40))
      fs.writeFileSync(f2, 'y'.repeat(40))

      const entries = [makeValidatedEntry(f1), makeValidatedEntry(f2)]
      const result = await copyToSnapshot(entries, destDir, customLimits)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.reason).toMatch(/exceeded max total size/i)
      }
      // Only file1 may have been written; file2 must not exist or be cleaned up
      const destFiles = fs.readdirSync(destDir)
      expect(destFiles).not.toContain('file2.txt')
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true })
      fs.rmSync(destDir, { recursive: true, force: true })
    }
  })
})

describe('bounded copy: partial destination cleanup on chunk-loop failure', () => {
  test('removes partial destination when growth triggers rejection mid-copy', async () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-src-'))
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-dest-'))
    try {
      const filePath = path.join(srcDir, 'file.txt')
      fs.writeFileSync(filePath, 'a'.repeat(50))
      const entry = makeValidatedEntry(filePath)

      // After the first chunk is written to dest, grow source to trigger rejection
      let hookFired = false
      const hooks: Gate0CopyHooks = {
        afterChunk: () => {
          if (!hookFired) {
            hookFired = true
            fs.appendFileSync(filePath, 'b'.repeat(200))
          }
        },
      }

      const result = await copyToSnapshot([entry], destDir, DEFAULT_GATE0_LIMITS, hooks)

      expect(result.success).toBe(false)
      expect(hookFired).toBe(true)  // hook fired — at least one chunk was written before failure
      // The partial destination must be deleted, not left behind
      expect(fs.readdirSync(destDir)).toHaveLength(0)
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true })
      fs.rmSync(destDir, { recursive: true, force: true })
    }
  })
})

describe('bounded copy: successful copy is byte-exact', () => {
  test('copies valid file through bounded routine and verifies exact byte count', async () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exact-src-'))
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exact-dest-'))
    try {
      const content = 'hello bounded copy test\n'.repeat(100)  // 2400 bytes
      const filePath = path.join(srcDir, 'file.txt')
      fs.writeFileSync(filePath, content)

      const result = await copyToSnapshot(
        [makeValidatedEntry(filePath)], destDir, DEFAULT_GATE0_LIMITS
      )

      expect(result.success).toBe(true)
      const destContent = fs.readFileSync(path.join(destDir, 'file.txt'), 'utf-8')
      expect(destContent).toBe(content)
      expect(destContent.length).toBe(content.length)
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true })
      fs.rmSync(destDir, { recursive: true, force: true })
    }
  })
})
