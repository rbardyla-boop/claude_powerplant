// Artifact-integrity guard for project_write_file.
//
// Observed in dogfood run pp-run-1780221427722 (poly trading bot): an agent
// emitted a large Python file as project_write_file content where every line
// separator was a literal two-character "\n" escape instead of a real newline.
// The broker wrote those bytes verbatim, producing a 16 KB single-physical-line
// file that is invalid Python. Verification passed because the VERIFY checks ran
// against the existing repo, not the new artifact — a false sense of success.
//
// Powerplant cannot control what bytes the model emits, but it MUST refuse to
// materialize an artifact whose line separators are escaped. Rejecting the write
// surfaces the corruption to the agent (which can re-send with real newlines) and
// composes with the v0.2.10 incomplete-run fix: a rejected write yields an honest
// FAILED_INCOMPLETE run, never a corrupt-but-"verified" patch.

/** Source-code extensions where a single giant escaped line is never legitimate. */
const CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.go', '.rs', '.java', '.kt', '.scala', '.swift',
  '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.rb', '.php', '.sh',
])

/**
 * Prose/document-deliverable extensions. Powerplant's audit/report deliverables
 * are Markdown (e.g. docs/STEAM_BETA_AUDIT.md), and a real multi-section report
 * has many physical newlines — so the same escaped-newline signature catches a
 * single-line escaped artifact without flagging normal prose. Added after a
 * Steam-beta audit run materialized a one-line escaped Markdown report that
 * still "passed" review.
 */
const DOC_EXTENSIONS: ReadonlySet<string> = new Set([
  '.md', '.markdown', '.txt', '.rst',
])

export interface CorruptionResult {
  readonly corrupt: boolean
  readonly reason?: string
}

function extensionOf(relPath: string): string {
  const dot = relPath.lastIndexOf('.')
  return dot === -1 ? '' : relPath.slice(dot).toLowerCase()
}

/**
 * Detects the newline-escape corruption signature: a source file collapsed to
 * roughly one physical line but carrying many literal "\n" escape sequences as if
 * they were line separators.
 *
 * Scoped to source-code and document-deliverable extensions so legitimate
 * single-line data files (JSON, CSV, minified assets) are never flagged. The
 * thresholds require ALL of:
 *   - 5+ literal "\n" escape sequences,
 *   - at most 2 real newline characters,
 *   - a physical line longer than 200 characters.
 * A normally-formatted source file has many real newlines and so cannot match,
 * even if it contains a handful of "\n" inside string literals.
 */
export function detectNewlineEscapeCorruption(
  relPath: string,
  content: string,
): CorruptionResult {
  const ext = extensionOf(relPath)
  if (!CODE_EXTENSIONS.has(ext) && !DOC_EXTENSIONS.has(ext)) {
    return { corrupt: false }
  }

  const realNewlines = (content.match(/\n/g) ?? []).length
  const escapedNewlines = (content.match(/\\n/g) ?? []).length
  let longestLine = 0
  for (const line of content.split('\n')) {
    if (line.length > longestLine) longestLine = line.length
  }

  if (escapedNewlines >= 5 && realNewlines <= 2 && longestLine > 200) {
    return {
      corrupt: true,
      reason:
        `'${relPath}' appears to have escaped line separators: ` +
        `${escapedNewlines} literal "\\n" sequences but only ${realNewlines} real ` +
        `newline(s), and a ${longestLine}-character physical line. ` +
        `Re-send project_write_file with real newline characters, not "\\n" escapes.`,
    }
  }

  return { corrupt: false }
}
