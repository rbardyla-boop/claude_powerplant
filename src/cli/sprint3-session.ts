import { validateLiveEnv } from '../config/env.js'
import { createClient } from '../platform/client.js'
import { runSprint3ProjectProbe } from '../sessions/run-sprint3-project-probe.js'

validateLiveEnv()
const client = createClient()

console.log('\n=== Sprint 3: Project Probe ===')
const result = await runSprint3ProjectProbe(client)

if (result.passed) {
  console.log('\nSprint 3: PASSED')
  console.log(`  session:       ${result.sessionId}`)
  console.log(`  environmentId: ${result.environmentId}`)
  console.log(`  fileContent:   "${result.fileContent}"`)
  console.log(`  finalText:     "${result.finalAgentText}"`)
} else {
  console.error('\nSprint 3: FAILED')
  console.error(`  reason: ${result.failureReason}`)
  process.exit(1)
}
