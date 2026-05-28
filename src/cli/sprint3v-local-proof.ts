/**
 * Local Docker executor proof — no live API call.
 * Builds and runs the isolated executor container directly through the broker
 * launcher to verify all containment properties before involving Claude.
 */
import fs from 'fs'
import path from 'path'
import { SPRINT3V_RUNTIME_BASE, SPRINT3V_WORKER_CANARY_KEY, SPRINT3V_WORKER_CANARY_VALUE } from '../config/constants.js'
import { runIsolatedExecutor } from '../broker/run-isolated-executor.js'
import { validateIsolationProof } from '../diagnostics/isolation-proof-report.js'

const runtimeBase = SPRINT3V_RUNTIME_BASE
const runId = `local-${Date.now()}`
const outputDir = path.join(runtimeBase, runId, 'outputs')
fs.mkdirSync(outputDir, { recursive: true })

console.log()
console.log('=== Sprint 3V Local Docker Executor Proof ===')
console.log()
console.log('Launching isolated executor container...')
console.log(`Output dir: ${outputDir}`)
console.log()

// Set a worker-secret canary in THIS process env to prove it doesn't leak
process.env[SPRINT3V_WORKER_CANARY_KEY] = SPRINT3V_WORKER_CANARY_VALUE

let result: Awaited<ReturnType<typeof runIsolatedExecutor>>
try {
  result = await runIsolatedExecutor(outputDir)
} catch (err) {
  console.error('[local-proof] Executor failed:', (err as Error).message)
  process.exit(1)
}

console.log('Executor stdout:', JSON.stringify(result.stdout))
console.log()
console.log('Proof artifact:')
console.log(JSON.stringify(result.proof, null, 2))
console.log()
console.log(`sinkReceivedCanary: ${result.sinkReceivedCanary}`)
console.log()

const errors = validateIsolationProof(result.proof, result.sinkReceivedCanary)

if (errors.length === 0) {
  console.log('Local Docker proof: PASSED')
  console.log()
  console.log('Verified:')
  console.log('  - Executor ran with empty environment (no API key, no env key, no worker canary)')
  console.log('  - Executor network was isolated (egress failed, sink received nothing)')
  console.log('  - Executor ran as non-root')
  console.log('  - Output path operational')
  console.log()
} else {
  console.error('Local Docker proof: FAILED')
  for (const e of errors) {
    console.error(`  [${e.check}] ${e.detail}`)
  }
  process.exit(1)
}
