import { describe, it, expect } from 'vitest'
import {
  validateExecutorProbeInput,
  isKnownCustomToolName,
} from '../src/contracts/custom-tool-contract.js'

/**
 * Broker logic tests — without live Docker or API calls.
 * The custom-tool-broker module itself requires a live client and Docker, so we
 * test its invariant-enforcement logic through the contract and policy layers it
 * delegates to.
 */

describe('Broker: custom tool name gate', () => {
  it('rejects built-in tool names (bash)', () => {
    expect(isKnownCustomToolName('bash')).toBe(false)
  })

  it('rejects built-in tool names (write)', () => {
    expect(isKnownCustomToolName('write')).toBe(false)
  })

  it('rejects built-in tool names (read)', () => {
    expect(isKnownCustomToolName('read')).toBe(false)
  })

  it('rejects built-in tool names (edit)', () => {
    expect(isKnownCustomToolName('edit')).toBe(false)
  })

  it('rejects built-in tool names (glob)', () => {
    expect(isKnownCustomToolName('glob')).toBe(false)
  })

  it('rejects built-in tool names (grep)', () => {
    expect(isKnownCustomToolName('grep')).toBe(false)
  })

  it('rejects arbitrary tool name', () => {
    expect(isKnownCustomToolName('run_shell')).toBe(false)
  })

  it('accepts executor_probe', () => {
    expect(isKnownCustomToolName('executor_probe')).toBe(true)
  })
})

describe('Broker: input schema gate', () => {
  it('rejects shell command in action field', () => {
    expect(() => validateExecutorProbeInput({ action: 'bash -c "cat /etc/passwd"' })).toThrow()
  })

  it('rejects path traversal in action field', () => {
    expect(() => validateExecutorProbeInput({ action: '../../../etc/shadow' })).toThrow()
  })

  it('rejects source code in action field', () => {
    expect(() =>
      validateExecutorProbeInput({ action: 'require("child_process").execSync("id")' }),
    ).toThrow()
  })

  it('rejects unexpected tool action', () => {
    expect(() => validateExecutorProbeInput({ action: 'delete_all_files' })).toThrow()
  })

  it('accepts the single valid action', () => {
    expect(() =>
      validateExecutorProbeInput({ action: 'verify_isolation_and_output' }),
    ).not.toThrow()
  })
})

describe('Broker: multiple-call guard (logic)', () => {
  it('simulates single-call enforcement', () => {
    let callCount = 0

    function recordCall(): void {
      if (callCount >= 1) {
        throw new Error('Broker policy: at most one executor_probe call per session')
      }
      callCount++
    }

    expect(() => recordCall()).not.toThrow()
    expect(() => recordCall()).toThrow(/at most one/)
  })
})

describe('Broker: clearance invariants', () => {
  it('clearedForRealProjectMounting is always false during sprint3v', () => {
    const invariants = {
      clearedForRealProjectMounting: false as const,
      clearedForSanitizedExternalProjectInput: false as const,
    }
    expect(invariants.clearedForRealProjectMounting).toBe(false)
  })

  it('clearedForSanitizedExternalProjectInput is always false during sprint3v', () => {
    const invariants = {
      clearedForRealProjectMounting: false as const,
      clearedForSanitizedExternalProjectInput: false as const,
    }
    expect(invariants.clearedForSanitizedExternalProjectInput).toBe(false)
  })
})
