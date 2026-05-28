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
  opts: { yes: boolean },
): Promise<void> {
  if (!task || !task.trim()) {
    console.error('Error: task must not be empty.')
    console.error('Usage: powerplant run <project-path> "<task description>"')
    process.exit(1)
  }

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

  let preview
  try {
    preview = previewSanitization(contract)
  } catch (err) {
    console.error(`Error during sanitization preview: ${String(err)}`)
    process.exit(1)
  }

  const projectName = path.basename(absPath)
  const declaredChecks = Object.keys(contract.allowedChecks)

  printRunDisclosureSummary({
    projectName,
    preview,
    allowedReadPaths: contract.allowedReadPaths,
    allowedWritePaths: contract.allowedWritePaths,
    allowedChecks: declaredChecks,
    forbiddenPaths: contract.excludePaths,
  })

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

  console.log()
  console.log(`Run ID:    ${runId}`)
  console.log(`Task:      ${task}`)
  console.log('Building sanitized snapshot...')

  let snapshot
  try {
    snapshot = buildPilotSnapshot(contract, runDir)
  } catch (err) {
    console.error(`Error building snapshot: ${String(err)}`)
    process.exit(1)
  }

  console.log(`Snapshot:  ${snapshot.sanitizedManifest.files.length} files`)
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

  const passed =
    (brokerResult.verification?.passed ?? false) &&
    sourceVerification.sourceUnmodified &&
    brokerResult.builtinToolUseCount === 0

  printRunSummary({
    runId,
    task,
    passed,
    testsPassed: brokerResult.verification?.passed ?? false,
    customToolCounts: brokerResult.customToolCounts,
    builtInToolUseCount: brokerResult.builtinToolUseCount,
    patchFiles: brokerResult.patchPackage?.patchFiles ?? [],
    sourceUnmodified: sourceVerification.sourceUnmodified,
    artifactDir: patchDir,
    patchDiff,
  })

  if (!passed) process.exit(1)
}
