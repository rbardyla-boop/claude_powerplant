import Anthropic from '@anthropic-ai/sdk'
import type { BetaSelfHostedWorkQueueStats } from '@anthropic-ai/sdk/resources/beta/environments/work'
import { assertQueueDrained } from '../worker/queue-isolation-policy.js'

export interface QueuePreflightResult {
  passed: boolean
  stats: BetaSelfHostedWorkQueueStats
  message: string
}

/**
 * Queries the environment work queue and verifies depth === 0 AND pending === 0.
 *
 * Returns a result object rather than throwing so callers can log the outcome
 * before deciding whether to abort. Use assertQueueDrained() in the runner
 * itself to enforce the invariant at the point of use.
 */
export async function checkWorkQueuePreflight(
  client: Anthropic,
  environmentId: string,
): Promise<QueuePreflightResult> {
  const stats = await client.beta.environments.work.stats(environmentId)

  if (stats.depth === 0 && stats.pending === 0) {
    return {
      passed: true,
      stats,
      message: `Queue clear — depth=${stats.depth}, pending=${stats.pending}`,
    }
  }

  const parts: string[] = []
  if (stats.depth > 0) parts.push(`depth=${stats.depth} (expected 0)`)
  if (stats.pending > 0) parts.push(`pending=${stats.pending} (expected 0)`)
  return {
    passed: false,
    stats,
    message: `Queue not drained — ${parts.join(', ')}. Drain or use a dedicated environment.`,
  }
}

/**
 * Checks queue stats and throws QueueIsolationError if not drained.
 * Convenience wrapper over checkWorkQueuePreflight + assertQueueDrained.
 */
export async function requireQueueDrained(
  client: Anthropic,
  environmentId: string,
): Promise<BetaSelfHostedWorkQueueStats> {
  const stats = await client.beta.environments.work.stats(environmentId)
  assertQueueDrained(stats)
  return stats
}
