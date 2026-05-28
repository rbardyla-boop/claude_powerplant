import { describe, it, expect, beforeAll } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { validateSprint2aLiveEnv } from '../src/config/env.js'
import { createClient } from '../src/platform/client.js'
import { runSelfHostedWorker } from '../src/worker/run-self-hosted-worker.js'
import { runSelfHostedOutputProbe } from '../src/sessions/run-self-hosted-output-probe.js'
import { loadSelfHostedState } from '../src/platform/self-hosted-state.js'

// Excluded from `npm test` via vitest.config.ts exclude pattern.
// Run with: RUN_LIVE_SPRINT2A_TEST=1 npx vitest run tests/sprint2a-self-hosted.live.test.ts

const RUN_LIVE = process.env['RUN_LIVE_SPRINT2A_TEST'] === '1'

describe.skipIf(!RUN_LIVE)('Sprint 2A: self-hosted worker + session probe', () => {
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

  it('worker picks up session and writes probe file to local workdir', async () => {
    const ctrl = new AbortController()

    // Start worker in background — it polls the self-hosted environment
    const workerDone = runSelfHostedWorker({
      environmentKey: env.ANTHROPIC_ENVIRONMENT_KEY,
      signal: ctrl.signal,
    }).catch(err => {
      if ((err as Error)?.name !== 'AbortError') throw err
    })

    // Give the worker a moment to connect before firing the session
    await new Promise(r => setTimeout(r, 1500))

    let result
    try {
      result = await runSelfHostedOutputProbe(apiClient)
    } finally {
      ctrl.abort()
      await workerDone
    }

    expect(result.passed, result.failureReason).toBe(true)
    expect(result.fileContent).toBe('POWERPLANT SELF-HOSTED WORKER ONLINE')
    expect(result.finalAgentText).toContain('OUTPUT WRITTEN')
  }, 120_000)
})
