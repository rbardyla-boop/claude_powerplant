import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getPowerplantHome } from '../../config/powerplant-home.js'
import { loadState, saveState } from '../../platform/managed-agent-state.js'
import type { CloudSmokeState } from '../../platform/managed-agent-state.js'
import { loadSprint4aState, saveSprint4aState, Sprint4aStateSchema } from '../../platform/sprint4a-state.js'
import type { Sprint4aState } from '../../platform/sprint4a-state.js'
import {
  loadOperatorState,
  saveOperatorState,
  looksLikeProductionId,
  isStatePlausible,
  quarantineOperatorState,
  quarantineLegacyFile,
  operatorStatePath,
} from '../../platform/operator-state.js'
import type { OperatorState } from '../../platform/operator-state.js'
import { ensureCloudEnvironment } from '../../provision/ensure-cloud-environment.js'
import { ensureSprint4aAgent } from '../../provision/ensure-sprint4a-agent.js'

const REQUIRED_TOOL_SCHEMA_VERSION = 2

// ── Legacy paths ──────────────────────────────────────────────────────────────

function legacyStateDir(): string {
  const __filename = fileURLToPath(import.meta.url)
  const pkgRoot = path.resolve(path.dirname(__filename), '..', '..', '..')
  return path.join(pkgRoot, '.powerplant', 'state')
}

function tryLoadLegacySmokeState(): CloudSmokeState | null {
  const fp = path.join(legacyStateDir(), 'cloud-smoke.json')
  if (!fs.existsSync(fp)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'))
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

// ── User-level legacy state (old sprint4a-pilot.json at POWERPLANT_HOME) ──────

function userLevelSprint4aPath(): string {
  return path.join(getPowerplantHome(), 'state', 'sprint4a-pilot.json')
}

function userLevelSmokePath(): string {
  return path.join(getPowerplantHome(), 'state', 'cloud-smoke.json')
}

/**
 * Check if the user-level sprint4a-pilot.json contains mock/invalid IDs and
 * quarantine it if so. Returns true if quarantine happened.
 */
function quarantineInvalidUserLevelState(): boolean {
  const s4aPath = userLevelSprint4aPath()
  if (!fs.existsSync(s4aPath)) return false
  try {
    const raw = JSON.parse(fs.readFileSync(s4aPath, 'utf-8'))
    const agentId: unknown = raw?.agent?.id
    const envId: unknown = raw?.environmentId
    const agentInvalid = typeof agentId !== 'string' || !looksLikeProductionId(agentId)
    const envInvalid = typeof envId !== 'string' || !looksLikeProductionId(envId)
    if (agentInvalid || envInvalid) {
      const reason = agentInvalid
        ? `agent.id "${agentId}" does not match Anthropic production ID format`
        : `environmentId "${envId}" does not match Anthropic production ID format`
      console.log(`Quarantining invalid state: ${reason}`)
      quarantineLegacyFile(s4aPath, reason)
      return true
    }
    return false
  } catch {
    return false
  }
}

// ── API validation ────────────────────────────────────────────────────────────

async function validateAgentExists(client: Anthropic, agentId: string): Promise<boolean> {
  try {
    const agents = await client.beta.agents.list()
    for await (const agent of agents) {
      if (agent.id === agentId) return true
    }
    return false
  } catch {
    return false
  }
}

async function validateEnvironmentExists(client: Anthropic, envId: string): Promise<boolean> {
  try {
    const envs = await client.beta.environments.list()
    for await (const env of envs) {
      if (env.id === envId) return true
    }
    return false
  } catch {
    return false
  }
}

// ── Credential check ──────────────────────────────────────────────────────────

function requireApiKey(): string {
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
  return apiKey
}

// ── Setup command ─────────────────────────────────────────────────────────────

export async function cmdSetup(repair = false): Promise<void> {
  // ── Step 0. Quarantine any user-level mock/invalid state first ────────────

  const wasQuarantined = quarantineInvalidUserLevelState()
  if (wasQuarantined) {
    console.log('Invalid state quarantined. Proceeding with setup...')
    console.log()
  }

  // ── Step 1. Check new unified operator state ───────────────────────────────

  const existing = loadOperatorState()

  if (existing !== null && isStatePlausible(existing)) {
    if (!repair) {
      // State looks production-like; report status
      console.log('Powerplant runtime is configured.')
      if (existing.validatedAt !== null) {
        console.log('Runtime state: VALIDATED')
      } else {
        console.log('Runtime state: NOT YET VALIDATED (run: powerplant setup --repair)')
      }
      console.log()
      console.log(`Home:         ${getPowerplantHome()}`)
      console.log(`Environment:  ${existing.environment.id}`)
      console.log(`Agent:        ${existing.agent.id}`)
      console.log(`Purpose:      ${existing.resourcePurpose}`)
      console.log()
      console.log('You can now run:')
      console.log('  powerplant run <project-path> "<task>"')
      return
    }

    // --repair: validate via API
    console.log('Validating existing runtime state against live resources...')
    const apiKey = requireApiKey()
    const client = new Anthropic({ apiKey })

    const agentOk = await validateAgentExists(client, existing.agent.id)
    const envOk = await validateEnvironmentExists(client, existing.environment.id)

    if (agentOk && envOk) {
      const validated: OperatorState = {
        ...existing,
        validatedAt: new Date().toISOString(),
      }
      saveOperatorState(validated)
      console.log('Runtime state validated successfully.')
      console.log()
      console.log(`Home:        ${getPowerplantHome()}`)
      console.log(`Environment: ${existing.environment.id}`)
      console.log(`Agent:       ${existing.agent.id}`)
      console.log()
      console.log('You can now run:')
      console.log('  powerplant run <project-path> "<task>"')
      return
    }

    // Resources not found → quarantine and re-provision
    console.log(`Agent found: ${agentOk ? 'YES' : 'NO'}`)
    console.log(`Environment found: ${envOk ? 'YES' : 'NO'}`)
    console.log('Quarantining unvalidatable state...')
    quarantineOperatorState('Live API validation failed: resources not found')
    console.log()
  }

  // ── Step 2. Check legacy user-level state (cloud-smoke.json) ─────────────

  // The sprint4a-pilot.json was quarantined above if invalid.
  // Check cloud-smoke for a valid environment ID, and the legacy package dir
  // for a valid sprint4a agent.
  const smokeState = loadState() // reads ~/.powerplant/state/cloud-smoke.json
  const legacySprint4a = tryLoadLegacySprint4aState() // reads from pkg dir

  if (
    smokeState?.environment?.id &&
    looksLikeProductionId(smokeState.environment.id) &&
    legacySprint4a?.agent?.id &&
    looksLikeProductionId(legacySprint4a.agent.id)
  ) {
    if (!repair) {
      // Migrate non-secret identifiers without API call
      const operatorState: OperatorState = {
        schemaVersion: 1,
        resourcePurpose: 'project-operator',
        agent: {
          id: legacySprint4a.agent.id,
          version: legacySprint4a.agent.version,
          name: legacySprint4a.agent.name,
        },
        environment: {
          id: smokeState.environment.id,
          name: smokeState.environment.name,
        },
        toolSchemaVersion: REQUIRED_TOOL_SCHEMA_VERSION,
        createdAt: legacySprint4a.createdAt,
        validatedAt: null, // not yet validated via API
      }
      saveOperatorState(operatorState)

      // Also update the legacy files so ensureSprint4aAgent still works
      saveSprint4aState({
        environmentId: smokeState.environment.id,
        agent: legacySprint4a.agent,
        toolSchemaVersion: REQUIRED_TOOL_SCHEMA_VERSION,
        createdAt: legacySprint4a.createdAt,
      })

      console.log('Runtime state migrated from legacy location.')
      console.log('For live validation run: powerplant setup --repair')
      console.log()
      console.log(`Home:        ${getPowerplantHome()}`)
      console.log(`Environment: ${smokeState.environment.id}`)
      console.log(`Agent:       ${legacySprint4a.agent.id}`)
      console.log(`Purpose:     project-operator`)
      console.log()
      console.log('You can now run:')
      console.log('  powerplant run <project-path> "<task>"')
      return
    }

    // --repair: validate migrated state via API
    console.log('Validating legacy resources against live API...')
    const apiKey = requireApiKey()
    const client = new Anthropic({ apiKey })

    const agentOk = await validateAgentExists(client, legacySprint4a.agent.id)
    const envOk = await validateEnvironmentExists(client, smokeState.environment.id)

    if (!agentOk || !envOk) {
      console.log(`Agent found: ${agentOk ? 'YES' : 'NO'}`)
      console.log(`Environment found: ${envOk ? 'YES' : 'NO'}`)
      console.log()
      console.log('Legacy resources could not be validated. Provisioning new resources...')
    } else {
      const operatorState: OperatorState = {
        schemaVersion: 1,
        resourcePurpose: 'project-operator',
        agent: {
          id: legacySprint4a.agent.id,
          version: legacySprint4a.agent.version,
          name: legacySprint4a.agent.name,
        },
        environment: {
          id: smokeState.environment.id,
          name: smokeState.environment.name,
        },
        toolSchemaVersion: REQUIRED_TOOL_SCHEMA_VERSION,
        createdAt: legacySprint4a.createdAt,
        validatedAt: new Date().toISOString(),
      }
      saveOperatorState(operatorState)
      saveSprint4aState({
        environmentId: smokeState.environment.id,
        agent: legacySprint4a.agent,
        toolSchemaVersion: REQUIRED_TOOL_SCHEMA_VERSION,
        createdAt: legacySprint4a.createdAt,
      })

      console.log('Legacy resources validated and migrated.')
      console.log()
      console.log(`Home:        ${getPowerplantHome()}`)
      console.log(`Environment: ${smokeState.environment.id}`)
      console.log(`Agent:       ${legacySprint4a.agent.id}`)
      console.log()
      console.log('You can now run:')
      console.log('  powerplant run <project-path> "<task>"')
      return
    }
  }

  // ── Step 3. Provision fresh resources (requires credentials) ─────────────

  const apiKey = requireApiKey()
  const client = new Anthropic({ apiKey })

  console.log('Provisioning Powerplant runtime resources...')
  console.log()

  let envResult
  try {
    envResult = await ensureCloudEnvironment(client)
  } catch (err) {
    console.error(`Error creating environment: ${String(err)}`)
    process.exit(1)
  }

  let agentState: Sprint4aState
  try {
    // Pass env ID directly so ensureSprint4aAgent does not need cloud-smoke.json yet
    agentState = await ensureSprint4aAgent(client, envResult.environment.id)
  } catch (err) {
    console.error(`Error provisioning agent: ${String(err)}`)
    process.exit(1)
  }

  // Save cloud-smoke only after both resources are confirmed (avoids invalid partial state)
  saveState({
    agent: agentState.agent ?? { id: '', version: 0, name: '' },
    environment: envResult.environment,
    createdAt: new Date().toISOString(),
  })

  if (!agentState.agent) {
    console.error('Error: Agent provisioning did not return a valid agent.')
    process.exit(1)
  }

  const newState: OperatorState = {
    schemaVersion: 1,
    resourcePurpose: 'project-operator',
    agent: {
      id: agentState.agent.id,
      version: agentState.agent.version,
      name: agentState.agent.name,
    },
    environment: {
      id: agentState.environmentId,
      name: envResult.environment.name,
    },
    toolSchemaVersion: REQUIRED_TOOL_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    validatedAt: new Date().toISOString(), // provisioned now = implicitly validated
  }
  saveOperatorState(newState)

  console.log()
  console.log('Powerplant runtime provisioned and validated.')
  console.log()
  console.log(`Home:        ${getPowerplantHome()}`)
  console.log(`Environment: ${agentState.environmentId}`)
  console.log(`Agent:       ${agentState.agent.id}`)
  console.log()
  console.log('You can now run:')
  console.log('  powerplant run <project-path> "<task>"')
}
