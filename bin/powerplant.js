#!/usr/bin/env node
// Shim: locates tsx in the package's node_modules and runs the TypeScript entry point.
// Installed by `npm link` as a global binary named `powerplant`.
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { spawnSync } from 'child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const pkgRoot = join(__dirname, '..')

// Use the project-local tsx — no global install required
const tsxBin = join(pkgRoot, 'node_modules', '.bin', 'tsx')
const entry = join(pkgRoot, 'src', 'cli', 'powerplant.ts')

const { status } = spawnSync(tsxBin, [entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
})

process.exit(status ?? 0)
