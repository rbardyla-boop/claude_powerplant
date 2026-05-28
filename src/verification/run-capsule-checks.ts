import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import type { CheckResult } from '../contracts/verification-preflight-report.js'
import type { VerificationProfile } from '../contracts/verification-profile.js'
import { classifyCheckResult, tailOutput } from './classify-check-result.js'

const execFileAsync = promisify(execFile)

const CHECK_TIMEOUT_MS = 120_000

const FORBIDDEN_WORKSPACE_PATTERNS: readonly string[] = [
  process.env['HOME'] ?? '/root',
  '.env',
  '/var/run/docker.sock',
]

function assertSafeCapsuleMount(workspacePath: string): void {
  for (const pattern of FORBIDDEN_WORKSPACE_PATTERNS) {
    if (workspacePath.includes(pattern)) {
      throw new Error(
        `FAIL_BOUNDARY: Forbidden workspace path '${workspacePath}' matches pattern '${pattern}'`,
      )
    }
  }
  if (!workspacePath.startsWith('/tmp/')) {
    throw new Error(
      `FAIL_BOUNDARY: Capsule workspace must be under /tmp/ — got: ${workspacePath}`,
    )
  }
}

/**
 * Build Docker argv for one capsule check.
 *
 * Safety invariants:
 *   --network none          no outbound connections during execution
 *   --cap-drop ALL          no elevated capabilities
 *   --security-opt ...      no privilege escalation
 *   --user 1001:1001        non-root
 *   workspace bind mount    read-write so entrypoint can create node_modules symlink
 *                           (workspace is disposable — never the original project)
 *   env {}                  no host env vars passed
 */
export function buildCapsuleDockerArgv(
  workspacePath: string,
  profile: VerificationProfile,
  command: string,
  args: string[],
): string[] {
  return [
    'run',
    '--rm',
    '--network', 'none',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--user', '1001:1001',
    // Workspace is read-write so the entrypoint can symlink node_modules.
    // The workspace is a disposable sanitized copy, never the original project.
    '--mount', `type=bind,src=${workspacePath},dst=/workspace`,
    profile.capsuleImageName,
    command,
    ...args,
  ]
}

function splitCommand(command: string): [string, string[]] {
  const parts = command.trim().split(/\s+/).filter(p => p.length > 0)
  return [parts[0] ?? '', parts.slice(1)]
}

/**
 * Run approved checks inside the capsule image.
 *
 * Shared execution path for both `powerplant verify` and the live
 * `project_run_check` broker handler. Both must use the same capsule runner
 * to guarantee preflight and live results are produced by identical tooling.
 *
 * No API calls, no credentials, no original project mounted.
 */
export async function runCapsuleChecks(
  workspacePath: string,
  checks: Record<string, { command: string }>,
  profile: VerificationProfile,
): Promise<CheckResult[]> {
  assertSafeCapsuleMount(workspacePath)

  // Allow uid 1001 (ppverify) in the container to write to the workspace root
  // (so the entrypoint can create symlinks inside node_modules).
  fs.chmodSync(workspacePath, 0o777)

  // Pre-create node_modules and .vite as host-owned directories with broad
  // permissions. This keeps ownership on the host side so the host can clean up
  // after Docker exits — Docker only adds symlinks inside, not new directories.
  const nodeMods = path.join(workspacePath, 'node_modules')
  const viteCache = path.join(nodeMods, '.vite')
  fs.mkdirSync(viteCache, { recursive: true })
  fs.chmodSync(nodeMods, 0o777)
  fs.chmodSync(viteCache, 0o777)

  const results: CheckResult[] = []

  for (const [checkId, { command }] of Object.entries(checks)) {
    const [executable, args] = splitCommand(command)
    const argv = buildCapsuleDockerArgv(workspacePath, profile, executable, args)

    let stdout = ''
    let stderr = ''
    let exitCode: number | null = null
    let spawnError: Error | null = null

    try {
      const result = await execFileAsync('docker', argv, {
        env: {},         // no host env vars reach the container
        timeout: CHECK_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      })
      stdout = result.stdout
      exitCode = 0
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean }
      stdout = e.stdout ?? ''
      stderr = e.stderr ?? ''
      exitCode = typeof e.code === 'number' ? e.code : null

      if (e.killed) {
        spawnError = new Error('Check timed out')
      } else if (exitCode === null) {
        spawnError = err instanceof Error ? err : new Error(String(err))
      }
    }

    const verdict = classifyCheckResult({ spawnError, exitCode, stdout, stderr })

    const entry: CheckResult = {
      checkId,
      command,
      verdict,
      exitCode,
      stdoutTail: tailOutput(stdout),
      stderrTail: tailOutput(stderr),
    }
    if (spawnError !== null) {
      entry.detail = String(spawnError)
    }
    results.push(entry)
  }

  return results
}
