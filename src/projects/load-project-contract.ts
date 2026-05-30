import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import type { ProjectContract } from './project-contract.js'

// ── Hard-coded invariants that YAML cannot override ───────────────────────────
// These values are forced regardless of what any policy file declares.
const HARDCODED_WORKSPACE_MODE = 'sanitized_copy_only' as const
const HARDCODED_REAL_PROJECT_MOUNTED = false as const
const HARDCODED_ALLOW_BASH = false as const

// ── YAML document shapes ──────────────────────────────────────────────────────

interface RawPolicyYaml {
  projectId?: unknown
  includePaths?: unknown
  excludePaths?: unknown
  denyIfPresentAfterCopy?: unknown
  allowedReadPaths?: unknown
  allowedWritePaths?: unknown
}

interface RawVerifyYaml {
  verificationProfile?: unknown
  checks?: unknown
}

// ── LoadedProjectContract ─────────────────────────────────────────────────────

export interface LoadedProjectContract extends ProjectContract {
  /** Paths the agent may read (exact or glob, resolved at broker time) */
  allowedReadPaths: string[]
  /** Paths the agent may write (exact or glob, resolved at broker time) */
  allowedWritePaths: string[]
  /** Named checks the agent may invoke, mapped to their fixed commands */
  allowedChecks: Record<string, { command: string }>
  /** Optional verification runtime profile declared in VERIFY.yaml */
  verificationProfile: string | null
}

// ── Path safety ───────────────────────────────────────────────────────────────

const ALWAYS_FORBIDDEN_READ_PATTERNS = [
  /\.env$/,
  /\.env\./,
  /credentials.*\.json/,
  /\.(key|pem|pfx|p12)$/,
  /\.git($|\/)/,
  /private\//,
  /secrets?\//,
  /steam.*upload/i,
  /depot_key/i,
]

function rejectForbiddenReadPath(p: string): void {
  for (const pattern of ALWAYS_FORBIDDEN_READ_PATTERNS) {
    if (pattern.test(p)) {
      throw new Error(
        `Contract error: allowedReadPaths contains a forbidden pattern '${p}' ` +
        `(matched ${pattern}). Remove it from POLICY.yaml.`,
      )
    }
  }
}

function assertSafeRelativePath(p: string, context: string): void {
  if (typeof p !== 'string' || !p) {
    throw new Error(`${context}: path must be a non-empty string`)
  }
  if (path.isAbsolute(p)) {
    throw new Error(`${context}: absolute paths are not allowed — got '${p}'`)
  }
  if (p.includes('..')) {
    throw new Error(`${context}: path traversal (..) is not allowed — got '${p}'`)
  }
  if (p.includes('\0')) {
    throw new Error(`${context}: null byte in path — got '${p}'`)
  }
}

function assertStringArray(val: unknown, field: string): string[] {
  if (!Array.isArray(val)) {
    throw new Error(`POLICY.yaml: '${field}' must be an array of strings`)
  }
  for (const item of val) {
    if (typeof item !== 'string') {
      throw new Error(`POLICY.yaml: '${field}' must contain only strings, got ${typeof item}`)
    }
  }
  return val as string[]
}

function assertSafeProjectId(id: unknown): string {
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error(`POLICY.yaml: 'projectId' must be a non-empty string`)
  }
  if (/[/\\<>|*?"]/.test(id)) {
    throw new Error(
      `POLICY.yaml: 'projectId' contains forbidden characters — got '${id}'`,
    )
  }
  if (id.includes('..')) {
    throw new Error(`POLICY.yaml: 'projectId' must not contain '..'`)
  }
  return id.trim()
}

// ── YAML loaders ──────────────────────────────────────────────────────────────

function loadPolicyYaml(policyPath: string): {
  projectId: string
  includePaths: string[]
  excludePaths: string[]
  denyIfPresentAfterCopy: string[]
  allowedReadPaths: string[]
  allowedWritePaths: string[]
} {
  let raw: unknown
  try {
    raw = yaml.load(fs.readFileSync(policyPath, 'utf-8'))
  } catch (err) {
    throw new Error(`Failed to parse POLICY.yaml: ${String(err)}`)
  }

  if (!raw || typeof raw !== 'object') {
    throw new Error('POLICY.yaml: document must be a YAML mapping, not empty or a scalar')
  }

  const doc = raw as RawPolicyYaml

  const projectId = assertSafeProjectId(doc.projectId)

  const includePaths = assertStringArray(doc.includePaths, 'includePaths')
  if (includePaths.length === 0) {
    throw new Error("POLICY.yaml: 'includePaths' must contain at least one entry")
  }
  for (const p of includePaths) assertSafeRelativePath(p, 'includePaths')

  const excludePaths = doc.excludePaths === undefined
    ? []
    : assertStringArray(doc.excludePaths, 'excludePaths')
  for (const p of excludePaths) assertSafeRelativePath(p.replace(/\*\*?\/?\*?/g, '_glob_'), 'excludePaths')

  const denyIfPresentAfterCopy = doc.denyIfPresentAfterCopy === undefined
    ? []
    : assertStringArray(doc.denyIfPresentAfterCopy, 'denyIfPresentAfterCopy')

  const allowedReadPaths = assertStringArray(doc.allowedReadPaths, 'allowedReadPaths')
  if (allowedReadPaths.length === 0) {
    throw new Error("POLICY.yaml: 'allowedReadPaths' must contain at least one entry")
  }
  for (const p of allowedReadPaths) {
    assertSafeRelativePath(p.replace(/\*\*?\/?\*?/g, '_glob_'), 'allowedReadPaths')
    rejectForbiddenReadPath(p)
  }

  const allowedWritePaths = assertStringArray(doc.allowedWritePaths, 'allowedWritePaths')
  for (const p of allowedWritePaths) {
    assertSafeRelativePath(p.replace(/\*\*?\/?\*?/g, '_glob_'), 'allowedWritePaths')
  }

  return { projectId, includePaths, excludePaths, denyIfPresentAfterCopy, allowedReadPaths, allowedWritePaths }
}

function loadVerifyYaml(verifyPath: string): {
  checks: Record<string, { command: string }>
  verificationProfile: string | null
} {
  let raw: unknown
  try {
    raw = yaml.load(fs.readFileSync(verifyPath, 'utf-8'))
  } catch (err) {
    throw new Error(`Failed to parse VERIFY.yaml: ${String(err)}`)
  }

  if (!raw || typeof raw !== 'object') {
    throw new Error('VERIFY.yaml: document must be a YAML mapping with a checks key')
  }

  const doc = raw as RawVerifyYaml

  // Optional verificationProfile field. null is treated as absent (no profile).
  let verificationProfile: string | null = null
  if (doc.verificationProfile !== undefined && doc.verificationProfile !== null) {
    if (typeof doc.verificationProfile !== 'string' || !doc.verificationProfile.trim()) {
      throw new Error(
        "VERIFY.yaml: 'verificationProfile' must be a non-empty string when present",
      )
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(doc.verificationProfile.trim())) {
      throw new Error(
        `VERIFY.yaml: 'verificationProfile' must match /^[a-zA-Z][a-zA-Z0-9_-]*$/ — got '${doc.verificationProfile}'`,
      )
    }
    verificationProfile = doc.verificationProfile.trim()
  }

  if (!doc.checks || typeof doc.checks !== 'object' || Array.isArray(doc.checks)) {
    throw new Error("VERIFY.yaml: 'checks' must be a mapping of check-id → { command: string }")
  }

  const checks: Record<string, { command: string }> = {}
  for (const [checkId, entry] of Object.entries(doc.checks as Record<string, unknown>)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(checkId)) {
      throw new Error(
        `VERIFY.yaml: check ID '${checkId}' must match /^[a-zA-Z][a-zA-Z0-9_-]*$/`,
      )
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`VERIFY.yaml: check '${checkId}' must be an object with a 'command' field`)
    }
    const entryObj = entry as Record<string, unknown>
    if (typeof entryObj['command'] !== 'string' || !entryObj['command'].trim()) {
      throw new Error(`VERIFY.yaml: check '${checkId}' must have a non-empty 'command' string`)
    }
    checks[checkId] = { command: entryObj['command'] as string }
  }

  if (Object.keys(checks).length === 0) {
    throw new Error("VERIFY.yaml: 'checks' must define at least one check")
  }

  return { checks, verificationProfile }
}

// ── Public loader ─────────────────────────────────────────────────────────────

/**
 * Load and validate the .powerplant/ contract for a project.
 *
 * Reads POLICY.yaml and VERIFY.yaml. Enforces hard-coded safety invariants
 * regardless of what the YAML files declare. Fails closed on any validation
 * error.
 */
export function loadProjectContract(sourcePath: string): LoadedProjectContract {
  const absSource = path.resolve(sourcePath)

  const policyPath = path.join(absSource, '.powerplant', 'POLICY.yaml')
  const verifyPath = path.join(absSource, '.powerplant', 'VERIFY.yaml')

  if (!fs.existsSync(policyPath)) {
    throw new Error(
      `No .powerplant/POLICY.yaml found at: ${absSource}\n` +
      'Only projects with a .powerplant/ contract folder are supported.',
    )
  }
  if (!fs.existsSync(verifyPath)) {
    throw new Error(
      `No .powerplant/VERIFY.yaml found at: ${absSource}\n` +
      'VERIFY.yaml is required to declare named verification checks.',
    )
  }

  const policy = loadPolicyYaml(policyPath)
  const { checks: allowedChecks, verificationProfile } = loadVerifyYaml(verifyPath)

  // Build the ProjectContract portion (sanitizer-facing)
  const projectContract: ProjectContract = {
    projectId: policy.projectId,
    sourcePath: absSource,
    includePaths: policy.includePaths,
    excludePaths: policy.excludePaths,
    denyIfPresentAfterCopy: policy.denyIfPresentAfterCopy,
    // Hard-coded invariants — YAML cannot override these
    workspaceMode: HARDCODED_WORKSPACE_MODE,
    realProjectMounted: HARDCODED_REAL_PROJECT_MOUNTED,
    allowBash: HARDCODED_ALLOW_BASH,
  }

  return {
    ...projectContract,
    allowedReadPaths: policy.allowedReadPaths,
    allowedWritePaths: policy.allowedWritePaths,
    allowedChecks,
    verificationProfile,
  }
}
