import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { buildPilotSnapshot } from '../src/projects/build-pilot-snapshot.js'
import { verifySourceUnchanged } from '../src/projects/verify-source-unchanged.js'
import { generatePatchPackage } from '../src/projects/generate-patch-package.js'
import { loadProjectContract } from '../src/projects/load-project-contract.js'
import type { CheckResult } from '../src/contracts/verification-preflight-report.js'
import type { LoadedProjectContract } from '../src/projects/load-project-contract.js'
import { SPRINT4A_PILOT_SOURCE_PATH } from '../src/config/constants.js'

const PILOT_SOURCE = SPRINT4A_PILOT_SOURCE_PATH
const PILOT_AVAILABLE = Boolean(PILOT_SOURCE) && fs.existsSync(PILOT_SOURCE)

let tempDir: string
let pilotContract: LoadedProjectContract

beforeAll(() => {
  if (!PILOT_AVAILABLE) return
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-patch-test-'))
  pilotContract = loadProjectContract(PILOT_SOURCE)
})

afterAll(() => {
  if (!PILOT_AVAILABLE) return
  fs.rmSync(tempDir, { recursive: true, force: true })
})

const mockCheckResults: CheckResult[] = [
  {
    checkId: 'test',
    command: 'npx vitest run',
    verdict: 'PASS',
    exitCode: 0,
    stdoutTail: '# tests 25\n# pass 25',
    stderrTail: '',
  },
]

describe.skipIf(!PILOT_AVAILABLE)('patch-package', () => {
  it('generates package with required files', async () => {
    const runDir = path.join(tempDir, 'gen1')
    const patchDir = path.join(tempDir, 'patch1')

    const snapshot = buildPilotSnapshot(pilotContract, runDir)
    const sourceVerification = verifySourceUnchanged(snapshot)

    const pkg = await generatePatchPackage({
      runId: 'test-run-1',
      snapshot,
      contract: pilotContract,
      sourceVerification,
      checkResults: mockCheckResults,
      customToolCounts: { project_read_file: 2, project_write_file: 2, project_run_check: 1, project_finalize: 1 },
      finalResponse: 'SANITIZED PILOT PATCH COMPLETE',
      patchDir,
      taskDescription: 'Test task',
      agentMessage: 'Test task\n\nAfter implementing: call project_run_check.',
      modelId: 'claude-haiku-4-5-20251001',
    })

    const requiredFiles = [
      'SOURCE_MANIFEST.json',
      'SANITIZED_MANIFEST.json',
      'TASK.md',
      'PATCH.diff',
      'CHANGED_FILES.md',
      'VERIFICATION_REPORT.md',
      'ADVERSARIAL_REVIEW.md',
      'SESSION_SUMMARY.json',
    ]
    for (const f of requiredFiles) {
      expect(fs.existsSync(path.join(patchDir, f))).toBe(true)
    }
  })

  it('SOURCE_MANIFEST records sourceUnmodified: true when source is untouched', async () => {
    const runDir = path.join(tempDir, 'gen2')
    const patchDir = path.join(tempDir, 'patch2')

    const snapshot = buildPilotSnapshot(pilotContract, runDir)
    const sourceVerification = verifySourceUnchanged(snapshot)

    await generatePatchPackage({
      runId: 'test-run-2',
      snapshot,
      contract: pilotContract,
      sourceVerification,
      checkResults: mockCheckResults,
      customToolCounts: {},
      finalResponse: 'SANITIZED PILOT PATCH COMPLETE',
      patchDir,
      taskDescription: 'Test task',
      agentMessage: 'Test task\n\nAfter implementing: call project_run_check.',
      modelId: 'claude-haiku-4-5-20251001',
    })

    const manifest = JSON.parse(
      fs.readFileSync(path.join(patchDir, 'SOURCE_MANIFEST.json'), 'utf-8'),
    )
    expect(manifest.postRunVerification.sourceUnmodified).toBe(true)
    expect(manifest.postRunVerification.changedFiles).toHaveLength(0)
  })

  it('PATCH.diff is empty when workspace matches baseline', async () => {
    const runDir = path.join(tempDir, 'gen3')
    const patchDir = path.join(tempDir, 'patch3')

    const snapshot = buildPilotSnapshot(pilotContract, runDir)
    const sourceVerification = verifySourceUnchanged(snapshot)

    await generatePatchPackage({
      runId: 'test-run-3',
      snapshot,
      contract: pilotContract,
      sourceVerification,
      checkResults: mockCheckResults,
      customToolCounts: {},
      finalResponse: 'SANITIZED PILOT PATCH COMPLETE',
      patchDir,
      taskDescription: 'Test task',
      agentMessage: 'Test task\n\nAfter implementing: call project_run_check.',
      modelId: 'claude-haiku-4-5-20251001',
    })

    const patchContent = fs.readFileSync(path.join(patchDir, 'PATCH.diff'), 'utf-8')
    expect(patchContent.trim()).toBe('') // no changes
  })

  it('PATCH.diff only contains changes to allowed write paths', async () => {
    const runDir = path.join(tempDir, 'gen4')
    const patchDir = path.join(tempDir, 'patch4')

    const snapshot = buildPilotSnapshot(pilotContract, runDir)

    // Simulate agent writing to workspace
    const newContent = `export function healthLabel(passing, total) {
  return passing === total ? "healthy" : "degraded";
}
export function summarizeChecks(results) {
  if (!Array.isArray(results)) throw new Error("must be array");
  const passing = results.filter(r => r.passed).length;
  return { total: results.length, passing, failing: results.length - passing, status: passing === results.length ? "healthy" : "degraded" };
}
`
    fs.writeFileSync(path.join(snapshot.workspacePath, 'src/status.js'), newContent, 'utf-8')

    const sourceVerification = verifySourceUnchanged(snapshot)

    await generatePatchPackage({
      runId: 'test-run-4',
      snapshot,
      contract: pilotContract,
      sourceVerification,
      checkResults: mockCheckResults,
      customToolCounts: {},
      finalResponse: 'SANITIZED PILOT PATCH COMPLETE',
      patchDir,
      taskDescription: 'Test task',
      agentMessage: 'Test task\n\nAfter implementing: call project_run_check.',
      modelId: 'claude-haiku-4-5-20251001',
    })

    const patchContent = fs.readFileSync(path.join(patchDir, 'PATCH.diff'), 'utf-8')
    expect(patchContent).toContain('src/status.js')
    // Patch must NOT reference forbidden paths
    expect(patchContent).not.toContain('.env')
    expect(patchContent).not.toContain('private/')
    expect(patchContent).not.toContain('deployment/')
    // Only allowed write paths appear as change targets
    const linesWithDiff = patchContent
      .split('\n')
      .filter(l => l.startsWith('--- ') || l.startsWith('+++ '))
    for (const line of linesWithDiff) {
      const hasSrcStatus = line.includes('src/status.js')
      const hasTestsStatus = line.includes('tests/status.test.js')
      const isDevNull = line.includes('/dev/null')
      expect(hasSrcStatus || hasTestsStatus || isDevNull).toBe(true)
    }
  })

  it('SESSION_SUMMARY clearedForRealProjectMounting is always false', async () => {
    const runDir = path.join(tempDir, 'gen5')
    const patchDir = path.join(tempDir, 'patch5')

    const snapshot = buildPilotSnapshot(pilotContract, runDir)
    const sourceVerification = verifySourceUnchanged(snapshot)

    await generatePatchPackage({
      runId: 'test-run-5',
      snapshot,
      contract: pilotContract,
      sourceVerification,
      checkResults: mockCheckResults,
      customToolCounts: {},
      finalResponse: 'SANITIZED PILOT PATCH COMPLETE',
      patchDir,
      taskDescription: 'Test task',
      agentMessage: 'Test task\n\nAfter implementing: call project_run_check.',
      modelId: 'claude-haiku-4-5-20251001',
    })

    const summary = JSON.parse(
      fs.readFileSync(path.join(patchDir, 'SESSION_SUMMARY.json'), 'utf-8'),
    )
    expect(summary.clearedForRealProjectMounting).toBe(false)
    // Any run with a valid POLICY.yaml contract sets this to true
    expect(summary.clearedForSanitizedExternalProjectInput).toBe(true)
    expect(summary.originalProjectMounted).toBe(false)
    expect(summary.sanitizedWorkspaceUsed).toBe(true)
    expect(summary.executorNetworkDisabled).toBe(true)
    expect(summary.noCredentialsPassedToExecutor).toBe(true)
  })

  it('SESSION_SUMMARY clearedForGeneratedExternalPilot is true only when all gates pass', async () => {
    const runDir = path.join(tempDir, 'gen6')
    const patchDir = path.join(tempDir, 'patch6')

    const snapshot = buildPilotSnapshot(pilotContract, runDir)
    const sourceVerification = verifySourceUnchanged(snapshot)

    await generatePatchPackage({
      runId: 'test-run-6',
      snapshot,
      contract: pilotContract,
      sourceVerification,
      checkResults: mockCheckResults, // passed: true
      customToolCounts: {},
      finalResponse: 'SANITIZED PILOT PATCH COMPLETE',
      patchDir,
      taskDescription: 'Test task',
      agentMessage: 'Test task\n\nAfter implementing: call project_run_check.',
      modelId: 'claude-haiku-4-5-20251001',
    })

    const summary = JSON.parse(
      fs.readFileSync(path.join(patchDir, 'SESSION_SUMMARY.json'), 'utf-8'),
    )
    // Both verification passed AND sourceUnmodified AND is the pilot project → true
    expect(summary.clearedForGeneratedExternalPilot).toBe(true)
    expect(summary.projectId).toBe('powerplant-pilot-status')
  })

  it('SESSION_SUMMARY clearedForGeneratedExternalPilot is false when test failed', async () => {
    const runDir = path.join(tempDir, 'gen7')
    const patchDir = path.join(tempDir, 'patch7')

    const snapshot = buildPilotSnapshot(pilotContract, runDir)
    const sourceVerification = verifySourceUnchanged(snapshot)
    const failedCheckResults: CheckResult[] = [
      {
        checkId: 'test',
        command: 'npx vitest run',
        verdict: 'FAIL_CHECK',
        exitCode: 1,
        stdoutTail: '# tests 25\n# fail 25',
        stderrTail: '',
      },
    ]

    await generatePatchPackage({
      runId: 'test-run-7',
      snapshot,
      contract: pilotContract,
      sourceVerification,
      checkResults: failedCheckResults,
      customToolCounts: {},
      finalResponse: 'SANITIZED PILOT PATCH COMPLETE',
      patchDir,
      taskDescription: 'Test task',
      agentMessage: 'Test task\n\nAfter implementing: call project_run_check.',
      modelId: 'claude-haiku-4-5-20251001',
    })

    const summary = JSON.parse(
      fs.readFileSync(path.join(patchDir, 'SESSION_SUMMARY.json'), 'utf-8'),
    )
    expect(summary.clearedForGeneratedExternalPilot).toBe(false)
  })
})
