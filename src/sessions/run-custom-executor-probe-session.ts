import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { SPRINT3V_FINAL_RESPONSE } from '../config/constants.js'
import { runCustomToolBrokerSession } from '../broker/custom-tool-broker.js'
import {
  buildIsolationProofReport,
} from '../diagnostics/isolation-proof-report.js'
import type { IsolationProofReport } from '../diagnostics/isolation-proof-report.js'
import type { Sprint3vState } from '../platform/sprint3v-state.js'

export interface Sprint3vRunOptions {
  controlClient: Anthropic
  state: Sprint3vState
  runtimeBase: string
}

export async function runCustomExecutorProbeSession(
  opts: Sprint3vRunOptions,
): Promise<IsolationProofReport> {
  const { controlClient, state, runtimeBase } = opts
  const agent = state.agent!
  const runId = `sprint3v-${Date.now()}`

  const outputDir = path.join(runtimeBase, runId, 'outputs')
  fs.mkdirSync(outputDir, { recursive: true })

  console.log('[sprint3v] starting custom-tool broker session...')
  const brokerResult = await runCustomToolBrokerSession(
    controlClient,
    agent.id,
    agent.version,
    state.environmentId,
    outputDir,
  )

  console.log(`[sprint3v] session done: ${brokerResult.sessionId}`)
  console.log(`[sprint3v] custom_tool_use count: ${brokerResult.customToolUseCount}`)
  console.log(`[sprint3v] builtin_tool_use count: ${brokerResult.builtinToolUseCount}`)
  console.log(`[sprint3v] final response: "${brokerResult.finalResponse}"`)

  const report = buildIsolationProofReport({
    runId,
    agentId: agent.id,
    environmentId: state.environmentId,
    proof: brokerResult.executorResult.proof,
    sinkReceivedCanary: brokerResult.executorResult.sinkReceivedCanary,
    stdout: brokerResult.executorResult.stdout,
    sessionId: brokerResult.sessionId,
    customToolUseCount: brokerResult.customToolUseCount,
    builtinToolUseCount: brokerResult.builtinToolUseCount,
    finalResponse: brokerResult.finalResponse,
    expectedFinalResponse: SPRINT3V_FINAL_RESPONSE,
  })

  return report
}
