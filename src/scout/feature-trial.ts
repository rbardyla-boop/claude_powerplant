import fs from 'fs'
import path from 'path'
import { z } from 'zod'
import {
  VerificationCoverageSchema,
  classifyVerificationCoverage,
  type ScoutCandidate,
} from './scout-candidate.js'
import { matchesGlob } from '../projects/build-sanitized-workspace.js'
import type { LoadedProjectContract } from '../projects/load-project-contract.js'

// ── Feature Trial record (v1.5 Feature Lab traceability) ──────────────────────
// A FEATURE_TRIAL.json links a scout candidate to the run it drives: which
// candidate, which expected files, which non-goals, how meaningfully the change
// is verified, and the write ceiling actually in force. It is EVIDENCE ONLY — a
// superset of CANDIDATE_SCOPE.json carrying the extra context Feature Lab needs
// for candidate → trial → patch → review traceability.
//
// It grants no writes, changes no candidate status, and approves nothing. The
// embedded `claim` says so explicitly so the artifact cannot be mistaken for an
// authorization.

/** The trial record is evidence, never an approval. Embedded verbatim. */
export const FEATURE_TRIAL_CLAIM = 'This is a trial record, not approval.' as const

export const FeatureTrialSchema = z.object({
  candidateId: z.string(),
  candidateTitle: z.string(),
  source: z.string(),
  expectedFiles: z.array(z.string()),
  nonGoals: z.array(z.string()),
  verificationCoverage: VerificationCoverageSchema,
  scopeCeiling: z.array(z.string()),
  createdAt: z.string(),
  claim: z.literal(FEATURE_TRIAL_CLAIM),
})
export type FeatureTrial = z.infer<typeof FeatureTrialSchema>

type TrialContract = Pick<LoadedProjectContract, 'allowedWritePaths' | 'allowedChecks'>

/**
 * Build the evidence-only trial record for a candidate-driven run. Pure: no IO,
 * deterministic given `createdAt`.
 *
 * Authoritative, not asserted: `verificationCoverage` and `scopeCeiling` are
 * (re)derived from the LIVE contract, never copied from the (untrusted) candidate
 * file. A hand-edited or malicious candidate therefore cannot inject a misleading
 * coverage strength or a wider ceiling — the trial reflects what Powerplant
 * itself computed against the contract. `expectedFiles`/`nonGoals` are recorded
 * as proposed (they are already re-checked against the ceiling by
 * deriveTaskFromCandidate before this runs); recording them grants no write
 * access — the record is inert.
 */
export function buildFeatureTrial(
  candidate: ScoutCandidate,
  contract: TrialContract,
  opts: { createdAt?: string; source?: string } = {},
): FeatureTrial {
  return {
    candidateId: candidate.id,
    candidateTitle: candidate.title,
    source: opts.source ?? 'scout',
    expectedFiles: [...candidate.expectedFiles],
    nonGoals: [...candidate.nonGoals],
    // Recompute from the live contract — do NOT trust candidate.verificationCoverage.
    verificationCoverage: classifyVerificationCoverage(
      candidate.verification,
      candidate.expectedFiles,
      contract.allowedChecks,
    ),
    // The ceiling actually in force for this run, taken from the contract.
    scopeCeiling: [...contract.allowedWritePaths],
    createdAt: opts.createdAt ?? new Date().toISOString(),
    claim: FEATURE_TRIAL_CLAIM,
  }
}

/**
 * Write FEATURE_TRIAL.json into a run's artifact directory, beside
 * CANDIDATE_SCOPE.json. Evidence only — does not affect run/approve behavior.
 * Returns the written path.
 */
export function writeFeatureTrialArtifact(patchDir: string, trial: FeatureTrial): string {
  const filePath = path.join(patchDir, 'FEATURE_TRIAL.json')
  fs.writeFileSync(filePath, JSON.stringify(trial, null, 2) + '\n', 'utf-8')
  return filePath
}

// ── Non-goal adherence (advisory, heuristic) ──────────────────────────────────
// A candidate declares free-text non-goals ("Do not touch config files"). This
// is an ADVISORY check: do any files the patch touched — beyond the ones it
// declared it would — look like they violate a stated non-goal? It is a simple
// path/text heuristic, NOT semantic-intent analysis: it flags possible
// violations for a human to judge. It never gates approval or changes a verdict.

export interface NonGoalViolation {
  /** The declared non-goal that appears to be violated. */
  nonGoal: string
  /** Touched (undeclared) files that match the non-goal's path signal. */
  files: string[]
  /** The token or keyword that triggered the match (for transparency). */
  matched: string
}

// Curated, conservative phrase → path-signal map. Deliberately small: each entry
// maps an unambiguous non-goal phrase to an OBVIOUS file-path signal. Behavioral
// non-goals ("do not change behavior", "do not break the build") intentionally
// have no entry, so they never produce path-based false positives.
const KEYWORD_MATCHERS: ReadonlyArray<{ keywords: string[]; label: string; test: (f: string) => boolean }> = [
  { keywords: ['config', 'configuration', 'settings'], label: 'config',
    test: f => /(^|\/)config|\.config\.|\.(conf|toml|ini|cfg)$|\.(ya?ml)$|tauri\.conf\.json$/.test(f) },
  { keywords: ['schema'], label: 'schema', test: f => /schema/.test(f) },
  { keywords: ['migration', 'migrations'], label: 'migrations', test: f => /migrat/.test(f) },
  { keywords: ['lockfile', 'lock file', 'lockfiles'], label: 'lockfile',
    test: f => /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|cargo\.lock|poetry\.lock)$/.test(f) },
  { keywords: ['dependency', 'dependencies', 'manifest'], label: 'dependencies',
    test: f => /(^|\/)(package\.json|cargo\.toml|requirements\.txt|pyproject\.toml|go\.mod)$/.test(f) },
  { keywords: ['doc', 'docs', 'documentation', 'readme'], label: 'docs',
    test: f => /(^|\/)docs?\//.test(f) || /readme/.test(f) || /\.(md|markdown|rst)$/.test(f) },
  { keywords: ['workflow', 'workflows', ' ci ', 'pipeline', 'github action'], label: 'ci',
    test: f => /\.github\//.test(f) || /(^|\/)ci\//.test(f) },
  { keywords: ['docker', 'dockerfile'], label: 'docker',
    test: f => /dockerfile/.test(f) || /docker-compose/.test(f) },
  { keywords: ['stylesheet', 'css', 'styling'], label: 'styles', test: f => /\.(css|scss|sass|less)$/.test(f) },
]

/** Whitespace/punct-delimited tokens in a non-goal that look like a path/file/glob. */
function extractPathTokens(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map(t => t.replace(/^["'`([]+|["'`)\].,;:]+$/g, ''))
    .filter(t =>
      t.length >= 3 &&
      (t.includes('/') || /^\*?\.?[\w-]+\.[a-z0-9]{2,4}$/.test(t) || /^\*\.[a-z0-9]{2,4}$/.test(t)),
    )
}

/**
 * Heuristically flag touched files that appear to violate a declared non-goal.
 *
 * Only files NOT covered by the candidate's `expectedFiles` are considered — a
 * declared file is in-scope by construction, not a violation. For each non-goal,
 * a file is flagged if it matches a path/glob token named literally in the
 * non-goal text, or a curated keyword→path signal. Advisory only: callers must
 * present results as "possible" violations and never gate on them.
 */
export function detectNonGoalViolations(
  nonGoals: readonly string[],
  actualFiles: readonly string[],
  expectedFiles: readonly string[] = [],
): NonGoalViolation[] {
  const undeclared = actualFiles.filter(f => !expectedFiles.some(p => matchesGlob(f, p)))
  if (undeclared.length === 0) return []

  const violations: NonGoalViolation[] = []
  for (const nonGoal of nonGoals) {
    const lower = ` ${nonGoal.toLowerCase()} `
    const tokens = extractPathTokens(nonGoal.toLowerCase())
    let matchedLabel: string | null = null
    const files: string[] = []

    for (const f of undeclared) {
      const fl = f.toLowerCase()
      let hit: string | null = null
      for (const tok of tokens) {
        if (tok.includes('*') ? matchesGlob(fl, tok) : fl.includes(tok)) { hit = tok; break }
      }
      if (!hit) {
        for (const m of KEYWORD_MATCHERS) {
          if (m.keywords.some(k => lower.includes(k)) && m.test(fl)) { hit = m.label; break }
        }
      }
      if (hit) { files.push(f); matchedLabel ??= hit }
    }

    if (files.length > 0) violations.push({ nonGoal, files, matched: matchedLabel! })
  }
  return violations
}
