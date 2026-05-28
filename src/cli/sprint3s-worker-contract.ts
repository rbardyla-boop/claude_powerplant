import Anthropic from '@anthropic-ai/sdk'
import path from 'path'
import { ensureSprint3sAgents } from '../provision/ensure-sprint3s-agents.js'
import { runAntAlwaysAskDiagnostic } from '../sessions/run-ant-always-ask-diagnostic.js'
import { runOutputPathDiagnostic } from '../sessions/run-output-path-diagnostic.js'
import { runBashOutputDiagnostic } from '../sessions/run-bash-output-diagnostic.js'
import { writeDiagnosticReport, RUNTIME_VERSIONS } from '../diagnostics/diagnostic-report.js'
import type { DiagnosticReport, DiagnosticFinding } from '../diagnostics/diagnostic-report.js'
import {
  SPRINT3S_WORKDIR,
  SPRINT3S_RUNTIME_BASE,
  SPRINT3S_REPORTS_DIR,
} from '../config/constants.js'

async function main(): Promise<void> {
  const client = new Anthropic()
  const runId = `sprint3s-${Date.now()}`
  const timestamp = new Date().toISOString()

  console.log('\n=== Sprint 3S: Worker Contract Reconciliation ===')
  console.log(`  run: ${runId}`)
  console.log(`  ant worker version: ${RUNTIME_VERSIONS.antWorkerVersion}`)
  console.log(`  sdk version: ${RUNTIME_VERSIONS.anthropicSdkVersion}`)
  console.log(`  node: ${RUNTIME_VERSIONS.nodeVersion}`)
  console.log()

  const state = await ensureSprint3sAgents(client)
  const { permissionProbe, outputProbe, bashProbe } = state.agents

  const workspacesDir = path.join(process.cwd(), SPRINT3S_WORKDIR)
  const runtimeBase = path.join(process.cwd(), SPRINT3S_RUNTIME_BASE)
  const reportsDir = path.join(process.cwd(), SPRINT3S_REPORTS_DIR)

  const findings: DiagnosticFinding[] = []
  const openQuestions: string[] = []

  // --- Probe A: always_ask conformance (allow variant) ---
  console.log('\n--- Probe A (allow): always_ask conformance test ---')
  try {
    const resultAllow = await runAntAlwaysAskDiagnostic(
      client,
      permissionProbe!.id,
      permissionProbe!.version,
      state.environmentId,
      'allow',
      workspacesDir,
    )
    findings.push(resultAllow.finding)
    printFinding(resultAllow.finding)
  } catch (err) {
    console.error(`[probe-a-allow] error: ${(err as Error).message}`)
    findings.push({
      probe: 'A', variant: 'allow', status: 'INCONCLUSIVE',
      summary: `Error during probe: ${(err as Error).message}`,
      evidence: {},
    })
    openQuestions.push('Probe A (allow) threw an error — could not classify conformance.')
  }

  // --- Probe A: always_ask conformance (deny variant) ---
  console.log('\n--- Probe A (deny): always_ask deny-path test ---')
  try {
    const resultDeny = await runAntAlwaysAskDiagnostic(
      client,
      permissionProbe!.id,
      permissionProbe!.version,
      state.environmentId,
      'deny',
      workspacesDir,
    )
    findings.push(resultDeny.finding)
    printFinding(resultDeny.finding)
  } catch (err) {
    console.error(`[probe-a-deny] error: ${(err as Error).message}`)
    findings.push({
      probe: 'A', variant: 'deny', status: 'INCONCLUSIVE',
      summary: `Error during probe: ${(err as Error).message}`,
      evidence: {},
    })
    openQuestions.push('Probe A (deny) threw an error — deny-path conformance unknown.')
  }

  // --- Probe C: output path contract ---
  console.log('\n--- Probe C: output path contract test ---')
  try {
    const resultC = await runOutputPathDiagnostic(
      client,
      outputProbe!.id,
      outputProbe!.version,
      state.environmentId,
      workspacesDir,
      runtimeBase,
    )
    findings.push(resultC.finding)
    printFinding(resultC.finding)
    if (!resultC.compliance.c1FileFoundOnHost) {
      openQuestions.push('/mnt/session/outputs absolute write did not produce a file on the host — documented contract path may not be available in container.')
    }
  } catch (err) {
    console.error(`[probe-c] error: ${(err as Error).message}`)
    findings.push({
      probe: 'C', variant: 'output-path', status: 'INCONCLUSIVE',
      summary: `Error during probe: ${(err as Error).message}`,
      evidence: {},
    })
    openQuestions.push('Probe C threw an error — output path contract could not be tested.')
  }

  // --- Probe D: bash output fallback ---
  console.log('\n--- Probe D: bash redirect to /mnt/session/outputs ---')
  try {
    const resultD = await runBashOutputDiagnostic(
      client,
      bashProbe!.id,
      bashProbe!.version,
      state.environmentId,
      workspacesDir,
      runtimeBase,
    )
    findings.push(resultD.finding)
    printFinding(resultD.finding)
    if (!resultD.fileFoundOnHost) {
      openQuestions.push('Probe D: bash redirect to /mnt/session/outputs produced no file on host — path may not be mounted or accessible.')
    }
  } catch (err) {
    console.error(`[probe-d] error: ${(err as Error).message}`)
    findings.push({
      probe: 'D', variant: 'bash-output', status: 'INCONCLUSIVE',
      summary: `Error during probe: ${(err as Error).message}`,
      evidence: {},
    })
    openQuestions.push('Probe D threw an error — bash output path could not be tested.')
  }

  // --- Write diagnostic report ---
  const report: DiagnosticReport = {
    sprintId: 'sprint3s',
    runId,
    timestamp,
    versions: RUNTIME_VERSIONS,
    findings,
    openQuestions,
    clearedForRealProjectMounting: false,
    clearedForSanitizedExternalProjectInput: false,
  }

  const reportPath = writeDiagnosticReport(report, reportsDir)
  console.log(`\n[sprint3s] report: ${reportPath}`)

  // --- Summary ---
  console.log('\n=== Sprint 3S Results ===')
  for (const f of findings) {
    console.log(`  Probe ${f.probe} (${f.variant}): ${f.status}`)
    console.log(`    ${f.summary}`)
  }

  if (openQuestions.length > 0) {
    console.log('\nOpen questions:')
    for (const q of openQuestions) {
      console.log(`  - ${q}`)
    }
  }

  console.log('\nSecurity invariants:')
  console.log('  clearedForRealProjectMounting: false')
  console.log('  clearedForSanitizedExternalProjectInput: false')
  console.log()
}

function printFinding(f: DiagnosticFinding): void {
  console.log(`  → ${f.status}: ${f.summary}`)
}

main().catch(err => {
  console.error('Sprint 3S fatal error:', err)
  process.exit(1)
})
