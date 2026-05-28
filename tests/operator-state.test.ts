import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  looksLikeProductionId,
  isStatePlausible,
  isStateValidated,
  loadOperatorState,
  saveOperatorState,
  quarantineOperatorState,
  quarantineLegacyFile,
  operatorStatePath,
  quarantineDir,
} from '../src/platform/operator-state.js'
import { POWERPLANT_HOME_ENV } from '../src/config/powerplant-home.js'
import type { OperatorState } from '../src/platform/operator-state.js'

const PROD_AGENT_ID = 'agent_01TwEqQhAxjicW3jmcyS7cPq'
const PROD_ENV_ID = 'env_01RVPv347xgnbujjXFj721Uv'

function makeValidState(overrides: Partial<OperatorState> = {}): OperatorState {
  return {
    schemaVersion: 1,
    resourcePurpose: 'project-operator',
    agent: { id: PROD_AGENT_ID, version: 1, name: 'Test Agent' },
    environment: { id: PROD_ENV_ID, name: 'test-env' },
    toolSchemaVersion: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    validatedAt: null,
    ...overrides,
  }
}

// ── looksLikeProductionId ─────────────────────────────────────────────────────

describe('looksLikeProductionId', () => {
  // Test 1: real production IDs pass
  it('accepts real Anthropic agent ID format', () => {
    expect(looksLikeProductionId(PROD_AGENT_ID)).toBe(true)
  })

  // Test 2: real env ID passes
  it('accepts real Anthropic environment ID format', () => {
    expect(looksLikeProductionId(PROD_ENV_ID)).toBe(true)
  })

  // Test 3: mock IDs are rejected
  it('rejects short mock IDs (agent-test, env-test)', () => {
    expect(looksLikeProductionId('agent-test')).toBe(false)
    expect(looksLikeProductionId('env-test')).toBe(false)
    expect(looksLikeProductionId('agent_test')).toBe(false)
    expect(looksLikeProductionId('my-agent')).toBe(false)
  })

  // Test 4: empty string rejected
  it('rejects empty string', () => {
    expect(looksLikeProductionId('')).toBe(false)
  })
})

// ── isStatePlausible / isStateValidated ───────────────────────────────────────

describe('isStatePlausible', () => {
  // Test 5: plausible when both IDs look real
  it('returns true when both agent and environment IDs are production-like', () => {
    expect(isStatePlausible(makeValidState())).toBe(true)
  })

  // Test 6: implausible when agent ID is mock
  it('returns false when agent ID is a mock value', () => {
    const state = makeValidState({ agent: { id: 'agent-test', version: 1, name: 'x' } })
    expect(isStatePlausible(state)).toBe(false)
  })

  // Test 7: implausible when environment ID is mock
  it('returns false when environment ID is a mock value', () => {
    const state = makeValidState({ environment: { id: 'env-test', name: 'x' } })
    expect(isStatePlausible(state)).toBe(false)
  })
})

describe('isStateValidated', () => {
  // Test 8: validated when plausible and validatedAt is set
  it('returns true when state is plausible and validatedAt is non-null', () => {
    const state = makeValidState({ validatedAt: '2026-01-01T00:00:00.000Z' })
    expect(isStateValidated(state)).toBe(true)
  })

  // Test 9: not validated when validatedAt is null
  it('returns false when validatedAt is null even if IDs look real', () => {
    const state = makeValidState({ validatedAt: null })
    expect(isStateValidated(state)).toBe(false)
  })
})

// ── loadOperatorState / saveOperatorState ─────────────────────────────────────

describe('loadOperatorState / saveOperatorState', () => {
  let tmpHome: string
  let savedHome: string | undefined

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-opstate-'))
    savedHome = process.env[POWERPLANT_HOME_ENV]
    process.env[POWERPLANT_HOME_ENV] = tmpHome
  })

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true })
    if (savedHome !== undefined) {
      process.env[POWERPLANT_HOME_ENV] = savedHome
    } else {
      delete process.env[POWERPLANT_HOME_ENV]
    }
  })

  // Test 10: returns null when file absent
  it('returns null when state file does not exist', () => {
    expect(loadOperatorState()).toBeNull()
  })

  // Test 11: round-trip save/load
  it('saves and loads state correctly', () => {
    const state = makeValidState()
    saveOperatorState(state)
    const loaded = loadOperatorState()
    expect(loaded).not.toBeNull()
    expect(loaded?.agent.id).toBe(PROD_AGENT_ID)
    expect(loaded?.environment.id).toBe(PROD_ENV_ID)
    expect(loaded?.resourcePurpose).toBe('project-operator')
    expect(loaded?.validatedAt).toBeNull()
  })

  // Test 12: returns null for invalid schema
  it('returns null when file contains invalid schema', () => {
    const fp = operatorStatePath()
    fs.mkdirSync(path.dirname(fp), { recursive: true })
    fs.writeFileSync(fp, JSON.stringify({ bad: 'data' }), 'utf-8')
    expect(loadOperatorState()).toBeNull()
  })
})

// ── quarantineOperatorState ───────────────────────────────────────────────────

describe('quarantineOperatorState', () => {
  let tmpHome: string
  let savedHome: string | undefined

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-quar-opstate-'))
    savedHome = process.env[POWERPLANT_HOME_ENV]
    process.env[POWERPLANT_HOME_ENV] = tmpHome
  })

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true })
    if (savedHome !== undefined) {
      process.env[POWERPLANT_HOME_ENV] = savedHome
    } else {
      delete process.env[POWERPLANT_HOME_ENV]
    }
  })

  // Test 13: quarantine removes original and creates record
  it('moves state to quarantine dir and removes original file', () => {
    const state = makeValidState()
    saveOperatorState(state)
    const fp = operatorStatePath()
    expect(fs.existsSync(fp)).toBe(true)

    const result = quarantineOperatorState('test quarantine reason')
    expect(result).toBe(true)
    expect(fs.existsSync(fp)).toBe(false)

    const qDir = quarantineDir()
    const entries = fs.readdirSync(qDir, { recursive: true, withFileTypes: true })
    const recordFile = entries.find(e => e.isFile() && e.name === 'quarantine-record.json')
    expect(recordFile).toBeDefined()
  })

  // Test 14: quarantine record contains reason and original path
  it('quarantine record stores reason and originalPath', () => {
    const state = makeValidState()
    saveOperatorState(state)
    const fp = operatorStatePath()
    quarantineOperatorState('mock IDs detected')

    const qDir = quarantineDir()
    let recordContent = ''
    function findRecord(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) findRecord(full)
        else if (entry.name === 'quarantine-record.json') {
          recordContent = fs.readFileSync(full, 'utf-8')
        }
      }
    }
    findRecord(qDir)

    const record = JSON.parse(recordContent)
    expect(record.reason).toBe('mock IDs detected')
    expect(record.originalPath).toBe(fp)
    expect(record.quarantinedAt).toBeTruthy()
  })
})

// ── quarantineLegacyFile ──────────────────────────────────────────────────────

describe('quarantineLegacyFile', () => {
  let tmpHome: string
  let savedHome: string | undefined

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-quar-legacy-'))
    savedHome = process.env[POWERPLANT_HOME_ENV]
    process.env[POWERPLANT_HOME_ENV] = tmpHome
  })

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true })
    if (savedHome !== undefined) {
      process.env[POWERPLANT_HOME_ENV] = savedHome
    } else {
      delete process.env[POWERPLANT_HOME_ENV]
    }
  })

  it('returns false when target file does not exist', () => {
    const missingPath = path.join(tmpHome, 'state', 'sprint4a-pilot.json')
    expect(quarantineLegacyFile(missingPath, 'reason')).toBe(false)
  })

  it('removes legacy file and creates quarantine record with correct basename', () => {
    const stateDir = path.join(tmpHome, 'state')
    fs.mkdirSync(stateDir, { recursive: true })
    const legacyPath = path.join(stateDir, 'sprint4a-pilot.json')
    fs.writeFileSync(legacyPath, JSON.stringify({ agent: { id: 'agent-test' } }), 'utf-8')

    const result = quarantineLegacyFile(legacyPath, 'mock agent ID')
    expect(result).toBe(true)
    expect(fs.existsSync(legacyPath)).toBe(false)

    const qDir = quarantineDir()
    let found = false
    function check(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) check(full)
        else if (entry.name === 'quarantine-record.json') {
          const rec = JSON.parse(fs.readFileSync(full, 'utf-8'))
          expect(rec.reason).toBe('mock agent ID')
          found = true
        }
      }
    }
    check(qDir)
    expect(found).toBe(true)
  })
})
