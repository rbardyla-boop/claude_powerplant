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
  nextAction: string
}
