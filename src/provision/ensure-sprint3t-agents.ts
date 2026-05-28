import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import {
  SPRINT3T_BASH_PROBE_AGENT_NAME,
  SPRINT3T_WRITE_PROBE_AGENT_NAME,
} from '../config/constants.js'
import { loadSprint3tState, saveSprint3tState } from '../platform/sprint3t-state.js'
import { loadSelfHostedState } from '../platform/self-hosted-state.js'
import type { Sprint3tState } from '../platform/sprint3t-state.js'

function resolveEnvironmentId(): string {
  const hostState = loadSelfHostedState()
  if (!hostState?.environment.id) {
    throw new Error('No self-hosted environment found. Run npm run sprint2a:provision first.')
  }
  return hostState.environment.id
}

function readSystemPrompt(filename: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'power/agent', filename), 'utf-8')
}

// Bash probe agent — always_ask (tests SDK always_ask confirmation gate for Probes A + B)
// Uses claude-haiku-4-5-20251001 to minimise cost during diagnostic runs
async function provisionBashProbeAgent(
  client: Anthropic,
): Promise<Sprint3tState['agents']['bashProbe']> {
  const system = readSystemPrompt('SPRINT3T_BASH_PROBE_SYSTEM.md')
  const created = await client.beta.agents.create({
    name: SPRINT3T_BASH_PROBE_AGENT_NAME,
    model: 'claude-haiku-4-5-20251001',
    system,
    tools: [
      {
        type: 'agent_toolset_20260401',
        default_config: { enabled: false },
        configs: [
          { name: 'bash', enabled: true, permission_policy: { type: 'always_ask' } },
        ],
      },
    ],
  } as Parameters<typeof client.beta.agents.create>[0])
  return { id: created.id, version: Number(created.version), name: created.name }
}

// Write probe agent — always_allow (tests write tool path contract for Probe C)
async function provisionWriteProbeAgent(
  client: Anthropic,
): Promise<Sprint3tState['agents']['writeProbe']> {
  const system = readSystemPrompt('SPRINT3T_WRITE_PROBE_SYSTEM.md')
  const created = await client.beta.agents.create({
    name: SPRINT3T_WRITE_PROBE_AGENT_NAME,
    model: 'claude-haiku-4-5-20251001',
    system,
    tools: [
      {
        type: 'agent_toolset_20260401',
        default_config: { enabled: false },
        configs: [
          { name: 'write', enabled: true, permission_policy: { type: 'always_allow' } },
        ],
      },
    ],
  } as Parameters<typeof client.beta.agents.create>[0])
  return { id: created.id, version: Number(created.version), name: created.name }
}

export async function ensureSprint3tAgents(client: Anthropic): Promise<Sprint3tState> {
  const environmentId = resolveEnvironmentId()
  const existing = loadSprint3tState()

  if (existing?.agents.bashProbe && existing.agents.writeProbe) {
    console.log('[sprint3t] reusing existing agents')
    return existing
  }

  console.log('[sprint3t] provisioning diagnostic agents...')
  const [bashProbe, writeProbe] = await Promise.all([
    existing?.agents.bashProbe
      ? Promise.resolve(existing.agents.bashProbe)
      : provisionBashProbeAgent(client),
    existing?.agents.writeProbe
      ? Promise.resolve(existing.agents.writeProbe)
      : provisionWriteProbeAgent(client),
  ])

  console.log(`[sprint3t] bashProbe: ${bashProbe!.id}`)
  console.log(`[sprint3t] writeProbe: ${writeProbe!.id}`)

  const state: Sprint3tState = {
    environmentId,
    agents: { bashProbe, writeProbe },
    createdAt: new Date().toISOString(),
  }
  saveSprint3tState(state)
  return state
}
