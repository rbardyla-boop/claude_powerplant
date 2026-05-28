import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { validateSprint3vLiveEnv } from '../config/env.js'
import { SPRINT3V_RUNTIME_BASE, SPRINT3V_REPORTS_DIR } from '../config/constants.js'
import { ensureSprint3vAgent } from '../provision/ensure-sprint3v-agent.js'
import { runCustomExecutorProbeSession } from '../sessions/run-custom-executor-probe-session.js'

const env = validateSprint3vLiveEnv()
const controlClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

console.log()
console.log('=== Sprint 3V: Custom Tool Broker + Air-Gapped Executor Cell Proof ===')
console.log()

const state = await ensureSprint3vAgent(controlClient)
if (!state.agent) throw new Error('Sprint 3V agent provisioning incomplete')

const runtimeBase = SPRINT3V_RUNTIME_BASE
fs.mkdirSync(runtimeBase, { recursive: true })

const report = await runCustomExecutorProbeSession({
  controlClient,
  state,
  runtimeBase,
})

// Save report (no raw secrets — proof has presence booleans only)
const reportsDir = path.join(process.cwd(), SPRINT3V_REPORTS_DIR)
fs.mkdirSync(reportsDir, { recursive: true })
const ts = report.timestamp.replace(/[:.]/g, '-')
const reportPath = path.join(reportsDir, `sprint3v-isolated-executor-${ts}.json`)
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')

console.log()
console.log(`[sprint3v] report: ${reportPath}`)
console.log()
console.log('=== Sprint 3V Results ===')
console.log()
console.log('Session:')
console.log(`  sessionId:               ${report.session.sessionId}`)
console.log(`  customToolUseCount:      ${report.session.customToolUseCount}`)
console.log(`  builtinToolUseCount:     ${report.session.builtinToolUseCount}`)
console.log(`  finalResponseCorrect:    ${report.session.finalResponseCorrect}`)
console.log()
console.log('Executor proof:')
console.log(`  anthropicApiKeyPresent:        ${report.executor.proof.anthropicApiKeyPresent}`)
console.log(`  anthropicEnvironmentKeyPresent:${report.executor.proof.anthropicEnvironmentKeyPresent}`)
console.log(`  workerSecretCanaryPresent:     ${report.executor.proof.workerSecretCanaryPresent}`)
console.log(`  egressSucceeded:               ${report.executor.proof.egressSucceeded}`)
console.log(`  sinkReceivedCanary:            ${report.executor.sinkReceivedCanary}`)
console.log(`  executorIsNonRoot:             ${report.executor.proof.executorIsNonRoot}`)
console.log(`  executorUid:                   ${report.executor.proof.executorUid}`)
console.log(`  outputPathOperational:         ${report.executor.proof.outputPathOperational}`)
console.log()
console.log('Validation:')
console.log(`  credentialIsolationPassed:     ${report.validation.credentialIsolationPassed}`)
console.log(`  egressBlocked:                 ${report.validation.egressBlocked}`)
console.log(`  outputValidated:               ${report.validation.outputValidated}`)
console.log(`  executorIsNonRoot:             ${report.validation.executorIsNonRoot}`)
console.log(`  noSourceProjectMounted:        ${report.validation.noSourceProjectMounted}`)
console.log()
console.log('Invariants:')
console.log(`  clearedForRealProjectMounting:           ${report.invariants.clearedForRealProjectMounting}`)
console.log(`  clearedForSanitizedExternalProjectInput: ${report.invariants.clearedForSanitizedExternalProjectInput}`)
console.log()

if (report.validation.passed) {
  console.log('Sprint 3V: PASSED — air-gapped executor cell proof complete.')
} else {
  console.log('Sprint 3V: FAILED')
  if (!report.validation.credentialIsolationPassed) {
    console.log('  • Credential isolation failed — executor saw secrets')
  }
  if (!report.validation.egressBlocked) {
    console.log('  • Egress containment failed — executor reached prohibited sink')
  }
  if (!report.validation.outputValidated) {
    console.log('  • Output path not operational')
  }
  if (!report.session.finalResponseCorrect) {
    console.log(`  • Final response wrong: "${report.session.finalResponse}"`)
  }
  if (report.session.builtinToolUseCount > 0) {
    console.log(`  • Built-in tools used: ${report.session.builtinToolUseCount} (expected 0)`)
  }
  if (report.session.customToolUseCount !== 1) {
    console.log(`  • Custom tool use count: ${report.session.customToolUseCount} (expected 1)`)
  }
  process.exit(1)
}
console.log()
