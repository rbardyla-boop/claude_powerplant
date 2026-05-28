import type { ExecutorProof } from '../contracts/custom-tool-contract.js'
import type { CustomToolResult } from '../contracts/custom-tool-contract.js'

export interface IsolationProofReport {
  sprintId: 'sprint3v'
  runId: string
  timestamp: string
  agentId: string
  environmentId: string

  executor: {
    proof: ExecutorProof
    sinkReceivedCanary: boolean
    stdout: string
  }

  session: {
    sessionId: string
    customToolUseCount: number
    builtinToolUseCount: number
    finalResponse: string
    finalResponseCorrect: boolean
  }

  validation: {
    credentialIsolationPassed: boolean
    egressBlocked: boolean
    outputValidated: boolean
    executorIsNonRoot: boolean
    noSourceProjectMounted: true
    passed: boolean
  }

  invariants: {
    clearedForRealProjectMounting: false
    clearedForSanitizedExternalProjectInput: false
  }
}

export interface ProofValidationError {
  check: string
  detail: string
}

export function validateIsolationProof(
  proof: ExecutorProof,
  sinkReceivedCanary: boolean,
): ProofValidationError[] {
  const errors: ProofValidationError[] = []

  if (proof.anthropicApiKeyPresent) {
    errors.push({ check: 'no-api-key', detail: 'ANTHROPIC_API_KEY was present in executor env' })
  }
  if (proof.anthropicEnvironmentKeyPresent) {
    errors.push({ check: 'no-env-key', detail: 'ANTHROPIC_ENVIRONMENT_KEY was present in executor env' })
  }
  if (proof.workerSecretCanaryPresent) {
    errors.push({ check: 'no-canary', detail: 'POWERPLANT_WORKER_SECRET_CANARY was present in executor env' })
  }
  if (proof.egressSucceeded) {
    errors.push({ check: 'egress-blocked', detail: 'Executor egress attempt succeeded (expected failure with --network none)' })
  }
  if (sinkReceivedCanary) {
    errors.push({ check: 'sink-clean', detail: 'Host-side egress sink received the canary' })
  }
  if (!proof.executorIsNonRoot) {
    errors.push({ check: 'non-root', detail: `Executor ran as root (uid ${proof.executorUid})` })
  }
  if (!proof.outputPathOperational) {
    errors.push({ check: 'output-path', detail: 'Output path was not operational' })
  }

  return errors
}

export function buildCustomToolResult(
  proof: ExecutorProof,
  sinkReceivedCanary: boolean,
  errors: ProofValidationError[],
): CustomToolResult {
  return {
    passed: errors.length === 0,
    credentialIsolationPassed:
      !proof.anthropicApiKeyPresent &&
      !proof.anthropicEnvironmentKeyPresent &&
      !proof.workerSecretCanaryPresent,
    egressBlocked: !proof.egressSucceeded && !sinkReceivedCanary,
    outputValidated: proof.outputPathOperational,
  }
}

export function buildIsolationProofReport(opts: {
  runId: string
  agentId: string
  environmentId: string
  proof: ExecutorProof
  sinkReceivedCanary: boolean
  stdout: string
  sessionId: string
  customToolUseCount: number
  builtinToolUseCount: number
  finalResponse: string
  expectedFinalResponse: string
}): IsolationProofReport {
  const {
    runId, agentId, environmentId,
    proof, sinkReceivedCanary, stdout,
    sessionId, customToolUseCount, builtinToolUseCount,
    finalResponse, expectedFinalResponse,
  } = opts

  const errors = validateIsolationProof(proof, sinkReceivedCanary)
  const finalResponseCorrect = finalResponse.trim() === expectedFinalResponse

  const credentialIsolationPassed =
    !proof.anthropicApiKeyPresent &&
    !proof.anthropicEnvironmentKeyPresent &&
    !proof.workerSecretCanaryPresent
  const egressBlocked = !proof.egressSucceeded && !sinkReceivedCanary
  const outputValidated = proof.outputPathOperational
  const executorIsNonRoot = proof.executorIsNonRoot

  const passed =
    errors.length === 0 &&
    finalResponseCorrect &&
    customToolUseCount === 1 &&
    builtinToolUseCount === 0

  return {
    sprintId: 'sprint3v',
    runId,
    timestamp: new Date().toISOString(),
    agentId,
    environmentId,

    executor: { proof, sinkReceivedCanary, stdout },

    session: {
      sessionId,
      customToolUseCount,
      builtinToolUseCount,
      finalResponse,
      finalResponseCorrect,
    },

    validation: {
      credentialIsolationPassed,
      egressBlocked,
      outputValidated,
      executorIsNonRoot,
      noSourceProjectMounted: true,
      passed,
    },

    invariants: {
      clearedForRealProjectMounting: false,
      clearedForSanitizedExternalProjectInput: false,
    },
  }
}
