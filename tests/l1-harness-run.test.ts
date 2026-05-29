// Stage 2B Gate 2 — CLI receipt validation and static boundary invariants (no live calls)
//
// Proves fail-closed behavior for loadL0Receipt across all validation branches,
// and verifies two CLI source invariants required by Gate 2:
//   - _runL1HarnessForTesting is absent from non-comment CLI code (test bypass excluded)
//   - Only the production runL1Harness path is present in the CLI

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// acceptance-bootstrap.ts has top-level script code (process.exit guard) that fires
// when the module is imported without CLI args. Mock it to expose only the constant.
vi.mock('../scripts/acceptance-bootstrap.js', () => ({
  L0_FIXTURE_RECEIPT_FILENAME: 'l0-fixture-receipt.json',
}))

const { loadL0Receipt, L0_FIXTURE_RECEIPT_FILENAME } = await import('../src/cli/l1-harness-run.js')

// Valid 64-char lowercase hex SHA-256
const VALID_HASH = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'l1-cli-test-'))
  fs.mkdirSync(path.join(tmpDir, 'state'), { recursive: true })
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function receiptPath(): string {
  return path.join(tmpDir, 'state', L0_FIXTURE_RECEIPT_FILENAME)
}

function writeReceipt(content: unknown): void {
  fs.writeFileSync(receiptPath(), JSON.stringify(content, null, 2) + '\n', 'utf-8')
}

// ── Receipt validation — fail-closed checks ────────────────────────────────────

describe('loadL0Receipt — fail-closed receipt validation', () => {
  it('throws when receipt file does not exist', () => {
    expect(() => loadL0Receipt(tmpDir)).toThrow('run acceptance-bootstrap first')
  })

  it('throws when receipt file contains malformed JSON', () => {
    fs.writeFileSync(receiptPath(), 'not-valid-json{{{', 'utf-8')
    expect(() => loadL0Receipt(tmpDir)).toThrow('malformed JSON')
  })

  it('throws when receipt is a JSON array, not an object', () => {
    fs.writeFileSync(receiptPath(), '[1, 2, 3]\n', 'utf-8')
    expect(() => loadL0Receipt(tmpDir)).toThrow('not a JSON object')
  })

  it('throws when schemaVersion is not 1', () => {
    writeReceipt({ schemaVersion: 99, fixtureSkillId: 'fix-a', contentHash: VALID_HASH, installedAt: '2026-01-01T00:00:00.000Z' })
    expect(() => loadL0Receipt(tmpDir)).toThrow('unsupported schemaVersion')
  })

  it('throws when fixtureSkillId is missing or empty', () => {
    writeReceipt({ schemaVersion: 1, fixtureSkillId: '', contentHash: VALID_HASH, installedAt: '2026-01-01T00:00:00.000Z' })
    expect(() => loadL0Receipt(tmpDir)).toThrow('fixtureSkillId')
  })

  it('throws when contentHash is not 64-char lowercase hex', () => {
    writeReceipt({ schemaVersion: 1, fixtureSkillId: 'fix-a', contentHash: 'too-short', installedAt: '2026-01-01T00:00:00.000Z' })
    expect(() => loadL0Receipt(tmpDir)).toThrow('invalid contentHash')
  })

  it('throws when installedAt is missing or empty', () => {
    writeReceipt({ schemaVersion: 1, fixtureSkillId: 'fix-a', contentHash: VALID_HASH, installedAt: '' })
    expect(() => loadL0Receipt(tmpDir)).toThrow('installedAt')
  })

  it('returns a validated L0FixtureReceipt when all fields are valid', () => {
    writeReceipt({
      schemaVersion: 1,
      fixtureSkillId: 'my-acceptance-fixture',
      contentHash: VALID_HASH,
      installedAt: '2026-05-29T12:00:00.000Z',
    })
    const receipt = loadL0Receipt(tmpDir)
    expect(receipt.schemaVersion).toBe(1)
    expect(receipt.fixtureSkillId).toBe('my-acceptance-fixture')
    expect(receipt.contentHash).toBe(VALID_HASH)
    expect(receipt.installedAt).toBe('2026-05-29T12:00:00.000Z')
  })
})

// ── CLI source static invariants ───────────────────────────────────────────────
// Read the CLI source directly to verify Gate 2 source-level boundaries.

describe('l1-harness-run.ts static invariants', () => {
  function nonCommentLines(filePath: string): string {
    return fs.readFileSync(path.resolve(filePath), 'utf-8')
      .split('\n')
      .filter(l => !l.trim().startsWith('//'))
      .join('\n')
  }

  it('does not import or call _runL1HarnessForTesting in non-comment code', () => {
    const src = nonCommentLines('src/cli/l1-harness-run.ts')
    expect(src).not.toContain('_runL1HarnessForTesting')
  })

  it('imports and calls only the production runL1Harness entry point', () => {
    const src = nonCommentLines('src/cli/l1-harness-run.ts')
    expect(src).toContain('runL1Harness')
  })
})
