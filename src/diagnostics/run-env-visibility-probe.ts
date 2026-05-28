import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { runSdkIsolatedWorker } from '../worker/run-sdk-isolated-worker.js'
import { requireQueueDrained } from './work-queue-preflight.js'
import { assertClaimedSessionMatches } from '../worker/queue-isolation-policy.js'
import { runAlwaysAllowSession } from '../sessions/run-always-allow-session.js'
import {
  classifyCredentialBoundary,
  parseKeyPresence,
  type CredentialBoundaryResult,
  type KeyPresence,
} from '../worker/credential-boundary.js'
import {
  SPRINT3U_K1_RESULT_FILE,
  SPRINT3U_K2_RESULT_FILE,
  SPRINT3U_K3_RESULT_FILE,
  SPRINT3U_K1_PRESENT,
  SPRINT3U_K1_ABSENT,
  SPRINT3U_K2_PRESENT,
  SPRINT3U_K2_ABSENT,
  SPRINT3U_K3_PRESENT,
  SPRINT3U_K3_ABSENT,
  SPRINT3U_WORKER_CANARY_KEY,
  SPRINT3U_WORKER_CANARY_VALUE,
  SPRINT3U_PROBE_FINAL_RESPONSE,
} from '../config/constants.js'

export interface EnvVisibilityProbeOptions {
  controlClient: Anthropic
  environmentKey: string
  agentId: string
  agentVersion: number
  environmentId: string
  workdir: string
}

export interface EnvVisibilityResult {
  sessionId: string
  claimedSessionId: string | null
  sessionMismatch: boolean
  k1: KeyPresence
  k2: KeyPresence
  k3: KeyPresence
  credentialBoundary: CredentialBoundaryResult
  finalText: string
}

// Fixed bash commands — orchestrator-authored, not model-selected
function buildEnvVisibilityMessage(workdir: string): string {
  return [
    'Run these bash commands in order. Each writes its result to a file.',
    '',
    `1. if [ -n "\${ANTHROPIC_API_KEY+x}" ]; then printf '${SPRINT3U_K1_PRESENT}' > '${SPRINT3U_K1_RESULT_FILE}'; else printf '${SPRINT3U_K1_ABSENT}' > '${SPRINT3U_K1_RESULT_FILE}'; fi && printf 'K1 done\\n'`,
    '',
    `2. if [ -n "\${${SPRINT3U_WORKER_CANARY_KEY}+x}" ]; then printf '${SPRINT3U_K2_PRESENT}' > '${SPRINT3U_K2_RESULT_FILE}'; else printf '${SPRINT3U_K2_ABSENT}' > '${SPRINT3U_K2_RESULT_FILE}'; fi && printf 'K2 done\\n'`,
    '',
    `3. if [ -n "\${ANTHROPIC_ENVIRONMENT_KEY+x}" ]; then printf '${SPRINT3U_K3_PRESENT}' > '${SPRINT3U_K3_RESULT_FILE}'; else printf '${SPRINT3U_K3_ABSENT}' > '${SPRINT3U_K3_RESULT_FILE}'; fi && printf 'K3 done\\n'`,
    '',
    `After all three complete, respond with: ${SPRINT3U_PROBE_FINAL_RESPONSE}`,
  ].join('\n')
}

export async function runEnvVisibilityProbe(
  opts: EnvVisibilityProbeOptions,
): Promise<EnvVisibilityResult> {
  const { controlClient, agentId, environmentId, workdir } = opts

  fs.mkdirSync(workdir, { recursive: true })

  await requireQueueDrained(controlClient, environmentId)
  console.log('[probe-k] queue drained — creating session')

  const session = await controlClient.beta.sessions.create({
    agent: { type: 'agent', id: agentId, version: opts.agentVersion },
    environment_id: environmentId,
  } as Parameters<typeof controlClient.beta.sessions.create>[0])
  const sessionId = session.id
  console.log(`[probe-k] session: ${sessionId}`)

  let claimedSessionId: string | undefined
  const workerAc = new AbortController()

  // Set the worker canary in process.env so the bash subprocess inherits it
  const previousCanaryValue = process.env[SPRINT3U_WORKER_CANARY_KEY]
  process.env[SPRINT3U_WORKER_CANARY_KEY] = SPRINT3U_WORKER_CANARY_VALUE

  const workerPromise = runSdkIsolatedWorker({
    environmentKey: opts.environmentKey,
    environmentId,
    workdir,
    allowedTools: ['bash'],
    signal: workerAc.signal,
    onClaimed: (id) => {
      claimedSessionId = id
      console.log(`[probe-k] worker claimed session: ${id}`)
    },
  }).catch(err => {
    if ((err as Error)?.name !== 'AbortError') throw err
  })

  const userMessage = buildEnvVisibilityMessage(workdir)
  const { finalText } = await runAlwaysAllowSession(controlClient, sessionId, userMessage)

  workerAc.abort()
  await workerPromise

  // Restore process.env
  if (previousCanaryValue === undefined) {
    delete process.env[SPRINT3U_WORKER_CANARY_KEY]
  } else {
    process.env[SPRINT3U_WORKER_CANARY_KEY] = previousCanaryValue
  }

  const sessionMismatch = claimedSessionId !== undefined && claimedSessionId !== sessionId
  if (claimedSessionId !== undefined) {
    try {
      assertClaimedSessionMatches(claimedSessionId, sessionId)
    } catch {
      // Captured in evidence
    }
  }

  // Read result files — never read env var values directly
  function readResult(filename: string): string | null {
    const p = path.join(workdir, filename)
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null
  }

  const k1 = parseKeyPresence(readResult(SPRINT3U_K1_RESULT_FILE))
  const k2 = parseKeyPresence(readResult(SPRINT3U_K2_RESULT_FILE))
  const k3 = parseKeyPresence(readResult(SPRINT3U_K3_RESULT_FILE))

  const credentialBoundary = classifyCredentialBoundary(k1, k2, k3)

  console.log(`[probe-k] K1 (ANTHROPIC_API_KEY): ${k1}`)
  console.log(`[probe-k] K2 (worker canary): ${k2}`)
  console.log(`[probe-k] K3 (ANTHROPIC_ENVIRONMENT_KEY): ${k3}`)
  console.log(`[probe-k] credentialBoundaryPassed: ${credentialBoundary.credentialBoundaryPassed}`)
  console.log(`[probe-k] sessionMismatch: ${sessionMismatch}`)

  return {
    sessionId,
    claimedSessionId: claimedSessionId ?? null,
    sessionMismatch,
    k1,
    k2,
    k3,
    credentialBoundary,
    finalText,
  }
}
