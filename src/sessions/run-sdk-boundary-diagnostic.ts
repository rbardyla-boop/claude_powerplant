import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { runEnvVisibilityProbe } from '../diagnostics/run-env-visibility-probe.js'
import { runEgressSinkProbe } from '../diagnostics/run-egress-sink-probe.js'
import { runOutputPreservationProbe } from '../diagnostics/run-output-preservation-probe.js'
import { selectBranchFromCredentials } from '../worker/credential-boundary.js'
import type { EnvVisibilityResult } from '../diagnostics/run-env-visibility-probe.js'
import type { EgressSinkProbeResult } from '../diagnostics/run-egress-sink-probe.js'
import type { OutputPreservationResult } from '../diagnostics/run-output-preservation-probe.js'
import type { Sprint3uState } from '../platform/sprint3u-state.js'

export interface Sprint3uRunOptions {
  controlClient: Anthropic
  environmentKey: string
  state: Sprint3uState
  runtimeBase: string
}

export type Sprint3uBranch = 'A' | 'B' | 'C' | 'BC'

export interface Sprint3uReport {
  sprintId: 'sprint3u'
  runId: string
  timestamp: string
  agentId: string
  environmentId: string

  probes: {
    envVisibility: EnvVisibilityResult | null
    egressSink: EgressSinkProbeResult | null
    outputPreservation: OutputPreservationResult | null
  }

  summary: {
    branch: Sprint3uBranch
    credentialBoundaryPassed: boolean
    arbitraryEgressBlocked: boolean
    approvedOutputWorks: boolean
    sessionMismatchInAnyProbe: boolean
    requiresBrokerExecutorSplit: boolean
    requiresNetworkEgressHardening: boolean
    /** True only when Branch A conditions are all met */
    containedSelfHostedBuilderBoundaryPassed: boolean
  }

  invariants: {
    clearedForRealProjectMounting: false
    clearedForSanitizedExternalProjectInput: boolean
    noRealProjectMounted: true
    noCredentialValuesInReport: true
  }
}

function determineBranch(
  envResult: EnvVisibilityResult | null,
  egressResult: EgressSinkProbeResult | null,
): Sprint3uBranch {
  const branchB =
    envResult !== null &&
    (envResult.credentialBoundary.toolExecutionInheritsWorkerEnvironment ||
      envResult.credentialBoundary.environmentKeyExposedToBashPresence)

  // arbitraryEgressBlocked === !canaryReceived; canaryReceived is the authoritative signal.
  // httpClientAvailable is derived from a result file that may not exist (CWD mismatch) even
  // when curl ran. Do not gate Branch C on it — use the sink observation directly.
  const branchC =
    egressResult !== null &&
    !egressResult.arbitraryEgressBlocked

  if (branchB && branchC) return 'BC'
  if (branchB) return 'B'
  if (branchC) return 'C'
  return 'A'
}

export async function runSprint3uBoundaryDiagnostic(
  opts: Sprint3uRunOptions,
): Promise<Sprint3uReport> {
  const { controlClient, environmentKey, state, runtimeBase } = opts
  const agent = state.agent!
  const runId = `sprint3u-${Date.now()}`

  const makeWorkdir = (label: string): string => {
    const dir = path.join(runtimeBase, runId, label)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  let envResult: EnvVisibilityResult | null = null
  let egressResult: EgressSinkProbeResult | null = null
  let outputResult: OutputPreservationResult | null = null

  // ── Probes K1/K2/K3 — credential visibility ────────────────────────────────
  console.log()
  console.log('--- Probes K1/K2/K3: env variable visibility ---')
  try {
    envResult = await runEnvVisibilityProbe({
      controlClient,
      environmentKey,
      agentId: agent.id,
      agentVersion: agent.version,
      environmentId: state.environmentId,
      workdir: makeWorkdir('probe-k'),
    })
  } catch (err) {
    console.error(`[sprint3u] probe-k error: ${(err as Error).message}`)
  }

  // ── Probe E1 — egress sink ─────────────────────────────────────────────────
  console.log()
  console.log('--- Probe E1: egress containment ---')
  try {
    egressResult = await runEgressSinkProbe({
      controlClient,
      environmentKey,
      agentId: agent.id,
      agentVersion: agent.version,
      environmentId: state.environmentId,
      workdir: makeWorkdir('probe-e1'),
    })
  } catch (err) {
    console.error(`[sprint3u] probe-e1 error: ${(err as Error).message}`)
  }

  // ── Probe O1 — approved output ─────────────────────────────────────────────
  console.log()
  console.log('--- Probe O1: approved output path ---')
  try {
    outputResult = await runOutputPreservationProbe({
      controlClient,
      environmentKey,
      agentId: agent.id,
      agentVersion: agent.version,
      environmentId: state.environmentId,
      workdir: makeWorkdir('probe-o1'),
    })
  } catch (err) {
    console.error(`[sprint3u] probe-o1 error: ${(err as Error).message}`)
  }

  // ── Determine branch and summary ───────────────────────────────────────────
  const branch = determineBranch(envResult, egressResult)
  const credentialBoundaryPassed = envResult?.credentialBoundary.credentialBoundaryPassed ?? false
  const arbitraryEgressBlocked = egressResult?.arbitraryEgressBlocked ?? false
  const approvedOutputWorks = outputResult?.approvedOutputPathWorks ?? false
  const sessionMismatchInAnyProbe = [envResult, egressResult, outputResult]
    .some(r => r?.sessionMismatch === true)

  const requiresBrokerExecutorSplit = branch === 'B' || branch === 'BC'
  const requiresNetworkEgressHardening = branch === 'C' || branch === 'BC'

  // Branch A requires all conditions met: credentials isolated, egress blocked, output works
  const containedSelfHostedBuilderBoundaryPassed =
    branch === 'A' && approvedOutputWorks && !sessionMismatchInAnyProbe

  // clearance remains false unless Branch A is fully proven
  const clearedForSanitizedExternalProjectInput = containedSelfHostedBuilderBoundaryPassed

  const report: Sprint3uReport = {
    sprintId: 'sprint3u',
    runId,
    timestamp: new Date().toISOString(),
    agentId: agent.id,
    environmentId: state.environmentId,

    probes: {
      envVisibility: envResult,
      egressSink: egressResult,
      outputPreservation: outputResult,
    },

    summary: {
      branch,
      credentialBoundaryPassed,
      arbitraryEgressBlocked,
      approvedOutputWorks,
      sessionMismatchInAnyProbe,
      requiresBrokerExecutorSplit,
      requiresNetworkEgressHardening,
      containedSelfHostedBuilderBoundaryPassed,
    },

    invariants: {
      clearedForRealProjectMounting: false,
      clearedForSanitizedExternalProjectInput,
      noRealProjectMounted: true,
      noCredentialValuesInReport: true,
    },
  }

  return report
}
