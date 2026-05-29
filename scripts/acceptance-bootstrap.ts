// scripts/acceptance-bootstrap.ts — NOT a production entrypoint.
// Usage: node --import=tsx scripts/acceptance-bootstrap.ts <fixture-dir>
//
// POWERPLANT_HOME must be set to the isolated acceptance root before running.
// All lifecycle writes go to ${POWERPLANT_HOME}/state/.
//
// The bootstrap script verifies both acceptance labels are present in SKILL.md
// before calling the lifecycle API. Per §4.2 of the Stage 2B live acceptance plan,
// a fixture file missing either label is rejected without ingestion.

import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { ingestSkillPackage } from '../src/skills/skill-ingestion.js'
import { validateSkill, promoteSkill } from '../src/skills/skill-lifecycle.js'

export const L0_FIXTURE_RECEIPT_FILENAME = 'l0-fixture-receipt.json'

const REQUIRED_LABEL_1 = '<!-- ISOLATED_ACCEPTANCE_GUIDANCE_FIXTURE -->'
const REQUIRED_LABEL_2 = '<!-- ACCEPTANCE_STATE_ONLY_NOT_PRODUCTION_PROMOTION_EVIDENCE -->'

async function bootstrapAcceptanceSkill(fixtureDir: string): Promise<void> {
  const resolvedFixture = path.resolve(fixtureDir)

  const skillMdPath = path.join(resolvedFixture, 'SKILL.md')
  let skillMdContent: string
  try {
    skillMdContent = readFileSync(skillMdPath, 'utf-8')
  } catch {
    throw new Error(`SKILL.md not found at ${skillMdPath}`)
  }
  if (!skillMdContent.includes(REQUIRED_LABEL_1)) {
    throw new Error(`SKILL.md missing required label: ${REQUIRED_LABEL_1}`)
  }
  if (!skillMdContent.includes(REQUIRED_LABEL_2)) {
    throw new Error(`SKILL.md missing required label: ${REQUIRED_LABEL_2}`)
  }

  console.log(`POWERPLANT_HOME=${process.env['POWERPLANT_HOME'] ?? '(unset — will default to ~/.powerplant)'}`)
  console.log(`Fixture: ${resolvedFixture}`)

  const ingested = await ingestSkillPackage(resolvedFixture)
  if (!ingested.success) {
    throw new Error(`Ingest failed at ${ingested.failedGate}: ${ingested.reason}`)
  }
  console.log(`Ingest: GATE_0+GATE_1 passed; candidateId=${ingested.candidateId}`)

  const validated = await validateSkill(ingested.candidateId)
  if (!validated.success) {
    throw new Error(`Validate failed: ${validated.reason}`)
  }
  console.log(`Validate: Gate 2 passed; hash=${validated.contentHash}`)

  const promoted = promoteSkill(ingested.candidateId)
  if (!promoted.success) {
    throw new Error(`Promote failed: ${promoted.reason}`)
  }

  console.log(`ACCEPTANCE_FIXTURE_INSTALLED skillId=${promoted.name} hash=${promoted.contentHash}`)

  // Write the immutable L0 fixture receipt — the canonical source of truth for
  // fixtureAContentHash in the production L1 CLI. Written once after promotion;
  // never rewritten by normal Powerplant operations.
  const ppHome = process.env['POWERPLANT_HOME'] ?? path.join(os.homedir(), '.powerplant')
  const receiptPath = path.join(ppHome, 'state', L0_FIXTURE_RECEIPT_FILENAME)
  mkdirSync(path.dirname(receiptPath), { recursive: true })
  writeFileSync(
    receiptPath,
    JSON.stringify({
      schemaVersion: 1,
      fixtureSkillId: promoted.name,
      contentHash: promoted.contentHash,
      installedAt: new Date().toISOString(),
    }, null, 2) + '\n',
    'utf-8',
  )
  console.log(`L0_FIXTURE_RECEIPT_WRITTEN ${receiptPath}`)
}

const fixtureDir = process.argv[2]
if (!fixtureDir) {
  console.error('Usage: node --import=tsx scripts/acceptance-bootstrap.ts <fixture-dir>')
  process.exit(1)
}

bootstrapAcceptanceSkill(fixtureDir).catch((err: unknown) => {
  console.error('Bootstrap failed:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
