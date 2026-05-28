import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { validateSprint3tLiveEnv } from '../config/env.js'
import {
  SPRINT3T_RUNTIME_BASE,
  SPRINT3T_BASH_PROBE_FINAL_RESPONSE,
  SPRINT3T_WRITE_PROBE_FINAL_RESPONSE,
} from '../config/constants.js'
import { ensureSprint3tAgents } from '../provision/ensure-sprint3t-agents.js'
import { runSdkApprovalAllowDiagnostic } from '../sessions/run-sdk-approval-allow-diagnostic.js'
import { runSdkApprovalDenyDiagnostic } from '../sessions/run-sdk-approval-deny-diagnostic.js'
import { runIsolatedWritePathDiagnostic } from '../sessions/run-isolated-write-path-diagnostic.js'
import type { DiagnosticFinding } from '../diagnostics/diagnostic-report.js'

const env = validateSprint3tLiveEnv()
const runId = `sprint3t-${Date.now()}`
const runtimeBase = path.join(process.cwd(), SPRINT3T_RUNTIME_BASE, runId)

const controlClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

function makeWorkdir(label: string): string {
  const dir = path.join(runtimeBase, label)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

console.log()
console.log('=== Sprint 3T: Queue-Isolated SDK Worker Selection Gate ===')
console.log(`  run: ${runId}`)
console.log()

const state = await ensureSprint3tAgents(controlClient)
const { bashProbe, writeProbe } = state.agents
if (!bashProbe || !writeProbe) throw new Error('Agent provisioning incomplete')

const findings: DiagnosticFinding[] = []

// ── Probe A — SDK always_ask allow ──────────────────────────────────────────
console.log('--- Probe A (allow): SDK always_ask confirmation gate ---')
const allowWorkdir = makeWorkdir('probe-a-allow')
try {
  const finding = await runSdkApprovalAllowDiagnostic({
    controlClient,
    environmentKey: env.ANTHROPIC_ENVIRONMENT_KEY,
    agentId: bashProbe.id,
    agentVersion: bashProbe.version,
    environmentId: state.environmentId,
    workdir: allowWorkdir,
  })
  findings.push(finding)
  console.log(`  → ${finding.status}: ${finding.summary}`)
} catch (err) {
  console.error(`  → ERROR: ${(err as Error).message}`)
  findings.push({
    probe: 'A',
    variant: 'sdk-allow',
    status: 'INCONCLUSIVE',
    summary: `ERROR: ${(err as Error).message}`,
    evidence: {},
  })
}

// ── Probe B — SDK always_ask deny ────────────────────────────────────────────
console.log()
console.log('--- Probe B (deny): SDK always_ask deny path ---')
const denyWorkdir = makeWorkdir('probe-b-deny')
try {
  const finding = await runSdkApprovalDenyDiagnostic({
    controlClient,
    environmentKey: env.ANTHROPIC_ENVIRONMENT_KEY,
    agentId: bashProbe.id,
    agentVersion: bashProbe.version,
    environmentId: state.environmentId,
    workdir: denyWorkdir,
  })
  findings.push(finding)
  console.log(`  → ${finding.status}: ${finding.summary}`)
} catch (err) {
  console.error(`  → ERROR: ${(err as Error).message}`)
  findings.push({
    probe: 'B',
    variant: 'sdk-deny',
    status: 'INCONCLUSIVE',
    summary: `ERROR: ${(err as Error).message}`,
    evidence: {},
  })
}

// ── Probe C — isolated write path ─────────────────────────────────────────────
console.log()
console.log('--- Probe C: isolated write path contract ---')
const writeWorkdir = makeWorkdir('probe-c-write')
try {
  const finding = await runIsolatedWritePathDiagnostic({
    controlClient,
    environmentKey: env.ANTHROPIC_ENVIRONMENT_KEY,
    agentId: writeProbe.id,
    agentVersion: writeProbe.version,
    environmentId: state.environmentId,
    workdir: writeWorkdir,
  })
  findings.push(finding)
  console.log(`  → ${finding.status}: ${finding.summary}`)
} catch (err) {
  console.error(`  → ERROR: ${(err as Error).message}`)
  findings.push({
    probe: 'C',
    variant: 'sdk-write-path',
    status: 'INCONCLUSIVE',
    summary: `ERROR: ${(err as Error).message}`,
    evidence: {},
  })
}

// ── Report ────────────────────────────────────────────────────────────────────
const report = {
  sprintId: 'sprint3t',
  runId,
  timestamp: new Date().toISOString(),
  expectedFinalResponses: {
    bashProbe: SPRINT3T_BASH_PROBE_FINAL_RESPONSE,
    writeProbe: SPRINT3T_WRITE_PROBE_FINAL_RESPONSE,
  },
  findings,
  openQuestions: [] as string[],
  clearedForRealProjectMounting: false as const,
  clearedForSanitizedExternalProjectInput: false as const,
}

const reportsDir = path.join(process.cwd(), '.powerplant/reports')
fs.mkdirSync(reportsDir, { recursive: true })
const ts = report.timestamp.replace(/[:.]/g, '-')
const reportPath = path.join(reportsDir, `sprint3t-sdk-worker-${ts}.json`)
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')
console.log()
console.log(`[sprint3t] report: ${reportPath}`)

// ── Summary ───────────────────────────────────────────────────────────────────
console.log()
console.log('=== Sprint 3T Results ===')
for (const f of findings) {
  console.log(`  Probe ${f.probe} (${f.variant}): ${f.status}`)
  console.log(`    ${f.summary}`)
}
console.log()
console.log('Security invariants:')
console.log(`  clearedForRealProjectMounting: ${report.clearedForRealProjectMounting}`)
console.log(`  clearedForSanitizedExternalProjectInput: ${report.clearedForSanitizedExternalProjectInput}`)
console.log()
