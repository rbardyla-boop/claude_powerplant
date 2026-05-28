import { z } from 'zod'

export const CheckVerdictSchema = z.enum([
  'PASS',
  'FAIL_CHECK',
  'BLOCKED_MISSING_TOOLING',
  'FAIL_BOUNDARY',
])
export type CheckVerdict = z.infer<typeof CheckVerdictSchema>

export const CheckResultSchema = z.object({
  checkId: z.string(),
  command: z.string(),
  verdict: CheckVerdictSchema,
  exitCode: z.number().int().nullable(),
  stdoutTail: z.string(),
  stderrTail: z.string(),
  detail: z.string().optional(),
})
export type CheckResult = z.infer<typeof CheckResultSchema>

export const OverallVerdictSchema = z.enum([
  'PASS',
  'FAIL_CHECK',
  'BLOCKED_MISSING_TOOLING',
  'FAIL_BOUNDARY',
])
export type OverallVerdict = z.infer<typeof OverallVerdictSchema>

export const VerificationReportSchema = z.object({
  verifiedAt: z.string(),
  projectId: z.string(),
  projectPath: z.string(),
  contractValid: z.literal(true),
  sanitizationPassed: z.boolean(),
  workspaceMode: z.literal('sanitized_copy_only'),
  originalProjectMounted: z.literal(false),
  liveAgentSession: z.literal(false),
  executorNetwork: z.literal('disabled'),
  checks: z.array(CheckResultSchema),
  verdict: OverallVerdictSchema,
  sourceProjectModified: z.boolean(),
})
export type VerificationReport = z.infer<typeof VerificationReportSchema>
