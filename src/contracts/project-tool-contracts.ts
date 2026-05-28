import path from 'path'
import { z } from 'zod'
import {
  SPRINT4A_TOOL_LIST_FILES,
  SPRINT4A_TOOL_READ_FILE,
  SPRINT4A_TOOL_WRITE_FILE,
  SPRINT4A_TOOL_RUN_CHECK,
  SPRINT4A_TOOL_FINALIZE,
  SPRINT4A_MAX_CONTENT_LENGTH,
} from '../config/constants.js'
import { matchesGlob } from '../projects/build-sanitized-workspace.js'

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

// ── Path shape validation (schema level) ──────────────────────────────────────
// These checks validate format only — they do NOT enforce contract authorization.
// Authorization (is this path actually allowed?) is the broker's responsibility.

function isSafeRelativePath(p: string): boolean {
  if (!p) return false
  if (path.isAbsolute(p)) return false
  if (p.includes('..')) return false
  if (p.includes('\0')) return false
  return true
}

// ── Input schemas ─────────────────────────────────────────────────────────────

export const ListFilesInputSchema = z.object({}).strict()
export type ListFilesInput = z.infer<typeof ListFilesInputSchema>

export const ReadFileInputSchema = z.object({
  path: z.string().min(1).max(500).refine(isSafeRelativePath, {
    message: 'Path must be a safe relative path (no absolute paths or .. traversal)',
  }),
}).strict()
export type ReadFileInput = z.infer<typeof ReadFileInputSchema>

export const WriteFileInputSchema = z.object({
  path: z.string().min(1).max(500).refine(isSafeRelativePath, {
    message: 'Path must be a safe relative path (no absolute paths or .. traversal)',
  }),
  content: z.string().max(SPRINT4A_MAX_CONTENT_LENGTH),
}).strict()
export type WriteFileInput = z.infer<typeof WriteFileInputSchema>

// Check IDs are simple identifiers — spaces and shell metacharacters are rejected
// at the schema level because a valid check ID is never a shell command string.
export const RunCheckInputSchema = z.object({
  check: z.string().min(1).max(100).regex(
    /^[a-zA-Z][a-zA-Z0-9_-]*$/,
    'Check ID must start with a letter and contain only letters, digits, underscores, or hyphens',
  ),
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

// ── Check diagnostics (structured bounded payload returned to the agent) ──────

export const TestFailureEntrySchema = z.object({
  file: z.string().optional(),
  name: z.string().optional(),
  message: z.string().optional(),
  expected: z.string().optional(),
  received: z.string().optional(),
  location: z.string().optional(),
})
export type TestFailureEntry = z.infer<typeof TestFailureEntrySchema>

export const TypescriptErrorEntrySchema = z.object({
  file: z.string(),
  line: z.number().int(),
  col: z.number().int(),
  code: z.string(),
  message: z.string(),
})
export type TypescriptErrorEntry = z.infer<typeof TypescriptErrorEntrySchema>

export const RunCheckDiagnosticsSchema = z.object({
  runnerKind: z.enum(['test', 'typecheck']),
  verdict: z.string(),
  exitCode: z.number().nullable(),
  failingTests: z.array(TestFailureEntrySchema).optional(),
  typescriptErrors: z.array(TypescriptErrorEntrySchema).optional(),
  truncated: z.boolean(),
})
export type RunCheckDiagnostics = z.infer<typeof RunCheckDiagnosticsSchema>

export const RunCheckResultSchema = z.object({
  checkId: z.string(),
  passed: z.boolean(),
  exitCode: z.number().int(),
  summary: z.string(),
  diagnostics: RunCheckDiagnosticsSchema.optional(),
})
export type RunCheckResult = z.infer<typeof RunCheckResultSchema>

export const FinalizeResultSchema = z.object({
  patchPackagePath: z.string(),
  patchFiles: z.array(z.string()),
})
export type FinalizeResult = z.infer<typeof FinalizeResultSchema>

// ── Executor verification proof (written by container) ────────────────────────
// checkId and fixedAction are now generic strings — not literals — because
// different projects may declare different named checks.

export const PilotVerificationSchema = z.object({
  checkId: z.string(),
  fixedAction: z.string(),
  exitCode: z.number().int(),
  passed: z.boolean(),
})
export type PilotVerification = z.infer<typeof PilotVerificationSchema>

// ── Runtime path authorization (broker level) ─────────────────────────────────
// These functions check whether a validated path/check is authorized by the
// loaded project contract. They use the same matchesGlob used by the sanitizer,
// so glob patterns in POLICY.yaml are interpreted consistently.

export function isReadPathAuthorized(relPath: string, allowedReadPaths: string[]): boolean {
  return allowedReadPaths.some(pattern => matchesGlob(relPath, pattern))
}

export function isWritePathAuthorized(relPath: string, allowedWritePaths: string[]): boolean {
  return allowedWritePaths.some(pattern => matchesGlob(relPath, pattern))
}

export function isCheckAuthorized(
  checkId: string,
  allowedChecks: Record<string, { command: string }>,
): boolean {
  return Object.prototype.hasOwnProperty.call(allowedChecks, checkId)
}

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

// ── Run lifecycle classification ───────────────────────────────────────────────

/**
 * Terminal classification for a broker session.
 *
 * COMPLETED                    — agent called project_finalize; patch is eligible.
 * FAILED_INCOMPLETE_AGENT_RUN  — session ended without finalize.
 * FAILED_TOOL_BUDGET_EXHAUSTED — agent hit the custom-tool safety cap.
 */
export type RunTerminationReason =
  | 'COMPLETED'
  | 'FAILED_INCOMPLETE_AGENT_RUN'
  | 'FAILED_TOOL_BUDGET_EXHAUSTED'

export interface RunClassification {
  terminationReason: RunTerminationReason
  patchEligibleForApplication: boolean
  readCount: number
  writeCount: number
  checkCount: number
  finalizeAttempted: boolean
  artifactsComplete: boolean
  repeatedCheckFailures: boolean
  lastFailedDiagnostic?: RunCheckDiagnostics
}
