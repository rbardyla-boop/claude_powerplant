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

/**
 * Load the Powerplant-owned credential file (~/.powerplant/.env) and inject
 * any keys not already present in process.env.
 *
 * This is the ONLY .env file Powerplant loads. It never reads a target
 * project's .env. The file is optional — missing it is not an error.
 *
 * Keys recognised: ANTHROPIC_API_KEY, CLAUDE_POWERPLANT_MODEL_ID
 */
export function loadPowerplantEnv(): void {
  const envFile = path.join(getPowerplantHome(), '.env')
  if (!fs.existsSync(envFile)) return
  let contents: string
  try {
    contents = fs.readFileSync(envFile, 'utf-8')
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
