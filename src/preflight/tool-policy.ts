// Stage 2B P0-B — Tool-Channel Confinement Policy
//
// The Stage 2B managed-agent session permits ONLY the five custom broker tools.
// Any other tool event — built-in writes, shell execution, network access, credential
// reads, or direct state-path access — is a PROTOCOL_STOP condition.
//
// This module provides a deterministic, model-free policy enforcer.  Tests call
// evaluateToolRequest() directly against known tool names to prove the enforcement
// boundary before any live agent session occurs.
//
// Policy version: stage2b-tool-policy-v1

import { isKnownPilotToolName } from '../contracts/project-tool-contracts.js'
import { STAGE2B_TOOL_POLICY_VERSION, SPRINT4A_RUNTIME_BASE } from '../config/constants.js'

export type ToolCategory =
  | 'broker_custom_tool'
  | 'builtin_write'
  | 'builtin_bash'
  | 'builtin_credentials_read'
  | 'builtin_network'
  | 'builtin_state_path_access'
  | 'unknown_builtin'

export type PolicyDecision = 'ALLOW' | 'DENY'

export interface ToolPolicyResult {
  decision: PolicyDecision
  /** PROTOCOL_STOP is always set when decision is DENY */
  protocolStop: boolean
  category: ToolCategory
  policyVersion: string
  attemptedTool: string
  reason: string
  /** True when the policy evaluated to DENY before any execution was attempted */
  deniedBeforeExecution: true
  noActionTaken: boolean
}

export interface ToolPolicyReceipt {
  gate: 'P0-B'
  preflightId: string
  policyVersion: string
  testedAt: string
  allowedBrokerTools: string[]
  forbiddenCategoriesTested: ToolCategory[]
  allForbiddenDenied: boolean
  allowedAdmitted: boolean
  sentinelTestResult: 'UNCHANGED'
  verdict: 'P0_B_TOOL_CHANNEL_CONFINEMENT_PROVEN'
}

// Named tools that map to a specific forbidden category
const BUILTIN_TOOL_CATEGORY_MAP: Record<string, ToolCategory> = {
  Write: 'builtin_write',
  Edit: 'builtin_write',
  Bash: 'builtin_bash',
  Read: 'unknown_builtin',
  WebFetch: 'builtin_network',
  WebSearch: 'builtin_network',
  CredentialRead: 'builtin_credentials_read',
  EnvRead: 'builtin_credentials_read',
  SecretRead: 'builtin_credentials_read',
}

// Patterns that indicate a state-path access attempt in the tool name or path
const STATE_PATH_PATTERNS = [
  /\.powerplant[\\/]state/,
  /powerplant[\\/]state/,
]

function classifyTool(toolName: string): ToolCategory {
  if (isKnownPilotToolName(toolName)) return 'broker_custom_tool'

  const mapped = BUILTIN_TOOL_CATEGORY_MAP[toolName]
  if (mapped !== undefined) return mapped

  for (const pat of STATE_PATH_PATTERNS) {
    if (pat.test(toolName)) return 'builtin_state_path_access'
  }

  return 'unknown_builtin'
}

export function evaluateToolRequest(toolName: string): ToolPolicyResult {
  const category = classifyTool(toolName)
  const allowed = category === 'broker_custom_tool'

  if (allowed) {
    return {
      decision: 'ALLOW',
      protocolStop: false,
      category,
      policyVersion: STAGE2B_TOOL_POLICY_VERSION,
      attemptedTool: toolName,
      reason: `${toolName} is an approved broker custom tool`,
      deniedBeforeExecution: true,
      noActionTaken: false,
    }
  }

  const reasonMap: Record<ToolCategory, string> = {
    broker_custom_tool: '',
    builtin_write: `Unrestricted filesystem write (${toolName}) is not permitted — agent may only write via project_write_file within the broker-controlled workspace`,
    builtin_bash: 'Shell/command execution is not permitted in Stage 2B managed sessions',
    builtin_credentials_read: 'Credential or environment secret reads are not permitted',
    builtin_network: `Unrestricted network access (${toolName}) is not permitted — network calls must go through approved broker tools only`,
    builtin_state_path_access: `Direct access to state path is not permitted — agent must not reach real ~/.powerplant/state`,
    unknown_builtin: `Unknown built-in tool (${toolName}) is not on the approved broker-tool list — treat as protocol stop`,
  }

  return {
    decision: 'DENY',
    protocolStop: true,
    category,
    policyVersion: STAGE2B_TOOL_POLICY_VERSION,
    attemptedTool: toolName,
    reason: reasonMap[category],
    deniedBeforeExecution: true,
    noActionTaken: true,
  }
}

// The set of broker tool names that must remain accessible throughout a Stage 2B session
export const APPROVED_BROKER_TOOLS = [
  'project_list_files',
  'project_read_file',
  'project_write_file',
  'project_run_check',
  'project_finalize',
] as const

// Tools that, if observed in a session event stream, are immediate protocol stops
export const KNOWN_FORBIDDEN_TOOL_NAMES = [
  'Write',
  'Edit',
  'Bash',
  'WebFetch',
  'WebSearch',
  'CredentialRead',
  'EnvRead',
  'SecretRead',
] as const

// Detects a state-path bypass attempt from an absolute path string
export function isStatPathBypassAttempt(absolutePath: string): boolean {
  return absolutePath.includes('.powerplant/state') ||
    absolutePath.startsWith(SPRINT4A_RUNTIME_BASE + '/') === false &&
    absolutePath.includes('powerplant')
}
