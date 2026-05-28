import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import {
  SPRINT4A_AGENT_NAME,
  SPRINT4A_PILOT_MODEL,
  SPRINT4A_TOOL_LIST_FILES,
  SPRINT4A_TOOL_READ_FILE,
  SPRINT4A_TOOL_WRITE_FILE,
  SPRINT4A_TOOL_RUN_CHECK,
  SPRINT4A_TOOL_FINALIZE,
  SPRINT4A_MAX_CONTENT_LENGTH,
} from '../config/constants.js'
import {
  PILOT_ALLOWED_READ_PATHS,
  PILOT_ALLOWED_WRITE_PATHS,
  PILOT_ALLOWED_CHECK_IDS,
} from '../contracts/project-pilot-contract.js'
import { loadSprint4aState, saveSprint4aState } from '../platform/sprint4a-state.js'
import { loadState } from '../platform/managed-agent-state.js'
import type { Sprint4aState } from '../platform/sprint4a-state.js'

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
    path.join(process.cwd(), 'power/agent/SANITIZED_PROJECT_PILOT_SYSTEM.md'),
    'utf-8',
  )
}

async function provisionPilotAgent(
  client: Anthropic,
): Promise<NonNullable<Sprint4aState['agent']>> {
  const system = readSystemPrompt()
  const created = await client.beta.agents.create({
    name: SPRINT4A_AGENT_NAME,
    model: SPRINT4A_PILOT_MODEL,
    system,
    tools: [
      {
        type: 'custom',
        name: SPRINT4A_TOOL_LIST_FILES,
        description:
          'List all files available in the sanitized project workspace. ' +
          'Returns only files that entered the sanitized snapshot.',
        input_schema: {
          type: 'object',
          properties: {},
        },
      },
      {
        type: 'custom',
        name: SPRINT4A_TOOL_READ_FILE,
        description:
          'Read one permitted file from the sanitized project workspace. ' +
          'Only allowlisted paths may be requested.',
        input_schema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              enum: PILOT_ALLOWED_READ_PATHS,
            },
          },
          required: ['path'],
        },
      },
      {
        type: 'custom',
        name: SPRINT4A_TOOL_WRITE_FILE,
        description:
          'Write one permitted file in the disposable project workspace. ' +
          'Only src/status.js and tests/status.test.js may be written. ' +
          'Do not include source mutation permission, secret strings, or forbidden markers.',
        input_schema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              enum: PILOT_ALLOWED_WRITE_PATHS,
            },
            content: {
              type: 'string',
              maxLength: SPRINT4A_MAX_CONTENT_LENGTH,
            },
          },
          required: ['path', 'content'],
        },
      },
      {
        type: 'custom',
        name: SPRINT4A_TOOL_RUN_CHECK,
        description:
          'Run the approved verification check inside the isolated executor. ' +
          'Only the named check ID "test" is permitted. ' +
          'The broker maps "test" to the fixed action "node --test". ' +
          'You may not supply a shell command string.',
        input_schema: {
          type: 'object',
          properties: {
            check: {
              type: 'string',
              enum: PILOT_ALLOWED_CHECK_IDS,
            },
          },
          required: ['check'],
        },
      },
      {
        type: 'custom',
        name: SPRINT4A_TOOL_FINALIZE,
        description:
          'Ask the broker to generate the patch and evidence package. ' +
          'Only succeeds after the test check has passed. ' +
          'Does not apply the patch to the original project.',
        input_schema: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              maxLength: 2000,
            },
          },
          required: ['summary'],
        },
      },
    ],
  } as Parameters<typeof client.beta.agents.create>[0])

  return { id: created.id, version: Number(created.version), name: created.name }
}

export async function ensureSprint4aAgent(client: Anthropic): Promise<Sprint4aState> {
  const environmentId = resolveEnvironmentId()
  const existing = loadSprint4aState()

  if (existing?.agent) {
    console.log('[sprint4a] reusing existing agent:', existing.agent.id)
    return existing
  }

  console.log('[sprint4a] provisioning sanitized project pilot agent...')
  const agent = await provisionPilotAgent(client)
  console.log('[sprint4a] agent:', agent.id)

  const state: Sprint4aState = {
    environmentId,
    agent,
    createdAt: new Date().toISOString(),
  }
  saveSprint4aState(state)
  return state
}
