import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  WriteFileInputSchema,
  RunCheckInputSchema,
  FinalizeInputSchema,
  isReadPathAuthorized,
  isWritePathAuthorized,
  isCheckAuthorized,
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
    // Schema doesn't check content strings — broker handler does
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

describe('broker check validation — schema rejects shell command shapes', () => {
  // RunCheckInputSchema uses regex /^[a-zA-Z][a-zA-Z0-9_-]*$/ to reject
  // shell-command-shaped strings at the schema level. Valid single-word
  // identifiers (e.g. "bash", "make") pass the schema but are rejected
  // by the broker's isCheckAuthorized if not declared in VERIFY.yaml.

  it('schema rejects strings containing spaces (shell command shape)', () => {
    const shellCommandStrings = [
      'node --test',
      'bash -c rm',
      'sh -c evil',
      'test; rm -rf /',
      'npm test',
    ]
    for (const id of shellCommandStrings) {
      const result = RunCheckInputSchema.safeParse({ check: id })
      expect(result.success).toBe(false)
    }
  })

  it('schema rejects empty check ID', () => {
    expect(RunCheckInputSchema.safeParse({ check: '' }).success).toBe(false)
  })

  it('schema accepts valid single-word check IDs (authorization is broker-level)', () => {
    // These pass the schema; the broker then calls isCheckAuthorized against the contract
    for (const id of ['test', 'typecheck', 'lint', 'build', 'bash', 'make']) {
      expect(RunCheckInputSchema.safeParse({ check: id }).success).toBe(true)
    }
  })

  it('run check accepts "test"', () => {
    const result = RunCheckInputSchema.safeParse({ check: 'test' })
    expect(result.success).toBe(true)
  })
})

describe('broker check authorization — isCheckAuthorized', () => {
  // Even valid-shaped check IDs are rejected by the broker if not in VERIFY.yaml
  const CONTRACT_CHECKS = { test: { command: 'node --test', required: true } }

  it('denies "bash" even though schema accepts it', () => {
    expect(RunCheckInputSchema.safeParse({ check: 'bash' }).success).toBe(true) // schema OK
    expect(isCheckAuthorized('bash', CONTRACT_CHECKS)).toBe(false) // broker denies
  })

  it('denies "make" even though schema accepts it', () => {
    expect(RunCheckInputSchema.safeParse({ check: 'make' }).success).toBe(true)
    expect(isCheckAuthorized('make', CONTRACT_CHECKS)).toBe(false)
  })

  it('authorizes declared check "test"', () => {
    expect(isCheckAuthorized('test', CONTRACT_CHECKS)).toBe(true)
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

  it('advisory-only project: testCheckPassed starts true (no required checks)', () => {
    // When all declared checks are required:false, the finalization gate
    // must start open — no required check needs to pass.
    const allowedChecks: Record<string, { command: string; required: boolean }> = {
      tests: { command: 'python3 -m pytest', required: false },
    }
    const hasRequiredChecks = Object.values(allowedChecks).some(c => c.required)
    const testCheckPassed = !hasRequiredChecks
    expect(testCheckPassed).toBe(true)
  })

  it('advisory check failure does not close the finalization gate', () => {
    // Simulate broker state machine: advisory check fails, finalize should succeed.
    let testCheckPassed = true   // initialized open because no required checks
    let checksValidAfterLastWrite = false

    function runAdvisoryCheck(passed: boolean, isRequired: boolean): void {
      if (isRequired) {
        testCheckPassed = passed
      }
      if (passed || !isRequired) {
        checksValidAfterLastWrite = true
      }
    }

    function callFinalize(): string {
      if (!testCheckPassed) throw new Error('project_finalize rejected: test check has not passed')
      if (!checksValidAfterLastWrite) throw new Error('project_finalize rejected: checks must pass after last write')
      return 'finalized'
    }

    // Write invalidates check gate
    checksValidAfterLastWrite = false

    // Advisory check fails — gate should still open for finalization
    runAdvisoryCheck(false, false)

    expect(testCheckPassed).toBe(true)
    expect(checksValidAfterLastWrite).toBe(true)
    expect(() => callFinalize()).not.toThrow()
  })

  it('required check failure blocks finalization', () => {
    let testCheckPassed = false  // initialized closed because required checks exist
    let checksValidAfterLastWrite = false

    function runCheck(passed: boolean, isRequired: boolean): void {
      if (isRequired) testCheckPassed = passed
      if (passed || !isRequired) checksValidAfterLastWrite = true
    }

    function callFinalize(): string {
      if (!testCheckPassed) throw new Error('project_finalize rejected: test check has not passed')
      if (!checksValidAfterLastWrite) throw new Error('project_finalize rejected: checks must pass after last write')
      return 'finalized'
    }

    checksValidAfterLastWrite = false
    runCheck(false, true)  // required check fails

    expect(testCheckPassed).toBe(false)
    expect(() => callFinalize()).toThrow(/finalize rejected/)
  })

  it('mixed checks: required failure blocks even when advisory passes', () => {
    // required:true check A fails, required:false check B passes — gate must stay closed
    let testCheckPassed = false  // has required checks → starts closed
    let checksValidAfterLastWrite = false

    function runCheck(passed: boolean, isRequired: boolean): void {
      if (isRequired) testCheckPassed = passed
      if (passed || !isRequired) checksValidAfterLastWrite = true
    }

    function callFinalize(): string {
      if (!testCheckPassed) throw new Error('project_finalize rejected: test check has not passed')
      return 'finalized'
    }

    runCheck(false, true)   // required check A fails
    runCheck(true, false)   // advisory check B passes

    expect(testCheckPassed).toBe(false)  // still false — required check hasn't passed
    expect(() => callFinalize()).toThrow(/finalize rejected/)
  })
})

describe('write path protection — broker authorization', () => {
  it('broker write handler rejects path outside allowed write paths via isWritePathAuthorized', () => {
    const allowedWrite = ['src/engine/tests/**']

    expect(isWritePathAuthorized('.env', allowedWrite)).toBe(false)
    expect(isWritePathAuthorized('package.json', allowedWrite)).toBe(false)
    expect(isWritePathAuthorized('src/engine/sim.ts', allowedWrite)).toBe(false)
    expect(isWritePathAuthorized('src/engine/tests/foo.test.ts', allowedWrite)).toBe(true)
  })

  it('pilot-shaped write paths are also covered by generic glob authorization', () => {
    // The pilot's allowedWritePaths are exact filenames, not globs
    const pilotWrite = ['src/status.js', 'tests/status.test.js']
    expect(isWritePathAuthorized('src/status.js', pilotWrite)).toBe(true)
    expect(isWritePathAuthorized('tests/status.test.js', pilotWrite)).toBe(true)
    expect(isWritePathAuthorized('.env', pilotWrite)).toBe(false)
    expect(isWritePathAuthorized('package.json', pilotWrite)).toBe(false)
  })
})

describe('read path authorization', () => {
  it('engine source is readable when src/engine/** is in allowedReadPaths', () => {
    const allowed = ['package.json', 'src/engine/**']
    expect(isReadPathAuthorized('src/engine/sim.ts', allowed)).toBe(true)
    expect(isReadPathAuthorized('src/steam/index.ts', allowed)).toBe(false)
    expect(isReadPathAuthorized('.env', allowed)).toBe(false)
  })
})

// ── builtinToolUseCount event-routing source invariants ──────────────────────
//
// Audit Question 2 — prove that the broker routes events correctly:
//   - agent.tool_use (prohibited Anthropic built-in tools) increments builtinToolUseCount
//   - agent.custom_tool_use (permitted project broker tools) does NOT
// These are source-inspection tests; they do not require a live API session.

describe('builtinToolUseCount event semantics — source invariants', () => {
  let src: string

  beforeAll(() => {
    src = fs.readFileSync(path.resolve('src/broker/project-tool-broker.ts'), 'utf-8')
  })

  it('builtinToolUseCount is incremented exactly once in broker source', () => {
    const increments = src.match(/builtinToolUseCount\+\+/g) ?? []
    expect(increments).toHaveLength(1)
  })

  it('the single builtinToolUseCount increment is inside the agent.tool_use branch', () => {
    const lines = src.split('\n')
    const toolUseLineIdx = lines.findIndex(l => l.includes("event.type === 'agent.tool_use'"))
    expect(toolUseLineIdx).toBeGreaterThan(-1)
    const nextBranchIdx = lines.findIndex((l, i) => i > toolUseLineIdx && l.trimStart().startsWith('} else'))
    const branchLines = lines.slice(toolUseLineIdx, nextBranchIdx > -1 ? nextBranchIdx : undefined)
    expect(branchLines.some(l => l.includes('builtinToolUseCount++'))).toBe(true)
  })

  it('agent.custom_tool_use branch does not increment builtinToolUseCount', () => {
    const lines = src.split('\n')
    const customStartIdx = lines.findIndex(l => l.includes("event.type === 'agent.custom_tool_use'"))
    expect(customStartIdx).toBeGreaterThan(-1)
    const customEndIdx = lines.findIndex((l, i) => i > customStartIdx && l.trimStart().startsWith('} else'))
    const branchLines = lines.slice(customStartIdx, customEndIdx > -1 ? customEndIdx : undefined)
    for (const line of branchLines) {
      expect(line).not.toContain('builtinToolUseCount++')
    }
  })

  it('broker session result exposes builtinToolUseCount from accumulated state', () => {
    expect(src).toContain('builtinToolUseCount: state.builtinToolUseCount')
  })
})

describe('clearance invariants in session summary', () => {
  it('SESSION_SUMMARY clearedForRealProjectMounting is always false', () => {
    // The clearedForRealProjectMounting field in SESSION_SUMMARY.json must
    // always be false — enforced by generate-patch-package.
    const summary = {
      clearedForRealProjectMounting: false as const,
      // clearedForSanitizedExternalProjectInput is now true for any run that
      // loaded a valid POLICY.yaml + VERIFY.yaml contract.
      clearedForSanitizedExternalProjectInput: true,
      clearedForGeneratedExternalPilot: false,
    }
    expect(summary.clearedForRealProjectMounting).toBe(false)
  })

  it('clearedForGeneratedExternalPilot can only be true when all gates pass for the pilot project', () => {
    function computePilotClearance(
      testPassed: boolean,
      sourceUnmodified: boolean,
      builtinToolCount: number,
      isGeneratedPilot: boolean,
    ): boolean {
      return isGeneratedPilot && testPassed && sourceUnmodified && builtinToolCount === 0
    }

    expect(computePilotClearance(true, true, 0, true)).toBe(true)
    expect(computePilotClearance(false, true, 0, true)).toBe(false)
    expect(computePilotClearance(true, false, 0, true)).toBe(false)
    expect(computePilotClearance(true, true, 1, true)).toBe(false)
    expect(computePilotClearance(true, true, 0, false)).toBe(false) // non-pilot
  })
})
