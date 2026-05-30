import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

// Directories that must never enter the manifest — large, volatile, or non-source
const SKIP_DIR_NAMES = new Set(['.git', 'node_modules', '.powerplant'])

/**
 * Walk `dirPath`, hash every regular file (sorted by relative path), and
 * return a single SHA-256 over the combined manifest. Returns `'EMPTY'` when
 * the directory is absent or contains no readable files.
 *
 * Skips `.git`, `node_modules`, and `.powerplant` to keep the hash stable
 * across dependency installs and runtime-state writes.
 */
export function computeDirectoryManifestHash(dirPath: string): string {
  if (!fs.existsSync(dirPath)) return 'EMPTY'

  const entries: Array<{ rel: string; hash: string }> = []

  function walk(dir: string, base: string): void {
    let names: string[]
    try { names = fs.readdirSync(dir).sort() } catch { return }
    for (const name of names) {
      if (SKIP_DIR_NAMES.has(name)) continue
      const full = path.join(dir, name)
      try {
        const stat = fs.statSync(full)
        if (stat.isDirectory()) {
          walk(full, base)
        } else if (stat.isFile()) {
          const content = fs.readFileSync(full)
          entries.push({
            rel: path.relative(base, full),
            hash: crypto.createHash('sha256').update(content).digest('hex'),
          })
        }
      } catch { /* skip unreadable entries */ }
    }
  }

  walk(dirPath, dirPath)
  if (entries.length === 0) return 'EMPTY'

  const manifest = entries.map(e => `${e.rel}:${e.hash}`).join('\n')
  return crypto.createHash('sha256').update(manifest, 'utf-8').digest('hex')
}
