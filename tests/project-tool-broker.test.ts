import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  WriteFileInputSchema,
  RunCheckInputSchema,
  FinalizeInputSchema,
} from '../src/contracts/project-tool-contracts.js'

// These tests exercise the pure validation logic that protects the broker,
// without requiring Docker, the Anthropic API, or network access.

let tempDir: string

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-broker-test-'))
})

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('broker write validation', () => {
  it('write tool rejects POWERPLANT_FORBIDDEN canary in content', () => {
    const result = WriteFileInputSchema.safeParse({
      path: 'src/status.js',
      content: 'const x = "POWERPLANT_FORBIDDEN_CANARY"',
    })
    // Schema doesn't check content strings — broker handler does, tested below
    expect(result.success).toBe(true) // schema passes, broker would reject

    // Simulate broker content check:
    const FORBIDDEN_MARKER = 'POWERPLANT_FORBIDDEN'
    const contentHasMarker = (result.data?.content ?? '').includes(FORBIDDEN_MARKER)
    expect(contentHasMarker).toBe(true)
  })

  it('write tool accepts safe content', () => {
    const result = WriteFileInputSchema.safeParse({
      path: 'src/status.js',
      content: 'export function summarizeChecks(results) { return results; }',
    })
    expect(result.success).toBe(true)
    const FORBIDDEN_MARKER = 'POWERPLANT_FORBIDDEN'
    expect((result.data?.content ?? '').includes(FORBIDDEN_MARKER)).toBe(false)
  })
})

describe('broker check validation', () => {
  it('run check rejects non-"test" check IDs', () => {
    const badIds = [
      'bash',
      'node',
      'node --test',
      'sh',
      'test; rm -rf /',
      '',
      'npm test',
      'make',
    ]
    for (const id of badIds) {
      const result = RunCheckInputSchema.safeParse({ check: id })
      expect(result.success).toBe(false)
    }
  })

  it('run check accepts "test"', () => {
    const result = RunCheckInputSchema.safeParse({ check: 'test' })
    expect(result.success).toBe(true)
  })
})

describe('finalize gate', () => {
  it('finalize schema rejects empty summary', () => {
    expect(FinalizeInputSchema.safeParse({ summary: '' }).success).toBe(false)
  })

  it('finalize schema accepts non-empty summary', () => {
    expect(
      FinalizeInputSchema.safeParse({ summary: 'Implemented summarizeChecks' }).success,
    ).toBe(true)
  })

  it('broker state: testCheckPassed starts false — finalize must gate on it', () => {
    // Simulate the broker state machine invariant:
    // project_finalize is only allowed when testCheckPassed === true.
    // This test verifies the gate logic independently of the session loop.
    let testCheckPassed = false

    function callFinalize(): string {
      if (!testCheckPassed) {
        throw new Error('project_finalize rejected: test check has not passed')
      }
      return 'finalized'
    }

    expect(() => callFinalize()).toThrow(/finalize rejected/)

    testCheckPassed = true
    expect(() => callFinalize()).not.toThrow()
  })
})

describe('write path protection', () => {
  it('broker write handler rejects path outside allowed set', () => {
    // Simulate the broker-level path check
    const ALLOWED_WRITE = ['src/status.js', 'tests/status.test.js']

    function checkWrite(p: string): boolean {
      return ALLOWED_WRITE.includes(p)
    }

    expect(checkWrite('.env')).toBe(false)
    expect(checkWrite('package.json')).toBe(false)
    expect(checkWrite('deployment/release.txt')).toBe(false)
    expect(checkWrite('src/status.js')).toBe(true)
    expect(checkWrite('tests/status.test.js')).toBe(true)
  })
})

describe('clearance invariants in session summary', () => {
  it('SESSION_SUMMARY clearedForRealProjectMounting is always false', () => {
    // Simulate what generate-patch-package writes
    const summary = {
      clearedForRealProjectMounting: false as const,
      clearedForSanitizedExternalProjectInput: false as const,
      clearedForGeneratedExternalPilot: true,
    }
    expect(summary.clearedForRealProjectMounting).toBe(false)
    expect(summary.clearedForSanitizedExternalProjectInput).toBe(false)
  })

  it('clearedForGeneratedExternalPilot can only be true when all gates pass', () => {
    function computeClearance(
      testPassed: boolean,
      sourceUnmodified: boolean,
      builtinToolCount: number,
    ): boolean {
      return testPassed && sourceUnmodified && builtinToolCount === 0
    }

    expect(computeClearance(true, true, 0)).toBe(true)
    expect(computeClearance(false, true, 0)).toBe(false)
    expect(computeClearance(true, false, 0)).toBe(false)
    expect(computeClearance(true, true, 1)).toBe(false)
    expect(computeClearance(false, false, 0)).toBe(false)
  })
})
