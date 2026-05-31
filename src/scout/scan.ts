import fs from 'fs'
import path from 'path'
import { buildPilotSnapshot } from '../projects/build-pilot-snapshot.js'
import { detectStack } from '../projects/detect-stack.js'
import type { LoadedProjectContract } from '../projects/load-project-contract.js'
import type { CandidateSource, ScoutBundle, ScoutBundleFile } from './candidate-source.js'
import { DeterministicSource } from './deterministic-source.js'
import { ProposedCandidateSchema, normalizeCandidate, type ScoutCandidate } from './scout-candidate.js'

// Scout builds its bundle under /tmp, the same base the run command uses, and
// deletes it when done. Scout never writes into the project's source tree
// except the advisory .scout/ output (written by the command layer).
const SCOUT_TMP_BASE = '/tmp/powerplant-scout'
const MAX_FILE_BYTES = 256 * 1024
const MAX_CANDIDATES = 25

export interface ScoutReport {
  projectId: string
  stack: string
  generatedAt: string
  /** Provenance: which sources produced this report. */
  sourceIds: string[]
  /** How many sanitized files were reasoned over. */
  bundleFileCount: number
  candidates: ScoutCandidate[]
}

/** Read the text files from a sanitized baseline. Binary and oversized files are skipped. */
function readSanitizedFiles(baselinePath: string): ScoutBundleFile[] {
  const files: ScoutBundleFile[] = []
  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir)) {
      const abs = path.join(dir, entry)
      const stat = fs.lstatSync(abs)
      if (stat.isSymbolicLink()) continue
      if (stat.isDirectory()) {
        walk(abs)
        continue
      }
      if (stat.size > MAX_FILE_BYTES) continue
      let content: string
      try {
        content = fs.readFileSync(abs, 'utf-8')
      } catch {
        continue
      }
      if (content.includes('\0')) continue // skip binary
      files.push({ relativePath: path.relative(baselinePath, abs).replace(/\\/g, '/'), content })
    }
  }
  walk(baselinePath)
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

/**
 * Scan a project for affordance candidates.
 *
 * Builds the SAME sanitized snapshot the agent would see, hands it to each
 * candidate source, then normalizes every proposal against the contract so no
 * candidate can claim a verdict it has not earned. Read-only: never mutates the
 * project source. The temp snapshot is always cleaned up.
 */
export function scanProject(
  contract: LoadedProjectContract,
  sources: CandidateSource[] = [new DeterministicSource()],
): ScoutReport {
  const runDir = path.join(SCOUT_TMP_BASE, `scout-${Date.now()}`)
  fs.mkdirSync(runDir, { recursive: true })
  try {
    const snapshot = buildPilotSnapshot(contract, runDir)
    const files = readSanitizedFiles(snapshot.baselinePath)
    const stack = detectStack(contract.sourcePath)
    const bundle: ScoutBundle = { projectId: contract.projectId, stack, files, contract }

    const candidates: ScoutCandidate[] = []
    for (const source of sources) {
      for (const raw of source.discover(bundle)) {
        // Source output is untrusted (especially future LLM sources): validate,
        // then re-id sequentially so two sources cannot collide on an id.
        const parsed = ProposedCandidateSchema.safeParse(raw)
        if (!parsed.success) continue
        const normalized = normalizeCandidate(parsed.data, contract)
        candidates.push({ ...normalized, id: `scout-${String(candidates.length + 1).padStart(3, '0')}` })
        if (candidates.length >= MAX_CANDIDATES) break
      }
      if (candidates.length >= MAX_CANDIDATES) break
    }

    return {
      projectId: contract.projectId,
      stack,
      generatedAt: new Date().toISOString(),
      sourceIds: sources.map(s => s.id),
      bundleFileCount: files.length,
      candidates,
    }
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true })
  }
}
