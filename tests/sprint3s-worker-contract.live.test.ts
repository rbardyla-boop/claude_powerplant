import { describe, it, expect } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { ensureSprint3sAgents } from '../src/provision/ensure-sprint3s-agents.js'
import { runAntAlwaysAskDiagnostic } from '../src/sessions/run-ant-always-ask-diagnostic.js'
import { runOutputPathDiagnostic } from '../src/sessions/run-output-path-diagnostic.js'
import { runBashOutputDiagnostic } from '../src/sessions/run-bash-output-diagnostic.js'
import path from 'path'
import { SPRINT3S_WORKDIR, SPRINT3S_RUNTIME_BASE } from '../src/config/constants.js'

const runLive = process.env['RUN_LIVE_SPRINT3S_TEST'] === '1'

describe.skipIf(!runLive)('Sprint 3S — Worker Contract Reconciliation (live)', () => {
  const client = new Anthropic()

  it('Probe A (allow): classifies always_ask conformance', async () => {
    const state = await ensureSprint3sAgents(client)
    const result = await runAntAlwaysAskDiagnostic(
      client,
      state.agents.permissionProbe!.id,
      state.agents.permissionProbe!.version,
      state.environmentId,
      'allow',
      path.join(process.cwd(), SPRINT3S_WORKDIR),
    )
    expect(['CONFORMANT', 'ANOMALY', 'INCONCLUSIVE']).toContain(result.finding.status)
    expect(result.finding.probe).toBe('A')
    expect(result.finding.variant).toBe('allow')
  }, 120_000)

  it('Probe A (deny): classifies always_ask deny-path', async () => {
    const state = await ensureSprint3sAgents(client)
    const result = await runAntAlwaysAskDiagnostic(
      client,
      state.agents.permissionProbe!.id,
      state.agents.permissionProbe!.version,
      state.environmentId,
      'deny',
      path.join(process.cwd(), SPRINT3S_WORKDIR),
    )
    expect(['CONFORMANT', 'ANOMALY', 'INCONCLUSIVE']).toContain(result.finding.status)
    expect(result.finding.probe).toBe('A')
    expect(result.finding.variant).toBe('deny')
  }, 120_000)

  it('Probe C: classifies output path compliance', async () => {
    const state = await ensureSprint3sAgents(client)
    const result = await runOutputPathDiagnostic(
      client,
      state.agents.outputProbe!.id,
      state.agents.outputProbe!.version,
      state.environmentId,
      path.join(process.cwd(), SPRINT3S_WORKDIR),
      path.join(process.cwd(), SPRINT3S_RUNTIME_BASE),
    )
    expect(['CONFORMANT', 'ANOMALY', 'INCONCLUSIVE']).toContain(result.finding.status)
    expect(result.finding.probe).toBe('C')
  }, 120_000)

  it('Probe D: classifies bash redirect to /mnt/session/outputs', async () => {
    const state = await ensureSprint3sAgents(client)
    const result = await runBashOutputDiagnostic(
      client,
      state.agents.bashProbe!.id,
      state.agents.bashProbe!.version,
      state.environmentId,
      path.join(process.cwd(), SPRINT3S_WORKDIR),
      path.join(process.cwd(), SPRINT3S_RUNTIME_BASE),
    )
    expect(['CONFORMANT', 'ANOMALY', 'INCONCLUSIVE']).toContain(result.finding.status)
    expect(result.finding.probe).toBe('D')
  }, 120_000)
})
