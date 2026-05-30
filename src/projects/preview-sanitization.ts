import fs from 'fs'
import path from 'path'
import { matchesGlob } from './build-sanitized-workspace.js'
import type { ProjectContract } from './project-contract.js'

export interface SanitizationPreview {
  includedFiles: string[]
  excludedFiles: string[]
  /** denyIfPresentAfterCopy items found in the source tree — informational only, never a FAIL */
  forbiddenInSource: string[]
  /** denyIfPresentAfterCopy items that would appear in the sanitized snapshot — this is the FAIL condition */
  forbiddenDetected: string[]
  allForbiddenAbsent: boolean
}

export function previewSanitization(contract: ProjectContract): SanitizationPreview {
  const sourcePath = path.resolve(contract.sourcePath)

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Project path does not exist: ${sourcePath}`)
  }

  const allFiles: string[] = []

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir)) {
      const abs = path.join(dir, entry)
      const relDir = path.relative(sourcePath, abs).replace(/\\/g, '/')
      const stat = fs.lstatSync(abs)
      if (stat.isDirectory()) {
        // Early prune: skip directory trees that match an excludePath pattern.
        const dirExcluded = contract.excludePaths.some(p => matchesGlob(relDir + '/', p))
        if (!dirExcluded) {
          walk(abs)
        }
      } else {
        allFiles.push(relDir)
      }
    }
  }
  walk(sourcePath)

  const includedFiles: string[] = []
  const excludedFiles: string[] = []

  for (const relPath of allFiles) {
    const included = contract.includePaths.some(p => matchesGlob(relPath, p))
    // excludePaths wins over includePaths — same semantics as buildSanitizedWorkspace.
    const excluded = contract.excludePaths.some(p => matchesGlob(relPath, p))
    if (included && !excluded) {
      includedFiles.push(relPath)
    } else {
      excludedFiles.push(relPath)
    }
  }

  // Informational: which denyIfPresentAfterCopy items exist in source.
  // Their presence in source is expected for real projects and is NOT a failure.
  // Contents are never read — only the relative path is recorded.
  const forbiddenInSource: string[] = []
  for (const item of contract.denyIfPresentAfterCopy) {
    if (fs.existsSync(path.join(sourcePath, item))) {
      forbiddenInSource.push(item)
    }
  }

  // FAIL condition: would any denyIfPresentAfterCopy item appear in the sanitized snapshot?
  // Checks whether any included file equals or is nested under a forbidden item path.
  const forbiddenDetected: string[] = []
  for (const item of contract.denyIfPresentAfterCopy) {
    const normalizedItem = item.replace(/\\/g, '/')
    const wouldAppearInSnapshot = includedFiles.some(
      f => f === normalizedItem || f.startsWith(normalizedItem + '/'),
    )
    if (wouldAppearInSnapshot) {
      forbiddenDetected.push(item)
    }
  }

  return {
    includedFiles: includedFiles.sort(),
    excludedFiles: excludedFiles.sort(),
    forbiddenInSource,
    forbiddenDetected,
    allForbiddenAbsent: forbiddenDetected.length === 0,
  }
}
