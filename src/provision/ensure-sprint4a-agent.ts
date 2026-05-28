import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
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
import { loadSprint4aState, saveSprint4aState } from '../platform/sprint4a-state.js'
import { loadState } from '../platform/managed-agent-state.js'
import type { Sprint4aState } from '../platform/sprint4a-state.js'

// Bump when tool schemas change — triggers re-provisioning of the Managed Agent.
// The schema version is stored in agent state so stale agents with old enum-based
// schemas are automatically replaced by the generic path-string schemas.
const TOOL_SCHEMA_VERSION = 2

function resolveEnvironmentId(): string {
  const smokeState = loadState()
  if (!smokeState?.environment?.id) {
    throw new Error(
      'Powerplant runtime is not set up. Run: powerplant setup',
    )
  }
  return smokeState.environment.id
}

function readSystemPrompt(): string {
  // Resolve relative to this source file so it works from any cwd.
  const __filename = fileURLToPath(import.meta.url)
  const pkgRoot = path.resolve(path.dirname(__filename), '..', '..', '..')
  return fs.readFileSync(
    path.join(pkgRoot, 'power', 'agent', 'SANITIZED_PROJECT_PILOT_SYSTEM.md'),
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
          'Only paths authorized by the project contract may be requested. ' +
          'The broker enforces authorization — the schema validates shape only.',
        input_schema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              maxLength: 500,
              description: 'Relative path to the file (no absolute paths, no .. traversal)',
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
          'Only paths in the contract allowedWritePaths may be written. ' +
          'The broker enforces authorization. Do not write credentials or ' +
          'content containing POWERPLANT_FORBIDDEN.',
        input_schema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              maxLength: 500,
              description: 'Relative path to the file (must be in allowedWritePaths)',
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
          'Run a named verification check inside the isolated executor. ' +
          'Only check IDs declared in the project VERIFY.yaml are permitted. ' +
          'You may not supply a shell command string — pass the check ID only. ' +
          'The broker maps the check ID to its fixed command.',
        input_schema: {
          type: 'object',
          properties: {
            check: {
              type: 'string',
              maxLength: 100,
              description: 'Named check ID from the project VERIFY.yaml (e.g. "test")',
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

  // Re-provision if the agent exists but was created with an older tool schema version.
  // Schema version 1 used enum arrays; version 2 uses generic strings + broker auth.
  const existingSchemaVersion = existing?.toolSchemaVersion ?? 1
  if (existing?.agent && existingSchemaVersion >= TOOL_SCHEMA_VERSION) {
    console.log('[sprint4a] reusing existing agent:', existing.agent.id)
    return existing
  }

  if (existing?.agent) {
    console.log(
      `[sprint4a] agent schema version ${existingSchemaVersion} < ${TOOL_SCHEMA_VERSION} — re-provisioning with generic schemas`,
    )
  } else {
    console.log('[sprint4a] provisioning sanitized project pilot agent...')
  }

  const agent = await provisionPilotAgent(client)
  console.log('[sprint4a] agent:', agent.id)

  const state: Sprint4aState = {
    environmentId,
    agent,
    toolSchemaVersion: TOOL_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
  }
  saveSprint4aState(state)
  return state
}
