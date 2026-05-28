import Anthropic from '@anthropic-ai/sdk'
import type { PendingToolUse } from './tool-confirmation-policy.js'

export interface ConfirmDecision {
  result: 'allow' | 'deny'
  deny_message?: string
}

export interface ConfirmationHandlerResult {
  finalText: string
  toolUseEvents: PendingToolUse[]
  confirmed: boolean
}

type DecideConfirmation = (toolUseEvents: PendingToolUse[]) => ConfirmDecision

export interface RunWithConfirmationOptions {
  /**
   * When true, post user.tool_confirmation immediately upon seeing each
   * agent.tool_use event rather than waiting for session.status_idle.
   * Required for self-hosted container workers: `ant` executes tools locally
   * and posts the result within milliseconds — by the time session.status_idle
   * fires, ant has already tried to POST the result and received a 400.
   */
  immediateConfirmation?: boolean
}

async function postConfirmations(
  client: Anthropic,
  sessionId: string,
  toolUseEvents: PendingToolUse[],
  decision: ConfirmDecision,
): Promise<void> {
  const events = toolUseEvents.map(tu => {
    const base = {
      type: 'user.tool_confirmation' as const,
      tool_use_id: tu.id,
      result: decision.result,
    }
    if (decision.result === 'deny' && decision.deny_message !== undefined) {
      return { ...base, deny_message: decision.deny_message }
    }
    return base
  })

  await client.beta.sessions.events.send(sessionId, {
    events: events as Parameters<typeof client.beta.sessions.events.send>[1]['events'],
  })
}

export async function runWithConfirmation(
  client: Anthropic,
  sessionId: string,
  userMessageText: string,
  decideConfirmation: DecideConfirmation,
  options: RunWithConfirmationOptions = {},
): Promise<ConfirmationHandlerResult> {
  const { immediateConfirmation = false } = options
  const allToolUseEvents: PendingToolUse[] = []
  let finalText = ''
  let confirmed = false

  // Turn 1: open stream first, then send user message (stream-first pattern)
  let stream = await client.beta.sessions.events.stream(sessionId)

  await client.beta.sessions.events.send(sessionId, {
    events: [
      {
        type: 'user.message',
        content: [{ type: 'text', text: userMessageText }],
      },
    ],
  })

  while (true) {
    const toolUseThisTurn: PendingToolUse[] = []
    let requiresAction = false

    for await (const event of stream) {
      if (event.type === 'agent.message') {
        for (const block of event.content) {
          if (block.type === 'text') {
            finalText += block.text
          }
        }
      } else if (event.type === 'agent.tool_use') {
        const tu: PendingToolUse = {
          id: (event as unknown as { id: string }).id,
          name: (event as unknown as { name: string }).name,
          input: (event as unknown as { input: unknown }).input,
        }
        toolUseThisTurn.push(tu)
        allToolUseEvents.push(tu)

        if (immediateConfirmation) {
          // Post confirmation NOW — container workers execute tools locally and
          // attempt to POST the result within milliseconds. Waiting for
          // session.status_idle means the result POST arrives before the
          // confirmation and gets a permanent 400.
          const decision = decideConfirmation([tu])
          confirmed = decision.result === 'allow'
          await postConfirmations(client, sessionId, [tu], decision)
        }
      } else if (event.type === 'session.status_idle') {
        if (event.stop_reason.type === 'requires_action') {
          requiresAction = true
        }
        break
      } else if (event.type === 'session.status_terminated') {
        break
      }
    }

    if (immediateConfirmation) {
      // Confirmations already posted per-event. Loop only breaks on !requiresAction
      // or termination — no extra turn needed.
      break
    }

    if (!requiresAction) break

    // Standard (cloud agent) path: evaluate all tool uses collected this turn
    const decision = decideConfirmation(toolUseThisTurn)
    confirmed = decision.result === 'allow'

    // Stream-first for next turn: open new stream before sending confirmation
    stream = await client.beta.sessions.events.stream(sessionId)

    await postConfirmations(client, sessionId, toolUseThisTurn, decision)
  }

  return { finalText, toolUseEvents: allToolUseEvents, confirmed }
}
