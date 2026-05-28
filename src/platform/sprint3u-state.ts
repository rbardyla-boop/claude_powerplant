import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { SPRINT3U_STATE_PATH } from '../config/constants.js'

const AgentRefSchema = z.object({
  id: z.string().min(1),
  version: z.number(),
  name: z.string().min(1),
})

export const Sprint3uStateSchema = z.object({
  environmentId: z.string().min(1),
  agent: AgentRefSchema.optional(),
  createdAt: z.string(),
})

export type Sprint3uState = z.infer<typeof Sprint3uStateSchema>

function statePath(): string {
  return path.join(process.cwd(), SPRINT3U_STATE_PATH)
}

export function loadSprint3uState(): Sprint3uState | null {
  const fp = statePath()
  if (!fs.existsSync(fp)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'))
    const result = Sprint3uStateSchema.safeParse(raw)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function saveSprint3uState(state: Sprint3uState): void {
  const fp = statePath()
  fs.mkdirSync(path.dirname(fp), { recursive: true })
  fs.writeFileSync(fp, JSON.stringify(state, null, 2), 'utf-8')
}
