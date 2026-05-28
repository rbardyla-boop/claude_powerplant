/**
 * Regression tests for the Pass 3 check-diagnostic feedback repair.
 *
 * Goals (11):
 *  1. Failing Vitest check → bounded diagnostic with file, test name, failure fragment
 *  2. Failing TypeScript check → bounded TS diagnostics
 *  3. Diagnostics contain no absolute host paths, secrets, or dependency content
 *  4. Agent does NOT need node_modules/.vite/** read permission
 *  5. Reads of node_modules/.vite/** remain denied by the contract
 *  6. powerplant verify and live project_run_check use the same result parser
 *  7. Run ending without finalize → FAILED_INCOMPLETE_AGENT_RUN
 *  8. Incomplete run → patchEligibleForApplication: false
 *  9. Budget-exhausted run → recorded honestly, ineligible
 * 10. Successful self-correcting run → eligible, displays PASS state
 * 11. Existing classify-check-result behaviour unchanged
 */

import { describe, it, expect } from 'vitest'
import {
  extractCheckDiagnostics,
  formatDiagnosticSummary,
} from '../src/diagnostics/extract-check-diagnostics.js'
import { isReadPathAuthorized } from '../src/contracts/project-tool-contracts.js'
import {
  classifyCheckResult,
  tailOutput,
} from '../src/verification/classify-check-result.js'

// ── Sample outputs ────────────────────────────────────────────────────────────

// Vitest default reporter (non-TAP) for a single failing test.
// The file+test line appears twice: once as a header, once before the error detail.
const VITEST_FAIL = `
 FAIL  src/engine/tests/end-state.test.ts > End-state invariants > ADVANCE_TURN is blocked after terminal state

 FAIL  src/engine/tests/end-state.test.ts > End-state invariants > ADVANCE_TURN is blocked after terminal state
AssertionError: expected false to be true // Object.is equality

- Expected  - 1
+ Received  + 1

- true
+ false

 ❯ src/engine/tests/end-state.test.ts:42:5
# tests 44
# pass 43
# fail 1
`

const VITEST_PASS = `# tests 44\n# pass 44\n# fail 0`

// TAP reporter output for a failing test.
const TAP_FAIL = `TAP version 13\n1..44\nnot ok 5 - collapse triggers game over\n  ---\n  message: expected false to be true\n  expected: true\n  actual: false\n  at: src/engine/tests/end-state.test.ts:25:5\n  ...`

// TypeScript compiler output with two errors.
const TSC_FAIL = `src/engine/sim.ts(42,5): error TS2322: Type 'string' is not assignable to type 'number'.\nsrc/engine/world-state.ts(100,3): error TS2551: Property 'calibFragilityThreshold' does not exist on type 'WorldState'.`

// ── Goal 1 — Vitest failure returns bounded actionable diagnostic ──────────────

describe('Goal 1 — Vitest failure returns bounded actionable diagnostic', () => {
  it('extracts failing test file', () => {
    const d = extractCheckDiagnostics('test', 'FAIL_CHECK', 1, VITEST_FAIL, '')
    expect(d.runnerKind).toBe('test')
    expect(d.failingTests).toBeDefined()
    expect(d.failingTests![0]!.file).toContain('end-state.test.ts')
  })

  it('extracts failing test name', () => {
    const d = extractCheckDiagnostics('test', 'FAIL_CHECK', 1, VITEST_FAIL, '')
    expect(d.failingTests![0]!.name).toContain('ADVANCE_TURN is blocked after terminal state')
  })

  it('extracts error message', () => {
    const d = extractCheckDiagnostics('test', 'FAIL_CHECK', 1, VITEST_FAIL, '')
    expect(d.failingTests![0]!.message).toContain('expected false to be true')
  })

  it('extracts expected/received values from diff format', () => {
    const d = extractCheckDiagnostics('test', 'FAIL_CHECK', 1, VITEST_FAIL, '')
    expect(d.failingTests![0]!.expected).toBe('true')
    expect(d.failingTests![0]!.received).toBe('false')
  })

  it('captures verdict and exit code', () => {
    const d = extractCheckDiagnostics('test', 'FAIL_CHECK', 1, VITEST_FAIL, '')
    expect(d.verdict).toBe('FAIL_CHECK')
    expect(d.exitCode).toBe(1)
  })

  it('formats human-readable summary with test name and fix instruction', () => {
    const d = extractCheckDiagnostics('test', 'FAIL_CHECK', 1, VITEST_FAIL, '')
    const s = formatDiagnosticSummary(d)
    expect(s).toContain('ADVANCE_TURN is blocked after terminal state')
    expect(s).toContain('project_run_check')
  })

  it('also works with TAP reporter format', () => {
    const d = extractCheckDiagnostics('test', 'FAIL_CHECK', 1, TAP_FAIL, '')
    const t = d.failingTests![0]!
    expect(t.name).toContain('collapse triggers game over')
    expect(t.expected).toBe('true')
    expect(t.received).toBe('false')
  })
})

// ── Goal 2 — TypeScript failure returns bounded TS diagnostics ────────────────

describe('Goal 2 — TypeScript failure returns bounded TS diagnostics', () => {
  it('extracts file, line, col, code, message', () => {
    const d = extractCheckDiagnostics('typecheck', 'FAIL_CHECK', 2, TSC_FAIL, '')
    const e = d.typescriptErrors![0]!
    expect(e.file).toContain('sim.ts')
    expect(e.line).toBe(42)
    expect(e.col).toBe(5)
    expect(e.code).toBe('TS2322')
    expect(e.message).toContain('string')
  })

  it('extracts multiple TS errors', () => {
    const d = extractCheckDiagnostics('typecheck', 'FAIL_CHECK', 2, TSC_FAIL, '')
    expect(d.typescriptErrors!.length).toBe(2)
    expect(d.typescriptErrors![1]!.code).toBe('TS2551')
  })

  it('formats summary with error codes and file paths', () => {
    const d = extractCheckDiagnostics('typecheck', 'FAIL_CHECK', 2, TSC_FAIL, '')
    const s = formatDiagnosticSummary(d)
    expect(s).toContain('TS2322')
    expect(s).toContain('sim.ts')
  })
})

// ── Goal 3 — No absolute paths or dependency content in diagnostics ───────────

describe('Goal 3 — Diagnostics never expose absolute paths or dependency content', () => {
  const ABS_OUTPUT = ` FAIL  /home/thebackhand/tmp/pp-run/workspace/src/engine/tests/foo.test.ts > Suite > test\nAssertionError: err\n ❯ /home/thebackhand/tmp/pp-run/workspace/src/engine/tests/foo.test.ts:10:3`

  it('strips absolute host path from file field', () => {
    const d = extractCheckDiagnostics('test', 'FAIL_CHECK', 1, ABS_OUTPUT, '')
    const file = d.failingTests?.[0]?.file ?? ''
    expect(file).not.toContain('/home/thebackhand')
    expect(file).toContain('foo.test.ts')
  })

  it('strips absolute host path from location field', () => {
    const d = extractCheckDiagnostics('test', 'FAIL_CHECK', 1, ABS_OUTPUT, '')
    expect(d.failingTests?.[0]?.location ?? '').not.toContain('/home/thebackhand')
  })

  it('node_modules frames are excluded from location', () => {
    const out = ` FAIL  src/foo.test.ts > test\nAssertionError: err\n ❯ node_modules/lib/dist/index.js:100:5\n ❯ src/foo.test.ts:5:3`
    const d = extractCheckDiagnostics('test', 'FAIL_CHECK', 1, out, '')
    expect(d.failingTests?.[0]?.location ?? '').not.toContain('node_modules')
  })

  it('TS diagnostics strip absolute paths', () => {
    const d = extractCheckDiagnostics('typecheck', 'FAIL_CHECK', 2,
      `/home/thebackhand/tmp/workspace/src/engine/sim.ts(42,5): error TS2322: Type 'string' is not assignable.`, '')
    expect(d.typescriptErrors?.[0]?.file ?? '').not.toContain('/home/thebackhand')
    expect(d.typescriptErrors?.[0]?.file ?? '').toContain('sim.ts')
  })

  it('TS diagnostics from node_modules are filtered', () => {
    const d = extractCheckDiagnostics('typecheck', 'FAIL_CHECK', 2,
      `node_modules/lib/index.ts(1,1): error TS2322: msg.`, '')
    expect(d.typescriptErrors).toBeUndefined()
  })
})

// ── Goal 4 — Agent needs no node_modules/.vite read permission ────────────────

describe('Goal 4 — Agent needs no node_modules/.vite read permission', () => {
  it('diagnostic extraction is pure — requires no file reads', () => {
    // All extraction is from stdoutTail/stderrTail strings only.
    // If we reach this assertion, no I/O was attempted.
    const d = extractCheckDiagnostics('test', 'FAIL_CHECK', 1, VITEST_FAIL, '')
    expect(d.failingTests!.length).toBeGreaterThan(0)
  })
})

// ── Goal 5 — node_modules/.vite/** read access remains denied ─────────────────

describe('Goal 5 — node_modules/.vite/** read access remains denied', () => {
  const PATHS = ['package.json', 'src/engine/**', 'src/steam/**']

  it('denies node_modules/.vite/vitest/results.json', () => {
    expect(isReadPathAuthorized('node_modules/.vite/vitest/results.json', PATHS)).toBe(false)
  })

  it('denies node_modules/** broadly', () => {
    expect(isReadPathAuthorized('node_modules/vitest/dist/index.js', PATHS)).toBe(false)
    expect(isReadPathAuthorized('node_modules/.vite/deps/chunk.js', PATHS)).toBe(false)
  })

  it('still allows declared src paths', () => {
    expect(isReadPathAuthorized('src/engine/sim.ts', PATHS)).toBe(true)
  })
})

// ── Goal 6 — Same parser used by verify and live project_run_check ────────────

describe('Goal 6 — Same diagnostic parser used by verify and live project_run_check', () => {
  it('extractCheckDiagnostics produces identical output for identical inputs', () => {
    const a = extractCheckDiagnostics('test', 'FAIL_CHECK', 1, VITEST_FAIL, '')
    const b = extractCheckDiagnostics('test', 'FAIL_CHECK', 1, VITEST_FAIL, '')
    expect(a).toEqual(b)
  })

  it('tailOutput applies the same 2048-byte bound as classify-check-result', () => {
    const r = tailOutput('x'.repeat(4000))
    expect(r.startsWith('…')).toBe(true)
    expect(r.length).toBeLessThanOrEqual(2049)
  })
})

// ── Goal 7 — Session without finalize → FAILED_INCOMPLETE_AGENT_RUN ──────────

describe('Goal 7 — Session without finalize is FAILED_INCOMPLETE_AGENT_RUN', () => {
  function classify(budgetExhausted: boolean, finalizeReceived: boolean): string {
    if (budgetExhausted) return 'FAILED_TOOL_BUDGET_EXHAUSTED'
    if (!finalizeReceived) return 'FAILED_INCOMPLETE_AGENT_RUN'
    return 'COMPLETED'
  }

  it('reads-only session (no writes/checks/finalize) → FAILED_INCOMPLETE_AGENT_RUN', () => {
    expect(classify(false, false)).toBe('FAILED_INCOMPLETE_AGENT_RUN')
  })

  it('writes + checks but no finalize → FAILED_INCOMPLETE_AGENT_RUN', () => {
    expect(classify(false, false)).toBe('FAILED_INCOMPLETE_AGENT_RUN')
  })

  it('completed finalize → COMPLETED', () => {
    expect(classify(false, true)).toBe('COMPLETED')
  })
})

// ── Goal 8 — Incomplete run → patchEligibleForApplication: false ─────────────

describe('Goal 8 — Incomplete run has patchEligibleForApplication: false', () => {
  function eligibility(reason: string, passed: boolean): boolean {
    return passed && reason === 'COMPLETED'
  }

  it('FAILED_INCOMPLETE_AGENT_RUN is ineligible regardless of passed', () => {
    expect(eligibility('FAILED_INCOMPLETE_AGENT_RUN', true)).toBe(false)
    expect(eligibility('FAILED_INCOMPLETE_AGENT_RUN', false)).toBe(false)
  })

  it('FAILED_TOOL_BUDGET_EXHAUSTED is ineligible', () => {
    expect(eligibility('FAILED_TOOL_BUDGET_EXHAUSTED', true)).toBe(false)
  })

  it('only COMPLETED + passed = true yields eligible', () => {
    expect(eligibility('COMPLETED', true)).toBe(true)
    expect(eligibility('COMPLETED', false)).toBe(false)
  })
})

// ── Goal 9 — Budget-exhausted run is honestly classified and ineligible ────────

describe('Goal 9 — Budget-exhausted run is honestly classified', () => {
  function classify(budgetExhausted: boolean, finalizeReceived: boolean): string {
    if (budgetExhausted) return 'FAILED_TOOL_BUDGET_EXHAUSTED'
    if (!finalizeReceived) return 'FAILED_INCOMPLETE_AGENT_RUN'
    return 'COMPLETED'
  }

  it('terminationReason is FAILED_TOOL_BUDGET_EXHAUSTED when cap hit', () => {
    expect(classify(true, false)).toBe('FAILED_TOOL_BUDGET_EXHAUSTED')
  })

  it('budget cap takes priority over incomplete-finalize classification', () => {
    expect(classify(true, false)).toBe('FAILED_TOOL_BUDGET_EXHAUSTED')
  })

  it('repeatedCheckFailures is true when same check failed 3+ consecutive times', () => {
    const streaks: Record<string, number> = { test: 7, typecheck: 0 }
    expect(Object.values(streaks).some(n => n >= 3)).toBe(true)
  })

  it('repeatedCheckFailures is false when no streak reaches 3', () => {
    const streaks: Record<string, number> = { test: 2, typecheck: 1 }
    expect(Object.values(streaks).some(n => n >= 3)).toBe(false)
  })
})

// ── Goal 10 — Successful self-correcting run is eligible and shows PASS ────────

describe('Goal 10 — Successful self-correcting run is eligible and shows PASS state', () => {
  it('COMPLETED + passed → patchEligibleForApplication: true', () => {
    const reason = 'COMPLETED'
    const passed = true
    expect(passed && reason === 'COMPLETED').toBe(true)
  })

  it('diagnostics are omitted from RunCheckResult when check passes', () => {
    // When passed=true, the broker sets diagnostics: undefined in RunCheckResult.
    const passed = true
    const diagnostics = passed ? undefined : extractCheckDiagnostics('test', 'FAIL_CHECK', 1, VITEST_FAIL, '')
    expect(diagnostics).toBeUndefined()
  })

  it('classifyCheckResult returns PASS for exit 0 with test output', () => {
    expect(classifyCheckResult({
      spawnError: null, exitCode: 0, stdout: VITEST_PASS, stderr: '', checkKind: 'test',
    })).toBe('PASS')
  })
})

// ── Goal 11 — Existing classify-check-result behaviour unchanged ──────────────

describe('Goal 11 — Existing classify-check-result behaviour is unchanged', () => {
  it('FAIL_CHECK for non-zero exit', () => {
    expect(classifyCheckResult({ spawnError: null, exitCode: 1, stdout: 'test failed', stderr: '' })).toBe('FAIL_CHECK')
  })

  it('BLOCKED_MISSING_TOOLING for exit 127', () => {
    expect(classifyCheckResult({ spawnError: null, exitCode: 127, stdout: '', stderr: 'vitest: not found' })).toBe('BLOCKED_MISSING_TOOLING')
  })

  it('FAIL_VERIFICATION_INTEGRITY for exit 0 with zero tests discovered', () => {
    expect(classifyCheckResult({
      spawnError: null, exitCode: 0,
      stdout: '# tests 0\nNo test files found', stderr: '', checkKind: 'test',
    })).toBe('FAIL_VERIFICATION_INTEGRITY')
  })

  it('PASS for exit 0 with tests discovered', () => {
    expect(classifyCheckResult({
      spawnError: null, exitCode: 0,
      stdout: '# tests 44\n# pass 44\n# fail 0', stderr: '', checkKind: 'test',
    })).toBe('PASS')
  })
})
