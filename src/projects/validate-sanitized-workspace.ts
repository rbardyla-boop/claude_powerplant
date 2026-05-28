import fs from 'fs'
import path from 'path'
import type { ProjectContract } from './project-contract.js'

export interface ValidationResult {
  passed: boolean
  violations: string[]
}

const FORBIDDEN_CANARY_MARKER = 'POWERPLANT_FORBIDDEN'

function walkFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry)
    const stat = fs.lstatSync(fullPath)
    if (stat.isDirectory()) {
      results.push(...walkFiles(fullPath))
    } else {
      results.push(fullPath)
    }
  }
  return results
}

export function validateSanitizedWorkspace(
  workspacePath: string,
  contract: ProjectContract,
): ValidationResult {
  const violations: string[] = []

  // Check that no denyIfPresentAfterCopy paths exist at the top level of the workspace
  for (const denied of contract.denyIfPresentAfterCopy) {
    const target = path.join(workspacePath, denied)
    if (fs.existsSync(target)) {
      violations.push(`Forbidden path present after copy: ${denied}`)
    }
  }

  // Scan all file contents for forbidden canary marker
  if (fs.existsSync(workspacePath)) {
    const allFiles = walkFiles(workspacePath)
    for (const filePath of allFiles) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        if (content.includes(FORBIDDEN_CANARY_MARKER)) {
          const rel = path.relative(workspacePath, filePath)
          violations.push(`Forbidden canary string found in: ${rel}`)
        }
      } catch {
        // Binary or unreadable file — skip canary scan, not a violation
      }
    }
  }

  return { passed: violations.length === 0, violations }
}
