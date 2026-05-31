import type { ScoutReport } from './scan.js'
import type { ScoutCandidate, ScoutStatus } from './scout-candidate.js'

const STATUS_ORDER: ScoutStatus[] = ['RECOMMENDED', 'NEEDS_USER_DECISION', 'DEFER', 'REJECT']

const STATUS_BLURB: Record<ScoutStatus, string> = {
  RECOMMENDED: 'Low-risk, evidence-bound, verifiable, inside the write ceiling.',
  NEEDS_USER_DECISION: 'You decide — medium/high risk, or council review pending.',
  DEFER: 'Worth revisiting later.',
  REJECT: 'Cannot be built safely under the current contract (see notes).',
}

export function renderCandidatesJson(report: ScoutReport): string {
  return JSON.stringify(report, null, 2) + '\n'
}

function renderCandidate(c: ScoutCandidate): string {
  const lines: string[] = []
  lines.push(`#### \`${c.id}\` — ${c.title}`)
  lines.push('')
  lines.push(`- **Domain:** ${c.domain}`)
  lines.push(`- **Risk:** ${c.risk}`)
  lines.push(`- **Why it matters:** ${c.whyItMatters}`)
  lines.push(`- **Repo evidence:**`)
  for (const e of c.repoEvidence) lines.push(`  - ${e}`)
  lines.push(`- **Expected files:** ${c.expectedFiles.join(', ')}`)
  lines.push(`- **Verification:** ${c.verification.join(', ')}`)
  if (c.verificationCoverage) {
    lines.push(`- **Verification coverage:** ${c.verificationCoverage.strength} — ${c.verificationCoverage.reason}`)
  }
  if (c.nonGoals.length > 0) {
    lines.push(`- **Non-goals:**`)
    for (const g of c.nonGoals) lines.push(`  - ${g}`)
  }
  if (c.notes.length > 0) {
    lines.push(`- **Notes:**`)
    for (const n of c.notes) lines.push(`  - ${n}`)
  }
  return lines.join('\n')
}

export function renderCandidatesMarkdown(report: ScoutReport): string {
  const counts = new Map<ScoutStatus, number>()
  for (const c of report.candidates) counts.set(c.status, (counts.get(c.status) ?? 0) + 1)

  const out: string[] = []
  out.push(`# Scout Candidates — ${report.projectId}`)
  out.push('')
  out.push(
    `Generated ${report.generatedAt} from a sanitized snapshot of ${report.bundleFileCount} ` +
    `files (stack: ${report.stack}; sources: ${report.sourceIds.join(', ')}).`,
  )
  out.push('')
  out.push('> Scout recommends. You select. Powerplant patches one bounded task. You review and approve.')
  out.push('> Scout never writes product code, never approves, and never chains into a run automatically.')
  out.push('')

  // Summary
  out.push('## Summary')
  out.push('')
  out.push('| Status | Count | Meaning |')
  out.push('| --- | --- | --- |')
  for (const status of STATUS_ORDER) {
    out.push(`| ${status} | ${counts.get(status) ?? 0} | ${STATUS_BLURB[status]} |`)
  }
  out.push('')

  // Suppressed — candidate-shaped evidence the contract blocked. Informational
  // only: not candidates, no candidate files, never runnable.
  if (report.suppressed.length > 0) {
    out.push('## Suppressed — not actionable under this contract')
    out.push('')
    out.push('| Domain | Count | Reason | Example |')
    out.push('| --- | --- | --- | --- |')
    for (const s of report.suppressed) {
      out.push(`| ${s.domain} | ${s.count} | ${s.reason} | \`${s.example}\` |`)
    }
    out.push('')
  }

  if (report.candidates.length === 0) {
    out.push(
      report.suppressed.length > 0
        ? '_No actionable candidates under this contract (see Suppressed above)._'
        : '_No affordances found in the sanitized bundle._',
    )
    out.push('')
    return out.join('\n')
  }

  for (const status of STATUS_ORDER) {
    const group = report.candidates.filter(c => c.status === status)
    if (group.length === 0) continue
    out.push(`## ${status}`)
    out.push('')
    for (const c of group) {
      out.push(renderCandidate(c))
      out.push('')
      if (status === 'RECOMMENDED' || status === 'NEEDS_USER_DECISION') {
        out.push('To turn this into a scoped, reviewable patch:')
        out.push('')
        out.push('```bash')
        out.push(`powerplant run . --candidate .scout/candidates/${c.id}.json`)
        out.push('```')
        out.push('')
      }
    }
  }

  return out.join('\n')
}
