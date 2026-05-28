import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import {
  SPRINT4A_EXECUTOR_IMAGE,
  SPRINT4A_VERIFICATION_FILENAME,
  SPRINT4A_TEST_OUTPUT_FILENAME,
} from '../config/constants.js'
import { PilotVerificationSchema } from '../contracts/project-tool-contracts.js'
import type { PilotVerification } from '../contracts/project-tool-contracts.js'

const execFileAsync = promisify(execFile)

export interface ProjectTestResult {
  verification: PilotVerification
  testOutput: string
  stdout: string
}

const FORBIDDEN_MOUNT_PATTERNS: readonly string[] = [
  '/var/run/docker.sock',
  process.env['HOME'] ?? '/root',
  '.env',
  'node_modules',
]

function assertSafeMountPath(mountPath: string): void {
  for (const pattern of FORBIDDEN_MOUNT_PATTERNS) {
    if (mountPath.includes(pattern)) {
      throw new Error(`Forbidden mount path: '${mountPath}' matches pattern '${pattern}'`)
    }
  }
  if (!mountPath.startsWith('/tmp/')) {
    throw new Error(
      `Project executor workspace must be under /tmp/ — got: ${mountPath}`,
    )
  }
}

function buildProjectTestDockerArgv(
  workspacePath: string,
  outputDir: string,
): string[] {
  return [
    'run',
    '--rm',
    '--network', 'none',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--user', '1001:1001',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
    // Workspace is mounted read-only — executor can only run tests, not modify source
    '--mount', `type=bind,src=${workspacePath},dst=/mnt/session/workspace,readonly`,
    // Output directory mounted rw — executor writes test results here
    '--mount', `type=bind,src=${outputDir},dst=/mnt/session/outputs`,
    SPRINT4A_EXECUTOR_IMAGE,
  ]
}

export async function runProjectTestExecutor(
  workspacePath: string,
  outputDir: string,
): Promise<ProjectTestResult> {
  assertSafeMountPath(workspacePath)
  assertSafeMountPath(outputDir)

  fs.mkdirSync(outputDir, { recursive: true })
  // Allow uid 1001 inside the container to write output files
  fs.chmodSync(outputDir, 0o777)

  const argv = buildProjectTestDockerArgv(workspacePath, outputDir)

  let stdout = ''
  try {
    const result = await execFileAsync('docker', argv, {
      env: {},            // empty host env — no secrets reach the container
      timeout: 60_000,
    })
    stdout = result.stdout.trim()
  } catch (err: unknown) {
    // node --test may exit non-zero; capture stdout from the error object
    const e = err as { stdout?: string; stderr?: string; code?: number }
    stdout = (e.stdout ?? '').trim()
    if (!stdout) {
      throw new Error(`Docker executor failed: ${String(err)}`)
    }
  }

  // Read verification artifact
  const verPath = path.join(outputDir, SPRINT4A_VERIFICATION_FILENAME)
  if (!fs.existsSync(verPath)) {
    throw new Error(`Executor did not write ${SPRINT4A_VERIFICATION_FILENAME}`)
  }
  const raw = JSON.parse(fs.readFileSync(verPath, 'utf-8'))
  const parseResult = PilotVerificationSchema.safeParse(raw)
  if (!parseResult.success) {
    throw new Error(`Verification artifact schema invalid: ${parseResult.error.message}`)
  }

  const testOutputPath = path.join(outputDir, SPRINT4A_TEST_OUTPUT_FILENAME)
  const testOutput = fs.existsSync(testOutputPath)
    ? fs.readFileSync(testOutputPath, 'utf-8')
    : ''

  return { verification: parseResult.data, testOutput, stdout }
}
