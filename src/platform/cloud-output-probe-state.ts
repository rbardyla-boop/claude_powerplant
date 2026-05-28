import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { OUTPUT_PROBE_STATE_PATH } from '../config/constants.js'

export const AgentResourceSchema = z.object({
  id: z.string().min(1),
  version: z.number(),
  name: z.string().min(1),
})

export const EnvironmentResourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
})

export const CloudOutputProbeStateSchema = z.object({
  agent: AgentResourceSchema,
  environment: EnvironmentResourceSchema,
  createdAt: z.string(),
})

export type AgentResource = z.infer<typeof AgentResourceSchema>
export type EnvironmentResource = z.infer<typeof EnvironmentResourceSchema>
export type CloudOutputProbeState = z.infer<typeof CloudOutputProbeStateSchema>

function statePath(): string {
  return path.join(process.cwd(), OUTPUT_PROBE_STATE_PATH)
}

export function loadOutputProbeState(): CloudOutputProbeState | null {
  const fp = statePath()
  if (!fs.existsSync(fp)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'))
    const result = CloudOutputProbeStateSchema.safeParse(raw)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function saveOutputProbeState(state: CloudOutputProbeState): void {
  const fp = statePath()
  fs.mkdirSync(path.dirname(fp), { recursive: true })
  fs.writeFileSync(fp, JSON.stringify(state, null, 2), 'utf-8')
}
