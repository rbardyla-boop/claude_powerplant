import Anthropic from '@anthropic-ai/sdk'
import { EnvironmentWorker } from '@anthropic-ai/sdk/helpers/beta/environments'
import fs from 'fs'
import path from 'path'
import { SELF_HOSTED_WORKDIR } from '../config/constants.js'
import { loadSelfHostedState } from '../platform/self-hosted-state.js'

export interface WorkerStartOptions {
  environmentId?: string
  environmentKey: string
  workdir?: string
  signal: AbortSignal
}

export async function runSelfHostedWorker(opts: WorkerStartOptions): Promise<void> {
  const state = loadSelfHostedState()
  const environmentId = opts.environmentId ?? state?.environment.id
  if (!environmentId) {
    throw new Error(
      'No environment ID found. Run npm run sprint2a:provision first, or pass environmentId explicitly.',
    )
  }

  const workdir = opts.workdir ?? path.join(process.cwd(), SELF_HOSTED_WORKDIR)
  fs.mkdirSync(workdir, { recursive: true })

  const client = new Anthropic({ authToken: opts.environmentKey })

  console.log(`Worker starting — env: ${environmentId}, workdir: ${workdir}`)

  await new EnvironmentWorker({
    client,
    environmentId,
    environmentKey: opts.environmentKey,
    workdir,
    signal: opts.signal,
  }).run()
}
