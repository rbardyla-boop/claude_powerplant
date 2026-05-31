import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import readline from 'readline'
import { loadProjectContract } from '../../projects/load-project-contract.js'
import { previewSanitization } from '../../projects/preview-sanitization.js'
import { buildPilotSnapshot } from '../../projects/build-pilot-snapshot.js'
import { verifySourceUnchanged } from '../../projects/verify-source-unchanged.js'
import { runProjectPilotBrokerSession } from '../../broker/project-tool-broker.js'
import { ensureSprint4aAgent } from '../../provision/ensure-sprint4a-agent.js'
import { loadOperatorState, isStatePlausible } from '../../platform/operator-state.js'
import { makeRunArtifactDirectory } from '../../runs/find-run.js'
import { printRunDisclosureSummary, printRunSummary } from '../terminal-output.js'
import { loadSession } from '../../sessions/session-chain.js'
import { buildSessionRunSnapshot } from '../../sessions/session-workspace.js'
import { ScoutCandidateSchema } from '../../scout/scout-candidate.js'
import { deriveTaskFromCandidate, CandidateScopeError, type CandidateScope } from '../../scout/derive-task.js'

// Workspace must be under /tmp — Docker executor enforces this
const WORKSPACE_TMP_BASE = '/tmp/powerplant-runs'

function validateProjectPath(projectPath: string): string {
  const abs = path.resolve(projectPath)
  if (!fs.existsSync(abs)) {
    throw new Error(`Project path does not exist: ${abs}`)
  }
  if (!fs.statSync(abs).isDirectory()) {
    throw new Error(`Project path is not a directory: ${abs}`)
  }
  const policyFile = path.join(abs, '.powerplant', 'POLICY.yaml')
  if (!fs.existsSync(policyFile)) {
    throw new Error(
      `No .powerplant/POLICY.yaml found in: ${abs}\n` +
      'Only projects with a .powerplant/ contract folder are supported.',
    )
  }
  return abs
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'y')
    })
  })
}

export async function cmdRun(
  projectPath: string,
  task: string,
  opts: { yes: boolean; sessionId?: string; candidatePath?: string },
): Promise<void> {
  let absPath: string
  try {
    absPath = validateProjectPath(projectPath)
  } catch (err) {
    console.error(`Error: ${String(err).replace('Error: ', '')}`)
    process.exit(1)
  }

  // Load and validate the actual project contract from POLICY.yaml + VERIFY.yaml
  let contract
  try {
    contract = loadProjectContract(absPath)
  } catch (err) {
    console.error(`Error: Contract load failed — ${String(err).replace('Error: ', '')}`)
    process.exit(1)
  }

  // A scout candidate drives the run by deriving the task and bounding it to its
  // declared scope. The candidate file is untrusted input: deriveTaskFromCandidate
  // re-enforces the contract ceiling and fails closed if the candidate names
  // files or checks the contract does not permit.
  let candidateScope: CandidateScope | null = null
  if (opts.candidatePath) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.resolve(opts.candidatePath), 'utf-8'))
      const candidate = ScoutCandidateSchema.parse(raw)
      const derived = deriveTaskFromCandidate(candidate, contract)
      task = derived.task
      candidateScope = derived.scope
    } catch (err) {
      if (err instanceof CandidateScopeError) {
        console.error(`Error: ${err.message}`)
      } else {
        console.error(
          `Error: Failed to load candidate from ${opts.candidatePath} — ` +
          `${String(err).replace('Error: ', '')}`,
        )
      }
      process.exit(1)
    }
  } else if (!task.trim()) {
    console.error('Error: task must not be empty.')
    console.error('Usage: powerplant run <project-path> "<task description>"')
    process.exit(1)
  }

  const declaredChecks = Object.keys(contract.allowedChecks)

  // Session validation — must happen before disclosure so we can refuse early
  if (opts.sessionId) {
    let session
    try {
      session = loadSession(opts.sessionId)
    } catch (err) {
      console.error(`Error: ${String(err).replace('Error: ', '')}`)
      process.exit(1)
    }
    if (session.status === 'closed') {
      console.error(`Error: Session ${opts.sessionId} is closed. Cannot run against a closed session.`)
      process.exit(1)
    }
    if (session.projectId !== contract.projectId) {
      console.error(
        `Error: Session project ID (${session.projectId}) does not match ` +
        `project contract (${contract.projectId}).`,
      )
      process.exit(1)
    }
  }

  if (!opts.sessionId) {
    let preview
    try {
      preview = previewSanitization(contract)
    } catch (err) {
      console.error(`Error during sanitization preview: ${String(err)}`)
      process.exit(1)
    }

    const projectName = path.basename(absPath)
    printRunDisclosureSummary({
      projectName,
      preview,
      allowedReadPaths: contract.allowedReadPaths,
      allowedWritePaths: contract.allowedWritePaths,
      allowedChecks: declaredChecks,
      forbiddenPaths: contract.excludePaths,
    })
  }

  if (!opts.yes) {
    const ok = await confirm('Continue? [y/N] ')
    if (!ok) {
      console.log('Aborted.')
      process.exit(0)
    }
  }

  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY is not set.')
    console.error('Set it in your shell or add it to ~/.powerplant/.env')
    process.exit(1)
  }

  // Validate operator state before touching API or creating a snapshot
  const operatorState = loadOperatorState()
  if (!operatorState || !isStatePlausible(operatorState)) {
    console.error('Error: Powerplant runtime is not set up. Run: powerplant setup')
    process.exit(1)
  }

  const controlClient = new Anthropic({ apiKey })

  console.log()
  console.log('Provisioning agent (or loading existing)...')

  let state
  try {
    state = await ensureSprint4aAgent(controlClient)
  } catch (err) {
    const msg = String(err).replace('Error: ', '')
    if (msg.includes('not set up')) {
      console.error('Error: Powerplant runtime is not set up. Run: powerplant setup')
    } else {
      console.error(`Error: Failed to load agent state: ${msg}`)
    }
    process.exit(1)
  }

  if (!state.agent) {
    console.error('Error: Agent not provisioned. Run: powerplant setup')
    process.exit(1)
  }

  const runId = `pp-run-${Date.now()}`

  // Workspace under /tmp (Docker requirement)
  const runDir = path.join(WORKSPACE_TMP_BASE, runId)
  const outputDir = path.join(runDir, 'executor-outputs')
  fs.mkdirSync(runDir, { recursive: true })
  fs.mkdirSync(outputDir, { recursive: true })

  // Patch artifacts stored persistently under ~/.powerplant/runs/
  const patchDir = makeRunArtifactDirectory(contract.projectId, runId)

  // Persist candidate scope so `review` can prove the patch stayed inside the
  // candidate's declared files (scope-drift detection).
  if (candidateScope) {
    fs.writeFileSync(
      path.join(patchDir, 'CANDIDATE_SCOPE.json'),
      JSON.stringify(candidateScope, null, 2) + '\n',
      'utf-8',
    )
  }

  console.log()
  console.log(`Run ID:    ${runId}`)
  console.log(`Task:      ${task}`)

  let snapshot
  if (opts.sessionId) {
    // Re-load session here (already validated above, but state may have changed)
    let session
    try {
      session = loadSession(opts.sessionId)
    } catch (err) {
      console.error(`Error: ${String(err).replace('Error: ', '')}`)
      process.exit(1)
    }
    console.log(`Session:   ${session.sessionId} (chain: ${session.chainLinks.length})`)
    console.log('Building session workspace...')
    try {
      snapshot = buildSessionRunSnapshot(session, contract, runDir, patchDir)
    } catch (err) {
      console.error(`Error building session workspace: ${String(err)}`)
      process.exit(1)
    }
    console.log(`Workspace: ${snapshot.sanitizedManifest.files.length} files from session`)
  } else {
    console.log('Building sanitized snapshot...')
    try {
      snapshot = buildPilotSnapshot(contract, runDir)
    } catch (err) {
      console.error(`Error building snapshot: ${String(err)}`)
      process.exit(1)
    }
    console.log(`Snapshot:  ${snapshot.sanitizedManifest.files.length} files`)
  }
  console.log('Starting broker session...')

  // Append mandatory procedure reminder so the agent calls project_run_check + project_finalize.
  // Reference the first declared check ID so the instruction is contract-driven.
  const firstCheckId = declaredChecks[0] ?? 'test'
  const wrappedTask =
    `${task.trim()}\n\n` +
    `After implementing the task:\n` +
    `1. Call project_run_check with { "check": "${firstCheckId}" }.\n` +
    `2. If tests fail, fix the implementation or tests and re-run.\n` +
    `3. After tests pass, call project_finalize with a brief summary.\n` +
    `4. Respond with exactly: SANITIZED PILOT PATCH COMPLETE`

  let brokerResult
  try {
    brokerResult = await runProjectPilotBrokerSession({
      client: controlClient,
      agentId: state.agent.id,
      agentVersion: state.agent.version,
      environmentId: state.environmentId,
      snapshot,
      contract,
      runId,
      outputDir,
      patchDir,
      taskDescription: task,
      agentMessage: wrappedTask,
    })
  } catch (err) {
    console.error(`Error during broker session: ${String(err)}`)
    process.exit(1)
  }

  const sourceVerification = verifySourceUnchanged(snapshot)

  // Read patch diff for display
  let patchDiff = ''
  const patchDiffPath = path.join(patchDir, 'PATCH.diff')
  if (fs.existsSync(patchDiffPath)) {
    patchDiff = fs.readFileSync(patchDiffPath, 'utf-8')
  }

  const checksPassed = brokerResult.checkResults !== null &&
    brokerResult.checkResults.every(r => r.verdict === 'PASS')

  const passed =
    checksPassed &&
    sourceVerification.sourceUnmodified &&
    brokerResult.builtinToolUseCount === 0

  printRunSummary({
    runId,
    task,
    passed,
    testsPassed: checksPassed,
    customToolCounts: brokerResult.customToolCounts,
    builtInToolUseCount: brokerResult.builtinToolUseCount,
    patchFiles: brokerResult.patchPackage?.patchFiles ?? [],
    sourceUnmodified: sourceVerification.sourceUnmodified,
    artifactDir: patchDir,
    patchDiff,
    patchArtifactsWritten: brokerResult.patchPackage !== null,
  })

  if (!passed) process.exit(1)
}
