import fs from 'fs'
import path from 'path'
import { matchesGlob } from './build-sanitized-workspace.js'
import type { ProjectContract } from './project-contract.js'

export interface SanitizationPreview {
  includedFiles: string[]
  excludedFiles: string[]
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
      const stat = fs.lstatSync(abs)
      if (stat.isDirectory()) {
        walk(abs)
      } else {
        allFiles.push(path.relative(sourcePath, abs).replace(/\\/g, '/'))
      }
    }
  }
  walk(sourcePath)

  const includedFiles: string[] = []
  const excludedFiles: string[] = []

  for (const relPath of allFiles) {
    const matched = contract.includePaths.some(p => matchesGlob(relPath, p))
    if (matched) {
      includedFiles.push(relPath)
    } else {
      excludedFiles.push(relPath)
    }
  }

  // Check which forbidden paths actually exist in the source tree
  const forbiddenDetected: string[] = []
  for (const item of contract.denyIfPresentAfterCopy) {
    if (fs.existsSync(path.join(sourcePath, item))) {
      forbiddenDetected.push(item)
    }
  }

  return {
    includedFiles: includedFiles.sort(),
    excludedFiles: excludedFiles.sort(),
    forbiddenDetected,
    allForbiddenAbsent: forbiddenDetected.length === 0,
  }
}
