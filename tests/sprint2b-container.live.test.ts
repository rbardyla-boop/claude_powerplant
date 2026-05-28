import { describe, it, expect, beforeAll } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { validateSprint2aLiveEnv } from '../src/config/env.js'
import { createClient } from '../src/platform/client.js'
import { runContainerWorker } from '../src/worker/run-container-worker.js'
import { runSprint2bOutputProbe } from '../src/sessions/run-sprint2b-output-probe.js'
import { loadSelfHostedState } from '../src/platform/self-hosted-state.js'

// Excluded from `npm test` via vitest.config.ts exclude pattern.
// Requires Docker and a built image: npm run sprint2b:build
// Run with: RUN_LIVE_SPRINT2B_TEST=1 npx vitest run tests/sprint2b-container.live.test.ts

const RUN_LIVE = process.env['RUN_LIVE_SPRINT2B_TEST'] === '1'

describe.skipIf(!RUN_LIVE)('Sprint 2B: container worker + session probe', () => {
  let env: ReturnType<typeof validateSprint2aLiveEnv>
  let apiClient: Anthropic

  beforeAll(() => {
    env = validateSprint2aLiveEnv()
    apiClient = createClient()

    const state = loadSelfHostedState()
    if (!state?.agent.id) {
      throw new Error(
        'Sprint 2A state not found. Run npm run sprint2a:provision first.',
      )
    }
  })

  it('container worker spawns per-session container and writes probe file', async () => {
    const ctrl = new AbortController()

    // Start container worker in background — it polls and spawns Docker per session
    const workerDone = runContainerWorker({
      environmentKey: env.ANTHROPIC_ENVIRONMENT_KEY,
      signal: ctrl.signal,
    }).catch(err => {
      if ((err as Error)?.name !== 'AbortError') throw err
    })

    // Give the worker a moment to connect before firing the session
    await new Promise(r => setTimeout(r, 1500))

    let result
    try {
      result = await runSprint2bOutputProbe(apiClient)
    } finally {
      ctrl.abort()
      await workerDone
    }

    expect(result.passed, result.failureReason).toBe(true)
    expect(result.fileContent).toBe('POWERPLANT CONTAINER WORKER ONLINE')
    expect(result.finalAgentText).toContain('OUTPUT WRITTEN')
  }, 120_000)
})
