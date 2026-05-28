import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { getPowerplantHome } from '../config/powerplant-home.js'

export const AgentResourceSchema = z.object({
  id: z.string().min(1),
  version: z.number(),
  name: z.string().min(1),
})

export const EnvironmentResourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
})

export const CloudSmokeStateSchema = z.object({
  agent: AgentResourceSchema,
  environment: EnvironmentResourceSchema,
  createdAt: z.string(),
})

export type AgentResource = z.infer<typeof AgentResourceSchema>
export type EnvironmentResource = z.infer<typeof EnvironmentResourceSchema>
export type CloudSmokeState = z.infer<typeof CloudSmokeStateSchema>

function statePath(): string {
  return path.join(getPowerplantHome(), 'state', 'cloud-smoke.json')
}

export function loadState(): CloudSmokeState | null {
  const fp = statePath()
  if (!fs.existsSync(fp)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'))
    const result = CloudSmokeStateSchema.safeParse(raw)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function saveState(state: CloudSmokeState): void {
  const fp = statePath()
  fs.mkdirSync(path.dirname(fp), { recursive: true })
  fs.writeFileSync(fp, JSON.stringify(state, null, 2), 'utf-8')
}
