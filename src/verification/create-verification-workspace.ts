import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { buildSanitizedWorkspace } from '../projects/build-sanitized-workspace.js'
import { validateSanitizedWorkspace } from '../projects/validate-sanitized-workspace.js'
import type { LoadedProjectContract } from '../projects/load-project-contract.js'

export interface SourceManifestEntry {
  relativePath: string
  sha256: string
}

export interface VerificationWorkspace {
  workspacePath: string
  sourceManifest: {
    sourcePath: string
    files: SourceManifestEntry[]
  }
  cleanup: () => void
}

/**
 * Build a disposable sanitized workspace for running approved checks.
 *
 * The original project is never mounted into the returned workspace —
 * only the files matched by includePaths are copied to a fresh temp dir.
 * Throws with a 'FAIL_BOUNDARY:' prefix if workspace validation fails.
 */
export function createVerificationWorkspace(
  contract: LoadedProjectContract,
): VerificationWorkspace {
  const workspacePath = fs.mkdtempSync(
    path.join(os.tmpdir(), `pp-verify-${contract.projectId}-`),
  )

  let workspace
  try {
    workspace = buildSanitizedWorkspace(contract, workspacePath)
  } catch (err) {
    fs.rmSync(workspacePath, { recursive: true, force: true })
    throw new Error(`Workspace build failed: ${String(err)}`)
  }

  const validation = validateSanitizedWorkspace(workspacePath, contract)
  if (!validation.passed) {
    fs.rmSync(workspacePath, { recursive: true, force: true })
    throw new Error(
      `FAIL_BOUNDARY: Workspace validation failed — ${validation.violations.join('; ')}`,
    )
  }

  return {
    workspacePath,
    sourceManifest: {
      sourcePath: contract.sourcePath,
      files: workspace.manifest.files,
    },
    cleanup: () => {
      fs.rmSync(workspacePath, { recursive: true, force: true })
    },
  }
}

function sha256ofFile(filePath: string): string {
  const content = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(content).digest('hex')
}

/**
 * Re-hash source files listed in the manifest and return true if any differ.
 * Used to prove the original project was not mutated by the verification run.
 */
export function checkSourceModified(sourceManifest: {
  sourcePath: string
  files: SourceManifestEntry[]
}): boolean {
  for (const { relativePath, sha256: expected } of sourceManifest.files) {
    const abs = path.join(sourceManifest.sourcePath, relativePath)
    if (!fs.existsSync(abs)) return true
    if (sha256ofFile(abs) !== expected) return true
  }
  return false
}
