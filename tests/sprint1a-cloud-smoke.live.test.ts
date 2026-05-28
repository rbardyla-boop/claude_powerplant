import { describe, expect, it } from 'vitest'
import { createClient } from '../src/platform/client.js'
import { runCloudLifecycleSmoke } from '../src/sessions/run-cloud-lifecycle-smoke.js'
import { validateLiveEnv } from '../src/config/env.js'

const LIVE = process.env['RUN_LIVE_MANAGED_AGENTS_TEST'] === '1'

describe.skipIf(!LIVE)('Sprint 1A cloud lifecycle smoke (live)', () => {
  it('completes the full lifecycle and returns passed === true', async () => {
    const liveEnv = validateLiveEnv()
    const client = createClient()

    const result = await runCloudLifecycleSmoke(client, liveEnv.CLAUDE_POWERPLANT_MODEL_ID)

    expect(result.passed).toBe(true)
    expect(result.sessionId).toBeTruthy()
    expect(result.agentId).toBeTruthy()
    expect(result.environmentId).toBeTruthy()
    expect(result.toolUseCount).toBe(0)
    expect(result.completedIdle).toBe(true)
    expect(result.responseText.trim()).toBe('POWERPLANT ONLINE')
  }, 120_000)
})
