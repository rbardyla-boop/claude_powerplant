import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { validateSprint3uLiveEnv } from '../config/env.js'
import { SPRINT3U_RUNTIME_BASE } from '../config/constants.js'
import { ensureSprint3uAgent } from '../provision/ensure-sprint3u-agent.js'
import { runSprint3uBoundaryDiagnostic } from '../sessions/run-sdk-boundary-diagnostic.js'

const env = validateSprint3uLiveEnv()
const controlClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

console.log()
console.log('=== Sprint 3U: Credential Isolation + Egress Containment Gate ===')
console.log()

const state = await ensureSprint3uAgent(controlClient)
if (!state.agent) throw new Error('Sprint 3U agent provisioning incomplete')

const runtimeBase = path.join(process.cwd(), SPRINT3U_RUNTIME_BASE)
fs.mkdirSync(runtimeBase, { recursive: true })

const report = await runSprint3uBoundaryDiagnostic({
  controlClient,
  environmentKey: env.ANTHROPIC_ENVIRONMENT_KEY,
  state,
  runtimeBase,
})

// Save report
const reportsDir = path.join(process.cwd(), '.powerplant/reports')
fs.mkdirSync(reportsDir, { recursive: true })
const ts = report.timestamp.replace(/[:.]/g, '-')
const reportPath = path.join(reportsDir, `sprint3u-boundary-${ts}.json`)
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')
console.log()
console.log(`[sprint3u] report: ${reportPath}`)

// Summary
console.log()
console.log('=== Sprint 3U Results ===')
console.log()
console.log(`Branch: ${report.summary.branch}`)
console.log()
console.log('Credential isolation:')
console.log(`  K1 ANTHROPIC_API_KEY absent:          ${report.probes.envVisibility?.credentialBoundary.k1ApiKeyAbsent ?? 'unknown'}`)
console.log(`  K2 worker canary absent:              ${report.probes.envVisibility?.credentialBoundary.k2WorkerCanaryAbsent ?? 'unknown'}`)
console.log(`  K3 ANTHROPIC_ENVIRONMENT_KEY absent:  ${report.probes.envVisibility?.credentialBoundary.k3EnvironmentKeyAbsent ?? 'unknown'}`)
console.log(`  credentialBoundaryPassed:             ${report.summary.credentialBoundaryPassed}`)
console.log()
console.log('Egress containment:')
console.log(`  httpClientAvailable:   ${report.probes.egressSink?.httpClientAvailable ?? 'unknown'}`)
console.log(`  canaryReceived:        ${report.probes.egressSink?.canaryReceived ?? 'unknown'}`)
console.log(`  arbitraryEgressBlocked: ${report.summary.arbitraryEgressBlocked}`)
console.log()
console.log('Approved output:')
console.log(`  outputFileFound:    ${report.probes.outputPreservation?.outputFileFound ?? 'unknown'}`)
console.log(`  contentCorrect:     ${report.probes.outputPreservation?.outputContentCorrect ?? 'unknown'}`)
console.log(`  approvedOutputWorks: ${report.summary.approvedOutputWorks}`)
console.log()
console.log('Architecture:')
console.log(`  requiresBrokerExecutorSplit:       ${report.summary.requiresBrokerExecutorSplit}`)
console.log(`  requiresNetworkEgressHardening:    ${report.summary.requiresNetworkEgressHardening}`)
console.log()
console.log('Security invariants:')
console.log(`  clearedForRealProjectMounting:            ${report.invariants.clearedForRealProjectMounting}`)
console.log(`  clearedForSanitizedExternalProjectInput:  ${report.invariants.clearedForSanitizedExternalProjectInput}`)
console.log()

if (report.summary.branch === 'A') {
  console.log('Sprint 3U: PASSED — contained self-hosted builder boundary proven.')
} else {
  const reasons: string[] = []
  if (report.summary.requiresBrokerExecutorSplit) {
    reasons.push('Bash inherits worker env vars (Branch B) — broker/executor split required')
  }
  if (report.summary.requiresNetworkEgressHardening) {
    reasons.push('Arbitrary egress succeeded (Branch C) — network isolation required')
  }
  console.log('Sprint 3U: NOT PASSED')
  for (const r of reasons) {
    console.log(`  • ${r}`)
  }
}
console.log()
