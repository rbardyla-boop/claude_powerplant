import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { SELF_HOSTED_PROBE_AGENT_NAME } from '../config/constants.js'
import {
  loadSelfHostedState,
  saveSelfHostedState,
} from '../platform/self-hosted-state.js'
import { ensureSelfHostedEnvironment } from './ensure-self-hosted-environment.js'
import type { SelfHostedAgent, SelfHostedEnvironment } from '../platform/self-hosted-state.js'

export async function ensureSelfHostedAgent(
  client: Anthropic,
  preloadedEnvironment?: SelfHostedEnvironment,
): Promise<{
  agent: SelfHostedAgent
  environmentId: string
  reused: boolean
}> {
  const existing = loadSelfHostedState()
  if (existing?.agent.id) {
    console.log(
      `Reusing self-hosted probe agent: ${existing.agent.id} (version ${existing.agent.version})`,
    )
    return {
      agent: existing.agent,
      environmentId: existing.environment.id,
      reused: true,
    }
  }

  const { environment } = preloadedEnvironment
    ? { environment: preloadedEnvironment }
    : await ensureSelfHostedEnvironment(client)

  const systemPath = path.join(process.cwd(), 'power/agent/SELF_HOSTED_PROBE_SYSTEM.md')
  const system = fs.readFileSync(systemPath, 'utf-8')

  console.log(`Creating self-hosted probe agent: ${SELF_HOSTED_PROBE_AGENT_NAME}`)
  const created = await client.beta.agents.create({
    name: SELF_HOSTED_PROBE_AGENT_NAME,
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
            permission_policy: { type: 'always_allow' },
          },
        ],
      },
    ],
  } as Parameters<typeof client.beta.agents.create>[0])

  const agent: SelfHostedAgent = {
    id: created.id,
    version: Number(created.version),
    name: created.name,
  }

  saveSelfHostedState({
    environment,
    agent,
    createdAt: new Date().toISOString(),
  })

  console.log(`Self-hosted probe agent created: ${agent.id}`)
  return { agent, environmentId: environment.id, reused: false }
}
