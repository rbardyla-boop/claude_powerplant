import { describe, it, expect } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { ensureSprint3vAgent } from '../src/provision/ensure-sprint3v-agent.js'
import { runCustomExecutorProbeSession } from '../src/sessions/run-custom-executor-probe-session.js'
import { SPRINT3V_RUNTIME_BASE, SPRINT3V_FINAL_RESPONSE } from '../src/config/constants.js'

const RUN_LIVE = Boolean(process.env['RUN_LIVE_SPRINT3V_TEST'])

describe.skipIf(!RUN_LIVE)('Sprint 3V live: custom tool broker + air-gapped executor', () => {
  it('proves the isolated executor cell end-to-end', async () => {
    const apiKey = process.env['ANTHROPIC_API_KEY']
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY required for live sprint3v test')

    const client = new Anthropic({ apiKey })

    // Provision agent
    const state = await ensureSprint3vAgent(client)
    expect(state.agent).toBeDefined()
    expect(state.agent!.id).toMatch(/^agt_/)

    // Run session
    const runtimeBase = SPRINT3V_RUNTIME_BASE
    fs.mkdirSync(runtimeBase, { recursive: true })

    const report = await runCustomExecutorProbeSession({
      controlClient: client,
      state,
      runtimeBase,
    })

    // Session integrity
    expect(report.session.customToolUseCount).toBe(1)
    expect(report.session.builtinToolUseCount).toBe(0)
    expect(report.session.finalResponse).toBe(SPRINT3V_FINAL_RESPONSE)
    expect(report.session.finalResponseCorrect).toBe(true)

    // Credential isolation
    expect(report.executor.proof.anthropicApiKeyPresent).toBe(false)
    expect(report.executor.proof.anthropicEnvironmentKeyPresent).toBe(false)
    expect(report.executor.proof.workerSecretCanaryPresent).toBe(false)
    expect(report.validation.credentialIsolationPassed).toBe(true)

    // Egress containment
    expect(report.executor.proof.egressSucceeded).toBe(false)
    expect(report.executor.sinkReceivedCanary).toBe(false)
    expect(report.validation.egressBlocked).toBe(true)

    // Output
    expect(report.executor.proof.outputPathOperational).toBe(true)
    expect(report.validation.outputValidated).toBe(true)

    // Non-root
    expect(report.executor.proof.executorIsNonRoot).toBe(true)
    expect(report.executor.proof.executorUid).not.toBe(0)
    expect(report.validation.executorIsNonRoot).toBe(true)

    // No source project mounted
    expect(report.validation.noSourceProjectMounted).toBe(true)

    // Invariants
    expect(report.invariants.clearedForRealProjectMounting).toBe(false)
    expect(report.invariants.clearedForSanitizedExternalProjectInput).toBe(false)

    // Overall pass
    expect(report.validation.passed).toBe(true)
  }, 120_000)
})
