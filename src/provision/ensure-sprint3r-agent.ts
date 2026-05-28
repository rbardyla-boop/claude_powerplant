import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { SPRINT3R_AGENT_NAME } from '../config/constants.js'
import { loadSprint3rState, saveSprint3rState } from '../platform/sprint3-state.js'
import { loadSelfHostedState } from '../platform/self-hosted-state.js'
import type { Sprint3rState } from '../platform/sprint3-state.js'

export async function ensureSprint3rAgent(client: Anthropic): Promise<{
  agent: Sprint3rState['agent']
  environmentId: string
  reused: boolean
}> {
  const existing = loadSprint3rState()
  if (existing?.agent.id) {
    console.log(`Reusing Sprint 3R agent: ${existing.agent.id} (version ${existing.agent.version})`)
    return { agent: existing.agent, environmentId: existing.environmentId, reused: true }
  }

  const hostState = loadSelfHostedState()
  if (!hostState?.environment.id) {
    throw new Error('No self-hosted environment found. Run npm run sprint2a:provision first.')
  }
  const environmentId = hostState.environment.id

  const systemPath = path.join(process.cwd(), 'power/agent/SPRINT3R_BOUNDARY_PROBE_SYSTEM.md')
  const system = fs.readFileSync(systemPath, 'utf-8')

  console.log(`Creating Sprint 3R agent: ${SPRINT3R_AGENT_NAME}`)
  const created = await client.beta.agents.create({
    name: SPRINT3R_AGENT_NAME,
    model: 'claude-opus-4-7',
    system,
    tools: [
      {
        type: 'agent_toolset_20260401',
        default_config: { enabled: false },
        configs: [
          { name: 'bash', enabled: true, permission_policy: { type: 'always_allow' } },
          { name: 'write', enabled: true, permission_policy: { type: 'always_allow' } },
        ],
      },
    ],
  } as Parameters<typeof client.beta.agents.create>[0])

  const agent = {
    id: created.id,
    version: Number(created.version),
    name: created.name,
  }

  saveSprint3rState({ environmentId, agent, createdAt: new Date().toISOString() })
  console.log(`Sprint 3R agent created: ${agent.id}`)
  return { agent, environmentId, reused: false }
}
