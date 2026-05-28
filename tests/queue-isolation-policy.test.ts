import { describe, it, expect } from 'vitest'
import {
  assertQueueDrained,
  assertClaimedSessionMatches,
  QueueIsolationError,
} from '../src/worker/queue-isolation-policy.js'
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

describe('assertQueueDrained', () => {
  it('passes when depth === 0 and pending === 0', () => {
    expect(() => assertQueueDrained(makeStats(0, 0))).not.toThrow()
  })

  it('throws DEPTH_NON_ZERO when depth > 0', () => {
    expect(() => assertQueueDrained(makeStats(1, 0))).toThrow(QueueIsolationError)
    try {
      assertQueueDrained(makeStats(2, 0))
    } catch (err) {
      expect((err as QueueIsolationError).violation.type).toBe('DEPTH_NON_ZERO')
      expect((err as QueueIsolationError).violation.stats?.depth).toBe(2)
    }
  })

  it('throws PENDING_NON_ZERO when pending > 0', () => {
    expect(() => assertQueueDrained(makeStats(0, 3))).toThrow(QueueIsolationError)
    try {
      assertQueueDrained(makeStats(0, 3))
    } catch (err) {
      expect((err as QueueIsolationError).violation.type).toBe('PENDING_NON_ZERO')
      expect((err as QueueIsolationError).violation.stats?.pending).toBe(3)
    }
  })

  it('throws on depth > 0 even if pending === 0', () => {
    expect(() => assertQueueDrained(makeStats(5, 0))).toThrow(QueueIsolationError)
  })

  it('throws on depth === 0 but pending > 0', () => {
    expect(() => assertQueueDrained(makeStats(0, 1))).toThrow(QueueIsolationError)
  })

  it('throws on both depth > 0 and pending > 0 (depth check wins)', () => {
    expect(() => assertQueueDrained(makeStats(1, 1))).toThrow(QueueIsolationError)
    try {
      assertQueueDrained(makeStats(1, 1))
    } catch (err) {
      expect((err as QueueIsolationError).violation.type).toBe('DEPTH_NON_ZERO')
    }
  })
})

describe('assertClaimedSessionMatches', () => {
  it('passes when claimed ID matches expected ID', () => {
    expect(() =>
      assertClaimedSessionMatches('sesn_abc123', 'sesn_abc123'),
    ).not.toThrow()
  })

  it('throws SESSION_MISMATCH when IDs differ', () => {
    expect(() =>
      assertClaimedSessionMatches('sesn_wrong', 'sesn_expected'),
    ).toThrow(QueueIsolationError)
    try {
      assertClaimedSessionMatches('sesn_wrong', 'sesn_expected')
    } catch (err) {
      const e = err as QueueIsolationError
      expect(e.violation.type).toBe('SESSION_MISMATCH')
      expect(e.violation.expected).toBe('sesn_expected')
      expect(e.violation.actual).toBe('sesn_wrong')
    }
  })

  it('is case-sensitive', () => {
    expect(() =>
      assertClaimedSessionMatches('sesn_ABC', 'sesn_abc'),
    ).toThrow(QueueIsolationError)
  })
})

describe('QueueIsolationError', () => {
  it('is instanceof Error', () => {
    const err = new QueueIsolationError({
      type: 'DEPTH_NON_ZERO',
      message: 'test',
      stats: { depth: 1, pending: 0 },
    })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('QueueIsolationError')
    expect(err.message).toBe('test')
  })
})
