import { validateLiveEnv } from '../config/env.js'
import { createClient } from '../platform/client.js'
import { runCloudOutputAllowSmoke } from '../sessions/run-cloud-output-allow-smoke.js'
import { runCloudOutputDenySmoke } from '../sessions/run-cloud-output-deny-smoke.js'

validateLiveEnv()
const client = createClient()

console.log('\n=== Sprint 1B: Allow Path ===')
const allowResult = await runCloudOutputAllowSmoke(client)

console.log('\n=== Sprint 1B: Deny Path ===')
const denyResult = await runCloudOutputDenySmoke(client)

console.log('\n=== Sprint 1B Summary ===')

if (allowResult.passed) {
  console.log('Allow path: PASSED')
  console.log(`  session:         ${allowResult.sessionId}`)
  console.log(`  writeApproved:   ${allowResult.writeApproved}`)
  console.log(`  outputVerified:  ${allowResult.outputVerified}`)
  console.log(`  filename:        ${allowResult.filename}`)
  console.log(`  finalText:       "${allowResult.finalAgentText}"`)
} else {
  console.error('Allow path: FAILED')
  console.error(`  reason: ${allowResult.failureReason}`)
}

if (denyResult.passed) {
  console.log('Deny path:  PASSED')
  console.log(`  session:          ${denyResult.sessionId}`)
  console.log(`  writeDenied:      ${denyResult.writeDenied}`)
  console.log(`  noOutputVerified: ${denyResult.noOutputVerified}`)
} else {
  console.error('Deny path: FAILED')
  console.error(`  reason: ${denyResult.failureReason}`)
}

if (!allowResult.passed || !denyResult.passed) {
  process.exit(1)
}
