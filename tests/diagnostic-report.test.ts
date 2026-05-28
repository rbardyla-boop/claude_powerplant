import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { writeDiagnosticReport, RUNTIME_VERSIONS } from '../src/diagnostics/diagnostic-report.js'
import type { DiagnosticReport } from '../src/diagnostics/diagnostic-report.js'

function makeReport(overrides: Partial<DiagnosticReport> = {}): DiagnosticReport {
  return {
    sprintId: 'sprint3s',
    runId: 'test-run-001',
    timestamp: '2026-05-27T00:00:00.000Z',
    versions: RUNTIME_VERSIONS,
    findings: [],
    openQuestions: [],
    clearedForRealProjectMounting: false,
    clearedForSanitizedExternalProjectInput: false,
    ...overrides,
  }
}

describe('writeDiagnosticReport', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'powerplant-diag-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes a JSON file to the reports dir', () => {
    const report = makeReport()
    const outPath = writeDiagnosticReport(report, tmpDir)
    expect(fs.existsSync(outPath)).toBe(true)
  })

  it('creates the reports dir if it does not exist', () => {
    const nested = path.join(tmpDir, 'sub', 'dir')
    const report = makeReport()
    writeDiagnosticReport(report, nested)
    expect(fs.existsSync(nested)).toBe(true)
  })

  it('produces valid JSON with the expected shape', () => {
    const report = makeReport({
      findings: [{ probe: 'A', variant: 'allow', status: 'CONFORMANT', summary: 'ok', evidence: {} }],
      openQuestions: ['question one'],
    })
    const outPath = writeDiagnosticReport(report, tmpDir)
    const parsed = JSON.parse(fs.readFileSync(outPath, 'utf-8')) as DiagnosticReport
    expect(parsed.sprintId).toBe('sprint3s')
    expect(parsed.clearedForRealProjectMounting).toBe(false)
    expect(parsed.clearedForSanitizedExternalProjectInput).toBe(false)
    expect(parsed.findings).toHaveLength(1)
    expect(parsed.openQuestions).toHaveLength(1)
  })

  it('includes timestamp in the filename', () => {
    const report = makeReport({ timestamp: '2026-05-27T12-34-56.789Z' })
    const outPath = writeDiagnosticReport(report, tmpDir)
    expect(path.basename(outPath)).toContain('sprint3s-diagnostic-')
  })
})

describe('RUNTIME_VERSIONS', () => {
  it('has the expected ant worker version for sprint3s diagnostic runs', () => {
    expect(RUNTIME_VERSIONS.antWorkerVersion).toBe('1.9.1')
  })

  it('has the expected sdk version', () => {
    expect(RUNTIME_VERSIONS.anthropicSdkVersion).toBe('0.98.0')
  })

  it('has a non-empty docker image tag', () => {
    expect(RUNTIME_VERSIONS.dockerImageTag).toBeTruthy()
  })

  it('has node version from process.version', () => {
    expect(RUNTIME_VERSIONS.nodeVersion).toBe(process.version)
  })
})
