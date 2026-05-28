import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { SELF_HOSTED_STATE_PATH } from '../config/constants.js'

export const SelfHostedEnvironmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
})

export const SelfHostedAgentSchema = z.object({
  id: z.string().min(1),
  version: z.number(),
  name: z.string().min(1),
})

export const SelfHostedProbeStateSchema = z.object({
  environment: SelfHostedEnvironmentSchema,
  agent: SelfHostedAgentSchema,
  createdAt: z.string(),
})

export type SelfHostedEnvironment = z.infer<typeof SelfHostedEnvironmentSchema>
export type SelfHostedAgent = z.infer<typeof SelfHostedAgentSchema>
export type SelfHostedProbeState = z.infer<typeof SelfHostedProbeStateSchema>

function statePath(): string {
  return path.join(process.cwd(), SELF_HOSTED_STATE_PATH)
}

export function loadSelfHostedState(): SelfHostedProbeState | null {
  const fp = statePath()
  if (!fs.existsSync(fp)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'))
    const result = SelfHostedProbeStateSchema.safeParse(raw)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function saveSelfHostedState(state: SelfHostedProbeState): void {
  const fp = statePath()
  fs.mkdirSync(path.dirname(fp), { recursive: true })
  fs.writeFileSync(fp, JSON.stringify(state, null, 2), 'utf-8')
}
