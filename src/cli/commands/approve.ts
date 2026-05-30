import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import { findRunDirectory } from '../../runs/find-run.js'
import { computeRunHash } from '../../runs/evidence-hash.js'
import {
  checkSourceDrift,
  checkPatchApplies,
  cleanupApprovalBranch,
  type SourceManifest,
  type SessionSummary,
} from '../../runs/apply-patch.js'

const REQUIRED_ARTIFACTS = ['PATCH.diff', 'SOURCE_MANIFEST.json', 'TASK.md', 'SESSION_SUMMARY.json'] as const

function readJson<T>(filePath: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
  } catch {
    return undefined
  }
}

function extractTaskSubject(taskMd: string): string {
  const firstPara = taskMd.split(/\n\n/)[0]?.trim() ?? ''
  const subject = firstPara.split('\n')[0]?.trim() ?? '(no task)'
  return subject.length > 72 ? subject.slice(0, 69) + '...' : subject
}

function gitCurrentBranch(projectPath: string): string | null {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: projectPath,
    encoding: 'utf-8',
  })
  if (r.status !== 0 || r.error) return null
  return r.stdout.trim() || null
}

function gitBranchExists(branchName: string, projectPath: string): boolean {
  const r = spawnSync('git', ['rev-parse', '--verify', branchName], {
    cwd: projectPath,
    encoding: 'utf-8',
  })
  return r.status === 0
}

function gitCreateBranch(branchName: string, projectPath: string): boolean {
  const r = spawnSync('git', ['checkout', '-b', branchName], {
    cwd: projectPath,
    encoding: 'utf-8',
  })
  return r.status === 0 && !r.error
}

function gitApplyPatch(patchPath: string, projectPath: string): { ok: boolean; stderr: string } {
  const r = spawnSync('git', ['apply', patchPath], {
    cwd: projectPath,
    encoding: 'utf-8',
  })
  return { ok: r.status === 0 && !r.error, stderr: r.stderr ?? '' }
}

function gitAddAll(projectPath: string): boolean {
  const r = spawnSync('git', ['add', '-A'], { cwd: projectPath, encoding: 'utf-8' })
  return r.status === 0 && !r.error
}

function gitCommitWithFile(msgFile: string, projectPath: string): { ok: boolean; stderr: string } {
  const r = spawnSync('git', ['commit', '--file', msgFile], {
    cwd: projectPath,
    encoding: 'utf-8',
  })
  return { ok: r.status === 0 && !r.error, stderr: r.stderr ?? '' }
}

function gitHeadSha(projectPath: string): string {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectPath,
    encoding: 'utf-8',
  })
  return r.stdout.trim()
}

function buildCommitMessage(
  subject: string,
  runId: string,
  evidenceHash: string,
  verificationStatus: string,
): string {
  return `feat: ${subject}\n\nPowerplant-Run: ${runId}\nEvidence-Hash: ${evidenceHash}\nVerification: ${verificationStatus}\n`
}

function tryCreatePr(
  title: string,
  runId: string,
  evidenceHash: string,
  runDir: string,
): void {
  const body = `Run ID: ${runId}\nEvidence-Hash: ${evidenceHash}\nRun directory: ${runDir}`
  const r = spawnSync('gh', ['pr', 'create', '--draft', '--title', title, '--body', body], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (r.error || r.status !== 0) {
    console.warn('Warning: PR creation skipped — gh not available or failed.')
    if (r.error) console.warn(`  ${r.error.message}`)
    else if (r.stderr?.trim()) console.warn(`  ${r.stderr.trim()}`)
  } else {
    const prUrl = r.stdout.trim()
    if (prUrl) console.log(`Draft PR created: ${prUrl}`)
    else console.log('Draft PR created.')
  }
}

export async function cmdApprove(args: string[]): Promise<void> {
  const runId = args.find(a => !a.startsWith('-'))
  const dryRun = args.includes('--dry-run')
  const withPr = args.includes('--pr')

  if (!runId?.trim()) {
    console.error('Error: run ID must not be empty.')
    console.error('Usage: powerplant approve <run-id> [--dry-run] [--pr]')
    process.exit(1)
  }

  // 1. Locate run directory
  const runDir = findRunDirectory(runId)
  if (!runDir) {
    console.error(`Error: No run found with ID: ${runId}`)
    console.error('Runs are stored at: ~/.powerplant/runs/<project-id>/<run-id>/')
    process.exit(1)
  }

  // 2. Verify required artifacts
  const missingArtifacts = REQUIRED_ARTIFACTS.filter(a => !fs.existsSync(path.join(runDir, a)))
  if (missingArtifacts.length > 0) {
    console.error(`Error: Run ${runId} is missing required artifacts: ${missingArtifacts.join(', ')}`)
    process.exit(1)
  }

  // 3. Read source manifest and session summary
  const manifest = readJson<SourceManifest>(path.join(runDir, 'SOURCE_MANIFEST.json'))
  if (!manifest?.sourcePath || !Array.isArray(manifest.files)) {
    console.error('Error: SOURCE_MANIFEST.json is invalid or missing required fields.')
    process.exit(1)
  }

  const sessionSummary = readJson<SessionSummary>(path.join(runDir, 'SESSION_SUMMARY.json'))
  const verificationStatus = sessionSummary?.passed === true
    ? 'PASS'
    : sessionSummary?.passed === false
    ? 'FAIL'
    : 'UNKNOWN'

  const taskMd = fs.readFileSync(path.join(runDir, 'TASK.md'), 'utf-8')
  const taskSubject = extractTaskSubject(taskMd)
  const patchPath = path.join(runDir, 'PATCH.diff')
  const projectPath = path.resolve(manifest.sourcePath)
  const branchName = `powerplant/${runId}`

  // 4. Source drift check
  const drift = checkSourceDrift(manifest)
  if (!drift.clean) {
    const changed = drift.changedFiles.length > 0
      ? `\n  Changed: ${drift.changedFiles.slice(0, 5).join(', ')}${drift.changedFiles.length > 5 ? ' …' : ''}`
      : ''
    const missing = drift.missingFiles.length > 0
      ? `\n  Missing: ${drift.missingFiles.slice(0, 5).join(', ')}${drift.missingFiles.length > 5 ? ' …' : ''}`
      : ''
    console.error(`Source has changed since run. Re-run or use --force.${changed}${missing}`)
    process.exit(1)
  }

  // 5. Compute evidence hash
  const evidenceHash = computeRunHash(runDir)

  // 6. Patch pre-check
  const patchCheck = checkPatchApplies(patchPath, projectPath)
  if (!patchCheck.applies) {
    console.error('Error: Patch does not apply cleanly to the current source tree.')
    if (patchCheck.stderr.trim()) console.error(patchCheck.stderr.trim())
    process.exit(1)
  }

  // Dry-run: report and exit without touching git
  if (dryRun) {
    console.log('--- Dry-run report ---')
    console.log(`Run directory:     ${runDir}`)
    console.log(`Target project:    ${projectPath}`)
    console.log(`Evidence hash:     ${evidenceHash}`)
    console.log(`Source manifest:   clean (no drift detected)`)
    console.log(`Patch applies:     yes`)
    console.log(`Branch to create:  ${branchName}`)
    console.log(`Commit subject:    feat: ${taskSubject}`)
    console.log(`Verification:      ${verificationStatus}`)
    return
  }

  // 7. Verify target is a git repo and get current branch
  const originalBranch = gitCurrentBranch(projectPath)
  if (!originalBranch) {
    console.error(`Error: ${projectPath} is not a git repository or has no commits.`)
    process.exit(1)
  }

  // 8. Refuse to create branch over existing
  if (gitBranchExists(branchName, projectPath)) {
    console.error(`Error: Branch '${branchName}' already exists in ${projectPath}.`)
    console.error('Delete it first or use a different run.')
    process.exit(1)
  }

  // 9. Create branch
  if (!gitCreateBranch(branchName, projectPath)) {
    console.error(`Error: Failed to create branch '${branchName}' in ${projectPath}.`)
    process.exit(1)
  }

  // From here: any failure must clean up the branch
  let commitSha = ''
  try {
    // 10. Apply patch
    const applyResult = gitApplyPatch(patchPath, projectPath)
    if (!applyResult.ok) {
      throw new Error(`git apply failed:\n${applyResult.stderr}`)
    }

    // 11. Stage all
    if (!gitAddAll(projectPath)) {
      throw new Error('git add -A failed')
    }

    // 12. Commit
    const commitMessage = buildCommitMessage(taskSubject, runId, evidenceHash, verificationStatus)
    const tmpMsg = path.join(os.tmpdir(), `pp-commit-msg-${Date.now()}.txt`)
    fs.writeFileSync(tmpMsg, commitMessage)
    let commitResult: { ok: boolean; stderr: string }
    try {
      commitResult = gitCommitWithFile(tmpMsg, projectPath)
    } finally {
      fs.unlinkSync(tmpMsg)
    }
    if (!commitResult.ok) {
      throw new Error(`git commit failed:\n${commitResult.stderr}`)
    }

    commitSha = gitHeadSha(projectPath)
  } catch (err) {
    // Cleanup: return to original branch and delete the created branch
    cleanupApprovalBranch(branchName, originalBranch, projectPath)
    console.error(`Error: Approve failed. Branch '${branchName}' has been deleted.`)
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  // 13. Success output
  console.log(`\nApproved run ${runId}`)
  console.log(`  Branch:         ${branchName}`)
  console.log(`  Commit:         ${commitSha}`)
  console.log(`  Evidence hash:  ${evidenceHash}`)
  console.log(`  Verification:   ${verificationStatus}`)
  console.log(`\nNext: review the branch and merge when ready.`)

  // 14. Optional PR
  if (withPr) {
    tryCreatePr(taskSubject, runId, evidenceHash, runDir)
  }
}
