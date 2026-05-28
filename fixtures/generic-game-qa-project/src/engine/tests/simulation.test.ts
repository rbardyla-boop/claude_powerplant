import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createInitialState,
  advanceTick,
  applyDamage,
  addScore,
  isAlive,
} from '../simulation.js'

describe('simulation engine', () => {
  it('creates initial state', () => {
    const s = createInitialState()
    assert.equal(s.tick, 0)
    assert.equal(s.health, 100)
    assert.equal(s.score, 0)
  })

  it('advances tick', () => {
    const s = advanceTick(createInitialState())
    assert.equal(s.tick, 1)
  })

  it('applies damage without mutating input', () => {
    const before = createInitialState()
    const after = applyDamage(before, 30)
    assert.equal(before.health, 100)
    assert.equal(after.health, 70)
  })

  it('clamps health to zero', () => {
    const s = applyDamage(createInitialState(), 999)
    assert.equal(s.health, 0)
  })

  it('adds score without mutating input', () => {
    const before = createInitialState()
    const after = addScore(before, 50)
    assert.equal(before.score, 0)
    assert.equal(after.score, 50)
  })

  it('isAlive returns false at zero health', () => {
    const s = applyDamage(createInitialState(), 100)
    assert.equal(isAlive(s), false)
  })

  it('isAlive returns true above zero health', () => {
    assert.equal(isAlive(createInitialState()), true)
  })
})
