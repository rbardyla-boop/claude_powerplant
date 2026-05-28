import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import {
  SPRINT3S_WRITE_PROBE_CANARY,
  SPRINT3S_WRITE_PROBE_FILENAME,
  SPRINT3S_WRITE_PROBE_FINAL_RESPONSE,
} from '../config/constants.js'
import { sessionWorkdir } from '../worker/spawn-container-session.js'
import { checkFileNow } from '../diagnostics/host-file-timing.js'
import { classifyAlwaysAskConformance } from '../diagnostics/event-ordering.js'
import type { ObservedEvent, AlwaysAskConformanceResult } from '../diagnostics/event-ordering.js'
import type { DiagnosticFinding } from '../diagnostics/diagnostic-report.js'

export interface AntAlwaysAskResult {
  variant: 'allow' | 'deny'
  sessionId: string
  conformance: AlwaysAskConformanceResult
  finalText: string
  finding: DiagnosticFinding
}

export async function runAntAlwaysAskDiagnostic(
  client: Anthropic,
  agentId: string,
  agentVersion: number,
  environmentId: string,
  variant: 'allow' | 'deny',
  workspacesDir: string,
): Promise<AntAlwaysAskResult> {
  const session = await client.beta.sessions.create({
    agent: { type: 'agent', id: agentId, version: agentVersion },
    environment_id: environmentId,
    title: `sprint3s-probe-a-${variant}-${Date.now()}`,
  })
  const sessionId = session.id
  console.log(`[probe-a-${variant}] session: ${sessionId}`)

  const probeFilePath = path.join(sessionWorkdir(sessionId, workspacesDir), SPRINT3S_WRITE_PROBE_FILENAME)
  const userMessage = `Write the text "${SPRINT3S_WRITE_PROBE_CANARY}" to the file ${SPRINT3S_WRITE_PROBE_FILENAME}`

  const stream = await client.beta.sessions.events.stream(sessionId)
  await client.beta.sessions.events.send(sessionId, {
    events: [{ type: 'user.message', content: [{ type: 'text', text: userMessage }] }],
  })

  const observedEvents: ObservedEvent[] = []
  let finalText = ''
  let pendingToolUseId: string | null = null
  let confirmationPosted = false

  // Check file state before any confirmation
  let fileBeforeConfirmation = checkFileNow(probeFilePath, 'before-confirmation')

  for await (const event of stream) {
    const now = Date.now()
    if (event.type === 'agent.message') {
      for (const block of event.content) {
        if (block.type === 'text') finalText += block.text
      }
      observedEvents.push({ type: event.type, timestampMs: now })
    } else if (event.type === 'agent.tool_use') {
      const toolUseId = (event as unknown as { id: string }).id
      const toolName = (event as unknown as { name: string }).name
      pendingToolUseId = toolUseId
      observedEvents.push({ type: event.type, toolUseId, toolName, timestampMs: now })
      console.log(`[probe-a-${variant}] tool_use: ${toolName} (${toolUseId})`)
    } else if (event.type === 'session.status_idle') {
      const stopType = event.stop_reason.type
      observedEvents.push({ type: event.type, stopReasonType: stopType, timestampMs: now })
      console.log(`[probe-a-${variant}] status_idle stop_reason=${stopType}`)

      if (stopType === 'requires_action' && pendingToolUseId && !confirmationPosted) {
        // Check file existence RIGHT NOW — before sending any confirmation.
        // If tool already ran, file will exist here (anomaly).
        // If conformant, file will not exist yet.
        fileBeforeConfirmation = checkFileNow(probeFilePath, 'at-requires_action-before-confirmation')
        console.log(`[probe-a-${variant}] file at requires_action (before conf): ${fileBeforeConfirmation.existedAtMs !== null}`)

        // Post confirmation according to the variant being tested
        if (variant === 'allow') {
          await client.beta.sessions.events.send(sessionId, {
            events: [{
              type: 'user.tool_confirmation',
              tool_use_id: pendingToolUseId,
              result: 'allow',
            }] as Parameters<typeof client.beta.sessions.events.send>[1]['events'],
          })
          console.log(`[probe-a-${variant}] posted allow confirmation`)
        } else {
          await client.beta.sessions.events.send(sessionId, {
            events: [{
              type: 'user.tool_confirmation',
              tool_use_id: pendingToolUseId,
              result: 'deny',
              deny_message: 'Sprint 3S deny-path test: intentionally rejected.',
            }] as Parameters<typeof client.beta.sessions.events.send>[1]['events'],
          })
          console.log(`[probe-a-${variant}] posted deny confirmation`)
        }
        confirmationPosted = true
        // Continue streaming — session will continue after confirmation
      } else if (stopType !== 'requires_action') {
        break
      }
    } else if (event.type === 'session.status_terminated') {
      observedEvents.push({ type: event.type, timestampMs: now })
      break
    }
  }

  // Check file state after session
  const fileAfterCompletion = checkFileNow(probeFilePath, 'after-session')
  console.log(`[probe-a-${variant}] file after session: ${fileAfterCompletion.existedAtMs !== null}`)

  const conformance = classifyAlwaysAskConformance(
    observedEvents,
    fileBeforeConfirmation,
    variant === 'allow' ? fileAfterCompletion : null,
    variant === 'deny' ? fileAfterCompletion : null,
  )

  console.log(`[probe-a-${variant}] conformance: ${conformance.summary}`)

  let status: DiagnosticFinding['status']
  if (conformance.conformant) status = 'CONFORMANT'
  else if (conformance.anomaly) status = 'ANOMALY'
  else status = 'INCONCLUSIVE'

  const finding: DiagnosticFinding = {
    probe: 'A',
    variant,
    status,
    summary: conformance.summary,
    evidence: {
      sessionId,
      requiresActionBeforeConfirmation: conformance.requiresActionBeforeConfirmation,
      fileExistedBeforeConfirmation: conformance.fileExistedBeforeConfirmation,
      fileExistedAfterAllow: conformance.fileExistedAfterAllow,
      fileExistedAfterDeny: conformance.fileExistedAfterDeny,
      finalText: finalText.trim(),
      expectedFinalText: SPRINT3S_WRITE_PROBE_FINAL_RESPONSE,
      finalTextMatched: finalText.trim().includes(SPRINT3S_WRITE_PROBE_FINAL_RESPONSE),
      eventCount: observedEvents.length,
      confirmationPosted,
    },
  }

  return { variant, sessionId, conformance, finalText: finalText.trim(), finding }
}
