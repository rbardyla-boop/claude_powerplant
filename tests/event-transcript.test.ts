import { describe, expect, it } from 'vitest'
import { assertSmokeTranscript } from '../src/platform/event-transcript.js'
import type { SmokeTranscript } from '../src/platform/event-transcript.js'
import { SMOKE_EXPECTED_RESPONSE } from '../src/config/constants.js'

const passingTranscript: SmokeTranscript = {
  sessionId: 'sesn_test123',
  agentMessageText: SMOKE_EXPECTED_RESPONSE,
  eventTypes: ['session.status_running', 'agent.message', 'session.status_idle'],
  toolUseCount: 0,
  completedIdle: true,
}

describe('assertSmokeTranscript', () => {
  it('passes when response matches and no tool use', () => {
    const result = assertSmokeTranscript(passingTranscript)
    expect(result.passed).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('fails when a tool-use event occurred', () => {
    const t: SmokeTranscript = { ...passingTranscript, toolUseCount: 1 }
    const result = assertSmokeTranscript(t)
    expect(result.passed).toBe(false)
    expect(result.reason).toContain('tool-use')
  })

  it('fails when session never reached status_idle', () => {
    const t: SmokeTranscript = { ...passingTranscript, completedIdle: false }
    const result = assertSmokeTranscript(t)
    expect(result.passed).toBe(false)
    expect(result.reason).toContain('idle')
  })

  it('fails when response text does not match (with whitespace trim)', () => {
    const t: SmokeTranscript = { ...passingTranscript, agentMessageText: 'Wrong response' }
    const result = assertSmokeTranscript(t)
    expect(result.passed).toBe(false)
    expect(result.reason).toContain(SMOKE_EXPECTED_RESPONSE)
  })

  it('passes when response has surrounding whitespace (trimmed)', () => {
    const t: SmokeTranscript = { ...passingTranscript, agentMessageText: `  ${SMOKE_EXPECTED_RESPONSE}  ` }
    const result = assertSmokeTranscript(t)
    expect(result.passed).toBe(true)
  })
})
