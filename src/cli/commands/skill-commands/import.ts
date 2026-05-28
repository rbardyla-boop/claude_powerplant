import path from 'path'
import { ingestSkillPackage } from '../../../skills/skill-ingestion.js'

export async function cmdSkillImport(sourcePath: string): Promise<void> {
  const resolved = path.resolve(sourcePath)
  console.log(`Importing skill from: ${resolved}`)

  const result = await ingestSkillPackage(sourcePath)

  if (!result.success) {
    console.error(`\nImport rejected at ${result.failedGate}`)
    console.error(`Reason: ${result.reason}`)
    if (result.candidateId) {
      console.error(`Candidate moved to quarantine: ${result.candidateId}`)
    }
    process.exit(1)
  }

  console.log(`\nSkill imported successfully`)
  console.log(`  Name:         ${result.name}`)
  console.log(`  Candidate ID: ${result.candidateId}`)
  console.log(`  Location:     ${result.candidatePath}`)
  console.log(`  Gates:        ${result.gatesCompleted.join(', ')}`)
  console.log(`\nRun 'powerplant skill test --candidate ${result.candidateId}' to evaluate before promoting.`)
}
