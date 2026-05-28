import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import readline from 'readline'
import { SPRINT4A_PILOT_CONTRACT } from '../../contracts/project-pilot-contract.js'
import {
  PILOT_ALLOWED_READ_PATHS,
  PILOT_ALLOWED_WRITE_PATHS,
  PILOT_ALLOWED_CHECK_IDS,
} from '../../contracts/project-pilot-contract.js'
import { previewSanitization } from '../../projects/preview-sanitization.js'
import { buildPilotSnapshot } from '../../projects/build-pilot-snapshot.js'
import { verifySourceUnchanged } from '../../projects/verify-source-unchanged.js'
import { runProjectPilotBrokerSession } from '../../broker/project-tool-broker.js'
import { ensureSprint4aAgent } from '../../provision/ensure-sprint4a-agent.js'
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

  const contract = { ...SPRINT4A_PILOT_CONTRACT, sourcePath: absPath }

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
    allowedReadPaths: [...PILOT_ALLOWED_READ_PATHS],
    allowedWritePaths: [...PILOT_ALLOWED_WRITE_PATHS],
    allowedChecks: [...PILOT_ALLOWED_CHECK_IDS],
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
    console.error('Export it in your shell or ensure .env is loaded before running.')
    process.exit(1)
  }

  const controlClient = new Anthropic({ apiKey })

  console.log()
  console.log('Provisioning agent (or loading existing)...')

  let state
  try {
    state = await ensureSprint4aAgent(controlClient)
  } catch (err) {
    console.error(`Error: Failed to load agent state: ${String(err)}`)
    console.error('Run the Sprint 1A provisioning step first: npm run smoke:cloud')
    process.exit(1)
  }

  if (!state.agent) {
    console.error('Error: Agent not provisioned. Run: npm run smoke:pilot:project')
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

  // Append mandatory procedure reminder so Haiku calls project_run_check + project_finalize
  const wrappedTask =
    `${task.trim()}\n\n` +
    `After implementing the task:\n` +
    `1. Call project_run_check with { "check": "test" }.\n` +
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
