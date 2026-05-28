import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { ingestSkillPackage, DEFAULT_GATE0_LIMITS, type IngestionSuccess } from '../src/skills/skill-ingestion.js'

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
    // Cast after the assertion — vitest cannot narrow the union via expect()
    const success = result as IngestionSuccess

    expect(success.name).toBe('minimal-skill')
    expect(success.gatesCompleted).toEqual(['GATE_0', 'GATE_1'])
    expect(success.candidateId).toMatch(/^[0-9a-f-]{36}$/)

    // Snapshot exists in candidates/
    expect(fs.existsSync(success.candidatePath)).toBe(true)
    expect(fs.existsSync(path.join(success.candidatePath, 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(success.candidatePath, 'manifest.json'))).toBe(true)

    // Audit log records 'imported' event
    const auditLog = readAuditLog()
    const event = JSON.parse(auditLog.trim().split('\n')[0] ?? '')
    expect(event.event).toBe('imported')
    expect(event.name).toBe('minimal-skill')
    expect(event.candidateId).toBe(success.candidateId)
    expect(event.contentHash).toBeNull() // Gate 2 not yet run
  })

  test('skill-no-manifest fixture generates a skeleton manifest from frontmatter', async () => {
    const src = fixturePath('skill-no-manifest')
    const result = await ingestSkillPackage(src)

    expect(result.success).toBe(true)
    const success = result as IngestionSuccess

    expect(success.name).toBe('no-manifest-skill')

    const manifestRaw = JSON.parse(
      fs.readFileSync(path.join(success.candidatePath, 'manifest.json'), 'utf-8')
    )
    expect(manifestRaw.name).toBe('no-manifest-skill')
    expect(manifestRaw.sha256).toBeNull()
    expect(manifestRaw.evaluationPassed).toBe(false)
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
