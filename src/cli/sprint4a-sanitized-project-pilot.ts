import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { validateSprint4aLiveEnv } from '../config/env.js'
import { SPRINT4A_REPORTS_DIR } from '../config/constants.js'
import { ensureSprint4aAgent } from '../provision/ensure-sprint4a-agent.js'
import { runSanitizedProjectPilot } from '../sessions/run-sanitized-project-pilot.js'

const env = validateSprint4aLiveEnv()
const controlClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

console.log()
console.log('=== Sprint 4A: Sanitized External Pilot Project Adapter ===')
console.log()

const state = await ensureSprint4aAgent(controlClient)
if (!state.agent) throw new Error('Sprint 4A agent provisioning incomplete')

const report = await runSanitizedProjectPilot({ controlClient, state })

// Save report (no raw secrets — contains only paths, counts, booleans)
const reportsDir = path.join(process.cwd(), SPRINT4A_REPORTS_DIR)
fs.mkdirSync(reportsDir, { recursive: true })
const ts = report.timestamp.replace(/[:.]/g, '-')
const reportPath = path.join(reportsDir, `sprint4a-pilot-${ts}.json`)
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')

console.log()
console.log(`[sprint4a] report: ${reportPath}`)
console.log()
console.log('=== Sprint 4A Results ===')
console.log()
console.log(`  runId:                   ${report.runId}`)
console.log(`  agentId:                 ${report.agentId}`)
console.log(`  sessionId:               ${report.session.sessionId}`)
console.log(`  builtinToolUseCount:     ${report.session.builtinToolUseCount}`)
console.log(`  customToolCounts:        ${JSON.stringify(report.session.customToolCounts)}`)
console.log(`  finalResponseCorrect:    ${report.session.finalResponseCorrect}`)
console.log()

if (report.verification) {
  console.log('Verification:')
  console.log(`  checkId:     ${report.verification.checkId}`)
  console.log(`  fixedAction: ${report.verification.fixedAction}`)
  console.log(`  exitCode:    ${report.verification.exitCode}`)
  console.log(`  passed:      ${report.verification.passed}`)
  console.log()
}

if (report.patch) {
  console.log('Patch package:')
  console.log(`  patchDir:  ${report.patch.patchDir}`)
  console.log(`  files:     ${report.patch.patchFiles.join(', ')}`)
  console.log()
}

console.log('Source integrity:')
console.log(`  sourceUnmodified:  ${report.sourceUnmodified}`)
console.log()

console.log('Invariants:')
console.log(`  clearedForRealProjectMounting:           ${report.invariants.clearedForRealProjectMounting}`)
console.log(`  clearedForSanitizedExternalProjectInput: ${report.invariants.clearedForSanitizedExternalProjectInput}`)
console.log(`  clearedForGeneratedExternalPilot:        ${report.invariants.clearedForGeneratedExternalPilot}`)
console.log()

if (report.passed) {
  console.log('Sprint 4A: PASSED — sanitized pilot adapter complete.')
  console.log()
  console.log('IMPORTANT: The patch has NOT been applied to the source project.')
  console.log(`To review: cat ${report.patch?.patchDir}/PATCH.diff`)
} else {
  console.log('Sprint 4A: FAILED')
  if (!report.verification?.passed) {
    console.log('  • Verification check did not pass')
  }
  if (!report.sourceUnmodified) {
    console.log('  • Source project was modified during run')
  }
  if (!report.session.finalResponseCorrect) {
    console.log(`  • Final response wrong: "${report.session.finalResponse}"`)
  }
  if (report.session.builtinToolUseCount > 0) {
    console.log(`  • Built-in tools used: ${report.session.builtinToolUseCount} (expected 0)`)
  }
  process.exit(1)
}
console.log()
