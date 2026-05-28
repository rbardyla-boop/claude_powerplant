import Anthropic from '@anthropic-ai/sdk'

export interface AlwaysAllowSessionResult {
  finalText: string
}

/**
 * Run a session with an always_allow agent and the TypeScript SDK EnvironmentWorker.
 *
 * This helper does NOT post any user.tool_confirmation events. It handles the
 * always_allow event pattern:
 *   - requires_action may fire as a scheduling artifact between tool dispatches;
 *     re-open the event stream and continue without posting confirmations.
 *   - break on any stop reason other than requires_action (end_turn, etc.)
 *   - break on session.status_terminated
 *
 * Using runWithConfirmation for always_allow sessions causes "No pending tool
 * permission request found" 400 errors (Sprint 3T Probe C). This helper avoids
 * that by never posting confirmations.
 */
export async function runAlwaysAllowSession(
  client: Anthropic,
  sessionId: string,
  userMessageText: string,
): Promise<AlwaysAllowSessionResult> {
  let stream = await client.beta.sessions.events.stream(sessionId)

  await client.beta.sessions.events.send(sessionId, {
    events: [
      {
        type: 'user.message',
        content: [{ type: 'text', text: userMessageText }],
      },
    ],
  })

  let finalText = ''
  let done = false
  // Guard against infinite reconnect loops (stream repeatedly closing before terminal event)
  let closedReconnects = 0
  const maxClosedReconnects = 8

  while (!done) {
    let sawTerminal = false
    for await (const event of stream) {
      if (event.type === 'agent.message') {
        for (const block of event.content) {
          if (block.type === 'text') {
            finalText += block.text
          }
        }
      } else if (event.type === 'session.status_idle') {
        if (event.stop_reason.type === 'requires_action') {
          // Scheduling artifact for always_allow — re-open stream, do NOT post confirmation
          stream = await client.beta.sessions.events.stream(sessionId)
        } else {
          done = true
        }
        sawTerminal = true
        break
      } else if (event.type === 'session.status_terminated') {
        done = true
        sawTerminal = true
        break
      }
    }

    if (!sawTerminal) {
      // Stream was consumed without a terminal event — the server closed the connection
      // (e.g., idle timeout while waiting for a slow-starting worker). Re-open and wait.
      if (closedReconnects < maxClosedReconnects) {
        closedReconnects++
        stream = await client.beta.sessions.events.stream(sessionId)
      } else {
        done = true
      }
    }
  }

  return { finalText }
}
