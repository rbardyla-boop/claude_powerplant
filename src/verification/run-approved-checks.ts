import { spawnSync } from 'child_process'
import type { CheckResult } from '../contracts/verification-preflight-report.js'
import { classifyCheckResult, tailOutput } from './classify-check-result.js'
import { resolveVerificationProfile } from './verification-profiles.js'
import { runCapsuleChecks } from './run-capsule-checks.js'

const CHECK_TIMEOUT_MS = 120_000

/**
 * Minimal environment for check execution.
 *
 * PATH is forwarded so tool binaries can be located.
 * RUSTUP_HOME and CARGO_HOME are forwarded when present so Rust toolchain
 * managers can locate installed toolchains — these are not credentials.
 * HOME is redirected to /tmp to prevent dot-file access.
 * No API keys, no credential env vars, no proxy settings, no SSH agents.
 */
function buildCleanEnv(): NodeJS.ProcessEnv {
  const realHome = process.env['HOME']
  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin',
    HOME: '/tmp',
    NO_UPDATE_NOTIFIER: '1',
    npm_config_update_notifier: 'false',
  }
  const rustupHome = process.env['RUSTUP_HOME'] ?? (realHome ? `${realHome}/.rustup` : undefined)
  const cargoHome = process.env['CARGO_HOME'] ?? (realHome ? `${realHome}/.cargo` : undefined)
  if (rustupHome !== undefined) env['RUSTUP_HOME'] = rustupHome
  if (cargoHome !== undefined) env['CARGO_HOME'] = cargoHome
  return env
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
 * Infer the kind of check from the check ID and command string.
 * Used to select the appropriate integrity guard in classifyCheckResult.
 */
function inferCheckKind(checkId: string, command: string): 'test' | 'typecheck' | undefined {
  if (checkId === 'test' || /\bvitest\b|\bjest\b/.test(command)) return 'test'
  if (checkId === 'typecheck' || /\btsc\b/.test(command)) return 'typecheck'
  return undefined
}

/**
 * Run each approved check inside the isolated verification workspace.
 *
 * No API calls, no Managed Agents session, no original project mounted.
 * Clean environment ensures no credentials reach the executor.
 *
 * required: false marks a check as advisory — its failure is recorded but
 * does not affect the overall PASS/FAIL verdict.
 */
export function runApprovedChecks(
  workspacePath: string,
  checks: Record<string, { command: string; required?: boolean }>,
): CheckResult[] {
  const env = buildCleanEnv()
  const results: CheckResult[] = []

  for (const [checkId, { command, required }] of Object.entries(checks)) {
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
    if (required === false) entry.advisory = true
    if (spawnError !== null) entry.detail = String(spawnError)
    results.push(entry)
  }

  return results
}

/**
 * Shared entry point used by both `powerplant verify` and the live
 * `project_run_check` broker handler.
 *
 * When verificationProfileId is provided, runs checks inside the named
 * capsule image (Docker, --network none). Without a profile, falls back
 * to plain host-process execution (useful for simple projects and tests).
 *
 * Both paths must always route here — never diverge between preflight and live.
 */
export async function executeChecksWithProfile(
  workspacePath: string,
  checks: Record<string, { command: string; required?: boolean }>,
  verificationProfileId: string | null,
): Promise<CheckResult[]> {
  if (verificationProfileId !== null) {
    const profile = resolveVerificationProfile(verificationProfileId)
    return runCapsuleChecks(workspacePath, checks, profile)
  }
  return runApprovedChecks(workspacePath, checks)
}
