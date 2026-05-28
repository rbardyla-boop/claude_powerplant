import Anthropic from '@anthropic-ai/sdk'
import {
  validateExecutorProbeInput,
  isKnownCustomToolName,
} from '../contracts/custom-tool-contract.js'
import {
  validateIsolationProof,
  buildCustomToolResult,
} from '../diagnostics/isolation-proof-report.js'
import { runIsolatedExecutor } from './run-isolated-executor.js'
import {
  SPRINT3V_CUSTOM_TOOL_NAME,
  SPRINT3V_CUSTOM_TOOL_ACTION,
  SPRINT3V_FINAL_RESPONSE,
} from '../config/constants.js'

export interface BrokerSessionResult {
  sessionId: string
  customToolUseCount: number
  builtinToolUseCount: number
  finalResponse: string
  outputDir: string
  executorResult: Awaited<ReturnType<typeof runIsolatedExecutor>>
  toolResult: import('../contracts/custom-tool-contract.js').CustomToolResult
}

export async function runCustomToolBrokerSession(
  client: Anthropic,
  agentId: string,
  agentVersion: number,
  environmentId: string,
  outputDir: string,
): Promise<BrokerSessionResult> {
  const session = await client.beta.sessions.create({
    agent: { type: 'agent', id: agentId, version: agentVersion },
    environment_id: environmentId,
    title: `sprint3v-${Date.now()}`,
  })
  const sessionId = session.id
  console.log('[broker] session:', sessionId)

  let customToolUseCount = 0
  let builtinToolUseCount = 0
  let finalResponse = ''
  let executorResult: Awaited<ReturnType<typeof runIsolatedExecutor>> | null = null
  let toolResult: import('../contracts/custom-tool-contract.js').CustomToolResult | null = null

  // Stream-first: open stream before sending the user message
  let stream = await client.beta.sessions.events.stream(sessionId)

  await client.beta.sessions.events.send(sessionId, {
    events: [
      {
        type: 'user.message',
        content: [
          {
            type: 'text',
            text: `Invoke the ${SPRINT3V_CUSTOM_TOOL_NAME} tool once with action "${SPRINT3V_CUSTOM_TOOL_ACTION}".`,
          },
        ],
      },
    ],
  })

  while (true) {
    let requiresAction = false
    let pendingCustomToolUseId: string | null = null

    for await (const event of stream) {
      if (event.type === 'agent.message') {
        for (const block of event.content) {
          if (block.type === 'text') {
            finalResponse += block.text
          }
        }
      } else if (event.type === 'agent.tool_use') {
        // Built-in tool — must not happen; record and fail later
        builtinToolUseCount++
        console.warn('[broker] UNEXPECTED built-in tool use:', (event as { name: string }).name)
      } else if (event.type === 'agent.custom_tool_use') {
        const toolUseEvent = event as { id: string; name: string; input: unknown }
        console.log('[broker] custom_tool_use:', toolUseEvent.name, 'id:', toolUseEvent.id)

        if (!isKnownCustomToolName(toolUseEvent.name)) {
          throw new Error(`Unexpected custom tool name: '${toolUseEvent.name}'`)
        }
        if (customToolUseCount >= 1) {
          throw new Error('Broker policy: at most one executor_probe call per session')
        }

        validateExecutorProbeInput(toolUseEvent.input)
        pendingCustomToolUseId = toolUseEvent.id
        customToolUseCount++
      } else if (event.type === 'session.status_idle') {
        if (event.stop_reason.type === 'requires_action') {
          requiresAction = true
        }
        break
      } else if (event.type === 'session.status_terminated') {
        break
      }
    }

    if (!requiresAction) break

    if (!pendingCustomToolUseId) {
      throw new Error('requires_action but no pending custom tool use id collected')
    }

    // Execute the custom tool (broker runs the isolated executor)
    console.log('[broker] launching isolated executor...')
    executorResult = await runIsolatedExecutor(outputDir)
    console.log('[broker] executor stdout:', executorResult.stdout)

    const errors = validateIsolationProof(executorResult.proof, executorResult.sinkReceivedCanary)
    toolResult = buildCustomToolResult(
      executorResult.proof,
      executorResult.sinkReceivedCanary,
      errors,
    )

    console.log('[broker] tool result:', JSON.stringify(toolResult))

    // Stream-first for the result turn
    stream = await client.beta.sessions.events.stream(sessionId)

    await client.beta.sessions.events.send(sessionId, {
      events: [
        {
          type: 'user.custom_tool_result',
          custom_tool_use_id: pendingCustomToolUseId,
          content: [
            { type: 'text', text: JSON.stringify(toolResult) },
          ],
        },
      ],
    } as Parameters<typeof client.beta.sessions.events.send>[1])
  }

  if (!executorResult || !toolResult) {
    throw new Error('Broker: executor was never invoked — custom tool use event did not occur')
  }

  return {
    sessionId,
    customToolUseCount,
    builtinToolUseCount,
    finalResponse: finalResponse.trim(),
    outputDir,
    executorResult,
    toolResult,
  }
}
