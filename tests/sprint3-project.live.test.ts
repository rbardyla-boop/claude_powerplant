import path from 'path'
import { describe, it, expect, beforeAll } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { validateSprint2aLiveEnv } from '../src/config/env.js'
import { createClient } from '../src/platform/client.js'
import { runContainerWorker } from '../src/worker/run-container-worker.js'
import { runSprint3ProjectProbe } from '../src/sessions/run-sprint3-project-probe.js'
import { loadSprint3State } from '../src/platform/sprint3-state.js'
import { SPRINT3_WORKDIR } from '../src/config/constants.js'

// Excluded from `npm test` via vitest.config.ts exclude pattern.
// Requires Docker and a built image: npm run sprint2b:build
// Requires Sprint 3 provisioned: npm run sprint3:provision
// Run with: RUN_LIVE_SPRINT3_TEST=1 npx vitest run tests/sprint3-project.live.test.ts

const RUN_LIVE = process.env['RUN_LIVE_SPRINT3_TEST'] === '1'

describe.skipIf(!RUN_LIVE)('Sprint 3: project adapter probe', () => {
  let env: ReturnType<typeof validateSprint2aLiveEnv>
  let apiClient: Anthropic

  beforeAll(() => {
    env = validateSprint2aLiveEnv()
    apiClient = createClient()

    const state = loadSprint3State()
    if (!state?.agent.id) {
      throw new Error('Sprint 3 state not found. Run npm run sprint3:provision first.')
    }
  })

  it('container reads project token and writes it to workspace', async () => {
    const projectDir = path.resolve(process.cwd(), 'fixtures/sample-project')
    const ctrl = new AbortController()

    const workerDone = runContainerWorker({
      environmentKey: env.ANTHROPIC_ENVIRONMENT_KEY,
      workspacesDir: path.resolve(process.cwd(), SPRINT3_WORKDIR),
      projectDir,
      signal: ctrl.signal,
    }).catch(err => {
      if ((err as Error)?.name !== 'AbortError') throw err
    })

    await new Promise(r => setTimeout(r, 1500))

    let result
    try {
      result = await runSprint3ProjectProbe(apiClient)
    } finally {
      ctrl.abort()
      await workerDone
    }

    expect(result.passed, result.failureReason).toBe(true)
    expect(result.fileContent).toBe('SAMPLE PROJECT ONLINE')
    expect(result.finalAgentText).toContain('PROJECT READ')
  }, 120_000)
})
