import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { runSdkIsolatedWorker } from '../worker/run-sdk-isolated-worker.js'
import { requireQueueDrained } from '../diagnostics/work-queue-preflight.js'
import { assertClaimedSessionMatches } from '../worker/queue-isolation-policy.js'
import { runWithConfirmation } from '../approvals/confirmation-event-handler.js'
import type { DiagnosticFinding } from '../diagnostics/diagnostic-report.js'
import {
  SPRINT3T_BASH_PROBE_CANARY,
  SPRINT3T_BASH_PROBE_FILENAME,
  SPRINT3T_DENY_REASON,
} from '../config/constants.js'

export interface SdkApprovalDenyOptions {
  controlClient: Anthropic
  environmentKey: string
  agentId: string
  agentVersion: number
  environmentId: string
  workdir: string
}

export async function runSdkApprovalDenyDiagnostic(
  opts: SdkApprovalDenyOptions,
): Promise<DiagnosticFinding> {
  const { controlClient, agentId, environmentId, workdir } = opts

  fs.mkdirSync(workdir, { recursive: true })

  await requireQueueDrained(controlClient, environmentId)
  console.log('[probe-a-deny] queue drained — creating session')

  const session = await controlClient.beta.sessions.create({
    agent: { type: 'agent', id: agentId, version: opts.agentVersion },
    environment_id: environmentId,
  } as Parameters<typeof controlClient.beta.sessions.create>[0])
  const sessionId = session.id
  console.log(`[probe-a-deny] session: ${sessionId}`)

  let claimedSessionId: string | undefined
  const workerAc = new AbortController()

  const workerPromise = runSdkIsolatedWorker({
    environmentKey: opts.environmentKey,
    environmentId,
    workdir,
    allowedTools: ['bash'],
    signal: workerAc.signal,
    onClaimed: (id) => {
      claimedSessionId = id
      console.log(`[probe-a-deny] worker claimed session: ${id}`)
    },
  }).catch(err => {
    if ((err as Error)?.name !== 'AbortError') throw err
  })

  const userMessage =
    `Run this bash command exactly: ` +
    `printf '${SPRINT3T_BASH_PROBE_CANARY}' > ${SPRINT3T_BASH_PROBE_FILENAME} && echo "written"`

  let requiresActionFired = false
  let toolName: string | undefined

  const confirmResult = await runWithConfirmation(
    controlClient,
    sessionId,
    userMessage,
    (toolUseEvents) => {
      requiresActionFired = true
      toolName = toolUseEvents[0]?.name
      console.log(`[probe-a-deny] requires_action fired — tool: ${toolName}, posting deny`)
      return { result: 'deny' as const, deny_message: SPRINT3T_DENY_REASON }
    },
  )

  workerAc.abort()
  await workerPromise

  const sessionMismatch = claimedSessionId !== undefined && claimedSessionId !== sessionId
  if (claimedSessionId !== undefined) {
    try {
      assertClaimedSessionMatches(claimedSessionId, sessionId)
    } catch {
      // Captured in evidence
    }
  }

  // After deny: file must NOT be present.
  const outputPath = path.join(workdir, SPRINT3T_BASH_PROBE_FILENAME)
  const fileFound = fs.existsSync(outputPath)

  console.log(`[probe-a-deny] requiresActionFired: ${requiresActionFired}`)
  console.log(`[probe-a-deny] fileFound (expected false): ${fileFound}`)
  console.log(`[probe-a-deny] sessionMismatch: ${sessionMismatch}`)

  // Conformant deny: requires_action fired, confirmation posted (deny), file absent.
  const conformant =
    requiresActionFired &&
    !fileFound &&
    !sessionMismatch

  let status: 'CONFORMANT' | 'ANOMALY' | 'INCONCLUSIVE'
  let summary: string

  if (conformant) {
    status = 'CONFORMANT'
    summary = 'CONFORMANT — requires_action fired; deny posted; bash did not execute; file absent.'
  } else if (!requiresActionFired) {
    status = 'ANOMALY'
    summary = 'ANOMALY — requires_action did not fire; tool may have executed without confirmation gate.'
  } else if (fileFound) {
    status = 'ANOMALY'
    summary = 'ANOMALY — file present after deny; bash executed despite denial.'
  } else if (sessionMismatch) {
    status = 'ANOMALY'
    summary = `ANOMALY — session mismatch: worker claimed ${claimedSessionId ?? 'unknown'} but expected ${sessionId}.`
  } else {
    status = 'INCONCLUSIVE'
    summary = `INCONCLUSIVE — requiresActionFired=${requiresActionFired}, fileFound=${fileFound}.`
  }

  return {
    probe: 'B',
    variant: 'sdk-deny',
    status,
    summary,
    evidence: {
      sessionId,
      claimedSessionId: claimedSessionId ?? null,
      requiresActionFired,
      toolName: toolName ?? null,
      confirmed: confirmResult.confirmed,
      fileFound,
      sessionMismatch,
      finalText: confirmResult.finalText,
    },
  }
}
