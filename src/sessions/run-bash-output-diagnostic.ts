import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { runContainerWorker } from '../worker/run-container-worker.js'
import { checkFileNow } from '../diagnostics/host-file-timing.js'
import {
  SPRINT3S_BASH_PROBE_FILENAME,
  SPRINT3S_BASH_PROBE_CANARY,
  SPRINT3S_BASH_PROBE_FINAL_RESPONSE,
} from '../config/constants.js'
import type { DiagnosticFinding } from '../diagnostics/diagnostic-report.js'

export interface BashOutputResult {
  sessionId: string
  outputsDirOnHost: string
  bashSucceeded: boolean | null
  fileFoundOnHost: boolean
  fileContent: string | null
  contentMatched: boolean
  finalText: string
  finding: DiagnosticFinding
}

export async function runBashOutputDiagnostic(
  client: Anthropic,
  agentId: string,
  agentVersion: number,
  environmentId: string,
  workspacesDir: string,
  runtimeBase: string,
): Promise<BashOutputResult> {
  const runId = `sprint3s-d-${Date.now()}`

  // Create per-run outputs dir — mounted at /mnt/session/outputs inside the container
  const outputsDirOnHost = path.join(runtimeBase, runId, 'outputs')
  fs.mkdirSync(outputsDirOnHost, { recursive: true })
  fs.chmodSync(outputsDirOnHost, 0o777)

  const session = await client.beta.sessions.create({
    agent: { type: 'agent', id: agentId, version: agentVersion },
    environment_id: environmentId,
    title: `sprint3s-probe-d-${Date.now()}`,
  })
  const sessionId = session.id
  console.log(`[probe-d] session: ${sessionId}`)

  const bashCommand = `printf '%s' '${SPRINT3S_BASH_PROBE_CANARY}' > /mnt/session/outputs/${SPRINT3S_BASH_PROBE_FILENAME}`
  const userMessage = `Run bash: ${bashCommand}`

  const workerCtrl = new AbortController()
  const workerDone = runContainerWorker({
    environmentKey: process.env['ANTHROPIC_ENVIRONMENT_KEY']!,
    workspacesDir,
    outputsDir: outputsDirOnHost,
    signal: workerCtrl.signal,
  }).catch(err => {
    if ((err as Error)?.name !== 'AbortError') {
      console.error(`[probe-d] worker error: ${(err as Error).message}`)
    }
  })

  await new Promise(r => setTimeout(r, 1500))

  const stream = await client.beta.sessions.events.stream(sessionId)
  await client.beta.sessions.events.send(sessionId, {
    events: [{ type: 'user.message', content: [{ type: 'text', text: userMessage }] }],
  })

  let finalText = ''
  let bashIsError: boolean | null = null

  for await (const event of stream) {
    if (event.type === 'agent.message') {
      for (const block of event.content) {
        if (block.type === 'text') finalText += block.text
      }
    } else if (event.type === 'agent.tool_use') {
      const name = (event as unknown as { name: string }).name
      const isError = Boolean((event as unknown as { is_error?: boolean }).is_error)
      console.log(`[probe-d] tool_use: ${name} is_error=${isError}`)
      if (name === 'bash') bashIsError = isError
    } else if (event.type === 'session.status_idle') {
      if (event.stop_reason.type !== 'requires_action') break
    } else if (event.type === 'session.status_terminated') {
      break
    }
  }

  workerCtrl.abort()
  await workerDone

  const outputFilePath = path.join(outputsDirOnHost, SPRINT3S_BASH_PROBE_FILENAME)
  const record = checkFileNow(outputFilePath, 'bash-output-on-host')
  const fileFoundOnHost = record.existedAtMs !== null

  let fileContent: string | null = null
  let contentMatched = false
  if (fileFoundOnHost) {
    try {
      fileContent = fs.readFileSync(outputFilePath, 'utf-8').trim()
      contentMatched = fileContent === SPRINT3S_BASH_PROBE_CANARY
    } catch {
      fileContent = null
    }
  }

  const bashSucceeded = bashIsError === null ? null : !bashIsError

  console.log(`[probe-d] bash succeeded: ${bashSucceeded}`)
  console.log(`[probe-d] file found on host: ${fileFoundOnHost}`)
  console.log(`[probe-d] content matched: ${contentMatched}`)

  let status: DiagnosticFinding['status']
  if (bashSucceeded && fileFoundOnHost && contentMatched) {
    status = 'CONFORMANT'
  } else if (bashSucceeded === false || (bashSucceeded && !fileFoundOnHost)) {
    status = 'ANOMALY'
  } else {
    status = 'INCONCLUSIVE'
  }

  const summary = status === 'CONFORMANT'
    ? 'CONFORMANT — bash redirect to /mnt/session/outputs succeeded; file found on host.'
    : status === 'ANOMALY'
      ? `ANOMALY — bash succeeded=${bashSucceeded}, file on host=${fileFoundOnHost}, content matched=${contentMatched}`
      : 'INCONCLUSIVE — bash tool state unknown or file state ambiguous.'

  const finding: DiagnosticFinding = {
    probe: 'D',
    variant: 'bash-output',
    status,
    summary,
    evidence: {
      sessionId,
      outputsDirOnHost,
      outputFilePath,
      bashSucceeded,
      fileFoundOnHost,
      fileContent,
      contentMatched,
      finalText: finalText.trim(),
      expectedFinalText: SPRINT3S_BASH_PROBE_FINAL_RESPONSE,
    },
  }

  return {
    sessionId,
    outputsDirOnHost,
    bashSucceeded,
    fileFoundOnHost,
    fileContent,
    contentMatched,
    finalText: finalText.trim(),
    finding,
  }
}
