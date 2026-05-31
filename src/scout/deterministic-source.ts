import path from 'path'
import type { CandidateSource, ScoutBundle, ScoutBundleFile, DiscoveryResult, SuppressionNote } from './candidate-source.js'
import { filesOutsideWriteCeiling } from './scout-candidate.js'
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

/**
 * A declared check ID to attach to a candidate. Prefers a REQUIRED check — the
 * hermetic gate that actually runs in the network-disabled, deps-excluded
 * sandbox — over an advisory one (e.g. dependency-bound pytest), and a
 * test-like name within that preference. Falls back to the first declared check.
 */
function pickCheckId(bundle: ScoutBundle): string {
  const entries = Object.entries(bundle.contract.allowedChecks)
  // loadProjectContract guarantees at least one declared check.
  const required = entries.filter(([, c]) => c.required)
  const pool = required.length > 0 ? required : entries
  return (pool.find(([id]) => /test/i.test(id)) ?? pool[0]!)[0]
}

// ── Test-gap helpers ──────────────────────────────────────────────────────────

// Test-gap stays a few small affordances, never an audit dump of every module.
const TEST_GAP_CAP = 3
// App-facing module names worth covering first.
const APP_HINTS = ['config', 'path', 'provider', 'sync', 'service']
// Directory segments that hold hook/utility oddities, not core app modules.
const DEPRIORITIZED_DIRS = ['.claude', 'hooks', 'scripts', 'bin', 'examples']
const APP_HINT_WEIGHT = 2
const LOCATION_PENALTY = 3
const NON_IMPORTABLE_PENALTY = 2

/** Module name without its extension (e.g. 'src/a/foo.ts' -> 'foo'). */
function moduleBase(rel: string): string {
  const file = rel.split('/').pop() ?? rel
  return file.replace(/\.(py|tsx?|jsx?)$/, '')
}

// Directory-name segments that denote a writable test root.
const TEST_DIR_SEGMENTS = ['tests', 'test', '__tests__']

/**
 * Writable test-root directories inferred from allowedWritePaths. A directory
 * glob like `tests/**` or `src/engine/tests/**` yields the root `tests/` or
 * `src/engine/tests/`. A single-file write path (e.g. `tests/AUDIT.md`) is NOT a
 * root — so audit-only contracts yield none, and test-gaps stay suppressed.
 */
function testRootsFromCeiling(allowedWritePaths: readonly string[]): string[] {
  const roots: string[] = []
  for (const p of allowedWritePaths) {
    const dir = /^(.*?)\/?\*\*?$/.exec(p)?.[1]
    if (dir === undefined) continue // not a `…/**` (or `…/*`) directory glob
    const lastSeg = dir.split('/').pop()
    if (lastSeg && TEST_DIR_SEGMENTS.includes(lastSeg)) {
      roots.push(dir.endsWith('/') ? dir : `${dir}/`)
    }
  }
  return roots
}

/** Directory portion of a relative path with a trailing slash ('' for root files). */
function dirOf(rel: string): string {
  return rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : ''
}

/**
 * Choose the best test root for a source file: prefer the root whose parent
 * directory is the closest ancestor of the source (e.g. `src/engine/tests/` for
 * `src/engine/foo.ts`), falling back to the first available root.
 */
function pickTestRoot(roots: string[], sourceDir: string): string | null {
  if (roots.length === 0) return null
  let best: string | null = null
  let bestLen = -1
  for (const root of roots) {
    const parent = root.replace(/(^|\/)(tests|test|__tests__)\/$/, '$1')
    if (sourceDir.startsWith(parent) && parent.length > bestLen) {
      best = root
      bestLen = parent.length
    }
  }
  return best ?? roots[0]!
}

/**
 * The test-file path for a source module, placed in the test root inferred from
 * the contract's writable paths — instead of assuming top-level `tests/`.
 * Returns null when no writable test root exists (caller suppresses the gap).
 */
function inferTestPath(rel: string, base: string, isPython: boolean, allowedWritePaths: readonly string[]): string | null {
  const root = pickTestRoot(testRootsFromCeiling(allowedWritePaths), dirOf(rel))
  if (root === null) return null
  return isPython ? `${root}test_${base}.py` : `${root}${base}.test.ts`
}

/** Illustrative top-level path used as the example in a suppression note. */
function defaultTestPath(base: string, isPython: boolean): string {
  return isPython ? `tests/test_${base}.py` : `tests/${base}.test.ts`
}

/** A valid Python module identifier — importable as a normal module. */
function isImportablePythonName(base: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(base)
}

/** Path sits under a hook/script/example directory segment. */
function inDeprioritizedLocation(rel: string): boolean {
  const segs = rel.toLowerCase().split('/')
  return segs.some(s => DEPRIORITIZED_DIRS.includes(s))
}

/**
 * Ranking score for a test-gap candidate — higher ranks sooner. This is a
 * RANKING layer, never an eligibility gate: awkward candidates are down-ranked,
 * not excluded, so evidence is preserved. Prefers importable, app-facing modules
 * over hook/utility scripts and non-importable filenames.
 */
function candidateScore(rel: string, base: string, isPython: boolean): number {
  const lower = base.toLowerCase()
  let score = APP_HINTS.reduce((n, hint) => (lower.includes(hint) ? n + APP_HINT_WEIGHT : n), 0)
  if (inDeprioritizedLocation(rel)) score -= LOCATION_PENALTY
  if (isPython && !isImportablePythonName(base)) score -= NON_IMPORTABLE_PENALTY
  return score
}

/** A file that is a test, used to decide whether a module is already covered. */
function isTestFile(rel: string): boolean {
  return /(^|\/)(tests?|__tests__)\//.test(rel)
    || /\.(test|spec)\.[jt]sx?$/.test(rel)
    || /(^|\/)test_[^/]*\.py$/.test(rel)
}

// Paths that look like source but should never get a "needs a test" candidate:
// existing tests, vendored/generated trees, config/declaration files, and
// package scaffolding.
function isTestGapExcluded(rel: string): boolean {
  const base = rel.split('/').pop() ?? rel
  if (isTestFile(rel)) return true
  if (/(^|\/)(\.venv|venv|node_modules|dist|build|__pycache__|migrations)\//.test(rel)) return true
  if (/\.(config|d)\.[jt]sx?$/.test(rel)) return true
  return ['conftest.py', '__init__.py', 'setup.py'].includes(base)
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

// ── H3: source module with no matching test (stack-aware) ─────────────────────
//
// Replaces the old CLI-command-only check and subsumes it (a CLI command is just
// a TS module under src/). Fires on Python and TS/JS modules. Rust is
// intentionally skipped — inline `#[cfg(test)]` / integration-test conventions
// need more precise analysis before we can RECOMMEND a test file. A candidate is
// only emitted when its proposed test path is inside the contract write ceiling.
// A real test-gap blocked ONLY by the ceiling is not dropped silently — it is
// counted into an aggregate SuppressionNote (informational; never a candidate,
// never a file, never runnable), so "0 candidates" can be explained honestly.
function detectTestGaps(bundle: ScoutBundle): { candidates: DraftCandidate[]; suppressed: SuppressionNote[] } {
  const testHaystack = bundle.files
    .filter(f => isTestFile(f.relativePath))
    .map(f => f.relativePath.toLowerCase())
    .join('\n')

  const drafts: Array<{ rel: string; base: string; testPath: string; isPython: boolean }> = []
  let suppressedCount = 0
  let suppressedExample = ''
  for (const f of bundle.files) {
    const rel = f.relativePath
    if (isTestGapExcluded(rel)) continue

    const isPython = /\.py$/.test(rel)
    if (!isPython && !/^src\/.*\.[jt]sx?$/.test(rel)) {
      continue // .rs and everything else: out of scope, not a ceiling suppression
    }

    const base = moduleBase(rel)
    // Conservative: a substring match in any test path counts as covered.
    if (testHaystack.includes(base.toLowerCase())) continue

    // Place the test in the writable test root inferred from the contract
    // (e.g. src/engine/tests/) instead of assuming top-level tests/.
    const testPath = inferTestPath(rel, base, isPython, bundle.contract.allowedWritePaths)
    // A real test-gap with no writable test root, or one the ceiling still
    // forbids, is suppressed (counted for visibility) — never an out-of-ceiling file.
    if (testPath === null || filesOutsideWriteCeiling([testPath], bundle.contract.allowedWritePaths).length > 0) {
      suppressedCount += 1
      if (!suppressedExample) suppressedExample = defaultTestPath(base, isPython)
      continue
    }

    drafts.push({ rel, base, testPath, isPython })
  }

  // Rank by usefulness (app-facing & importable first), then cap so this stays
  // a few small affordances. Ranking only — every eligible draft is kept here.
  drafts.sort((a, b) => candidateScore(b.rel, b.base, b.isPython) - candidateScore(a.rel, a.base, a.isPython))
  const candidates = drafts.slice(0, TEST_GAP_CAP).map(d =>
    draft(
      'test-gap',
      `Add a test for ${d.rel}`,
      `${d.rel} has no test, so regressions in it ship silently.`,
      [`${d.rel} exists`, `no test file references "${d.base}"`],
      [d.testPath],
      [pickCheckId(bundle)],
      ['do not change the module implementation — add coverage only'],
      'LOW',
    ),
  )

  const suppressed: SuppressionNote[] =
    suppressedCount > 0
      ? [{ domain: 'test-gap', reason: 'outside allowedWritePaths', count: suppressedCount, example: suppressedExample }]
      : []
  return { candidates, suppressed }
}

// ── Deterministic source ──────────────────────────────────────────────────────

// Candidate-only heuristics (no suppression tracking). detectTestGaps is run
// separately because it also reports suppressions.
const CANDIDATE_HEURISTICS: Heuristic[] = [
  detectMissingVersion,
  detectDocsMismatch,
]

export class DeterministicSource implements CandidateSource {
  readonly id = 'deterministic-v1'

  discover(bundle: ScoutBundle): DiscoveryResult {
    const heuristicDrafts = CANDIDATE_HEURISTICS.flatMap(h => h(bundle))
    const testGaps = detectTestGaps(bundle)
    const drafts = [...heuristicDrafts, ...testGaps.candidates]
    return {
      candidates: drafts.map((d, i) => ({ ...d, id: `scout-${String(i + 1).padStart(3, '0')}` })),
      suppressed: testGaps.suppressed,
    }
  }
}
