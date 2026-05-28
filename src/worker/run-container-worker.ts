import Anthropic from '@anthropic-ai/sdk'
import { WorkPoller } from '@anthropic-ai/sdk/helpers/beta/environments'
import { SPRINT2B_CONTAINER_IMAGE } from '../config/constants.js'
import { loadSelfHostedState } from '../platform/self-hosted-state.js'
import { spawnContainerSession } from './spawn-container-session.js'

export interface ContainerWorkerOptions {
  environmentKey: string
  imageTag?: string
  workspacesDir?: string
  projectDir?: string
  outputsDir?: string
  signal: AbortSignal
}

export async function runContainerWorker(opts: ContainerWorkerOptions): Promise<void> {
  const state = loadSelfHostedState()
  const environmentId = state?.environment.id
  if (!environmentId) {
    throw new Error('No environment ID found. Run npm run sprint2a:provision first.')
  }

  const imageTag = opts.imageTag ?? SPRINT2B_CONTAINER_IMAGE

  // Worker authenticates with environment key (Bearer), not API key
  const client = new Anthropic({ authToken: opts.environmentKey })

  console.log(`[container-worker] starting — env: ${environmentId}, image: ${imageTag}`)

  const poller = new WorkPoller({
    client,
    environmentId,
    environmentKey: opts.environmentKey,
    // Container owns work.stop via `ant beta:worker run` — do not double-stop
    autoStop: false,
    signal: opts.signal,
  })

  for await (const work of poller) {
    if (work.data.type !== 'session') continue
    const sessionId = work.data.id
    console.log(`[container-worker] claimed session ${sessionId}`)
    try {
      await spawnContainerSession(work, {
        environmentKey: opts.environmentKey,
        imageTag,
        workspacesDir: opts.workspacesDir,
        projectDir: opts.projectDir,
        outputsDir: opts.outputsDir,
      })
    } catch (err) {
      console.error(`[container-worker] session ${sessionId} failed: ${(err as Error).message}`)
    }
  }

  console.log('[container-worker] stopped')
}
