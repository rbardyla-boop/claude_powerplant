import { spawnSync } from 'child_process'
import type { CheckResult } from '../contracts/verification-preflight-report.js'
import { classifyCheckResult, tailOutput } from './classify-check-result.js'

const CHECK_TIMEOUT_MS = 120_000

/**
 * Minimal environment for check execution.
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

/**
 * Split a plain command string into [executable, ...args].
 * Supports simple commands only (no shell operators, no quoting).
 * Commands in VERIFY.yaml are developer-reviewed contracts.
 */
function splitCommand(command: string): [string, string[]] {
  const parts = command.trim().split(/\s+/).filter(p => p.length > 0)
  const executable = parts[0] ?? ''
  const args = parts.slice(1)
  return [executable, args]
}

/**
 * Run each approved check inside the isolated verification workspace.
 *
 * No API calls, no Managed Agents session, no original project mounted.
 * Clean environment ensures no credentials reach the executor.
 */
export function runApprovedChecks(
  workspacePath: string,
  checks: Record<string, { command: string }>,
): CheckResult[] {
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
