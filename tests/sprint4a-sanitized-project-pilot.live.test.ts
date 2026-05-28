import { describe, it, expect } from 'vitest'

/**
 * Live Sprint 4A test — requires RUN_LIVE_SPRINT4A_TEST=1 and ANTHROPIC_API_KEY.
 * Also requires `powerplant-executor:sprint4a` Docker image
 * (npm run sprint4a:build before running).
 *
 * Run:
 *   NODE_OPTIONS=--env-file=.env RUN_LIVE_SPRINT4A_TEST=1 vitest run tests/sprint4a-sanitized-project-pilot.live.test.ts
 */

const RUN_LIVE = process.env['RUN_LIVE_SPRINT4A_TEST'] === '1'

describe.skipIf(!RUN_LIVE)('Sprint 4A live: sanitized project pilot', () => {
  it('runs the full pilot session and generates a passing patch package', async () => {
    const { validateSprint4aLiveEnv } = await import('../src/config/env.js')
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const { ensureSprint4aAgent } = await import('../src/provision/ensure-sprint4a-agent.js')
    const { runSanitizedProjectPilot } = await import('../src/sessions/run-sanitized-project-pilot.js')
    const fs = await import('fs')
    const path = await import('path')

    const env = validateSprint4aLiveEnv()
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

    const state = await ensureSprint4aAgent(client)
    expect(state.agent).toBeTruthy()

    const report = await runSanitizedProjectPilot({ controlClient: client, state })

    // Session invariants
    expect(report.session.builtinToolUseCount).toBe(0)
    expect(Object.keys(report.session.customToolCounts).length).toBeGreaterThan(0)

    // All five custom tools are the only tools available
    const toolNames = Object.keys(report.session.customToolCounts)
    const allowedTools = [
      'project_list_files',
      'project_read_file',
      'project_write_file',
      'project_run_check',
      'project_finalize',
    ]
    for (const name of toolNames) {
      expect(allowedTools).toContain(name)
    }

    // Verification
    expect(report.verification).not.toBeNull()
    expect(report.verification?.passed).toBe(true)
    expect(report.verification?.checkId).toBe('test')
    expect(report.verification?.fixedAction).toBe('node --test')

    // Patch package
    expect(report.patch).not.toBeNull()
    expect(report.patch?.patchFiles).toContain('PATCH.diff')
    expect(report.patch?.patchFiles).toContain('SESSION_SUMMARY.json')

    // Patch only touches allowed files
    const patchContent = fs.readFileSync(
      path.join(report.patch!.patchDir, 'PATCH.diff'),
      'utf-8',
    )
    const diffLines = patchContent.split('\n').filter(l => l.startsWith('--- ') || l.startsWith('+++ '))
    for (const line of diffLines) {
      const allowed =
        line.includes('src/status.js') ||
        line.includes('tests/status.test.js') ||
        line.includes('/dev/null')
      expect(allowed).toBe(true)
    }

    // Source unchanged
    expect(report.sourceUnmodified).toBe(true)

    // Final response
    expect(report.session.finalResponseCorrect).toBe(true)

    // Clearances
    expect(report.invariants.clearedForRealProjectMounting).toBe(false)
    expect(report.invariants.clearedForSanitizedExternalProjectInput).toBe(false)
    expect(report.invariants.clearedForGeneratedExternalPilot).toBe(true)

    // Overall pass
    expect(report.passed).toBe(true)

    // SESSION_SUMMARY clearances
    const summary = JSON.parse(
      fs.readFileSync(
        path.join(report.patch!.patchDir, 'SESSION_SUMMARY.json'),
        'utf-8',
      ),
    )
    expect(summary.originalProjectMounted).toBe(false)
    expect(summary.sanitizedWorkspaceUsed).toBe(true)
    expect(summary.executorNetworkDisabled).toBe(true)
    expect(summary.noCredentialsPassedToExecutor).toBe(true)
    expect(summary.clearedForRealProjectMounting).toBe(false)
    expect(summary.clearedForSanitizedExternalProjectInput).toBe(false)
  }, 300_000) // 5 minute timeout for the full pilot session
})
