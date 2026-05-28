import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { SPRINT3_STATE_PATH, SPRINT3R_STATE_PATH } from '../config/constants.js'

export const Sprint3AgentSchema = z.object({
  id: z.string().min(1),
  version: z.number(),
  name: z.string().min(1),
})

export const Sprint3StateSchema = z.object({
  environmentId: z.string().min(1),
  agent: Sprint3AgentSchema,
  createdAt: z.string(),
})

export type Sprint3Agent = z.infer<typeof Sprint3AgentSchema>
export type Sprint3State = z.infer<typeof Sprint3StateSchema>

function statePath(): string {
  return path.join(process.cwd(), SPRINT3_STATE_PATH)
}

export function loadSprint3State(): Sprint3State | null {
  const fp = statePath()
  if (!fs.existsSync(fp)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'))
    const result = Sprint3StateSchema.safeParse(raw)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function saveSprint3State(state: Sprint3State): void {
  const fp = statePath()
  fs.mkdirSync(path.dirname(fp), { recursive: true })
  fs.writeFileSync(fp, JSON.stringify(state, null, 2), 'utf-8')
}

// Sprint 3R — reuses the same agent/state shape
export const Sprint3rStateSchema = Sprint3StateSchema
export type Sprint3rState = Sprint3State

function sprint3rStatePath(): string {
  return path.join(process.cwd(), SPRINT3R_STATE_PATH)
}

export function loadSprint3rState(): Sprint3rState | null {
  const fp = sprint3rStatePath()
  if (!fs.existsSync(fp)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'))
    const result = Sprint3rStateSchema.safeParse(raw)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function saveSprint3rState(state: Sprint3rState): void {
  const fp = sprint3rStatePath()
  fs.mkdirSync(path.dirname(fp), { recursive: true })
  fs.writeFileSync(fp, JSON.stringify(state, null, 2), 'utf-8')
}
