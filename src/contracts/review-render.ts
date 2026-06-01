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
  /**
   * Present when a valid FEATURE_TRIAL.json was found in the run's artifact
   * directory (candidate-driven runs from `run --candidate`). Informational
   * only — it never affects overallStatus, nextAction, or approve eligibility.
   * It joins the trial's recorded candidate/scope/coverage with the actual files
   * the patch touched so a reviewer can see whether the trial stayed faithful.
   */
  featureTrial?: {
    candidateId: string
    candidateTitle: string
    /** Files the candidate declared it would touch (from the trial record). */
    expectedFiles: string[]
    /** Non-goals the candidate declared (from the trial record). */
    nonGoals: string[]
    /** How meaningfully the change is verified, recomputed at trial time. */
    verificationCoverage: { strength: string; reason: string }
    /** allowedWritePaths captured at trial time (from the trial record). */
    scopeCeiling: string[]
    /** Files the patch actually touched (from the diff). */
    actualFiles: string[]
    /** Touched files not covered by any expected pattern — the drift signal. */
    unexpectedFiles: string[]
    drift: 'none' | 'drift'
    /**
     * Advisory, heuristic: undeclared touched files that appear to violate a
     * declared non-goal (path/text match only — not semantic intent). Empty when
     * none detected. Informational; never affects status or eligibility.
     */
    nonGoalViolations: Array<{ nonGoal: string; files: string[]; matched: string }>
  }
  /**
   * Set when FEATURE_TRIAL.json exists but could not be read/parsed. The trial
   * panel is omitted; this warning is surfaced instead. Fail-safe: it never
   * changes classification or eligibility.
   */
  featureTrialWarning?: string
  nextAction: string
}
