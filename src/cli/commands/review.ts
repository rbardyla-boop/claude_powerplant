import fs from 'fs'
import path from 'path'
import { findRunDirectory } from '../../runs/find-run.js'
import { printReviewReport } from '../terminal-output.js'

const REQUIRED_ARTIFACTS = [
  'SOURCE_MANIFEST.json',
  'SANITIZED_MANIFEST.json',
  'TASK.md',
  'PATCH.diff',
  'CHANGED_FILES.md',
  'VERIFICATION_REPORT.md',
  'ADVERSARIAL_REVIEW.md',
  'SESSION_SUMMARY.json',
] as const

export async function cmdReview(runId: string): Promise<void> {
  if (!runId || !runId.trim()) {
    console.error('Error: run ID must not be empty.')
    console.error('Usage: powerplant review <run-id>')
    process.exit(1)
  }

  const artifactDir = findRunDirectory(runId)
  if (!artifactDir) {
    console.error(`Error: No run found with ID: ${runId}`)
    console.error('Runs are stored at: ~/.powerplant/runs/<project-id>/<run-id>/')
    process.exit(1)
  }

  // Validate all required artifacts exist
  const missing: string[] = []
  for (const artifact of REQUIRED_ARTIFACTS) {
    if (!fs.existsSync(path.join(artifactDir, artifact))) {
      missing.push(artifact)
    }
  }
  if (missing.length > 0) {
    console.error(`Error: Run artifacts are incomplete. Missing:`)
    for (const m of missing) {
      console.error(`  - ${m}`)
    }
    console.error(`Artifact directory: ${artifactDir}`)
    process.exit(1)
  }

  // Read artifacts
  const task = fs.readFileSync(path.join(artifactDir, 'TASK.md'), 'utf-8').trim()
  const patchDiff = fs.readFileSync(path.join(artifactDir, 'PATCH.diff'), 'utf-8')
  const changedFilesMd = fs.readFileSync(path.join(artifactDir, 'CHANGED_FILES.md'), 'utf-8')
  const verificationMd = fs.readFileSync(path.join(artifactDir, 'VERIFICATION_REPORT.md'), 'utf-8')
  const adversarialMd = fs.readFileSync(path.join(artifactDir, 'ADVERSARIAL_REVIEW.md'), 'utf-8')

  let sessionSummary: Record<string, unknown> = {}
  try {
    const raw = fs.readFileSync(path.join(artifactDir, 'SESSION_SUMMARY.json'), 'utf-8')
    sessionSummary = JSON.parse(raw) as Record<string, unknown>
  } catch {
    console.error('Error: SESSION_SUMMARY.json is invalid JSON.')
    process.exit(1)
  }

  // Optional — present only in runs that emitted PROMPT_ENVELOPE.json
  let promptEnvelope: Record<string, unknown> | undefined
  const envelopePath = path.join(artifactDir, 'PROMPT_ENVELOPE.json')
  if (fs.existsSync(envelopePath)) {
    try {
      promptEnvelope = JSON.parse(fs.readFileSync(envelopePath, 'utf-8')) as Record<string, unknown>
    } catch {
      // Malformed envelope — display without it
    }
  }

  printReviewReport({
    runId,
    artifactDir,
    task,
    patchDiff,
    changedFilesMd,
    verificationMd,
    adversarialMd,
    sessionSummary,
    promptEnvelope,
  })
}
