import { z } from 'zod'
import {
  SPRINT4A_TOOL_LIST_FILES,
  SPRINT4A_TOOL_READ_FILE,
  SPRINT4A_TOOL_WRITE_FILE,
  SPRINT4A_TOOL_RUN_CHECK,
  SPRINT4A_TOOL_FINALIZE,
  SPRINT4A_MAX_CONTENT_LENGTH,
} from '../config/constants.js'
import {
  PILOT_ALLOWED_READ_PATHS,
  PILOT_ALLOWED_WRITE_PATHS,
  PILOT_ALLOWED_CHECK_IDS,
} from './project-pilot-contract.js'

// ── Tool names ────────────────────────────────────────────────────────────────

export const PILOT_TOOL_NAMES = [
  SPRINT4A_TOOL_LIST_FILES,
  SPRINT4A_TOOL_READ_FILE,
  SPRINT4A_TOOL_WRITE_FILE,
  SPRINT4A_TOOL_RUN_CHECK,
  SPRINT4A_TOOL_FINALIZE,
] as const

export type PilotToolName = (typeof PILOT_TOOL_NAMES)[number]

export function isKnownPilotToolName(name: string): name is PilotToolName {
  return (PILOT_TOOL_NAMES as readonly string[]).includes(name)
}

// ── Input schemas ─────────────────────────────────────────────────────────────

export const ListFilesInputSchema = z.object({}).strict()
export type ListFilesInput = z.infer<typeof ListFilesInputSchema>

export const ReadFileInputSchema = z.object({
  path: z.enum(PILOT_ALLOWED_READ_PATHS),
}).strict()
export type ReadFileInput = z.infer<typeof ReadFileInputSchema>

export const WriteFileInputSchema = z.object({
  path: z.enum(PILOT_ALLOWED_WRITE_PATHS),
  content: z.string().max(SPRINT4A_MAX_CONTENT_LENGTH),
}).strict()
export type WriteFileInput = z.infer<typeof WriteFileInputSchema>

export const RunCheckInputSchema = z.object({
  check: z.enum(PILOT_ALLOWED_CHECK_IDS),
}).strict()
export type RunCheckInput = z.infer<typeof RunCheckInputSchema>

export const FinalizeInputSchema = z.object({
  summary: z.string().min(1).max(2000),
}).strict()
export type FinalizeInput = z.infer<typeof FinalizeInputSchema>

// ── Result schemas (returned to agent) ───────────────────────────────────────

export const ListFilesResultSchema = z.object({
  files: z.array(z.string()),
})
export type ListFilesResult = z.infer<typeof ListFilesResultSchema>

export const ReadFileResultSchema = z.object({
  path: z.string(),
  content: z.string(),
})
export type ReadFileResult = z.infer<typeof ReadFileResultSchema>

export const WriteFileResultSchema = z.object({
  path: z.string(),
  written: z.literal(true),
})
export type WriteFileResult = z.infer<typeof WriteFileResultSchema>

export const RunCheckResultSchema = z.object({
  checkId: z.string(),
  passed: z.boolean(),
  exitCode: z.number().int(),
  summary: z.string(),
})
export type RunCheckResult = z.infer<typeof RunCheckResultSchema>

export const FinalizeResultSchema = z.object({
  patchPackagePath: z.string(),
  patchFiles: z.array(z.string()),
})
export type FinalizeResult = z.infer<typeof FinalizeResultSchema>

// ── Executor verification proof (written by container) ────────────────────────

export const PilotVerificationSchema = z.object({
  checkId: z.literal('test'),
  fixedAction: z.literal('node --test'),
  exitCode: z.number().int(),
  passed: z.boolean(),
})
export type PilotVerification = z.infer<typeof PilotVerificationSchema>

// ── Dispatch helper ───────────────────────────────────────────────────────────

export function validateToolInput(
  toolName: PilotToolName,
  input: unknown,
): ListFilesInput | ReadFileInput | WriteFileInput | RunCheckInput | FinalizeInput {
  switch (toolName) {
    case SPRINT4A_TOOL_LIST_FILES:
      return parseOrThrow(ListFilesInputSchema, input, toolName)
    case SPRINT4A_TOOL_READ_FILE:
      return parseOrThrow(ReadFileInputSchema, input, toolName)
    case SPRINT4A_TOOL_WRITE_FILE:
      return parseOrThrow(WriteFileInputSchema, input, toolName)
    case SPRINT4A_TOOL_RUN_CHECK:
      return parseOrThrow(RunCheckInputSchema, input, toolName)
    case SPRINT4A_TOOL_FINALIZE:
      return parseOrThrow(FinalizeInputSchema, input, toolName)
  }
}

function parseOrThrow<T>(
  schema: z.ZodSchema<T>,
  input: unknown,
  toolName: string,
): T {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new Error(
      `Tool input rejected — ${toolName}: ${result.error.message}`,
    )
  }
  return result.data
}
