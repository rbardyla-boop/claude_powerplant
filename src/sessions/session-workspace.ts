import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { spawnSync } from 'child_process'
import { computeDirectoryManifestHash } from '../projects/compute-repo-manifest.js'
import { closeSession, getSessionBasePath } from './session-chain.js'
import type { SessionState } from './session-chain.js'
import type { PilotSnapshot } from '../projects/build-pilot-snapshot.js'
import type { LoadedProjectContract } from '../projects/load-project-contract.js'
import { getPowerplantHome } from '../config/powerplant-home.js'

const SKIP_DIRS = new Set(['.git', 'node_modules', '.powerplant'])

function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry)
    const dstPath = path.join(dst, entry)
    if (fs.lstatSync(srcPath).isDirectory()) {
      copyDir(srcPath, dstPath)
    } else {
      fs.copyFileSync(srcPath, dstPath)
    }
  }
}

function sha256ofFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function walkProjectFiles(dir: string, base: string): Array<{ relativePath: string; sha256: string }> {
  const results: Array<{ relativePath: string; sha256: string }> = []
  function walk(current: string): void {
    for (const entry of fs.readdirSync(current)) {
      if (SKIP_DIRS.has(entry)) continue
      const abs = path.join(current, entry)
      if (fs.lstatSync(abs).isDirectory()) {
        walk(abs)
      } else {
        results.push({
          relativePath: path.relative(base, abs).replace(/\\/g, '/'),
          sha256: sha256ofFile(abs),
        })
      }
    }
  }
  walk(dir)
  return results
}

/**
 * Apply a unified diff to a workspace directory using `patch -p1`.
 * Does not require a git repo. The .diff format produced by `diff -u --label a/... --label b/...`
 * is compatible with patch -p1 which strips the leading `a/` / `b/` component.
 */
export function applyPatchToWorkspace(patchPath: string, workspaceDir: string): void {
  const result = spawnSync('patch', ['-p1', '-i', patchPath], {
    cwd: workspaceDir,
    encoding: 'utf-8',
  })
  if (result.status !== 0 || result.error) {
    const msg = result.stderr?.trim() ?? result.error?.message ?? 'unknown error'
    throw new Error(`Patch apply failed for ${path.basename(patchPath)}: ${msg}`)
  }
}

/**
 * Find a run directory under POWERPLANT_HOME/runs/ by run ID.
 * Uses getPowerplantHome() so it respects POWERPLANT_HOME env override in tests.
 */
function findRunDirForChain(runId: string): string | null {
  const runsHome = path.join(getPowerplantHome(), 'runs')
  if (!fs.existsSync(runsHome)) return null
  for (const projectDir of fs.readdirSync(runsHome)) {
    const candidate = path.join(runsHome, projectDir, runId)
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate
    }
  }
  return null
}

/**
 * Build the cumulative workspace for a session: copy base then apply each chain
 * link's patch in order. The result in outputDir reflects all approved changes
 * to date.
 */
export function buildCumulativeWorkspace(session: SessionState, outputDir: string): void {
  const basePath = getSessionBasePath(session.sessionId)
  if (!fs.existsSync(basePath)) {
    throw new Error(`Session base workspace not found: ${basePath}`)
  }
  copyDir(basePath, outputDir)

  for (const link of session.chainLinks) {
    const runDir = findRunDirForChain(link.runId)
    if (!runDir) {
      throw new Error(`Run directory not found for chain link: ${link.runId}`)
    }
    const patchPath = path.join(runDir, 'PATCH.diff')
    if (!fs.existsSync(patchPath)) {
      throw new Error(`PATCH.diff not found for chain link ${link.runId}`)
    }
    applyPatchToWorkspace(patchPath, outputDir)
  }
}

/**
 * Compute the workspace manifest hash that would result from extending a session
 * with a new patch. Used by the approve --extend-session flow to record
 * workspaceManifestHash before appending the chain link.
 */
export function computeExtendedWorkspaceManifestHash(
  session: SessionState,
  newPatchPath: string,
): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-session-ext-'))
  try {
    buildCumulativeWorkspace(session, tempDir)
    applyPatchToWorkspace(newPatchPath, tempDir)
    return computeDirectoryManifestHash(tempDir)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

/**
 * Build a PilotSnapshot for a session run. Rebuilds the cumulative workspace
 * from base + chain patches, verifies the manifest hash, then copies it into
 * the run directory. Closes the session and throws on tamper detection.
 *
 * The sourceManifest.sourcePath points to a permanent copy in patchDir so
 * approve's drift check still works after the temp run dir is cleaned up.
 */
export function buildSessionRunSnapshot(
  session: SessionState,
  contract: LoadedProjectContract,
  runDir: string,
  patchDir: string,
): PilotSnapshot {
  const cumulativeDir = path.join(runDir, 'session-cumulative')
  buildCumulativeWorkspace(session, cumulativeDir)

  const actualHash = computeDirectoryManifestHash(cumulativeDir)
  const lastLink = session.chainLinks[session.chainLinks.length - 1]
  const expectedHash = lastLink !== undefined ? lastLink.workspaceManifestHash : session.baseManifestHash

  if (actualHash !== expectedHash) {
    closeSession(session.sessionId)
    throw new Error(
      `Session ${session.sessionId} tamper detected: workspace manifest hash mismatch.\n` +
      `  Expected: ${expectedHash}\n` +
      `  Actual:   ${actualHash}\n` +
      `Session has been automatically closed.`,
    )
  }

  // Permanent baseline for approve drift check (patchDir persists after run cleanup)
  const sessionBaselinePath = path.join(patchDir, 'session-baseline')
  copyDir(cumulativeDir, sessionBaselinePath)

  const baselinePath = path.join(runDir, 'baseline')
  const workspacePath = path.join(runDir, 'workspace')
  copyDir(cumulativeDir, baselinePath)
  copyDir(cumulativeDir, workspacePath)

  const files = walkProjectFiles(baselinePath, baselinePath)
  const now = new Date().toISOString()

  return {
    baselinePath,
    workspacePath,
    sourceManifest: {
      projectId: contract.projectId,
      sourcePath: sessionBaselinePath,
      capturedAt: now,
      excludePaths: contract.excludePaths,
      files,
    },
    sanitizedManifest: {
      projectId: contract.projectId,
      capturedAt: now,
      files,
      forbiddenPathsChecked: contract.denyIfPresentAfterCopy,
      allForbiddenAbsent: true,
    },
  }
}
