import fs from 'fs'
import path from 'path'
import os from 'os'
import { loadProjectContract } from '../../projects/load-project-contract.js'
import { previewSanitization } from '../../projects/preview-sanitization.js'
import {
  createVerificationWorkspace,
  checkSourceModified,
} from '../../verification/create-verification-workspace.js'
import { executeChecksWithProfile } from '../../verification/run-approved-checks.js'
import { resolveVerificationProfile } from '../../verification/verification-profiles.js'
import { printVerifyReport } from '../terminal-output.js'
import type {
  VerificationReport,
  OverallVerdict,
  CheckResult,
} from '../../contracts/verification-preflight-report.js'

const VERIFICATIONS_HOME = path.join(os.homedir(), '.powerplant', 'verifications')

function resolveProjectPath(rawPath: string): string {
  const abs = path.resolve(rawPath)
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

function deriveOverallVerdict(checks: CheckResult[]): OverallVerdict {
  // Advisory checks (required: false) are recorded but never block the verdict.
  const required = checks.filter(c => c.advisory !== true)
  if (required.some(c => c.verdict === 'FAIL_BOUNDARY')) return 'FAIL_BOUNDARY'
  if (required.some(c => c.verdict === 'BLOCKED_MISSING_TOOLING')) return 'BLOCKED_MISSING_TOOLING'
  if (required.some(c => c.verdict === 'FAIL_VERIFICATION_INTEGRITY')) return 'FAIL_VERIFICATION_INTEGRITY'
  if (required.some(c => c.verdict === 'FAIL_CHECK')) return 'FAIL_CHECK'
  return 'PASS'
}

function saveReport(report: VerificationReport): string {
  const dir = path.join(VERIFICATIONS_HOME, report.projectId)
  fs.mkdirSync(dir, { recursive: true })
  const ts = report.verifiedAt.replace(/[:.]/g, '-')
  const reportPath = path.join(dir, `${ts}.json`)
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')
  return reportPath
}

export async function cmdVerify(projectPath: string): Promise<void> {
  // 1. Resolve and validate project path.
  let absPath: string
  try {
    absPath = resolveProjectPath(projectPath)
  } catch (err) {
    console.error(`Error: ${String(err).replace('Error: ', '')}`)
    process.exit(1)
  }

  // 2. Load and validate contract.
  let contract
  try {
    contract = loadProjectContract(absPath)
  } catch (err) {
    console.error(`Error: Contract load failed — ${String(err).replace('Error: ', '')}`)
    process.exit(1)
  }

  // 2b. Resolve verification profile early to fail fast on unknown profile IDs.
  const profileId = contract.verificationProfile
  if (profileId !== null) {
    try {
      resolveVerificationProfile(profileId)
    } catch (err) {
      console.error(`Error: ${String(err).replace('Error: ', '')}`)
      process.exit(1)
    }
  }

  // 3. Sanitization preview — refuse if snapshot would contain forbidden content.
  let preview
  try {
    preview = previewSanitization(contract)
  } catch (err) {
    console.error(`Error during sanitization preview: ${String(err)}`)
    process.exit(1)
  }

  if (!preview.allForbiddenAbsent) {
    console.error('Error: Sanitization preview FAIL — forbidden content would enter snapshot.')
    for (const p of preview.forbiddenDetected) {
      console.error(`  - ${p}`)
    }
    process.exit(1)
  }

  // 4. Create disposable sanitized workspace (original project never mounted).
  let workspace
  try {
    workspace = createVerificationWorkspace(contract)
  } catch (err) {
    console.error(`Error: ${String(err).replace('Error: ', '')}`)
    process.exit(1)
  }

  // 5–8. Execute approved checks via shared routing (capsule or plain).
  let checkResults: CheckResult[] = []
  try {
    checkResults = await executeChecksWithProfile(
      workspace.workspacePath,
      contract.allowedChecks,
      profileId,
    )
  } finally {
    // Workspace is always cleaned up — disposable by contract.
    workspace.cleanup()
  }

  // 9. Verify source-project hashes are unchanged.
  const sourceProjectModified = checkSourceModified(workspace.sourceManifest)

  const verdict = deriveOverallVerdict(checkResults)

  // Resolve profile metadata for the report (null when no profile declared).
  const resolvedProfile = profileId !== null ? resolveVerificationProfile(profileId) : null

  const report: VerificationReport = {
    verifiedAt: new Date().toISOString(),
    projectId: contract.projectId,
    projectPath: absPath,
    contractValid: true,
    sanitizationPassed: preview.allForbiddenAbsent,
    workspaceMode: 'sanitized_copy_only',
    originalProjectMounted: false,
    projectNodeModulesMounted: false,
    credentialsPassedToExecutor: false,
    agentVisibleNodeModules: false,
    liveAgentSession: false,
    executorNetwork: 'disabled',
    verificationProfileId: profileId,
    capsuleImageId: resolvedProfile?.capsuleImageName ?? null,
    capsuleToolchainVersions: resolvedProfile?.toolchainPackageVersions ?? null,
    checks: checkResults,
    verdict,
    sourceProjectModified,
  }

  // 10. Write machine-readable report.
  const reportPath = saveReport(report)

  // 11. Print human-readable result.
  printVerifyReport(report, reportPath)

  if (verdict !== 'PASS') {
    process.exit(1)
  }
}
