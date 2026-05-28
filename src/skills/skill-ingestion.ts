import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import {
  getCandidatesDir,
  getCandidatePath,
  getStagingDir,
  getStagingPath,
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

// ── Gate 0 copy hooks (test injection only) ───────────────────────────────────

/**
 * Hooks for deterministic adversarial testing. Never populated in production.
 *
 * beforeOpen       — called after lstat validation, before opening the source handle.
 *                    Use to simulate path substitution at the open boundary.
 * onReadRequest    — called before each read, with the bounded request length and
 *                    the bytes already copied for this file.
 *                    Use to assert that read requests never exceed validated budgets.
 * afterChunk       — called after each chunk is written to the destination.
 *                    bytesWrittenSoFar is the running total for this file.
 *                    Use to simulate source growth during the copy window.
 * afterWrite       — called after all chunks are written, before post-copy fstat.
 *                    Use to simulate source mutation after full write.
 */
export interface Gate0CopyHooks {
  beforeOpen?: (entry: ValidatedFileEntry) => void
  onReadRequest?: (entry: ValidatedFileEntry, requestedLength: number, bytesCopiedSoFar: number) => void
  afterChunk?: (entry: ValidatedFileEntry, bytesWrittenSoFar: number) => void
  afterWrite?: (entry: ValidatedFileEntry) => void
}

// ── Test options threaded through ingestSkillPackage ──────────────────────────

/**
 * Test-only overrides for ingestSkillPackage. Never set in production callers.
 *
 * candidateId  — override randomUUID() so tests can predict the staging/candidate
 *                paths and assert atomic publication invariants deterministically.
 * copyHooks    — thread copy hooks through ingestion to observe staging state
 *                during the copy window (e.g., assert candidates/ not yet visible).
 */
export interface IngestTestOptions {
  candidateId?: string
  copyHooks?: Gate0CopyHooks
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

// ── Snapshot copy — handle-based with bounded reads and pre/post fstat ────────
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
// and the staging snapshot is in Powerplant-controlled storage (0o700).
//
// Exported so tests can call it directly with crafted ValidatedFileEntry values and
// injected hooks — no timing-dependent sleeps needed.

// True on Linux/macOS; false on Windows and any platform without O_NOFOLLOW.
const NO_FOLLOW_OPEN_SUPPORTED =
  'O_NOFOLLOW' in fs.constants && (fs.constants.O_NOFOLLOW as number) !== 0

// Chunk size for bounded reads. Small enough to check limits frequently;
// large enough for efficient I/O. 64 KB fits within the 512 KB per-file limit.
const COPY_CHUNK_SIZE = 64 * 1024

async function copyFileSecure(
  entry: ValidatedFileEntry,
  destDir: string,
  limits: Gate0Limits,
  priorPackageBytes: number,   // bytes already copied from earlier files in this batch
  readBuf: Buffer,              // shared buffer; reused across files for efficiency
  hooks?: Gate0CopyHooks
): Promise<{ success: false; reason: string } | { success: true; bytesCopied: number }> {
  // Defense-in-depth: entry.sizeBytes must not exceed the per-file budget.
  // The Gate 0 walk guarantees this for entries it produces; this guard defends
  // against crafted entries passed directly to copyFileSecure.
  if (entry.sizeBytes > limits.maxFileSizeBytes) {
    return {
      success: false,
      reason: `Entry size exceeds per-file limit (${entry.sizeBytes} > ${limits.maxFileSizeBytes}): ${entry.relativePath}`,
    }
  }

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

    // Bounded chunk copy from the opened source handle.
    //
    // Every read request is bounded to the minimum of:
    //   • bytes remaining in the structurally validated source entry (remainingValidated)
    //   • bytes remaining in the total-package budget (remainingPackageLimit)
    //   • COPY_CHUNK_SIZE
    //
    // Powerplant never requests more bytes from the source than the validated budget
    // allows — even when the source grows after initial lstat validation.
    // Once entry.sizeBytes bytes have been requested, the loop exits without a
    // further probe read. Post-copy fstat detects any growth or mutation.
    let bytesCopiedThisFile = 0
    let copyError: { success: false; reason: string } | null = null
    try {
      while (true) {
        // All validated bytes have been requested — exit without an additional probe read.
        if (bytesCopiedThisFile >= entry.sizeBytes) break

        const remainingValidated = entry.sizeBytes - bytesCopiedThisFile
        const remainingPackageLimit = limits.maxTotalSizeBytes - (priorPackageBytes + bytesCopiedThisFile)

        // Package budget exhausted — reject before requesting any more source bytes.
        if (remainingPackageLimit <= 0) {
          copyError = { success: false, reason: `Package exceeded max total size during copy: ${entry.relativePath}` }
          break
        }

        // Bound the read to the minimum of all applicable limits.
        const readLen = Math.min(COPY_CHUNK_SIZE, remainingValidated, remainingPackageLimit)

        // Test hook: observe the bounded read request before it is issued.
        hooks?.onReadRequest?.(entry, readLen, bytesCopiedThisFile)

        const { bytesRead: n } = await srcHandle.read(readBuf, 0, readLen, null)
        if (n === 0) break  // premature EOF — byte-count check below handles this

        bytesCopiedThisFile += n

        await destHandle.write(readBuf, 0, n)

        // Test hook: inject source growth after each chunk write.
        hooks?.afterChunk?.(entry, bytesCopiedThisFile)
      }

      // Require exact byte count after a successful loop.
      // Short-read (shrunken source) is caught here; growth is caught by post-copy fstat.
      if (!copyError && bytesCopiedThisFile !== entry.sizeBytes) {
        copyError = {
          success: false,
          reason: `Byte count mismatch after copy: copied ${bytesCopiedThisFile}, expected ${entry.sizeBytes}: ${entry.relativePath}`,
        }
      }

      if (!copyError) {
        await destHandle.sync()
      }
    } catch (err) {
      copyError = { success: false, reason: `Read/write error during copy: ${entry.relativePath}: ${(err as Error).message}` }
    } finally {
      try { await destHandle.close() } catch { /* ignore */ }
    }

    if (copyError) {
      try { await fs.promises.unlink(destPath) } catch { /* best-effort cleanup */ }
      return copyError
    }

    // Test hook: simulate source mutation after full write, before post-copy fstat.
    hooks?.afterWrite?.(entry)

    // Post-copy fstat: source identity must be unchanged since we read it.
    // Detects growth (size mismatch), shrinkage (byte-count check fires first),
    // and content mutation (mtime/ctime change). ctime is best-effort on FAT/network FS.
    const postStat = await srcHandle.stat()
    const identityChanged =
      postStat.size !== entry.sizeBytes ||
      postStat.mtimeMs !== preMtime ||
      postStat.ctimeMs !== preCtime

    if (identityChanged) {
      try { await fs.promises.unlink(destPath) } catch { /* best-effort */ }
      return { success: false, reason: `Source entry changed during copying: ${entry.relativePath}` }
    }

  } finally {
    try { await srcHandle.close() } catch { /* ignore */ }
  }

  return { success: true, bytesCopied: entry.sizeBytes }
}

export async function copyToSnapshot(
  files: ValidatedFileEntry[],
  destDir: string,
  limits: Gate0Limits,
  hooks?: Gate0CopyHooks
): Promise<{ success: false; reason: string } | { success: true }> {
  const readBuf = Buffer.allocUnsafe(COPY_CHUNK_SIZE)
  let packageBytesCopied = 0

  for (const file of files) {
    const result = await copyFileSecure(file, destDir, limits, packageBytesCopied, readBuf, hooks)
    if (!result.success) return result
    packageBytesCopied += result.bytesCopied
  }

  return { success: true }
}

// ── Public API ────────────────────────────────────────────────────────────────
//
// Ingestion flow:
//   1. Gate 0 walk   — validate filesystem structure; reject immediately on violation
//   2. Bounded copy  — write package into skills/.staging/<uuid>/ (never candidates/)
//   3. Gate 1        — validate schema and identity against the staging snapshot
//   4. Publish       — atomic rename staging/<uuid>/ → candidates/<uuid>/
//
// candidates/<uuid>/ is only visible after step 4 succeeds.
// A partially copied or Gate-1-rejected package appears only under staging/ or quarantine/.

export async function ingestSkillPackage(
  sourcePath: string,
  limits: Partial<Gate0Limits> = {},
  testOptions?: IngestTestOptions
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

  // Gate 0 walk passed — copy into staging.
  // The staging directory is Powerplant-controlled and is NOT visible under candidates/.
  // candidates/<uuid>/ is created only by the atomic rename at the end of this function.
  const candidateId = testOptions?.candidateId ?? randomUUID()
  const stagingPath = getStagingPath(candidateId)
  fs.mkdirSync(getStagingDir(), { recursive: true })
  fs.mkdirSync(stagingPath, { recursive: true, mode: 0o700 })

  const copyResult = await copyToSnapshot(
    walkResult.files,
    stagingPath,
    effectiveLimits,
    testOptions?.copyHooks
  )

  if (!copyResult.success) {
    // Gate 0 copy failure: remove the entire staging directory.
    // No candidate is published; candidateId is null in audit and result.
    try { fs.rmSync(stagingPath, { recursive: true, force: true }) } catch { /* best-effort */ }
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

  // Gate 1: schema and identity validation — operates only on the staging snapshot.
  const gate1Result = await validateCandidateSchema(stagingPath, candidateId)

  if (!gate1Result.success) {
    // Gate 1 failure: move the complete staging snapshot to quarantine.
    // The snapshot is never exposed under candidates/.
    const quarantinePath = getSkillQuarantineCandidatePath(candidateId)
    try {
      fs.mkdirSync(path.dirname(quarantinePath), { recursive: true })
      fs.renameSync(stagingPath, quarantinePath)
    } catch {
      // If rename fails (e.g., cross-device), clean up staging instead.
      try { fs.rmSync(stagingPath, { recursive: true, force: true }) } catch { /* best-effort */ }
    }

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
  // Write Powerplant-owned metadata into the staging snapshot. This file is always
  // distinct from any user-supplied manifest.json and must never overwrite it.
  fs.writeFileSync(
    path.join(stagingPath, POWERPLANT_META_FILENAME),
    JSON.stringify(gate1Result.manifest, null, 2),
    'utf-8'
  )

  // Atomic publication: rename staging/<uuid>/ → candidates/<uuid>/.
  // Both paths live under getSkillsDir(), so the rename is on the same filesystem.
  // If the destination already exists (UUID collision), fail closed — do not overwrite.
  const candidatePath = getCandidatePath(candidateId)
  fs.mkdirSync(getCandidatesDir(), { recursive: true })
  try {
    fs.renameSync(stagingPath, candidatePath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOTEMPTY' || code === 'EEXIST') {
      // Destination already exists — fail closed, clean up staging.
      try { fs.rmSync(stagingPath, { recursive: true, force: true }) } catch { /* best-effort */ }
      return {
        success: false,
        failedGate: 'GATE_0',
        reason: `Candidate destination already exists: ${candidateId}`,
        candidateId: null,
      }
    }
    throw err
  }

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
