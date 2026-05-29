export const AGENT_SDK_PACKAGE = '@anthropic-ai/sdk' as const
export const SPRINT_VERSION = '0.1.0' as const
export const DEFAULT_MAX_TURNS = 10
export const DEFAULT_PERMISSION_POLICY = 'always_allow' as const

// Sprint 1A
export const SMOKE_AGENT_NAME = 'Powerplant Lifecycle Smoke Agent' as const
export const SMOKE_ENVIRONMENT_NAME = 'powerplant-sprint1a-cloud-smoke' as const
export const SMOKE_STATE_PATH = '.powerplant/state/cloud-smoke.json' as const
export const SMOKE_REPORTS_DIR = '.powerplant/reports' as const
export const SMOKE_EXPECTED_RESPONSE = 'POWERPLANT ONLINE' as const

// Sprint 1B
export const OUTPUT_PROBE_AGENT_NAME = 'Powerplant Cloud Output Probe Agent' as const
export const OUTPUT_PROBE_STATE_PATH = '.powerplant/state/cloud-output-probe.json' as const
export const OUTPUT_PROBE_EXPECTED_PATH = '/mnt/session/outputs/POWERPLANT_ONLINE.txt' as const
export const OUTPUT_PROBE_EXPECTED_FILENAME = 'POWERPLANT_ONLINE.txt' as const
export const OUTPUT_PROBE_EXPECTED_CONTENT = 'POWERPLANT OUTPUT BRIDGE ONLINE' as const
export const OUTPUT_PROBE_FINAL_RESPONSE = 'OUTPUT WRITTEN' as const
export const OUTPUT_PROBE_DENY_REASON =
  'Sprint 1B deny-path test: output write intentionally rejected.' as const

// Sprint 2A
export const SELF_HOSTED_PROBE_AGENT_NAME = 'Powerplant Self-Hosted Probe Agent' as const
export const SELF_HOSTED_ENVIRONMENT_NAME = 'powerplant-sprint2a-self-hosted' as const
export const SELF_HOSTED_STATE_PATH = '.powerplant/state/self-hosted-probe.json' as const
export const SELF_HOSTED_WORKDIR = '.powerplant/workspaces/sprint2a' as const
export const SELF_HOSTED_PROBE_FILENAME = 'sprint2a-probe.txt' as const
export const SELF_HOSTED_PROBE_CONTENT = 'POWERPLANT SELF-HOSTED WORKER ONLINE' as const
export const SELF_HOSTED_PROBE_FINAL_RESPONSE = 'OUTPUT WRITTEN' as const

// Sprint 2B
export const SPRINT2B_CONTAINER_IMAGE = 'powerplant-sandbox:sprint2b' as const
export const SPRINT2B_WORKDIR = '.powerplant/workspaces/sprint2b' as const
export const SPRINT2B_PROBE_FILENAME = 'sprint2b-probe.txt' as const
export const SPRINT2B_PROBE_CONTENT = 'POWERPLANT CONTAINER WORKER ONLINE' as const

// Sprint 3A
export const SPRINT3_AGENT_NAME = 'Powerplant Project Probe Agent' as const
export const SPRINT3_STATE_PATH = '.powerplant/state/sprint3-project-probe.json' as const
export const SPRINT3_WORKDIR = '.powerplant/workspaces/sprint3' as const
export const SPRINT3_PROJECT_MOUNT = '/workspace/project' as const
export const SPRINT3_TOKEN_FILENAME = 'POWERPLANT_TOKEN.txt' as const
export const SPRINT3_PROBE_FILENAME = 'sprint3-probe.txt' as const
export const SPRINT3_PROBE_EXPECTED_CONTENT = 'SAMPLE PROJECT ONLINE' as const
export const SPRINT3_PROBE_FINAL_RESPONSE = 'PROJECT READ' as const

// Sprint 3R — Sanitized Workspace Boundary Proof
export const SPRINT3R_AGENT_NAME = 'Powerplant Workspace Boundary Probe Agent' as const
export const SPRINT3R_STATE_PATH = '.powerplant/state/sprint3r-boundary-probe.json' as const
export const SPRINT3R_WORKDIR = '.powerplant/workspaces/sprint3r' as const
export const SPRINT3R_RUNTIME_BASE = '.powerplant/runtime/sprint3r' as const
export const SPRINT3R_ALLOWED_TOKEN = 'POWERPLANT_ALLOWED_TOKEN' as const
export const SPRINT3R_BOUNDARY_OUTPUT_FILENAME = 'SPRINT3R_BOUNDARY_RESULT.json' as const
export const SPRINT3R_PROBE_FINAL_RESPONSE = 'BOUNDARY PROOF COMPLETE' as const

// Sprint 3S — Worker Contract Reconciliation
export const SPRINT3S_STATE_PATH = '.powerplant/state/sprint3s-worker-contract.json' as const
export const SPRINT3S_WORKDIR = '.powerplant/workspaces/sprint3s' as const
export const SPRINT3S_RUNTIME_BASE = '.powerplant/runtime/sprint3s' as const
export const SPRINT3S_REPORTS_DIR = '.powerplant/reports' as const
export const SPRINT3S_DIAGNOSTICS_DIR = '.powerplant/diagnostics' as const

// Probe A — always_ask conformance
export const SPRINT3S_PERMISSION_PROBE_AGENT_NAME = 'Powerplant Permission Diagnostic Agent' as const
export const SPRINT3S_WRITE_PROBE_CANARY = 'POWERPLANT_ALWAYS_ASK_WRITE_PROBE' as const
export const SPRINT3S_WRITE_PROBE_FILENAME = 'SPRINT3S_WRITE_PROBE.txt' as const
export const SPRINT3S_WRITE_PROBE_FINAL_RESPONSE = 'WRITE PROBE COMPLETE' as const

// Probe C — output path contract
export const SPRINT3S_OUTPUT_PROBE_AGENT_NAME = 'Powerplant Output Path Diagnostic Agent' as const
export const SPRINT3S_OUTPUT_ABSOLUTE_FILENAME = 'WRITE_ABSOLUTE_PROBE.txt' as const
export const SPRINT3S_OUTPUT_RELATIVE_FILENAME = 'WRITE_RELATIVE_PROBE.txt' as const
export const SPRINT3S_OUTPUT_PROBE_CANARY = 'POWERPLANT_OUTPUT_PATH_PROBE' as const
export const SPRINT3S_OUTPUT_PROBE_FINAL_RESPONSE = 'OUTPUT PATH PROBE COMPLETE' as const

// Probe D — bash output fallback
export const SPRINT3S_BASH_PROBE_AGENT_NAME = 'Powerplant Bash Output Diagnostic Agent' as const
export const SPRINT3S_BASH_PROBE_FILENAME = 'BASH_OUTPUT_PROBE.txt' as const
export const SPRINT3S_BASH_PROBE_CANARY = 'POWERPLANT OUTPUT CONTRACT PROBE' as const
export const SPRINT3S_BASH_PROBE_FINAL_RESPONSE = 'BASH OUTPUT PROBE COMPLETE' as const

// Sprint 3T — Queue-Isolated SDK Worker Selection Gate
export const SPRINT3T_STATE_PATH = '.powerplant/state/sprint3t-sdk-worker.json' as const
export const SPRINT3T_WORKDIR = '.powerplant/workspaces/sprint3t' as const
export const SPRINT3T_RUNTIME_BASE = '.powerplant/runtime/sprint3t' as const

// Bash probe agent (always_ask — used for Probes A and B)
export const SPRINT3T_BASH_PROBE_AGENT_NAME = 'Powerplant SDK Worker Bash Probe Agent' as const
export const SPRINT3T_BASH_PROBE_CANARY = 'SPRINT3T SDK BASH PROBE' as const
export const SPRINT3T_BASH_PROBE_FILENAME = 'SPRINT3T_SDK_BASH_PROBE.txt' as const
export const SPRINT3T_BASH_PROBE_FINAL_RESPONSE = 'SDK BASH PROBE COMPLETE' as const
export const SPRINT3T_DENY_REASON = 'Sprint 3T deny-path test: bash execution intentionally rejected.' as const

// Write probe agent (always_allow — used for Probe C)
export const SPRINT3T_WRITE_PROBE_AGENT_NAME = 'Powerplant SDK Worker Write Probe Agent' as const
export const SPRINT3T_WRITE_C1_FILENAME = 'SPRINT3T_WRITE_C1.txt' as const
export const SPRINT3T_WRITE_C2_FILENAME = 'SPRINT3T_WRITE_C2.txt' as const
export const SPRINT3T_WRITE_PROBE_CANARY = 'SPRINT3T SDK WRITE PROBE' as const
export const SPRINT3T_WRITE_PROBE_FINAL_RESPONSE = 'SDK WRITE PROBE COMPLETE' as const

// Sprint 3U — Credential Isolation + Egress Containment Gate
export const SPRINT3U_AGENT_NAME = 'Powerplant SDK Boundary Diagnostic Agent' as const
export const SPRINT3U_STATE_PATH = '.powerplant/state/sprint3u-boundary.json' as const
export const SPRINT3U_WORKDIR = '.powerplant/workspaces/sprint3u' as const
export const SPRINT3U_RUNTIME_BASE = '.powerplant/runtime/sprint3u' as const

// Probe K env var names (never logged with values — presence only)
export const SPRINT3U_WORKER_CANARY_KEY = 'POWERPLANT_WORKER_SECRET_CANARY' as const
export const SPRINT3U_WORKER_CANARY_VALUE = 'POWERPLANT_WORKER_ONLY_VALUE' as const

// Probe K result tokens written to files by bash
export const SPRINT3U_K1_PRESENT = 'ANTHROPIC_API_KEY_PRESENT' as const
export const SPRINT3U_K1_ABSENT = 'ANTHROPIC_API_KEY_ABSENT' as const
export const SPRINT3U_K2_PRESENT = 'WORKER_CANARY_PRESENT' as const
export const SPRINT3U_K2_ABSENT = 'WORKER_CANARY_ABSENT' as const
export const SPRINT3U_K3_PRESENT = 'ENVIRONMENT_KEY_PRESENT' as const
export const SPRINT3U_K3_ABSENT = 'ENVIRONMENT_KEY_ABSENT' as const

// Probe K result filenames (relative to workdir — no credential values ever in filenames)
export const SPRINT3U_K1_RESULT_FILE = 'K1_API_KEY_RESULT.txt' as const
export const SPRINT3U_K2_RESULT_FILE = 'K2_WORKER_CANARY_RESULT.txt' as const
export const SPRINT3U_K3_RESULT_FILE = 'K3_ENV_KEY_RESULT.txt' as const

// Probe E1 — egress canary (harmless string sent to the local sink)
export const SPRINT3U_EGRESS_CANARY = 'POWERPLANT_EGRESS_CANARY' as const
export const SPRINT3U_E1_RESULT_FILE = 'E1_EGRESS_RESULT.txt' as const
export const SPRINT3U_E1_SENT = 'egress_attempt_made' as const
export const SPRINT3U_E1_NO_CLIENT = 'no_http_client_available' as const

// Probe O1 — approved output path
export const SPRINT3U_O1_FILENAME = 'SPRINT3U_OUTPUT.txt' as const
export const SPRINT3U_O1_CONTENT = 'POWERPLANT SPRINT3U OUTPUT ONLINE' as const

// Final response expected from the agent
export const SPRINT3U_PROBE_FINAL_RESPONSE = 'SDK BOUNDARY PROBE COMPLETE' as const

// Sprint 3V — Custom Tool Broker + Air-Gapped Executor Cell Proof
export const SPRINT3V_AGENT_NAME = 'Powerplant Isolated Executor Probe Agent' as const
export const SPRINT3V_STATE_PATH = '.powerplant/state/sprint3v-executor-probe.json' as const
export const SPRINT3V_RUNTIME_BASE = '/tmp/powerplant-sprint3v' as const
export const SPRINT3V_REPORTS_DIR = '.powerplant/reports' as const
export const SPRINT3V_CUSTOM_TOOL_NAME = 'executor_probe' as const
export const SPRINT3V_CUSTOM_TOOL_ACTION = 'verify_isolation_and_output' as const
export const SPRINT3V_EXECUTOR_IMAGE = 'powerplant-executor:sprint3v' as const
export const SPRINT3V_PROOF_FILENAME = 'SPRINT3V_EXECUTOR_PROOF.json' as const
export const SPRINT3V_EGRESS_CANARY = 'POWERPLANT_EGRESS_CANARY' as const
export const SPRINT3V_EGRESS_SINK_PORT = 19999 as const
export const SPRINT3V_WORKER_CANARY_KEY = 'POWERPLANT_WORKER_SECRET_CANARY' as const
export const SPRINT3V_WORKER_CANARY_VALUE = 'SPRINT3V_WORKER_ONLY_VALUE' as const
export const SPRINT3V_FINAL_RESPONSE = 'ISOLATED EXECUTOR PROBE COMPLETE' as const

// Sprint 4A — Sanitized External Pilot Project Adapter
export const SPRINT4A_AGENT_NAME = 'Powerplant Sanitized Project Pilot Agent' as const
export const SPRINT4A_PILOT_MODEL = 'claude-haiku-4-5-20251001' as const
export const PROMPT_ENVELOPE_PROTOCOL_VERSION = 'v1' as const
export const SPRINT4A_STATE_PATH = '.powerplant/state/sprint4a-pilot.json' as const
export const SPRINT4A_RUNTIME_BASE = '/tmp/powerplant-sprint4a' as const
export const SPRINT4A_REPORTS_DIR = '.powerplant/reports' as const
export const SPRINT4A_EXECUTOR_IMAGE = 'powerplant-executor:sprint4a' as const
/**
 * Resolve the Sprint 4A pilot source path from the environment.
 *
 * Throws at call time if SPRINT4A_PILOT_SOURCE_PATH is not set, preventing the
 * empty-string-to-CWD ambiguity that occurs when path.resolve('') returns the
 * current working directory.
 */
export function resolveSprint4aPilotSourcePath(): string {
  const val = process.env['SPRINT4A_PILOT_SOURCE_PATH']
  if (!val) {
    throw new Error(
      'SPRINT4A_PILOT_SOURCE_PATH is not set. ' +
      'Set this environment variable to the absolute path of the pilot project. ' +
      'For local development, add it to your .env file.',
    )
  }
  return val
}

/**
 * Sprint 4A pilot source path resolved at module load time.
 *
 * For contexts that need the path before a session starts (e.g. CLI entry points,
 * vitest test setup). Will be an empty string when the env var is absent —
 * callers that need a guaranteed non-empty path should call
 * resolveSprint4aPilotSourcePath() directly instead of reading this constant.
 *
 * @deprecated Prefer resolveSprint4aPilotSourcePath() for any code path that
 * would pass this value to loadProjectContract or any filesystem operation.
 */
export const SPRINT4A_PILOT_SOURCE_PATH: string =
  process.env['SPRINT4A_PILOT_SOURCE_PATH'] ?? ''
export const SPRINT4A_PILOT_PROJECT_ID = 'powerplant-pilot-status' as const
export const SPRINT4A_FINAL_RESPONSE = 'SANITIZED PILOT PATCH COMPLETE' as const
export const SPRINT4A_MAX_TOOL_CALLS = 30 as const
export const SPRINT4A_MAX_CONTENT_LENGTH = 20000 as const

// Custom tool names
export const SPRINT4A_TOOL_LIST_FILES = 'project_list_files' as const
export const SPRINT4A_TOOL_READ_FILE = 'project_read_file' as const
export const SPRINT4A_TOOL_WRITE_FILE = 'project_write_file' as const
export const SPRINT4A_TOOL_RUN_CHECK = 'project_run_check' as const
export const SPRINT4A_TOOL_FINALIZE = 'project_finalize' as const

// Executor output filenames
export const SPRINT4A_VERIFICATION_FILENAME = 'PILOT_VERIFICATION.json' as const
export const SPRINT4A_TEST_OUTPUT_FILENAME = 'TEST_OUTPUT.txt' as const

// Clearance invariants
export const SPRINT4A_CLEARED_FOR_GENERATED_PILOT = true as const

// Skill Invocation Audit — Stage 2A
export const SKILL_INVOCATION_AUDIT_FILENAME = 'skill-invocation-audit.jsonl' as const

// Skill Lifecycle — Stage 2B: Sanitized Project Invocation
export const SKILL_GUIDED_PILOT_RUNNER_TYPE = 'live-sanitized-pilot' as const
export const SKILL_INVOCATION_PHASE_A = 'phase-a-pre-session' as const
export const SKILL_INVOCATION_PHASE_B = 'phase-b-completion' as const

// Stage 2B Preflight Gates (P0-A / P0-B / P0-C)
export const STAGE2B_PREFLIGHT_BASE = '/tmp/powerplant-stage2b-preflight' as const
export const STAGE2B_ORACLE_TASK_SPEC_VERSION = 'summarizeChecks-v1' as const
export const STAGE2B_PREFLIGHT_EVALUATOR_PROFILE_ID = 'subprocess-node-v1' as const
export const STAGE2B_PREFLIGHT_CONTROL_POLICY_VERSION = 'stage2b-preflight-v1' as const
export const STAGE2B_TOOL_POLICY_VERSION = 'stage2b-tool-policy-v1' as const

// Stage 2B Preflight — capsule-v1 evaluator profile
// Image identity is content-pinned: the evaluator verifies the actual image ID against
// CAPSULE_V1_EXPECTED_IMAGE_ID before any candidate code runs. If the tag is reused with
// a different image, execution is refused. See docker/capsule-v1/build-manifest.json.
export const STAGE2B_CAPSULE_EVALUATOR_PROFILE_ID = 'capsule-v1' as const
export const CAPSULE_DOCKER_IMAGE = 'powerplant-evaluator:node-test-js-v1' as const
export const CAPSULE_V1_EXPECTED_IMAGE_ID = 'sha256:e76106374cf197074f855721173fd0c0b77265ec2c7a5372a9f39fa9b48ef0bc' as const
export const CAPSULE_ORACLE_MOUNT_TARGET = '/oracle' as const
export const CAPSULE_WORKSPACE_MOUNT_TARGET = '/workspace' as const
export const CAPSULE_OUTPUT_MOUNT_TARGET = '/output' as const
export const CAPSULE_MAX_OUTPUT_BYTES_DEFAULT = 65536 as const   // 64 KB
export const CAPSULE_TIMEOUT_MS_DEFAULT = 10000 as const         // 10s (includes container start)
export const CAPSULE_PIDS_LIMIT = 64 as const
export const ORACLE_TRUSTED_RESULT_PREFIX = 'ORACLE_TRUSTED_RESULT:' as const
