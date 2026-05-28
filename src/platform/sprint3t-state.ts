import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { SPRINT3T_STATE_PATH } from '../config/constants.js'

const AgentRefSchema = z.object({
  id: z.string().min(1),
  version: z.number(),
  name: z.string().min(1),
})

export const Sprint3tStateSchema = z.object({
  environmentId: z.string().min(1),
  agents: z.object({
    bashProbe: AgentRefSchema.optional(),
    writeProbe: AgentRefSchema.optional(),
  }),
  createdAt: z.string(),
})

export type Sprint3tState = z.infer<typeof Sprint3tStateSchema>

function statePath(): string {
  return path.join(process.cwd(), SPRINT3T_STATE_PATH)
}

export function loadSprint3tState(): Sprint3tState | null {
  const fp = statePath()
  if (!fs.existsSync(fp)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'))
    const result = Sprint3tStateSchema.safeParse(raw)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function saveSprint3tState(state: Sprint3tState): void {
  const fp = statePath()
  fs.mkdirSync(path.dirname(fp), { recursive: true })
  fs.writeFileSync(fp, JSON.stringify(state, null, 2), 'utf-8')
}
