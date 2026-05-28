import fs from 'fs'
import path from 'path'

export interface VersionInfo {
  antWorkerVersion: string
  anthropicSdkVersion: string
  nodeVersion: string
  dockerImageTag: string
  dockerImageDigest: string
}

export interface DiagnosticFinding {
  probe: string
  variant: string
  status: 'CONFORMANT' | 'ANOMALY' | 'INCONCLUSIVE'
  summary: string
  evidence: Record<string, unknown>
}

export interface DiagnosticReport {
  sprintId: 'sprint3s'
  runId: string
  timestamp: string
  versions: VersionInfo
  findings: DiagnosticFinding[]
  openQuestions: string[]
  clearedForRealProjectMounting: false
  clearedForSanitizedExternalProjectInput: false
}

export const RUNTIME_VERSIONS: VersionInfo = {
  antWorkerVersion: '1.9.1',
  anthropicSdkVersion: '0.98.0',
  nodeVersion: process.version,
  dockerImageTag: 'powerplant-sandbox:sprint2b',
  dockerImageDigest: '8f7946d52540',
}

export function writeDiagnosticReport(report: DiagnosticReport, reportsDir: string): string {
  fs.mkdirSync(reportsDir, { recursive: true })
  const ts = report.timestamp.replace(/[:.]/g, '-')
  const outPath = path.join(reportsDir, `sprint3s-diagnostic-${ts}.json`)
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8')
  return outPath
}
