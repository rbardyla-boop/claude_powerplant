import path from 'path'
import { validateSprint2aLiveEnv } from '../config/env.js'
import { runContainerWorker } from '../worker/run-container-worker.js'
import { SPRINT3_WORKDIR } from '../config/constants.js'

const env = validateSprint2aLiveEnv()

// Mount fixtures/sample-project read-only at /project inside the container
const projectDir = path.resolve(process.cwd(), 'fixtures/sample-project')

const ctrl = new AbortController()
process.once('SIGTERM', () => ctrl.abort())
process.once('SIGINT', () => ctrl.abort())

console.log('Starting Sprint 3 container worker...')
console.log(`  project: ${projectDir}`)
try {
  await runContainerWorker({
    environmentKey: env.ANTHROPIC_ENVIRONMENT_KEY,
    workspacesDir: path.resolve(process.cwd(), SPRINT3_WORKDIR),
    projectDir,
    signal: ctrl.signal,
  })
} catch (err) {
  if ((err as Error)?.name !== 'AbortError') {
    console.error('Container worker error:', err)
    process.exit(1)
  }
}
console.log('Container worker stopped.')
