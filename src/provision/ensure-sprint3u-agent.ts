import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { SPRINT3U_AGENT_NAME } from '../config/constants.js'
import { loadSprint3uState, saveSprint3uState } from '../platform/sprint3u-state.js'
import { loadSelfHostedState } from '../platform/self-hosted-state.js'
import type { Sprint3uState } from '../platform/sprint3u-state.js'

function resolveEnvironmentId(): string {
  const hostState = loadSelfHostedState()
  if (!hostState?.environment.id) {
    throw new Error('No self-hosted environment found. Run npm run sprint2a:provision first.')
  }
  return hostState.environment.id
}

function readSystemPrompt(): string {
  return fs.readFileSync(
    path.join(process.cwd(), 'power/agent/SPRINT3U_BOUNDARY_PROBE_SYSTEM.md'),
    'utf-8',
  )
}

// Boundary diagnostic agent — bash only, always_allow
// Uses claude-haiku-4-5-20251001 to minimise cost during diagnostic runs
async function provisionBoundaryAgent(client: Anthropic): Promise<NonNullable<Sprint3uState['agent']>> {
  const system = readSystemPrompt()
  const created = await client.beta.agents.create({
    name: SPRINT3U_AGENT_NAME,
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

export async function ensureSprint3uAgent(client: Anthropic): Promise<Sprint3uState> {
  const environmentId = resolveEnvironmentId()
  const existing = loadSprint3uState()

  if (existing?.agent) {
    console.log('[sprint3u] reusing existing agent:', existing.agent.id)
    return existing
  }

  console.log('[sprint3u] provisioning boundary diagnostic agent...')
  const agent = await provisionBoundaryAgent(client)
  console.log('[sprint3u] agent:', agent.id)

  const state: Sprint3uState = {
    environmentId,
    agent,
    createdAt: new Date().toISOString(),
  }
  saveSprint3uState(state)
  return state
}
