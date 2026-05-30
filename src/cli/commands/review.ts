import fs from 'fs'
import path from 'path'
import { findRunDirectory } from '../../runs/find-run.js'
import { printReviewTui } from '../terminal-output.js'
import { parseVerificationReport } from '../parse-verification-report.js'
import type { RunClassification } from '../../contracts/project-tool-contracts.js'
import type { ReviewRenderState } from '../../contracts/review-render.js'

const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const
type RiskSeverity = keyof typeof SEVERITY_ORDER

// ── Artifact parsing helpers ──────────────────────────────────────────────────

function readFile(dir: string, name: string): string {
  const p = path.join(dir, name)
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : ''
}

function readJson<T>(dir: string, name: string): T | undefined {
  const p = path.join(dir, name)
  if (!fs.existsSync(p)) return undefined
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T } catch { return undefined }
}

function parseDiff(raw: string): ReviewRenderState['diff'] {
  if (!raw.trim()) return { files: 0, linesAdded: 0, linesRemoved: 0, raw }
  const files = (raw.match(/^--- a\//gm) ?? []).length
  const linesAdded = (raw.match(/^\+(?!\+\+)/gm) ?? []).length
  const linesRemoved = (raw.match(/^-(?!--)/gm) ?? []).length
  return { files, linesAdded, linesRemoved, raw }
}

function parseChecks(verificationMd: string): ReviewRenderState['checks'] {
  const parsed = parseVerificationReport(verificationMd)
  if (parsed.format !== 'current') return []

  const finalAttempts = parsed.attempts.filter((_, i) => !parsed.intermediateIndices.has(i))

  return finalAttempts.map(attempt => {
    const escaped = attempt.checkId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const sectionRe = new RegExp(`### Check: \`${escaped}\`([\\s\\S]*?)(?=### Check:|$)`)
    const section = sectionRe.exec(verificationMd)?.[1] ?? ''

    const exitCodeMatch = /Exit code:\s*(\d+)/i.exec(section)
    const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1]!, 10) : null

    const codeBlock = /```[^\n]*\n([\s\S]*?)```/i.exec(section)
    const snippet = (codeBlock?.[1] ?? '').trim().split('\n')[0]?.trim().slice(0, 80) ?? ''

    const status: 'pass' | 'fail' | 'skip' =
      attempt.isPass ? 'pass' : attempt.verdict === 'SKIP' ? 'skip' : 'fail'

    return { name: attempt.checkId, status, exitCode, snippet }
  })
}

function parseRisks(adversarialMd: string): ReviewRenderState['risks'] {
  const risks: ReviewRenderState['risks'] = []
  const re = /(?:\[|\*\*|^[-*\s]*)(CRITICAL|HIGH|MEDIUM|LOW)(?:\]|\*\*)?[:\s]+(.+)/gim
  let m: RegExpExecArray | null
  while ((m = re.exec(adversarialMd)) !== null) {
    const severity = m[1]!.toUpperCase() as RiskSeverity
    const finding = m[2]!.trim().replace(/[*_]/g, '').slice(0, 200)
    if (finding) risks.push({ severity, finding })
  }
  return risks.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

function computeOverallStatus(
  checks: ReviewRenderState['checks'],
  risks: ReviewRenderState['risks'],
  classification: RunClassification | undefined,
  verificationMd: string,
): ReviewRenderState['overallStatus'] {
  let anyCheckFailed = false
  let hasEnoughInfo = false

  if (classification !== undefined) {
    hasEnoughInfo = true
    anyCheckFailed = !classification.patchEligibleForApplication
  } else if (verificationMd) {
    const parsed = parseVerificationReport(verificationMd)
    if (parsed.format === 'current') {
      hasEnoughInfo = true
      anyCheckFailed = parsed.finalVerdict !== 'PASS' || parsed.hasIntegrityFailure
    }
  }

  if (!hasEnoughInfo && checks.length > 0) {
    hasEnoughInfo = true
    anyCheckFailed = checks.some(c => c.status === 'fail')
  }

  if (!hasEnoughInfo) return 'UNKNOWN'
  if (anyCheckFailed) return 'FAIL'
  if (risks.some(r => r.severity === 'CRITICAL' || r.severity === 'HIGH')) return 'RISK'
  return 'PASS'
}

function computeNextAction(
  status: ReviewRenderState['overallStatus'],
  runId: string,
): string {
  switch (status) {
    case 'PASS': return `powerplant approve ${runId}`
    case 'RISK': return `Review HIGH/CRITICAL risks above, then: powerplant approve ${runId}`
    case 'FAIL': return `Fix failing checks and re-run the task`
    default: return `Review artifacts manually: powerplant review ${runId} --json`
  }
}

const INCOMPLETE_NEXT_ACTION: Record<string, string> = {
  FAILED_INCOMPLETE_AGENT_RUN:
    'Agent produced no patch — re-run with an explicit write target ' +
    '(e.g. instruct the agent to write findings to tests/REPORT.md before finalizing)',
  FAILED_TOOL_BUDGET_EXHAUSTED:
    'Tool budget exhausted before finalization — narrow the task scope ' +
    'or break into smaller runs, then re-run',
}

// ── Public builder (exported for tests) ──────────────────────────────────────

export function buildReviewRenderState(runId: string, artifactDir: string): ReviewRenderState {
  const projectId = path.basename(path.dirname(artifactDir))
  const task = readFile(artifactDir, 'TASK.md').trim() || '(no task recorded)'
  const verificationMd = readFile(artifactDir, 'VERIFICATION_REPORT.md')
  const adversarialMd = readFile(artifactDir, 'ADVERSARIAL_REVIEW.md')

  let classification = readJson<RunClassification>(artifactDir, 'RUN_CLASSIFICATION.json')
  if (!classification) {
    const failMd = readFile(artifactDir, 'FAILURE_CLASSIFICATION.md')
    if (failMd) {
      const sM = failMd.match(/runStatus:\s*(\S+)/)
      const eM = failMd.match(/patchEligibleForApplication:\s*(\S+)/)
      if (sM || eM) {
        classification = {
          terminationReason: (sM?.[1] ?? 'FAILED_INCOMPLETE_AGENT_RUN') as RunClassification['terminationReason'],
          patchEligibleForApplication: eM?.[1] === 'true',
          readCount: 0, writeCount: 0, checkCount: 0,
          finalizeAttempted: false, artifactsComplete: false, repeatedCheckFailures: false,
        }
      }
    }
  }

  const diff = parseDiff(readFile(artifactDir, 'PATCH.diff'))
  const checks = parseChecks(verificationMd)
  const risks = parseRisks(adversarialMd)
  const overallStatus = computeOverallStatus(checks, risks, classification, verificationMd)
  let nextAction = computeNextAction(overallStatus, runId)

  let terminationNote: string | null = null
  if (classification && !classification.artifactsComplete) {
    const labels: Record<string, string> = {
      FAILED_TOOL_BUDGET_EXHAUSTED: 'tool budget exhausted before finalization',
      FAILED_INCOMPLETE_AGENT_RUN: 'agent run did not complete',
    }
    const label = labels[classification.terminationReason] ?? classification.terminationReason
    terminationNote = `Run terminated (${label}) — no PATCH.diff produced`
    nextAction = INCOMPLETE_NEXT_ACTION[classification.terminationReason]
      ?? `Re-run the task (${classification.terminationReason})`
  }

  return { runId, projectId, task, overallStatus, terminationNote, diff, checks, risks, nextAction }
}

// ── Command ───────────────────────────────────────────────────────────────────

export async function cmdReview(args: string[]): Promise<void> {
  const runId = args.find(a => !a.startsWith('-'))
  const jsonMode = args.includes('--json')
  const diffMode = args.includes('--diff')

  if (!runId?.trim()) {
    console.error('Error: run ID must not be empty.')
    console.error('Usage: powerplant review <run-id> [--json] [--diff]')
    process.exit(1)
  }

  const artifactDir = findRunDirectory(runId)
  if (!artifactDir) {
    console.error(`Error: No run found with ID: ${runId}`)
    console.error('Runs are stored at: ~/.powerplant/runs/<project-id>/<run-id>/')
    process.exit(1)
  }

  const state = buildReviewRenderState(runId, artifactDir)

  if (jsonMode) {
    console.log(JSON.stringify(state, null, 2))
    return
  }

  if (diffMode) {
    if (state.diff.raw) {
      process.stdout.write(state.diff.raw)
    } else {
      console.log('(no diff available)')
    }
    return
  }

  printReviewTui(state)
}
