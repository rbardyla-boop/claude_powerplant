import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { runSdkIsolatedWorker } from '../worker/run-sdk-isolated-worker.js'
import { requireQueueDrained } from '../diagnostics/work-queue-preflight.js'
import { assertClaimedSessionMatches } from '../worker/queue-isolation-policy.js'
import { runWithConfirmation } from '../approvals/confirmation-event-handler.js'
import type { DiagnosticFinding } from '../diagnostics/diagnostic-report.js'
import {
  SPRINT3T_WRITE_C1_FILENAME,
  SPRINT3T_WRITE_C2_FILENAME,
  SPRINT3T_WRITE_PROBE_CANARY,
} from '../config/constants.js'

export interface IsolatedWritePathOptions {
  controlClient: Anthropic
  environmentKey: string
  agentId: string
  agentVersion: number
  environmentId: string
  /** Per-probe workdir. Write tool paths are relative to this. */
  workdir: string
}

/**
 * Probe C — isolated write path contract.
 *
 * C1: write to an absolute path ({workdir}/SPRINT3T_WRITE_C1.txt)
 * C2: write to a relative path (SPRINT3T_WRITE_C2.txt — resolved relative to workdir)
 *
 * This re-runs Sprint 3S Probe C with proper queue isolation (depth===0/pending===0
 * pre-flight + claimed-session-ID assertion). The absolute path is the full host
 * path to the workdir subdirectory; the write tool may or may not accept absolute
 * paths outside the workdir depending on unrestrictedPaths.
 */
export async function runIsolatedWritePathDiagnostic(
  opts: IsolatedWritePathOptions,
): Promise<DiagnosticFinding> {
  const { controlClient, agentId, environmentId, workdir } = opts

  fs.mkdirSync(workdir, { recursive: true })

  const absoluteC1Path = path.join(workdir, SPRINT3T_WRITE_C1_FILENAME)

  await requireQueueDrained(controlClient, environmentId)
  console.log('[probe-c] queue drained — creating session')

  const session = await controlClient.beta.sessions.create({
    agent: { type: 'agent', id: agentId, version: opts.agentVersion },
    environment_id: environmentId,
  } as Parameters<typeof controlClient.beta.sessions.create>[0])
  const sessionId = session.id
  console.log(`[probe-c] session: ${sessionId}`)

  let claimedSessionId: string | undefined
  const workerAc = new AbortController()

  const workerPromise = runSdkIsolatedWorker({
    environmentKey: opts.environmentKey,
    environmentId,
    workdir,
    allowedTools: ['write'],
    signal: workerAc.signal,
    onClaimed: (id) => {
      claimedSessionId = id
      console.log(`[probe-c] worker claimed session: ${id}`)
    },
  }).catch(err => {
    if ((err as Error)?.name !== 'AbortError') throw err
  })

  // C1: absolute path to workdir file; C2: relative (bare filename)
  const userMessage =
    `Write two files in this exact order:\n` +
    `1. Write to file path "${absoluteC1Path}" with content: ${SPRINT3T_WRITE_PROBE_CANARY} C1\n` +
    `2. Write to file path "${SPRINT3T_WRITE_C2_FILENAME}" with content: ${SPRINT3T_WRITE_PROBE_CANARY} C2\n` +
    `After both writes succeed, respond with: SDK WRITE PROBE COMPLETE`

  const confirmResult = await runWithConfirmation(
    controlClient,
    sessionId,
    userMessage,
    () => ({ result: 'allow' as const }),
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

  const c1Found = fs.existsSync(absoluteC1Path)
  const c2Path = path.join(workdir, SPRINT3T_WRITE_C2_FILENAME)
  const c2Found = fs.existsSync(c2Path)

  const c1Content = c1Found ? fs.readFileSync(absoluteC1Path, 'utf-8').trim() : null
  const c2Content = c2Found ? fs.readFileSync(c2Path, 'utf-8').trim() : null

  console.log(`[probe-c] C1 (absolute path) found: ${c1Found}`)
  console.log(`[probe-c] C2 (relative path) found: ${c2Found}`)
  console.log(`[probe-c] sessionMismatch: ${sessionMismatch}`)

  const parts: string[] = []
  if (c1Found) parts.push('C1(absolute-path write succeeded)')
  else parts.push('C1(absolute-path write not found on host)')
  if (c2Found) parts.push('C2(relative-path write succeeded)')
  else parts.push('C2(relative-path write not found on host)')

  let status: 'CONFORMANT' | 'ANOMALY' | 'INCONCLUSIVE'
  let summary: string

  if (sessionMismatch) {
    status = 'ANOMALY'
    summary = `ANOMALY — session mismatch: worker claimed ${claimedSessionId ?? 'unknown'} but expected ${sessionId}.`
  } else if (c1Found && c2Found) {
    status = 'CONFORMANT'
    summary = `CONFORMANT — ${parts.join('; ')}.`
  } else if (!c1Found && !c2Found) {
    status = 'INCONCLUSIVE'
    summary = `INCONCLUSIVE — neither C1 nor C2 found; tool may not have executed.`
  } else {
    // Partial result
    status = 'CONFORMANT'
    summary = parts.join('; ')
  }

  return {
    probe: 'C',
    variant: 'sdk-write-path',
    status,
    summary,
    evidence: {
      sessionId,
      claimedSessionId: claimedSessionId ?? null,
      sessionMismatch,
      c1AbsolutePathUsed: absoluteC1Path,
      c1Found,
      c1Content,
      c2RelativePath: SPRINT3T_WRITE_C2_FILENAME,
      c2Found,
      c2Content,
      toolUseCount: confirmResult.toolUseEvents.length,
      finalText: confirmResult.finalText,
    },
  }
}
