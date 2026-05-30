import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { matchesGlob } from './build-sanitized-workspace.js'
import type { PilotSnapshot } from './build-pilot-snapshot.js'

export interface SourceVerificationResult {
  sourceUnmodified: boolean
  changedFiles: string[]
  missingFiles: string[]
  newFiles: string[]
}

function sha256ofFile(filePath: string): string {
  const content = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(content).digest('hex')
}

/**
 * Verifies that all files in the source project have the same hashes as
 * they did when the snapshot was captured (sourceManifest).
 * Returns sourceUnmodified: true only if every recorded file is unchanged
 * and no files were added or removed from the source.
 */
export function verifySourceUnchanged(
  snapshot: PilotSnapshot,
): SourceVerificationResult {
  const sourcePath = path.resolve(snapshot.sourceManifest.sourcePath)
  const changedFiles: string[] = []
  const missingFiles: string[] = []

  for (const { relativePath, sha256: expected } of snapshot.sourceManifest.files) {
    const abs = path.join(sourcePath, relativePath)
    if (!fs.existsSync(abs)) {
      missingFiles.push(relativePath)
      continue
    }
    const actual = sha256ofFile(abs)
    if (actual !== expected) {
      changedFiles.push(relativePath)
    }
  }

  // Check for new files not in the original manifest, using the same excludePaths
  // so that .git internals and build artifacts are not flagged as "new".
  const excludePaths = snapshot.sourceManifest.excludePaths ?? []
  const originalPaths = new Set(snapshot.sourceManifest.files.map(f => f.relativePath))
  const newFiles = walkAllRelative(sourcePath)
    .filter(p => !excludePaths.some(pattern => matchesGlob(p, pattern)))
    .filter(p => !originalPaths.has(p))

  const sourceUnmodified =
    changedFiles.length === 0 &&
    missingFiles.length === 0 &&
    newFiles.length === 0

  return { sourceUnmodified, changedFiles, missingFiles, newFiles }
}

function walkAllRelative(dir: string): string[] {
  const results: string[] = []
  function walk(current: string): void {
    for (const entry of fs.readdirSync(current)) {
      const abs = path.join(current, entry)
      const stat = fs.lstatSync(abs)
      if (stat.isSymbolicLink()) {
        // Skip symlinks — consistent with captureSourceManifest; prevents false-positive
        // "Original repo modified" when dir-symlinks (e.g. .venv/lib64) are present.
        continue
      }
      if (stat.isDirectory()) {
        walk(abs)
      } else {
        results.push(path.relative(dir, abs).replace(/\\/g, '/'))
      }
    }
  }
  walk(dir)
  return results
}
