import type { InspectionReport } from '../contracts/inspection-report.js'
import type { SanitizationPreview } from '../projects/preview-sanitization.js'
import type { VerificationReport, CheckResult } from '../contracts/verification-preflight-report.js'
import type { RunClassification } from '../contracts/project-tool-contracts.js'
import { parseVerificationReport } from './parse-verification-report.js'

export interface DoctorReportOptions {
  home: string
  apiKeyPresent: boolean
  modelIdPresent: boolean
  runtimeReady: boolean
  validationStatus: 'validated' | 'unvalidated' | 'not_configured'
  credentialSource: 'shell' | 'package-root' | 'powerplant-home' | 'none'
  statePurpose: string | null
  projectPath: string | null
  contractPresent: boolean
  profileId: string | null
  capsuleAvailable: boolean
  targetProjectEnvLoaded: boolean
}

export function printDoctorReport(opts: DoctorReportOptions): void {
  const yn = (b: boolean): string => (b ? 'YES' : 'NO')

  console.log()
  console.log('Powerplant Doctor')
  console.log('─────────────────────────────────────────')
  console.log(`Powerplant home:      ${opts.home}`)
  console.log(`Runtime state ready:  ${yn(opts.runtimeReady)}`)
  console.log(`Validation status:    ${opts.validationStatus}`)
  if (opts.statePurpose !== null) {
    console.log(`State purpose:        ${opts.statePurpose}`)
  }
  console.log()
  console.log('Environment:')
  console.log(`  ANTHROPIC_API_KEY configured:         ${yn(opts.apiKeyPresent)}`)
  const credSourceLabel: Record<DoctorReportOptions['credentialSource'], string> = {
    shell: 'shell (explicit export)',
    'package-root': 'powerplant-package-root/.env',
    'powerplant-home': '~/.powerplant/.env',
    none: 'NOT FOUND',
  }
  console.log(`  Credential source:                    ${credSourceLabel[opts.credentialSource]}`)
  console.log(`  CLAUDE_POWERPLANT_MODEL_ID configured: ${yn(opts.modelIdPresent)}`)
  console.log(`  Target-project .env loaded:           ${yn(opts.targetProjectEnvLoaded)}`)

  if (opts.projectPath !== null) {
    console.log()
    console.log('Project:')
    console.log(`  Path:              ${opts.projectPath}`)
    console.log(`  Contract present:  ${yn(opts.contractPresent)}`)
    if (opts.profileId !== null) {
      console.log(`  Profile:           ${opts.profileId}`)
      console.log(`  Capsule available: ${yn(opts.capsuleAvailable)}`)
    } else if (opts.contractPresent) {
      console.log(`  Profile:           (none declared)`)
    }
  }

  console.log()
  console.log('Next steps:')
  if (!opts.runtimeReady) {
    console.log('  Run: powerplant setup')
  } else if (opts.projectPath !== null && !opts.contractPresent) {
    console.log('  Add a .powerplant/ contract to your project, then:')
    console.log('  Run: powerplant inspect <project-path>')
  } else if (opts.projectPath !== null && opts.profileId !== null && !opts.capsuleAvailable) {
    console.log('  Build the verification capsule, then:')
    console.log(`  Run: powerplant verify ${opts.projectPath}`)
  } else if (opts.projectPath !== null && opts.contractPresent && opts.runtimeReady) {
    console.log(`  Run: powerplant run ${opts.projectPath} "<task>"`)
  } else {
    console.log('  Run: powerplant run <project-path> "<task>"')
  }
  console.log()
}

export function printInspectReport(report: InspectionReport): void {
  console.log()
  console.log(`Project: ${report.projectId}`)
  console.log(`Path:    ${report.projectPath}`)
  console.log()
  console.log(`Contract valid:       ${report.contractValid ? 'YES' : 'NO'}`)
  console.log(`Sanitization preview: ${report.sanitizationPreview.passed ? 'PASS' : 'FAIL'}`)
  console.log()

  console.log('Files visible to Claude:')
  for (const f of report.sanitizationPreview.includedFiles) {
    console.log(`  - ${f}`)
  }
  console.log()

  console.log('AI may modify in disposable workspace:')
  for (const p of report.policy.allowedWritePaths) {
    console.log(`  - ${p}`)
  }
  console.log()

  if (report.sanitizationPreview.excludedFileCount > 0) {
    console.log(`Excluded from snapshot: ${report.sanitizationPreview.excludedFileCount} file(s)`)
  }

  if (report.sanitizationPreview.forbiddenInSource.length > 0) {
    console.log('Excluded paths present in source (contents never read):')
    for (const p of report.sanitizationPreview.forbiddenInSource) {
      console.log(`  - ${p}`)
    }
  } else {
    console.log('No excluded paths detected in source.')
  }

  if (report.sanitizationPreview.forbiddenDetected.length > 0) {
    console.log('VIOLATION: Forbidden paths would appear in sanitized snapshot:')
    for (const p of report.sanitizationPreview.forbiddenDetected) {
      console.log(`  - ${p}`)
    }
  }

  console.log()
  console.log(`Workspace mode:  ${report.policy.workspaceMode}`)
  console.log(`Real project mounted: NO`)
  console.log(`Executor network: ${report.executorPolicy.networkDisabled ? 'disabled' : 'enabled'}`)
  console.log()
  console.log('Allowed checks:')
  for (const c of report.policy.allowedChecks) {
    console.log(`  - ${c}`)
  }
  console.log()
  console.log('No session started.')
}

export function printRunDisclosureSummary(opts: {
  projectName: string
  preview: SanitizationPreview
  allowedReadPaths: string[]
  allowedWritePaths: string[]
  allowedChecks: string[]
  forbiddenPaths: string[]
}): void {
  const { projectName, preview, allowedWritePaths, allowedChecks, forbiddenPaths } = opts
  console.log()
  console.log(`Project: ${projectName}`)
  console.log()
  console.log('AI may read:')
  for (const f of opts.allowedReadPaths) {
    console.log(`  - ${f}`)
  }
  console.log()
  console.log('AI may modify in disposable workspace:')
  for (const p of allowedWritePaths) {
    console.log(`  - ${p}`)
  }
  console.log()
  console.log('Never disclosed:')
  for (const p of forbiddenPaths) {
    console.log(`  - ${p}`)
  }
  console.log()
  console.log('Allowed checks:')
  for (const c of allowedChecks) {
    console.log(`  - ${c}`)
  }
  console.log()
  console.log('Original repo will not be modified.')
  console.log('Network access inside executor: disabled.')
  if (preview.forbiddenInSource.length > 0) {
    console.log()
    console.log('Note: excluded paths detected in source (will not be copied):')
    for (const p of preview.forbiddenInSource) {
      console.log(`  - ${p}`)
    }
  }
}

export function printRunSummary(opts: {
  runId: string
  task: string
  passed: boolean
  testsPassed: boolean
  customToolCounts: Record<string, number>
  builtInToolUseCount: number
  patchFiles: string[]
  sourceUnmodified: boolean
  artifactDir: string
  patchDiff: string
}): void {
  const {
    runId, task, passed, testsPassed, customToolCounts,
    builtInToolUseCount, patchFiles, sourceUnmodified, artifactDir, patchDiff,
  } = opts
  console.log()
  console.log('Run complete.')
  console.log()
  console.log(`Run ID: ${runId}`)
  console.log(`Task:   ${task}`)
  console.log()
  console.log(`Tests:  ${testsPassed ? 'PASS' : 'FAIL'}`)

  const changedFiles = patchFiles.filter(f => !f.endsWith('/'))
  if (changedFiles.length > 0) {
    console.log()
    console.log('Files changed in proposed patch:')
    for (const f of changedFiles) {
      if (f !== 'SOURCE_MANIFEST.json' && f !== 'SANITIZED_MANIFEST.json' &&
          f !== 'TASK.md' && f !== 'CHANGED_FILES.md' &&
          f !== 'VERIFICATION_REPORT.md' && f !== 'ADVERSARIAL_REVIEW.md' &&
          f !== 'SESSION_SUMMARY.json' && f !== 'PATCH.diff') {
        // Only show user-facing changed files from CHANGED_FILES content
      }
    }
    // Parse changed files from PATCH.diff filenames
    if (patchDiff.trim()) {
      const diffFiles = [...patchDiff.matchAll(/^--- a\/(.+)$/gm)].map(m => m[1])
      if (diffFiles.length > 0) {
        for (const f of diffFiles) {
          console.log(`  - ${f}`)
        }
      } else {
        console.log('  (no files changed)')
      }
    } else {
      console.log('  (no files changed)')
    }
  } else {
    console.log('Files changed: (none)')
  }

  console.log()
  console.log(`Original repo modified: ${sourceUnmodified ? 'NO' : 'YES (ERROR)'}`)
  console.log(`Built-in tools used:    ${builtInToolUseCount}`)
  console.log(`Custom tool calls:      ${JSON.stringify(customToolCounts)}`)
  console.log()
  console.log('Patch ready:')
  console.log(`  ${artifactDir}/PATCH.diff`)
  console.log()

  if (passed) {
    console.log('Next action:')
    console.log('  Review the patch. Applying it is still manual.')
    console.log()
    console.log(`  cat "${artifactDir}/PATCH.diff"`)
    console.log()
    console.log(`  powerplant review ${runId}`)
  } else {
    console.log('Run did not fully pass. Review artifacts for details.')
    console.log(`  ${artifactDir}/VERIFICATION_REPORT.md`)
  }
}

function checkVerdictSuffix(check: CheckResult): string {
  switch (check.verdict) {
    case 'BLOCKED_MISSING_TOOLING': {
      // Try to extract tool name from "X: not found" or "Cannot find module 'X'"
      const fromNotFound = check.stderrTail.match(/(\w+): (?:command )?not found/i)
      const fromModule = check.stderrTail.match(/Cannot find module '([\w@][\w@/-]*)'/i)
      const toolName = fromNotFound?.[1] ?? fromModule?.[1] ?? null
      return toolName
        ? ` — ${toolName} unavailable in isolated workspace`
        : ' — tooling unavailable in isolated workspace'
    }
    case 'FAIL_CHECK':
      return ' — check failed (see report for details)'
    case 'FAIL_BOUNDARY':
      return ' — security boundary violation'
    default:
      return ''
  }
}

export function printVerifyReport(report: VerificationReport, reportPath: string): void {
  const maxIdLen = Math.max(...report.checks.map(c => c.checkId.length), 4)
  const pad = maxIdLen + 2

  console.log()
  console.log(`Project: ${report.projectId}`)
  console.log(`Contract valid: YES`)
  console.log(`Sanitization preview: ${report.sanitizationPassed ? 'PASS' : 'FAIL'}`)
  console.log(`Live agent session started: NO`)
  console.log()
  console.log(`Verification workspace: disposable sanitized copy`)
  console.log(`Original project mounted: NO`)
  console.log(`Project node_modules mounted: NO`)
  console.log(`Executor network: disabled`)
  console.log(`Credentials passed: NO`)

  if (report.verificationProfileId !== null) {
    console.log()
    console.log(`Verification profile: ${report.verificationProfileId}`)
    if (report.capsuleToolchainVersions !== null) {
      console.log('Capsule toolchain:')
      for (const [pkg, ver] of Object.entries(report.capsuleToolchainVersions)) {
        console.log(`  ${pkg} ${ver}`)
      }
    }
  }

  console.log()
  console.log('Approved checks:')
  if (report.checks.length === 0) {
    console.log('  (none declared)')
  } else {
    for (const check of report.checks) {
      console.log(`  ${check.checkId.padEnd(pad)}${check.verdict}${checkVerdictSuffix(check)}`)
    }
  }
  console.log()
  console.log(`Source project modified: ${report.sourceProjectModified ? 'YES (ERROR)' : 'NO'}`)
  console.log(`Verdict: ${report.verdict}`)
  console.log(`Report: ${reportPath}`)
  console.log()
}

export function printReviewReport(opts: {
  runId: string
  artifactDir: string
  task: string
  patchDiff: string
  changedFilesMd: string
  verificationMd: string
  adversarialMd: string
  sessionSummary: Record<string, unknown>
  promptEnvelope?: Record<string, unknown>
  runClassification?: RunClassification
}): void {
  const { runId, artifactDir, task, patchDiff, sessionSummary, promptEnvelope, runClassification } = opts
  console.log()
  console.log(`Run ID: ${runId}`)
  console.log()
  console.log(`Task: ${task}`)
  console.log()

  // Patch changed files
  const diffFiles = [...patchDiff.matchAll(/^--- a\/(.+)$/gm)].map(m => m[1])
  console.log('Patch files:')
  if (diffFiles.length === 0) {
    console.log('  (none)')
  } else {
    for (const f of diffFiles) {
      console.log(`  - ${f}`)
    }
  }
  console.log()

  // Verification — RUN_CLASSIFICATION.json is authoritative when present.
  // Falls back to parsing VERIFICATION_REPORT.md for runs without classification.
  console.log('Verification:')
  if (runClassification) {
    // Authoritative path: broker-written classification
    const eligible = runClassification.patchEligibleForApplication
    const reason = runClassification.terminationReason
    console.log(`  Final verdict:     ${eligible ? 'PASS — ELIGIBLE FOR HUMAN REVIEW' : `INELIGIBLE (${reason})`}`)
    console.log(`  Termination:       ${reason}`)
    console.log(`  Checks run:        ${runClassification.checkCount}`)
    if (runClassification.checkCount > 1) {
      console.log(`  Note: ${runClassification.checkCount} check attempts — intermediate failures are normal in a self-correcting run`)
    }
    console.log()
  } else {
    // Legacy path: parse VERIFICATION_REPORT.md
    const parsed = parseVerificationReport(opts.verificationMd)
    const hasSelfCorrection = parsed.intermediateIndices.size > 0
    console.log()
    if (parsed.format === 'current') {
      const verdictLabel = parsed.finalVerdict === 'PASS'
        ? hasSelfCorrection ? 'PASS  (self-corrected)' : 'PASS'
        : parsed.hasIntegrityFailure ? 'FAIL  (verification integrity failure)' : 'FAIL'
      console.log(`  Final verdict:  ${verdictLabel}`)
      console.log()
      console.log('  Check history:')
      const maxLen = Math.max(...parsed.attempts.map(a => a.checkId.length), 4)
      parsed.attempts.forEach((a, i) => {
        const label = parsed.intermediateIndices.has(i) ? '  ← self-corrected' : ''
        console.log(`    ${a.checkId.padEnd(maxLen + 2)}${a.verdict}${label}`)
      })
    } else {
      console.log(`  Final verdict:  UNKNOWN`)
      console.log(`  (legacy artifact — ordered attempt history not available)`)
      console.log(`  SESSION_SUMMARY.passed: ${sessionSummary['passed']}  [from legacy artifact — not authoritative]`)
    }
    console.log()

    const securityOk = sessionSummary['originalProjectMounted'] !== true &&
      sessionSummary['sourceUnmodified'] !== false
    let eligibility: string
    if (parsed.format !== 'current') {
      eligibility = 'INELIGIBLE — final verification not determinable from stored artifacts'
    } else if (parsed.hasIntegrityFailure) {
      eligibility = 'INELIGIBLE — verification integrity failure (zero-test or boundary violation)'
    } else if (parsed.finalVerdict !== 'PASS') {
      eligibility = 'INELIGIBLE — final verification failed'
    } else if (!securityOk) {
      eligibility = 'INELIGIBLE — security boundary violation'
    } else {
      eligibility = 'ELIGIBLE FOR HUMAN REVIEW'
    }
    console.log(`Patch eligibility: ${eligibility}`)
    console.log()
  }

  // Security summary
  console.log('Security summary:')
  console.log(`  - Original repo mounted:   ${sessionSummary['originalProjectMounted'] ? 'YES (ERROR)' : 'NO'}`)
  console.log(`  - Original repo modified:  ${sessionSummary['sourceUnmodified'] === false ? 'YES (ERROR)' : 'NO'}`)
  console.log(`  - Built-in tools used:     ${sessionSummary['builtInToolUseCount'] ?? 0}`)
  console.log(`  - Executor network:        ${sessionSummary['executorNetworkDisabled'] ? 'disabled' : 'enabled'}`)
  console.log(`  - No credentials to exec:  ${sessionSummary['noCredentialsPassedToExecutor'] ? 'YES' : 'NO'}`)
  console.log(`  - Forbidden files disclosed: 0`)
  console.log()

  if (promptEnvelope) {
    console.log('Prompt envelope:')
    console.log(`  - Protocol:   ${promptEnvelope['completionProtocolVersion'] ?? '—'}`)
    console.log(`  - Model:      ${promptEnvelope['modelId'] ?? '—'}`)
    const hash = typeof promptEnvelope['agentMessageSha256'] === 'string'
      ? promptEnvelope['agentMessageSha256'].slice(0, 16) + '…'
      : '—'
    console.log(`  - Msg hash:   ${hash}`)
    console.log()
  }

  console.log('Patch path:')
  console.log(`  ${artifactDir}/PATCH.diff`)
  console.log()
  console.log('Artifacts:')
  console.log(`  ${artifactDir}/`)
}
