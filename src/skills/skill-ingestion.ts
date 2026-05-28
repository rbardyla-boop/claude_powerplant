import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { getCandidatesDir, getCandidatePath } from './skill-paths.js'
import { appendAuditEvent } from './skill-audit.js'
import { validateCandidateSchema } from './candidate-store.js'

// ── Gate 0 limits ─────────────────────────────────────────────────────────────

export interface Gate0Limits {
  maxFileCount: number
  maxFileSizeBytes: number
  maxTotalSizeBytes: number
  maxDepth: number
}

export const DEFAULT_GATE0_LIMITS: Gate0Limits = {
  maxFileCount: 100,
  maxFileSizeBytes: 512 * 1024,        // 512 KB
  maxTotalSizeBytes: 5 * 1024 * 1024,  // 5 MB
  maxDepth: 5,
}

// ── Internal types ────────────────────────────────────────────────────────────

interface ValidatedFileEntry {
  relativePath: string
  absolutePath: string
  sizeBytes: number
  mtimeMs: number
}

interface Gate0Rejection {
  kind: 'GATE_0_REJECTION'
  reason: string
}

interface Gate0Acceptance {
  kind: 'GATE_0_ACCEPTANCE'
  files: ValidatedFileEntry[]
}

type WalkResult = Gate0Rejection | Gate0Acceptance

// ── Public result types ───────────────────────────────────────────────────────

export interface IngestionSuccess {
  success: true
  candidateId: string
  candidatePath: string
  name: string
  gatesCompleted: ['GATE_0', 'GATE_1']
}

export interface IngestionFailure {
  success: false
  failedGate: 'GATE_0' | 'GATE_1'
  reason: string
  candidateId: string | null
}

export type IngestionResult = IngestionSuccess | IngestionFailure

// ── Gate 0: filesystem safety walk ───────────────────────────────────────────

async function walkSourceDirectory(
  sourceRoot: string,
  limits: Gate0Limits
): Promise<WalkResult> {
  const resolvedRoot = path.resolve(sourceRoot)
  const files: ValidatedFileEntry[] = []
  let totalSizeBytes = 0

  async function walk(dir: string, depth: number): Promise<Gate0Rejection | null> {
    if (depth > limits.maxDepth) {
      return { kind: 'GATE_0_REJECTION', reason: `Directory depth exceeds limit of ${limits.maxDepth}` }
    }

    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return {
        kind: 'GATE_0_REJECTION',
        reason: `Cannot read directory: ${path.relative(resolvedRoot, dir) || '.'}`,
      }
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name)
      const relPath = path.relative(resolvedRoot, entryPath)

      // Path traversal: canonical path must remain inside source root.
      // This guards against any future archive-extraction path escape.
      const canonical = path.resolve(entryPath)
      const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep
      if (!canonical.startsWith(rootWithSep) && canonical !== resolvedRoot) {
        return { kind: 'GATE_0_REJECTION', reason: `Path escape detected: ${relPath}` }
      }

      // lstat — never follow symlinks
      let stat: fs.Stats
      try {
        stat = await fs.promises.lstat(entryPath)
      } catch {
        return { kind: 'GATE_0_REJECTION', reason: `Cannot stat entry: ${relPath}` }
      }

      if (stat.isSymbolicLink()) {
        return { kind: 'GATE_0_REJECTION', reason: `Symlink not permitted: ${relPath}` }
      }

      if (stat.isDirectory()) {
        const rejection = await walk(entryPath, depth + 1)
        if (rejection) return rejection
        continue
      }

      if (!stat.isFile()) {
        // Device files, sockets, FIFOs, and any non-regular entry
        return { kind: 'GATE_0_REJECTION', reason: `Unsupported entry type: ${relPath}` }
      }

      // Hardlinks: nlink > 1 means this inode has multiple directory entries
      if (stat.nlink > 1) {
        return {
          kind: 'GATE_0_REJECTION',
          reason: `Hardlinked file not permitted: ${relPath} (nlink=${stat.nlink})`,
        }
      }

      if (stat.size > limits.maxFileSizeBytes) {
        return {
          kind: 'GATE_0_REJECTION',
          reason: `File exceeds size limit: ${relPath} (${stat.size} bytes, limit ${limits.maxFileSizeBytes})`,
        }
      }

      if (files.length >= limits.maxFileCount) {
        return {
          kind: 'GATE_0_REJECTION',
          reason: `File count exceeds limit of ${limits.maxFileCount}`,
        }
      }

      totalSizeBytes += stat.size
      if (totalSizeBytes > limits.maxTotalSizeBytes) {
        return {
          kind: 'GATE_0_REJECTION',
          reason: `Total package size exceeds limit of ${limits.maxTotalSizeBytes} bytes`,
        }
      }

      files.push({
        relativePath: relPath,
        absolutePath: entryPath,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
      })
    }

    return null
  }

  const rejection = await walk(sourceRoot, 0)
  if (rejection) return rejection
  return { kind: 'GATE_0_ACCEPTANCE', files }
}

// ── Snapshot copy ─────────────────────────────────────────────────────────────

async function copyToSnapshot(
  files: ValidatedFileEntry[],
  destDir: string
): Promise<{ success: false; reason: string } | { success: true }> {
  for (const file of files) {
    // Re-stat before copying: detect TOCTOU mutation in the source.
    let stat: fs.Stats
    try {
      stat = await fs.promises.lstat(file.absolutePath)
    } catch {
      return { success: false, reason: `Source entry disappeared during ingestion: ${file.relativePath}` }
    }

    if (!stat.isFile() || stat.isSymbolicLink()) {
      return {
        success: false,
        reason: `Source entry changed type during ingestion: ${file.relativePath}`,
      }
    }

    if (stat.mtimeMs !== file.mtimeMs) {
      return {
        success: false,
        reason: `Source entry modified during ingestion: ${file.relativePath}`,
      }
    }

    const destPath = path.join(destDir, file.relativePath)
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true })
    await fs.promises.copyFile(file.absolutePath, destPath)
  }

  return { success: true }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function ingestSkillPackage(
  sourcePath: string,
  limits: Partial<Gate0Limits> = {}
): Promise<IngestionResult> {
  const effectiveLimits: Gate0Limits = { ...DEFAULT_GATE0_LIMITS, ...limits }
  const resolvedSource = path.resolve(sourcePath)

  // Verify source exists and is a directory (lstat — do not follow symlinks).
  let sourceStat: fs.Stats
  try {
    sourceStat = await fs.promises.lstat(resolvedSource)
  } catch {
    const rejection: IngestionFailure = {
      success: false,
      failedGate: 'GATE_0',
      reason: 'Source path does not exist',
      candidateId: null,
    }
    appendAuditEvent({
      event: 'import-rejected',
      command: 'powerplant skill import',
      sourcePath: resolvedSource,
      failedGate: 'GATE_0',
      reason: rejection.reason,
      candidateId: null,
    })
    return rejection
  }

  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
    const reason = sourceStat.isSymbolicLink()
      ? 'Source path is a symlink — only real directories are accepted'
      : 'Source path is not a directory'
    appendAuditEvent({
      event: 'import-rejected',
      command: 'powerplant skill import',
      sourcePath: resolvedSource,
      failedGate: 'GATE_0',
      reason,
      candidateId: null,
    })
    return { success: false, failedGate: 'GATE_0', reason, candidateId: null }
  }

  // Gate 0: walk and validate filesystem structure.
  const walkResult = await walkSourceDirectory(resolvedSource, effectiveLimits)

  if (walkResult.kind === 'GATE_0_REJECTION') {
    appendAuditEvent({
      event: 'import-rejected',
      command: 'powerplant skill import',
      sourcePath: resolvedSource,
      failedGate: 'GATE_0',
      reason: walkResult.reason,
      candidateId: null,
    })
    return { success: false, failedGate: 'GATE_0', reason: walkResult.reason, candidateId: null }
  }

  // Gate 0 passed — create the Powerplant-controlled quarantine snapshot.
  // All later operations use this snapshot, never the source directory.
  fs.mkdirSync(getCandidatesDir(), { recursive: true })
  const candidateId = randomUUID()
  const candidatePath = getCandidatePath(candidateId)
  fs.mkdirSync(candidatePath, { recursive: true, mode: 0o700 })

  const copyResult = await copyToSnapshot(walkResult.files, candidatePath)
  if (!copyResult.success) {
    // Snapshot creation failed — clean up and reject.
    try { fs.rmSync(candidatePath, { recursive: true, force: true }) } catch { /* best-effort */ }
    appendAuditEvent({
      event: 'import-rejected',
      command: 'powerplant skill import',
      sourcePath: resolvedSource,
      failedGate: 'GATE_0',
      reason: copyResult.reason,
      candidateId: null,
    })
    return { success: false, failedGate: 'GATE_0', reason: copyResult.reason, candidateId: null }
  }

  // Gate 1: schema and identity validation — operates only on the snapshot.
  const gate1Result = await validateCandidateSchema(candidatePath, candidateId)

  if (!gate1Result.success) {
    // Move invalid candidate to skill quarantine.
    const quarantinePath = path.join(
      getCandidatesDir().replace(/candidates$/, 'quarantine'),
      candidateId
    )
    try {
      fs.mkdirSync(path.dirname(quarantinePath), { recursive: true })
      fs.renameSync(candidatePath, quarantinePath)
    } catch { /* best-effort — snapshot remains in candidates/ if move fails */ }

    appendAuditEvent({
      event: 'import-rejected',
      command: 'powerplant skill import',
      sourcePath: resolvedSource,
      failedGate: 'GATE_1',
      reason: gate1Result.reason,
      candidateId,
    })
    return { success: false, failedGate: 'GATE_1', reason: gate1Result.reason, candidateId }
  }

  // Both gates passed — write normalized manifest and record success.
  fs.writeFileSync(
    path.join(candidatePath, 'manifest.json'),
    JSON.stringify(gate1Result.manifest, null, 2),
    'utf-8'
  )

  appendAuditEvent({
    event: 'imported',
    command: 'powerplant skill import',
    candidateId,
    name: gate1Result.manifest.name,
    contentHash: null, // Gate 2 (hashing) not yet run
  })

  return {
    success: true,
    candidateId,
    candidatePath,
    name: gate1Result.manifest.name,
    gatesCompleted: ['GATE_0', 'GATE_1'],
  }
}
