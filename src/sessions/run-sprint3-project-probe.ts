import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { ensureSprint3Agent } from '../provision/ensure-sprint3-agent.js'
import {
  SPRINT3_PROBE_FILENAME,
  SPRINT3_PROBE_EXPECTED_CONTENT,
  SPRINT3_PROBE_FINAL_RESPONSE,
  SPRINT3_WORKDIR,
  SMOKE_REPORTS_DIR,
} from '../config/constants.js'
import { sessionWorkdir } from '../worker/spawn-container-session.js'

export interface Sprint3ProbeResult {
  sessionId: string
  agentId: string
  environmentId: string
  fileWritten: boolean
  fileContent: string
  finalAgentText: string
  passed: boolean
  failureReason?: string
  timestamp: string
}

export async function runSprint3ProjectProbe(
  client: Anthropic,
): Promise<Sprint3ProbeResult> {
  const { agent, environmentId } = await ensureSprint3Agent(client)

  console.log('Creating Sprint 3 session...')
  const session = await client.beta.sessions.create({
    agent: { type: 'agent', id: agent.id, version: agent.version },
    environment_id: environmentId,
    title: `sprint3-probe-${Date.now()}`,
  })
  console.log(`Session: ${session.id}`)

  // Stream-first: open stream before sending message so no events are lost
  const stream = await client.beta.sessions.events.stream(session.id)

  await client.beta.sessions.events.send(session.id, {
    events: [
      {
        type: 'user.message',
        content: [
          {
            type: 'text',
            text: 'Read the project token file and write it to the workspace.',
          },
        ],
      },
    ],
  })

  let finalAgentText = ''
  for await (const event of stream) {
    if (event.type === 'agent.message') {
      for (const block of event.content) {
        if (block.type === 'text') {
          finalAgentText += block.text
        }
      }
    } else if (event.type === 'session.status_idle') {
      // requires_action: agent made tool calls and is waiting for results — container is still working
      if (event.stop_reason.type !== 'requires_action') {
        break
      }
    } else if (event.type === 'session.status_terminated') {
      break
    }
  }

  finalAgentText = finalAgentText.trim()

  let fileWritten = false
  let fileContent = ''
  let failureReason: string | undefined

  const probeFilePath = path.join(
    sessionWorkdir(session.id, path.join(process.cwd(), SPRINT3_WORKDIR)),
    SPRINT3_PROBE_FILENAME,
  )

  if (fs.existsSync(probeFilePath)) {
    fileContent = fs.readFileSync(probeFilePath, 'utf-8').trim()
    fileWritten = fileContent === SPRINT3_PROBE_EXPECTED_CONTENT
    if (!fileWritten) {
      failureReason = `File content mismatch. Expected: "${SPRINT3_PROBE_EXPECTED_CONTENT}", got: "${fileContent}"`
    }
  } else {
    failureReason = `Probe file not found at ${probeFilePath}`
  }

  if (fileWritten && !finalAgentText.includes(SPRINT3_PROBE_FINAL_RESPONSE)) {
    failureReason = `Expected final response "${SPRINT3_PROBE_FINAL_RESPONSE}", got: "${finalAgentText}"`
    fileWritten = false
  }

  const result: Sprint3ProbeResult = {
    sessionId: session.id,
    agentId: agent.id,
    environmentId,
    fileWritten,
    fileContent,
    finalAgentText,
    passed: fileWritten,
    ...(failureReason !== undefined ? { failureReason } : {}),
    timestamp: new Date().toISOString(),
  }

  writeProbeReport(result)
  return result
}

function writeProbeReport(result: Sprint3ProbeResult): void {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = path.join(
    process.cwd(),
    SMOKE_REPORTS_DIR,
    `sprint3-project-probe-${ts}.json`,
  )
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf-8')
  console.log(`Probe report: ${reportPath}`)
}
