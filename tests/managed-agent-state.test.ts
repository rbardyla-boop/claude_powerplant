import { describe, expect, it } from 'vitest'
import { CloudSmokeStateSchema } from '../src/platform/managed-agent-state.js'

const validState = {
  agent: { id: 'agt_abc123', version: 1234567890, name: 'Test Agent' },
  environment: { id: 'env_xyz789', name: 'test-env' },
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('CloudSmokeStateSchema', () => {
  it('accepts a valid state', () => {
    expect(CloudSmokeStateSchema.safeParse(validState).success).toBe(true)
  })

  it('rejects state with missing agent id', () => {
    const bad = { ...validState, agent: { ...validState.agent, id: '' } }
    expect(CloudSmokeStateSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects state with missing environment id', () => {
    const bad = { ...validState, environment: { ...validState.environment, id: '' } }
    expect(CloudSmokeStateSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects state with missing agent entirely', () => {
    const { agent: _a, ...bad } = validState
    expect(CloudSmokeStateSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects state with missing environment entirely', () => {
    const { environment: _e, ...bad } = validState
    expect(CloudSmokeStateSchema.safeParse(bad).success).toBe(false)
  })
})
