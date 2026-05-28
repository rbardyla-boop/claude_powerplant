import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import {
  SPRINT3S_PERMISSION_PROBE_AGENT_NAME,
  SPRINT3S_OUTPUT_PROBE_AGENT_NAME,
  SPRINT3S_BASH_PROBE_AGENT_NAME,
} from '../config/constants.js'
import { loadSprint3sState, saveSprint3sState } from '../platform/sprint3s-state.js'
import { loadSelfHostedState } from '../platform/self-hosted-state.js'
import type { Sprint3sState } from '../platform/sprint3s-state.js'

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

// Probe A — write-only, always_ask (tests confirmation gate conformance)
// Uses claude-haiku-4-5-20251001 to minimize cost during diagnostic runs
async function provisionPermissionProbeAgent(
  client: Anthropic,
  environmentId: string,
): Promise<Sprint3sState['agents']['permissionProbe']> {
  const system = readSystemPrompt('SPRINT3S_WRITE_PROBE_SYSTEM.md')
  const created = await client.beta.agents.create({
    name: SPRINT3S_PERMISSION_PROBE_AGENT_NAME,
    model: 'claude-haiku-4-5-20251001',
    system,
    tools: [
      {
        type: 'agent_toolset_20260401',
        default_config: { enabled: false },
        configs: [
          { name: 'write', enabled: true, permission_policy: { type: 'always_ask' } },
        ],
      },
    ],
  } as Parameters<typeof client.beta.agents.create>[0])
  return { id: created.id, version: Number(created.version), name: created.name }
}

// Probe C — write-only, always_allow (tests output path contract)
async function provisionOutputProbeAgent(
  client: Anthropic,
  environmentId: string,
): Promise<Sprint3sState['agents']['outputProbe']> {
  void environmentId
  const system = readSystemPrompt('SPRINT3S_OUTPUT_PROBE_SYSTEM.md')
  const created = await client.beta.agents.create({
    name: SPRINT3S_OUTPUT_PROBE_AGENT_NAME,
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

// Probe D — bash-only, always_allow (tests bash redirect to /mnt/session/outputs)
async function provisionBashProbeAgent(
  client: Anthropic,
  environmentId: string,
): Promise<Sprint3sState['agents']['bashProbe']> {
  void environmentId
  const system = readSystemPrompt('SPRINT3S_BASH_PROBE_SYSTEM.md')
  const created = await client.beta.agents.create({
    name: SPRINT3S_BASH_PROBE_AGENT_NAME,
    model: 'claude-haiku-4-5-20251001',
    system,
    tools: [
      {
        type: 'agent_toolset_20260401',
        default_config: { enabled: false },
        configs: [
          { name: 'bash', enabled: true, permission_policy: { type: 'always_allow' } },
        ],
      },
    ],
  } as Parameters<typeof client.beta.agents.create>[0])
  return { id: created.id, version: Number(created.version), name: created.name }
}

export async function ensureSprint3sAgents(client: Anthropic): Promise<Sprint3sState> {
  const environmentId = resolveEnvironmentId()
  const existing = loadSprint3sState()

  if (
    existing?.agents.permissionProbe &&
    existing.agents.outputProbe &&
    existing.agents.bashProbe
  ) {
    console.log('[sprint3s] reusing existing agents')
    return existing
  }

  console.log('[sprint3s] provisioning diagnostic agents...')
  const [permissionProbe, outputProbe, bashProbe] = await Promise.all([
    existing?.agents.permissionProbe
      ? Promise.resolve(existing.agents.permissionProbe)
      : provisionPermissionProbeAgent(client, environmentId),
    existing?.agents.outputProbe
      ? Promise.resolve(existing.agents.outputProbe)
      : provisionOutputProbeAgent(client, environmentId),
    existing?.agents.bashProbe
      ? Promise.resolve(existing.agents.bashProbe)
      : provisionBashProbeAgent(client, environmentId),
  ])

  console.log(`[sprint3s] permissionProbe: ${permissionProbe!.id}`)
  console.log(`[sprint3s] outputProbe: ${outputProbe!.id}`)
  console.log(`[sprint3s] bashProbe: ${bashProbe!.id}`)

  const state: Sprint3sState = {
    environmentId,
    agents: { permissionProbe, outputProbe, bashProbe },
    createdAt: new Date().toISOString(),
  }
  saveSprint3sState(state)
  return state
}
