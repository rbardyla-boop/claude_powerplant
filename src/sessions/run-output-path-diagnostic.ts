import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { runContainerWorker } from '../worker/run-container-worker.js'
import { sessionWorkdir } from '../worker/spawn-container-session.js'
import { checkFileNow } from '../diagnostics/host-file-timing.js'
import { classifyOutputPathCompliance } from '../diagnostics/event-ordering.js'
import {
  SPRINT2B_CONTAINER_IMAGE,
  SPRINT3S_OUTPUT_ABSOLUTE_FILENAME,
  SPRINT3S_OUTPUT_RELATIVE_FILENAME,
  SPRINT3S_OUTPUT_PROBE_CANARY,
  SPRINT3S_OUTPUT_PROBE_FINAL_RESPONSE,
} from '../config/constants.js'
import type { DiagnosticFinding } from '../diagnostics/diagnostic-report.js'
import type { OutputPathComplianceResult } from '../diagnostics/event-ordering.js'

export interface OutputPathResult {
  sessionId: string
  outputsDirOnHost: string
  compliance: OutputPathComplianceResult
  finding: DiagnosticFinding
}

export async function runOutputPathDiagnostic(
  client: Anthropic,
  agentId: string,
  agentVersion: number,
  environmentId: string,
  workspacesDir: string,
  runtimeBase: string,
): Promise<OutputPathResult> {
  const runId = `sprint3s-c-${Date.now()}`

  // Create per-run outputs dir — this will be mounted at /mnt/session/outputs
  const outputsDirOnHost = path.join(runtimeBase, runId, 'outputs')
  fs.mkdirSync(outputsDirOnHost, { recursive: true })
  fs.chmodSync(outputsDirOnHost, 0o777)

  const session = await client.beta.sessions.create({
    agent: { type: 'agent', id: agentId, version: agentVersion },
    environment_id: environmentId,
    title: `sprint3s-probe-c-${Date.now()}`,
  })
  const sessionId = session.id
  console.log(`[probe-c] session: ${sessionId}`)

  // C1: absolute path to /mnt/session/outputs/WRITE_ABSOLUTE_PROBE.txt
  // C2: relative path WRITE_RELATIVE_PROBE.txt (will land in /workspace on the container side)
  const userMessage = [
    `Write the text "${SPRINT3S_OUTPUT_PROBE_CANARY}" to /mnt/session/outputs/${SPRINT3S_OUTPUT_ABSOLUTE_FILENAME}`,
    `Also write the text "${SPRINT3S_OUTPUT_PROBE_CANARY}" to ${SPRINT3S_OUTPUT_RELATIVE_FILENAME}`,
  ].join('\n')

  const workerCtrl = new AbortController()
  const workerDone = runContainerWorker({
    environmentKey: process.env['ANTHROPIC_ENVIRONMENT_KEY']!,
    workspacesDir,
    outputsDir: outputsDirOnHost,
    signal: workerCtrl.signal,
  }).catch(err => {
    if ((err as Error)?.name !== 'AbortError') {
      console.error(`[probe-c] worker error: ${(err as Error).message}`)
    }
  })

  await new Promise(r => setTimeout(r, 1500))

  const stream = await client.beta.sessions.events.stream(sessionId)
  await client.beta.sessions.events.send(sessionId, {
    events: [{ type: 'user.message', content: [{ type: 'text', text: userMessage }] }],
  })

  const toolUseEvents: { name: string; input: unknown; isError: boolean }[] = []
  let finalText = ''

  for await (const event of stream) {
    if (event.type === 'agent.message') {
      for (const block of event.content) {
        if (block.type === 'text') finalText += block.text
      }
    } else if (event.type === 'agent.tool_use') {
      const name = (event as unknown as { name: string }).name
      const input = (event as unknown as { input: unknown }).input
      const isError = Boolean((event as unknown as { is_error?: boolean }).is_error)
      toolUseEvents.push({ name, input, isError })
      console.log(`[probe-c] tool_use: ${name} is_error=${isError}`)
    } else if (event.type === 'session.status_idle') {
      if (event.stop_reason.type !== 'requires_action') break
    } else if (event.type === 'session.status_terminated') {
      break
    }
  }

  workerCtrl.abort()
  await workerDone

  const sessionDir = sessionWorkdir(sessionId, workspacesDir)

  // C1: check /mnt/session/outputs path (mounted outputsDirOnHost)
  const c1HostPath = path.join(outputsDirOnHost, SPRINT3S_OUTPUT_ABSOLUTE_FILENAME)
  const c1Record = checkFileNow(c1HostPath, 'c1-absolute-on-host')

  // C2: check relative write path (lands in session workdir on host)
  const c2HostPath = path.join(sessionDir, SPRINT3S_OUTPUT_RELATIVE_FILENAME)
  const c2Record = checkFileNow(c2HostPath, 'c2-relative-on-host')

  console.log(`[probe-c] C1 (absolute path) found on host: ${c1Record.existedAtMs !== null}`)
  console.log(`[probe-c] C2 (relative path) found on host: ${c2Record.existedAtMs !== null}`)

  // Determine write tool error state per probe
  const absoluteWriteEvent = toolUseEvents.find(
    tu => tu.name === 'write' &&
      String((tu.input as Record<string, unknown>)['file_path'] ?? '').includes('mnt/session')
  )
  const relativeWriteEvent = toolUseEvents.find(
    tu => tu.name === 'write' &&
      !String((tu.input as Record<string, unknown>)['file_path'] ?? '').includes('mnt/session')
  )

  const c1IsError = absoluteWriteEvent ? absoluteWriteEvent.isError : null
  const c2IsError = relativeWriteEvent ? relativeWriteEvent.isError : null

  const compliance = classifyOutputPathCompliance(
    c1IsError,
    c1Record.existedAtMs !== null,
    c2IsError,
    c2Record.existedAtMs !== null,
    null,
    false,
  )

  console.log(`[probe-c] compliance: ${compliance.summary}`)

  let status: DiagnosticFinding['status']
  if (compliance.c1AbsoluteWriteSucceeded && compliance.c1FileFoundOnHost) {
    status = 'CONFORMANT'
  } else if (compliance.c1AbsoluteWriteSucceeded === false) {
    status = 'ANOMALY'
  } else {
    status = 'INCONCLUSIVE'
  }

  const finding: DiagnosticFinding = {
    probe: 'C',
    variant: 'output-path',
    status,
    summary: compliance.summary,
    evidence: {
      sessionId,
      outputsDirOnHost,
      c1HostPath,
      c2HostPath,
      c1IsError,
      c2IsError,
      c1FileFoundOnHost: c1Record.existedAtMs !== null,
      c2FileFoundOnHost: c2Record.existedAtMs !== null,
      finalText: finalText.trim(),
      expectedFinalText: SPRINT3S_OUTPUT_PROBE_FINAL_RESPONSE,
    },
  }

  return { sessionId, outputsDirOnHost, compliance, finding }
}
