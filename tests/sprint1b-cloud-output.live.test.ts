import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { createClient } from '../src/platform/client.js'
import { validateLiveEnv } from '../src/config/env.js'
import { runCloudOutputAllowSmoke } from '../src/sessions/run-cloud-output-allow-smoke.js'
import { runCloudOutputDenySmoke } from '../src/sessions/run-cloud-output-deny-smoke.js'

const LIVE = process.env['RUN_LIVE_MANAGED_AGENTS_TEST'] === '1'

describe.skipIf(!LIVE)('Sprint 1B cloud output bridge (live)', () => {
  it('allow-path: write is approved and output file appears', async () => {
    validateLiveEnv()
    const client = createClient()

    const result = await runCloudOutputAllowSmoke(client)

    expect(result.passed).toBe(true)
    expect(result.writeApproved).toBe(true)
    expect(result.outputVerified).toBe(true)
    expect(result.sessionId).toBeTruthy()
    expect(result.agentId).toBeTruthy()
    expect(result.filename).toBe('POWERPLANT_ONLINE.txt')

    // Report file must exist and contain the correct fields
    const reportPath = path.join(process.cwd(), 'data', 'sprint1b-allow-report.json')
    expect(fs.existsSync(reportPath)).toBe(true)
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'))
    expect(report.writeApproved).toBe(true)
    expect(report.outputVerified).toBe(true)
  }, 120_000)

  it('deny-path: write is denied and no output file appears', async () => {
    validateLiveEnv()
    const client = createClient()

    const result = await runCloudOutputDenySmoke(client)

    expect(result.passed).toBe(true)
    expect(result.writeDenied).toBe(true)
    expect(result.noOutputVerified).toBe(true)
    expect(result.sessionId).toBeTruthy()

    // Report file must exist and contain the correct fields
    const reportPath = path.join(process.cwd(), 'data', 'sprint1b-deny-report.json')
    expect(fs.existsSync(reportPath)).toBe(true)
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'))
    expect(report.writeDenied).toBe(true)
    expect(report.noOutputVerified).toBe(true)
  }, 120_000)
})
