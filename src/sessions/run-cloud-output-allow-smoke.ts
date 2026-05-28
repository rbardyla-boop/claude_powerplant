import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { ensureCloudOutputAgent } from '../provision/ensure-cloud-output-agent.js'
import { runWithConfirmation } from '../approvals/confirmation-event-handler.js'
import { evaluateWritePolicy } from '../approvals/tool-confirmation-policy.js'
import { listSessionOutputs } from '../outputs/list-session-outputs.js'
import { downloadSessionOutput } from '../outputs/download-session-output.js'
import { validateOutputFile } from '../outputs/validate-output-file.js'
import {
  OUTPUT_PROBE_EXPECTED_PATH,
  OUTPUT_PROBE_EXPECTED_FILENAME,
  OUTPUT_PROBE_EXPECTED_CONTENT,
  OUTPUT_PROBE_FINAL_RESPONSE,
  OUTPUT_PROBE_DENY_REASON,
  SMOKE_REPORTS_DIR,
} from '../config/constants.js'

export interface AllowRunResult {
  sessionId: string
  agentId: string
  environmentId: string
  writeApproved: boolean
  outputVerified: boolean
  filename: string
  content: string
  finalAgentText: string
  passed: boolean
  failureReason?: string
  timestamp: string
}

export async function runCloudOutputAllowSmoke(client: Anthropic): Promise<AllowRunResult> {
  const { agent, environment } = await ensureCloudOutputAgent(client)

  console.log('Creating allow-path session...')
  const session = await client.beta.sessions.create({
    agent: { type: 'agent', id: agent.id, version: agent.version },
    environment_id: environment.id,
    title: `sprint1b-allow-${Date.now()}`,
  })
  console.log(`Session: ${session.id}`)

  const handlerResult = await runWithConfirmation(
    client,
    session.id,
    `Write the text "${OUTPUT_PROBE_EXPECTED_CONTENT}" to the path ${OUTPUT_PROBE_EXPECTED_PATH}`,
    toolUseEvents => {
      const policy = evaluateWritePolicy(
        toolUseEvents,
        OUTPUT_PROBE_EXPECTED_PATH,
        OUTPUT_PROBE_EXPECTED_CONTENT,
      )
      if (policy.allowed) {
        console.log('  Policy: ALLOW write')
        return { result: 'allow' }
      }
      console.log(`  Policy: DENY — ${policy.reason}`)
      return { result: 'deny', deny_message: policy.reason ?? OUTPUT_PROBE_DENY_REASON }
    },
  )

  const writeApproved = handlerResult.confirmed
  const finalAgentText = handlerResult.finalText.trim()

  let outputVerified = false
  let filename = ''
  let content = ''
  let failureReason: string | undefined

  if (!writeApproved) {
    failureReason = 'Write was not approved'
  } else if (!finalAgentText.includes(OUTPUT_PROBE_FINAL_RESPONSE)) {
    failureReason = `Expected final response "${OUTPUT_PROBE_FINAL_RESPONSE}", got: "${finalAgentText}"`
  } else {
    const files = await listSessionOutputs(client, session.id)
    const fileRecords = await Promise.all(
      files.map(async f => ({
        filename: f.filename,
        content: await downloadSessionOutput(client, f.id),
      })),
    )

    const validation = validateOutputFile(
      fileRecords,
      OUTPUT_PROBE_EXPECTED_FILENAME,
      OUTPUT_PROBE_EXPECTED_CONTENT,
    )

    if (validation.valid) {
      outputVerified = true
      filename = fileRecords[0]!.filename
      content = fileRecords[0]!.content
    } else {
      failureReason = validation.error
    }
  }

  const result: AllowRunResult = {
    sessionId: session.id,
    agentId: agent.id,
    environmentId: environment.id,
    writeApproved,
    outputVerified,
    filename,
    content,
    finalAgentText,
    passed: writeApproved && outputVerified,
    ...(failureReason !== undefined ? { failureReason } : {}),
    timestamp: new Date().toISOString(),
  }

  writeAllowReport(result)
  return result
}

function writeAllowReport(result: AllowRunResult): void {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = path.join(process.cwd(), SMOKE_REPORTS_DIR, `sprint1b-output-allow-${ts}.json`)
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf-8')
  console.log(`Allow report: ${reportPath}`)
}
