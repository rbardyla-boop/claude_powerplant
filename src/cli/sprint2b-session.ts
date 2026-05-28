import { validateLiveEnv } from '../config/env.js'
import { createClient } from '../platform/client.js'
import { runSprint2bOutputProbe } from '../sessions/run-sprint2b-output-probe.js'

validateLiveEnv()
const client = createClient()

console.log('\n=== Sprint 2B: Container Output Probe ===')
const result = await runSprint2bOutputProbe(client)

if (result.passed) {
  console.log('\nSprint 2B: PASSED')
  console.log(`  session:       ${result.sessionId}`)
  console.log(`  environmentId: ${result.environmentId}`)
  console.log(`  fileContent:   "${result.fileContent}"`)
  console.log(`  finalText:     "${result.finalAgentText}"`)
} else {
  console.error('\nSprint 2B: FAILED')
  console.error(`  reason: ${result.failureReason}`)
  process.exit(1)
}
