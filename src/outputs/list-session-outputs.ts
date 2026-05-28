import Anthropic from '@anthropic-ai/sdk'
import type { Files } from '@anthropic-ai/sdk/resources/beta/files.js'

const BETA_HEADER = 'managed-agents-2026-04-01'
const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 2000

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function listSessionOutputs(
  client: Anthropic,
  sessionId: string,
): Promise<Files.FileMetadata[]> {
  let lastResult: Files.FileMetadata[] = []

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await client.beta.files.list({
      scope_id: sessionId,
      betas: [BETA_HEADER],
    })

    lastResult = response.data
    if (lastResult.length > 0) return lastResult

    if (attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_DELAY_MS)
    }
  }

  return lastResult
}
