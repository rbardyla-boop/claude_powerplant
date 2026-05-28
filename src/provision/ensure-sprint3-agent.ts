import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { SPRINT3_AGENT_NAME } from '../config/constants.js'
import { loadSprint3State, saveSprint3State } from '../platform/sprint3-state.js'
import { loadSelfHostedState } from '../platform/self-hosted-state.js'
import type { Sprint3Agent } from '../platform/sprint3-state.js'

export async function ensureSprint3Agent(client: Anthropic): Promise<{
  agent: Sprint3Agent
  environmentId: string
  reused: boolean
}> {
  const existing = loadSprint3State()
  if (existing?.agent.id) {
    console.log(`Reusing Sprint 3 agent: ${existing.agent.id} (version ${existing.agent.version})`)
    return { agent: existing.agent, environmentId: existing.environmentId, reused: true }
  }

  const hostState = loadSelfHostedState()
  if (!hostState?.environment.id) {
    throw new Error('No self-hosted environment found. Run npm run sprint2a:provision first.')
  }
  const environmentId = hostState.environment.id

  const systemPath = path.join(process.cwd(), 'power/agent/SPRINT3_PROJECT_PROBE_SYSTEM.md')
  const system = fs.readFileSync(systemPath, 'utf-8')

  console.log(`Creating Sprint 3 agent: ${SPRINT3_AGENT_NAME}`)
  const created = await client.beta.agents.create({
    name: SPRINT3_AGENT_NAME,
    model: 'claude-opus-4-7',
    system,
    tools: [
      {
        type: 'agent_toolset_20260401',
        default_config: { enabled: false },
        configs: [
          {
            name: 'bash',
            enabled: true,
            permission_policy: { type: 'always_allow' },
          },
          {
            name: 'write',
            enabled: true,
            permission_policy: { type: 'always_allow' },
          },
        ],
      },
    ],
  } as Parameters<typeof client.beta.agents.create>[0])

  const agent: Sprint3Agent = {
    id: created.id,
    version: Number(created.version),
    name: created.name,
  }

  saveSprint3State({ environmentId, agent, createdAt: new Date().toISOString() })
  console.log(`Sprint 3 agent created: ${agent.id}`)
  return { agent, environmentId, reused: false }
}
