import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import {
  SPRINT3V_AGENT_NAME,
  SPRINT3V_CUSTOM_TOOL_NAME,
  SPRINT3V_CUSTOM_TOOL_ACTION,
} from '../config/constants.js'
import { loadSprint3vState, saveSprint3vState } from '../platform/sprint3v-state.js'
import { loadState } from '../platform/managed-agent-state.js'
import type { Sprint3vState } from '../platform/sprint3v-state.js'

function resolveEnvironmentId(): string {
  const smokeState = loadState()
  if (!smokeState?.environment?.id) {
    throw new Error(
      'Sprint 1A cloud environment not found. Run npm run smoke:cloud first.',
    )
  }
  return smokeState.environment.id
}

function readSystemPrompt(): string {
  return fs.readFileSync(
    path.join(process.cwd(), 'power/agent/ISOLATED_EXECUTOR_PROBE_SYSTEM.md'),
    'utf-8',
  )
}

async function provisionProbeAgent(
  client: Anthropic,
): Promise<NonNullable<Sprint3vState['agent']>> {
  const system = readSystemPrompt()
  const created = await client.beta.agents.create({
    name: SPRINT3V_AGENT_NAME,
    model: 'claude-haiku-4-5-20251001',
    system,
    tools: [
      {
        type: 'custom',
        name: SPRINT3V_CUSTOM_TOOL_NAME,
        description:
          'A diagnostic-only operation executed by the Powerplant application. It launches a ' +
          'fully isolated, credentialless executor container to verify that no worker credentials ' +
          'or inherited environment variables are visible, that arbitrary network egress is blocked, ' +
          'and that approved output can be written to the mounted output directory. Use it exactly ' +
          'once when instructed. It does not accept shell commands, paths, source code or free-form ' +
          'content.',
        input_schema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: [SPRINT3V_CUSTOM_TOOL_ACTION],
            },
          },
          required: ['action'],
        },
      },
    ],
  } as Parameters<typeof client.beta.agents.create>[0])
  return { id: created.id, version: Number(created.version), name: created.name }
}

export async function ensureSprint3vAgent(client: Anthropic): Promise<Sprint3vState> {
  const environmentId = resolveEnvironmentId()
  const existing = loadSprint3vState()

  if (existing?.agent) {
    console.log('[sprint3v] reusing existing agent:', existing.agent.id)
    return existing
  }

  console.log('[sprint3v] provisioning isolated executor probe agent...')
  const agent = await provisionProbeAgent(client)
  console.log('[sprint3v] agent:', agent.id)

  const state: Sprint3vState = {
    environmentId,
    agent,
    createdAt: new Date().toISOString(),
  }
  saveSprint3vState(state)
  return state
}
