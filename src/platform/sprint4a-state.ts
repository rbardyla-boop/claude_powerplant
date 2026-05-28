import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { SPRINT4A_STATE_PATH } from '../config/constants.js'

const AgentRefSchema = z.object({
  id: z.string().min(1),
  version: z.number(),
  name: z.string().min(1),
})

export const Sprint4aStateSchema = z.object({
  environmentId: z.string().min(1),
  agent: AgentRefSchema.optional(),
  createdAt: z.string(),
})

export type Sprint4aState = z.infer<typeof Sprint4aStateSchema>

function statePath(): string {
  return path.join(process.cwd(), SPRINT4A_STATE_PATH)
}

export function loadSprint4aState(): Sprint4aState | null {
  const fp = statePath()
  if (!fs.existsSync(fp)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'))
    const result = Sprint4aStateSchema.safeParse(raw)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function saveSprint4aState(state: Sprint4aState): void {
  const fp = statePath()
  fs.mkdirSync(path.dirname(fp), { recursive: true })
  fs.writeFileSync(fp, JSON.stringify(state, null, 2), 'utf-8')
}
