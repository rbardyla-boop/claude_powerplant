import { describe, expect, it } from 'vitest'
import { getStatus, VERSION } from '../src/status.js'

describe('status', () => {
  it('getStatus returns ok', () => {
    expect(getStatus()).toBe('ok')
  })

  it('VERSION is 0.0.1', () => {
    expect(VERSION).toBe('0.0.1')
  })
})
