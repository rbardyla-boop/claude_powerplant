/**
 * Validates the external pilot project exists at the expected path.
 * If it is missing, prints creation instructions and exits with code 1.
 * Does NOT modify the pilot project — read-only check.
 */
import fs from 'fs'
import path from 'path'
import { resolveSprint4aPilotSourcePath } from '../config/constants.js'

const pilotPath = resolveSprint4aPilotSourcePath()

console.log()
console.log('=== pilot:create — External Pilot Project Validator ===')
console.log()
console.log(`Expected location: ${pilotPath}`)

const required = [
  'package.json',
  'README.md',
  'src/status.js',
  'tests/status.test.js',
  '.powerplant/PROJECT.md',
  '.powerplant/POLICY.yaml',
  '.powerplant/VERIFY.yaml',
  '.powerplant/QUALITY.md',
  '.env',
  'private/secret.txt',
  'deployment/release.txt',
]

const forbidden = ['.env', 'private/secret.txt', 'deployment/release.txt']
const CANARY = 'POWERPLANT_FORBIDDEN'

let allOk = true

for (const rel of required) {
  const abs = path.join(pilotPath, rel)
  const exists = fs.existsSync(abs)
  console.log(`  ${exists ? '✓' : '✗'} ${rel}`)
  if (!exists) allOk = false
}

console.log()
console.log('Canary checks (forbidden files must contain the canary string):')
for (const rel of forbidden) {
  const abs = path.join(pilotPath, rel)
  if (fs.existsSync(abs)) {
    const content = fs.readFileSync(abs, 'utf-8')
    const hasCanary = content.includes(CANARY)
    console.log(`  ${hasCanary ? '✓' : '✗'} ${rel} contains ${CANARY}`)
    if (!hasCanary) allOk = false
  } else {
    console.log(`  ✗ ${rel} missing`)
    allOk = false
  }
}

console.log()
if (allOk) {
  console.log('Pilot project: OK')
} else {
  console.log('Pilot project: INVALID — create it at:', pilotPath)
  process.exit(1)
}
console.log()
