/**
 * Local proof: builds a sanitized snapshot of the pilot project,
 * validates it, and reports findings. No API calls, no Docker.
 */
import fs from 'fs'
import path from 'path'
import { buildPilotSnapshot } from '../projects/build-pilot-snapshot.js'
import { verifySourceUnchanged } from '../projects/verify-source-unchanged.js'
import { resolveSprint4aPilotSourcePath, SPRINT4A_RUNTIME_BASE } from '../config/constants.js'
import { SPRINT4A_PILOT_CONTRACT } from '../contracts/project-pilot-contract.js'

console.log()
console.log('=== proof:pilot:snapshot — Sanitized Snapshot Proof ===')
console.log()

const pilotSourcePath = resolveSprint4aPilotSourcePath()
const contract = { ...SPRINT4A_PILOT_CONTRACT, sourcePath: pilotSourcePath }
const runId = `snapshot-proof-${Date.now()}`
const runDir = path.join(SPRINT4A_RUNTIME_BASE, runId)

fs.mkdirSync(runDir, { recursive: true })

console.log(`Source: ${pilotSourcePath}`)
console.log(`Run dir: ${runDir}`)
console.log()

console.log('[snapshot] Building sanitized snapshot...')
const snapshot = buildPilotSnapshot(contract, runDir)

console.log()
console.log('=== Source Manifest ===')
console.log(`  Files: ${snapshot.sourceManifest.files.length}`)
for (const { relativePath } of snapshot.sourceManifest.files) {
  console.log(`    ${relativePath}`)
}

console.log()
console.log('=== Sanitized Manifest ===')
console.log(`  Files: ${snapshot.sanitizedManifest.files.length}`)
for (const { relativePath } of snapshot.sanitizedManifest.files) {
  console.log(`    ${relativePath}`)
}

console.log()
console.log('=== Canary Checks ===')
const canaryFiles = ['.env', 'private/secret.txt', 'deployment/release.txt']
for (const rel of canaryFiles) {
  const inBaseline = fs.existsSync(path.join(snapshot.baselinePath, rel))
  const inWorkspace = fs.existsSync(path.join(snapshot.workspacePath, rel))
  console.log(`  ${rel}:  baseline=${inBaseline}  workspace=${inWorkspace}  (both should be false)`)
  if (inBaseline || inWorkspace) {
    console.error(`  FAIL: ${rel} present in snapshot — sanitizer failed`)
    process.exit(1)
  }
}
console.log('  All forbidden paths absent from snapshot: PASSED')

console.log()
console.log('=== Source Unchanged After Snapshot ===')
const verification = verifySourceUnchanged(snapshot)
console.log(`  sourceUnmodified: ${verification.sourceUnmodified}`)
if (!verification.sourceUnmodified) {
  console.error('  FAIL: source was modified during snapshot')
  process.exit(1)
}
console.log('  Source unchanged: PASSED')

console.log()
console.log('=== Results ===')
console.log(`  baselinePath:   ${snapshot.baselinePath}`)
console.log(`  workspacePath:  ${snapshot.workspacePath}`)
console.log(`  sanitizedFiles: ${snapshot.sanitizedManifest.files.length}`)
console.log(`  allForbiddenAbsent: ${snapshot.sanitizedManifest.allForbiddenAbsent}`)
console.log(`  sourceUnmodified:   ${verification.sourceUnmodified}`)
console.log()
console.log('proof:pilot:snapshot: PASSED')
console.log()
