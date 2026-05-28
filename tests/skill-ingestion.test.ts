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

function getStagingDir(): string {
  return path.join(tmpPowerplantHome, 'skills', '.staging')
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

describe('successful ingestion (Gates 0 through 3)', () => {
  test('valid-minimal fixture is accepted and snapshot is isolated from source', async () => {
    const src = fixturePath('valid-minimal')
    const result = await ingestSkillPackage(src)

    expect(result.success).toBe(true)
    const success = result as IngestionSuccess

    expect(success.name).toBe('minimal-skill')
    expect(success.gatesCompleted).toEqual(['GATE_0', 'GATE_1', 'GATE_2', 'GATE_3'])
    expect(success.candidateId).toMatch(/^[0-9a-f-]{36}$/)
    expect(success.contentHash).toMatch(/^[a-f0-9]{64}$/)

    // Snapshot exists in candidates/ with the original content intact
    expect(fs.existsSync(success.candidatePath)).toBe(true)
    expect(fs.existsSync(path.join(success.candidatePath, 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(success.candidatePath, 'manifest.json'))).toBe(true)

    // Powerplant-owned metadata is stored separately — snapshot content unchanged
    expect(fs.existsSync(path.join(success.candidatePath, '.powerplant-meta.json'))).toBe(true)

    // Staging directory is gone — renamed atomically to candidates/
    expect(fs.existsSync(path.join(getStagingDir(), success.candidateId))).toBe(false)

    // Audit log records 'imported' event with the Gate 2 canonical hash
    const auditLog = readAuditLog()
    const event = JSON.parse(auditLog.trim().split('\n')[0] ?? '')
    expect(event.event).toBe('imported')
    expect(event.name).toBe('minimal-skill')
    expect(event.candidateId).toBe(success.candidateId)
    expect(event.contentHash).toMatch(/^[a-f0-9]{64}$/)
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

    // Powerplant metadata has the normalized id and Gate 2 canonical hash
    const meta = JSON.parse(
      fs.readFileSync(path.join(success.candidatePath, '.powerplant-meta.json'), 'utf-8')
    )
    expect(meta.id).toBe(success.candidateId)
    expect(meta.name).toBe('minimal-skill')
    expect(meta.sha256).toMatch(/^[a-f0-9]{64}$/)
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

    // Powerplant metadata is the skeleton derived from frontmatter, with Gate 2 hash
    const meta = JSON.parse(
      fs.readFileSync(path.join(success.candidatePath, '.powerplant-meta.json'), 'utf-8')
    )
    expect(meta.name).toBe('no-manifest-skill')
    expect(meta.sha256).toMatch(/^[a-f0-9]{64}$/)
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
  test('rejects a package with invalid skill name in manifest; staging deleted, no payload retained', async () => {
    const src = fixturePath('gate1-invalid-name')
    const knownId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const result = await ingestSkillPackage(src, {}, { candidateId: knownId })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.failedGate).toBe('GATE_1')
      expect(result.candidateId).toBe(knownId)
      expect(result.reason).toMatch(/kebab-case|Skill name/i)
    }

    // candidates/ must never have been created for this candidateId
    expect(fs.existsSync(path.join(getCandidatesDir(), knownId))).toBe(false)

    // Phase 1B: staging is deleted on Gate 1 failure — no payload retained
    expect(fs.existsSync(path.join(getStagingDir(), knownId))).toBe(false)

    // No quarantine copy — unscanned payloads must not be stored durably
    expect(fs.existsSync(path.join(getQuarantineDir(), knownId))).toBe(false)

    // Audit event has Gate 1 and non-null candidateId
    const auditLog = readAuditLog()
    const event = JSON.parse(auditLog.trim().split('\n')[0] ?? '')
    expect(event.event).toBe('import-rejected')
    expect(event.failedGate).toBe('GATE_1')
    expect(event.candidateId).toBe(knownId)
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

// ── Bounded-read adversarial tests ───────────────────────────────────────────
// These tests prove that Gate 0 never issues read requests beyond the validated
// budget — even when the source grows after initial lstat validation.
// The onReadRequest hook observes each read request before it is issued,
// providing a deterministic witness without timing dependence.

describe('bounded read: source grows mid-copy — no bytes beyond entry.sizeBytes are requested', () => {
  test('after first chunk, read loop exits without requesting extra bytes; fstat detects growth', async () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-grow-src-'))
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-grow-dest-'))
    try {
      const filePath = path.join(srcDir, 'file.txt')
      fs.writeFileSync(filePath, 'x'.repeat(50))
      const entry = makeValidatedEntry(filePath)  // entry.sizeBytes = 50

      const requestedLengths: number[] = []
      let hookFired = false
      const hooks: Gate0CopyHooks = {
        onReadRequest: (_, requestedLength) => { requestedLengths.push(requestedLength) },
        afterChunk: () => {
          if (!hookFired) {
            hookFired = true
            // Source grows to 200 bytes after the first (and only) permitted chunk
            fs.appendFileSync(filePath, 'y'.repeat(150))
          }
        },
      }

      const result = await copyToSnapshot([entry], destDir, DEFAULT_GATE0_LIMITS, hooks)

      // Gate 0 rejects based on post-copy size mismatch (growth detected via fstat)
      expect(result.success).toBe(false)
      if (!result.success) expect(result.reason).toMatch(/changed during copying/i)

      // Witness: total bytes requested ≤ entry.sizeBytes — no over-budget read was issued
      const totalRequested = requestedLengths.reduce((a, b) => a + b, 0)
      expect(totalRequested).toBeLessThanOrEqual(entry.sizeBytes)
      // Exactly one read request was made (the 50-byte file fits in one chunk)
      expect(requestedLengths).toHaveLength(1)
      expect(requestedLengths[0]).toBe(50)

      // No partial destination remains
      expect(fs.readdirSync(destDir)).toHaveLength(0)
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true })
      fs.rmSync(destDir, { recursive: true, force: true })
    }
  })
})

describe('bounded read: file smaller than COPY_CHUNK_SIZE — read request bounded exactly', () => {
  test('single read request equals exactly the validated file size', async () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-small-src-'))
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-small-dest-'))
    try {
      const content = 'x'.repeat(100)  // 100 bytes — well below 64 KB COPY_CHUNK_SIZE
      const filePath = path.join(srcDir, 'file.txt')
      fs.writeFileSync(filePath, content)
      const entry = makeValidatedEntry(filePath)

      const requestedLengths: number[] = []
      const hooks: Gate0CopyHooks = {
        onReadRequest: (_, requestedLength) => { requestedLengths.push(requestedLength) },
      }

      const result = await copyToSnapshot([entry], destDir, DEFAULT_GATE0_LIMITS, hooks)
      expect(result.success).toBe(true)

      // Exactly one read issued, bounded to exactly the file size (not COPY_CHUNK_SIZE)
      expect(requestedLengths).toHaveLength(1)
      expect(requestedLengths[0]).toBe(100)

      // All read requests are ≤ entry.sizeBytes
      for (const len of requestedLengths) {
        expect(len).toBeLessThanOrEqual(entry.sizeBytes)
      }

      // Content preserved exactly
      expect(fs.readFileSync(path.join(destDir, 'file.txt'), 'utf-8')).toBe(content)
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true })
      fs.rmSync(destDir, { recursive: true, force: true })
    }
  })
})

describe('bounded read: package near total-byte limit — read bounded to remaining package budget', () => {
  test('first read of second file is bounded to remaining package bytes, not to file size', async () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-budget-src-'))
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-budget-dest-'))
    try {
      // Package budget = 100 bytes. file1 = 80 bytes, file2 = 40 bytes.
      // After file1 is copied, remaining budget = 20 bytes.
      // First read of file2 must be bounded to 20 bytes, not 40.
      const customLimits = { ...DEFAULT_GATE0_LIMITS, maxTotalSizeBytes: 100 }
      const f1 = path.join(srcDir, 'file1.txt')
      const f2 = path.join(srcDir, 'file2.txt')
      fs.writeFileSync(f1, 'x'.repeat(80))
      fs.writeFileSync(f2, 'y'.repeat(40))

      const entries = [makeValidatedEntry(f1), makeValidatedEntry(f2)]

      const readRequests: Array<{ rel: string; len: number }> = []
      const hooks: Gate0CopyHooks = {
        onReadRequest: (e, requestedLength) => {
          readRequests.push({ rel: e.relativePath, len: requestedLength })
        },
      }

      const result = await copyToSnapshot(entries, destDir, customLimits, hooks)

      // Package budget exceeded — ingestion rejects
      expect(result.success).toBe(false)
      if (!result.success) expect(result.reason).toMatch(/exceeded max total size/i)

      // First read of file2 is bounded to remaining budget (100 - 80 = 20), not file size (40)
      const file2Reads = readRequests.filter(r => r.rel === 'file2.txt')
      expect(file2Reads.length).toBeGreaterThan(0)
      expect(file2Reads[0]?.len).toBeLessThanOrEqual(20)
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true })
      fs.rmSync(destDir, { recursive: true, force: true })
    }
  })
})

describe('bounded read: defense-in-depth rejects crafted entry with sizeBytes > maxFileSizeBytes', () => {
  test('copyFileSecure rejects before any read when entry.sizeBytes exceeds per-file limit', async () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'did-src-'))
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'did-dest-'))
    try {
      const filePath = path.join(srcDir, 'file.txt')
      fs.writeFileSync(filePath, 'x'.repeat(60))
      const actualStat = fs.lstatSync(filePath)

      const CUSTOM_MAX = 50
      const customLimits = { ...DEFAULT_GATE0_LIMITS, maxFileSizeBytes: CUSTOM_MAX }

      // Craft entry with sizeBytes (60) exceeding maxFileSizeBytes (50)
      const entry: ValidatedFileEntry = {
        relativePath: 'file.txt',
        absolutePath: filePath,
        sizeBytes: 60,
        mtimeMs: actualStat.mtimeMs,
        ino: actualStat.ino,
        dev: actualStat.dev,
      }

      let readRequestMade = false
      const hooks: Gate0CopyHooks = {
        onReadRequest: () => { readRequestMade = true },
      }

      const result = await copyToSnapshot([entry], destDir, customLimits, hooks)

      expect(result.success).toBe(false)
      if (!result.success) expect(result.reason).toMatch(/per-file limit/i)

      // Defense-in-depth fires before any read is issued
      expect(readRequestMade).toBe(false)
      expect(fs.readdirSync(destDir)).toHaveLength(0)
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true })
      fs.rmSync(destDir, { recursive: true, force: true })
    }
  })
})

describe('bounded copy: partial destination cleanup on chunk-loop failure', () => {
  test('removes partial destination when package budget is exhausted mid-file', async () => {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-src-'))
    const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-dest-'))
    try {
      // Two files of 40 bytes each; total budget = 60 bytes.
      // Copying file2 exhausts the budget mid-file; partial dest must be cleaned up.
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
      // Partial file2 must be cleaned up — only file1 may remain
      const destFiles = fs.readdirSync(destDir)
      expect(destFiles).not.toContain('file2.txt')
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

// ── Atomic publication tests ──────────────────────────────────────────────────
// These tests prove that candidates/<uuid>/ is only observable AFTER both gates
// pass and the atomic rename succeeds. A partially copied or Gate-1-rejected
// package must never appear under candidates/.

describe('atomic publication: candidates/ absent during copy', () => {
  test('candidates/ does not exist while copy is still in progress', async () => {
    const src = makeTmpSourceDir('staging-copy-obs')
    writeFile(src, 'SKILL.md', '# Test\n')
    writeFile(src, 'manifest.json', JSON.stringify({
      schemaVersion: 1, id: '00000000-0000-0000-0000-000000000010', name: 'test-skill',
      version: 1, description: 'Test', tags: [], createdAt: '2026-01-01T00:00:00.000Z',
      promotedAt: null, sourceRunId: null, sha256: null, evaluationPassed: false, evaluationAt: null,
    }))
    const knownId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

    let candidatesDirExistedDuringCopy = false
    const result = await ingestSkillPackage(src, {}, {
      candidateId: knownId,
      copyHooks: {
        afterChunk: () => {
          // While copy is in progress, candidates/ must not contain this package
          if (fs.existsSync(path.join(getCandidatesDir(), knownId))) {
            candidatesDirExistedDuringCopy = true
          }
        },
      },
    })

    expect(result.success).toBe(true)
    // candidates/ was not visible during the copy window
    expect(candidatesDirExistedDuringCopy).toBe(false)
    // It is now visible after successful publication
    expect(fs.existsSync(path.join(getCandidatesDir(), knownId))).toBe(true)
  })
})

describe('atomic publication: Gate 1 failure — staging deleted, no payload retained', () => {
  test('candidates/ not created when Gate 1 fails; staging deleted, quarantine empty', async () => {
    const src = fixturePath('gate1-invalid-name')
    const knownId = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

    let candidatesDirExistedDuringCopy = false
    const result = await ingestSkillPackage(src, {}, {
      candidateId: knownId,
      copyHooks: {
        afterChunk: () => {
          if (fs.existsSync(path.join(getCandidatesDir(), knownId))) {
            candidatesDirExistedDuringCopy = true
          }
        },
      },
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.failedGate).toBe('GATE_1')

    // candidates/ was never created during copy
    expect(candidatesDirExistedDuringCopy).toBe(false)
    // candidates/<uuid> does not exist
    expect(fs.existsSync(path.join(getCandidatesDir(), knownId))).toBe(false)
    // Phase 1B: staging is deleted on Gate 1 failure — no payload retained
    expect(fs.existsSync(path.join(getStagingDir(), knownId))).toBe(false)
    // No quarantine copy — unscanned payloads are not stored durably
    expect(fs.existsSync(path.join(getQuarantineDir(), knownId))).toBe(false)
  })
})

describe('atomic publication: Gate 0 copy failure — staging removed, no candidate', () => {
  test('staging cleaned up and candidates/ absent when fstat detects source mutation', async () => {
    const src = makeTmpSourceDir('staging-gate0-copy-fail')
    writeFile(src, 'SKILL.md', '# Test\n')
    writeFile(src, 'manifest.json', JSON.stringify({
      schemaVersion: 1, id: '00000000-0000-0000-0000-000000000011', name: 'test-skill',
      version: 1, description: 'Test', tags: [], createdAt: '2026-01-01T00:00:00.000Z',
      promotedAt: null, sourceRunId: null, sha256: null, evaluationPassed: false, evaluationAt: null,
    }))
    const skillMdPath = path.join(src, 'SKILL.md')
    const knownId = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

    let hookFired = false
    const result = await ingestSkillPackage(src, {}, {
      candidateId: knownId,
      copyHooks: {
        afterWrite: (entry) => {
          // Mutate source after writing SKILL.md — triggers fstat mismatch → Gate 0 failure
          if (!hookFired && entry.relativePath === 'SKILL.md') {
            hookFired = true
            fs.appendFileSync(skillMdPath, '\n# TAMPERED\n')
          }
        },
      },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.failedGate).toBe('GATE_0')
      expect(result.candidateId).toBeNull()
    }

    // Staging directory for this candidateId must be removed
    expect(fs.existsSync(path.join(getStagingDir(), knownId))).toBe(false)
    // No candidate published
    expect(fs.existsSync(path.join(getCandidatesDir(), knownId))).toBe(false)
    expect(fs.existsSync(getCandidatesDir())).toBe(false)
  })
})

describe('atomic publication: successful import — complete candidate, staging gone', () => {
  test('candidates/ contains complete package with Powerplant meta sidecar after atomic rename', async () => {
    const src = makeTmpSourceDir('staging-success')
    writeFile(src, 'SKILL.md', '# Test skill\n')
    writeFile(src, 'manifest.json', JSON.stringify({
      schemaVersion: 1, id: '00000000-0000-0000-0000-000000000012', name: 'test-skill',
      version: 1, description: 'Test', tags: [], createdAt: '2026-01-01T00:00:00.000Z',
      promotedAt: null, sourceRunId: null, sha256: null, evaluationPassed: false, evaluationAt: null,
    }))
    const knownId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'

    const result = await ingestSkillPackage(src, {}, { candidateId: knownId })

    expect(result.success).toBe(true)
    const success = result as IngestionSuccess

    // Staging is gone (renamed to candidates/)
    expect(fs.existsSync(path.join(getStagingDir(), knownId))).toBe(false)

    // Candidate has the original payload and Powerplant metadata sidecar
    const candidatePath = path.join(getCandidatesDir(), knownId)
    expect(fs.existsSync(path.join(candidatePath, 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(candidatePath, 'manifest.json'))).toBe(true)
    expect(fs.existsSync(path.join(candidatePath, '.powerplant-meta.json'))).toBe(true)

    // Payload is unmodified — snapshot content equals source content
    expect(fs.readFileSync(path.join(candidatePath, 'SKILL.md'), 'utf-8')).toBe('# Test skill\n')

    // Powerplant metadata has the normalized manifest with Gate 2 canonical hash
    const meta = JSON.parse(
      fs.readFileSync(path.join(candidatePath, '.powerplant-meta.json'), 'utf-8')
    )
    expect(meta.id).toBe(knownId)
    expect(meta.name).toBe('test-skill')
    expect(meta.sha256).toMatch(/^[a-f0-9]{64}$/)

    // candidatePath matches the returned path
    expect(success.candidatePath).toBe(candidatePath)
  })
})

describe('atomic publication: destination collision fails closed', () => {
  test('fails closed without overwriting when candidates/<uuid>/ already exists', async () => {
    const src = makeTmpSourceDir('staging-collision')
    writeFile(src, 'SKILL.md', '# Test\n')
    writeFile(src, 'manifest.json', JSON.stringify({
      schemaVersion: 1, id: '00000000-0000-0000-0000-000000000013', name: 'test-skill',
      version: 1, description: 'Test', tags: [], createdAt: '2026-01-01T00:00:00.000Z',
      promotedAt: null, sourceRunId: null, sha256: null, evaluationPassed: false, evaluationAt: null,
    }))
    const knownId = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

    // Pre-create the destination with existing content to simulate a UUID collision
    const existingCandidatePath = path.join(getCandidatesDir(), knownId)
    fs.mkdirSync(existingCandidatePath, { recursive: true })
    fs.writeFileSync(path.join(existingCandidatePath, 'existing.txt'), 'pre-existing content')

    const result = await ingestSkillPackage(src, {}, { candidateId: knownId })

    // Import fails closed — pre-existing content is not overwritten
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.candidateId).toBeNull()
      expect(result.reason).toMatch(/already exists/i)
    }

    // Pre-existing content is untouched
    expect(
      fs.readFileSync(path.join(existingCandidatePath, 'existing.txt'), 'utf-8')
    ).toBe('pre-existing content')
  })
})

// ── Gate 2+3: canonical hash and secret/content scan ─────────────────────────
// Phase 1B: candidates/ is published only after Gates 0–3 pass.

describe('Gate 2+3: canonical hash recorded in sidecar and audit', () => {
  test('successful import populates sha256 in .powerplant-meta.json', async () => {
    const src = fixturePath('valid-minimal')
    const result = await ingestSkillPackage(src)

    expect(result.success).toBe(true)
    if (!result.success) return

    const meta = JSON.parse(
      fs.readFileSync(path.join(result.candidatePath, '.powerplant-meta.json'), 'utf-8')
    )
    expect(meta.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(meta.sha256).toBe(result.contentHash)
  })

  test('two imports of identical content produce the same canonical hash', async () => {
    const src = fixturePath('valid-minimal')
    const r1 = await ingestSkillPackage(src)
    const r2 = await ingestSkillPackage(src)

    expect(r1.success).toBe(true)
    expect(r2.success).toBe(true)
    if (!r1.success || !r2.success) return

    expect(r1.contentHash).toBe(r2.contentHash)
  })

  test('candidate is NOT visible in candidates/ during Gate 2+3 (only after)', async () => {
    const src = makeTmpSourceDir('gate23-timing')
    writeFile(src, 'SKILL.md', '# Test\n')
    writeFile(src, 'manifest.json', JSON.stringify({
      schemaVersion: 1, id: '00000000-0000-0000-0000-000000000020', name: 'test-skill',
      version: 1, description: 'Test', tags: [], createdAt: '2026-01-01T00:00:00.000Z',
      promotedAt: null, sourceRunId: null, sha256: null, evaluationPassed: false, evaluationAt: null,
    }))
    const knownId = '11111111-1111-1111-1111-111111111111'

    let candidateExistedDuringCopy = false
    const result = await ingestSkillPackage(src, {}, {
      candidateId: knownId,
      copyHooks: {
        afterChunk: () => {
          // candidates/ must not contain knownId while copy is in progress
          if (fs.existsSync(path.join(getCandidatesDir(), knownId))) {
            candidateExistedDuringCopy = true
          }
        },
      },
    })

    expect(result.success).toBe(true)
    // candidates/ was NOT visible during copy/Gate 2+3 window
    expect(candidateExistedDuringCopy).toBe(false)
    // candidates/ IS visible after atomic publication
    expect(fs.existsSync(path.join(getCandidatesDir(), knownId))).toBe(true)
  })

  test('audit event for successful import has non-null contentHash', async () => {
    const src = fixturePath('valid-minimal')
    const result = await ingestSkillPackage(src)
    expect(result.success).toBe(true)

    const auditLog = readAuditLog()
    const event = JSON.parse(auditLog.trim().split('\n')[0] ?? '')
    expect(event.event).toBe('imported')
    expect(event.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('Gate 3: secret-bearing packages are rejected at import', () => {
  test('package with PEM private key is rejected at Gate 3 with no candidate published', async () => {
    const src = fixturePath('gate3-private-key')
    const result = await ingestSkillPackage(src)

    expect(result.success).toBe(false)
    if (result.success) return

    expect(result.failedGate).toBe('GATE_3')
    expect(result.candidateId).not.toBeNull()
    expect(result.reason).toMatch(/credential material|private.key/i)

    // No candidate published
    expect(fs.existsSync(getCandidatesDir())).toBe(false)

    // Staging cleaned up
    expect(fs.existsSync(path.join(getStagingDir(), result.candidateId!))).toBe(false)

    // Audit records Gate 3 rejection
    const auditLog = readAuditLog()
    const event = JSON.parse(auditLog.trim().split('\n')[0] ?? '')
    expect(event.event).toBe('import-rejected')
    expect(event.failedGate).toBe('GATE_3')
  })

  test('package with API token is rejected at Gate 3', async () => {
    const src = fixturePath('gate3-api-key')
    const result = await ingestSkillPackage(src)

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.failedGate).toBe('GATE_3')
  })

  test('package with secret env assignment is rejected at Gate 3', async () => {
    const src = fixturePath('gate3-env-secret')
    const result = await ingestSkillPackage(src)

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.failedGate).toBe('GATE_3')
  })

  test('Gate 3 rejection reason does not contain credential bytes', async () => {
    const src = fixturePath('gate3-private-key')
    const result = await ingestSkillPackage(src)

    expect(result.success).toBe(false)
    if (result.success) return

    // The reason string must not include the base64 key material from the fixture
    expect(result.reason).not.toContain('MIIEowIBAAKCAQEA')
  })

  test('package with only placeholder credentials is accepted', async () => {
    const src = fixturePath('gate3-placeholder-only')
    const result = await ingestSkillPackage(src)

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.gatesCompleted).toEqual(['GATE_0', 'GATE_1', 'GATE_2', 'GATE_3'])
  })
})

describe('Gate 3: NUL bytes reject at import', () => {
  test('package with NUL byte in payload file is rejected at Gate 3', async () => {
    const src = makeTmpSourceDir('nul-byte-skill')
    const skillContent = Buffer.concat([
      Buffer.from('# Test Skill\n\nThis is a test.\n', 'utf-8'),
      Buffer.from([0x00]),
      Buffer.from('\nSome more content\n', 'utf-8'),
    ])
    writeFile(src, 'manifest.json', JSON.stringify({
      schemaVersion: 1, id: '00000000-0000-0000-0000-000000000022', name: 'nul-skill',
      version: 1, description: 'NUL test', tags: [], createdAt: '2026-01-01T00:00:00.000Z',
      promotedAt: null, sourceRunId: null, sha256: null, evaluationPassed: false, evaluationAt: null,
    }))
    // Write SKILL.md with NUL bytes using binary write
    const skillMdPath = path.join(src, 'SKILL.md')
    fs.writeFileSync(skillMdPath, skillContent)

    const result = await ingestSkillPackage(src)

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.failedGate).toBe('GATE_3')
    expect(result.reason).toMatch(/nul bytes/i)
    expect(fs.existsSync(getCandidatesDir())).toBe(false)
  })
})

describe('Gate 3: invalid UTF-8 rejects at import', () => {
  test('package with invalid UTF-8 in payload file is rejected at Gate 3', async () => {
    const src = makeTmpSourceDir('invalid-utf8-skill')
    writeFile(src, 'manifest.json', JSON.stringify({
      schemaVersion: 1, id: '00000000-0000-0000-0000-000000000023', name: 'utf8-skill',
      version: 1, description: 'UTF-8 test', tags: [], createdAt: '2026-01-01T00:00:00.000Z',
      promotedAt: null, sourceRunId: null, sha256: null, evaluationPassed: false, evaluationAt: null,
    }))
    // Write SKILL.md with invalid UTF-8 (lone 0x80 continuation byte)
    const invalidBuf = Buffer.concat([
      Buffer.from('# Test\n\n', 'utf-8'),
      Buffer.from([0x80]),
      Buffer.from('\nMore content\n', 'utf-8'),
    ])
    fs.writeFileSync(path.join(src, 'SKILL.md'), invalidBuf)

    const result = await ingestSkillPackage(src)

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.failedGate).toBe('GATE_3')
    expect(result.reason).toMatch(/invalid utf-8/i)
    expect(fs.existsSync(getCandidatesDir())).toBe(false)
  })
})

describe('Gate 2+3: audit records distinguish GATE_2 from GATE_3', () => {
  test('Gate 3 secret rejection is recorded as GATE_3 in audit log', async () => {
    const src = fixturePath('gate3-private-key')
    await ingestSkillPackage(src)

    const auditLog = readAuditLog()
    const event = JSON.parse(auditLog.trim().split('\n')[0] ?? '')
    expect(event.failedGate).toBe('GATE_3')
    // Audit log must not contain the private key bytes
    expect(auditLog).not.toContain('MIIEowIBAAKCAQEA')
  })
})
