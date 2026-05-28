export interface PendingToolUse {
  id: string
  name: string
  input: unknown
}

export interface PolicyResult {
  allowed: boolean
  reason?: string
}

export function evaluateWritePolicy(
  toolUseEvents: PendingToolUse[],
  expectedPath: string,
  expectedContent: string,
): PolicyResult {
  if (toolUseEvents.length === 0) {
    return { allowed: false, reason: 'Expected 1 tool-use event, got 0' }
  }
  if (toolUseEvents.length > 1) {
    return { allowed: false, reason: `Expected 1 tool-use event, got ${toolUseEvents.length}` }
  }

  const event = toolUseEvents[0]!

  if (event.name !== 'write') {
    return { allowed: false, reason: `Expected write tool, got ${event.name}` }
  }

  const input = event.input as Record<string, unknown>

  if (!('file_path' in input) || input['file_path'] === undefined) {
    return { allowed: false, reason: 'Missing file_path in write tool input' }
  }

  if (input['file_path'] !== expectedPath) {
    return { allowed: false, reason: `Wrong path: ${String(input['file_path'])}` }
  }

  const content = String(input['content'] ?? '')
  if (content.trimEnd() !== expectedContent.trimEnd()) {
    return { allowed: false, reason: 'Content mismatch' }
  }

  return { allowed: true }
}
