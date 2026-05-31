export interface ReviewRenderState {
  runId: string
  projectId: string
  task: string
  overallStatus: 'PASS' | 'FAIL' | 'RISK' | 'UNKNOWN'
  /** Populated when the run terminated without producing complete artifacts. */
  terminationNote: string | null
  diff: {
    files: number
    linesAdded: number
    linesRemoved: number
    raw: string
  }
  checks: Array<{
    name: string
    status: 'pass' | 'fail' | 'skip'
    exitCode: number | null
    snippet: string
    advisory?: boolean
  }>
  risks: Array<{
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
    finding: string
  }>
  /** Present only for runs driven by a scout candidate (`run --candidate`). */
  scopeDrift?: {
    candidateId: string
    /** Files the candidate declared it would touch. */
    expected: string[]
    /** Files the patch actually touched. */
    actual: string[]
    /** Touched files not covered by any expected pattern — the drift signal. */
    unexpected: string[]
    /** Expected files the patch did not touch — informational. */
    missing: string[]
    status: 'none' | 'drift'
  }
  nextAction: string
}
