/**
 * Regression tests for printRunSummary() artifact-path truthfulness.
 *
 * Finding A (warroom dogfood v0.2.9): on a FAILED_INCOMPLETE_AGENT_RUN the CLI
 * printed "Patch ready: <dir>/PATCH.diff" and pointed at VERIFICATION_REPORT.md
 * even though no patch package was generated, so neither file existed on disk.
 * The summary must only reference artifacts that were actually written.
 */

import { describe, it, expect } from 'vitest'
import { printRunSummary } from '../src/cli/terminal-output.js'

function capture(opts: Parameters<typeof printRunSummary>[0]): string {
  const lines: string[] = []
  const orig = console.log
  console.log = (...a: unknown[]) => lines.push(a.join(' '))
  try {
    printRunSummary(opts)
  } finally {
    console.log = orig
  }
  return lines.join('\n')
}

const base = {
  runId: 'pp-run-test',
  task: 'Audit harness readiness',
  testsPassed: true,
  customToolCounts: { project_finalize: 1 },
  builtInToolUseCount: 0,
  patchFiles: ['PATCH.diff'],
  sourceUnmodified: true,
  artifactDir: '/mock/run',
  patchDiff: '--- a/tests/x.md\n+++ b/tests/x.md\n',
}

describe('printRunSummary artifact-path truthfulness', () => {
  it('points at PATCH.diff when the patch package was written (passing run)', () => {
    const out = capture({ ...base, passed: true, patchArtifactsWritten: true })
    expect(out).toContain('Patch ready:')
    expect(out).toContain('/mock/run/PATCH.diff')
    expect(out).toContain('powerplant review pp-run-test')
    expect(out).not.toContain('did not complete')
  })

  it('points at VERIFICATION_REPORT.md when artifacts exist but checks failed', () => {
    const out = capture({ ...base, passed: false, patchArtifactsWritten: true })
    expect(out).toContain('Patch ready:')
    expect(out).toContain('Run did not fully pass')
    expect(out).toContain('/mock/run/VERIFICATION_REPORT.md')
  })

  it('does NOT claim a patch or report when no package was written (incomplete run)', () => {
    const out = capture({
      ...base,
      passed: false,
      testsPassed: false,
      patchDiff: '',
      patchArtifactsWritten: false,
    })
    // Must not point at artifacts that do not exist on disk.
    expect(out).not.toContain('Patch ready:')
    expect(out).not.toContain('PATCH.diff')
    expect(out).not.toContain('VERIFICATION_REPORT.md')
    // Must truthfully point only at what is written.
    expect(out).toContain('did not complete')
    expect(out).toContain('/mock/run/RUN_CLASSIFICATION.json')
  })
})
