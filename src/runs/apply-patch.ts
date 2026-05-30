import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawnSync } from 'child_process'

export interface SourceManifest {
  projectId: string
  sourcePath: string
  capturedAt: string
  /** excludePaths used during capture — present in manifests generated after the fix */
  excludePaths?: string[]
  files: Array<{ relativePath: string; sha256: string }>
}

export interface SessionSummary {
  runId?: string
  passed?: boolean
  [key: string]: unknown
}

export interface DriftResult {
  clean: boolean
  changedFiles: string[]
  missingFiles: string[]
}

export interface PatchCheckResult {
  applies: boolean
  stderr: string
}

function sha256ofFile(filePath: string): string {
  const content = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(content).digest('hex')
}

export function checkSourceDrift(manifest: SourceManifest): DriftResult {
  const sourcePath = path.resolve(manifest.sourcePath)
  const changedFiles: string[] = []
  const missingFiles: string[] = []

  for (const { relativePath, sha256: expected } of manifest.files) {
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

  return {
    clean: changedFiles.length === 0 && missingFiles.length === 0,
    changedFiles,
    missingFiles,
  }
}

export function checkPatchApplies(patchPath: string, projectPath: string): PatchCheckResult {
  const result = spawnSync('git', ['apply', '--check', patchPath], {
    cwd: projectPath,
    encoding: 'utf-8',
  })
  if (result.error) {
    return { applies: false, stderr: result.error.message }
  }
  if (result.status !== 0) {
    return { applies: false, stderr: result.stderr ?? '' }
  }
  return { applies: true, stderr: '' }
}

export function cleanupApprovalBranch(
  branchName: string,
  originalBranch: string,
  projectPath: string,
): void {
  spawnSync('git', ['checkout', originalBranch], { cwd: projectPath })
  spawnSync('git', ['branch', '-D', branchName], { cwd: projectPath })
}
