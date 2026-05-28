import { z } from 'zod'
import { SMOKE_EXPECTED_RESPONSE } from '../config/constants.js'

export const SmokeTranscriptSchema = z.object({
  sessionId: z.string().min(1),
  agentMessageText: z.string(),
  eventTypes: z.array(z.string()),
  toolUseCount: z.number().int().nonnegative(),
  completedIdle: z.boolean(),
})

export type SmokeTranscript = z.infer<typeof SmokeTranscriptSchema>

export interface TranscriptAssertionResult {
  passed: boolean
  reason?: string
}

export function assertSmokeTranscript(transcript: SmokeTranscript): TranscriptAssertionResult {
  if (transcript.toolUseCount > 0) {
    return { passed: false, reason: `Expected 0 tool-use events, got ${transcript.toolUseCount}` }
  }
  if (!transcript.completedIdle) {
    return { passed: false, reason: 'Session did not complete with status_idle (end_turn)' }
  }
  const trimmed = transcript.agentMessageText.trim()
  if (trimmed !== SMOKE_EXPECTED_RESPONSE) {
    return {
      passed: false,
      reason: `Expected response "${SMOKE_EXPECTED_RESPONSE}", got "${trimmed}"`,
    }
  }
  return { passed: true }
}
