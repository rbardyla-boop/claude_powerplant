import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { ensureCloudAgent } from '../provision/ensure-cloud-agent.js'
import { ensureCloudEnvironment } from '../provision/ensure-cloud-environment.js'
import { saveState } from '../platform/managed-agent-state.js'
import { assertSmokeTranscript } from '../platform/event-transcript.js'
import { SMOKE_EXPECTED_RESPONSE, SMOKE_REPORTS_DIR } from '../config/constants.js'
import type { SmokeTranscript } from '../platform/event-transcript.js'

export interface SmokeRunResult {
  sessionId: string
  reusedAgent: boolean
  reusedEnvironment: boolean
  agentId: string
  agentVersion: number
  environmentId: string
  responseText: string
  eventTypes: string[]
  toolUseCount: number
  completedIdle: boolean
  passed: boolean
  failureReason?: string
}

export async function runCloudLifecycleSmoke(
  client: Anthropic,
  modelId: string,
): Promise<SmokeRunResult> {
  // 1. Provision agent and environment
  const { agent, reused: reusedAgent } = await ensureCloudAgent(client, modelId)
  const { environment, reused: reusedEnvironment } = await ensureCloudEnvironment(client)

  // 2. Persist complete state after both resources are available
  saveState({
    agent,
    environment,
    createdAt: new Date().toISOString(),
  })

  // 3. Create session
  console.log(`Creating session...`)
  const session = await client.beta.sessions.create({
    agent: { type: 'agent', id: agent.id, version: agent.version },
    environment_id: environment.id,
    title: `sprint1a-smoke-${Date.now()}`,
  })
  console.log(`Session: ${session.id}`)
  console.log(`https://platform.claude.com/workspaces/default/sessions/${session.id}`)

  // 4. Collect events — stream-first, then send
  const transcript = await collectSessionTranscript(client, session.id)

  // 5. Assert
  const assertion = assertSmokeTranscript(transcript)

  const result: SmokeRunResult = {
    sessionId: session.id,
    reusedAgent,
    reusedEnvironment,
    agentId: agent.id,
    agentVersion: agent.version,
    environmentId: environment.id,
    responseText: transcript.agentMessageText,
    eventTypes: transcript.eventTypes,
    toolUseCount: transcript.toolUseCount,
    completedIdle: transcript.completedIdle,
    passed: assertion.passed,
    ...(assertion.reason !== undefined ? { failureReason: assertion.reason } : {}),
  }

  // 6. Write report
  writeReport(result)

  return result
}

async function collectSessionTranscript(
  client: Anthropic,
  sessionId: string,
): Promise<SmokeTranscript> {
  const eventTypes: string[] = []
  let agentMessageText = ''
  let toolUseCount = 0
  let completedIdle = false

  // Stream-first: open before sending so we don't miss early events
  const stream = await client.beta.sessions.events.stream(sessionId)

  await client.beta.sessions.events.send(sessionId, {
    events: [
      {
        type: 'user.message',
        content: [
          {
            type: 'text',
            text: `Reply with exactly this text and nothing else: ${SMOKE_EXPECTED_RESPONSE}`,
          },
        ],
      },
    ],
  })

  for await (const event of stream) {
    eventTypes.push(event.type)

    if (event.type === 'agent.message') {
      for (const block of event.content) {
        if (block.type === 'text') {
          agentMessageText += block.text
        }
      }
    } else if (
      event.type === 'agent.tool_use' ||
      event.type === 'agent.mcp_tool_use' ||
      event.type === 'agent.custom_tool_use'
    ) {
      toolUseCount += 1
    } else if (event.type === 'session.status_terminated') {
      break
    } else if (event.type === 'session.status_idle') {
      if (event.stop_reason.type === 'requires_action') continue
      completedIdle = true
      break
    }
  }

  return { sessionId, agentMessageText, eventTypes, toolUseCount, completedIdle }
}

function writeReport(result: SmokeRunResult): void {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = path.join(
    process.cwd(),
    SMOKE_REPORTS_DIR,
    `sprint1a-cloud-smoke-${ts}.json`,
  )
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  // Never write credentials — only IDs, booleans, text
  const report = {
    sessionId: result.sessionId,
    reusedAgent: result.reusedAgent,
    reusedEnvironment: result.reusedEnvironment,
    agentId: result.agentId,
    agentVersion: result.agentVersion,
    environmentId: result.environmentId,
    responseText: result.responseText,
    eventTypes: result.eventTypes,
    toolUseCount: result.toolUseCount,
    completedIdle: result.completedIdle,
    passed: result.passed,
    failureReason: result.failureReason,
    timestamp: new Date().toISOString(),
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')
  console.log(`Report written: ${reportPath}`)
}
