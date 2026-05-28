import type { PendingToolUse, PolicyResult } from './tool-confirmation-policy.js'

export function evaluateBashPolicy(
  toolUseEvents: PendingToolUse[],
  allowedCommands: string[],
): PolicyResult {
  if (toolUseEvents.length === 0) {
    return { allowed: false, reason: 'Expected 1 tool-use event, got 0' }
  }
  if (toolUseEvents.length > 1) {
    return { allowed: false, reason: `Expected 1 tool-use event, got ${toolUseEvents.length}` }
  }

  const event = toolUseEvents[0]!

  if (event.name !== 'bash') {
    return { allowed: false, reason: `Expected bash tool, got ${event.name}` }
  }

  const input = event.input as Record<string, unknown>
  const command = String(input['command'] ?? '').trim()

  if (!command) {
    return { allowed: false, reason: 'Empty bash command' }
  }

  if (allowedCommands.some(allowed => command === allowed.trim())) {
    return { allowed: true }
  }

  return { allowed: false, reason: `Bash command not on allowlist: ${command}` }
}

export function evaluateWriteOutputPolicy(
  toolUseEvents: PendingToolUse[],
  allowedOutputPath: string,
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
  const filePath = String(input['file_path'] ?? '')

  if (filePath !== allowedOutputPath) {
    return { allowed: false, reason: `Write to unexpected path: ${filePath}` }
  }

  return { allowed: true }
}
