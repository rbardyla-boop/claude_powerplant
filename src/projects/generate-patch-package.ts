import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { PilotSnapshot } from './build-pilot-snapshot.js'
import type { SourceVerificationResult } from './verify-source-unchanged.js'
import type { LoadedProjectContract } from './load-project-contract.js'
import type { CheckResult } from '../contracts/verification-preflight-report.js'
import { matchesGlob } from './build-sanitized-workspace.js'
import {
  SPRINT4A_CLEARED_FOR_GENERATED_PILOT,
  PROMPT_ENVELOPE_PROTOCOL_VERSION,
} from '../config/constants.js'

const execFileAsync = promisify(execFile)

export interface PatchPackage {
  runDir: string
  patchDir: string
  patchFiles: string[]
}

export interface SessionSummaryData {
  sprintId: 'sprint4a'
  runId: string
  timestamp: string
  projectId: string
  builtInToolUseCount: 0
  customToolCounts: Record<string, number>
  originalProjectMounted: false
  sanitizedWorkspaceUsed: true
  sourceUnmodified: boolean
  executorNetworkDisabled: true
  noCredentialsPassedToExecutor: true
  clearedForRealProjectMounting: false
  clearedForSanitizedExternalProjectInput: boolean
  clearedForGeneratedExternalPilot: boolean
  finalResponse: string
  passed: boolean
}

async function generateFileDiff(
  baselineFile: string,
  workspaceFile: string,
  relPath: string,
): Promise<string> {
  try {
    const result = await execFileAsync('diff', [
      '-u',
      '--label', `a/${relPath}`,
      '--label', `b/${relPath}`,
      baselineFile,
      workspaceFile,
    ])
    return result.stdout
  } catch (err: unknown) {
    const e = err as { code?: number; stdout?: string; stderr?: string }
    if (e.code === 1) {
      // exit 1 means files differ — this is expected
      return e.stdout ?? ''
    }
    throw err
  }
}

function sha256ofFile(filePath: string): string {
  const content = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(content).digest('hex')
}

/**
 * Walk the workspace and find all files that match the contract's allowedWritePaths,
 * are not excluded by excludePaths, and differ from the baseline.
 */
function findChangedWritePaths(
  baselinePath: string,
  workspacePath: string,
  allowedWritePaths: string[],
  excludePaths: string[] = [],
): string[] {
  const changed: string[] = []

  function walkWorkspace(dir: string): void {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir)) {
      const abs = path.join(dir, entry)
      const stat = fs.lstatSync(abs)
      const relPath = path.relative(workspacePath, abs).replace(/\\/g, '/')
      if (stat.isDirectory()) {
        walkWorkspace(abs)
      } else {
        if (excludePaths.some(pattern => matchesGlob(relPath, pattern))) continue
        const authorized = allowedWritePaths.some(pattern => matchesGlob(relPath, pattern))
        if (!authorized) continue
        const baseFile = path.join(baselinePath, relPath)
        const workFile = abs
        if (!fs.existsSync(baseFile)) {
          changed.push(relPath)
        } else if (sha256ofFile(baseFile) !== sha256ofFile(workFile)) {
          changed.push(relPath)
        }
      }
    }
  }

  walkWorkspace(workspacePath)
  return changed.sort()
}

export interface PromptEnvelopeData {
  userTask: string
  completionProtocolVersion: string
  agentMessage: string
  agentMessageSha256: string
  modelId: string
  createdAt: string
}

export async function generatePatchPackage(opts: {
  runId: string
  snapshot: PilotSnapshot
  contract: LoadedProjectContract
  sourceVerification: SourceVerificationResult
  checkResults: CheckResult[] | null
  checksValidAfterLastWrite?: boolean
  customToolCounts: Record<string, number>
  finalResponse: string
  patchDir: string
  taskDescription: string
  agentMessage: string
  modelId: string
  summary?: string
}): Promise<PatchPackage> {
  const {
    runId,
    snapshot,
    contract,
    sourceVerification,
    checkResults,
    checksValidAfterLastWrite,
    customToolCounts,
    finalResponse,
    patchDir,
    taskDescription,
    agentMessage,
    modelId,
  } = opts

  fs.mkdirSync(patchDir, { recursive: true })
  const executorOutputDir = path.join(patchDir, 'executor-output')
  fs.mkdirSync(executorOutputDir, { recursive: true })

  const patchFiles: string[] = []

  // ── SOURCE_MANIFEST.json ──────────────────────────────────────────────────
  const sourceManifestPath = path.join(patchDir, 'SOURCE_MANIFEST.json')
  fs.writeFileSync(
    sourceManifestPath,
    JSON.stringify(
      {
        ...snapshot.sourceManifest,
        postRunVerification: {
          sourceUnmodified: sourceVerification.sourceUnmodified,
          changedFiles: sourceVerification.changedFiles,
          missingFiles: sourceVerification.missingFiles,
          newFiles: sourceVerification.newFiles,
        },
      },
      null,
      2,
    ),
    'utf-8',
  )
  patchFiles.push('SOURCE_MANIFEST.json')

  // ── SANITIZED_MANIFEST.json ───────────────────────────────────────────────
  const sanitizedManifestPath = path.join(patchDir, 'SANITIZED_MANIFEST.json')
  fs.writeFileSync(
    sanitizedManifestPath,
    JSON.stringify(snapshot.sanitizedManifest, null, 2),
    'utf-8',
  )
  patchFiles.push('SANITIZED_MANIFEST.json')

  // ── TASK.md ───────────────────────────────────────────────────────────────
  const taskPath = path.join(patchDir, 'TASK.md')
  fs.writeFileSync(taskPath, taskDescription, 'utf-8')
  patchFiles.push('TASK.md')

  // ── PROMPT_ENVELOPE.json ──────────────────────────────────────────────────
  const agentMessageSha256 = crypto
    .createHash('sha256')
    .update(agentMessage, 'utf-8')
    .digest('hex')
  const envelope: PromptEnvelopeData = {
    userTask: taskDescription,
    completionProtocolVersion: PROMPT_ENVELOPE_PROTOCOL_VERSION,
    agentMessage,
    agentMessageSha256,
    modelId,
    createdAt: new Date().toISOString(),
  }
  const envelopePath = path.join(patchDir, 'PROMPT_ENVELOPE.json')
  fs.writeFileSync(envelopePath, JSON.stringify(envelope, null, 2), 'utf-8')
  patchFiles.push('PROMPT_ENVELOPE.json')

  // ── PATCH.diff ────────────────────────────────────────────────────────────
  const changedPaths = findChangedWritePaths(
    snapshot.baselinePath,
    snapshot.workspacePath,
    contract.allowedWritePaths,
    contract.excludePaths,
  )
  let patchContent = ''
  for (const relPath of changedPaths) {
    const baseFile = path.join(snapshot.baselinePath, relPath)
    const workFile = path.join(snapshot.workspacePath, relPath)
    const baseForDiff = fs.existsSync(baseFile) ? baseFile : '/dev/null'
    const diff = await generateFileDiff(baseForDiff, workFile, relPath)
    patchContent += diff
  }
  const patchPath = path.join(patchDir, 'PATCH.diff')
  fs.writeFileSync(patchPath, patchContent, 'utf-8')
  patchFiles.push('PATCH.diff')

  // ── CHANGED_FILES.md ──────────────────────────────────────────────────────
  const changedFilesMd =
    `# Changed Files\n\n` +
    (changedPaths.length === 0
      ? '_No files changed._\n'
      : changedPaths.map(p => `- \`${p}\`: modified by Managed Agent\n`).join(''))
  const changedFilesPath = path.join(patchDir, 'CHANGED_FILES.md')
  fs.writeFileSync(changedFilesPath, changedFilesMd, 'utf-8')
  patchFiles.push('CHANGED_FILES.md')

  // ── VERIFICATION_REPORT.md ────────────────────────────────────────────────
  let verReport: string
  if (checkResults && checkResults.length > 0) {
    const lines = checkResults.map(r =>
      `### Check: \`${r.checkId}\`\n` +
      `Command: \`${r.command}\`\n` +
      `Exit code: ${r.exitCode ?? 'null'}\n` +
      `Result: **${r.verdict}**${r.advisory ? ' _(advisory — does not block finalization)_' : ''}\n` +
      (r.stdoutTail ? `\`\`\`\n${r.stdoutTail}\n\`\`\`\n` : ''),
    )
    verReport =
      `# Verification Report\n\n` +
      lines.join('\n')
  } else {
    verReport = `# Verification Report\n\nNo verification result recorded — project_run_check was not called.\n`
  }
  const verReportPath = path.join(patchDir, 'VERIFICATION_REPORT.md')
  fs.writeFileSync(verReportPath, verReport, 'utf-8')
  patchFiles.push('VERIFICATION_REPORT.md')

  // ── ADVERSARIAL_REVIEW.md ─────────────────────────────────────────────────
  const advReview =
    `# Adversarial Review\n\n` +
    `## Remaining limitations\n\n` +
    `1. Source disclosure: allowlisted files returned through project_read_file become Claude session context. Review the project's POLICY.yaml allowedReadPaths before running.\n` +
    `2. The patch was generated by Claude operating on a sanitized disposable snapshot. It must be reviewed manually before applying.\n` +
    `3. \`clearedForRealProjectMounting\` remains \`false\`. This run does not authorize mounting any real project directory.\n` +
    `4. Patch application to the original project is manual only.\n\n` +
    `## What this run proves\n\n` +
    `- The project contract (POLICY.yaml + VERIFY.yaml) was parsed and validated before any snapshot was built.\n` +
    `- The sanitizer used the contract's includePaths/excludePaths — not hardcoded pilot paths.\n` +
    `- The agent operated exclusively through typed custom tools.\n` +
    `- No built-in tools were available to the agent.\n` +
    `- The executor ran network-disabled, non-root, without credentials.\n` +
    `- The original source project was never mounted into the executor.\n` +
    `- The broker enforced contract-authorized read/write/check paths on every tool call.\n` +
    `- The patch was generated by diffing the baseline against the writable workspace.\n`
  const advReviewPath = path.join(patchDir, 'ADVERSARIAL_REVIEW.md')
  fs.writeFileSync(advReviewPath, advReview, 'utf-8')
  patchFiles.push('ADVERSARIAL_REVIEW.md')

  // ── SESSION_SUMMARY.json ──────────────────────────────────────────────────
  // Derive passed from the FINAL required check state, not from all historical attempts.
  const lastCheck = checkResults && checkResults.length > 0
    ? checkResults[checkResults.length - 1]
    : null
  const finalCheckPassed = checksValidAfterLastWrite !== undefined
    ? checksValidAfterLastWrite && lastCheck?.verdict === 'PASS'
    : lastCheck?.verdict === 'PASS'
  const verPassed = finalCheckPassed ?? false
  const isGeneratedPilot = contract.projectId === 'powerplant-pilot-status'
  const summary: SessionSummaryData = {
    sprintId: 'sprint4a',
    runId,
    timestamp: new Date().toISOString(),
    projectId: contract.projectId,
    builtInToolUseCount: 0,
    customToolCounts,
    originalProjectMounted: false,
    sanitizedWorkspaceUsed: true,
    sourceUnmodified: sourceVerification.sourceUnmodified,
    executorNetworkDisabled: true,
    noCredentialsPassedToExecutor: true,
    clearedForRealProjectMounting: false,
    // true for any project that supplied a validated POLICY.yaml + VERIFY.yaml contract
    clearedForSanitizedExternalProjectInput: true,
    clearedForGeneratedExternalPilot: isGeneratedPilot
      ? (verPassed && sourceVerification.sourceUnmodified && SPRINT4A_CLEARED_FOR_GENERATED_PILOT)
      : false,
    finalResponse,
    passed: verPassed && sourceVerification.sourceUnmodified,
  }
  const summaryPath = path.join(patchDir, 'SESSION_SUMMARY.json')
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8')
  patchFiles.push('SESSION_SUMMARY.json')

  patchFiles.push('executor-output/')

  return { runDir: path.dirname(patchDir), patchDir, patchFiles }
}
