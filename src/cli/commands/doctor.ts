import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { getPowerplantHome } from '../../config/powerplant-home.js'
import { loadState } from '../../platform/managed-agent-state.js'
import { loadSprint4aState } from '../../platform/sprint4a-state.js'
import { printDoctorReport } from '../terminal-output.js'
import { loadProjectContract } from '../../projects/load-project-contract.js'
import { resolveVerificationProfile } from '../../verification/verification-profiles.js'

function isDockerImagePresent(imageName: string): boolean {
  try {
    execFileSync('docker', ['inspect', '--type=image', imageName], {
      stdio: 'ignore',
      env: {},
    })
    return true
  } catch {
    return false
  }
}

export async function cmdDoctor(projectPath: string | null): Promise<void> {
  const home = getPowerplantHome()
  const apiKeyPresent = !!process.env['ANTHROPIC_API_KEY']
  const modelIdPresent = !!process.env['CLAUDE_POWERPLANT_MODEL_ID']

  const smokeState = loadState()
  const sprint4aState = loadSprint4aState()
  const runtimeReady = !!(smokeState?.environment?.id && sprint4aState?.agent?.id)

  let contractPresent = false
  let profileId: string | null = null
  let capsuleAvailable = false

  if (projectPath !== null) {
    const abs = path.resolve(projectPath)
    const policyFile = path.join(abs, '.powerplant', 'POLICY.yaml')
    contractPresent = fs.existsSync(policyFile)

    if (contractPresent) {
      try {
        const contract = loadProjectContract(abs)
        profileId = contract.verificationProfile
        if (profileId !== null) {
          const profile = resolveVerificationProfile(profileId)
          capsuleAvailable = isDockerImagePresent(profile.capsuleImageName)
        }
      } catch {
        // contract invalid — contractPresent stays true, profile stays null
      }
    }
  }

  printDoctorReport({
    home,
    apiKeyPresent,
    modelIdPresent,
    runtimeReady,
    projectPath: projectPath !== null ? path.resolve(projectPath) : null,
    contractPresent,
    profileId,
    capsuleAvailable,
    // Powerplant never reads a target-project .env
    targetProjectEnvLoaded: false,
  })
}
