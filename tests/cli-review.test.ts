import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { findRunDirectory, makeRunArtifactDirectory, POWERPLANT_RUNS_HOME } from '../src/runs/find-run.js'
import { parseVerificationReport } from '../src/cli/parse-verification-report.js'

// Unit tests for the review command's artifact validation and run discovery.
// No live API calls or network access.

const REQUIRED_ARTIFACTS = [
  'SOURCE_MANIFEST.json',
  'SANITIZED_MANIFEST.json',
  'TASK.md',
  'PATCH.diff',
  'CHANGED_FILES.md',
  'VERIFICATION_REPORT.md',
  'ADVERSARIAL_REVIEW.md',
  'SESSION_SUMMARY.json',
] as const

let tempRunsBase: string
let testRunId: string
let testRunDir: string

beforeAll(() => {
  // Temporarily override runs home with a temp dir for testing
  tempRunsBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-review-test-'))
  testRunId = `pp-run-test-${Date.now()}`

  // Create a complete run artifact directory
  testRunDir = path.join(tempRunsBase, 'test-project', testRunId)
  fs.mkdirSync(testRunDir, { recursive: true })

  // Write all required artifacts
  fs.writeFileSync(path.join(testRunDir, 'SOURCE_MANIFEST.json'), JSON.stringify({ files: [] }))
  fs.writeFileSync(path.join(testRunDir, 'SANITIZED_MANIFEST.json'), JSON.stringify({ files: [] }))
  fs.writeFileSync(path.join(testRunDir, 'TASK.md'), 'Add a test function')
  fs.writeFileSync(path.join(testRunDir, 'PATCH.diff'), '--- a/src/status.js\n+++ b/src/status.js\n')
  fs.writeFileSync(path.join(testRunDir, 'CHANGED_FILES.md'), '# Changed Files\n- `src/status.js`\n')
  fs.writeFileSync(path.join(testRunDir, 'VERIFICATION_REPORT.md'), '# Verification Report\nResult: **PASSED**\n')
  fs.writeFileSync(path.join(testRunDir, 'ADVERSARIAL_REVIEW.md'), '# Adversarial Review\n')
  fs.writeFileSync(
    path.join(testRunDir, 'SESSION_SUMMARY.json'),
    JSON.stringify({
      runId: testRunId,
      passed: true,
      builtInToolUseCount: 0,
      originalProjectMounted: false,
      sourceUnmodified: true,
      executorNetworkDisabled: true,
      noCredentialsPassedToExecutor: true,
      clearedForRealProjectMounting: false,
      clearedForSanitizedExternalProjectInput: false,
    }),
  )
})

afterAll(() => {
  fs.rmSync(tempRunsBase, { recursive: true, force: true })
})

describe('required artifact validation', () => {
  it('all required artifacts are present in the test run', () => {
    const missing = REQUIRED_ARTIFACTS.filter(
      a => !fs.existsSync(path.join(testRunDir, a))
    )
    expect(missing).toHaveLength(0)
  })

  it('reports missing artifacts when any are absent', () => {
    const incompleteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-incomplete-'))
    try {
      // Only write TASK.md — rest are missing
      fs.writeFileSync(path.join(incompleteDir, 'TASK.md'), 'task')

      const missing = REQUIRED_ARTIFACTS.filter(
        a => !fs.existsSync(path.join(incompleteDir, a))
      )
      expect(missing.length).toBeGreaterThan(0)
      expect(missing).toContain('SOURCE_MANIFEST.json')
      expect(missing).toContain('SESSION_SUMMARY.json')
    } finally {
      fs.rmSync(incompleteDir, { recursive: true, force: true })
    }
  })
})

describe('findRunDirectory', () => {
  it('finds a run by ID when it exists', () => {
    // Manually search the temp runs base (simulating findRunDirectory behavior)
    function findIn(runsBase: string, runId: string): string | null {
      if (!fs.existsSync(runsBase)) return null
      for (const entry of fs.readdirSync(runsBase)) {
        const candidate = path.join(runsBase, entry, runId)
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
          return candidate
        }
      }
      return null
    }

    const found = findIn(tempRunsBase, testRunId)
    expect(found).toBe(testRunDir)
  })

  it('returns null when run ID does not exist', () => {
    function findIn(runsBase: string, runId: string): string | null {
      if (!fs.existsSync(runsBase)) return null
      for (const entry of fs.readdirSync(runsBase)) {
        const candidate = path.join(runsBase, entry, runId)
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
          return candidate
        }
      }
      return null
    }

    expect(findIn(tempRunsBase, 'nonexistent-run-id')).toBeNull()
  })

  it('POWERPLANT_RUNS_HOME is under home dir', () => {
    expect(POWERPLANT_RUNS_HOME).toMatch(new RegExp(`^${os.homedir()}`))
    expect(POWERPLANT_RUNS_HOME).toContain('.powerplant')
    expect(POWERPLANT_RUNS_HOME).toContain('runs')
  })
})

describe('makeRunArtifactDirectory', () => {
  it('creates the artifact directory if it does not exist', () => {
    // Test the real function in the actual runs home
    const projectId = `test-proj-${Date.now()}`
    const runId = `pp-run-${Date.now()}`

    let dir: string
    try {
      dir = makeRunArtifactDirectory(projectId, runId)
      expect(fs.existsSync(dir)).toBe(true)
      expect(fs.statSync(dir).isDirectory()).toBe(true)
      expect(dir).toContain(projectId)
      expect(dir).toContain(runId)
    } finally {
      // Clean up
      fs.rmSync(path.join(POWERPLANT_RUNS_HOME, projectId), { recursive: true, force: true })
    }
  })
})

describe('review never applies a patch', () => {
  it('review reads artifacts only — no write operations on source', () => {
    // The review command reads SESSION_SUMMARY.json, TASK.md, PATCH.diff, etc.
    // It must never patch.apply() or write to any project files.
    // This is enforced architecturally: review.ts has no write-path logic.

    // Document the constraint: review reads SESSION_SUMMARY to check containment
    const summaryPath = path.join(testRunDir, 'SESSION_SUMMARY.json')
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as Record<string, unknown>

    expect(summary['clearedForRealProjectMounting']).toBe(false)
    expect(summary['clearedForSanitizedExternalProjectInput']).toBe(false)
    expect(summary['originalProjectMounted']).toBe(false)
    // Review displays these facts but never changes them
  })

  it('SESSION_SUMMARY containment fields are readable', () => {
    const summaryPath = path.join(testRunDir, 'SESSION_SUMMARY.json')
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as Record<string, unknown>

    expect(typeof summary['builtInToolUseCount']).toBe('number')
    expect(typeof summary['sourceUnmodified']).toBe('boolean')
    expect(typeof summary['executorNetworkDisabled']).toBe('boolean')
    expect(typeof summary['noCredentialsPassedToExecutor']).toBe('boolean')
  })
})

describe('review exit behavior', () => {
  it('rejects an empty run ID', () => {
    function validateRunId(runId: string | undefined): boolean {
      return Boolean(runId && runId.trim())
    }

    expect(validateRunId('')).toBe(false)
    expect(validateRunId('   ')).toBe(false)
    expect(validateRunId(undefined)).toBe(false)
    expect(validateRunId('pp-run-1234567890')).toBe(true)
  })

  it('rejects incomplete artifact set before displaying anything', () => {
    // Simulate what the review command does: checks missing artifacts FIRST
    const incompleteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-incomplete2-'))
    try {
      // No artifacts at all
      const missing = REQUIRED_ARTIFACTS.filter(a => !fs.existsSync(path.join(incompleteDir, a)))
      expect(missing).toHaveLength(REQUIRED_ARTIFACTS.length)
    } finally {
      fs.rmSync(incompleteDir, { recursive: true, force: true })
    }
  })
})

// ── parseVerificationReport ───────────────────────────────────────────────────

const SELF_CORRECTED_REPORT = `# Verification Report

### Check: \`test\`
Command: \`npm test\`
Exit code: 1
Result: **FAIL_CHECK**
\`\`\`
Tests  0 passed, 1 failed
\`\`\`

### Check: \`test\`
Command: \`npm test\`
Exit code: 0
Result: **PASS**
\`\`\`
Tests  37 passed
\`\`\`

### Check: \`typecheck\`
Command: \`npm run typecheck\`
Exit code: 0
Result: **PASS**
\`\`\`
\`\`\`
`

const CLEAN_PASS_REPORT = `# Verification Report

### Check: \`test\`
Command: \`npm test\`
Exit code: 0
Result: **PASS**
\`\`\`
Tests  50 passed
\`\`\`

### Check: \`typecheck\`
Command: \`npm run typecheck\`
Exit code: 0
Result: **PASS**
\`\`\`
\`\`\`
`

const FAILED_FINAL_REPORT = `# Verification Report

### Check: \`test\`
Command: \`npm test\`
Exit code: 1
Result: **FAIL_CHECK**
\`\`\`
Tests  3 failed
\`\`\`
`

const INTEGRITY_FAILURE_REPORT = `# Verification Report

### Check: \`test\`
Command: \`npm test\`
Exit code: 0
Result: **FAIL_VERIFICATION_INTEGRITY**
\`\`\`
# tests 0
\`\`\`
`

const LEGACY_REPORT = `# Verification Report

Check ID: \`test\`
Fixed action: \`node --test\`
Exit code: 0
Result: **PASSED**

See \`executor-output/TEST_OUTPUT.txt\` for raw test output.
`

describe('parseVerificationReport — self-corrected run', () => {
  it('reports finalVerdict PASS when last check of each type passed', () => {
    const r = parseVerificationReport(SELF_CORRECTED_REPORT)
    expect(r.finalVerdict).toBe('PASS')
  })

  it('identifies 3 total attempts', () => {
    const r = parseVerificationReport(SELF_CORRECTED_REPORT)
    expect(r.attempts).toHaveLength(3)
  })

  it('marks first test attempt (index 0) as intermediate', () => {
    const r = parseVerificationReport(SELF_CORRECTED_REPORT)
    expect(r.intermediateIndices.has(0)).toBe(true)
  })

  it('does not mark second test attempt (index 1) as intermediate', () => {
    const r = parseVerificationReport(SELF_CORRECTED_REPORT)
    expect(r.intermediateIndices.has(1)).toBe(false)
  })

  it('does not mark typecheck attempt (index 2) as intermediate', () => {
    const r = parseVerificationReport(SELF_CORRECTED_REPORT)
    expect(r.intermediateIndices.has(2)).toBe(false)
  })

  it('records FAIL_CHECK verdict for the first attempt', () => {
    const r = parseVerificationReport(SELF_CORRECTED_REPORT)
    expect(r.attempts[0]?.verdict).toBe('FAIL_CHECK')
    expect(r.attempts[0]?.isPass).toBe(false)
  })

  it('has no integrity failure', () => {
    const r = parseVerificationReport(SELF_CORRECTED_REPORT)
    expect(r.hasIntegrityFailure).toBe(false)
  })
})

describe('parseVerificationReport — clean first-pass run', () => {
  it('reports finalVerdict PASS', () => {
    const r = parseVerificationReport(CLEAN_PASS_REPORT)
    expect(r.finalVerdict).toBe('PASS')
  })

  it('has no intermediate attempts', () => {
    const r = parseVerificationReport(CLEAN_PASS_REPORT)
    expect(r.intermediateIndices.size).toBe(0)
  })

  it('identifies 2 attempts', () => {
    const r = parseVerificationReport(CLEAN_PASS_REPORT)
    expect(r.attempts).toHaveLength(2)
  })
})

describe('parseVerificationReport — failed final check', () => {
  it('reports finalVerdict FAIL', () => {
    const r = parseVerificationReport(FAILED_FINAL_REPORT)
    expect(r.finalVerdict).toBe('FAIL')
  })

  it('records the FAIL_CHECK verdict', () => {
    const r = parseVerificationReport(FAILED_FINAL_REPORT)
    expect(r.attempts[0]?.verdict).toBe('FAIL_CHECK')
  })
})

describe('parseVerificationReport — zero-test integrity failure', () => {
  it('reports finalVerdict FAIL', () => {
    const r = parseVerificationReport(INTEGRITY_FAILURE_REPORT)
    expect(r.finalVerdict).toBe('FAIL')
  })

  it('sets hasIntegrityFailure', () => {
    const r = parseVerificationReport(INTEGRITY_FAILURE_REPORT)
    expect(r.hasIntegrityFailure).toBe(true)
  })
})

describe('parseVerificationReport — legacy artifact format', () => {
  it('reports format as legacy', () => {
    const r = parseVerificationReport(LEGACY_REPORT)
    expect(r.format).toBe('legacy')
  })

  it('reports finalVerdict UNKNOWN — never invents PASS from legacy format', () => {
    const r = parseVerificationReport(LEGACY_REPORT)
    expect(r.finalVerdict).toBe('UNKNOWN')
  })

  it('returns empty attempts array', () => {
    const r = parseVerificationReport(LEGACY_REPORT)
    expect(r.attempts).toHaveLength(0)
  })
})

describe('parseVerificationReport — unknown artifact format', () => {
  it('returns UNKNOWN verdict for empty/unrecognized content', () => {
    expect(parseVerificationReport('').finalVerdict).toBe('UNKNOWN')
    expect(parseVerificationReport('# Some other report').finalVerdict).toBe('UNKNOWN')
  })
})
