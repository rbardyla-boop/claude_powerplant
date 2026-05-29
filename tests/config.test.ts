import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateEnv } from '../src/config/env.js'
import { resolveSprint4aPilotSourcePath } from '../src/config/constants.js'

describe('validateEnv', () => {
  let savedEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    savedEnv = { ...process.env }
    delete process.env['ANTHROPIC_API_KEY']
    delete process.env['NODE_ENV']
    delete process.env['CLAUDE_POWERPLANT_MAX_TURNS']
  })

  afterEach(() => {
    process.env = savedEnv
  })

  it('throws when ANTHROPIC_API_KEY is absent', () => {
    expect(() => validateEnv()).toThrow('ANTHROPIC_API_KEY is required')
  })

  it('throws when ANTHROPIC_API_KEY is empty string', () => {
    process.env['ANTHROPIC_API_KEY'] = ''
    expect(() => validateEnv()).toThrow('ANTHROPIC_API_KEY is required')
  })

  it('returns parsed env when required vars are present', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test-key'
    const env = validateEnv()
    expect(env.ANTHROPIC_API_KEY).toBe('sk-test-key')
  })

  it('CLAUDE_POWERPLANT_MAX_TURNS defaults to 10 when not set', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test-key'
    const env = validateEnv()
    expect(env.CLAUDE_POWERPLANT_MAX_TURNS).toBe(10)
  })

  it('NODE_ENV defaults to development when not set', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test-key'
    const env = validateEnv()
    expect(env.NODE_ENV).toBe('development')
  })
})

describe('resolveSprint4aPilotSourcePath', () => {
  let savedPath: string | undefined

  beforeEach(() => {
    savedPath = process.env['SPRINT4A_PILOT_SOURCE_PATH']
  })

  afterEach(() => {
    if (savedPath !== undefined) {
      process.env['SPRINT4A_PILOT_SOURCE_PATH'] = savedPath
    } else {
      delete process.env['SPRINT4A_PILOT_SOURCE_PATH']
    }
  })

  it('throws before any filesystem operation when env var is absent', () => {
    delete process.env['SPRINT4A_PILOT_SOURCE_PATH']
    expect(() => resolveSprint4aPilotSourcePath()).toThrow('SPRINT4A_PILOT_SOURCE_PATH is not set')
  })

  it('throws before any filesystem operation when env var is empty string', () => {
    process.env['SPRINT4A_PILOT_SOURCE_PATH'] = ''
    expect(() => resolveSprint4aPilotSourcePath()).toThrow('SPRINT4A_PILOT_SOURCE_PATH is not set')
  })

  it('returns the configured path when env var is set', () => {
    process.env['SPRINT4A_PILOT_SOURCE_PATH'] = '/configured/pilot/path'
    expect(resolveSprint4aPilotSourcePath()).toBe('/configured/pilot/path')
  })
})
