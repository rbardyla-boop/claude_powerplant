import { describe, expect, it } from 'vitest'
import { validateOutputFile } from '../src/outputs/validate-output-file.js'
import type { FileRecord } from '../src/outputs/validate-output-file.js'
import {
  OUTPUT_PROBE_EXPECTED_FILENAME,
  OUTPUT_PROBE_EXPECTED_CONTENT,
} from '../src/config/constants.js'

const validFile: FileRecord = {
  filename: OUTPUT_PROBE_EXPECTED_FILENAME,
  content: OUTPUT_PROBE_EXPECTED_CONTENT,
}

describe('validateOutputFile', () => {
  it('validates an exact expected file', () => {
    const result = validateOutputFile([validFile], OUTPUT_PROBE_EXPECTED_FILENAME, OUTPUT_PROBE_EXPECTED_CONTENT)
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('accepts content with a trailing newline', () => {
    const file: FileRecord = { ...validFile, content: OUTPUT_PROBE_EXPECTED_CONTENT + '\n' }
    const result = validateOutputFile([file], OUTPUT_PROBE_EXPECTED_FILENAME, OUTPUT_PROBE_EXPECTED_CONTENT)
    expect(result.valid).toBe(true)
  })

  it('rejects missing output (empty files array)', () => {
    const result = validateOutputFile([], OUTPUT_PROBE_EXPECTED_FILENAME, OUTPUT_PROBE_EXPECTED_CONTENT)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('No output files found')
  })

  it('rejects unexpected additional files', () => {
    const result = validateOutputFile(
      [validFile, { filename: 'extra.txt', content: 'extra' }],
      OUTPUT_PROBE_EXPECTED_FILENAME,
      OUTPUT_PROBE_EXPECTED_CONTENT,
    )
    expect(result.valid).toBe(false)
    expect(result.error).toContain('2')
  })

  it('rejects wrong filename', () => {
    const file: FileRecord = { ...validFile, filename: 'wrong.txt' }
    const result = validateOutputFile([file], OUTPUT_PROBE_EXPECTED_FILENAME, OUTPUT_PROBE_EXPECTED_CONTENT)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('wrong.txt')
  })

  it('rejects content mismatch', () => {
    const file: FileRecord = { ...validFile, content: 'WRONG CONTENT' }
    const result = validateOutputFile([file], OUTPUT_PROBE_EXPECTED_FILENAME, OUTPUT_PROBE_EXPECTED_CONTENT)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Content mismatch')
  })
})
