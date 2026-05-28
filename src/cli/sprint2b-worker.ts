import { validateSprint2aLiveEnv } from '../config/env.js'
import { runContainerWorker } from '../worker/run-container-worker.js'

const env = validateSprint2aLiveEnv()

const ctrl = new AbortController()
process.once('SIGTERM', () => ctrl.abort())
process.once('SIGINT', () => ctrl.abort())

console.log('Starting container worker...')
try {
  await runContainerWorker({
    environmentKey: env.ANTHROPIC_ENVIRONMENT_KEY,
    signal: ctrl.signal,
  })
} catch (err) {
  if ((err as Error)?.name !== 'AbortError') {
    console.error('Container worker error:', err)
    process.exit(1)
  }
}
console.log('Container worker stopped.')
