import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { ReviewRenderState } from '../src/contracts/review-render.js'
import { buildReviewRenderState } from '../src/cli/commands/review.js'
import { printReviewTui } from '../src/cli/terminal-output.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PASS_VERIFICATION = `# Verification Report

### Check: \`test\`
Command: \`npm test\`
Exit code: 0
Result: **PASS**
\`\`\`
Tests  42 passed
\`\`\`

### Check: \`typecheck\`
Command: \`npx tsc --noEmit\`
Exit code: 0
Result: **PASS**
\`\`\`
\`\`\`
`

const FAIL_VERIFICATION = `# Verification Report

### Check: \`test\`
Command: \`npm test\`
Exit code: 1
Result: **FAIL_CHECK**
\`\`\`
Tests  3 failed
\`\`\`
`

const RISK_ADVERSARIAL = `# Adversarial Review

[HIGH] Token expiry window is too wide — consider narrowing to 15 minutes
[MEDIUM] No audit log for failed attempts
`

const PATCH_DIFF = `--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,4 +1,5 @@
+// fixed
 export function refresh() {}
+export function logout() {}
-export function dead() {}
--- a/tests/auth.test.ts
+++ b/tests/auth.test.ts
@@ -1,3 +1,4 @@
+import { logout } from '../src/auth.js'
 test('logout', () => {})
+test('refresh', () => {})
-test('dead', () => {})
`

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pp-tui-test-'))
}

function writeArtifacts(dir: string, opts: {
  verificationMd?: string
  adversarialMd?: string
  patchDiff?: string
  task?: string
  classification?: object
} = {}): void {
  if (opts.verificationMd !== undefined)
    fs.writeFileSync(path.join(dir, 'VERIFICATION_REPORT.md'), opts.verificationMd)
  if (opts.adversarialMd !== undefined)
    fs.writeFileSync(path.join(dir, 'ADVERSARIAL_REVIEW.md'), opts.adversarialMd)
  if (opts.patchDiff !== undefined)
    fs.writeFileSync(path.join(dir, 'PATCH.diff'), opts.patchDiff)
  if (opts.task !== undefined)
    fs.writeFileSync(path.join(dir, 'TASK.md'), opts.task)
  if (opts.classification !== undefined)
    fs.writeFileSync(path.join(dir, 'RUN_CLASSIFICATION.json'), JSON.stringify(opts.classification))
}

// Wrap a run directory in the right <project-id>/<run-id>/ nesting so that
// buildReviewRenderState can extract the projectId from dirname(artifactDir).
function makeRunDir(base: string, projectId = 'my-project', runId = 'pp-run-abc123'): string {
  const dir = path.join(base, projectId, runId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// ── printReviewTui — PASS state ───────────────────────────────────────────────

describe('printReviewTui — PASS state', () => {
  let logs: string[]
  let restoreColumns: PropertyDescriptor | undefined

  beforeEach(() => {
    logs = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '))
    })
    // Ensure wide enough for TUI mode
    restoreColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns')
    Object.defineProperty(process.stdout, 'columns', { value: 80, configurable: true })
    delete process.env['NO_COLOR']
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (restoreColumns) {
      Object.defineProperty(process.stdout, 'columns', restoreColumns)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (process.stdout as any).columns
    }
  })

  const passState: ReviewRenderState = {
    runId: 'pp-run-abc123',
    projectId: 'my-project',
    task: 'Fix the auth token refresh bug',
    overallStatus: 'PASS',
    terminationNote: null,
    diff: { files: 2, linesAdded: 8, linesRemoved: 3, raw: PATCH_DIFF },
    checks: [
      { name: 'test', status: 'pass', exitCode: 0, snippet: 'Tests  42 passed' },
      { name: 'typecheck', status: 'pass', exitCode: 0, snippet: '' },
    ],
    risks: [{ severity: 'LOW', finding: 'Minor style inconsistency' }],
    nextAction: 'powerplant approve pp-run-abc123',
  }

  it('renders PASS status in output', () => {
    printReviewTui(passState)
    const all = logs.join('\n')
    expect(all).toContain('PASS')
  })

  it('renders project and task information', () => {
    printReviewTui(passState)
    const all = logs.join('\n')
    expect(all).toContain('my-project')
    expect(all).toContain('Fix the auth token')
  })

  it('renders diff summary', () => {
    printReviewTui(passState)
    const all = logs.join('\n')
    expect(all).toContain('2 files changed')
    expect(all).toContain('+8')
    expect(all).toContain('-3')
  })

  it('renders check rows with exit code', () => {
    printReviewTui(passState)
    const all = logs.join('\n')
    expect(all).toContain('test')
    expect(all).toContain('exit 0')
  })

  it('renders risks section', () => {
    printReviewTui(passState)
    const all = logs.join('\n')
    expect(all).toContain('LOW')
  })

  it('nextAction is powerplant approve <run-id> for PASS', () => {
    printReviewTui(passState)
    const all = logs.join('\n')
    expect(all).toContain('powerplant approve pp-run-abc123')
  })

  it('renders box structure (top/bottom borders)', () => {
    printReviewTui(passState)
    expect(logs[0]).toMatch(/^┌/)
    expect(logs[logs.length - 1]).toMatch(/^└/)
  })
})

// ── printReviewTui — FAIL state ───────────────────────────────────────────────

describe('printReviewTui — FAIL state', () => {
  let logs: string[]
  let restoreColumns: PropertyDescriptor | undefined

  beforeEach(() => {
    logs = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '))
    })
    restoreColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns')
    Object.defineProperty(process.stdout, 'columns', { value: 80, configurable: true })
    delete process.env['NO_COLOR']
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (restoreColumns) {
      Object.defineProperty(process.stdout, 'columns', restoreColumns)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (process.stdout as any).columns
    }
  })

  const failState: ReviewRenderState = {
    runId: 'pp-run-fail001',
    projectId: 'broken-app',
    task: 'Add retry logic',
    overallStatus: 'FAIL',
    terminationNote: null,
    diff: { files: 1, linesAdded: 5, linesRemoved: 0, raw: '' },
    checks: [
      { name: 'test', status: 'fail', exitCode: 1, snippet: 'Tests  3 failed' },
    ],
    risks: [],
    nextAction: 'Fix failing checks and re-run the task',
  }

  it('renders FAIL status', () => {
    printReviewTui(failState)
    const all = logs.join('\n')
    expect(all).toContain('FAIL')
  })

  it('nextAction tells user to fix and re-run for FAIL', () => {
    printReviewTui(failState)
    const all = logs.join('\n')
    expect(all).toContain('Fix failing checks')
  })

  it('renders failing check with exit code 1', () => {
    printReviewTui(failState)
    const all = logs.join('\n')
    expect(all).toContain('exit 1')
  })
})

// ── printReviewTui — RISK state ───────────────────────────────────────────────

describe('printReviewTui — RISK state', () => {
  let logs: string[]
  let restoreColumns: PropertyDescriptor | undefined

  beforeEach(() => {
    logs = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '))
    })
    restoreColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns')
    Object.defineProperty(process.stdout, 'columns', { value: 80, configurable: true })
    delete process.env['NO_COLOR']
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (restoreColumns) {
      Object.defineProperty(process.stdout, 'columns', restoreColumns)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (process.stdout as any).columns
    }
  })

  const riskState: ReviewRenderState = {
    runId: 'pp-run-risk001',
    projectId: 'payment-svc',
    task: 'Refactor auth',
    overallStatus: 'RISK',
    terminationNote: null,
    diff: { files: 3, linesAdded: 20, linesRemoved: 10, raw: '' },
    checks: [
      { name: 'test', status: 'pass', exitCode: 0, snippet: '' },
    ],
    risks: [
      { severity: 'HIGH', finding: 'Token expiry window too wide' },
      { severity: 'LOW', finding: 'Minor nit' },
    ],
    nextAction: 'Review HIGH/CRITICAL risks above, then: powerplant approve pp-run-risk001',
  }

  it('renders RISK status', () => {
    printReviewTui(riskState)
    const all = logs.join('\n')
    expect(all).toContain('RISK')
  })

  it('renders HIGH severity risk', () => {
    printReviewTui(riskState)
    const all = logs.join('\n')
    expect(all).toContain('HIGH')
    expect(all).toContain('Token expiry')
  })

  it('nextAction contains powerplant approve for RISK', () => {
    printReviewTui(riskState)
    const all = logs.join('\n')
    expect(all).toContain('powerplant approve pp-run-risk001')
  })
})

// ── NO_COLOR ──────────────────────────────────────────────────────────────────

describe('printReviewTui — NO_COLOR', () => {
  let logs: string[]
  let restoreColumns: PropertyDescriptor | undefined

  beforeEach(() => {
    logs = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '))
    })
    restoreColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns')
    Object.defineProperty(process.stdout, 'columns', { value: 80, configurable: true })
    process.env['NO_COLOR'] = '1'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env['NO_COLOR']
    if (restoreColumns) {
      Object.defineProperty(process.stdout, 'columns', restoreColumns)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (process.stdout as any).columns
    }
  })

  it('removes ANSI color codes from output', () => {
    const state: ReviewRenderState = {
      runId: 'pp-run-nocolor',
      projectId: 'proj',
      task: 'task',
      overallStatus: 'PASS',
      terminationNote: null,
      diff: { files: 0, linesAdded: 0, linesRemoved: 0, raw: '' },
      checks: [{ name: 'test', status: 'pass', exitCode: 0, snippet: '' }],
      risks: [],
      nextAction: 'powerplant approve pp-run-nocolor',
    }
    printReviewTui(state)
    const all = logs.join('\n')
    // eslint-disable-next-line no-control-regex
    expect(all).not.toMatch(/\x1b\[/)
  })
})

// ── Terminal width < 60 fallback ──────────────────────────────────────────────

describe('printReviewTui — narrow terminal fallback', () => {
  let logs: string[]
  let restoreColumns: PropertyDescriptor | undefined

  beforeEach(() => {
    logs = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '))
    })
    restoreColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns')
    Object.defineProperty(process.stdout, 'columns', { value: 40, configurable: true })
    delete process.env['NO_COLOR']
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (restoreColumns) {
      Object.defineProperty(process.stdout, 'columns', restoreColumns)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (process.stdout as any).columns
    }
  })

  it('uses compact plain format (no box drawing) for narrow terminals', () => {
    const state: ReviewRenderState = {
      runId: 'pp-run-narrow',
      projectId: 'proj',
      task: 'task',
      overallStatus: 'PASS',
      terminationNote: null,
      diff: { files: 1, linesAdded: 2, linesRemoved: 1, raw: '' },
      checks: [],
      risks: [],
      nextAction: 'powerplant approve pp-run-narrow',
    }
    printReviewTui(state)
    const all = logs.join('\n')
    // Compact format uses plain key: value lines
    expect(all).toContain('Status:')
    expect(all).toContain('PASS')
    // No box drawing in compact mode
    expect(all).not.toContain('┌')
    expect(all).not.toContain('└')
  })
})

// ── buildReviewRenderState ────────────────────────────────────────────────────

describe('buildReviewRenderState — PASS artifacts', () => {
  let tmpBase: string
  let artifactDir: string

  beforeEach(() => {
    tmpBase = makeTempDir()
    artifactDir = makeRunDir(tmpBase, 'my-project', 'pp-run-pass001')
    writeArtifacts(artifactDir, {
      verificationMd: PASS_VERIFICATION,
      adversarialMd: '# Adversarial Review\n\n[LOW] Minor style nit\n',
      patchDiff: PATCH_DIFF,
      task: 'Fix the auth token refresh bug',
    })
  })

  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true })
  })

  it('resolves overallStatus as PASS when all checks pass and no HIGH risks', () => {
    const state = buildReviewRenderState('pp-run-pass001', artifactDir)
    expect(state.overallStatus).toBe('PASS')
  })

  it('nextAction is powerplant approve <run-id> for PASS', () => {
    const state = buildReviewRenderState('pp-run-pass001', artifactDir)
    expect(state.nextAction).toContain('powerplant approve')
    expect(state.nextAction).toContain('pp-run-pass001')
  })

  it('extracts projectId from directory structure', () => {
    const state = buildReviewRenderState('pp-run-pass001', artifactDir)
    expect(state.projectId).toBe('my-project')
  })

  it('parses task from TASK.md', () => {
    const state = buildReviewRenderState('pp-run-pass001', artifactDir)
    expect(state.task).toBe('Fix the auth token refresh bug')
  })

  it('parses diff: files, linesAdded, linesRemoved, raw', () => {
    const state = buildReviewRenderState('pp-run-pass001', artifactDir)
    expect(state.diff.files).toBe(2)
    expect(state.diff.linesAdded).toBeGreaterThan(0)
    expect(state.diff.linesRemoved).toBeGreaterThan(0)
    expect(state.diff.raw).toContain('src/auth.ts')
  })
})

describe('buildReviewRenderState — FAIL artifacts', () => {
  let tmpBase: string
  let artifactDir: string

  beforeEach(() => {
    tmpBase = makeTempDir()
    artifactDir = makeRunDir(tmpBase, 'broken-app', 'pp-run-fail001')
    writeArtifacts(artifactDir, {
      verificationMd: FAIL_VERIFICATION,
      adversarialMd: '',
      patchDiff: '',
      task: 'Add retry logic',
    })
  })

  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true })
  })

  it('resolves overallStatus as FAIL when a check fails', () => {
    const state = buildReviewRenderState('pp-run-fail001', artifactDir)
    expect(state.overallStatus).toBe('FAIL')
  })

  it('nextAction tells user to fix and re-run for FAIL', () => {
    const state = buildReviewRenderState('pp-run-fail001', artifactDir)
    expect(state.nextAction).toMatch(/[Ff]ix/)
  })
})

describe('buildReviewRenderState — RISK artifacts', () => {
  let tmpBase: string
  let artifactDir: string

  beforeEach(() => {
    tmpBase = makeTempDir()
    artifactDir = makeRunDir(tmpBase, 'payment-svc', 'pp-run-risk001')
    writeArtifacts(artifactDir, {
      verificationMd: PASS_VERIFICATION,
      adversarialMd: RISK_ADVERSARIAL,
      patchDiff: '',
      task: 'Refactor auth middleware',
    })
  })

  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true })
  })

  it('resolves overallStatus as RISK when checks pass but HIGH risk exists', () => {
    const state = buildReviewRenderState('pp-run-risk001', artifactDir)
    expect(state.overallStatus).toBe('RISK')
  })

  it('nextAction still references powerplant approve for RISK', () => {
    const state = buildReviewRenderState('pp-run-risk001', artifactDir)
    expect(state.nextAction).toContain('powerplant approve')
  })
})

// ── Check parsing ─────────────────────────────────────────────────────────────

describe('buildReviewRenderState — check parsing', () => {
  let tmpBase: string
  let artifactDir: string

  beforeEach(() => {
    tmpBase = makeTempDir()
    artifactDir = makeRunDir(tmpBase)
    writeArtifacts(artifactDir, { verificationMd: PASS_VERIFICATION })
  })

  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true })
  })

  it('includes check name', () => {
    const state = buildReviewRenderState('pp-run-abc123', artifactDir)
    const names = state.checks.map(c => c.name)
    expect(names).toContain('test')
    expect(names).toContain('typecheck')
  })

  it('includes check status (pass)', () => {
    const state = buildReviewRenderState('pp-run-abc123', artifactDir)
    for (const check of state.checks) {
      expect(check.status).toBe('pass')
    }
  })

  it('includes exit code', () => {
    const state = buildReviewRenderState('pp-run-abc123', artifactDir)
    const testCheck = state.checks.find(c => c.name === 'test')
    expect(testCheck?.exitCode).toBe(0)
  })

  it('includes snippet from code block', () => {
    const state = buildReviewRenderState('pp-run-abc123', artifactDir)
    const testCheck = state.checks.find(c => c.name === 'test')
    expect(testCheck?.snippet).toContain('42 passed')
  })

  it('includes fail status and exit code 1 for failed check', () => {
    const tmpBase2 = makeTempDir()
    const failDir = makeRunDir(tmpBase2)
    writeArtifacts(failDir, { verificationMd: FAIL_VERIFICATION })
    try {
      const state = buildReviewRenderState('pp-run-abc123', failDir)
      const testCheck = state.checks.find(c => c.name === 'test')
      expect(testCheck?.status).toBe('fail')
      expect(testCheck?.exitCode).toBe(1)
    } finally {
      fs.rmSync(tmpBase2, { recursive: true, force: true })
    }
  })
})

// ── Risk parsing ──────────────────────────────────────────────────────────────

describe('buildReviewRenderState — risk parsing and severity ordering', () => {
  let tmpBase: string
  let artifactDir: string

  beforeEach(() => {
    tmpBase = makeTempDir()
    artifactDir = makeRunDir(tmpBase)
    writeArtifacts(artifactDir, {
      adversarialMd: `# Review\n\n[LOW] Low risk item\n[CRITICAL] Critical security issue\n[MEDIUM] Medium concern\n[HIGH] High severity finding\n`,
    })
  })

  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true })
  })

  it('parses all four severity levels', () => {
    const state = buildReviewRenderState('pp-run-abc123', artifactDir)
    const severities = state.risks.map(r => r.severity)
    expect(severities).toContain('CRITICAL')
    expect(severities).toContain('HIGH')
    expect(severities).toContain('MEDIUM')
    expect(severities).toContain('LOW')
  })

  it('sorts risks CRITICAL first, then HIGH, MEDIUM, LOW', () => {
    const state = buildReviewRenderState('pp-run-abc123', artifactDir)
    const sevOrder = state.risks.map(r => r.severity)
    expect(sevOrder.indexOf('CRITICAL')).toBeLessThan(sevOrder.indexOf('HIGH'))
    expect(sevOrder.indexOf('HIGH')).toBeLessThan(sevOrder.indexOf('MEDIUM'))
    expect(sevOrder.indexOf('MEDIUM')).toBeLessThan(sevOrder.indexOf('LOW'))
  })

  it('includes finding text', () => {
    const state = buildReviewRenderState('pp-run-abc123', artifactDir)
    const critical = state.risks.find(r => r.severity === 'CRITICAL')
    expect(critical?.finding).toContain('Critical security issue')
  })
})

// ── Missing artifact tolerance ────────────────────────────────────────────────

describe('buildReviewRenderState — missing artifacts', () => {
  let tmpBase: string
  let artifactDir: string

  beforeEach(() => {
    tmpBase = makeTempDir()
    artifactDir = makeRunDir(tmpBase)
    // Write no artifacts at all
  })

  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true })
  })

  it('does not crash with empty artifact directory', () => {
    expect(() => buildReviewRenderState('pp-run-empty', artifactDir)).not.toThrow()
  })

  it('returns overallStatus UNKNOWN when no verification artifacts exist', () => {
    const state = buildReviewRenderState('pp-run-empty', artifactDir)
    expect(state.overallStatus).toBe('UNKNOWN')
  })

  it('uses placeholder task when TASK.md is absent', () => {
    const state = buildReviewRenderState('pp-run-empty', artifactDir)
    expect(state.task).toBeTruthy()
  })

  it('returns empty checks array when VERIFICATION_REPORT.md absent', () => {
    const state = buildReviewRenderState('pp-run-empty', artifactDir)
    expect(state.checks).toHaveLength(0)
  })

  it('returns empty risks array when ADVERSARIAL_REVIEW.md absent', () => {
    const state = buildReviewRenderState('pp-run-empty', artifactDir)
    expect(state.risks).toHaveLength(0)
  })

  it('returns zero diff counts when PATCH.diff absent', () => {
    const state = buildReviewRenderState('pp-run-empty', artifactDir)
    expect(state.diff.files).toBe(0)
    expect(state.diff.linesAdded).toBe(0)
    expect(state.diff.linesRemoved).toBe(0)
  })
})

// ── --json behavior ───────────────────────────────────────────────────────────

describe('--json output via buildReviewRenderState', () => {
  let tmpBase: string
  let artifactDir: string

  beforeEach(() => {
    tmpBase = makeTempDir()
    artifactDir = makeRunDir(tmpBase)
    writeArtifacts(artifactDir, {
      verificationMd: FAIL_VERIFICATION,
      adversarialMd: '',
      patchDiff: PATCH_DIFF,
      task: 'Fix something',
    })
  })

  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true })
  })

  it('state is valid JSON-serializable even for FAIL status', () => {
    const state = buildReviewRenderState('pp-run-fail001', artifactDir)
    expect(state.overallStatus).toBe('FAIL')
    // Serialization must not throw
    const json = JSON.stringify(state, null, 2)
    expect(() => JSON.parse(json)).not.toThrow()
  })

  it('JSON output contains all required ReviewRenderState fields', () => {
    const state = buildReviewRenderState('pp-run-fail001', artifactDir)
    const parsed = JSON.parse(JSON.stringify(state)) as ReviewRenderState
    expect(typeof parsed.runId).toBe('string')
    expect(typeof parsed.projectId).toBe('string')
    expect(typeof parsed.task).toBe('string')
    expect(['PASS', 'FAIL', 'RISK', 'UNKNOWN']).toContain(parsed.overallStatus)
    expect(typeof parsed.diff.files).toBe('number')
    expect(Array.isArray(parsed.checks)).toBe(true)
    expect(Array.isArray(parsed.risks)).toBe(true)
    expect(typeof parsed.nextAction).toBe('string')
  })
})

// ── --diff behavior ───────────────────────────────────────────────────────────

describe('--diff: diff.raw contains original patch text', () => {
  let tmpBase: string
  let artifactDir: string

  beforeEach(() => {
    tmpBase = makeTempDir()
    artifactDir = makeRunDir(tmpBase)
    writeArtifacts(artifactDir, { patchDiff: PATCH_DIFF })
  })

  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true })
  })

  it('diff.raw preserves the original PATCH.diff text', () => {
    const state = buildReviewRenderState('pp-run-abc123', artifactDir)
    expect(state.diff.raw).toBe(PATCH_DIFF)
  })

  it('diff.raw is empty string when PATCH.diff absent', () => {
    const tmpBase2 = makeTempDir()
    const emptyDir = makeRunDir(tmpBase2)
    try {
      const state = buildReviewRenderState('pp-run-abc123', emptyDir)
      expect(state.diff.raw).toBe('')
    } finally {
      fs.rmSync(tmpBase2, { recursive: true, force: true })
    }
  })
})

// ── RUN_CLASSIFICATION.json takes precedence ──────────────────────────────────

describe('buildReviewRenderState — RUN_CLASSIFICATION.json', () => {
  let tmpBase: string
  let artifactDir: string

  beforeEach(() => {
    tmpBase = makeTempDir()
    artifactDir = makeRunDir(tmpBase)
  })

  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true })
  })

  it('FAIL when patchEligibleForApplication is false regardless of verification md', () => {
    writeArtifacts(artifactDir, {
      verificationMd: PASS_VERIFICATION, // would imply PASS without classification
      classification: {
        terminationReason: 'FAILED_INCOMPLETE_AGENT_RUN',
        patchEligibleForApplication: false,
        readCount: 0, writeCount: 0, checkCount: 0,
        finalizeAttempted: false, artifactsComplete: false, repeatedCheckFailures: false,
      },
    })
    const state = buildReviewRenderState('pp-run-cls001', artifactDir)
    expect(state.overallStatus).toBe('FAIL')
  })

  it('PASS when patchEligibleForApplication is true and no HIGH risks', () => {
    writeArtifacts(artifactDir, {
      adversarialMd: '[LOW] Minor nit\n',
      classification: {
        terminationReason: 'COMPLETED_NORMALLY',
        patchEligibleForApplication: true,
        readCount: 5, writeCount: 2, checkCount: 1,
        finalizeAttempted: true, artifactsComplete: true, repeatedCheckFailures: false,
      },
    })
    const state = buildReviewRenderState('pp-run-cls002', artifactDir)
    expect(state.overallStatus).toBe('PASS')
  })

  it('RISK when eligible but HIGH risk found', () => {
    writeArtifacts(artifactDir, {
      adversarialMd: '[HIGH] Dangerous pattern\n',
      classification: {
        terminationReason: 'COMPLETED_NORMALLY',
        patchEligibleForApplication: true,
        readCount: 5, writeCount: 2, checkCount: 1,
        finalizeAttempted: true, artifactsComplete: true, repeatedCheckFailures: false,
      },
    })
    const state = buildReviewRenderState('pp-run-cls003', artifactDir)
    expect(state.overallStatus).toBe('RISK')
  })
})

// ── printReviewReport (existing behavior) not broken ─────────────────────────

describe('printReviewReport — existing behavior preserved', () => {
  it('is still exported from terminal-output', async () => {
    const mod = await import('../src/cli/terminal-output.js')
    expect(typeof mod.printReviewReport).toBe('function')
  })

  it('renders run ID and patch files when called directly', async () => {
    const logs: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '))
    })

    const { printReviewReport } = await import('../src/cli/terminal-output.js')
    printReviewReport({
      runId: 'pp-run-legacy001',
      artifactDir: '/tmp/fake',
      task: 'Legacy task',
      patchDiff: '--- a/foo.ts\n+++ b/foo.ts\n',
      changedFilesMd: '',
      verificationMd: '',
      adversarialMd: '',
      sessionSummary: {
        passed: true, builtInToolUseCount: 0,
        originalProjectMounted: false, sourceUnmodified: true,
        executorNetworkDisabled: true, noCredentialsPassedToExecutor: true,
      },
    })

    const all = logs.join('\n')
    expect(all).toContain('pp-run-legacy001')
    expect(all).toContain('foo.ts')

    vi.restoreAllMocks()
  })
})

// ── terminationNote: budget-exhausted run ────────────────────────────────────

describe('buildReviewRenderState — terminationNote from classification', () => {
  let tmpBase: string
  let artifactDir: string

  beforeEach(() => {
    tmpBase = makeTempDir()
    artifactDir = makeRunDir(tmpBase, 'my-project', 'pp-run-budget001')
  })

  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true })
  })

  it('terminationNote is null when artifactsComplete is true', () => {
    writeArtifacts(artifactDir, {
      classification: {
        terminationReason: 'COMPLETED',
        patchEligibleForApplication: true,
        readCount: 5, writeCount: 2, checkCount: 1,
        finalizeAttempted: true, artifactsComplete: true, repeatedCheckFailures: false,
      },
    })
    const state = buildReviewRenderState('pp-run-budget001', artifactDir)
    expect(state.terminationNote).toBeNull()
  })

  it('terminationNote is null when no classification file exists', () => {
    const state = buildReviewRenderState('pp-run-budget001', artifactDir)
    expect(state.terminationNote).toBeNull()
  })

  it('terminationNote is populated when FAILED_TOOL_BUDGET_EXHAUSTED and artifactsComplete=false', () => {
    writeArtifacts(artifactDir, {
      classification: {
        terminationReason: 'FAILED_TOOL_BUDGET_EXHAUSTED',
        patchEligibleForApplication: false,
        readCount: 30, writeCount: 0, checkCount: 0,
        finalizeAttempted: false, artifactsComplete: false, repeatedCheckFailures: false,
      },
    })
    const state = buildReviewRenderState('pp-run-budget001', artifactDir)
    expect(state.terminationNote).not.toBeNull()
    expect(state.terminationNote).toMatch(/tool budget exhausted/i)
    expect(state.terminationNote).toMatch(/no PATCH\.diff/i)
  })

  it('terminationNote is populated when FAILED_INCOMPLETE_AGENT_RUN and artifactsComplete=false', () => {
    writeArtifacts(artifactDir, {
      classification: {
        terminationReason: 'FAILED_INCOMPLETE_AGENT_RUN',
        patchEligibleForApplication: false,
        readCount: 5, writeCount: 0, checkCount: 0,
        finalizeAttempted: false, artifactsComplete: false, repeatedCheckFailures: false,
      },
    })
    const state = buildReviewRenderState('pp-run-budget001', artifactDir)
    expect(state.terminationNote).not.toBeNull()
    expect(state.terminationNote).toMatch(/agent run did not complete/i)
  })
})

describe('printReviewTui — terminationNote rendered in output', () => {
  let logs: string[]
  let restoreColumns: PropertyDescriptor | undefined

  beforeEach(() => {
    logs = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.join(' '))
    })
    restoreColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns')
    Object.defineProperty(process.stdout, 'columns', { value: 80, configurable: true })
    delete process.env['NO_COLOR']
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (restoreColumns) {
      Object.defineProperty(process.stdout, 'columns', restoreColumns)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (process.stdout as any).columns
    }
  })

  it('renders termination note section when note is present', () => {
    const state: ReviewRenderState = {
      runId: 'pp-run-budget001',
      projectId: 'my-project',
      task: 'Fix the bug',
      overallStatus: 'FAIL',
      terminationNote: 'Run terminated (tool budget exhausted) — no PATCH.diff produced',
      diff: { files: 0, linesAdded: 0, linesRemoved: 0, raw: '' },
      checks: [],
      risks: [],
      nextAction: 'Fix failing checks and re-run the task',
    }
    printReviewTui(state)
    const all = logs.join('\n')
    expect(all).toContain('tool budget exhausted')
  })

  it('does not render Warning section when terminationNote is null', () => {
    const state: ReviewRenderState = {
      runId: 'pp-run-clean001',
      projectId: 'my-project',
      task: 'Fix the bug',
      overallStatus: 'PASS',
      terminationNote: null,
      diff: { files: 1, linesAdded: 3, linesRemoved: 1, raw: '' },
      checks: [{ name: 'test', status: 'pass', exitCode: 0, snippet: '' }],
      risks: [],
      nextAction: 'powerplant approve pp-run-clean001',
    }
    printReviewTui(state)
    const all = logs.join('\n')
    expect(all).not.toContain('Warning')
  })
})
