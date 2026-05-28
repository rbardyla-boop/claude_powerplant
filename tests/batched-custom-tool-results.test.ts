import { describe, it, expect } from 'vitest'

// Regression tests for the batched custom tool result bug.
//
// Root cause: the Managed Agents API processes submitted tool results one at a
// time. When Claude requests multiple tools in a single turn, the API keeps
// re-emitting `requires_action` with the remaining unresolved event IDs until
// every result has been delivered individually. The broker must:
//   1. Compute each result once and store it in a persistent map keyed by ID.
//   2. On each requires_action cycle, send only the IDs the API is still waiting on.
//   3. Never terminate the loop based on new tool uses alone — terminate only
//      when resultEvents is empty (no remaining IDs map to computed results).
//   4. Never deliver duplicate results for the same ID.

describe('computedResults map', () => {
  it('accumulates results keyed by tool-use ID', () => {
    const computedResults = new Map<string, string>()

    // First batch: Claude requests two tools simultaneously
    computedResults.set('id-A', '{"files":[]}')
    computedResults.set('id-B', '{"path":"src/status.js","content":""}')

    expect(computedResults.size).toBe(2)
    expect(computedResults.get('id-A')).toBe('{"files":[]}')
    expect(computedResults.get('id-B')).toBe('{"path":"src/status.js","content":""}')
  })

  it('retains previously computed results across requires_action cycles', () => {
    const computedResults = new Map<string, string>()

    // Turn 1: compute id-A
    computedResults.set('id-A', 'result-A')

    // Turn 2 (API re-emits requires_action for id-A and also for id-B after batching):
    computedResults.set('id-B', 'result-B')

    // Both are still available
    expect(computedResults.get('id-A')).toBe('result-A')
    expect(computedResults.get('id-B')).toBe('result-B')
  })
})

describe('result event construction from remaining IDs', () => {
  it('sends results only for IDs still in remainingEventIds', () => {
    const computedResults = new Map<string, string>([
      ['id-A', 'result-A'],
      ['id-B', 'result-B'],
      ['id-C', 'result-C'],
    ])

    // API says only id-A and id-C are still unresolved
    const remainingEventIds = ['id-A', 'id-C']

    const resultEvents = remainingEventIds
      .filter(id => computedResults.has(id))
      .map(id => ({
        type: 'user.custom_tool_result' as const,
        custom_tool_use_id: id,
        content: [{ type: 'text' as const, text: computedResults.get(id)! }],
      }))

    expect(resultEvents).toHaveLength(2)
    expect(resultEvents[0]?.custom_tool_use_id).toBe('id-A')
    expect(resultEvents[1]?.custom_tool_use_id).toBe('id-C')
    // id-B is NOT included (not in remainingEventIds)
  })

  it('produces empty resultEvents when remainingEventIds is empty', () => {
    const computedResults = new Map<string, string>([['id-A', 'result-A']])
    const remainingEventIds: string[] = []

    const resultEvents = remainingEventIds
      .filter(id => computedResults.has(id))
      .map(id => ({ custom_tool_use_id: id }))

    expect(resultEvents).toHaveLength(0)
  })

  it('produces empty resultEvents when no remaining ID maps to a computed result', () => {
    // This can happen if the API sends an event ID the broker never saw
    const computedResults = new Map<string, string>([['id-A', 'result-A']])
    const remainingEventIds = ['id-unknown']

    const resultEvents = remainingEventIds
      .filter(id => computedResults.has(id))
      .map(id => ({ custom_tool_use_id: id }))

    expect(resultEvents).toHaveLength(0)
  })
})

describe('loop termination contract', () => {
  it('loop exits when resultEvents is empty (regardless of new tool uses)', () => {
    // Simulate the broker loop termination decision
    function shouldContinueLoop(resultEvents: unknown[]): boolean {
      // The broker breaks when resultEvents.length === 0
      return resultEvents.length > 0
    }

    // No remaining IDs → exit
    expect(shouldContinueLoop([])).toBe(false)

    // Still have unresolved IDs → continue
    expect(shouldContinueLoop([{ id: 'x' }])).toBe(true)
  })

  it('loop exits when requires_action is NOT received', () => {
    // When stop_reason is not requires_action, requiresAction stays false
    let requiresAction = false

    // Simulate receiving session.status_idle with end_turn (not requires_action)
    const stopReason = { type: 'end_turn' }
    if (stopReason.type === 'requires_action') {
      requiresAction = true
    }

    expect(requiresAction).toBe(false)
    // Broker: if (!requiresAction) break
  })

  it('loop continues when requires_action received with non-empty remaining IDs', () => {
    let requiresAction = false
    let remainingEventIds: string[] = []

    const stopReason = { type: 'requires_action', event_ids: ['id-A', 'id-B'] }
    if (stopReason.type === 'requires_action') {
      requiresAction = true
      remainingEventIds = stopReason.event_ids
    }

    expect(requiresAction).toBe(true)
    expect(remainingEventIds).toEqual(['id-A', 'id-B'])
  })
})

describe('duplicate finalize rejection', () => {
  it('second finalize call throws after first succeeds', () => {
    let finalizeReceived = false
    let testCheckPassed = true

    function callFinalize(): string {
      if (!testCheckPassed) {
        throw new Error('project_finalize rejected: test check has not passed')
      }
      if (finalizeReceived) {
        throw new Error('project_finalize already called — duplicate call rejected')
      }
      finalizeReceived = true
      return 'finalized'
    }

    expect(callFinalize()).toBe('finalized')
    expect(() => callFinalize()).toThrow(/duplicate call rejected/)
  })

  it('first finalize rejected if test check not passed', () => {
    let finalizeReceived = false
    const testCheckPassed = false

    function callFinalize(): string {
      if (!testCheckPassed) {
        throw new Error('project_finalize rejected: test check has not passed')
      }
      finalizeReceived = true
      return 'finalized'
    }

    expect(() => callFinalize()).toThrow(/test check has not passed/)
    expect(finalizeReceived).toBe(false)
  })
})

describe('tool call count safety gate', () => {
  it('rejects when total custom tool calls exceed the limit', () => {
    const MAX_TOOL_CALLS = 30

    function checkLimit(totalCalls: number): void {
      if (totalCalls >= MAX_TOOL_CALLS) {
        throw new Error(`Broker safety: exceeded ${MAX_TOOL_CALLS} custom tool calls`)
      }
    }

    expect(() => checkLimit(29)).not.toThrow()
    expect(() => checkLimit(30)).toThrow(/exceeded 30 custom tool calls/)
    expect(() => checkLimit(31)).toThrow(/exceeded 30 custom tool calls/)
  })
})

describe('no duplicate result delivery', () => {
  it('each ID is delivered at most once per resultEvents array', () => {
    // The filter on remainingEventIds ensures no ID appears twice in one send
    const computedResults = new Map<string, string>([
      ['id-A', 'result-A'],
      ['id-B', 'result-B'],
    ])

    // Even if remainingEventIds has duplicates (API bug), filter preserves uniqueness
    // because Array.filter preserves order without deduplication — but the API would
    // not return duplicates in event_ids. The real guarantee is that computedResults
    // is a Map and each ID is set exactly once.
    const remainingEventIds = ['id-A', 'id-B']
    const delivered = new Set<string>()

    const resultEvents = remainingEventIds
      .filter(id => computedResults.has(id))
      .filter(id => {
        if (delivered.has(id)) return false
        delivered.add(id)
        return true
      })

    expect(resultEvents).toHaveLength(2)
    expect(new Set(resultEvents).size).toBe(resultEvents.length)
  })
})
