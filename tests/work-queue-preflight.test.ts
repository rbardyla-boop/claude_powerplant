import { describe, it, expect, vi } from 'vitest'
import { checkWorkQueuePreflight, requireQueueDrained } from '../src/diagnostics/work-queue-preflight.js'
import { QueueIsolationError } from '../src/worker/queue-isolation-policy.js'
import type { BetaSelfHostedWorkQueueStats } from '@anthropic-ai/sdk/resources/beta/environments/work'

function makeStats(depth: number, pending: number): BetaSelfHostedWorkQueueStats {
  return {
    type: 'work_queue_stats',
    depth,
    pending,
    oldest_queued_at: null,
    workers_polling: null,
  }
}

function makeClient(stats: BetaSelfHostedWorkQueueStats) {
  return {
    beta: {
      environments: {
        work: {
          stats: vi.fn().mockResolvedValue(stats),
        },
      },
    },
  } as unknown as import('@anthropic-ai/sdk').default
}

describe('checkWorkQueuePreflight', () => {
  it('returns passed=true when depth and pending are both 0', async () => {
    const client = makeClient(makeStats(0, 0))
    const result = await checkWorkQueuePreflight(client, 'env_test')
    expect(result.passed).toBe(true)
    expect(result.stats.depth).toBe(0)
    expect(result.stats.pending).toBe(0)
    expect(result.message).toMatch(/Queue clear/)
  })

  it('returns passed=false when depth > 0', async () => {
    const client = makeClient(makeStats(2, 0))
    const result = await checkWorkQueuePreflight(client, 'env_test')
    expect(result.passed).toBe(false)
    expect(result.message).toMatch(/depth=2/)
  })

  it('returns passed=false when pending > 0', async () => {
    const client = makeClient(makeStats(0, 1))
    const result = await checkWorkQueuePreflight(client, 'env_test')
    expect(result.passed).toBe(false)
    expect(result.message).toMatch(/pending=1/)
  })

  it('returns passed=false and mentions both when both > 0', async () => {
    const client = makeClient(makeStats(3, 2))
    const result = await checkWorkQueuePreflight(client, 'env_test')
    expect(result.passed).toBe(false)
    expect(result.message).toMatch(/depth=3/)
    expect(result.message).toMatch(/pending=2/)
  })

  it('calls stats with the given environment ID', async () => {
    const client = makeClient(makeStats(0, 0))
    await checkWorkQueuePreflight(client, 'env_my_environment')
    expect(client.beta.environments.work.stats).toHaveBeenCalledWith('env_my_environment')
  })
})

describe('requireQueueDrained', () => {
  it('resolves and returns stats when queue is drained', async () => {
    const stats = makeStats(0, 0)
    const client = makeClient(stats)
    const result = await requireQueueDrained(client, 'env_test')
    expect(result.depth).toBe(0)
    expect(result.pending).toBe(0)
  })

  it('throws QueueIsolationError when depth > 0', async () => {
    const client = makeClient(makeStats(1, 0))
    await expect(requireQueueDrained(client, 'env_test')).rejects.toThrow(QueueIsolationError)
  })

  it('throws QueueIsolationError when pending > 0', async () => {
    const client = makeClient(makeStats(0, 2))
    await expect(requireQueueDrained(client, 'env_test')).rejects.toThrow(QueueIsolationError)
  })
})
