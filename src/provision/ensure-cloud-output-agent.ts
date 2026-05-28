import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { OUTPUT_PROBE_AGENT_NAME } from '../config/constants.js'
import { loadState } from '../platform/managed-agent-state.js'
import {
  loadOutputProbeState,
  saveOutputProbeState,
} from '../platform/cloud-output-probe-state.js'
import type { AgentResource, EnvironmentResource } from '../platform/cloud-output-probe-state.js'

export async function ensureCloudOutputAgent(client: Anthropic): Promise<{
  agent: AgentResource
  environment: EnvironmentResource
  reused: boolean
}> {
  const existing = loadOutputProbeState()
  if (existing) {
    console.log(`Reusing output-probe agent: ${existing.agent.id} (version ${existing.agent.version})`)
    return { agent: existing.agent, environment: existing.environment, reused: true }
  }

  // Reuse the Sprint 1A environment
  const smokeState = loadState()
  if (!smokeState?.environment) {
    throw new Error(
      'Sprint 1A state not found — run npm run smoke:cloud first to provision the environment',
    )
  }
  const environment: EnvironmentResource = smokeState.environment

  const systemPath = path.join(process.cwd(), 'power/agent/OUTPUT_PROBE_SYSTEM.md')
  const system = fs.readFileSync(systemPath, 'utf-8')

  console.log(`Creating output-probe agent: ${OUTPUT_PROBE_AGENT_NAME}`)
  const created = await client.beta.agents.create({
    name: OUTPUT_PROBE_AGENT_NAME,
    model: 'claude-opus-4-7',
    system,
    tools: [
      {
        type: 'agent_toolset_20260401',
        default_config: { enabled: false },
        configs: [
          {
            name: 'write',
            enabled: true,
            permission_policy: { type: 'always_ask' },
          },
        ],
      },
    ],
  } as Parameters<typeof client.beta.agents.create>[0])

  const agent: AgentResource = {
    id: created.id,
    version: Number(created.version),
    name: created.name,
  }

  saveOutputProbeState({
    agent,
    environment,
    createdAt: new Date().toISOString(),
  })

  console.log(`Output-probe agent created: ${agent.id}`)
  return { agent, environment, reused: false }
}
