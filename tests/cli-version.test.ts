import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const pkgRoot = path.join(path.dirname(__filename), '..')

// ── powerplant --version ──────────────────────────────────────────────────────

describe('powerplant --version', () => {
  it('package.json has a non-empty version field', async () => {
    const { createRequire } = await import('module')
    const req = createRequire(import.meta.url)
    const pkg = req(path.join(pkgRoot, 'package.json')) as { version: string }
    expect(typeof pkg.version).toBe('string')
    expect(pkg.version.trim()).not.toBe('')
  })

  it('version matches semver format', async () => {
    const { createRequire } = await import('module')
    const req = createRequire(import.meta.url)
    const pkg = req(path.join(pkgRoot, 'package.json')) as { version: string }
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('powerplant --version outputs "powerplant <version>"', () => {
    const out = execSync(
      'node --import=tsx src/cli/powerplant.ts --version',
      { cwd: pkgRoot, encoding: 'utf-8' },
    ).trim()
    expect(out).toMatch(/^powerplant \d+\.\d+\.\d+/)
  })

  it('powerplant -V produces the same output as --version', () => {
    const v1 = execSync(
      'node --import=tsx src/cli/powerplant.ts --version',
      { cwd: pkgRoot, encoding: 'utf-8' },
    ).trim()
    const v2 = execSync(
      'node --import=tsx src/cli/powerplant.ts -V',
      { cwd: pkgRoot, encoding: 'utf-8' },
    ).trim()
    expect(v1).toBe(v2)
  })
})
