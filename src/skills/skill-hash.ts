import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'

// ── Canonical payload identity ────────────────────────────────────────────────
//
// Gate 2 computes a SHA-256 hash over all imported payload files in the staging
// snapshot. The hash is deterministic regardless of filesystem enumeration order.
//
// Algorithm (POWERPLANT_SKILL_PAYLOAD_V1):
//   1. Collect all regular files in staging, excluding POWERPLANT_META_FILENAME.
//   2. Sort by normalized POSIX relative path (byte-lexicographic).
//   3. Feed domain separator into SHA-256.
//   4. For each file in sorted order:
//        uint32 BE   pathByteLength
//        bytes       normalizedRelPath UTF-8
//        uint64 BE   contentByteLength
//        bytes       exact file content
//   5. Finalize digest.
//
// Empty directories are excluded — only file bytes determine identity.
// Line endings and text encoding are NOT normalized before hashing.
//
// POWERPLANT_META_FILENAME is excluded because it is Powerplant-generated
// state written AFTER Gate 2+3 pass; it is not part of the imported payload.

const DOMAIN_SEPARATOR = Buffer.from('POWERPLANT_SKILL_PAYLOAD_V1\0', 'utf8')

// Files written by Powerplant to the staging/candidate directory — not payload.
const HASH_EXCLUDED_FILENAMES = new Set(['.powerplant-meta.json'])

// ── Payload file descriptor ───────────────────────────────────────────────────

export interface PayloadFile {
  normalizedRelPath: string
  absPath: string
}

// ── Walk result ───────────────────────────────────────────────────────────────

export type PayloadWalkResult =
  | { success: true; files: PayloadFile[] }
  | { success: false; reason: string }

// ── Walk ──────────────────────────────────────────────────────────────────────

export function walkPayloadFiles(stagedDir: string): PayloadWalkResult {
  const files: PayloadFile[] = []

  function walk(dir: string): string | null {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (err) {
      return `Cannot read staged directory: ${path.relative(stagedDir, dir) || '.'}: ${(err as Error).message}`
    }

    for (const entry of entries) {
      const absPath = path.join(dir, entry.name)
      const relPath = path.relative(stagedDir, absPath)
      const normalizedRelPath = relPath.split(path.sep).join('/')

      // Safety: staging is Powerplant-controlled but defend against any
      // unexpected traversal that would escape the root.
      if (normalizedRelPath.startsWith('/') || normalizedRelPath.split('/').includes('..')) {
        return `Path traversal detected in staged directory: ${relPath}`
      }

      if (entry.isSymbolicLink()) {
        return `Unexpected symlink in staged directory: ${relPath}`
      }

      if (entry.isDirectory()) {
        const err = walk(absPath)
        if (err) return err
        continue
      }

      if (!entry.isFile()) {
        return `Unexpected non-file entry in staged directory: ${relPath}`
      }

      // Skip Powerplant-owned metadata files from hash computation.
      if (HASH_EXCLUDED_FILENAMES.has(entry.name)) continue

      files.push({ normalizedRelPath, absPath })
    }

    return null
  }

  const err = walk(stagedDir)
  if (err) return { success: false, reason: err }

  // Sort by normalized relative path (byte-lexicographic). This ensures the
  // hash is independent of the order the OS enumerates directory entries.
  files.sort((a, b) => {
    if (a.normalizedRelPath < b.normalizedRelPath) return -1
    if (a.normalizedRelPath > b.normalizedRelPath) return 1
    return 0
  })

  // Reject duplicate canonical paths (e.g. from case-folding on case-insensitive FS).
  const seen = new Set<string>()
  for (const f of files) {
    if (seen.has(f.normalizedRelPath)) {
      return { success: false, reason: `Duplicate canonical path in staged directory: ${f.normalizedRelPath}` }
    }
    seen.add(f.normalizedRelPath)
  }

  return { success: true, files }
}

// ── Hash ──────────────────────────────────────────────────────────────────────

export function buildCanonicalHash(
  files: PayloadFile[],
  contents: Map<string, Buffer>
): string {
  const hash = createHash('sha256')
  hash.update(DOMAIN_SEPARATOR)

  for (const { normalizedRelPath } of files) {
    const content = contents.get(normalizedRelPath)
    if (content === undefined) {
      throw new Error(`Missing content for payload file: ${normalizedRelPath}`)
    }

    const pathBytes = Buffer.from(normalizedRelPath, 'utf8')

    // uint32 BE: path byte length
    const pathLenBuf = Buffer.allocUnsafe(4)
    pathLenBuf.writeUInt32BE(pathBytes.length, 0)
    hash.update(pathLenBuf)
    hash.update(pathBytes)

    // uint64 BE: content byte length (written as two uint32 for Node portability)
    const hi = Math.floor(content.length / 0x100000000)
    const lo = content.length >>> 0
    const contentLenBuf = Buffer.allocUnsafe(8)
    contentLenBuf.writeUInt32BE(hi, 0)
    contentLenBuf.writeUInt32BE(lo, 4)
    hash.update(contentLenBuf)

    hash.update(content)
  }

  return hash.digest('hex')
}
