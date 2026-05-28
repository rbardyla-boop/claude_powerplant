import { z } from 'zod'
import { SPRINT3V_CUSTOM_TOOL_NAME, SPRINT3V_CUSTOM_TOOL_ACTION } from '../config/constants.js'

// ── Input schema ─────────────────────────────────────────────────────────────

export const ExecutorProbeActionSchema = z.enum([SPRINT3V_CUSTOM_TOOL_ACTION])

export const ExecutorProbeInputSchema = z.object({
  action: ExecutorProbeActionSchema,
})

export type ExecutorProbeInput = z.infer<typeof ExecutorProbeInputSchema>

export function validateExecutorProbeInput(input: unknown): ExecutorProbeInput {
  const result = ExecutorProbeInputSchema.safeParse(input)
  if (!result.success) {
    throw new Error(
      `Custom tool input rejected — invalid executor_probe input: ${result.error.message}`,
    )
  }
  return result.data
}

// ── Proof artifact schema (written by the executor container) ─────────────────

export const ExecutorProofSchema = z.object({
  anthropicApiKeyPresent: z.boolean(),
  anthropicEnvironmentKeyPresent: z.boolean(),
  workerSecretCanaryPresent: z.boolean(),
  egressAttempted: z.boolean(),
  egressSucceeded: z.boolean(),
  outputPathOperational: z.boolean(),
  executorUid: z.number().int(),
  executorIsNonRoot: z.boolean(),
})

export type ExecutorProof = z.infer<typeof ExecutorProofSchema>

// ── Bounded safe result returned to the agent ─────────────────────────────────

export const CustomToolResultSchema = z.object({
  passed: z.boolean(),
  credentialIsolationPassed: z.boolean(),
  egressBlocked: z.boolean(),
  outputValidated: z.boolean(),
})

export type CustomToolResult = z.infer<typeof CustomToolResultSchema>

// ── Guards used by broker ────────────────────────────────────────────────────

export function isKnownCustomToolName(name: string): name is typeof SPRINT3V_CUSTOM_TOOL_NAME {
  return name === SPRINT3V_CUSTOM_TOOL_NAME
}
