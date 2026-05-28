import { describe, it, expect } from 'vitest'
import { classifyAlwaysAskConformance, classifyOutputPathCompliance } from '../src/diagnostics/event-ordering.js'
import type { ObservedEvent, FileExistenceRecord } from '../src/diagnostics/event-ordering.js'

function makeFile(label: string, exists: boolean): FileExistenceRecord {
  const now = Date.now()
  return {
    path: `/tmp/test/${label}`,
    label,
    existedAtMs: exists ? now : null,
    checkedAtMs: now,
  }
}

const requiresActionEvent: ObservedEvent = {
  type: 'session.status_idle',
  stopReasonType: 'requires_action',
  timestampMs: Date.now(),
}

const endTurnEvent: ObservedEvent = {
  type: 'session.status_idle',
  stopReasonType: 'end_turn',
  timestampMs: Date.now(),
}

const toolUseEvent: ObservedEvent = {
  type: 'agent.tool_use',
  toolName: 'write',
  toolUseId: 'tu_001',
  timestampMs: Date.now(),
}

describe('classifyAlwaysAskConformance', () => {
  it('marks CONFORMANT when requires_action fired, file absent before, file present after allow', () => {
    const result = classifyAlwaysAskConformance(
      [toolUseEvent, requiresActionEvent, endTurnEvent],
      makeFile('before', false),
      makeFile('after-allow', true),
      null,
    )
    expect(result.conformant).toBe(true)
    expect(result.anomaly).toBe(false)
    expect(result.requiresActionBeforeConfirmation).toBe(true)
    expect(result.fileExistedBeforeConfirmation).toBe(false)
    expect(result.fileExistedAfterAllow).toBe(true)
  })

  it('marks ANOMALY when file existed before confirmation was posted', () => {
    const result = classifyAlwaysAskConformance(
      [toolUseEvent, requiresActionEvent],
      makeFile('before', true),
      makeFile('after-allow', true),
      null,
    )
    expect(result.anomaly).toBe(true)
    expect(result.conformant).toBe(false)
    expect(result.fileExistedBeforeConfirmation).toBe(true)
  })

  it('marks INCONCLUSIVE when requires_action fired but file state after allow is ambiguous', () => {
    const result = classifyAlwaysAskConformance(
      [toolUseEvent, requiresActionEvent, endTurnEvent],
      makeFile('before', false),
      makeFile('after-allow', false),
      null,
    )
    expect(result.conformant).toBe(false)
    expect(result.anomaly).toBe(false)
    expect(result.inconclusive).toBe(true)
  })

  it('marks INCONCLUSIVE when requires_action did not fire at all', () => {
    const result = classifyAlwaysAskConformance(
      [toolUseEvent, endTurnEvent],
      makeFile('before', false),
      null,
      null,
    )
    expect(result.requiresActionBeforeConfirmation).toBe(false)
    expect(result.inconclusive).toBe(true)
    expect(result.conformant).toBe(false)
  })

  it('deny variant: file absent after deny is acceptable', () => {
    const result = classifyAlwaysAskConformance(
      [toolUseEvent, requiresActionEvent, endTurnEvent],
      makeFile('before', false),
      null,
      makeFile('after-deny', false),
    )
    // Deny: file not written is the expected outcome. fileExistedAfterAllow is null.
    expect(result.fileExistedAfterAllow).toBeNull()
    expect(result.fileExistedAfterDeny).toBe(false)
    // Not conformant by the allow-path check, but not anomalous either
    expect(result.anomaly).toBe(false)
  })

  it('returns the full event sequence in result', () => {
    const events = [toolUseEvent, requiresActionEvent]
    const result = classifyAlwaysAskConformance(events, makeFile('x', false), null, null)
    expect(result.eventSequence).toHaveLength(2)
  })
})

describe('classifyOutputPathCompliance', () => {
  it('CONFORMANT when C1 absolute write succeeds and file found on host', () => {
    const result = classifyOutputPathCompliance(false, true, false, true, null, false)
    expect(result.c1AbsoluteWriteSucceeded).toBe(true)
    expect(result.c1FileFoundOnHost).toBe(true)
    expect(result.summary).toContain('C1(absolute-path write succeeded')
  })

  it('shows anomaly summary when C1 write failed', () => {
    const result = classifyOutputPathCompliance(true, false, false, true, null, false)
    expect(result.c1AbsoluteWriteSucceeded).toBe(false)
    expect(result.summary).toContain('C1(absolute-path write failed in container)')
  })

  it('shows inconclusive when write error state is unknown', () => {
    const result = classifyOutputPathCompliance(null, false, null, false, null, false)
    expect(result.c1AbsoluteWriteSucceeded).toBeNull()
    expect(result.summary).toContain('C1(inconclusive)')
  })

  it('records C2 relative write result independently', () => {
    const result = classifyOutputPathCompliance(true, false, false, true, null, false)
    expect(result.c2RelativeWriteSucceeded).toBe(true)
    expect(result.c2FileFoundOnHost).toBe(true)
    expect(result.summary).toContain('C2(relative-path write succeeded')
  })

  it('contractPath is always /mnt/session/outputs', () => {
    const result = classifyOutputPathCompliance(null, false, null, false, null, false)
    expect(result.contractPath).toBe('/mnt/session/outputs')
  })

  it('records bash probe result when provided', () => {
    const result = classifyOutputPathCompliance(null, false, null, false, false, true)
    expect(result.bashWriteSucceeded).toBe(true)
    expect(result.bashFileFoundOnHost).toBe(true)
    expect(result.summary).toContain('D(bash redirect to /mnt/session/outputs succeeded')
  })
})
