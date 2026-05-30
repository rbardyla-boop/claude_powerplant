import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

function walkRunDir(dir: string): Array<{ rel: string; hash: string }> {
  const results: Array<{ rel: string; hash: string }> = []
  function walk(current: string): void {
    for (const entry of fs.readdirSync(current).sort()) {
      const abs = path.join(current, entry)
      const stat = fs.lstatSync(abs)
      if (stat.isDirectory()) {
        walk(abs)
      } else {
        const content = fs.readFileSync(abs)
        const hash = crypto.createHash('sha256').update(content).digest('hex')
        results.push({ rel: path.relative(dir, abs).replace(/\\/g, '/'), hash })
      }
    }
  }
  walk(dir)
  results.sort((a, b) => a.rel.localeCompare(b.rel))
  return results
}

export function computeRunHash(runDir: string): string {
  const entries = walkRunDir(runDir)
  const manifest = entries.map(e => `${e.rel}:${e.hash}`).join('\n')
  return crypto.createHash('sha256').update(manifest).digest('hex')
}
