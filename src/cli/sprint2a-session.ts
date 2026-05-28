import { validateLiveEnv } from '../config/env.js'
import { createClient } from '../platform/client.js'
import { runSelfHostedOutputProbe } from '../sessions/run-self-hosted-output-probe.js'

validateLiveEnv()
const client = createClient()

console.log('\n=== Sprint 2A: Self-Hosted Output Probe ===')
const result = await runSelfHostedOutputProbe(client)

if (result.passed) {
  console.log('\nSprint 2A: PASSED')
  console.log(`  session:      ${result.sessionId}`)
  console.log(`  environmentId:${result.environmentId}`)
  console.log(`  fileContent:  "${result.fileContent}"`)
  console.log(`  finalText:    "${result.finalAgentText}"`)
} else {
  console.error('\nSprint 2A: FAILED')
  console.error(`  reason: ${result.failureReason}`)
  process.exit(1)
}
