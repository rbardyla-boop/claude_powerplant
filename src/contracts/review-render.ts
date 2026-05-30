export interface ReviewRenderState {
  runId: string
  projectId: string
  task: string
  overallStatus: 'PASS' | 'FAIL' | 'RISK' | 'UNKNOWN'
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
  }>
  risks: Array<{
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
    finding: string
  }>
  nextAction: string
}
