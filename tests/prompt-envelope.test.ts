import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { buildPilotSnapshot } from '../src/projects/build-pilot-snapshot.js'
import { verifySourceUnchanged } from '../src/projects/verify-source-unchanged.js'
import { generatePatchPackage } from '../src/projects/generate-patch-package.js'
import { printReviewReport } from '../src/cli/terminal-output.js'
import type { PilotVerification } from '../src/contracts/project-tool-contracts.js'
import type { ProjectContract } from '../src/projects/project-contract.js'
import { PROMPT_ENVELOPE_PROTOCOL_VERSION } from '../src/config/constants.js'

const PILOT_SOURCE = '/home/thebackhand/Downloads/grok/powerplant_pilot_status'

const USER_TASK = 'Add a function that returns failed check names.'
const AGENT_MESSAGE =
  'Add a function that returns failed check names.\n\n' +
  'After implementing the task:\n' +
  '1. Call project_run_check with { "check": "test" }.\n' +
  '2. If tests fail, fix the implementation or tests and re-run.\n' +
  '3. After tests pass, call project_finalize with a brief summary.\n' +
  '4. Respond with exactly: SANITIZED PILOT PATCH COMPLETE'
const MODEL_ID = 'claude-haiku-4-5-20251001'

const pilotContract: ProjectContract = {
  projectId: 'powerplant-pilot-status',
  sourcePath: PILOT_SOURCE,
  includePaths: ['package.json', 'README.md', 'src/**', 'tests/**', '.powerplant/**'],
  excludePaths: [
    '.env', '.env.*', 'private/**', 'deployment/**',
    '.git/**', 'node_modules/**', 'package-lock.json',
    'credentials*.json', '**/*.key', '**/*.pem',
  ],
  denyIfPresentAfterCopy: ['.env', 'private', 'deployment', '.git', 'node_modules', 'credentials.json'],
  workspaceMode: 'sanitized_copy_only',
  allowBash: false,
  realProjectMounted: false,
}

const mockVerification: PilotVerification = {
  checkId: 'test',
  fixedAction: 'node --test',
  exitCode: 0,
  passed: true,
}

let tempDir: string
let patchDir: string

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-envelope-test-'))
  patchDir = path.join(tempDir, 'patch')

  const runDir = path.join(tempDir, 'run')
  const snapshot = buildPilotSnapshot(pilotContract, runDir)
  const sourceVerification = verifySourceUnchanged(snapshot)

  await generatePatchPackage({
    runId: 'envelope-test-run-1',
    snapshot,
    sourceVerification,
    verification: mockVerification,
    customToolCounts: { project_run_check: 1, project_finalize: 1 },
    finalResponse: 'SANITIZED PILOT PATCH COMPLETE',
    patchDir,
    taskDescription: USER_TASK,
    agentMessage: AGENT_MESSAGE,
    modelId: MODEL_ID,
  })
})

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('PROMPT_ENVELOPE.json artifact', () => {
  it('is emitted alongside TASK.md', () => {
    expect(fs.existsSync(path.join(patchDir, 'TASK.md'))).toBe(true)
    expect(fs.existsSync(path.join(patchDir, 'PROMPT_ENVELOPE.json'))).toBe(true)
  })

  it('TASK.md contains only the developer task — no completion protocol text', () => {
    const taskContent = fs.readFileSync(path.join(patchDir, 'TASK.md'), 'utf-8')
    expect(taskContent.trim()).toBe(USER_TASK)
    expect(taskContent).not.toContain('project_run_check')
    expect(taskContent).not.toContain('project_finalize')
    expect(taskContent).not.toContain('SANITIZED PILOT PATCH COMPLETE')
    expect(taskContent).not.toContain('After implementing')
  })

  it('PROMPT_ENVELOPE.json contains the actual agent message', () => {
    const raw = fs.readFileSync(path.join(patchDir, 'PROMPT_ENVELOPE.json'), 'utf-8')
    const envelope = JSON.parse(raw) as Record<string, unknown>
    expect(envelope['agentMessage']).toBe(AGENT_MESSAGE)
  })

  it('agentMessageSha256 matches the stored agentMessage', () => {
    const raw = fs.readFileSync(path.join(patchDir, 'PROMPT_ENVELOPE.json'), 'utf-8')
    const envelope = JSON.parse(raw) as Record<string, unknown>
    const expected = crypto.createHash('sha256').update(AGENT_MESSAGE, 'utf-8').digest('hex')
    expect(envelope['agentMessageSha256']).toBe(expected)
  })

  it('userTask in envelope matches the clean developer request', () => {
    const raw = fs.readFileSync(path.join(patchDir, 'PROMPT_ENVELOPE.json'), 'utf-8')
    const envelope = JSON.parse(raw) as Record<string, unknown>
    expect(envelope['userTask']).toBe(USER_TASK)
  })

  it('envelope contains required fields with correct types', () => {
    const raw = fs.readFileSync(path.join(patchDir, 'PROMPT_ENVELOPE.json'), 'utf-8')
    const envelope = JSON.parse(raw) as Record<string, unknown>
    expect(typeof envelope['userTask']).toBe('string')
    expect(typeof envelope['completionProtocolVersion']).toBe('string')
    expect(typeof envelope['agentMessage']).toBe('string')
    expect(typeof envelope['agentMessageSha256']).toBe('string')
    expect(typeof envelope['modelId']).toBe('string')
    expect(typeof envelope['createdAt']).toBe('string')
  })

  it('completionProtocolVersion is the stable version constant', () => {
    const raw = fs.readFileSync(path.join(patchDir, 'PROMPT_ENVELOPE.json'), 'utf-8')
    const envelope = JSON.parse(raw) as Record<string, unknown>
    expect(envelope['completionProtocolVersion']).toBe(PROMPT_ENVELOPE_PROTOCOL_VERSION)
    expect(envelope['completionProtocolVersion']).toBe('v1')
  })

  it('modelId matches the known pilot model', () => {
    const raw = fs.readFileSync(path.join(patchDir, 'PROMPT_ENVELOPE.json'), 'utf-8')
    const envelope = JSON.parse(raw) as Record<string, unknown>
    expect(envelope['modelId']).toBe(MODEL_ID)
  })

  it('agentMessage in envelope differs from userTask — confirms split is recorded', () => {
    const raw = fs.readFileSync(path.join(patchDir, 'PROMPT_ENVELOPE.json'), 'utf-8')
    const envelope = JSON.parse(raw) as Record<string, unknown>
    expect(envelope['agentMessage']).not.toBe(envelope['userTask'])
    expect((envelope['agentMessage'] as string).startsWith(USER_TASK)).toBe(true)
  })

  it('no forbidden source contents appear in prompt envelope', () => {
    const raw = fs.readFileSync(path.join(patchDir, 'PROMPT_ENVELOPE.json'), 'utf-8')
    // Forbidden canaries from the pilot fixture project
    expect(raw).not.toContain('POWERPLANT_FORBIDDEN')
    expect(raw).not.toContain('sk-ant-')
    // Envelope should not contain any file paths outside the task
    expect(raw).not.toContain('/etc/passwd')
    expect(raw).not.toContain('credentials.json')
  })

  it('createdAt is a valid ISO 8601 timestamp', () => {
    const raw = fs.readFileSync(path.join(patchDir, 'PROMPT_ENVELOPE.json'), 'utf-8')
    const envelope = JSON.parse(raw) as Record<string, unknown>
    const ts = new Date(envelope['createdAt'] as string)
    expect(ts.getTime()).not.toBeNaN()
  })
})

describe('review display with prompt envelope', () => {
  it('printReviewReport shows protocol version, model, and truncated hash', () => {
    const patchDiff = ''
    const sessionSummary = {
      passed: true,
      originalProjectMounted: false,
      sourceUnmodified: true,
      builtInToolUseCount: 0,
      executorNetworkDisabled: true,
      noCredentialsPassedToExecutor: true,
    }
    const envelopeHash = crypto.createHash('sha256').update(AGENT_MESSAGE, 'utf-8').digest('hex')
    const promptEnvelope = {
      userTask: USER_TASK,
      completionProtocolVersion: 'v1',
      agentMessage: AGENT_MESSAGE,
      agentMessageSha256: envelopeHash,
      modelId: MODEL_ID,
      createdAt: new Date().toISOString(),
    }

    const lines: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => lines.push(args.join(' '))
    try {
      printReviewReport({
        runId: 'test-run',
        artifactDir: '/tmp/test',
        task: USER_TASK,
        patchDiff,
        changedFilesMd: '',
        verificationMd: '',
        adversarialMd: '',
        sessionSummary,
        promptEnvelope,
      })
    } finally {
      console.log = origLog
    }

    const output = lines.join('\n')
    expect(output).toContain('Protocol:')
    expect(output).toContain('v1')
    expect(output).toContain('Model:')
    expect(output).toContain(MODEL_ID)
    expect(output).toContain('Msg hash:')
    // Should show truncated hash (first 16 chars + ellipsis)
    expect(output).toContain(envelopeHash.slice(0, 16))
    // Should NOT print the full agent message
    expect(output).not.toContain('project_run_check')
    expect(output).not.toContain('After implementing')
  })

  it('printReviewReport gracefully omits envelope section when not provided', () => {
    const lines: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => lines.push(args.join(' '))
    try {
      printReviewReport({
        runId: 'no-envelope-run',
        artifactDir: '/tmp/test',
        task: USER_TASK,
        patchDiff: '',
        changedFilesMd: '',
        verificationMd: '',
        adversarialMd: '',
        sessionSummary: { passed: true, originalProjectMounted: false, sourceUnmodified: true,
          builtInToolUseCount: 0, executorNetworkDisabled: true, noCredentialsPassedToExecutor: true },
      })
    } finally {
      console.log = origLog
    }

    const output = lines.join('\n')
    expect(output).not.toContain('Protocol:')
    expect(output).not.toContain('Msg hash:')
  })
})
