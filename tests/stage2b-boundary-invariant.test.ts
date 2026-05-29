import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// ── Stage 2B import-graph boundary invariants ─────────────────────────────────
//
// These tests prove that the standard sanitized-project pilot execution path
// (npm run smoke:pilot:project) has no import-graph edge to Stage 2B
// skill-guided code.
//
// Authority: docs/architecture/RC6A_REPLAY_STOP_AND_SCOPE_CORRECTION.md §5

const SRC = path.resolve('src')

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(SRC, relPath), 'utf-8')
}

// Symbols that belong exclusively to the Stage 2B skill-guided path
const STAGE_2B_MARKERS = [
  'run-skill-guided-sanitized-project-pilot',
  'runSkillGuidedSanitizedProjectPilot',
  'SkillGuidedInvocationRequest',
  'SkillGuidedRunReport',
  'SkillGuidedInvocationError',
]

// Stage 2B skill-machinery symbols (skill-lifecycle, skill-envelope, skill-invocation-audit)
const SKILL_GUIDED_MACHINERY = [
  'skill-lifecycle',
  'skill-envelope',
  'skill-invocation-audit',
  'listSkills',
  'renderPromptEnvelope',
  'appendPhaseARecord',
  'appendPhaseBRecord',
]

describe('Stage 2B boundary invariant: standard pilot CLI entry point', () => {
  const src = readSource('../src/cli/sprint4a-sanitized-project-pilot.ts')

  for (const marker of STAGE_2B_MARKERS) {
    it(`does not reference Stage 2B symbol: ${marker}`, () => {
      expect(src).not.toContain(marker)
    })
  }

  for (const marker of SKILL_GUIDED_MACHINERY) {
    it(`does not reference skill-guided machinery: ${marker}`, () => {
      expect(src).not.toContain(marker)
    })
  }
})

describe('Stage 2B boundary invariant: run-sanitized-project-pilot.ts', () => {
  const src = readSource('sessions/run-sanitized-project-pilot.ts')

  for (const marker of STAGE_2B_MARKERS) {
    it(`does not import or reference Stage 2B symbol: ${marker}`, () => {
      expect(src).not.toContain(marker)
    })
  }

  for (const marker of SKILL_GUIDED_MACHINERY) {
    it(`does not import skill-guided machinery: ${marker}`, () => {
      expect(src).not.toContain(marker)
    })
  }

  it('all from-paths are non-skill-guided modules', () => {
    // Extract the quoted paths from every `from '...'` or `from "..."` in the file
    const fromPaths = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1])

    const disallowedFragments = [
      'skill-lifecycle',
      'skill-envelope',
      'skill-invocation-audit',
      'skill-paths',
      'skill-guided',
    ]

    for (const fromPath of fromPaths) {
      for (const fragment of disallowedFragments) {
        expect(
          fromPath,
          `run-sanitized-project-pilot.ts must not import from "${fromPath}" (contains disallowed fragment "${fragment}")`
        ).not.toContain(fragment)
      }
    }
  })
})

describe('Stage 2B boundary invariant: ensure-sprint4a-agent.ts', () => {
  const agentPath = path.join(SRC, 'provision/ensure-sprint4a-agent.ts')
  const src = fs.existsSync(agentPath) ? fs.readFileSync(agentPath, 'utf-8') : ''

  it('does not import Stage 2B skill-guided runner', () => {
    expect(src).not.toContain('run-skill-guided-sanitized-project-pilot')
    expect(src).not.toContain('runSkillGuidedSanitizedProjectPilot')
  })
})
