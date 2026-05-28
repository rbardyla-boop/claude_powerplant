import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { runSdkIsolatedWorker } from '../worker/run-sdk-isolated-worker.js'
import { requireQueueDrained } from './work-queue-preflight.js'
import { assertClaimedSessionMatches } from '../worker/queue-isolation-policy.js'
import { runAlwaysAllowSession } from '../sessions/run-always-allow-session.js'
import {
  SPRINT3U_O1_FILENAME,
  SPRINT3U_O1_CONTENT,
  SPRINT3U_PROBE_FINAL_RESPONSE,
} from '../config/constants.js'

export interface OutputPreservationProbeOptions {
  controlClient: Anthropic
  environmentKey: string
  agentId: string
  agentVersion: number
  environmentId: string
  /**
   * Per-session workdir. The bash CWD. A subdirectory `outputs/` inside this
   * directory is the approved output path (SDK worker equivalent of
   * `/mnt/session/outputs` in the container worker).
   */
  workdir: string
}

export interface OutputPreservationResult {
  sessionId: string
  claimedSessionId: string | null
  sessionMismatch: boolean
  outputFileFound: boolean
  outputContentCorrect: boolean
  /** True when no extra unexpected files are present in the outputsDir */
  onlyExpectedFilesPresent: boolean
  approvedOutputPathWorks: boolean
}

export async function runOutputPreservationProbe(
  opts: OutputPreservationProbeOptions,
): Promise<OutputPreservationResult> {
  const { controlClient, agentId, environmentId, workdir } = opts
  // outputs/ subdirectory inside workdir — SDK worker equivalent of /mnt/session/outputs
  const outputsDir = path.join(workdir, 'outputs')

  fs.mkdirSync(workdir, { recursive: true })
  fs.mkdirSync(outputsDir, { recursive: true })

  await requireQueueDrained(controlClient, environmentId)
  console.log('[probe-o1] queue drained — creating session')

  const session = await controlClient.beta.sessions.create({
    agent: { type: 'agent', id: agentId, version: opts.agentVersion },
    environment_id: environmentId,
  } as Parameters<typeof controlClient.beta.sessions.create>[0])
  const sessionId = session.id
  console.log(`[probe-o1] session: ${sessionId}`)

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
      console.log(`[probe-o1] worker claimed session: ${id}`)
    },
  }).catch(err => {
    if ((err as Error)?.name !== 'AbortError') throw err
  })

  // Fixed bash command — writes to outputs/ subdir inside workdir (bash CWD).
  // For SDK workers (no container), this is the approved artifact path equivalent.
  const bashCmd =
    `printf '%s' '${SPRINT3U_O1_CONTENT}' > outputs/${SPRINT3U_O1_FILENAME} && printf 'done\\n'`

  const userMessage = [
    'Run this bash command exactly:',
    '',
    bashCmd,
    '',
    `After the command completes, respond with: ${SPRINT3U_PROBE_FINAL_RESPONSE}`,
  ].join('\n')

  await runAlwaysAllowSession(controlClient, sessionId, userMessage)

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

  const outputFilePath = path.join(outputsDir, SPRINT3U_O1_FILENAME)
  const outputFileFound = fs.existsSync(outputFilePath)
  const outputContent = outputFileFound ? fs.readFileSync(outputFilePath, 'utf-8') : null
  const outputContentCorrect = outputContent === SPRINT3U_O1_CONTENT

  // Check for unexpected files (any file other than the expected output)
  const outputFiles = fs.existsSync(outputsDir)
    ? fs.readdirSync(outputsDir)
    : []
  const onlyExpectedFilesPresent =
    outputFiles.length === 1 && outputFiles[0] === SPRINT3U_O1_FILENAME

  const approvedOutputPathWorks = outputFileFound && outputContentCorrect && !sessionMismatch

  console.log(`[probe-o1] outputFileFound: ${outputFileFound}`)
  console.log(`[probe-o1] outputContentCorrect: ${outputContentCorrect}`)
  console.log(`[probe-o1] onlyExpectedFilesPresent: ${onlyExpectedFilesPresent}`)
  console.log(`[probe-o1] approvedOutputPathWorks: ${approvedOutputPathWorks}`)
  console.log(`[probe-o1] sessionMismatch: ${sessionMismatch}`)

  return {
    sessionId,
    claimedSessionId: claimedSessionId ?? null,
    sessionMismatch,
    outputFileFound,
    outputContentCorrect,
    onlyExpectedFilesPresent,
    approvedOutputPathWorks,
  }
}
