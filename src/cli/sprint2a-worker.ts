import { validateSprint2aLiveEnv } from '../config/env.js'
import { runSelfHostedWorker } from '../worker/run-self-hosted-worker.js'

const env = validateSprint2aLiveEnv()

const ctrl = new AbortController()
process.once('SIGTERM', () => ctrl.abort())
process.once('SIGINT', () => ctrl.abort())

console.log('Starting self-hosted worker...')
try {
  await runSelfHostedWorker({
    environmentKey: env.ANTHROPIC_ENVIRONMENT_KEY,
    signal: ctrl.signal,
  })
} catch (err) {
  if ((err as Error)?.name !== 'AbortError') {
    console.error('Worker error:', err)
    process.exit(1)
  }
}
console.log('Worker stopped.')
