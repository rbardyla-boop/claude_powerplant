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
} from '../config/constants.js'

export interface SdkApprovalAllowOptions {
  /** API-key client — used for control-plane operations only. */
  controlClient: Anthropic
  /** Environment key — passed to the SDK worker; must NOT be the API key. */
  environmentKey: string
  agentId: string
  agentVersion: number
  environmentId: string
  /** Per-probe workdir. Files written by bash appear here. */
  workdir: string
}

export async function runSdkApprovalAllowDiagnostic(
  opts: SdkApprovalAllowOptions,
): Promise<DiagnosticFinding> {
  const { controlClient, agentId, environmentId, workdir } = opts

  fs.mkdirSync(workdir, { recursive: true })

  // Pre-flight: queue must be fully drained before creating the session.
  await requireQueueDrained(controlClient, environmentId)
  console.log('[probe-a-allow] queue drained — creating session')

  const session = await controlClient.beta.sessions.create({
    agent: { type: 'agent', id: agentId, version: opts.agentVersion },
    environment_id: environmentId,
  } as Parameters<typeof controlClient.beta.sessions.create>[0])
  const sessionId = session.id
  console.log(`[probe-a-allow] session: ${sessionId}`)

  // Track which session the SDK worker claims.
  let claimedSessionId: string | undefined
  const workerAc = new AbortController()

  // Start SDK worker in background — uses env key, never API key.
  const workerPromise = runSdkIsolatedWorker({
    environmentKey: opts.environmentKey,
    environmentId,
    workdir,
    allowedTools: ['bash'],
    signal: workerAc.signal,
    onClaimed: (id) => {
      claimedSessionId = id
      console.log(`[probe-a-allow] worker claimed session: ${id}`)
    },
  }).catch(err => {
    if ((err as Error)?.name !== 'AbortError') throw err
  })

  // Orchestrator: stream events and post allow confirmation on requires_action.
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
      console.log(`[probe-a-allow] requires_action fired — tool: ${toolName}, posting allow`)
      return { result: 'allow' as const }
    },
  )

  // Session done — abort worker.
  workerAc.abort()
  await workerPromise

  // Verify session claim matches.
  const sessionMismatch = claimedSessionId !== undefined && claimedSessionId !== sessionId
  if (claimedSessionId !== undefined) {
    try {
      assertClaimedSessionMatches(claimedSessionId, sessionId)
    } catch {
      // Will be captured in evidence
    }
  }

  // Check output file.
  const outputPath = path.join(workdir, SPRINT3T_BASH_PROBE_FILENAME)
  const fileFound = fs.existsSync(outputPath)
  const contentMatched = fileFound
    ? fs.readFileSync(outputPath, 'utf-8').trimEnd() === SPRINT3T_BASH_PROBE_CANARY
    : false

  console.log(`[probe-a-allow] requiresActionFired: ${requiresActionFired}`)
  console.log(`[probe-a-allow] fileFound: ${fileFound}`)
  console.log(`[probe-a-allow] contentMatched: ${contentMatched}`)
  console.log(`[probe-a-allow] sessionMismatch: ${sessionMismatch}`)

  const conformant =
    requiresActionFired &&
    fileFound &&
    contentMatched &&
    !sessionMismatch

  let status: 'CONFORMANT' | 'ANOMALY' | 'INCONCLUSIVE'
  let summary: string

  if (conformant) {
    status = 'CONFORMANT'
    summary =
      'CONFORMANT — requires_action fired before confirmation; allow posted; bash executed; file present with correct content.'
  } else if (!requiresActionFired) {
    status = 'ANOMALY'
    summary = 'ANOMALY — requires_action did not fire; tool may have executed without confirmation gate.'
  } else if (sessionMismatch) {
    status = 'ANOMALY'
    summary = `ANOMALY — session mismatch: worker claimed ${claimedSessionId ?? 'unknown'} but expected ${sessionId}.`
  } else {
    status = 'INCONCLUSIVE'
    summary = `INCONCLUSIVE — requiresActionFired=${requiresActionFired}, fileFound=${fileFound}, contentMatched=${contentMatched}.`
  }

  return {
    probe: 'A',
    variant: 'sdk-allow',
    status,
    summary,
    evidence: {
      sessionId,
      claimedSessionId: claimedSessionId ?? null,
      requiresActionFired,
      toolName: toolName ?? null,
      confirmed: confirmResult.confirmed,
      fileFound,
      contentMatched,
      sessionMismatch,
      finalText: confirmResult.finalText,
    },
  }
}
