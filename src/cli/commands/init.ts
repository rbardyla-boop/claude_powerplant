import fs from 'fs'
import path from 'path'
import { detectStack } from '../../projects/detect-stack.js'
import type { StackId } from '../../projects/detect-stack.js'
import { generateProjectId, generatePolicyYaml } from '../../projects/generate-policy.js'
import { generateVerifyYaml } from '../../projects/generate-verify.js'
import { loadProjectContract } from '../../projects/load-project-contract.js'

const VALID_STACKS: readonly StackId[] = ['node-ts', 'python', 'go', 'rust', 'generic']

interface InitOpts {
  yes: boolean
  force: boolean
  stackOverride: StackId | null
}

function parseInitArgs(rest: string[]): { projectPath: string | null } & InitOpts {
  let yes = false
  let force = false
  let stackOverride: StackId | null = null
  let projectPath: string | null = null

  let i = 0
  while (i < rest.length) {
    const arg = rest[i] ?? ''
    if (arg === '--yes' || arg === '-y') {
      yes = true
    } else if (arg === '--force') {
      force = true
    } else if (arg === '--stack') {
      i++
      const val = rest[i]
      if (!val) {
        console.error('Error: --stack requires a value. Valid stacks: ' + VALID_STACKS.join(', '))
        process.exit(1)
      }
      if (!(VALID_STACKS as readonly string[]).includes(val)) {
        console.error(`Error: Unknown stack '${val}'. Valid stacks: ${VALID_STACKS.join(', ')}`)
        process.exit(1)
      }
      stackOverride = val as StackId
    } else if (!arg.startsWith('-')) {
      projectPath = arg
    }
    i++
  }

  return { projectPath, yes, force, stackOverride }
}

export async function cmdInit(rest: string[]): Promise<void> {
  const { projectPath: rawPath, force, stackOverride } = parseInitArgs(rest)

  const projectPath = rawPath ?? process.cwd()
  const absPath = path.resolve(projectPath)

  if (!fs.existsSync(absPath)) {
    console.error(`Error: Project path does not exist: ${absPath}`)
    process.exit(1)
  }
  if (!fs.statSync(absPath).isDirectory()) {
    console.error(`Error: Project path is not a directory: ${absPath}`)
    process.exit(1)
  }

  const powerplantDir = path.join(absPath, '.powerplant')
  const policyPath = path.join(powerplantDir, 'POLICY.yaml')
  const verifyPath = path.join(powerplantDir, 'VERIFY.yaml')

  if (!force) {
    // Block only when generated files already exist — an empty .powerplant/ dir
    // (e.g. from a partial init or a state-only directory) is fine to init into.
    const blocked = fs.existsSync(policyPath) || fs.existsSync(verifyPath)
    if (blocked) {
      console.error('Error: .powerplant/POLICY.yaml or VERIFY.yaml already exists.')
      console.error('       Use --force to overwrite the generated files.')
      process.exit(1)
    }
  }

  const stack: StackId = stackOverride ?? detectStack(absPath)
  const projectId = generateProjectId(absPath)
  const policyContent = generatePolicyYaml(stack, projectId)
  const verifyContent = generateVerifyYaml(stack)

  fs.mkdirSync(powerplantDir, { recursive: true })
  fs.writeFileSync(policyPath, policyContent, 'utf-8')
  fs.writeFileSync(verifyPath, verifyContent, 'utf-8')

  console.log(`Initialized .powerplant/ for ${path.basename(absPath)} (stack: ${stack})`)
  console.log(`  Project ID : ${projectId}`)
  console.log(`  Stack      : ${stack}`)
  console.log(`  ${policyPath}`)
  console.log(`  ${verifyPath}`)

  try {
    loadProjectContract(absPath)
    console.log('Contract validation: OK')
  } catch (err) {
    const msg = String(err).replace(/^Error:\s*/, '')
    console.error(`\nWarning: Contract validation failed: ${msg}`)
    if (stack === 'generic') {
      console.error('  Add at least one check to .powerplant/VERIFY.yaml before running powerplant verify.')
    }
    process.exit(1)
  }
}
