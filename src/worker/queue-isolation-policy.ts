/**
 * Queue isolation policy for self-hosted Environment workers.
 *
 * A self-hosted Environment is a work queue. Workers claim ANY session in
 * the queue. Shared-queue + run-specific-mount execution is prohibited.
 *
 * Rule: before creating a target session and starting a worker, verify that
 * the queue is fully drained (depth === 0 AND pending === 0). After the
 * worker claims a session, assert the claimed session ID matches the intended ID.
 */

import type { BetaSelfHostedWorkQueueStats } from '@anthropic-ai/sdk/resources/beta/environments/work'

export type { BetaSelfHostedWorkQueueStats }

export interface QueueIsolationViolation {
  type: 'DEPTH_NON_ZERO' | 'PENDING_NON_ZERO' | 'SESSION_MISMATCH'
  message: string
  stats?: { depth: number; pending: number }
  expected?: string
  actual?: string
}

export class QueueIsolationError extends Error {
  readonly violation: QueueIsolationViolation

  constructor(violation: QueueIsolationViolation) {
    super(violation.message)
    this.name = 'QueueIsolationError'
    this.violation = violation
  }
}

/**
 * Throws QueueIsolationError if the queue is not fully drained.
 * Must be called BEFORE creating the target session.
 */
export function assertQueueDrained(stats: BetaSelfHostedWorkQueueStats): void {
  if (stats.depth > 0) {
    throw new QueueIsolationError({
      type: 'DEPTH_NON_ZERO',
      message: `Queue isolation violation: depth=${stats.depth} (expected 0). Drain or use a dedicated environment.`,
      stats: { depth: stats.depth, pending: stats.pending },
    })
  }
  if (stats.pending > 0) {
    throw new QueueIsolationError({
      type: 'PENDING_NON_ZERO',
      message: `Queue isolation violation: pending=${stats.pending} (expected 0). Wait for in-flight sessions to complete.`,
      stats: { depth: stats.depth, pending: stats.pending },
    })
  }
}

/**
 * Throws QueueIsolationError if the claimed session ID does not match the
 * intended session ID. Must be called after the worker claims a session.
 */
export function assertClaimedSessionMatches(
  claimedId: string,
  expectedId: string,
): void {
  if (claimedId !== expectedId) {
    throw new QueueIsolationError({
      type: 'SESSION_MISMATCH',
      message: `Queue isolation violation: worker claimed session ${claimedId} but expected ${expectedId}. Queue was not drained before session creation.`,
      expected: expectedId,
      actual: claimedId,
    })
  }
}
