import { describe, it, expect } from 'vitest'

/**
 * Unit tests for write tool path classification (Probe C).
 *
 * These tests verify the path comparison logic without making API calls.
 * Probe C re-runs Sprint 3S Probe C with proper queue isolation.
 */

interface WritePathEvidence {
  c1Found: boolean
  c2Found: boolean
  sessionMismatch: boolean
  toolUseCount: number
}

type ProbeStatus = 'CONFORMANT' | 'ANOMALY' | 'INCONCLUSIVE'

function classifyWritePathProbe(ev: WritePathEvidence): {
  status: ProbeStatus
  c1Status: 'found' | 'absent'
  c2Status: 'found' | 'absent'
} {
  const c1Status = ev.c1Found ? 'found' : 'absent'
  const c2Status = ev.c2Found ? 'found' : 'absent'

  if (ev.sessionMismatch) {
    return { status: 'ANOMALY', c1Status, c2Status }
  }
  if (!ev.c1Found && !ev.c2Found && ev.toolUseCount === 0) {
    return { status: 'INCONCLUSIVE', c1Status, c2Status }
  }
  return { status: 'CONFORMANT', c1Status, c2Status }
}

describe('Probe C write path classification', () => {
  it('CONFORMANT: both C1 and C2 found', () => {
    const result = classifyWritePathProbe({
      c1Found: true,
      c2Found: true,
      sessionMismatch: false,
      toolUseCount: 2,
    })
    expect(result.status).toBe('CONFORMANT')
    expect(result.c1Status).toBe('found')
    expect(result.c2Status).toBe('found')
  })

  it('CONFORMANT: only C2 (relative path) found — absolute path write rejected by write tool', () => {
    const result = classifyWritePathProbe({
      c1Found: false,
      c2Found: true,
      sessionMismatch: false,
      toolUseCount: 2,
    })
    expect(result.status).toBe('CONFORMANT')
    expect(result.c1Status).toBe('absent')
    expect(result.c2Status).toBe('found')
  })

  it('CONFORMANT: only C1 (absolute path) found', () => {
    const result = classifyWritePathProbe({
      c1Found: true,
      c2Found: false,
      sessionMismatch: false,
      toolUseCount: 2,
    })
    expect(result.status).toBe('CONFORMANT')
    expect(result.c1Status).toBe('found')
    expect(result.c2Status).toBe('absent')
  })

  it('ANOMALY: session mismatch (queue not isolated)', () => {
    const result = classifyWritePathProbe({
      c1Found: false,
      c2Found: false,
      sessionMismatch: true,
      toolUseCount: 0,
    })
    expect(result.status).toBe('ANOMALY')
  })

  it('INCONCLUSIVE: no files found and no tool uses (session did not execute)', () => {
    const result = classifyWritePathProbe({
      c1Found: false,
      c2Found: false,
      sessionMismatch: false,
      toolUseCount: 0,
    })
    expect(result.status).toBe('INCONCLUSIVE')
  })
})

describe('queue isolation invariant prevents Sprint 3S Probe C pollution', () => {
  it('session mismatch maps to ANOMALY (not INCONCLUSIVE)', () => {
    // Sprint 3S Probe C got INCONCLUSIVE because the wrong session was claimed.
    // Sprint 3T detects this as ANOMALY via the session-mismatch assertion.
    const result = classifyWritePathProbe({
      c1Found: false,
      c2Found: false,
      sessionMismatch: true,
      toolUseCount: 0,
    })
    expect(result.status).toBe('ANOMALY')
  })

  it('session match with tool execution gives definitive result', () => {
    // With proper queue isolation, a session match + tool execution is definitive.
    const result = classifyWritePathProbe({
      c1Found: false,
      c2Found: true,
      sessionMismatch: false,
      toolUseCount: 2,
    })
    expect(result.status).toBe('CONFORMANT')
    // Can now document: relative paths work, absolute paths do not
    expect(result.c2Status).toBe('found')
    expect(result.c1Status).toBe('absent')
  })
})
