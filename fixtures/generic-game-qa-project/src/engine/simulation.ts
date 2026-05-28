/** Simple deterministic simulation engine (fixture — not production code) */

export interface SimulationState {
  tick: number
  health: number
  score: number
}

export function createInitialState(): SimulationState {
  return { tick: 0, health: 100, score: 0 }
}

export function advanceTick(state: SimulationState): SimulationState {
  return { ...state, tick: state.tick + 1 }
}

export function applyDamage(state: SimulationState, amount: number): SimulationState {
  const health = Math.max(0, state.health - amount)
  return { ...state, health }
}

export function addScore(state: SimulationState, points: number): SimulationState {
  return { ...state, score: state.score + points }
}

export function isAlive(state: SimulationState): boolean {
  return state.health > 0
}
