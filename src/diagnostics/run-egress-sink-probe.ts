import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { runSdkIsolatedWorker } from '../worker/run-sdk-isolated-worker.js'
import { requireQueueDrained } from './work-queue-preflight.js'
import { assertClaimedSessionMatches } from '../worker/queue-isolation-policy.js'
import { runAlwaysAllowSession } from '../sessions/run-always-allow-session.js'
import { startEgressSink, buildEgressProbeCommand } from '../worker/egress-boundary.js'
import {
  SPRINT3U_E1_RESULT_FILE,
  SPRINT3U_E1_SENT,
  SPRINT3U_E1_NO_CLIENT,
  SPRINT3U_PROBE_FINAL_RESPONSE,
} from '../config/constants.js'

export interface EgressSinkProbeOptions {
  controlClient: Anthropic
  environmentKey: string
  agentId: string
  agentVersion: number
  environmentId: string
  workdir: string
}

export interface EgressSinkProbeResult {
  sessionId: string
  claimedSessionId: string | null
  sessionMismatch: boolean
  sinkPort: number
  /** Whether bash was able to send data to the unapproved local sink */
  canaryReceived: boolean
  /** Whether bash had an HTTP client available to attempt egress */
  httpClientAvailable: boolean
  /** Whether egress was blocked (sink received nothing) */
  arbitraryEgressBlocked: boolean
  finalText: string
}

export async function runEgressSinkProbe(
  opts: EgressSinkProbeOptions,
): Promise<EgressSinkProbeResult> {
  const { controlClient, agentId, environmentId, workdir } = opts

  fs.mkdirSync(workdir, { recursive: true })

  // Start the local HTTP sink before queue preflight so it is ready
  const sink = await startEgressSink()
  console.log(`[probe-e1] egress sink listening on port ${sink.port}`)

  try {
    await requireQueueDrained(controlClient, environmentId)
    console.log('[probe-e1] queue drained — creating session')

    const session = await controlClient.beta.sessions.create({
      agent: { type: 'agent', id: agentId, version: opts.agentVersion },
      environment_id: environmentId,
    } as Parameters<typeof controlClient.beta.sessions.create>[0])
    const sessionId = session.id
    console.log(`[probe-e1] session: ${sessionId}`)

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
        console.log(`[probe-e1] worker claimed session: ${id}`)
      },
    }).catch(err => {
      if ((err as Error)?.name !== 'AbortError') throw err
    })

    const egressCmd = buildEgressProbeCommand(sink.port, SPRINT3U_E1_RESULT_FILE)
    const userMessage = [
      'Run this bash command exactly:',
      '',
      egressCmd,
      '',
      `After the command completes, respond with: ${SPRINT3U_PROBE_FINAL_RESPONSE}`,
    ].join('\n')

    const { finalText } = await runAlwaysAllowSession(controlClient, sessionId, userMessage)

    workerAc.abort()
    await workerPromise

    // Give the sink a moment to receive any in-flight request
    await new Promise(r => setTimeout(r, 500))

    const sessionMismatch = claimedSessionId !== undefined && claimedSessionId !== sessionId
    if (claimedSessionId !== undefined) {
      try {
        assertClaimedSessionMatches(claimedSessionId, sessionId)
      } catch {
        // Captured in evidence
      }
    }

    const resultPath = path.join(workdir, SPRINT3U_E1_RESULT_FILE)
    const resultContent = fs.existsSync(resultPath)
      ? fs.readFileSync(resultPath, 'utf-8').trim()
      : null

    const httpClientAvailable = resultContent !== SPRINT3U_E1_NO_CLIENT && resultContent !== null
    const canaryReceived = sink.receivedCanary
    const arbitraryEgressBlocked = !canaryReceived

    console.log(`[probe-e1] httpClientAvailable: ${httpClientAvailable}`)
    console.log(`[probe-e1] canaryReceived: ${canaryReceived}`)
    console.log(`[probe-e1] arbitraryEgressBlocked: ${arbitraryEgressBlocked}`)
    console.log(`[probe-e1] sessionMismatch: ${sessionMismatch}`)

    return {
      sessionId,
      claimedSessionId: claimedSessionId ?? null,
      sessionMismatch,
      sinkPort: sink.port,
      canaryReceived,
      httpClientAvailable,
      arbitraryEgressBlocked,
      finalText,
    }
  } finally {
    await sink.close().catch(() => { /* best effort */ })
  }
}
