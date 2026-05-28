import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getPowerplantHome } from '../../config/powerplant-home.js'
import { loadState, saveState } from '../../platform/managed-agent-state.js'
import type { CloudSmokeState } from '../../platform/managed-agent-state.js'
import {
  loadSprint4aState,
  saveSprint4aState,
  Sprint4aStateSchema,
} from '../../platform/sprint4a-state.js'
import type { Sprint4aState } from '../../platform/sprint4a-state.js'
import { ensureCloudEnvironment } from '../../provision/ensure-cloud-environment.js'
import { ensureSprint4aAgent } from '../../provision/ensure-sprint4a-agent.js'

// Sprint4A tool schema version required for the pilot agent.
// Must match the constant in ensure-sprint4a-agent.ts.
const REQUIRED_TOOL_SCHEMA_VERSION = 2

// ── Legacy-state migration ────────────────────────────────────────────────────

function legacyStateDir(): string {
  // The legacy state was stored relative to the powerplant package root.
  // Resolve using __filename so this works from any cwd.
  const __filename = fileURLToPath(import.meta.url)
  const pkgRoot = path.resolve(path.dirname(__filename), '..', '..', '..')
  return path.join(pkgRoot, '.powerplant', 'state')
}

function tryLoadLegacySmokeState(): CloudSmokeState | null {
  const fp = path.join(legacyStateDir(), 'cloud-smoke.json')
  if (!fs.existsSync(fp)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'))
    // Minimal validation — just need environment.id
    if (typeof raw?.environment?.id === 'string' && raw.environment.id) {
      return raw as CloudSmokeState
    }
    return null
  } catch {
    return null
  }
}

function tryLoadLegacySprint4aState(): Sprint4aState | null {
  const fp = path.join(legacyStateDir(), 'sprint4a-pilot.json')
  if (!fs.existsSync(fp)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'))
    const result = Sprint4aStateSchema.safeParse(raw)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

// ── Check if runtime is already valid ────────────────────────────────────────

function runtimeAlreadyReady(): boolean {
  const smoke = loadState()
  const s4a = loadSprint4aState()
  if (!smoke?.environment?.id) return false
  if (!s4a?.agent?.id) return false
  const schemaVersion = s4a.toolSchemaVersion ?? 1
  return schemaVersion >= REQUIRED_TOOL_SCHEMA_VERSION
}

// ── Setup command ─────────────────────────────────────────────────────────────

export async function cmdSetup(): Promise<void> {
  // ── 1. Already set up? ────────────────────────────────────────────────────

  if (runtimeAlreadyReady()) {
    const smoke = loadState()!
    const s4a = loadSprint4aState()!
    console.log('Powerplant runtime is already set up.')
    console.log()
    console.log(`Home:        ${getPowerplantHome()}`)
    console.log(`Environment: ${smoke.environment.id}`)
    console.log(`Agent:       ${s4a.agent!.id}`)
    console.log()
    console.log('You can now run:')
    console.log('  powerplant run <project-path> "<task>"')
    return
  }

  // ── 3. Migrate from legacy state (powerplant package dir) ─────────────────

  const legacySmoke = tryLoadLegacySmokeState()
  const legacySprint4a = tryLoadLegacySprint4aState()

  if (legacySmoke?.environment?.id && legacySprint4a?.agent?.id) {
    console.log('Migrating runtime state from legacy location...')
    console.log()

    // Write non-secret identifiers to the new user-level location.
    // Secrets are never stored in either location.
    saveState(legacySmoke)
    saveSprint4aState({
      ...legacySprint4a,
      // Ensure the tool schema version is stamped so re-provisioning is not triggered.
      toolSchemaVersion: REQUIRED_TOOL_SCHEMA_VERSION,
    })

    console.log(`Home:        ${getPowerplantHome()}`)
    console.log(`Environment: ${legacySmoke.environment.id}`)
    console.log(`Agent:       ${legacySprint4a.agent.id}`)
    console.log()
    console.log('Migration complete. You can now run:')
    console.log('  powerplant run <project-path> "<task>"')
    return
  }

  // ── 4. Provision fresh resources (credentials required here only) ────────

  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY is not set.')
    console.error()
    console.error('Set it in your shell:')
    console.error('  export ANTHROPIC_API_KEY=your-key')
    console.error()
    console.error('Or create ~/.powerplant/.env with:')
    console.error('  ANTHROPIC_API_KEY=your-key')
    process.exit(1)
  }

  console.log('Provisioning Powerplant runtime resources...')
  console.log()

  const controlClient = new Anthropic({ apiKey })

  // Create or reuse the managed execution environment.
  let envResult
  try {
    envResult = await ensureCloudEnvironment(controlClient)
  } catch (err) {
    console.error(`Error creating environment: ${String(err)}`)
    process.exit(1)
  }

  // Save environment state before provisioning the agent.
  const smokeState: CloudSmokeState = {
    agent: { id: '', version: 0, name: '' }, // placeholder — filled by smoke agent
    environment: envResult.environment,
    createdAt: new Date().toISOString(),
  }
  saveState(smokeState)

  // Create or reuse the pilot agent.
  let agentState: Sprint4aState
  try {
    agentState = await ensureSprint4aAgent(controlClient)
  } catch (err) {
    console.error(`Error provisioning agent: ${String(err)}`)
    process.exit(1)
  }

  console.log()
  console.log('Powerplant runtime is ready.')
  console.log()
  console.log(`Home:        ${getPowerplantHome()}`)
  console.log(`Environment: ${agentState.environmentId}`)
  console.log(`Agent:       ${agentState.agent?.id ?? '(not yet provisioned)'}`)
  console.log()
  console.log('You can now run:')
  console.log('  powerplant run <project-path> "<task>"')
}
