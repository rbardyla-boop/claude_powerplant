import { describe, it, expect } from 'vitest'
import {
  validateExecutorProbeInput,
  isKnownCustomToolName,
  ExecutorProofSchema,
} from '../src/contracts/custom-tool-contract.js'

describe('validateExecutorProbeInput', () => {
  it('accepts the single valid action', () => {
    const result = validateExecutorProbeInput({ action: 'verify_isolation_and_output' })
    expect(result.action).toBe('verify_isolation_and_output')
  })

  it('rejects a shell command string', () => {
    expect(() =>
      validateExecutorProbeInput({ action: 'rm -rf /' }),
    ).toThrow()
  })

  it('rejects an arbitrary path', () => {
    expect(() =>
      validateExecutorProbeInput({ action: '/etc/passwd' }),
    ).toThrow()
  })

  it('rejects free-form source code', () => {
    expect(() =>
      validateExecutorProbeInput({ action: 'console.log(process.env)' }),
    ).toThrow()
  })

  it('rejects an empty action', () => {
    expect(() =>
      validateExecutorProbeInput({ action: '' }),
    ).toThrow()
  })

  it('rejects an unrecognized action keyword', () => {
    expect(() =>
      validateExecutorProbeInput({ action: 'run_arbitrary_script' }),
    ).toThrow()
  })

  it('rejects missing action key', () => {
    expect(() =>
      validateExecutorProbeInput({}),
    ).toThrow()
  })

  it('rejects extra keys alongside valid action', () => {
    // Zod strips unknown keys by default but does not reject — extra keys are stripped
    // The call itself succeeds; the important thing is the returned value only has action
    const result = validateExecutorProbeInput({
      action: 'verify_isolation_and_output',
      shell: 'bash -c "id"',
    })
    expect(result.action).toBe('verify_isolation_and_output')
    expect('shell' in result).toBe(false)
  })

  it('rejects null input', () => {
    expect(() => validateExecutorProbeInput(null)).toThrow()
  })

  it('rejects a bare string input (not an object)', () => {
    expect(() =>
      validateExecutorProbeInput('verify_isolation_and_output'),
    ).toThrow()
  })
})

describe('isKnownCustomToolName', () => {
  it('returns true for executor_probe', () => {
    expect(isKnownCustomToolName('executor_probe')).toBe(true)
  })

  it('returns false for built-in tool names', () => {
    expect(isKnownCustomToolName('bash')).toBe(false)
    expect(isKnownCustomToolName('write')).toBe(false)
    expect(isKnownCustomToolName('read')).toBe(false)
    expect(isKnownCustomToolName('edit')).toBe(false)
  })

  it('returns false for arbitrary strings', () => {
    expect(isKnownCustomToolName('anything_else')).toBe(false)
    expect(isKnownCustomToolName('')).toBe(false)
  })
})

describe('ExecutorProofSchema', () => {
  const validProof = {
    anthropicApiKeyPresent: false,
    anthropicEnvironmentKeyPresent: false,
    workerSecretCanaryPresent: false,
    egressAttempted: true,
    egressSucceeded: false,
    outputPathOperational: true,
    executorUid: 1001,
    executorIsNonRoot: true,
  }

  it('accepts a valid proof artifact', () => {
    const result = ExecutorProofSchema.safeParse(validProof)
    expect(result.success).toBe(true)
  })

  it('rejects a proof with string booleans', () => {
    const result = ExecutorProofSchema.safeParse({ ...validProof, egressSucceeded: 'false' })
    expect(result.success).toBe(false)
  })

  it('rejects a proof missing a required field', () => {
    const { anthropicApiKeyPresent: _, ...partial } = validProof
    const result = ExecutorProofSchema.safeParse(partial)
    expect(result.success).toBe(false)
  })

  it('rejects a proof with a non-integer uid', () => {
    const result = ExecutorProofSchema.safeParse({ ...validProof, executorUid: 1001.5 })
    expect(result.success).toBe(false)
  })
})
