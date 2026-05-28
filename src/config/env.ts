import { z } from 'zod'

const envSchema = z.object({
  ANTHROPIC_API_KEY: z
    .string({ required_error: 'ANTHROPIC_API_KEY is required' })
    .min(1, 'ANTHROPIC_API_KEY is required'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CLAUDE_POWERPLANT_MAX_TURNS: z.coerce.number().int().positive().default(10),
  CLAUDE_POWERPLANT_MODEL_ID: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    const lines = result.error.issues
      .map(i => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Environment validation failed:\n${lines}`)
  }
  return result.data
}

const liveEnvSchema = z.object({
  ANTHROPIC_API_KEY: z
    .string({ required_error: 'ANTHROPIC_API_KEY is required for live runs' })
    .min(1, 'ANTHROPIC_API_KEY is required for live runs'),
  CLAUDE_POWERPLANT_MODEL_ID: z
    .string({ required_error: 'CLAUDE_POWERPLANT_MODEL_ID is required for live runs' })
    .min(1, 'CLAUDE_POWERPLANT_MODEL_ID is required for live runs'),
})

export type LiveEnv = z.infer<typeof liveEnvSchema>

export function validateLiveEnv(): LiveEnv {
  const result = liveEnvSchema.safeParse(process.env)
  if (!result.success) {
    const lines = result.error.issues
      .map(i => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Live environment validation failed:\n${lines}`)
  }
  return result.data
}

const sprint2aLiveEnvSchema = z.object({
  ANTHROPIC_API_KEY: z
    .string({ required_error: 'ANTHROPIC_API_KEY is required' })
    .min(1, 'ANTHROPIC_API_KEY is required'),
  ANTHROPIC_ENVIRONMENT_KEY: z
    .string({ required_error: 'ANTHROPIC_ENVIRONMENT_KEY is required for Sprint 2A' })
    .min(1, 'ANTHROPIC_ENVIRONMENT_KEY is required for Sprint 2A — generate it in the Anthropic Console'),
})

export type Sprint2aLiveEnv = z.infer<typeof sprint2aLiveEnvSchema>

export function validateSprint2aLiveEnv(): Sprint2aLiveEnv {
  const result = sprint2aLiveEnvSchema.safeParse(process.env)
  if (!result.success) {
    const lines = result.error.issues
      .map(i => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Sprint 2A environment validation failed:\n${lines}`)
  }
  return result.data
}

const sprint3tLiveEnvSchema = z.object({
  ANTHROPIC_API_KEY: z
    .string({ required_error: 'ANTHROPIC_API_KEY is required' })
    .min(1, 'ANTHROPIC_API_KEY is required'),
  ANTHROPIC_ENVIRONMENT_KEY: z
    .string({ required_error: 'ANTHROPIC_ENVIRONMENT_KEY is required for Sprint 3T' })
    .min(1, 'ANTHROPIC_ENVIRONMENT_KEY is required for Sprint 3T — generate it in the Anthropic Console'),
})

export type Sprint3tLiveEnv = z.infer<typeof sprint3tLiveEnvSchema>

export function validateSprint3tLiveEnv(): Sprint3tLiveEnv {
  const result = sprint3tLiveEnvSchema.safeParse(process.env)
  if (!result.success) {
    const lines = result.error.issues
      .map(i => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Sprint 3T environment validation failed:\n${lines}`)
  }
  return result.data
}

// Sprint 3U reuses the same env shape as Sprint 3T
export type Sprint3uLiveEnv = Sprint3tLiveEnv

export function validateSprint3uLiveEnv(): Sprint3uLiveEnv {
  const result = sprint3tLiveEnvSchema.safeParse(process.env)
  if (!result.success) {
    const lines = result.error.issues
      .map(i => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Sprint 3U environment validation failed:\n${lines}`)
  }
  return result.data
}

// Sprint 3V — custom-tool broker uses only the control-plane API key (cloud session, no env key)
const sprint3vLiveEnvSchema = z.object({
  ANTHROPIC_API_KEY: z
    .string({ required_error: 'ANTHROPIC_API_KEY is required' })
    .min(1, 'ANTHROPIC_API_KEY is required'),
})

export type Sprint3vLiveEnv = z.infer<typeof sprint3vLiveEnvSchema>

export function validateSprint3vLiveEnv(): Sprint3vLiveEnv {
  const result = sprint3vLiveEnvSchema.safeParse(process.env)
  if (!result.success) {
    const lines = result.error.issues
      .map(i => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Sprint 3V environment validation failed:\n${lines}`)
  }
  return result.data
}

// Sprint 4A reuses the same env shape as Sprint 3V (API key only — cloud session, no env key)
export type Sprint4aLiveEnv = Sprint3vLiveEnv

export function validateSprint4aLiveEnv(): Sprint4aLiveEnv {
  const result = sprint3vLiveEnvSchema.safeParse(process.env)
  if (!result.success) {
    const lines = result.error.issues
      .map(i => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Sprint 4A environment validation failed:\n${lines}`)
  }
  return result.data
}
