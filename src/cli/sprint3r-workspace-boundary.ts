import path from 'path'
import { validateLiveEnv } from '../config/env.js'
import { createClient } from '../platform/client.js'
import { runSprint3rWorkspaceBoundary } from '../sessions/run-sprint3r-workspace-boundary.js'

validateLiveEnv()
const client = createClient()

const fixtureSourcePath = path.resolve(process.cwd(), 'fixtures/mount-boundary-project')

console.log('\n=== Sprint 3R: Sanitized Workspace Boundary Proof ===')
console.log(`  fixture: ${fixtureSourcePath}`)

const result = await runSprint3rWorkspaceBoundary(client, fixtureSourcePath)

if (result.passed) {
  console.log('\nSprint 3R: PASSED')
  console.log(`  sanitizedWorkspace:               ${result.sanitizedWorkspacePath}`)
  console.log(`  permittedTokenRead:                ${result.permittedTokenRead}  (${result.tokenContent})`)
  console.log(`  forbiddenPathsAbsent:              ${result.forbiddenPathsAbsent}`)
  console.log(`  forbiddenCanariesAbsent:           ${result.forbiddenCanariesAbsent}`)
  console.log(`  sourceUnmodified:                  ${result.sourceUnmodified}`)
  console.log(`  unapprovedToolCallsExecuted:       ${result.unapprovedToolCallsExecuted}`)
  console.log(`  clearedForRealProjectMounting:     ${result.clearedForRealProjectMounting}`)
} else {
  console.error('\nSprint 3R: FAILED')
  console.error(`  reason: ${result.failureReason}`)
  process.exit(1)
}
