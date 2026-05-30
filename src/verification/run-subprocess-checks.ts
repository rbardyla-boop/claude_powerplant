import { spawnSync } from 'child_process'
import type { CheckResult } from '../contracts/verification-preflight-report.js'
import { classifyCheckResult, tailOutput } from './classify-check-result.js'

const CHECK_TIMEOUT_MS = 120_000

/**
 * Minimal environment for subprocess check execution.
 *
 * Only PATH is forwarded so tool binaries can be located.
 * No API keys, no HOME dot-files, no credential env vars,
 * no proxy settings, no SSH agents.
 */
function buildCleanEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin',
    HOME: '/tmp',
    NO_UPDATE_NOTIFIER: '1',
    npm_config_update_notifier: 'false',
  }
}

function splitCommand(command: string): [string, string[]] {
  const parts = command.trim().split(/\s+/).filter(p => p.length > 0)
  return [parts[0] ?? '', parts.slice(1)]
}

function inferCheckKind(checkId: string, command: string): 'test' | 'typecheck' | undefined {
  if (checkId === 'test' || /\bvitest\b|\bjest\b|\bpytest\b/.test(command)) return 'test'
  if (checkId === 'typecheck' || /\btsc\b/.test(command)) return 'typecheck'
  return undefined
}

/**
 * Run each approved check directly via spawnSync inside the sanitized workspace.
 *
 * No Docker, no API calls, no credentials.
 * Runs checks in workspacePath — never the original live project path.
 * Clean environment ensures no credentials reach the subprocess.
 */
export async function runSubprocessChecks(
  workspacePath: string,
  checks: Record<string, { command: string }>,
): Promise<CheckResult[]> {
  const env = buildCleanEnv()
  const results: CheckResult[] = []

  for (const [checkId, { command }] of Object.entries(checks)) {
    const [executable, args] = splitCommand(command)

    const result = spawnSync(executable, args, {
      cwd: workspacePath,
      env,
      encoding: 'utf-8',
      timeout: CHECK_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    })

    const stdout = typeof result.stdout === 'string' ? result.stdout : ''
    const stderr = typeof result.stderr === 'string' ? result.stderr : ''
    const exitCode = result.status
    const spawnError = result.error ?? null

    const checkKind = inferCheckKind(checkId, command)
    const verdict = classifyCheckResult({ spawnError, exitCode, stdout, stderr, checkKind })

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
