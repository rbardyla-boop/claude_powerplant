import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import {
  getCandidatesDir,
  getCandidatePath,
  getCandidateMetaPath,
  getSkillQuarantineCandidatePath,
  POWERPLANT_META_FILENAME,
} from './skill-paths.js'
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

// ── Gate 0 copy hooks (test injection only) ───────────────────────────────────

/**
 * Hooks for deterministic adversarial testing. Never populated in production.
 *
 * beforeOpen — called after lstat validation, before opening the source handle.
 *              Use to simulate path substitution at the open boundary.
 * afterWrite  — called after writing content to destination, before post-copy fstat.
 *              Use to simulate source mutation during the copy window.
 */
export interface Gate0CopyHooks {
  beforeOpen?: (entry: ValidatedFileEntry) => void
  afterWrite?: (entry: ValidatedFileEntry) => void
}

// ── ValidatedFileEntry ────────────────────────────────────────────────────────
// Exported so tests can craft entries with injected identity fields.

export interface ValidatedFileEntry {
  relativePath: string
  absolutePath: string
  sizeBytes: number
  mtimeMs: number
  ino: number    // inode — used for identity check after open
  dev: number    // device — used to detect cross-device replacement
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

      // Reserved filename: reject packages that contain Powerplant-owned metadata.
      // A crafted skill supplying .powerplant-meta.json could attempt to spoof identity.
      if (entry.name === POWERPLANT_META_FILENAME) {
        return {
          kind: 'GATE_0_REJECTION',
          reason: `${POWERPLANT_META_FILENAME} is reserved for Powerplant and must not appear in skill packages`,
        }
      }

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
        ino: stat.ino,
        dev: stat.dev,
      })
    }

    return null
  }

  const rejection = await walk(sourceRoot, 0)
  if (rejection) return rejection
  return { kind: 'GATE_0_ACCEPTANCE', files }
}

// ── Snapshot copy — handle-based with pre/post fstat ─────────────────────────
//
// Platform note: O_NOFOLLOW is available on Linux and macOS (fs.constants.O_NOFOLLOW).
// It prevents open() from following the final path component if it is a symlink,
// returning ELOOP instead. On platforms where O_NOFOLLOW is unavailable (Windows),
// the open succeeds and symlink substitution is caught only by the post-open fstat
// inode/type check — a weaker but still present guard.
//
// Intermediate-directory substitution (an attacker replacing a parent directory
// during the walk-to-open window) is not portably preventable at the Node.js level
// without OS-specific mechanisms. Phase 1A treats this as a residual risk: skill
// imports should be performed by the operator, not by untrusted concurrent processes,
// and the quarantine snapshot is in Powerplant-controlled storage (0o700).
//
// Exported so tests can call it directly with crafted ValidatedFileEntry values and
// injected hooks — no timing-dependent sleeps needed.

// True on Linux/macOS; false on Windows and any platform without O_NOFOLLOW.
const NO_FOLLOW_OPEN_SUPPORTED =
  'O_NOFOLLOW' in fs.constants && (fs.constants.O_NOFOLLOW as number) !== 0

async function copyFileSecure(
  entry: ValidatedFileEntry,
  destDir: string,
  hooks?: Gate0CopyHooks
): Promise<{ success: false; reason: string } | { success: true }> {
  const destPath = path.join(destDir, entry.relativePath)

  // Test hook: simulate path substitution just before open.
  hooks?.beforeOpen?.(entry)

  // Open source with O_NOFOLLOW where supported. On Linux/macOS this causes
  // open() to fail with ELOOP if the final path component is a symlink.
  const openFlags =
    fs.constants.O_RDONLY |
    (NO_FOLLOW_OPEN_SUPPORTED ? (fs.constants.O_NOFOLLOW as number) : 0)

  let srcHandle: fs.promises.FileHandle
  try {
    srcHandle = await fs.promises.open(entry.absolutePath, openFlags)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ELOOP') {
      return { success: false, reason: `Source entry is or became a symlink: ${entry.relativePath}` }
    }
    if (code === 'ENOENT') {
      return { success: false, reason: `Source entry disappeared before open: ${entry.relativePath}` }
    }
    return { success: false, reason: `Cannot open source entry: ${entry.relativePath} (${code ?? 'unknown'})` }
  }

  try {
    // fstat on the opened handle — calls fstat(2), not stat(2).
    // Works on the actual open file object, not the path. Immune to path substitution.
    const preStat = await srcHandle.stat()

    if (!preStat.isFile()) {
      return { success: false, reason: `Source entry is not a regular file after opening: ${entry.relativePath}` }
    }

    // Inode + device: detects replacement with a different file at the same path.
    if (preStat.ino !== entry.ino || preStat.dev !== entry.dev) {
      return {
        success: false,
        reason: `Source entry replaced (inode/device changed): ${entry.relativePath}`,
      }
    }

    if (preStat.nlink > 1) {
      return {
        success: false,
        reason: `Source entry has multiple hardlinks after opening: ${entry.relativePath} (nlink=${preStat.nlink})`,
      }
    }

    if (preStat.mtimeMs !== entry.mtimeMs) {
      return { success: false, reason: `Source entry modified during ingestion: ${entry.relativePath}` }
    }

    // Snapshot pre-copy identity for post-copy verification.
    const preSize = preStat.size
    const preMtime = preStat.mtimeMs
    const preCtime = preStat.ctimeMs   // best-effort; ctime semantics vary by filesystem

    // Create dest directory and open the destination exclusively.
    // O_CREAT | O_EXCL: fails with EEXIST if the path already exists.
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true })
    let destHandle: fs.promises.FileHandle
    try {
      destHandle = await fs.promises.open(
        destPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
      )
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EEXIST') {
        return { success: false, reason: `Snapshot destination already exists: ${entry.relativePath}` }
      }
      throw err
    }

    let copyError: { success: false; reason: string } | null = null
    try {
      const content = await srcHandle.readFile()
      await destHandle.writeFile(content)
      await destHandle.sync()
    } catch (err) {
      copyError = { success: false, reason: `Failed to copy file: ${entry.relativePath}: ${(err as Error).message}` }
    } finally {
      try { await destHandle.close() } catch { /* ignore */ }
    }

    if (copyError) {
      try { await fs.promises.unlink(destPath) } catch { /* best-effort cleanup */ }
      return copyError
    }

    // Test hook: simulate source mutation during the post-write window.
    hooks?.afterWrite?.(entry)

    // Post-copy fstat: source identity must be unchanged since we read it.
    // Checks size, mtime, and ctime (ctime best-effort on FAT/network FS).
    const postStat = await srcHandle.stat()
    const identityChanged =
      postStat.size !== preSize ||
      postStat.mtimeMs !== preMtime ||
      postStat.ctimeMs !== preCtime

    if (identityChanged) {
      try { await fs.promises.unlink(destPath) } catch { /* best-effort */ }
      return { success: false, reason: `Source entry changed during copying: ${entry.relativePath}` }
    }

  } finally {
    try { await srcHandle.close() } catch { /* ignore */ }
  }

  return { success: true }
}

export async function copyToSnapshot(
  files: ValidatedFileEntry[],
  destDir: string,
  hooks?: Gate0CopyHooks
): Promise<{ success: false; reason: string } | { success: true }> {
  for (const file of files) {
    const result = await copyFileSecure(file, destDir, hooks)
    if (!result.success) return result
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
    // Move invalid candidate to skill quarantine using the authoritative path helper.
    const quarantinePath = getSkillQuarantineCandidatePath(candidateId)
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

  // Both gates passed.
  //
  // The imported snapshot in candidatePath is now source-detached and must not
  // be modified. Powerplant-owned metadata (the normalized manifest) is written
  // to .powerplant-meta.json — a separate Powerplant-controlled file that never
  // overwrites any content that was part of the imported package.
  fs.writeFileSync(
    getCandidateMetaPath(candidateId),
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
