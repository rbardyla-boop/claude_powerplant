import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import {
  isKnownPilotToolName,
  validateToolInput,
  isReadPathAuthorized,
  isWritePathAuthorized,
  isCheckAuthorized,
} from '../contracts/project-tool-contracts.js'
import type {
  PilotToolName,
  PilotVerification,
  ListFilesResult,
  ReadFileResult,
  WriteFileResult,
  RunCheckResult,
  FinalizeResult,
} from '../contracts/project-tool-contracts.js'
import type { LoadedProjectContract } from '../projects/load-project-contract.js'
import { runProjectTestExecutor } from './project-executor-actions.js'
import { generatePatchPackage } from '../projects/generate-patch-package.js'
import { verifySourceUnchanged } from '../projects/verify-source-unchanged.js'
import type { PilotSnapshot } from '../projects/build-pilot-snapshot.js'
import {
  SPRINT4A_TOOL_LIST_FILES,
  SPRINT4A_TOOL_READ_FILE,
  SPRINT4A_TOOL_WRITE_FILE,
  SPRINT4A_TOOL_RUN_CHECK,
  SPRINT4A_TOOL_FINALIZE,
  SPRINT4A_MAX_TOOL_CALLS,
  SPRINT4A_FINAL_RESPONSE,
  SPRINT4A_PILOT_MODEL,
} from '../config/constants.js'

const FORBIDDEN_WRITE_CONTENT_MARKER = 'POWERPLANT_FORBIDDEN'

export interface ProjectBrokerSessionResult {
  sessionId: string
  builtinToolUseCount: number
  customToolCounts: Record<string, number>
  finalResponse: string
  verification: PilotVerification | null
  patchPackage: import('../projects/generate-patch-package.js').PatchPackage | null
  passed: boolean
}

interface BrokerState {
  snapshot: PilotSnapshot
  contract: LoadedProjectContract
  runId: string
  outputDir: string
  patchDir: string
  taskDescription: string
  agentMessage: string
  modelId: string
  testCheckPassed: boolean
  finalizeReceived: boolean
  verification: PilotVerification | null
  patchPackage: import('../projects/generate-patch-package.js').PatchPackage | null
  customToolCounts: Record<string, number>
  builtinToolUseCount: number
  finalResponse: string
  totalCustomToolCalls: number
  // Persists computed results across turns — needed because the API processes
  // batched results one at a time and re-emits requires_action for remaining IDs.
  computedResults: Map<string, string>
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

function handleListFiles(state: BrokerState): string {
  const ws = state.snapshot.workspacePath
  const files: string[] = []
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir)) {
      const abs = path.join(dir, entry)
      const stat = fs.lstatSync(abs)
      if (stat.isDirectory()) {
        walk(abs)
      } else {
        files.push(path.relative(ws, abs).replace(/\\/g, '/'))
      }
    }
  }
  walk(ws)
  files.sort()
  const result: ListFilesResult = { files }
  return JSON.stringify(result)
}

function handleReadFile(state: BrokerState, input: unknown): string {
  const { path: relPath } = validateToolInput(SPRINT4A_TOOL_READ_FILE, input) as { path: string }

  // Broker authorization — schema validated shape; now check contract allowedReadPaths
  if (!isReadPathAuthorized(relPath, state.contract.allowedReadPaths)) {
    throw new Error(
      `Read rejected: '${relPath}' is not in the project's allowedReadPaths. ` +
      `Call project_list_files to see what files are available.`,
    )
  }

  const absPath = path.join(state.snapshot.workspacePath, relPath)
  if (!fs.existsSync(absPath)) {
    return JSON.stringify({ error: `File not found: ${relPath}` })
  }
  const content = fs.readFileSync(absPath, 'utf-8')
  const result: ReadFileResult = { path: relPath, content }
  return JSON.stringify(result)
}

function handleWriteFile(state: BrokerState, input: unknown): string {
  const { path: relPath, content } = validateToolInput(
    SPRINT4A_TOOL_WRITE_FILE,
    input,
  ) as { path: string; content: string }

  // Broker authorization — check contract allowedWritePaths
  if (!isWritePathAuthorized(relPath, state.contract.allowedWritePaths)) {
    throw new Error(
      `Write rejected: '${relPath}' is not in the project's allowedWritePaths.`,
    )
  }

  if (content.includes(FORBIDDEN_WRITE_CONTENT_MARKER)) {
    throw new Error(
      `Write rejected: content contains forbidden marker '${FORBIDDEN_WRITE_CONTENT_MARKER}'`,
    )
  }

  const absPath = path.join(state.snapshot.workspacePath, relPath)
  fs.mkdirSync(path.dirname(absPath), { recursive: true })
  fs.writeFileSync(absPath, content, 'utf-8')

  const result: WriteFileResult = { path: relPath, written: true }
  return JSON.stringify(result)
}

async function handleRunCheck(state: BrokerState, input: unknown): Promise<string> {
  const { check } = validateToolInput(SPRINT4A_TOOL_RUN_CHECK, input) as { check: string }

  // Broker authorization — check is allowed only if declared in VERIFY.yaml
  if (!isCheckAuthorized(check, state.contract.allowedChecks)) {
    const declared = Object.keys(state.contract.allowedChecks).join(', ')
    throw new Error(
      `Check rejected: '${check}' is not declared in VERIFY.yaml. ` +
      `Declared checks: ${declared}`,
    )
  }

  const checkEntry = state.contract.allowedChecks[check]!
  console.log(`[broker] project_run_check: check=${check} command=${checkEntry.command}`)

  const testResult = await runProjectTestExecutor(
    state.snapshot.workspacePath,
    state.outputDir,
  )

  state.verification = testResult.verification
  state.testCheckPassed = testResult.verification.passed

  // Copy test output to the run patchDir/executor-output
  const executorOutputDir = path.join(state.patchDir, 'executor-output')
  fs.mkdirSync(executorOutputDir, { recursive: true })

  const srcOutputDir = state.outputDir
  for (const f of fs.readdirSync(srcOutputDir)) {
    fs.copyFileSync(
      path.join(srcOutputDir, f),
      path.join(executorOutputDir, f),
    )
  }

  const testOutputSummary = testResult.testOutput
    .split('\n')
    .filter(l => l.startsWith('# ') || l.startsWith('ok ') || l.startsWith('not ok '))
    .slice(0, 20)
    .join('\n')

  const result: RunCheckResult = {
    checkId: check,
    passed: testResult.verification.passed,
    exitCode: testResult.verification.exitCode,
    summary: testOutputSummary || `exit=${testResult.verification.exitCode}`,
  }
  return JSON.stringify(result)
}

async function handleFinalize(state: BrokerState, input: unknown): Promise<string> {
  const { summary } = validateToolInput(SPRINT4A_TOOL_FINALIZE, input) as { summary: string }

  if (!state.testCheckPassed) {
    throw new Error(
      'project_finalize rejected: test check has not passed. ' +
      'Call project_run_check with a declared check ID and ensure it passes first.',
    )
  }
  if (state.finalizeReceived) {
    throw new Error('project_finalize already called — duplicate call rejected')
  }
  state.finalizeReceived = true

  const sourceVerification = verifySourceUnchanged(state.snapshot)

  const pkg = await generatePatchPackage({
    runId: state.runId,
    snapshot: state.snapshot,
    contract: state.contract,
    sourceVerification,
    verification: state.verification,
    customToolCounts: state.customToolCounts,
    finalResponse: SPRINT4A_FINAL_RESPONSE,
    patchDir: state.patchDir,
    taskDescription: state.taskDescription,
    agentMessage: state.agentMessage,
    modelId: state.modelId,
    summary,
  })

  state.patchPackage = pkg

  const result: FinalizeResult = {
    patchPackagePath: pkg.patchDir,
    patchFiles: pkg.patchFiles,
  }
  return JSON.stringify(result)
}

// ── Main broker session loop ──────────────────────────────────────────────────

export async function runProjectPilotBrokerSession(opts: {
  client: Anthropic
  agentId: string
  agentVersion: number
  environmentId: string
  snapshot: PilotSnapshot
  contract: LoadedProjectContract
  runId: string
  outputDir: string
  patchDir: string
  taskDescription: string
  /** Message actually sent to the agent. Defaults to taskDescription when omitted. */
  agentMessage?: string
}): Promise<ProjectBrokerSessionResult> {
  const {
    client,
    agentId,
    agentVersion,
    environmentId,
    snapshot,
    contract,
    runId,
    outputDir,
    patchDir,
    taskDescription,
    agentMessage = taskDescription,
  } = opts

  const state: BrokerState = {
    snapshot,
    contract,
    runId,
    outputDir,
    patchDir,
    taskDescription,
    agentMessage,
    modelId: SPRINT4A_PILOT_MODEL,
    testCheckPassed: false,
    finalizeReceived: false,
    verification: null,
    patchPackage: null,
    customToolCounts: {},
    builtinToolUseCount: 0,
    finalResponse: '',
    totalCustomToolCalls: 0,
    computedResults: new Map(),
  }

  const session = await client.beta.sessions.create({
    agent: { type: 'agent', id: agentId, version: agentVersion },
    environment_id: environmentId,
    title: `sprint4a-${runId}`,
  })
  const sessionId = session.id
  console.log('[broker] session:', sessionId)

  // Stream-first: open stream before sending user message
  let stream = await client.beta.sessions.events.stream(sessionId)

  await client.beta.sessions.events.send(sessionId, {
    events: [
      {
        type: 'user.message',
        content: [{ type: 'text', text: agentMessage }],
      },
    ],
  })

  while (true) {
    if (state.totalCustomToolCalls >= SPRINT4A_MAX_TOOL_CALLS) {
      throw new Error(`Broker safety: exceeded ${SPRINT4A_MAX_TOOL_CALLS} custom tool calls`)
    }

    let requiresAction = false
    let remainingEventIds: string[] = []
    const newToolUses: Array<{ id: string; name: string; input: unknown }> = []

    for await (const event of stream) {
      if (event.type === 'agent.message') {
        for (const block of event.content) {
          if (block.type === 'text') {
            state.finalResponse += block.text
          }
        }
      } else if (event.type === 'agent.tool_use') {
        state.builtinToolUseCount++
        console.warn('[broker] UNEXPECTED built-in tool use:', (event as { name: string }).name)
      } else if (event.type === 'agent.custom_tool_use') {
        const ev = event as { id: string; name: string; input: unknown }
        console.log('[broker] custom_tool_use:', ev.name, 'id:', ev.id)

        if (!isKnownPilotToolName(ev.name)) {
          throw new Error(`Unknown pilot tool name: '${ev.name}'`)
        }
        newToolUses.push({ id: ev.id, name: ev.name, input: ev.input })
        state.totalCustomToolCalls++
        state.customToolCounts[ev.name] = (state.customToolCounts[ev.name] ?? 0) + 1
      } else if (event.type === 'session.status_idle') {
        const idleEvent = event as { stop_reason: { type: string; event_ids?: string[] } }
        if (idleEvent.stop_reason.type === 'requires_action') {
          requiresAction = true
          remainingEventIds = idleEvent.stop_reason.event_ids ?? []
        }
        break
      } else if (event.type === 'session.status_terminated') {
        break
      }
    }

    if (!requiresAction) break

    // Execute NEW tool calls and store results in the persistent map.
    // The API processes batched results one at a time and re-emits requires_action
    // for unresolved IDs, so we track all computed results across turns.
    for (const tu of newToolUses) {
      const toolName = tu.name as PilotToolName
      let resultText: string
      try {
        switch (toolName) {
          case SPRINT4A_TOOL_LIST_FILES:
            resultText = handleListFiles(state)
            break
          case SPRINT4A_TOOL_READ_FILE:
            resultText = handleReadFile(state, tu.input)
            break
          case SPRINT4A_TOOL_WRITE_FILE:
            resultText = handleWriteFile(state, tu.input)
            break
          case SPRINT4A_TOOL_RUN_CHECK:
            resultText = await handleRunCheck(state, tu.input)
            break
          case SPRINT4A_TOOL_FINALIZE:
            resultText = await handleFinalize(state, tu.input)
            break
        }
      } catch (err) {
        resultText = JSON.stringify({ error: String(err) })
      }
      console.log(`[broker] ${toolName} → ${resultText.slice(0, 120)}`)
      state.computedResults.set(tu.id, resultText)
    }

    // Build result events for all IDs the API is still waiting on.
    const resultEvents = remainingEventIds
      .filter(id => state.computedResults.has(id))
      .map(id => ({
        type: 'user.custom_tool_result' as const,
        custom_tool_use_id: id,
        content: [{ type: 'text' as const, text: state.computedResults.get(id)! }],
      }))

    if (resultEvents.length === 0) break

    // Stream-first for the result turn
    stream = await client.beta.sessions.events.stream(sessionId)

    await client.beta.sessions.events.send(sessionId, {
      events: resultEvents,
    } as Parameters<typeof client.beta.sessions.events.send>[1])
  }

  const passed =
    state.testCheckPassed &&
    state.patchPackage !== null &&
    state.builtinToolUseCount === 0 &&
    state.finalResponse.trim().includes(SPRINT4A_FINAL_RESPONSE)

  return {
    sessionId,
    builtinToolUseCount: state.builtinToolUseCount,
    customToolCounts: state.customToolCounts,
    finalResponse: state.finalResponse.trim(),
    verification: state.verification,
    patchPackage: state.patchPackage,
    passed,
  }
}
