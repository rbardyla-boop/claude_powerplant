// Parses VERIFICATION_REPORT.md artifacts into structured check-attempt data.
// Two formats exist:
//   current — uses "### Check: `<id>`" sections (sprint4a+)
//   legacy  — uses "Check ID: `<id>`" lines (pre-sprint4a)
//
// The current format records ALL check invocations, including intermediate
// self-correction attempts. The legacy format records only the final result
// of a single check and is treated as opaque.

export interface CheckAttempt {
  readonly checkId: string
  readonly verdict: string
  readonly isPass: boolean
}

export type VerificationFormat = 'current' | 'legacy' | 'unknown'

export interface ParsedVerification {
  readonly format: VerificationFormat
  readonly attempts: readonly CheckAttempt[]
  /** PASS if all final (last-occurrence) checks passed; FAIL if any did not;
   *  UNKNOWN for legacy/unknown format — never invented from sessionSummary. */
  readonly finalVerdict: 'PASS' | 'FAIL' | 'UNKNOWN'
  /** Indices in `attempts` that are intermediate self-correction steps
   *  (not the last occurrence of their checkId). */
  readonly intermediateIndices: ReadonlySet<number>
  /** True when at least one attempt carried a FAIL_VERIFICATION_INTEGRITY verdict. */
  readonly hasIntegrityFailure: boolean
}

function computeIntermediates(attempts: CheckAttempt[]): Set<number> {
  const lastByCheckId = new Map<string, number>()
  for (let i = 0; i < attempts.length; i++) {
    lastByCheckId.set(attempts[i]!.checkId, i)
  }
  const intermediates = new Set<number>()
  for (let i = 0; i < attempts.length; i++) {
    if (lastByCheckId.get(attempts[i]!.checkId) !== i) {
      intermediates.add(i)
    }
  }
  return intermediates
}

function computeFinalVerdict(
  attempts: CheckAttempt[],
  intermediates: Set<number>,
): 'PASS' | 'FAIL' {
  if (attempts.length === 0) return 'FAIL'
  for (let i = 0; i < attempts.length; i++) {
    if (!intermediates.has(i) && !attempts[i]!.isPass) return 'FAIL'
  }
  return 'PASS'
}

export function parseVerificationReport(md: string): ParsedVerification {
  // ── Current format ─────────────────────────────────────────────────────────
  if (md.includes('### Check:')) {
    const sectionRe = /### Check: `([^`]+)`[\s\S]*?Result: \*\*([^*]+)\*\*/g
    const attempts: CheckAttempt[] = []
    let m: RegExpExecArray | null
    while ((m = sectionRe.exec(md)) !== null) {
      const checkId = m[1] ?? ''
      const verdict = (m[2] ?? '').trim()
      attempts.push({ checkId, verdict, isPass: verdict === 'PASS' })
    }
    const intermediates = computeIntermediates(attempts)
    const finalVerdict = computeFinalVerdict(attempts, intermediates)
    const hasIntegrityFailure = attempts.some(a => a.verdict === 'FAIL_VERIFICATION_INTEGRITY')
    return { format: 'current', attempts, finalVerdict, intermediateIndices: intermediates, hasIntegrityFailure }
  }

  // ── Legacy format ──────────────────────────────────────────────────────────
  if (md.includes('Check ID:')) {
    return {
      format: 'legacy',
      attempts: [],
      finalVerdict: 'UNKNOWN',
      intermediateIndices: new Set(),
      hasIntegrityFailure: false,
    }
  }

  return {
    format: 'unknown',
    attempts: [],
    finalVerdict: 'UNKNOWN',
    intermediateIndices: new Set(),
    hasIntegrityFailure: false,
  }
}
