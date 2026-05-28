import { describe, it, expect } from 'vitest'
import {
  VerificationReportSchema,
  CheckResultSchema,
  CheckVerdictSchema,
} from '../src/contracts/verification-preflight-report.js'

const BASE_CHECK = {
  checkId: 'test',
  command: 'npm test',
  verdict: 'PASS' as const,
  exitCode: 0,
  stdoutTail: 'all tests passed',
  stderrTail: '',
}

const BASE_REPORT = {
  verifiedAt: '2024-01-01T00:00:00.000Z',
  projectId: 'singularity-inc-engine-qa',
  projectPath: '/home/user/projects/singularity',
  contractValid: true as const,
  sanitizationPassed: true,
  workspaceMode: 'sanitized_copy_only' as const,
  originalProjectMounted: false as const,
  liveAgentSession: false as const,
  executorNetwork: 'disabled' as const,
  checks: [BASE_CHECK],
  verdict: 'PASS' as const,
  sourceProjectModified: false,
}

// ── VerificationReportSchema: literals ───────────────────────────────────────

describe('VerificationReportSchema: literal invariants', () => {
  it('parses a valid PASS report', () => {
    expect(VerificationReportSchema.safeParse(BASE_REPORT).success).toBe(true)
  })

  it('requires contractValid to be true (not false)', () => {
    expect(VerificationReportSchema.safeParse({
      ...BASE_REPORT, contractValid: false,
    }).success).toBe(false)
  })

  it('requires originalProjectMounted to be false (not true)', () => {
    expect(VerificationReportSchema.safeParse({
      ...BASE_REPORT, originalProjectMounted: true,
    }).success).toBe(false)
  })

  it('requires liveAgentSession to be false (not true)', () => {
    expect(VerificationReportSchema.safeParse({
      ...BASE_REPORT, liveAgentSession: true,
    }).success).toBe(false)
  })

  it('requires executorNetwork to be "disabled" (not any other string)', () => {
    expect(VerificationReportSchema.safeParse({
      ...BASE_REPORT, executorNetwork: 'enabled',
    }).success).toBe(false)
  })

  it('requires workspaceMode to be "sanitized_copy_only"', () => {
    expect(VerificationReportSchema.safeParse({
      ...BASE_REPORT, workspaceMode: 'real_project',
    }).success).toBe(false)
  })
})

// ── VerificationReportSchema: verdict values ──────────────────────────────────

describe('VerificationReportSchema: verdict values', () => {
  const VERDICTS = ['PASS', 'FAIL_CHECK', 'BLOCKED_MISSING_TOOLING', 'FAIL_BOUNDARY'] as const

  for (const verdict of VERDICTS) {
    it(`accepts verdict "${verdict}"`, () => {
      expect(VerificationReportSchema.safeParse({
        ...BASE_REPORT,
        verdict,
        checks: [{ ...BASE_CHECK, verdict }],
      }).success).toBe(true)
    })
  }

  it('rejects unknown verdict values', () => {
    expect(VerificationReportSchema.safeParse({
      ...BASE_REPORT, verdict: 'UNKNOWN',
    }).success).toBe(false)
  })
})

// ── VerificationReportSchema: source modification flag ────────────────────────

describe('VerificationReportSchema: sourceProjectModified', () => {
  it('accepts false', () => {
    expect(VerificationReportSchema.safeParse({
      ...BASE_REPORT, sourceProjectModified: false,
    }).success).toBe(true)
  })

  it('accepts true (the flag can record an anomaly)', () => {
    expect(VerificationReportSchema.safeParse({
      ...BASE_REPORT, sourceProjectModified: true,
    }).success).toBe(true)
  })
})

// ── VerificationReportSchema: report content safety ──────────────────────────

describe('VerificationReportSchema: no forbidden content in report', () => {
  it('report does not contain credential values (only check output is bounded tail)', () => {
    const report = {
      ...BASE_REPORT,
      checks: [{
        ...BASE_CHECK,
        stdoutTail: 'tests ran',
        stderrTail: '',
      }],
    }
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('STEAM_API_KEY')
    expect(serialized).not.toContain('SECRET=')
    expect(serialized).not.toContain('depot_key')
    expect(serialized).not.toContain('credentials.json')
  })
})

// ── CheckResultSchema ─────────────────────────────────────────────────────────

describe('CheckResultSchema', () => {
  it('parses a BLOCKED_MISSING_TOOLING result', () => {
    expect(CheckResultSchema.safeParse({
      checkId: 'test',
      command: 'npm test',
      verdict: 'BLOCKED_MISSING_TOOLING',
      exitCode: 127,
      stdoutTail: '',
      stderrTail: 'sh: 1: vitest: not found',
      detail: 'spawn error details',
    }).success).toBe(true)
  })

  it('allows null exitCode for FAIL_BOUNDARY', () => {
    expect(CheckResultSchema.safeParse({
      checkId: 'test',
      command: 'npm test',
      verdict: 'FAIL_BOUNDARY',
      exitCode: null,
      stdoutTail: '',
      stderrTail: '',
    }).success).toBe(true)
  })

  it('detail field is optional', () => {
    const withDetail = CheckResultSchema.safeParse({ ...BASE_CHECK, detail: 'some detail' })
    const withoutDetail = CheckResultSchema.safeParse(BASE_CHECK)
    expect(withDetail.success).toBe(true)
    expect(withoutDetail.success).toBe(true)
  })
})

// ── CheckVerdictSchema ────────────────────────────────────────────────────────

describe('CheckVerdictSchema', () => {
  it('accepts all four defined verdicts', () => {
    for (const v of ['PASS', 'FAIL_CHECK', 'BLOCKED_MISSING_TOOLING', 'FAIL_BOUNDARY']) {
      expect(CheckVerdictSchema.safeParse(v).success).toBe(true)
    }
  })

  it('rejects anything else', () => {
    expect(CheckVerdictSchema.safeParse('').success).toBe(false)
    expect(CheckVerdictSchema.safeParse('pass').success).toBe(false)
    expect(CheckVerdictSchema.safeParse(null).success).toBe(false)
  })
})
