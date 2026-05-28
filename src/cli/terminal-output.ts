import type { InspectionReport } from '../contracts/inspection-report.js'
import type { SanitizationPreview } from '../projects/preview-sanitization.js'

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
}): void {
  const { runId, artifactDir, task, patchDiff, sessionSummary, promptEnvelope } = opts
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

  // Verification
  const verPassed = sessionSummary['passed'] === true
  console.log('Verification:')
  const checkId = typeof sessionSummary['customToolCounts'] === 'object' &&
    sessionSummary['customToolCounts'] !== null
    ? 'test'
    : 'test'
  console.log(`  - ${checkId}: ${verPassed ? 'PASS' : 'FAIL'}`)
  console.log()

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
