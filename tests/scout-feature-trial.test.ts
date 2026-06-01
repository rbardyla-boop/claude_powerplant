/**
 * Tests for the Feature Lab trial record (FEATURE_TRIAL.json).
 *
 * The trial record links a scout candidate to the run it drives. It is evidence
 * only: it grants no writes, changes no candidate status, and approves nothing.
 * The safety-critical invariant under test is that `verificationCoverage` and
 * `scopeCeiling` are derived from the LIVE contract — an untrusted (hand-edited
 * or malicious) candidate cannot inject a misleading coverage strength or widen
 * the recorded ceiling.
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  normalizeCandidate,
  type ProposedCandidate,
  type ScoutCandidate,
} from '../src/scout/scout-candidate.js'
import {
  buildFeatureTrial,
  writeFeatureTrialArtifact,
  FeatureTrialSchema,
  FEATURE_TRIAL_CLAIM,
} from '../src/scout/feature-trial.js'

// A minimal contract slice: a hermetic required check that covers the test tree,
// plus an advisory grep that covers nothing.
const contract: { allowedWritePaths: string[]; allowedChecks: Record<string, { command: string; required: boolean }> } = {
  allowedWritePaths: ['tests/**', 'docs/NOTES.md'],
  allowedChecks: {
    'py-compile': { command: 'python -m compileall tests', required: true },
    'grep-only': { command: 'grep TODO tests/x.py', required: false },
  },
}

const proposed: ProposedCandidate = {
  id: 'scout-001',
  title: 'Add a focused test for path dedup',
  domain: 'test-gap',
  whyItMatters: 'PathConfig.path_cards() dedup is untested.',
  repoEvidence: ['tests/ directory exists', 'no test references path_cards'],
  risk: 'LOW',
  expectedFiles: ['tests/test_path_config.py'],
  verification: ['py-compile'],
  nonGoals: ['Do not change product modules', 'Do not touch config files'],
}

// A real, normalized candidate (status RECOMMENDED, verificationCoverage set by
// scout against the same contract → its coverage should equal a recompute).
const candidate: ScoutCandidate = normalizeCandidate(proposed, contract)

describe('buildFeatureTrial — content & traceability', () => {
  it('produces a schema-valid FEATURE_TRIAL.json that the writer persists', () => {
    const trial = buildFeatureTrial(candidate, contract, { createdAt: '2026-06-01T00:00:00.000Z' })
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-trial-'))
    try {
      const written = writeFeatureTrialArtifact(dir, trial)
      expect(path.basename(written)).toBe('FEATURE_TRIAL.json')
      expect(fs.existsSync(written)).toBe(true)

      const parsed = JSON.parse(fs.readFileSync(written, 'utf-8'))
      expect(() => FeatureTrialSchema.parse(parsed)).not.toThrow()
      expect(parsed.claim).toBe(FEATURE_TRIAL_CLAIM)
      expect(parsed.candidateId).toBe('scout-001')
      expect(parsed.source).toBe('scout')
      expect(parsed.createdAt).toBe('2026-06-01T00:00:00.000Z')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('records expectedFiles matching the candidate (own copy, not shared)', () => {
    const trial = buildFeatureTrial(candidate, contract)
    expect(trial.expectedFiles).toEqual(candidate.expectedFiles)
    expect(trial.expectedFiles).not.toBe(candidate.expectedFiles) // no shared mutable ref
  })

  it('preserves the candidate non-goals (own copy)', () => {
    const trial = buildFeatureTrial(candidate, contract)
    expect(trial.nonGoals).toEqual(candidate.nonGoals)
    expect(trial.nonGoals).not.toBe(candidate.nonGoals)
  })

  it('preserves verification coverage on the normal path (recompute == scout value)', () => {
    const trial = buildFeatureTrial(candidate, contract)
    // scout normalized the same candidate against the same contract.
    expect(candidate.verificationCoverage?.strength).toBe('strong')
    expect(trial.verificationCoverage.strength).toBe('strong')
    expect(trial.verificationCoverage).toEqual(candidate.verificationCoverage)
  })
})

describe('buildFeatureTrial — untrusted candidate cannot widen scope', () => {
  it('recomputes coverage from the live contract, overriding a lying candidate claim', () => {
    const lying: ScoutCandidate = {
      ...candidate,
      // points at an advisory check that covers nothing, but claims "strong".
      verification: ['grep-only'],
      verificationCoverage: { strength: 'strong', reason: 'trust me' },
    }
    const trial = buildFeatureTrial(lying, contract)
    // The advisory grep is recomputed honestly — the false "strong" is dropped.
    expect(trial.verificationCoverage.strength).toBe('advisory-only')
    expect(trial.verificationCoverage.strength).not.toBe('strong')
  })

  it('takes scopeCeiling from the contract, never from the candidate', () => {
    // A candidate cannot carry a scopeCeiling field; even adjacent tampering
    // (extra expectedFiles) must not change the recorded ceiling.
    const tampered = { ...candidate, expectedFiles: ['tests/a.py', 'tests/b.py'] }
    const trial = buildFeatureTrial(tampered, contract)
    expect(trial.scopeCeiling).toEqual(contract.allowedWritePaths)
    expect(trial.scopeCeiling).not.toBe(contract.allowedWritePaths) // own copy
  })
})

describe('buildFeatureTrial — missing fields normalize safely', () => {
  it('fills verificationCoverage when the candidate has none', () => {
    const noCoverage: ScoutCandidate = { ...candidate, verificationCoverage: undefined }
    const trial = buildFeatureTrial(noCoverage, contract)
    expect(trial.verificationCoverage).toBeDefined()
    expect(trial.verificationCoverage.strength).toBe('strong') // recomputed from py-compile
    expect(() => FeatureTrialSchema.parse(trial)).not.toThrow()
  })

  it('accepts an empty non-goals list and still validates', () => {
    const noGoals: ScoutCandidate = { ...candidate, nonGoals: [] }
    const trial = buildFeatureTrial(noGoals, contract)
    expect(trial.nonGoals).toEqual([])
    expect(() => FeatureTrialSchema.parse(trial)).not.toThrow()
  })

  it('rejects a record whose claim has been altered (claim is a fixed literal)', () => {
    const trial = buildFeatureTrial(candidate, contract)
    const tampered = { ...trial, claim: 'APPROVED' }
    expect(() => FeatureTrialSchema.parse(tampered)).toThrow()
  })
})
