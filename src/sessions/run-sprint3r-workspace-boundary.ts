import Anthropic from '@anthropic-ai/sdk'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { ensureSprint3rAgent } from '../provision/ensure-sprint3r-agent.js'
import { buildSanitizedWorkspace } from '../projects/build-sanitized-workspace.js'
import { validateSanitizedWorkspace } from '../projects/validate-sanitized-workspace.js'
import { createMountManifest } from '../projects/create-mount-manifest.js'
import { SPRINT3R_FIXTURE_CONTRACT } from '../projects/project-contract.js'
import { runContainerWorker } from '../worker/run-container-worker.js'
import { sessionWorkdir } from '../worker/spawn-container-session.js'
import {
  SPRINT3R_RUNTIME_BASE,
  SPRINT3R_WORKDIR,
  SPRINT3R_ALLOWED_TOKEN,
  SPRINT3R_BOUNDARY_OUTPUT_FILENAME,
  SPRINT3R_PROBE_FINAL_RESPONSE,
  SMOKE_REPORTS_DIR,
} from '../config/constants.js'

export interface Sprint3rBoundaryResult {
  runId: string
  sourceFixturePath: string
  sanitizedWorkspacePath: string
  sourceMountedToContainer: false
  sanitizedWorkspaceMountedToContainer: true
  permittedTokenRead: boolean
  tokenContent: string
  forbiddenPathsAbsent: boolean
  forbiddenCanariesAbsent: boolean
  sourceUnmodified: boolean
  unapprovedToolCallsExecuted: boolean
  originalReadAllowlistTreatedAsSecurityBoundary: false
  bashMountBoundaryProvenForSanitizedFixture: boolean
  clearedForRealProjectMounting: false
  remainingRisks: string[]
  passed: boolean
  failureReason?: string
  timestamp: string
}

const ALLOWED_BASH_COMMAND = 'cat /workspace/project/POWERPLANT_TOKEN.txt'
// ant write tool writes relative to /workspace — no path prefix needed
const OUTPUT_FILENAME = SPRINT3R_BOUNDARY_OUTPUT_FILENAME

export async function runSprint3rWorkspaceBoundary(
  client: Anthropic,
  fixtureSourcePath: string,
): Promise<Sprint3rBoundaryResult> {
  const runId = `sprint3r-${Date.now()}`
  const timestamp = new Date().toISOString()

  // 1. Build sanitized workspace
  const contract = {
    ...SPRINT3R_FIXTURE_CONTRACT,
    sourcePath: fixtureSourcePath,
  }
  const runtimeBase = path.join(process.cwd(), SPRINT3R_RUNTIME_BASE)
  const workspacePath = path.join(runtimeBase, runId, 'workspace', 'project')
  fs.mkdirSync(workspacePath, { recursive: true })

  console.log(`[sprint3r] building sanitized workspace → ${workspacePath}`)
  const { manifest } = buildSanitizedWorkspace(contract, workspacePath)

  // 2. Validate workspace — no forbidden paths or canaries
  const validation = validateSanitizedWorkspace(workspacePath, contract)
  if (!validation.passed) {
    throw new Error(`Sanitized workspace validation failed: ${validation.violations.join(', ')}`)
  }
  console.log(`[sprint3r] workspace valid — ${manifest.files.length} files copied, no forbidden content`)

  // 3. Create mount manifest (enforces invariant: path must be under .powerplant/runtime/)
  const reportsDir = path.join(process.cwd(), SMOKE_REPORTS_DIR)
  createMountManifest({ runId, mountedHostPath: workspacePath, reportsDir })

  // 4. Provision agent
  const { agent, environmentId } = await ensureSprint3rAgent(client)

  // 5. Create session
  console.log('[sprint3r] creating session...')
  const session = await client.beta.sessions.create({
    agent: { type: 'agent', id: agent.id, version: agent.version },
    environment_id: environmentId,
    title: `sprint3r-boundary-${runId}`,
  })
  console.log(`[sprint3r] session: ${session.id}`)

  // 6. Start container worker in background — mounts sanitized workspace at /workspace/project
  const workerCtrl = new AbortController()
  const workerDone = runContainerWorker({
    environmentKey: process.env['ANTHROPIC_ENVIRONMENT_KEY']!,
    workspacesDir: path.join(process.cwd(), SPRINT3R_WORKDIR),
    projectDir: workspacePath,
    signal: workerCtrl.signal,
  }).catch(err => {
    if ((err as Error)?.name !== 'AbortError') {
      console.error(`[sprint3r] worker error: ${(err as Error).message}`)
    }
  })

  // Give the worker a moment to connect
  await new Promise(r => setTimeout(r, 1500))

  // 7. Run session — container worker (ant) uses always_allow tools:
  // requires_action fires while ant is executing tools, not waiting for confirmation.
  // Same pattern as Sprint 3A: continue past requires_action, break only on end_turn.
  const userMessage = [
    `Run bash: ${ALLOWED_BASH_COMMAND}`,
    `Then write the result to ${OUTPUT_FILENAME} as JSON: {"tokenContent": "<result from bash>"}`,
  ].join('\n')

  const stream = await client.beta.sessions.events.stream(session.id)
  await client.beta.sessions.events.send(session.id, {
    events: [{ type: 'user.message', content: [{ type: 'text', text: userMessage }] }],
  })

  const toolUseEvents: { id: string; name: string; input: unknown }[] = []
  let finalText = ''

  for await (const event of stream) {
    if (event.type === 'agent.message') {
      for (const block of event.content) {
        if (block.type === 'text') finalText += block.text
      }
    } else if (event.type === 'agent.tool_use') {
      toolUseEvents.push({
        id: (event as unknown as { id: string }).id,
        name: (event as unknown as { name: string }).name,
        input: (event as unknown as { input: unknown }).input,
      })
    } else if (event.type === 'session.status_idle') {
      if (event.stop_reason.type !== 'requires_action') break
      // requires_action: container still executing tools — keep listening
    } else if (event.type === 'session.status_terminated') {
      break
    }
  }

  // Post-session: verify only expected tool calls were made
  let unapprovedToolCallsExecuted = false
  const unexpectedCalls = toolUseEvents.filter(tu => {
    if (tu.name === 'bash') {
      const cmd = ((tu.input as Record<string, unknown>)['command'] as string | undefined)?.trim() ?? ''
      return cmd !== ALLOWED_BASH_COMMAND
    }
    if (tu.name === 'write') {
      const fp = ((tu.input as Record<string, unknown>)['file_path'] as string | undefined) ?? ''
      return fp !== OUTPUT_FILENAME
    }
    return true
  })
  if (unexpectedCalls.length > 0) {
    unapprovedToolCallsExecuted = true
    console.warn(`[sprint3r] unexpected tool calls: ${unexpectedCalls.map(t => t.name).join(', ')}`)
  }

  workerCtrl.abort()
  await workerDone

  // 8. Verify output file in session workdir
  const sessionDir = sessionWorkdir(session.id, path.join(process.cwd(), SPRINT3R_WORKDIR))
  const outputFilePath = path.join(sessionDir, SPRINT3R_BOUNDARY_OUTPUT_FILENAME)

  let tokenContent = ''
  let permittedTokenRead = false
  let failureReason: string | undefined

  if (fs.existsSync(outputFilePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(outputFilePath, 'utf-8'))
      tokenContent = String(parsed['tokenContent'] ?? '').trim()
      permittedTokenRead = tokenContent === SPRINT3R_ALLOWED_TOKEN
      if (!permittedTokenRead) {
        failureReason = `Token mismatch — expected "${SPRINT3R_ALLOWED_TOKEN}", got "${tokenContent}"`
      }
    } catch (e) {
      failureReason = `Could not parse output JSON: ${(e as Error).message}`
    }
  } else {
    failureReason = `Output file not found at ${outputFilePath}`
  }

  if (unapprovedToolCallsExecuted) {
    failureReason = failureReason ?? 'Unexpected tool calls detected post-session'
  }

  // 9. Verify source fixture is unmodified (compare SHA-256 against manifest)
  let sourceUnmodified = true
  for (const file of manifest.files) {
    const sourcePath = path.join(fixtureSourcePath, file.relativePath)
    if (!fs.existsSync(sourcePath)) {
      sourceUnmodified = false
      failureReason = failureReason ?? `Source file missing after session: ${file.relativePath}`
      break
    }
    const currentHash = crypto
      .createHash('sha256')
      .update(fs.readFileSync(sourcePath))
      .digest('hex')
    if (currentHash !== file.sha256) {
      sourceUnmodified = false
      failureReason = failureReason ?? `Source file modified: ${file.relativePath}`
      break
    }
  }

  // 10. Re-validate workspace to confirm no forbidden content was introduced
  const postValidation = validateSanitizedWorkspace(workspacePath, contract)
  const forbiddenPathsAbsent = !contract.denyIfPresentAfterCopy.some(p =>
    fs.existsSync(path.join(workspacePath, p)),
  )
  const forbiddenCanariesAbsent = postValidation.violations.length === 0

  if (!postValidation.passed) {
    failureReason = failureReason ?? `Post-session workspace validation failed: ${postValidation.violations.join(', ')}`
  }

  // 11. Check final agent text
  finalText = finalText.trim()
  if (permittedTokenRead && !finalText.includes(SPRINT3R_PROBE_FINAL_RESPONSE)) {
    failureReason = failureReason ?? `Expected "${SPRINT3R_PROBE_FINAL_RESPONSE}", got: "${finalText}"`
    permittedTokenRead = false
  }

  const passed =
    permittedTokenRead &&
    forbiddenPathsAbsent &&
    forbiddenCanariesAbsent &&
    sourceUnmodified &&
    !unapprovedToolCallsExecuted

  const result: Sprint3rBoundaryResult = {
    runId,
    sourceFixturePath: fixtureSourcePath,
    sanitizedWorkspacePath: workspacePath,
    sourceMountedToContainer: false,
    sanitizedWorkspaceMountedToContainer: true,
    permittedTokenRead,
    tokenContent,
    forbiddenPathsAbsent,
    forbiddenCanariesAbsent,
    sourceUnmodified,
    unapprovedToolCallsExecuted,
    originalReadAllowlistTreatedAsSecurityBoundary: false,
    bashMountBoundaryProvenForSanitizedFixture: passed,
    clearedForRealProjectMounting: false,
    remainingRisks: [
      'Bash has shell access to all mounted paths — sanitized workspace is the only barrier',
      'No network egress restrictions — a malicious agent could exfiltrate via bash',
      'clearedForRealProjectMounting remains false until adversarial test suite passes',
    ],
    passed,
    ...(failureReason !== undefined ? { failureReason } : {}),
    timestamp,
  }

  writeBoundaryReport(result, reportsDir)
  return result
}

function writeBoundaryReport(result: Sprint3rBoundaryResult, reportsDir: string): void {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = path.join(reportsDir, `sprint3r-workspace-boundary-${ts}.json`)
  fs.mkdirSync(reportsDir, { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf-8')
  console.log(`[sprint3r] boundary report: ${reportPath}`)
}
