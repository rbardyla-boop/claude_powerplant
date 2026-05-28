import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { getPowerplantHome } from '../../config/powerplant-home.js'
import { loadState } from '../../platform/managed-agent-state.js'
import { loadSprint4aState } from '../../platform/sprint4a-state.js'
import { loadOperatorState, isStatePlausible, isStateValidated } from '../../platform/operator-state.js'
import { printDoctorReport } from '../terminal-output.js'
import type { DoctorReportOptions } from '../terminal-output.js'
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

function detectCredentialSource(): DoctorReportOptions['credentialSource'] {
  if (!process.env['ANTHROPIC_API_KEY']) return 'none'
  // If POWERPLANT_HOME/.env was loaded it sets the key before this runs.
  // We can only distinguish "was it set by the shell" from "was it already present":
  // loadPowerplantEnv() is a no-op when the key is already set, so if we see it
  // present we report 'env' (shell) unless the key matches a pattern we can't
  // distinguish — in practice just report 'env' as the safe default.
  return 'env'
}

export async function cmdDoctor(projectPath: string | null): Promise<void> {
  const home = getPowerplantHome()
  const apiKeyPresent = !!process.env['ANTHROPIC_API_KEY']
  const modelIdPresent = !!process.env['CLAUDE_POWERPLANT_MODEL_ID']

  const smokeState = loadState()
  const sprint4aState = loadSprint4aState()
  const operatorState = loadOperatorState()

  const runtimeReady = !!(
    (operatorState && isStatePlausible(operatorState)) ||
    (smokeState?.environment?.id && sprint4aState?.agent?.id)
  )

  let validationStatus: DoctorReportOptions['validationStatus']
  if (operatorState && isStatePlausible(operatorState)) {
    validationStatus = isStateValidated(operatorState) ? 'validated' : 'unvalidated'
  } else {
    validationStatus = 'not_configured'
  }

  const statePurpose = operatorState?.resourcePurpose ?? null
  const credentialSource = detectCredentialSource()

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
    validationStatus,
    credentialSource,
    statePurpose,
    projectPath: projectPath !== null ? path.resolve(projectPath) : null,
    contractPresent,
    profileId,
    capsuleAvailable,
    // Powerplant never reads a target-project .env
    targetProjectEnvLoaded: false,
  })
}
