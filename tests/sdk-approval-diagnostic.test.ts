import { describe, it, expect } from 'vitest'

/**
 * Unit tests for pre-execution authorization criteria.
 *
 * These tests verify the classification logic without making API calls.
 * They prove the distinction between cloud always_ask evidence (Sprint 3S)
 * and self-hosted SDK worker evidence (Sprint 3T).
 */

interface ApprovalProbeEvidence {
  requiresActionFired: boolean
  fileFound: boolean
  contentMatched: boolean
  sessionMismatch: boolean
  confirmed: boolean
}

type ProbeStatus = 'CONFORMANT' | 'ANOMALY' | 'INCONCLUSIVE'

function classifyAllowProbe(ev: ApprovalProbeEvidence): ProbeStatus {
  if (ev.sessionMismatch) return 'ANOMALY'
  if (!ev.requiresActionFired) return 'ANOMALY'
  if (ev.requiresActionFired && ev.fileFound && ev.contentMatched) return 'CONFORMANT'
  return 'INCONCLUSIVE'
}

function classifyDenyProbe(ev: Omit<ApprovalProbeEvidence, 'contentMatched'>): ProbeStatus {
  if (ev.sessionMismatch) return 'ANOMALY'
  if (!ev.requiresActionFired) return 'ANOMALY'
  if (ev.requiresActionFired && !ev.fileFound) return 'CONFORMANT'
  if (ev.requiresActionFired && ev.fileFound) return 'ANOMALY'
  return 'INCONCLUSIVE'
}

describe('SDK allow probe classification', () => {
  it('CONFORMANT: requires_action fired, file present, no mismatch', () => {
    expect(classifyAllowProbe({
      requiresActionFired: true,
      fileFound: true,
      contentMatched: true,
      sessionMismatch: false,
      confirmed: true,
    })).toBe('CONFORMANT')
  })

  it('ANOMALY: requires_action did not fire (no confirmation gate)', () => {
    expect(classifyAllowProbe({
      requiresActionFired: false,
      fileFound: true,
      contentMatched: true,
      sessionMismatch: false,
      confirmed: false,
    })).toBe('ANOMALY')
  })

  it('ANOMALY: session mismatch (queue not isolated)', () => {
    expect(classifyAllowProbe({
      requiresActionFired: true,
      fileFound: true,
      contentMatched: true,
      sessionMismatch: true,
      confirmed: true,
    })).toBe('ANOMALY')
  })

  it('INCONCLUSIVE: requires_action fired but file absent', () => {
    expect(classifyAllowProbe({
      requiresActionFired: true,
      fileFound: false,
      contentMatched: false,
      sessionMismatch: false,
      confirmed: true,
    })).toBe('INCONCLUSIVE')
  })
})

describe('SDK deny probe classification', () => {
  it('CONFORMANT: requires_action fired, deny posted, file absent', () => {
    expect(classifyDenyProbe({
      requiresActionFired: true,
      fileFound: false,
      sessionMismatch: false,
      confirmed: false,
    })).toBe('CONFORMANT')
  })

  it('ANOMALY: requires_action did not fire', () => {
    expect(classifyDenyProbe({
      requiresActionFired: false,
      fileFound: false,
      sessionMismatch: false,
      confirmed: false,
    })).toBe('ANOMALY')
  })

  it('ANOMALY: file present after deny (bash executed despite denial)', () => {
    expect(classifyDenyProbe({
      requiresActionFired: true,
      fileFound: true,
      sessionMismatch: false,
      confirmed: false,
    })).toBe('ANOMALY')
  })

  it('ANOMALY: session mismatch', () => {
    expect(classifyDenyProbe({
      requiresActionFired: true,
      fileFound: false,
      sessionMismatch: true,
      confirmed: false,
    })).toBe('ANOMALY')
  })
})

describe('cloud vs self-hosted evidence separation', () => {
  it('cloud probe A (Sprint 3S): requires_action fires but file absent is INCONCLUSIVE (cloud storage)', () => {
    // Sprint 3S Probe A: cloud write tool writes to cloud storage, not host.
    // Host file check returns false even when the tool executed correctly.
    // This was classified INCONCLUSIVE by Sprint 3S, but the conformance signal was CONFORMANT.
    const cloudEvidence: ApprovalProbeEvidence = {
      requiresActionFired: true,
      fileFound: false,   // cloud write — not visible on host
      contentMatched: false,
      sessionMismatch: false,
      confirmed: true,
    }
    expect(classifyAllowProbe(cloudEvidence)).toBe('INCONCLUSIVE')
    // Sprint 3T SDK worker writes to the local workdir — file IS visible on host.
    // So Sprint 3T can distinguish CONFORMANT from INCONCLUSIVE.
  })

  it('self-hosted probe A (Sprint 3T): file present on host makes CONFORMANT deterministic', () => {
    const sdkEvidence: ApprovalProbeEvidence = {
      requiresActionFired: true,
      fileFound: true,   // local workdir — visible on host
      contentMatched: true,
      sessionMismatch: false,
      confirmed: true,
    }
    expect(classifyAllowProbe(sdkEvidence)).toBe('CONFORMANT')
  })
})

describe('ant vs SDK evidence separation', () => {
  it('ant: always_ask never fires requires_action (tool executes before confirmation) — ANOMALY', () => {
    // Sprint 3R finding: ant executes tools before posting; API rejects with 400.
    // The orchestrator never sees requires_action because ant dies before emitting it.
    const antEvidence: ApprovalProbeEvidence = {
      requiresActionFired: false,
      fileFound: false,
      contentMatched: false,
      sessionMismatch: false,
      confirmed: false,
    }
    expect(classifyAllowProbe(antEvidence)).toBe('ANOMALY')
  })

  it('SDK worker: requires_action fires correctly — CONFORMANT possible', () => {
    const sdkEvidence: ApprovalProbeEvidence = {
      requiresActionFired: true,
      fileFound: true,
      contentMatched: true,
      sessionMismatch: false,
      confirmed: true,
    }
    expect(classifyAllowProbe(sdkEvidence)).toBe('CONFORMANT')
  })
})
