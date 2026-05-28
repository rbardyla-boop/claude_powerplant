import { describe, expect, it } from 'vitest'
import { evaluateWritePolicy } from '../src/approvals/tool-confirmation-policy.js'
import type { PendingToolUse } from '../src/approvals/tool-confirmation-policy.js'
import {
  OUTPUT_PROBE_EXPECTED_PATH,
  OUTPUT_PROBE_EXPECTED_CONTENT,
} from '../src/config/constants.js'

const validToolUse: PendingToolUse = {
  id: 'sevt_abc123',
  name: 'write',
  input: {
    file_path: OUTPUT_PROBE_EXPECTED_PATH,
    content: OUTPUT_PROBE_EXPECTED_CONTENT,
  },
}

describe('evaluateWritePolicy', () => {
  it('allows an exact permitted write request', () => {
    const result = evaluateWritePolicy([validToolUse], OUTPUT_PROBE_EXPECTED_PATH, OUTPUT_PROBE_EXPECTED_CONTENT)
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('allows content with a trailing newline', () => {
    const tu: PendingToolUse = {
      ...validToolUse,
      input: { file_path: OUTPUT_PROBE_EXPECTED_PATH, content: OUTPUT_PROBE_EXPECTED_CONTENT + '\n' },
    }
    const result = evaluateWritePolicy([tu], OUTPUT_PROBE_EXPECTED_PATH, OUTPUT_PROBE_EXPECTED_CONTENT)
    expect(result.allowed).toBe(true)
  })

  it('denies missing file_path (undefined)', () => {
    const tu: PendingToolUse = {
      ...validToolUse,
      input: { content: OUTPUT_PROBE_EXPECTED_CONTENT },
    }
    const result = evaluateWritePolicy([tu], OUTPUT_PROBE_EXPECTED_PATH, OUTPUT_PROBE_EXPECTED_CONTENT)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Missing file_path')
  })

  it('denies legacy { path, content } payload (wrong field name)', () => {
    const tu: PendingToolUse = {
      ...validToolUse,
      input: { path: OUTPUT_PROBE_EXPECTED_PATH, content: OUTPUT_PROBE_EXPECTED_CONTENT },
    }
    const result = evaluateWritePolicy([tu], OUTPUT_PROBE_EXPECTED_PATH, OUTPUT_PROBE_EXPECTED_CONTENT)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Missing file_path')
  })

  it('denies wrong output path', () => {
    const tu: PendingToolUse = {
      ...validToolUse,
      input: { file_path: '/mnt/session/outputs/OTHER.txt', content: OUTPUT_PROBE_EXPECTED_CONTENT },
    }
    const result = evaluateWritePolicy([tu], OUTPUT_PROBE_EXPECTED_PATH, OUTPUT_PROBE_EXPECTED_CONTENT)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('/mnt/session/outputs/OTHER.txt')
  })

  it('denies wrong file contents', () => {
    const tu: PendingToolUse = {
      ...validToolUse,
      input: { file_path: OUTPUT_PROBE_EXPECTED_PATH, content: 'WRONG CONTENT' },
    }
    const result = evaluateWritePolicy([tu], OUTPUT_PROBE_EXPECTED_PATH, OUTPUT_PROBE_EXPECTED_CONTENT)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Content mismatch')
  })

  it('denies any non-write tool', () => {
    const tu: PendingToolUse = { ...validToolUse, name: 'bash' }
    const result = evaluateWritePolicy([tu], OUTPUT_PROBE_EXPECTED_PATH, OUTPUT_PROBE_EXPECTED_CONTENT)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('bash')
  })

  it('denies more than one tool-use event', () => {
    const result = evaluateWritePolicy(
      [validToolUse, validToolUse],
      OUTPUT_PROBE_EXPECTED_PATH,
      OUTPUT_PROBE_EXPECTED_CONTENT,
    )
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('2')
  })

  it('denies zero tool-use events', () => {
    const result = evaluateWritePolicy([], OUTPUT_PROBE_EXPECTED_PATH, OUTPUT_PROBE_EXPECTED_CONTENT)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('0')
  })
})
