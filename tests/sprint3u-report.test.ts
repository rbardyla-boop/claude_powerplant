import { describe, it, expect } from 'vitest'
import type { Sprint3uReport } from '../src/sessions/run-sdk-boundary-diagnostic.js'

// ── Fixture builders ────────────────────────────────────────────────────────

function makeReport(overrides: Partial<Sprint3uReport['summary']> = {}): Sprint3uReport {
  const summary: Sprint3uReport['summary'] = {
    branch: 'A',
    credentialBoundaryPassed: true,
    arbitraryEgressBlocked: true,
    approvedOutputWorks: true,
    sessionMismatchInAnyProbe: false,
    requiresBrokerExecutorSplit: false,
    requiresNetworkEgressHardening: false,
    containedSelfHostedBuilderBoundaryPassed: true,
    ...overrides,
  }

  const clearedForSanitizedExternalProjectInput =
    summary.containedSelfHostedBuilderBoundaryPassed

  return {
    sprintId: 'sprint3u',
    runId: 'sprint3u-test-run',
    timestamp: new Date().toISOString(),
    agentId: 'agent-test',
    environmentId: 'env-test',

    probes: {
      envVisibility: {
        sessionId: 'sess-1',
        claimedSessionId: 'sess-1',
        sessionMismatch: false,
        k1: 'ABSENT',
        k2: 'ABSENT',
        k3: 'ABSENT',
        finalText: 'SDK BOUNDARY PROBE COMPLETE',
        credentialBoundary: {
          k1ApiKeyAbsent: true,
          k2WorkerCanaryAbsent: true,
          k3EnvironmentKeyAbsent: true,
          toolExecutionInheritsWorkerEnvironment: false,
          environmentKeyExposedToBashPresence: false,
          credentialBoundaryPassed: true,
        },
      },
      egressSink: {
        sessionId: 'sess-2',
        claimedSessionId: 'sess-2',
        sessionMismatch: false,
        sinkPort: 51234,
        canaryReceived: false,
        httpClientAvailable: true,
        arbitraryEgressBlocked: true,
        finalText: 'SDK BOUNDARY PROBE COMPLETE',
      },
      outputPreservation: {
        sessionId: 'sess-3',
        claimedSessionId: 'sess-3',
        sessionMismatch: false,
        outputFileFound: true,
        outputContentCorrect: true,
        onlyExpectedFilesPresent: true,
        approvedOutputPathWorks: true,
      },
    },

    summary,

    invariants: {
      clearedForRealProjectMounting: false,
      clearedForSanitizedExternalProjectInput,
      noRealProjectMounted: true,
      noCredentialValuesInReport: true,
    },
  }
}

// ── Permanent invariants ────────────────────────────────────────────────────

describe('Sprint3uReport permanent invariants', () => {
  it('clearedForRealProjectMounting is always false in Branch A', () => {
    const report = makeReport({ branch: 'A' })
    expect(report.invariants.clearedForRealProjectMounting).toBe(false)
  })

  it('clearedForRealProjectMounting is always false in Branch B', () => {
    const report = makeReport({
      branch: 'B',
      credentialBoundaryPassed: false,
      requiresBrokerExecutorSplit: true,
      containedSelfHostedBuilderBoundaryPassed: false,
    })
    expect(report.invariants.clearedForRealProjectMounting).toBe(false)
  })

  it('clearedForRealProjectMounting is always false in Branch C', () => {
    const report = makeReport({
      branch: 'C',
      arbitraryEgressBlocked: false,
      requiresNetworkEgressHardening: true,
      containedSelfHostedBuilderBoundaryPassed: false,
    })
    expect(report.invariants.clearedForRealProjectMounting).toBe(false)
  })

  it('clearedForRealProjectMounting is always false in Branch BC', () => {
    const report = makeReport({
      branch: 'BC',
      credentialBoundaryPassed: false,
      arbitraryEgressBlocked: false,
      requiresBrokerExecutorSplit: true,
      requiresNetworkEgressHardening: true,
      containedSelfHostedBuilderBoundaryPassed: false,
    })
    expect(report.invariants.clearedForRealProjectMounting).toBe(false)
  })

  it('noRealProjectMounted is always true', () => {
    const report = makeReport()
    expect(report.invariants.noRealProjectMounted).toBe(true)
  })

  it('noCredentialValuesInReport is always true', () => {
    const report = makeReport()
    expect(report.invariants.noCredentialValuesInReport).toBe(true)
  })
})

// ── clearedForSanitizedExternalProjectInput gating ─────────────────────────

describe('clearedForSanitizedExternalProjectInput', () => {
  it('is true only when containedSelfHostedBuilderBoundaryPassed is true', () => {
    const report = makeReport({
      branch: 'A',
      containedSelfHostedBuilderBoundaryPassed: true,
    })
    expect(report.invariants.clearedForSanitizedExternalProjectInput).toBe(true)
  })

  it('is false when branch is B', () => {
    const report = makeReport({
      branch: 'B',
      credentialBoundaryPassed: false,
      requiresBrokerExecutorSplit: true,
      containedSelfHostedBuilderBoundaryPassed: false,
    })
    expect(report.invariants.clearedForSanitizedExternalProjectInput).toBe(false)
  })

  it('is false when branch is C', () => {
    const report = makeReport({
      branch: 'C',
      arbitraryEgressBlocked: false,
      requiresNetworkEgressHardening: true,
      containedSelfHostedBuilderBoundaryPassed: false,
    })
    expect(report.invariants.clearedForSanitizedExternalProjectInput).toBe(false)
  })

  it('is false when branch is BC', () => {
    const report = makeReport({
      branch: 'BC',
      credentialBoundaryPassed: false,
      arbitraryEgressBlocked: false,
      requiresBrokerExecutorSplit: true,
      requiresNetworkEgressHardening: true,
      containedSelfHostedBuilderBoundaryPassed: false,
    })
    expect(report.invariants.clearedForSanitizedExternalProjectInput).toBe(false)
  })

  it('is false when output probe failed (Branch A but approvedOutputWorks=false)', () => {
    const report = makeReport({
      branch: 'A',
      approvedOutputWorks: false,
      containedSelfHostedBuilderBoundaryPassed: false,
    })
    expect(report.invariants.clearedForSanitizedExternalProjectInput).toBe(false)
  })

  it('is false when session mismatch occurred (Branch A but sessionMismatch=true)', () => {
    const report = makeReport({
      branch: 'A',
      sessionMismatchInAnyProbe: true,
      containedSelfHostedBuilderBoundaryPassed: false,
    })
    expect(report.invariants.clearedForSanitizedExternalProjectInput).toBe(false)
  })
})

// ── Branch determination consistency ───────────────────────────────────────

describe('Branch A requirements', () => {
  it('requiresBrokerExecutorSplit is false in Branch A', () => {
    const report = makeReport({ branch: 'A' })
    expect(report.summary.requiresBrokerExecutorSplit).toBe(false)
  })

  it('requiresNetworkEgressHardening is false in Branch A', () => {
    const report = makeReport({ branch: 'A' })
    expect(report.summary.requiresNetworkEgressHardening).toBe(false)
  })

  it('credentialBoundaryPassed is true in Branch A', () => {
    const report = makeReport({ branch: 'A' })
    expect(report.summary.credentialBoundaryPassed).toBe(true)
  })

  it('arbitraryEgressBlocked is true in Branch A', () => {
    const report = makeReport({ branch: 'A' })
    expect(report.summary.arbitraryEgressBlocked).toBe(true)
  })
})

describe('Branch B requirements', () => {
  it('requiresBrokerExecutorSplit is true in Branch B', () => {
    const report = makeReport({
      branch: 'B',
      credentialBoundaryPassed: false,
      requiresBrokerExecutorSplit: true,
      containedSelfHostedBuilderBoundaryPassed: false,
    })
    expect(report.summary.requiresBrokerExecutorSplit).toBe(true)
  })

  it('clearedForSanitizedExternalProjectInput is false in Branch B', () => {
    const report = makeReport({
      branch: 'B',
      credentialBoundaryPassed: false,
      requiresBrokerExecutorSplit: true,
      containedSelfHostedBuilderBoundaryPassed: false,
    })
    expect(report.invariants.clearedForSanitizedExternalProjectInput).toBe(false)
  })
})

describe('Branch C requirements', () => {
  it('requiresNetworkEgressHardening is true in Branch C', () => {
    const report = makeReport({
      branch: 'C',
      arbitraryEgressBlocked: false,
      requiresNetworkEgressHardening: true,
      containedSelfHostedBuilderBoundaryPassed: false,
    })
    expect(report.summary.requiresNetworkEgressHardening).toBe(true)
  })

  it('clearedForSanitizedExternalProjectInput is false in Branch C', () => {
    const report = makeReport({
      branch: 'C',
      arbitraryEgressBlocked: false,
      requiresNetworkEgressHardening: true,
      containedSelfHostedBuilderBoundaryPassed: false,
    })
    expect(report.invariants.clearedForSanitizedExternalProjectInput).toBe(false)
  })
})

describe('Report structure', () => {
  it('sprintId is always sprint3u', () => {
    const report = makeReport()
    expect(report.sprintId).toBe('sprint3u')
  })

  it('has all required probe keys', () => {
    const report = makeReport()
    expect(report.probes).toHaveProperty('envVisibility')
    expect(report.probes).toHaveProperty('egressSink')
    expect(report.probes).toHaveProperty('outputPreservation')
  })

  it('has all required invariant keys', () => {
    const report = makeReport()
    expect(report.invariants).toHaveProperty('clearedForRealProjectMounting')
    expect(report.invariants).toHaveProperty('clearedForSanitizedExternalProjectInput')
    expect(report.invariants).toHaveProperty('noRealProjectMounted')
    expect(report.invariants).toHaveProperty('noCredentialValuesInReport')
  })

  it('has all required summary keys', () => {
    const report = makeReport()
    expect(report.summary).toHaveProperty('branch')
    expect(report.summary).toHaveProperty('credentialBoundaryPassed')
    expect(report.summary).toHaveProperty('arbitraryEgressBlocked')
    expect(report.summary).toHaveProperty('approvedOutputWorks')
    expect(report.summary).toHaveProperty('sessionMismatchInAnyProbe')
    expect(report.summary).toHaveProperty('requiresBrokerExecutorSplit')
    expect(report.summary).toHaveProperty('requiresNetworkEgressHardening')
    expect(report.summary).toHaveProperty('containedSelfHostedBuilderBoundaryPassed')
  })
})
