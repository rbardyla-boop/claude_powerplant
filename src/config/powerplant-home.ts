import os from 'os'
import path from 'path'
import fs from 'fs'

export const POWERPLANT_HOME_ENV = 'POWERPLANT_HOME'

/**
 * Resolve the Powerplant runtime home directory.
 *
 * Default: ~/.powerplant
 * Override: POWERPLANT_HOME=/some/path (for tests/development only)
 *
 * This is the ONLY authoritative path resolver for all engine-owned runtime
 * state (agent/environment IDs, reports, run artifacts).
 *
 * Target-project .powerplant/ directories are contract-only and are NEVER
 * used for engine resource state.
 */
export function getPowerplantHome(): string {
  return process.env[POWERPLANT_HOME_ENV] ?? path.join(os.homedir(), '.powerplant')
}

/**
 * Resolve a path inside the Powerplant state directory.
 */
export function getStatePath(filename: string): string {
  return path.join(getPowerplantHome(), 'state', filename)
}

// ── Credential resolution ─────────────────────────────────────────────────────

/**
 * Where ANTHROPIC_API_KEY came from in the last loadPowerplantEnv() call.
 *
 * - 'shell':           already set in the calling shell before powerplant ran
 * - 'package-root':   loaded from <powerplant-package-root>/.env
 * - 'powerplant-home': loaded from ~/.powerplant/.env (fallback)
 * - 'none':           key is absent from all sources
 */
export type CredentialSource = 'shell' | 'package-root' | 'powerplant-home' | 'none'

let _resolvedCredentialSource: CredentialSource = 'none'

export function getResolvedCredentialSource(): CredentialSource {
  return _resolvedCredentialSource
}

/**
 * Load key=value pairs from a .env file into process.env.
 * Only sets keys that are not already present — never overwrites.
 */
function loadEnvFileIntoProcess(filePath: string): void {
  let contents: string
  try {
    contents = fs.readFileSync(filePath, 'utf-8')
  } catch {
    return
  }
  for (const line of contents.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (key && !process.env[key]) {
      process.env[key] = val
    }
  }
}

/**
 * Load Powerplant-owned credentials into process.env.
 *
 * Precedence (first source that provides ANTHROPIC_API_KEY wins):
 *   1. Shell environment (already set before powerplant ran)
 *   2. <packageRootPath>/.env  — the Powerplant package's own .env
 *   3. ~/.powerplant/.env      — optional user-level override / fallback
 *
 * Supplementary keys (CLAUDE_POWERPLANT_MODEL_ID, etc.) are loaded from
 * both files in the same order — later files fill gaps left by earlier ones.
 *
 * This function NEVER reads from process.cwd() or any target-project path.
 * Pass the Powerplant CLI package root as packageRootPath; do not pass the
 * target-project directory.
 *
 * Returns which source provided ANTHROPIC_API_KEY (for doctor display).
 */
export function loadPowerplantEnv(packageRootPath?: string): CredentialSource {
  const API_KEY = 'ANTHROPIC_API_KEY'
  const homeEnvPath = path.join(getPowerplantHome(), '.env')

  // ── 1. Shell: key already present ────────────────────────────────────────
  if (process.env[API_KEY]) {
    // Still load supplementary keys (MODEL_ID etc.) from both files if missing
    if (packageRootPath) {
      const fp = path.join(packageRootPath, '.env')
      if (fs.existsSync(fp)) loadEnvFileIntoProcess(fp)
    }
    if (fs.existsSync(homeEnvPath)) loadEnvFileIntoProcess(homeEnvPath)
    _resolvedCredentialSource = 'shell'
    return 'shell'
  }

  // ── 2. Package-root .env ──────────────────────────────────────────────────
  if (packageRootPath) {
    const fp = path.join(packageRootPath, '.env')
    if (fs.existsSync(fp)) {
      loadEnvFileIntoProcess(fp)
      if (process.env[API_KEY]) {
        // Load supplementary keys from home as well (home can override MODEL_ID etc.)
        if (fs.existsSync(homeEnvPath)) loadEnvFileIntoProcess(homeEnvPath)
        _resolvedCredentialSource = 'package-root'
        return 'package-root'
      }
    }
  }

  // ── 3. ~/.powerplant/.env fallback ────────────────────────────────────────
  if (fs.existsSync(homeEnvPath)) {
    loadEnvFileIntoProcess(homeEnvPath)
    if (process.env[API_KEY]) {
      _resolvedCredentialSource = 'powerplant-home'
      return 'powerplant-home'
    }
  }

  _resolvedCredentialSource = 'none'
  return 'none'
}
