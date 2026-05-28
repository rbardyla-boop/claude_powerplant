import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { SPRINT3S_STATE_PATH } from '../config/constants.js'

const AgentRefSchema = z.object({
  id: z.string().min(1),
  version: z.number(),
  name: z.string().min(1),
})

export const Sprint3sStateSchema = z.object({
  environmentId: z.string().min(1),
  agents: z.object({
    permissionProbe: AgentRefSchema.optional(),
    outputProbe: AgentRefSchema.optional(),
    bashProbe: AgentRefSchema.optional(),
  }),
  createdAt: z.string(),
})

export type Sprint3sState = z.infer<typeof Sprint3sStateSchema>

function statePath(): string {
  return path.join(process.cwd(), SPRINT3S_STATE_PATH)
}

export function loadSprint3sState(): Sprint3sState | null {
  const fp = statePath()
  if (!fs.existsSync(fp)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'))
    const result = Sprint3sStateSchema.safeParse(raw)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function saveSprint3sState(state: Sprint3sState): void {
  const fp = statePath()
  fs.mkdirSync(path.dirname(fp), { recursive: true })
  fs.writeFileSync(fp, JSON.stringify(state, null, 2), 'utf-8')
}
