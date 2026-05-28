import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { SMOKE_AGENT_NAME } from '../config/constants.js'
import { loadState } from '../platform/managed-agent-state.js'
import type { AgentResource } from '../platform/managed-agent-state.js'

export async function ensureCloudAgent(
  client: Anthropic,
  model: string,
): Promise<{ agent: AgentResource; reused: boolean }> {
  const state = loadState()
  if (state?.agent) {
    console.log(`Reusing agent: ${state.agent.id} (version ${state.agent.version})`)
    return { agent: state.agent, reused: true }
  }

  const systemPath = path.join(process.cwd(), 'power/agent/SYSTEM.md')
  const system = fs.readFileSync(systemPath, 'utf-8')

  console.log(`Creating agent: ${SMOKE_AGENT_NAME}`)
  const created = await client.beta.agents.create({
    name: SMOKE_AGENT_NAME,
    model,
    system,
  })

  const agent: AgentResource = {
    id: created.id,
    version: Number(created.version),
    name: created.name,
  }

  return { agent, reused: false }
}
