import { describe, it, expect } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { validateSprint3tLiveEnv } from '../src/config/env.js'
import { ensureSprint3tAgents } from '../src/provision/ensure-sprint3t-agents.js'
import { checkWorkQueuePreflight } from '../src/diagnostics/work-queue-preflight.js'
import { runSdkApprovalAllowDiagnostic } from '../src/sessions/run-sdk-approval-allow-diagnostic.js'
import { runSdkApprovalDenyDiagnostic } from '../src/sessions/run-sdk-approval-deny-diagnostic.js'
import { runIsolatedWritePathDiagnostic } from '../src/sessions/run-isolated-write-path-diagnostic.js'
import path from 'path'
import fs from 'fs'

const RUN_LIVE = process.env['RUN_LIVE_SPRINT3T_TEST'] === '1'

describe.skipIf(!RUN_LIVE)('Sprint 3T: Queue-Isolated SDK Worker Selection Gate (live)', { timeout: 120_000 }, () => {
  const env = RUN_LIVE ? validateSprint3tLiveEnv() : { ANTHROPIC_API_KEY: '', ANTHROPIC_ENVIRONMENT_KEY: '' }
  const controlClient = RUN_LIVE ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null as unknown as Anthropic

  const runId = `sprint3t-live-${Date.now()}`
  const runtimeBase = path.join(process.cwd(), '.powerplant/runtime/sprint3t', runId)

  it('provisions Sprint 3T agents', async () => {
    const state = await ensureSprint3tAgents(controlClient)
    expect(state.environmentId).toBeTruthy()
    expect(state.agents.bashProbe?.id).toBeTruthy()
    expect(state.agents.writeProbe?.id).toBeTruthy()
  })

  it('Probe A (SDK allow): queue drained, requires_action fires, bash executes after allow', async () => {
    const state = await ensureSprint3tAgents(controlClient)
    const { bashProbe } = state.agents
    if (!bashProbe) throw new Error('bashProbe agent not provisioned')

    // Verify queue is clear before test
    const preflightResult = await checkWorkQueuePreflight(controlClient, state.environmentId)
    expect(preflightResult.passed).toBe(true)

    const workdir = path.join(runtimeBase, 'live-probe-a-allow')
    fs.mkdirSync(workdir, { recursive: true })

    const finding = await runSdkApprovalAllowDiagnostic({
      controlClient,
      environmentKey: env.ANTHROPIC_ENVIRONMENT_KEY,
      agentId: bashProbe.id,
      agentVersion: bashProbe.version,
      environmentId: state.environmentId,
      workdir,
    })

    expect(finding.evidence['requiresActionFired']).toBe(true)
    expect(finding.evidence['fileFound']).toBe(true)
    expect(finding.evidence['contentMatched']).toBe(true)
    expect(finding.evidence['sessionMismatch']).toBe(false)
    expect(finding.status).toBe('CONFORMANT')
  })

  it('Probe B (SDK deny): queue drained, requires_action fires, bash does not execute after deny', async () => {
    const state = await ensureSprint3tAgents(controlClient)
    const { bashProbe } = state.agents
    if (!bashProbe) throw new Error('bashProbe agent not provisioned')

    const workdir = path.join(runtimeBase, 'live-probe-b-deny')
    fs.mkdirSync(workdir, { recursive: true })

    const finding = await runSdkApprovalDenyDiagnostic({
      controlClient,
      environmentKey: env.ANTHROPIC_ENVIRONMENT_KEY,
      agentId: bashProbe.id,
      agentVersion: bashProbe.version,
      environmentId: state.environmentId,
      workdir,
    })

    expect(finding.evidence['requiresActionFired']).toBe(true)
    expect(finding.evidence['fileFound']).toBe(false)
    expect(finding.evidence['sessionMismatch']).toBe(false)
    expect(finding.status).toBe('CONFORMANT')
  })

  it('Probe C: isolated write path — at least relative path succeeds with no session mismatch', async () => {
    const state = await ensureSprint3tAgents(controlClient)
    const { writeProbe } = state.agents
    if (!writeProbe) throw new Error('writeProbe agent not provisioned')

    const workdir = path.join(runtimeBase, 'live-probe-c-write')
    fs.mkdirSync(workdir, { recursive: true })

    const finding = await runIsolatedWritePathDiagnostic({
      controlClient,
      environmentKey: env.ANTHROPIC_ENVIRONMENT_KEY,
      agentId: writeProbe.id,
      agentVersion: writeProbe.version,
      environmentId: state.environmentId,
      workdir,
    })

    // Session must not have been mis-claimed
    expect(finding.evidence['sessionMismatch']).toBe(false)
    // At minimum one path should succeed (no INCONCLUSIVE with session match)
    expect(finding.status).not.toBe('INCONCLUSIVE')
  })
})
