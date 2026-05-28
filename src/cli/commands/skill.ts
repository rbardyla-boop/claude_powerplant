import { cmdSkillImport } from './skill-commands/import.js'

function printSkillUsage(): void {
  console.log('Usage:')
  console.log('  powerplant skill import <path>')
  console.log()
  console.log('Commands:')
  console.log('  import   Import a skill package into the Powerplant candidate vault')
  console.log()
  console.log('Phase 1A scope: import only.')
  console.log('Test, promote, rollback, list, and inspect arrive in later phases.')
}

export async function cmdSkill(args: string[]): Promise<void> {
  const subcommand = args[0]

  switch (subcommand) {
    case 'import': {
      const sourcePath = args[1]
      if (!sourcePath) {
        console.error('Error: path is required.')
        printSkillUsage()
        process.exit(1)
      }
      await cmdSkillImport(sourcePath)
      break
    }

    default:
      if (subcommand) {
        console.error(`Error: Unknown skill command '${subcommand}'`)
        console.error()
      }
      printSkillUsage()
      process.exit(subcommand ? 1 : 0)
  }
}
