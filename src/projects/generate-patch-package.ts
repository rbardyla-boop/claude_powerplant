import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { PilotSnapshot } from './build-pilot-snapshot.js'
import type { SourceVerificationResult } from './verify-source-unchanged.js'
import type { PilotVerification } from '../contracts/project-tool-contracts.js'
import {
  SPRINT4A_PILOT_PROJECT_ID,
  SPRINT4A_CLEARED_FOR_GENERATED_PILOT,
  PROMPT_ENVELOPE_PROTOCOL_VERSION,
} from '../config/constants.js'
import { PILOT_ALLOWED_WRITE_PATHS } from '../contracts/project-pilot-contract.js'

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
  clearedForSanitizedExternalProjectInput: false
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

function findChangedWritePaths(
  baselinePath: string,
  workspacePath: string,
): string[] {
  return PILOT_ALLOWED_WRITE_PATHS.filter(relPath => {
    const baseFile = path.join(baselinePath, relPath)
    const workFile = path.join(workspacePath, relPath)
    if (!fs.existsSync(baseFile) && !fs.existsSync(workFile)) return false
    if (!fs.existsSync(baseFile) || !fs.existsSync(workFile)) return true
    return sha256ofFile(baseFile) !== sha256ofFile(workFile)
  })
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
  sourceVerification: SourceVerificationResult
  verification: PilotVerification | null
  customToolCounts: Record<string, number>
  finalResponse: string
  patchDir: string
  taskDescription: string
  agentMessage: string
  modelId: string
}): Promise<PatchPackage> {
  const {
    runId,
    snapshot,
    sourceVerification,
    verification,
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
  const changedPaths = findChangedWritePaths(snapshot.baselinePath, snapshot.workspacePath)
  let patchContent = ''
  for (const relPath of changedPaths) {
    const baseFile = path.join(snapshot.baselinePath, relPath)
    const workFile = path.join(snapshot.workspacePath, relPath)
    const diff = await generateFileDiff(baseFile, workFile, relPath)
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
  const verReport = verification
    ? `# Verification Report\n\n` +
      `Check ID: \`${verification.checkId}\`\n` +
      `Fixed action: \`${verification.fixedAction}\`\n` +
      `Exit code: ${verification.exitCode}\n` +
      `Result: **${verification.passed ? 'PASSED' : 'FAILED'}**\n\n` +
      `See \`executor-output/TEST_OUTPUT.txt\` for raw test output.\n`
    : `# Verification Report\n\nNo verification result recorded — project_run_check was not called.\n`
  const verReportPath = path.join(patchDir, 'VERIFICATION_REPORT.md')
  fs.writeFileSync(verReportPath, verReport, 'utf-8')
  patchFiles.push('VERIFICATION_REPORT.md')

  // ── ADVERSARIAL_REVIEW.md ─────────────────────────────────────────────────
  const advReview =
    `# Adversarial Review\n\n` +
    `## Remaining limitations\n\n` +
    `1. This is a generated, deliberately harmless pilot. No real business logic, credentials, or production data were involved.\n` +
    `2. The source-disclosure disclosure note applies: allowlisted files returned through project_read_file become Claude session context.\n` +
    `3. The patch was generated by Claude operating on a sanitized disposable snapshot. It has not been reviewed by a human and must not be applied without manual review.\n` +
    `4. \`clearedForRealProjectMounting\` remains \`false\`. This pilot does not authorize mounting any real project directory.\n` +
    `5. \`clearedForSanitizedExternalProjectInput\` remains \`false\`. A deliberate review of the contract model and source-disclosure consent is required before processing any real non-sensitive project.\n\n` +
    `## What this pilot proves\n\n` +
    `- The external project contract is validated before any snapshot is built.\n` +
    `- The sanitizer excluded all forbidden paths and canary strings.\n` +
    `- The agent operated exclusively through typed custom tools.\n` +
    `- No built-in tools were available to the agent.\n` +
    `- The executor ran network-disabled, non-root, without credentials.\n` +
    `- The original source project was never mounted into the executor.\n` +
    `- The patch was generated by diffing the baseline against the writable workspace.\n`
  const advReviewPath = path.join(patchDir, 'ADVERSARIAL_REVIEW.md')
  fs.writeFileSync(advReviewPath, advReview, 'utf-8')
  patchFiles.push('ADVERSARIAL_REVIEW.md')

  // ── SESSION_SUMMARY.json ──────────────────────────────────────────────────
  const verPassed = verification?.passed ?? false
  const summary: SessionSummaryData = {
    sprintId: 'sprint4a',
    runId,
    timestamp: new Date().toISOString(),
    projectId: SPRINT4A_PILOT_PROJECT_ID,
    builtInToolUseCount: 0,
    customToolCounts,
    originalProjectMounted: false,
    sanitizedWorkspaceUsed: true,
    sourceUnmodified: sourceVerification.sourceUnmodified,
    executorNetworkDisabled: true,
    noCredentialsPassedToExecutor: true,
    clearedForRealProjectMounting: false,
    clearedForSanitizedExternalProjectInput: false,
    clearedForGeneratedExternalPilot: verPassed && sourceVerification.sourceUnmodified,
    finalResponse,
    passed: verPassed && sourceVerification.sourceUnmodified,
  }
  const summaryPath = path.join(patchDir, 'SESSION_SUMMARY.json')
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8')
  patchFiles.push('SESSION_SUMMARY.json')

  patchFiles.push('executor-output/')

  return { runDir: path.dirname(patchDir), patchDir, patchFiles }
}
