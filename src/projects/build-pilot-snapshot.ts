import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { buildSanitizedWorkspace, matchesGlob } from './build-sanitized-workspace.js'
import { validateSanitizedWorkspace } from './validate-sanitized-workspace.js'
import type { ProjectContract } from './project-contract.js'

export interface PilotSnapshot {
  /** Absolute path to the immutable baseline copy (never modified) */
  baselinePath: string
  /** Absolute path to the writable workspace copy (agent writes here) */
  workspacePath: string
  /** SOURCE_MANIFEST: original source file hashes before any session */
  sourceManifest: {
    projectId: string
    sourcePath: string
    capturedAt: string
    /** Paths excluded from the manifest — same patterns as POLICY.yaml excludePaths */
    excludePaths: string[]
    files: Array<{ relativePath: string; sha256: string }>
  }
  /** SANITIZED_MANIFEST: files that entered the baseline snapshot */
  sanitizedManifest: {
    projectId: string
    capturedAt: string
    files: Array<{ relativePath: string; sha256: string }>
    forbiddenPathsChecked: string[]
    allForbiddenAbsent: boolean
  }
}

function sha256ofFile(filePath: string): string {
  const content = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(content).digest('hex')
}

function walkFiles(dir: string, base: string): Array<{ rel: string; abs: string }> {
  const results: Array<{ rel: string; abs: string }> = []
  for (const entry of fs.readdirSync(dir)) {
    const abs = path.join(dir, entry)
    const stat = fs.lstatSync(abs)
    if (stat.isSymbolicLink()) {
      // Skip symlinks — readFileSync follows them and throws EISDIR for dir-symlinks.
      continue
    }
    if (stat.isDirectory()) {
      results.push(...walkFiles(abs, base))
    } else {
      results.push({ rel: path.relative(base, abs).replace(/\\/g, '/'), abs })
    }
  }
  return results
}

function captureSourceManifest(
  contract: ProjectContract,
): PilotSnapshot['sourceManifest'] {
  const sourcePath = path.resolve(contract.sourcePath)
  const allFiles = walkFiles(sourcePath, sourcePath)
  // Exclude the same paths as the sanitized snapshot so that changes to
  // .git internals, build artifacts, and other excluded directories do not
  // cause spurious drift failures at approve time.
  const relevant = allFiles.filter(
    f => !contract.excludePaths.some(pattern => matchesGlob(f.rel, pattern)),
  )
  return {
    projectId: contract.projectId,
    sourcePath: contract.sourcePath,
    capturedAt: new Date().toISOString(),
    excludePaths: contract.excludePaths,
    files: relevant.map(f => ({
      relativePath: f.rel,
      sha256: sha256ofFile(f.abs),
    })),
  }
}

function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry)
    const dstPath = path.join(dst, entry)
    const stat = fs.lstatSync(srcPath)
    if (stat.isDirectory()) {
      copyDir(srcPath, dstPath)
    } else {
      fs.copyFileSync(srcPath, dstPath)
    }
  }
}

export function buildPilotSnapshot(
  contract: ProjectContract,
  runDir: string,
): PilotSnapshot {
  // Capture source manifest BEFORE any copy (proves source untouched)
  const sourceManifest = captureSourceManifest(contract)

  const baselinePath = path.join(runDir, 'baseline')
  const workspacePath = path.join(runDir, 'workspace')

  fs.mkdirSync(runDir, { recursive: true })

  // Build sanitized baseline using include-only sanitizer
  const sanitized = buildSanitizedWorkspace(contract, baselinePath)

  // Validate: no forbidden paths or canary strings in baseline
  const validation = validateSanitizedWorkspace(baselinePath, contract)
  if (!validation.passed) {
    throw new Error(
      `Baseline snapshot failed sanitization validation:\n` +
      validation.violations.map(v => `  ${v}`).join('\n'),
    )
  }

  // Copy baseline to writable workspace (agent will modify this)
  copyDir(baselinePath, workspacePath)

  const sanitizedManifest: PilotSnapshot['sanitizedManifest'] = {
    projectId: contract.projectId,
    capturedAt: new Date().toISOString(),
    files: sanitized.manifest.files,
    forbiddenPathsChecked: contract.denyIfPresentAfterCopy,
    allForbiddenAbsent: validation.passed,
  }

  return {
    baselinePath,
    workspacePath,
    sourceManifest,
    sanitizedManifest,
  }
}
