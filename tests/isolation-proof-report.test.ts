import { describe, it, expect } from 'vitest'
import {
  validateIsolationProof,
  buildCustomToolResult,
  buildIsolationProofReport,
} from '../src/diagnostics/isolation-proof-report.js'
import type { ExecutorProof } from '../src/contracts/custom-tool-contract.js'

const cleanProof: ExecutorProof = {
  anthropicApiKeyPresent: false,
  anthropicEnvironmentKeyPresent: false,
  workerSecretCanaryPresent: false,
  egressAttempted: true,
  egressSucceeded: false,
  outputPathOperational: true,
  executorUid: 1001,
  executorIsNonRoot: true,
}

describe('validateIsolationProof', () => {
  it('returns no errors for a clean proof', () => {
    const errors = validateIsolationProof(cleanProof, false)
    expect(errors).toHaveLength(0)
  })

  it('fails if ANTHROPIC_API_KEY was present', () => {
    const errors = validateIsolationProof({ ...cleanProof, anthropicApiKeyPresent: true }, false)
    expect(errors.some(e => e.check === 'no-api-key')).toBe(true)
  })

  it('fails if ANTHROPIC_ENVIRONMENT_KEY was present', () => {
    const errors = validateIsolationProof({ ...cleanProof, anthropicEnvironmentKeyPresent: true }, false)
    expect(errors.some(e => e.check === 'no-env-key')).toBe(true)
  })

  it('fails if POWERPLANT_WORKER_SECRET_CANARY was present', () => {
    const errors = validateIsolationProof({ ...cleanProof, workerSecretCanaryPresent: true }, false)
    expect(errors.some(e => e.check === 'no-canary')).toBe(true)
  })

  it('fails if egress succeeded', () => {
    const errors = validateIsolationProof({ ...cleanProof, egressSucceeded: true }, false)
    expect(errors.some(e => e.check === 'egress-blocked')).toBe(true)
  })

  it('fails if sink received the canary', () => {
    const errors = validateIsolationProof(cleanProof, true)
    expect(errors.some(e => e.check === 'sink-clean')).toBe(true)
  })

  it('fails if executor ran as root (uid 0)', () => {
    const errors = validateIsolationProof(
      { ...cleanProof, executorUid: 0, executorIsNonRoot: false },
      false,
    )
    expect(errors.some(e => e.check === 'non-root')).toBe(true)
  })

  it('fails if output path was not operational', () => {
    const errors = validateIsolationProof({ ...cleanProof, outputPathOperational: false }, false)
    expect(errors.some(e => e.check === 'output-path')).toBe(true)
  })

  it('accumulates multiple failures', () => {
    const errors = validateIsolationProof(
      {
        ...cleanProof,
        anthropicApiKeyPresent: true,
        egressSucceeded: true,
        executorIsNonRoot: false,
        executorUid: 0,
      },
      true,
    )
    expect(errors.length).toBeGreaterThanOrEqual(4)
  })
})

describe('buildCustomToolResult', () => {
  it('passes with clean proof and no sink hit', () => {
    const errors = validateIsolationProof(cleanProof, false)
    const result = buildCustomToolResult(cleanProof, false, errors)
    expect(result.passed).toBe(true)
    expect(result.credentialIsolationPassed).toBe(true)
    expect(result.egressBlocked).toBe(true)
    expect(result.outputValidated).toBe(true)
  })

  it('credentialIsolationPassed is false when any secret was present', () => {
    const dirtyProof = { ...cleanProof, anthropicApiKeyPresent: true }
    const errors = validateIsolationProof(dirtyProof, false)
    const result = buildCustomToolResult(dirtyProof, false, errors)
    expect(result.credentialIsolationPassed).toBe(false)
    expect(result.passed).toBe(false)
  })

  it('egressBlocked is false when sink received canary', () => {
    const errors = validateIsolationProof(cleanProof, true)
    const result = buildCustomToolResult(cleanProof, true, errors)
    expect(result.egressBlocked).toBe(false)
  })

  it('does not include raw secret values in result', () => {
    const result = buildCustomToolResult(cleanProof, false, [])
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('sk-ant')
    expect(serialized).not.toContain('POWERPLANT_WORKER_ONLY_VALUE')
    expect(serialized).not.toContain('POWERPLANT_EGRESS_CANARY')
  })
})

describe('buildIsolationProofReport', () => {
  const baseOpts = {
    runId: 'sprint3v-test',
    agentId: 'agt-test',
    environmentId: 'env-test',
    proof: cleanProof,
    sinkReceivedCanary: false,
    stdout: 'done',
    sessionId: 'sess-test',
    customToolUseCount: 1,
    builtinToolUseCount: 0,
    finalResponse: 'ISOLATED EXECUTOR PROBE COMPLETE',
    expectedFinalResponse: 'ISOLATED EXECUTOR PROBE COMPLETE',
  }

  it('builds a passing report for clean inputs', () => {
    const report = buildIsolationProofReport(baseOpts)
    expect(report.validation.passed).toBe(true)
    expect(report.validation.credentialIsolationPassed).toBe(true)
    expect(report.validation.egressBlocked).toBe(true)
    expect(report.validation.outputValidated).toBe(true)
    expect(report.validation.executorIsNonRoot).toBe(true)
    expect(report.validation.noSourceProjectMounted).toBe(true)
  })

  it('clearedForRealProjectMounting is always false', () => {
    const report = buildIsolationProofReport(baseOpts)
    expect(report.invariants.clearedForRealProjectMounting).toBe(false)
  })

  it('clearedForSanitizedExternalProjectInput is always false in sprint3v', () => {
    const report = buildIsolationProofReport(baseOpts)
    expect(report.invariants.clearedForSanitizedExternalProjectInput).toBe(false)
  })

  it('fails if any credential was present', () => {
    const report = buildIsolationProofReport({
      ...baseOpts,
      proof: { ...cleanProof, anthropicApiKeyPresent: true },
    })
    expect(report.validation.passed).toBe(false)
    expect(report.validation.credentialIsolationPassed).toBe(false)
  })

  it('fails if sink received canary', () => {
    const report = buildIsolationProofReport({ ...baseOpts, sinkReceivedCanary: true })
    expect(report.validation.passed).toBe(false)
    expect(report.validation.egressBlocked).toBe(false)
  })

  it('fails if executor ran as root', () => {
    const report = buildIsolationProofReport({
      ...baseOpts,
      proof: { ...cleanProof, executorUid: 0, executorIsNonRoot: false },
    })
    expect(report.validation.passed).toBe(false)
    expect(report.validation.executorIsNonRoot).toBe(false)
  })

  it('fails if built-in tool was used', () => {
    const report = buildIsolationProofReport({ ...baseOpts, builtinToolUseCount: 1 })
    expect(report.validation.passed).toBe(false)
  })

  it('fails if custom tool count is not exactly 1', () => {
    const report = buildIsolationProofReport({ ...baseOpts, customToolUseCount: 0 })
    expect(report.validation.passed).toBe(false)
  })

  it('fails if final response is wrong', () => {
    const report = buildIsolationProofReport({
      ...baseOpts,
      finalResponse: 'something else',
    })
    expect(report.validation.passed).toBe(false)
    expect(report.session.finalResponseCorrect).toBe(false)
  })

  it('report does not contain raw secret values', () => {
    const report = buildIsolationProofReport(baseOpts)
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('sk-ant')
    expect(serialized).not.toContain('POWERPLANT_WORKER_ONLY_VALUE')
  })

  it('sprintId is always sprint3v', () => {
    const report = buildIsolationProofReport(baseOpts)
    expect(report.sprintId).toBe('sprint3v')
  })
})
