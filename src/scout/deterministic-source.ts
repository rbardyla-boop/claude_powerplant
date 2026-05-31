import path from 'path'
import type { CandidateSource, ScoutBundle, ScoutBundleFile } from './candidate-source.js'
import type { ProposedCandidate, ScoutDomain, ScoutRisk } from './scout-candidate.js'

// Scout finds SMALL affordances, not an audit dump. Each heuristic is capped so
// a large repo cannot flood the candidate list.
const MAX_PER_HEURISTIC = 10

// A heuristic proposes candidates without ids; the source assigns ids centrally.
type DraftCandidate = Omit<ProposedCandidate, 'id'>
type Heuristic = (bundle: ScoutBundle) => DraftCandidate[]

// ── Shared helpers ────────────────────────────────────────────────────────────

function findFile(bundle: ScoutBundle, predicate: (f: ScoutBundleFile) => boolean): ScoutBundleFile | undefined {
  return bundle.files.find(predicate)
}

/** Escape a (user-controlled) string for safe literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A declared check ID to attach to a candidate. Prefers a test-like check. */
function pickCheckId(bundle: ScoutBundle): string {
  const ids = Object.keys(bundle.contract.allowedChecks)
  // loadProjectContract guarantees at least one declared check.
  return ids.find(id => /test/i.test(id)) ?? ids[0]!
}

/** The CLI router entry: a src/cli file that parses process.argv. */
function findRouter(bundle: ScoutBundle): ScoutBundleFile | undefined {
  return findFile(
    bundle,
    f => f.relativePath.startsWith('src/cli/') && f.relativePath.endsWith('.ts') && f.content.includes('process.argv'),
  )
}

function draft(
  domain: ScoutDomain,
  title: string,
  whyItMatters: string,
  repoEvidence: string[],
  expectedFiles: string[],
  verification: string[],
  nonGoals: string[],
  risk: ScoutRisk = 'LOW',
): DraftCandidate {
  return { domain, title, whyItMatters, repoEvidence, expectedFiles, verification, nonGoals, risk }
}

// ── H1: missing `--version` affordance ────────────────────────────────────────

const detectMissingVersion: Heuristic = bundle => {
  const router = findRouter(bundle)
  if (!router) return []

  const pkg = findFile(bundle, f => f.relativePath === 'package.json')
  if (!pkg) return []
  let hasVersionField = false
  try {
    hasVersionField = typeof (JSON.parse(pkg.content) as { version?: unknown }).version === 'string'
  } catch {
    return []
  }
  if (!hasVersionField) return []

  const cliFiles = bundle.files.filter(f => f.relativePath.startsWith('src/cli/') && f.relativePath.endsWith('.ts'))
  const hasVersionHandler = cliFiles.some(f => f.content.includes('--version'))
  if (hasVersionHandler) return []

  return [
    draft(
      'cli-affordance',
      'Add a --version command',
      'Users cannot confirm which build of the CLI they are running, creating install/usage ambiguity.',
      [
        `${router.relativePath} parses process.argv but handles no --version flag`,
        'package.json declares a version field',
      ],
      [router.relativePath],
      [pickCheckId(bundle)],
      ['do not change existing command semantics', 'do not alter run/review/approve behavior'],
    ),
  ]
}

// ── H2: README references a command the router does not handle ────────────────

const detectDocsMismatch: Heuristic = bundle => {
  const readme = findFile(bundle, f => path.basename(f.relativePath).toLowerCase() === 'readme.md')
  if (!readme) return []
  const router = findRouter(bundle)
  if (!router) return []

  // Commands the router actually handles, from `case '<cmd>':` labels.
  const known = new Set<string>()
  for (const m of router.content.matchAll(/case\s+['"]([a-z][a-z-]*)['"]/g)) known.add(m[1]!)
  if (known.size === 0) return []

  const binName = bundle.projectId.split('-')[0] ?? 'cli'
  // Only count "<binName> <cmd>" usages to avoid prose false positives.
  const referenced = new Set<string>()
  // binName derives from projectId (user-controlled) — escape before RegExp use.
  const usageRe = new RegExp(`\\b${escapeRegExp(binName)}\\s+([a-z][a-z-]*)`, 'g')
  for (const m of readme.content.matchAll(usageRe)) referenced.add(m[1]!)

  const missing = [...referenced].filter(cmd => !known.has(cmd) && !cmd.startsWith('-'))
  return missing.slice(0, MAX_PER_HEURISTIC).map(cmd =>
    draft(
      'docs-mismatch',
      `README documents '${binName} ${cmd}' but the CLI has no such command`,
      'Documentation and the command router disagree, which misleads new users.',
      [
        `${readme.relativePath} references "${binName} ${cmd}"`,
        `${router.relativePath} declares no case for "${cmd}"`,
      ],
      [readme.relativePath],
      [pickCheckId(bundle)],
      [
        'do not invent a new command to match the docs — fix direction is for a human to confirm',
      ],
    ),
  )
}

// ── H3: CLI command module with no matching test ──────────────────────────────

const detectCliCommandTestGaps: Heuristic = bundle => {
  const commandRe = /^src\/cli\/commands\/([^/]+)\.ts$/
  const testFiles = bundle.files.filter(f => f.relativePath.startsWith('tests/'))
  const testHaystack = testFiles.map(f => f.relativePath.toLowerCase()).join('\n')

  const gaps: DraftCandidate[] = []
  for (const f of bundle.files) {
    if (f.relativePath.endsWith('.test.ts')) continue
    const m = commandRe.exec(f.relativePath)
    if (!m) continue
    const base = m[1]!
    // Conservative: a substring match counts as covered (favors false negatives).
    if (testHaystack.includes(base.toLowerCase())) continue
    gaps.push(
      draft(
        'test-gap',
        `Add a test for the '${base}' command`,
        `The ${base} command has no test, so regressions in it ship silently.`,
        [
          `${f.relativePath} exists`,
          `no file under tests/ references "${base}"`,
        ],
        [`tests/cli-${base}.test.ts`],
        [pickCheckId(bundle)],
        ['do not change the command implementation — add coverage only'],
      ),
    )
    if (gaps.length >= MAX_PER_HEURISTIC) break
  }
  return gaps
}

// ── Deterministic source ──────────────────────────────────────────────────────

const HEURISTICS: Heuristic[] = [
  detectMissingVersion,
  detectDocsMismatch,
  detectCliCommandTestGaps,
]

export class DeterministicSource implements CandidateSource {
  readonly id = 'deterministic-v1'

  discover(bundle: ScoutBundle): ProposedCandidate[] {
    const drafts = HEURISTICS.flatMap(h => h(bundle))
    return drafts.map((d, i) => ({
      ...d,
      id: `scout-${String(i + 1).padStart(3, '0')}`,
    }))
  }
}
