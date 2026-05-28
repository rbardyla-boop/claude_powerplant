import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { ensureCloudOutputAgent } from '../provision/ensure-cloud-output-agent.js'
import { runWithConfirmation } from '../approvals/confirmation-event-handler.js'
import { listSessionOutputs } from '../outputs/list-session-outputs.js'
import {
  OUTPUT_PROBE_EXPECTED_PATH,
  OUTPUT_PROBE_EXPECTED_CONTENT,
  OUTPUT_PROBE_DENY_REASON,
  SMOKE_REPORTS_DIR,
} from '../config/constants.js'

export interface DenyRunResult {
  sessionId: string
  agentId: string
  environmentId: string
  writeDenied: boolean
  noOutputVerified: boolean
  passed: boolean
  failureReason?: string
  timestamp: string
}

export async function runCloudOutputDenySmoke(client: Anthropic): Promise<DenyRunResult> {
  const { agent, environment } = await ensureCloudOutputAgent(client)

  console.log('Creating deny-path session...')
  const session = await client.beta.sessions.create({
    agent: { type: 'agent', id: agent.id, version: agent.version },
    environment_id: environment.id,
    title: `sprint1b-deny-${Date.now()}`,
  })
  console.log(`Session: ${session.id}`)

  const handlerResult = await runWithConfirmation(
    client,
    session.id,
    `Write the text "${OUTPUT_PROBE_EXPECTED_CONTENT}" to the path ${OUTPUT_PROBE_EXPECTED_PATH}`,
    _toolUseEvents => {
      // Unconditionally deny for the deny-path test
      console.log('  Policy: DENY (deny-path test)')
      return { result: 'deny', deny_message: OUTPUT_PROBE_DENY_REASON }
    },
  )

  const writeDenied = !handlerResult.confirmed

  let noOutputVerified = false
  let failureReason: string | undefined

  if (!writeDenied) {
    failureReason = 'Expected write to be denied but it was allowed'
  } else {
    const files = await listSessionOutputs(client, session.id)
    if (files.length === 0) {
      noOutputVerified = true
    } else {
      failureReason = `Expected no output files for deny session, found ${files.length}`
    }
  }

  const result: DenyRunResult = {
    sessionId: session.id,
    agentId: agent.id,
    environmentId: environment.id,
    writeDenied,
    noOutputVerified,
    passed: writeDenied && noOutputVerified,
    ...(failureReason !== undefined ? { failureReason } : {}),
    timestamp: new Date().toISOString(),
  }

  writeDenyReport(result)
  return result
}

function writeDenyReport(result: DenyRunResult): void {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = path.join(process.cwd(), SMOKE_REPORTS_DIR, `sprint1b-output-deny-${ts}.json`)
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf-8')
  console.log(`Deny report: ${reportPath}`)
}
