import { validateLiveEnv } from '../config/env.js'
import { createClient } from '../platform/client.js'
import { runCloudLifecycleSmoke } from '../sessions/run-cloud-lifecycle-smoke.js'

const liveEnv = validateLiveEnv()
const client = createClient()

const result = await runCloudLifecycleSmoke(client, liveEnv.CLAUDE_POWERPLANT_MODEL_ID)

if (result.passed) {
  console.log('\nSprint 1A smoke PASSED')
  console.log(`  session:      ${result.sessionId}`)
  console.log(`  response:     "${result.responseText.trim()}"`)
  console.log(`  reusedAgent:  ${result.reusedAgent}`)
  console.log(`  reusedEnv:    ${result.reusedEnvironment}`)
  console.log(`  tool events:  ${result.toolUseCount}`)
} else {
  console.error('\nSprint 1A smoke FAILED')
  console.error(`  reason: ${result.failureReason}`)
  process.exit(1)
}
