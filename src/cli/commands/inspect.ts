import fs from 'fs'
import path from 'path'
import os from 'os'
import { SPRINT4A_PILOT_CONTRACT } from '../../contracts/project-pilot-contract.js'
import {
  PILOT_ALLOWED_READ_PATHS,
  PILOT_ALLOWED_WRITE_PATHS,
  PILOT_ALLOWED_CHECK_IDS,
} from '../../contracts/project-pilot-contract.js'
import { previewSanitization } from '../../projects/preview-sanitization.js'
import { printInspectReport } from '../terminal-output.js'
import type { InspectionReport } from '../../contracts/inspection-report.js'

const INSPECTIONS_HOME = path.join(os.homedir(), '.powerplant', 'inspections')

function validateProjectPath(projectPath: string): string {
  const abs = path.resolve(projectPath)
  if (!fs.existsSync(abs)) {
    throw new Error(`Project path does not exist: ${abs}`)
  }
  if (!fs.statSync(abs).isDirectory()) {
    throw new Error(`Project path is not a directory: ${abs}`)
  }
  const policyFile = path.join(abs, '.powerplant', 'POLICY.yaml')
  if (!fs.existsSync(policyFile)) {
    throw new Error(
      `No .powerplant/POLICY.yaml found in: ${abs}\n` +
      'Only projects with a .powerplant/ contract folder are supported.',
    )
  }
  return abs
}

function saveInspectionReport(report: InspectionReport): string {
  const dir = path.join(INSPECTIONS_HOME, report.projectId)
  fs.mkdirSync(dir, { recursive: true })
  const ts = report.inspectedAt.replace(/[:.]/g, '-')
  const reportPath = path.join(dir, `${ts}.json`)
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')
  return reportPath
}

export async function cmdInspect(projectPath: string): Promise<void> {
  let absPath: string
  try {
    absPath = validateProjectPath(projectPath)
  } catch (err) {
    console.error(`Error: ${String(err).replace('Error: ', '')}`)
    process.exit(1)
  }

  const contract = { ...SPRINT4A_PILOT_CONTRACT, sourcePath: absPath }

  let preview
  try {
    preview = previewSanitization(contract)
  } catch (err) {
    console.error(`Error during sanitization preview: ${String(err)}`)
    process.exit(1)
  }

  const report: InspectionReport = {
    inspectedAt: new Date().toISOString(),
    projectPath: absPath,
    projectId: contract.projectId,
    contractValid: true,
    sanitizationPreview: {
      passed: preview.allForbiddenAbsent,
      includedFiles: preview.includedFiles,
      excludedFileCount: preview.excludedFiles.length,
      forbiddenDetected: preview.forbiddenDetected,
      allForbiddenAbsent: preview.allForbiddenAbsent,
    },
    policy: {
      workspaceMode: contract.workspaceMode,
      realProjectMounted: contract.realProjectMounted,
      allowedChecks: [...PILOT_ALLOWED_CHECK_IDS],
      allowedReadPaths: [...PILOT_ALLOWED_READ_PATHS],
      allowedWritePaths: [...PILOT_ALLOWED_WRITE_PATHS],
      forbiddenPaths: contract.excludePaths,
    },
    executorPolicy: {
      networkDisabled: true,
      noCredentials: true,
    },
  }

  printInspectReport(report)

  const reportPath = saveInspectionReport(report)
  console.log(`Inspection report: ${reportPath}`)
  console.log()
}
