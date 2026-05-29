# BUILD LOG — Claude Powerplant Engineering Journal

## Purpose

`docs/BUILD_LOG.md` is the ongoing chronological engineering journal for shipped work, investigations, failed approaches, accepted repairs, and next authorized actions. It is intended to preserve the reasoning trail without rewriting history.

## Authority Boundary

This document is **non-normative**.
- For completion status, the [Release Ledger](architecture/Stage%202B%20Completion%20and%20GitHub%20Release%20Ledger.md) controls.
- For acceptance evidence, the [Stage 2B L1 Acceptance Report](acceptance/STAGE_2B_L1_LIVE_ACCEPTANCE_REPORT.md) controls.
- For code truth, committed tests and implementation control.
- If this log conflicts with those sources, the authoritative source wins; correct this log in a later entry rather than silently rewriting it.

## Entry Discipline

Every material project task should append one short entry containing:
- Date, branch, and ending commit hash
- Objective
- Files/surfaces changed
- Validation result
- Accepted claim or blocker
- Next authorized action

## Safety Discipline

Do **not** record:
- Live session identifiers
- API keys, environment values, or credentials
- Raw external transcripts
- Absolute operator-local paths
- Unsanitized runtime artifacts

Use redaction tokens such as:
- `[REDACTED_LIVE_SESSION_ID]`
- `[REDACTED_LIVE_AGENT_ID]`
- `[REDACTED_LIVE_ENVIRONMENT_ID]`
- `[REDACTED_LOCAL_PATH]`

---

## Sprint 0 — Config + Contracts

Completion checklist:

- [x] `package.json` with strict ESM (`"type": "module"`) and Vitest/TS only deps
- [x] `tsconfig.json` with `strict`, `NodeNext`, `noUncheckedIndexedAccess`
- [x] `vitest.config.ts` pointing at `tests/**/*.test.ts`
- [x] `.env.example` documenting required and optional env vars
- [x] `.gitignore` covering `node_modules/`, `.env`, build outputs
- [x] `src/config/env.ts` — Zod-validated env loader
- [x] `src/config/constants.ts` — package name, version, defaults
- [x] `src/contracts/artifact-manifest.ts` — Zod schemas + inferred types
- [x] `tests/config.test.ts` — 5 cases covering env validation
- [x] `tests/artifact-manifest.test.ts` — 4 cases covering manifest schema
- [x] `fixtures/sample-project/` — minimal TS project with passing test
- [x] `docs/ARCHITECTURE.md` — sprint-by-sprint layer map
- [x] `docs/SECURITY_BOUNDARY.md` — secrets, policy, self-hosted constraints
- [x] `docs/OUTPUT_CONTRACT.md` — manifest shape and invariants
- [x] `docs/DECISIONS.md` — ADRs 0001–0006
- [x] `docs/BUILD_LOG.md` — this file
- [x] `README.md` — entry point for new contributors
- [x] `npm install` completes
- [x] `npx tsc --noEmit` passes with zero errors (main + fixture)
- [x] `npx vitest run` passes (9 main + 2 fixture)
- [x] No forbidden references (`claude-agent-sdk`, `query()`, `permissionMode`, `acceptEdits`, `SDKResultMessage`) in `src/`, `tests/`, or `fixtures/`

## Sprint 1A — Cloud lifecycle smoke

Completion checklist:

- [x] `@anthropic-ai/sdk` installed (^0.98.0); `tsx` dev dep added for CLI
- [x] `vitest.config.ts` excludes `tests/**/*.live.test.ts` so `npm test` never makes API calls
- [x] `.powerplant/state/` and `.powerplant/reports/` directories created
- [x] `.gitignore` covers `.powerplant/state/*.json` and `.powerplant/reports/*.json`
- [x] `.env.example` documents `CLAUDE_POWERPLANT_MODEL_ID` as required for live runs
- [x] `validateEnv()` keeps Sprint 0 behaviour; adds optional `CLAUDE_POWERPLANT_MODEL_ID`
- [x] `validateLiveEnv()` added: requires both `ANTHROPIC_API_KEY` and `CLAUDE_POWERPLANT_MODEL_ID`
- [x] `src/config/constants.ts` adds `SMOKE_*` constants
- [x] `power/agent/SYSTEM.md` system prompt for the smoke agent
- [x] `src/platform/client.ts` — `createClient()` returning `new Anthropic()`
- [x] `src/platform/managed-agent-state.ts` — Zod-validated state file under `.powerplant/state/`
- [x] `src/platform/event-transcript.ts` — pure assertion logic, fully unit-testable
- [x] `src/provision/ensure-cloud-agent.ts` — load-or-create agent, no `tools` field
- [x] `src/provision/ensure-cloud-environment.ts` — load-or-create env, handles 409 reuse
- [x] `src/sessions/run-cloud-lifecycle-smoke.ts` — provision + session + stream + assert + report
- [x] `src/cli/sprint1a-cloud-smoke.ts` — CLI entry, exit code reflects pass/fail
- [x] `tests/managed-agent-state.test.ts` — 5 schema cases
- [x] `tests/event-transcript.test.ts` — 5 assertion cases
- [x] `tests/sprint1a-cloud-smoke.live.test.ts` — gated on `RUN_LIVE_MANAGED_AGENTS_TEST=1`, excluded from `npm test`
- [x] `npm run typecheck` passes with zero errors
- [x] `npm test` passes (4 + 5 + 5 + 5 = 19 cases)
- [x] No forbidden references in `src/`, `tests/`, `fixtures/`, `power/`

Live run results (when credentials provided): see
`.powerplant/reports/sprint1a-cloud-smoke-*.json`.

## Sprint 1B — Controlled Cloud Tool / Artifact Proof

Completion checklist:

- [x] `src/approvals/tool-confirmation-policy.ts` — `evaluateWritePolicy()` + `PendingToolUse` type
- [x] `src/approvals/confirmation-event-handler.ts` — `runWithConfirmation()` stream-first loop with `user.tool_confirmation` events
- [x] `src/platform/cloud-output-probe-state.ts` — Zod schema + load/save for output-probe state
- [x] `src/provision/ensure-cloud-output-agent.ts` — create agent with `write`-only toolset, `always_ask`
- [x] `power/agent/OUTPUT_PROBE_SYSTEM.md` — system prompt: write exactly one file to `/mnt/session/outputs/`
- [x] `src/outputs/list-session-outputs.ts`, `download-session-output.ts`, `validate-output-file.ts`
- [x] `src/sessions/run-cloud-output-allow-smoke.ts` — creates session, approves write, verifies output
- [x] `src/sessions/run-cloud-output-deny-smoke.ts` — creates session, denies write, verifies no output
- [x] `src/cli/sprint1b-cloud-output.ts` — CLI entry; runs allow + deny paths
- [x] `tests/tool-confirmation-policy.test.ts` — unit tests for policy evaluation
- [x] `tests/output-validation.test.ts` — unit tests for output file validation
- [x] `tests/sprint1b-cloud-output.live.test.ts` — gated on `RUN_LIVE_MANAGED_AGENTS_TEST=1`
- [x] `npm run typecheck` passes with zero errors
- [x] `npm test` passes
- [x] No forbidden references

Live run results: see `.powerplant/reports/sprint1b-output-allow-*.json` and
`.powerplant/reports/sprint1b-output-deny-*.json`.

## Sprint 2A — Self-hosted EnvironmentWorker (in progress)

Sprint 2A proves that the local `EnvironmentWorker` can claim sessions,
execute tool calls on the local filesystem, and return results.

**Setup required before first run:**

```bash
# 1. Provision environment + agent (one-time, uses API key)
npm run sprint2a:provision

# 2. In the Anthropic Console, open the environment → Generate environment key
#    Then add to .env:
#    ANTHROPIC_ENVIRONMENT_KEY=sk-ant-oat01-...
#    ANTHROPIC_ENVIRONMENT_ID=env_...

# 3. Terminal A — start the worker (long-running)
npm run sprint2a:worker

# 4. Terminal B — fire a session and verify local file output
npm run sprint2a:session
```

Completion checklist:

- [x] `src/config/constants.ts` — Sprint 2A constants
- [x] `src/config/env.ts` — `validateSprint2aLiveEnv()` (requires `ANTHROPIC_ENVIRONMENT_KEY`)
- [x] `.env.example` — documents `ANTHROPIC_ENVIRONMENT_KEY` and `ANTHROPIC_ENVIRONMENT_ID`
- [x] `src/platform/self-hosted-state.ts` — Zod schema + load/save for self-hosted state
- [x] `src/provision/ensure-self-hosted-environment.ts` — create/reuse `self_hosted` environment + print Console instructions
- [x] `src/provision/ensure-self-hosted-agent.ts` — create agent with `write` tool, `always_allow`
- [x] `power/agent/SELF_HOSTED_PROBE_SYSTEM.md` — system prompt for self-hosted probe agent
- [x] `src/worker/run-self-hosted-worker.ts` — `EnvironmentWorker` wrapper, reads env ID from state
- [x] `src/sessions/run-self-hosted-output-probe.ts` — create session, stream events, verify local file
- [x] `src/cli/sprint2a-provision.ts` — one-shot provision CLI
- [x] `src/cli/sprint2a-worker.ts` — long-running worker CLI
- [x] `src/cli/sprint2a-session.ts` — session + verify CLI
- [x] `tests/sprint2a-self-hosted.live.test.ts` — gated on `RUN_LIVE_SPRINT2A_TEST=1`
- [x] `npm run typecheck` passes with zero errors
- [x] `npm test` passes (unit tests unaffected)
- [ ] Live run: worker starts, session fires, probe file written, report saved

What Sprint 2A proves:

- Self-hosted environment creation and persistence round-trip.
- `EnvironmentWorker` starts locally, polls the Anthropic control plane.
- When a session targets the self-hosted environment, the worker claims it.
- Agent's `write` tool call executes on the local filesystem inside `workdir`.
- The orchestrator can observe events and verify local file output without Anthropic serving the file.

What Sprint 2A does NOT prove:

- Sandbox isolation (no Docker — that is Sprint 2B).
- Path restrictions or secret-denial (no `unrestrictedPaths` hardening).
- Project-file mounting (that is Sprint 3).

## Sprint 2B — Docker container-per-session worker

Sprint 2B replaces the in-process `EnvironmentWorker` with a `WorkPoller` that
spawns a fresh Docker container for every claimed session. The container runs
`ant beta:worker run` as its entrypoint and is responsible for all tool execution
and the `work.stop` lifecycle call. The orchestrator host never receives the API
key inside the container.

**Setup required before first run (assumes Sprint 2A is already provisioned):**

```bash
# 1. Build the sandbox image (one-time)
npm run sprint2b:build

# 2. Terminal A — start the container worker (long-running)
npm run sprint2b:worker

# 3. Terminal B — fire a session and verify per-session workdir output
npm run sprint2b:session
```

Completion checklist:

- [x] `src/config/constants.ts` — Sprint 2B constants (`SPRINT2B_CONTAINER_IMAGE`, `SPRINT2B_WORKDIR`, probe filename/content)
- [x] `sandbox/Dockerfile` — `debian:bookworm-slim` + `ant` CLI; runs as non-root `worker`; `ENTRYPOINT ["ant", "beta:worker", "run"]`
- [x] `src/worker/spawn-container-session.ts` — `spawnContainerSession()` + `sessionWorkdir()` helper; passes only session-scoped env vars (never `ANTHROPIC_API_KEY`); mounts per-session host dir as `/workspace`
- [x] `src/worker/run-container-worker.ts` — `runContainerWorker()` using `WorkPoller` with `autoStop: false`; spawns container per session; logs errors without crashing the poll loop
- [x] `src/sessions/run-sprint2b-output-probe.ts` — session probe: reads probe file from `sessionWorkdir(session.id)`
- [x] `src/cli/sprint2b-worker.ts` — long-running container worker CLI with SIGTERM/SIGINT handling
- [x] `src/cli/sprint2b-session.ts` — session + verify CLI
- [x] `tests/sprint2b-container.live.test.ts` — gated on `RUN_LIVE_SPRINT2B_TEST=1`; worker + session in same process; 120s timeout
- [x] `package.json` — added `sprint2b:build`, `sprint2b:worker`, `sprint2b:session`, `test:live:sprint2b` scripts
- [x] `npm run typecheck` passes with zero errors
- [x] `npm test` passes (unit tests unaffected)
- [x] Live run: container worker starts, session fires, container spawned, probe file written in per-session workdir, report saved

What Sprint 2B proves:

- Each session runs in a fresh, isolated Docker container.
- The container receives only session-scoped credentials — no host API key.
- The `ant beta:worker run` entrypoint handles tool execution, heartbeats, and `work.stop` inside the container.
- The per-session workdir is mounted from the host, so the orchestrator can verify file output locally after the container exits.
- `WorkPoller` with `autoStop: false` correctly defers `work.stop` to the container.

What Sprint 2B does NOT prove:

- Path-confinement hardening or secret-denial within the container (adversarial tests — deferred).
- Project-file mounting from an external repo (that is Sprint 3).

## Sprint 3A — Read-Only Mount Connectivity Probe: PASSED

Sprint 3A proves that a host directory can be mounted read-only at `/workspace/project:ro`
inside a container session and that the container worker can access its contents via bash.

**⚠ Sprint 3 Security Boundary: FAILED / NOT CLEARED**

Finding: The `read` tool path allowlist does NOT restrict bash. `bash: cat /workspace/project/...`
reads externally-mounted files freely. Tool-level allowlists are not a confidentiality
boundary when bash is enabled. `clearedForRealProjectMounting: false` — Sprint 3R must pass
before any real project directory may be mounted.

Correct rule: when bash is enabled, the container mount configuration is the authoritative
read boundary. Never mount a real project root, `.env`, `.git`, secrets, or runtime state
into a bash-enabled worker. Build a sanitized disposable workspace containing only
explicitly permitted files. See Sprint 3R.

Sprint 3A proves read-only mount connectivity. The project adapter requires Sprint 3R.

**Setup required before first run (assumes Sprint 2B image is already built):**

```bash
# 1. Provision the Sprint 3 agent (one-time, uses API key)
npm run sprint3:provision

# 2. Terminal A — start the Sprint 3 container worker (long-running)
npm run sprint3:worker

# 3. Terminal B — fire a session and verify output
npm run sprint3:session
```

Completion checklist:

- [x] `src/config/constants.ts` — Sprint 3 constants (`SPRINT3_AGENT_NAME`, `SPRINT3_STATE_PATH`, `SPRINT3_WORKDIR`, `SPRINT3_PROJECT_MOUNT`, `SPRINT3_TOKEN_FILENAME`, `SPRINT3_PROBE_FILENAME`, `SPRINT3_PROBE_EXPECTED_CONTENT`, `SPRINT3_PROBE_FINAL_RESPONSE`)
- [x] `fixtures/sample-project/POWERPLANT_TOKEN.txt` — token file content: `"SAMPLE PROJECT ONLINE"`
- [x] `src/worker/spawn-container-session.ts` — added `projectDir?: string` to `SpawnContainerOptions`; mounts `-v {projectDir}:/project:ro` when provided
- [x] `src/worker/run-container-worker.ts` — added `projectDir?: string` to `ContainerWorkerOptions`; threads through to `spawnContainerSession`
- [x] `src/platform/sprint3-state.ts` — Zod schema + load/save for Sprint 3 state
- [x] `src/provision/ensure-sprint3-agent.ts` — creates agent with `read` + `write` tools, `always_allow`; reuses existing self-hosted environment
- [x] `power/agent/SPRINT3_PROJECT_PROBE_SYSTEM.md` — system prompt: read `/project/POWERPLANT_TOKEN.txt`, write to `/workspace/sprint3-probe.txt`, respond "PROJECT READ"
- [x] `src/sessions/run-sprint3-project-probe.ts` — session probe: reads probe file from `sessionWorkdir(session.id)`
- [x] `src/cli/sprint3-provision.ts` — one-shot provision CLI
- [x] `src/cli/sprint3-worker.ts` — long-running worker CLI; passes `projectDir=fixtures/sample-project`, `workspacesDir=SPRINT3_WORKDIR`
- [x] `src/cli/sprint3-session.ts` — session + verify CLI
- [x] `tests/sprint3-project.live.test.ts` — gated on `RUN_LIVE_SPRINT3_TEST=1`; worker + session in same process; 120s timeout
- [x] `package.json` — added `sprint3:provision`, `sprint3:worker`, `sprint3:session`, `test:live:sprint3` scripts
- [x] `npm run typecheck` passes with zero errors
- [x] `npm test` passes (34 unit tests, unaffected)
- [x] Live run: Sprint 3 worker starts, session fires, container reads `/workspace/project/POWERPLANT_TOKEN.txt` via bash, writes content to `/workspace/sprint3-probe.txt`, report saved

What Sprint 3A proves:

- A host directory mounts read-only at `/workspace/project:ro` and the container can access it.
- Bash (`cat`) can read externally-mounted project files.
- The orchestrator can verify output in the per-session workdir after the container exits.

What Sprint 3A does NOT prove:

- That sensitive project files are protected when bash is enabled (they are not — see finding above).
- That real project mounting is safe (it is not — requires Sprint 3R sanitizer first).

## Sprint 3R — Sanitized Workspace Builder + Bash Boundary Proof: PASSED

Sprint 3R proves that a host-side sanitized workspace can be built from a source
directory, mounted read-only into a container session, and that the container can
read only permitted files while all forbidden files are physically absent.

**Live run result (2026-05-27):**

```
Sprint 3R: PASSED
  sanitizedWorkspace:               .powerplant/runtime/sprint3r/sprint3r-1779910655262/workspace/project
  permittedTokenRead:                true  (POWERPLANT_ALLOWED_TOKEN)
  forbiddenPathsAbsent:              true
  forbiddenCanariesAbsent:           true
  sourceUnmodified:                  true
  unapprovedToolCallsExecuted:       false
  clearedForRealProjectMounting:     false
```

**Design notes:**

- `always_ask` with a container worker (`ant beta:worker run`) cannot gate pre-execution: `ant` executes tools locally and posts the result in ~milliseconds, before any network round-trip can deliver `user.tool_confirmation`. The API enforces confirmation at result-posting time; `ant` logs `posted=false` on a permanent 400 and does not retry. Use `always_allow` for container sessions; the sanitized workspace is the real protection.
- `session.status_idle` with `stop_reason.type === 'requires_action'` fires while `ant` is executing tools — do NOT break out of the event loop on this. Continue waiting; break only on non-`requires_action` stop reasons (same pattern as Sprint 3A).
- The `ant` write tool writes relative to its container working directory (`/workspace`) — do NOT pass absolute paths like `/workspace/SPRINT3R_BOUNDARY_RESULT.json`; use the bare filename.
- `clearedForRealProjectMounting` remains `false`. The sanitizer is proven for the fixture. Adversarial tests (symlink injection, traversal, canary exfiltration) required before any real project may be mounted.

Completion checklist:

- [x] `fixtures/mount-boundary-project/` — 9 files: 4 allowed + 5 forbidden canaries (`.env`, `credentials.json`, `.git/config`, `private/secret.txt`, `data/runtime-state.json`)
- [x] `src/config/constants.ts` — Sprint 3R constants (`SPRINT3R_AGENT_NAME`, `SPRINT3R_STATE_PATH`, `SPRINT3R_WORKDIR`, `SPRINT3R_RUNTIME_BASE`, `SPRINT3R_ALLOWED_TOKEN`, `SPRINT3R_BOUNDARY_OUTPUT_FILENAME`, `SPRINT3R_PROBE_FINAL_RESPONSE`)
- [x] `src/projects/project-contract.ts` — Zod schema enforcing `realProjectMounted: false`, `workspaceMode: 'sanitized_copy_only'`, non-empty `includePaths`; `SPRINT3R_FIXTURE_CONTRACT` constant
- [x] `src/projects/build-sanitized-workspace.ts` — allowlist-only copy (never copy-all-then-delete); single-pass `matchesGlob()` tokenizer; symlink rejection; SHA-256 manifest
- [x] `src/projects/validate-sanitized-workspace.ts` — checks `denyIfPresentAfterCopy` + scans all file contents for `POWERPLANT_FORBIDDEN` canary marker
- [x] `src/projects/create-mount-manifest.ts` — security invariants: `clearedForRealProjectMounting: false` always; throws if `mountedHostPath` doesn't contain `.powerplant/runtime/`
- [x] `src/approvals/bash-confirmation-policy.ts` — `evaluateBashPolicy()` + `evaluateWriteOutputPolicy()` (for future cloud-session use)
- [x] `src/approvals/confirmation-event-handler.ts` — `immediateConfirmation` option added (for cloud sessions with fast tool execution); not used in Sprint 3R
- [x] `src/platform/sprint3-state.ts` — `Sprint3rState`, `loadSprint3rState()`, `saveSprint3rState()` added
- [x] `src/provision/ensure-sprint3r-agent.ts` — dedicated Sprint 3R agent with `bash`+`write` `always_allow`; separate state from Sprint 3A
- [x] `power/agent/SPRINT3R_BOUNDARY_PROBE_SYSTEM.md` — system prompt: run exact commands, respond "BOUNDARY PROOF COMPLETE"
- [x] `src/sessions/run-sprint3r-workspace-boundary.ts` — build workspace → validate → create manifest → provision agent → container session → event loop (Sprint 3A pattern) → post-session tool call verification → SHA-256 source integrity check → re-validate workspace
- [x] `src/cli/sprint3r-workspace-boundary.ts` — CLI entry
- [x] `tests/project-contract.test.ts` — 5 schema cases
- [x] `tests/sanitized-workspace.test.ts` — 15 cases (matchesGlob unit tests + builder + validator)
- [x] `tests/mount-manifest.test.ts` — 4 invariant cases
- [x] `package.json` — added `sprint3r:run`, `test:live:sprint3r` scripts
- [x] `npm run typecheck` passes with zero errors
- [x] `npm test` passes (58 tests)
- [x] Live run: sanitized workspace built and validated, container reads permitted token via bash, writes result file, all forbidden paths absent, source unmodified

What Sprint 3R proves:

- Host-side sanitized workspace builder correctly copies only allowlisted files.
- Forbidden files (`.env`, credentials, `.git`, `private/`, `data/`) are physically absent from the mounted workspace — bash cannot reach them even if it tries.
- The container reads `POWERPLANT_ALLOWED_TOKEN` from the sanitized workspace correctly.
- Source fixture is unmodified after the session.
- `clearedForRealProjectMounting: false` holds as a hard invariant.

What Sprint 3R does NOT prove:

- Safety for real project directories. The fixture contains only canary strings — no real secrets. A full adversarial suite (symlink injection, traversal attempts, exfiltration via bash) is required before `clearedForRealProjectMounting` can change.
- Network egress restriction — a malicious agent could exfiltrate via bash to the internet.

---

## Sprint 3S — Worker Contract Reconciliation

Sprint 3S investigates whether the three behaviours observed in Sprint 3R under `ant`
1.9.1 conform to or diverge from the documented Managed Agents contract. This sprint
produces diagnostic reports, not production features.

**Versions tested:**
- ant worker: 1.9.1 (in `powerplant-sandbox:sprint2b`, digest `8f7946d52540`)
- `@anthropic-ai/sdk`: 0.98.0
- Node.js: v22.22.3

**Live probe results (2026-05-27):**

**Probe A — `always_ask` conformance (cloud session):**
- `requires_action` DID fire before any confirmation was posted ✓
- File was absent at the host path before confirmation ✓
- Session continued to `end_turn` after `allow` ✓ and after `deny` ✓
- File was absent after session (expected — cloud write goes to cloud storage, not host)
- Classification: INCONCLUSIVE by code (host file check can't see cloud storage), but
  the conformance signal is CONFORMANT. `always_ask` correctly gates execution in cloud
  sessions. **The Sprint 3R anomaly was specific to the ant container worker.**

**Probe C — output path contract (inconclusive run):**
- The Probe C container worker picked up the Probe A deny session from the shared
  environment queue before the Probe C session. The Probe C session was served by
  the cloud agent instead. Cloud writes don't produce host-visible files.
- Result: INCONCLUSIVE — session queue pollution from running Probe A and Probe C
  probes in the same environment without cleanup between runs.
- Finding: Need session isolation (separate environments or queue drain) between probes.

**Probe D — bash redirect to `/mnt/session/outputs` (new anomaly found):**
- The container worker claimed the Probe D session correctly.
- The bash command `printf '%s' '...' > /mnt/session/outputs/BASH_OUTPUT_PROBE.txt`
  ran inside the container.
- The file appeared on the host at the mounted outputs directory with correct content:
  `POWERPLANT OUTPUT CONTRACT PROBE` ✓
- `/mnt/session/outputs` IS accessible and writable from inside the container when
  the outputsDir is mounted there.
- **New anomaly:** ant rejected the bash tool result with: `400 Bad Request:
  "events.0.content.0.text: minimum string length is 1"`. Bash commands that redirect
  all output to a file produce empty stdout, and ant requires at least 1 character of
  stdout content to post the tool result. The tool result POST was rejected (`posted=false`).
  The session hung until aborted.

**Probe A finding (reclassification):**

The Sprint 3R Anomaly A (`always_ask` permanent 400 in container worker) is confirmed to
be specific to the ant container worker. Cloud sessions with `always_ask` conform to the
documented contract. The anomaly is in ant's tool execution-before-confirmation timing,
not in the API contract itself.

**New anomalies discovered:**
- **Anomaly D:** ant cannot post bash tool results with empty stdout. Bash commands that
  redirect stdout to a file (`cmd > /path/file`) will get a permanent 400 on the tool
  result POST. Use bash commands that produce at least one character of stdout, or use
  `echo ""` after the redirect.

Completion checklist:

- [x] `docs/KNOWN_COMPATIBILITY_ANOMALIES.md` — three original anomalies documented with version scope; open-question format
- [x] `docs/EXECUTION_MODES.md` — cloud vs container execution differences
- [x] `src/config/constants.ts` — Sprint 3S constants (probes A/C/D)
- [x] `src/worker/spawn-container-session.ts` — `outputsDir` option for `/mnt/session/outputs` mount
- [x] `src/worker/run-container-worker.ts` — `outputsDir` threaded through
- [x] `src/diagnostics/diagnostic-report.ts` — `VersionInfo`, `DiagnosticFinding`, `writeDiagnosticReport()`
- [x] `src/diagnostics/event-ordering.ts` — `classifyAlwaysAskConformance()`, `classifyOutputPathCompliance()`
- [x] `src/diagnostics/host-file-timing.ts` — `checkFileNow()`
- [x] `src/platform/sprint3s-state.ts` — state schema for 3 probe agents
- [x] `power/agent/SPRINT3S_WRITE_PROBE_SYSTEM.md`, `SPRINT3S_OUTPUT_PROBE_SYSTEM.md`, `SPRINT3S_BASH_PROBE_SYSTEM.md`
- [x] `src/provision/ensure-sprint3s-agents.ts` — provisions all 3 probe agents (haiku model, cost-optimized)
- [x] `src/sessions/run-ant-always-ask-diagnostic.ts` — Probe A event loop with pre/post file checks
- [x] `src/sessions/run-output-path-diagnostic.ts` — Probe C (C1 absolute, C2 relative)
- [x] `src/sessions/run-bash-output-diagnostic.ts` — Probe D
- [x] `src/cli/sprint3s-worker-contract.ts` — CLI entry, runs all probes, writes diagnostic report
- [x] `tests/diagnostic-report.test.ts` — 8 cases
- [x] `tests/event-ordering.test.ts` — 12 cases
- [x] `tests/host-file-timing.test.ts` — 5 cases
- [x] `tests/sprint3s-worker-contract.live.test.ts` — gated on `RUN_LIVE_SPRINT3S_TEST=1`
- [x] `package.json` — added `sprint3s:run`, `test:live:sprint3s` scripts
- [x] `npm run typecheck` passes with zero errors
- [x] `npm test` passes (83 tests)
- [x] Live probes run

Security invariants:
- `clearedForRealProjectMounting: false` — unchanged
- `clearedForSanitizedExternalProjectInput: false` — unchanged
- No real project directories were mounted at any point during Sprint 3S
- Probe sessions used sanitized-path or no-project mounts only

What Sprint 3S proves:

- `always_ask` IS conformant with the documented confirmation gate for cloud sessions.
- The Sprint 3R `always_ask` anomaly is specific to ant container workers, not the API.
- `/mnt/session/outputs` IS mountable and writable from inside the container when bound
  via the `outputsDir` option. The volume mount contract works.
- Bash commands that redirect all stdout to a file cannot complete the ant tool dispatch
  cycle — ant requires non-empty stdout (new anomaly D).
- Probe sequencing in a shared environment requires queue isolation between probes;
  running Probe C before the Probe A sessions fully drained caused session mis-claiming.

What Sprint 3S does NOT prove:

- Probe C (write tool to `/mnt/session/outputs`) — the controlled comparison (write tool
  with absolute `/mnt/session/outputs/filename` path) was not successfully isolated.
  Needs a re-run with session isolation or separate environments.
- `always_ask` conformance with a container worker (the Sprint 3R anomaly). Probe A
  used cloud sessions only. A separate probe with a container worker and `always_ask`
  would require careful timing measurement to confirm the anomaly mechanically.

---

## Sprint 3T — Queue-Isolated SDK Worker Selection Gate

Sprint 3T tests three properties with the TypeScript SDK `EnvironmentWorker`:
1. Queue isolation (depth===0/pending===0 preflight + claimed-session-ID assertion)
2. `always_ask allow` end-state correctness
3. `always_ask deny` pre-execution enforcement
4. Isolated write path (C1 absolute, C2 relative)

**Live probe results (2026-05-27, run `sprint3t-1779917742045`):**

**Queue isolation preflight:** CONFIRMED for all three probes.
- `depth===0 AND pending===0` before each session creation ✓
- Correct session claimed (no session mismatch) for all probes ✓
- `skill setup failed 401`: `EnvironmentWorker.setupSkills()` requires the full API key; the env-key client cannot authenticate that call. Non-fatal — the worker logged the error and continued, claiming and servicing the session correctly.

**Probe A — SDK `always_ask` allow: CONFORMANT (with timing anomaly)**
- `requires_action` fired before orchestrator posted confirmation ✓
- bash executed, file present with correct content ✓
- sessionMismatch: false ✓
- `failed to send tool result 400`: SDK `SessionToolRunner` executed bash and tried to POST result before orchestrator could post confirmation. API rejected with 400. Orchestrator then posted `allow`; session completed. End-state: CONFORMANT. Mechanism: anomalous (same as ant — execution precedes confirmation).

**Probe B — SDK `always_ask` deny: ANOMALY**
- `requires_action` fired ✓
- sessionMismatch: false ✓
- `fileFound (expected false): true` — bash executed despite deny ✗
- Same root cause as Probe A: `SessionToolRunner` executed bash locally before orchestrator could post any confirmation. Orchestrator posted `deny`, API rejected the tool result, but the file had already been created by the local bash execution.
- **Anomaly F confirmed: TypeScript SDK `EnvironmentWorker`/`SessionToolRunner` has the same `always_ask` local-execution timing incompatibility as ant 1.9.1. `always_ask deny` cannot prevent bash from running in self-hosted SDK workers.**

**Probe C — isolated write path: INCONCLUSIVE (probe design issue)**
- Queue drained, correct session claimed ✓
- Error: `400 No pending tool permission request found for tool_use_id`
- Root cause: The write probe agent uses `always_allow` (no confirmation needed). The SDK worker executed the write tool and posted the result successfully. But `runWithConfirmation` saw a `requires_action` idle event and tried to post a confirmation for the write tool — the API rejected it because no permission request was pending for that tool.
- Design issue: `runWithConfirmation` is incompatible with `always_allow` agents. It unconditionally posts a confirmation when it sees `requires_action`, regardless of whether the tool needs one. The probe needs a bare event-loop (no confirmation posting) for `always_allow` agents.
- INCONCLUSIVE — not a fundamental limitation of write isolation; needs probe redesign.

**New anomaly discovered:**
- **Anomaly F:** TypeScript SDK `SessionToolRunner` has same `always_ask` local-execution timing as ant 1.9.1. Confirmed and documented in `docs/KNOWN_COMPATIBILITY_ANOMALIES.md`.

**Key finding (security):**
`always_ask` is NOT a pre-execution gate for self-hosted workers (neither ant 1.9.1 nor
TypeScript SDK `EnvironmentWorker`). Bash executes locally before the API confirmation
gate fires. The sanitized workspace (Sprint 3R, filesystem-level access denial) is the
real protection. `SECURITY_BOUNDARY.md` updated accordingly.

Completion checklist:

- [x] `docs/KNOWN_COMPATIBILITY_ANOMALIES.md` — Anomaly E (queue pollution) documented; Anomaly F (SDK SessionToolRunner always_ask timing) documented
- [x] `docs/SECURITY_BOUNDARY.md` — permanent rules for queue isolation, credential isolation, and always_ask self-hosted correction
- [x] `src/config/constants.ts` — Sprint 3T constants (state path, workdir, probe filenames, canary strings, final responses, deny reason)
- [x] `src/config/env.ts` — `validateSprint3tLiveEnv()` (requires API key + environment key)
- [x] `src/platform/sprint3t-state.ts` — Zod schema + load/save for Sprint 3T agent state
- [x] `src/worker/queue-isolation-policy.ts` — `QueueIsolationError`, `assertQueueDrained()`, `assertClaimedSessionMatches()`
- [x] `src/diagnostics/work-queue-preflight.ts` — `checkWorkQueuePreflight()`, `requireQueueDrained()`
- [x] `power/agent/SPRINT3T_BASH_PROBE_SYSTEM.md`, `SPRINT3T_WRITE_PROBE_SYSTEM.md`
- [x] `src/provision/ensure-sprint3t-agents.ts` — provisions bashProbe (always_ask) + writeProbe (always_allow), parallel
- [x] `src/worker/run-sdk-isolated-worker.ts` — `runSdkIsolatedWorker()` using env-key client only, `betaAgentToolset20260401`, `onClaimed` callback
- [x] `src/sessions/run-sdk-approval-allow-diagnostic.ts` — Probe A
- [x] `src/sessions/run-sdk-approval-deny-diagnostic.ts` — Probe B
- [x] `src/sessions/run-isolated-write-path-diagnostic.ts` — Probe C
- [x] `src/cli/sprint3t-sdk-worker-selection.ts` — CLI entry, Probes A→B→C, JSON report
- [x] `tests/queue-isolation-policy.test.ts` — 10 cases
- [x] `tests/work-queue-preflight.test.ts` — 8 cases
- [x] `tests/sdk-approval-diagnostic.test.ts` — 12 cases
- [x] `tests/write-path-classification.test.ts` — 7 cases
- [x] `tests/sprint3t-sdk-worker-selection.live.test.ts` — 4 live tests (gated on `RUN_LIVE_SPRINT3T_TEST=1`)
- [x] `package.json` — added `sprint3t:run`, `test:live:sprint3t` scripts
- [x] `npm run typecheck` passes with zero errors
- [x] `npm test` passes (120 tests)
- [x] Live run completed; report at `.powerplant/reports/sprint3t-sdk-worker-2026-05-27T21-46-07-842Z.json`

Security invariants:
- `clearedForRealProjectMounting: false` — unchanged
- `clearedForSanitizedExternalProjectInput: false` — unchanged
- No real project directories were mounted at any point during Sprint 3T
- SDK worker received only the environment key — no ANTHROPIC_API_KEY

What Sprint 3T proves:

- Queue isolation enforcement (depth===0/pending===0 preflight + session-ID assertion) correctly prevents session mis-claiming when enforced. The Probe B ANOMALY was in confirmation semantics, not in queue isolation — the queue isolation itself worked perfectly.
- TypeScript SDK `EnvironmentWorker` has the same `always_ask` local-execution timing incompatibility as ant 1.9.1. This closes the Sprint 3S open question.
- The production pattern for self-hosted bash workers is `always_allow` + sanitized workspace (Sprint 3R), not `always_ask`. Confirmation gates are only reliable for cloud sessions.
- `skill setup failed 401` is non-fatal — the env-key client cannot authenticate skill-setup API calls, but this does not prevent the worker from claiming and servicing sessions.

What Sprint 3T does NOT prove:

- Write isolation via `always_allow` agent with SDK worker (Probe C INCONCLUSIVE — probe design issue with `runWithConfirmation` posting confirmations for `always_allow` tools). Needs a bare event-loop session runner for `always_allow` probes.
- Whether `immediateConfirmation: true` in `runWithConfirmation` can reliably win the race against the SDK worker's local bash execution. (Likely not — same local-execution timing applies.)
- External project input safety (unchanged from Sprint 3R/3S — `clearedForSanitizedExternalProjectInput: false`).

---

## Sprint 3U — Credential Isolation + Egress Containment Gate

**Date:** 2026-05-28  
**Goal:** Instrument the SDK `EnvironmentWorker` bash subprocess to determine (a) which env vars are visible to bash-tool subprocesses, and (b) whether bash can reach an arbitrary local HTTP endpoint. Three credential probes (K1/K2/K3) + one egress probe (E1) + one output-path probe (O1).

**Agent:** `[REDACTED_LIVE_AGENT_ID]` (Sprint 3U boundary diagnostic, bash-only, always_allow, haiku model)  
**Report:** `.powerplant/reports/sprint3u-boundary-2026-05-28T00-04-02-504Z.json`

### Live probe results

| Probe | Variable / Target | Result | Notes |
|-------|-------------------|--------|-------|
| K1 | `ANTHROPIC_API_KEY` | **ABSENT** ✓ | Scrubbed by `betaAgentToolset20260401` / `scrubbedShellEnv()` |
| K2 | `POWERPLANT_WORKER_SECRET_CANARY` (non-ANTHROPIC_ canary) | **PRESENT** ✗ | `scrubbedShellEnv()` only strips `ANTHROPIC_*`; all other process.env vars pass through |
| K3 | `ANTHROPIC_ENVIRONMENT_KEY` | **ABSENT** ✓ | Also in `ANTHROPIC_*` namespace, correctly scrubbed |
| E1 | Egress to `http://127.0.0.1:<port>/canary` | **canaryReceived: true** ✗ | curl reached the local HTTP sink — bash has unrestricted host network access |
| O1 | Write to `outputs/SPRINT3U_OUTPUT.txt` | **PASSED** ✓ | File found, content correct, no extra files |

**credentialBoundaryPassed:** false (K2 PRESENT)  
**arbitraryEgressBlocked:** false (canaryReceived=true)  
**approvedOutputPathWorks:** true

### Branch determination

| Branch | Condition | Value |
|--------|-----------|-------|
| B | `toolExecutionInheritsWorkerEnvironment` (K2 PRESENT) | **true** |
| C | `!arbitraryEgressBlocked` (canaryReceived) | **true** |
| **BC** | B + C | **true** |

**True branch: BC**  
- `requiresBrokerExecutorSplit: true` — non-`ANTHROPIC_*` env vars visible to bash subprocess
- `requiresNetworkEgressHardening: true` — bash runs on host network, can reach localhost services

### Bugs found and fixed during Sprint 3U

**Bug 1 — `runAlwaysAllowSession` stream consumption (FIXED):**
On the first run, K probe took 11+ minutes for the worker to cold-start. The SDK's SSE stream connection timed out (server closed the connection). The `for await` loop exited normally (stream exhausted without a terminal event), `done` was still `false`, and the outer `while` re-attempted iteration of the already-consumed stream → `Error: Cannot iterate over a consumed stream`. Fixed: added `sawTerminal` tracking; if the stream is exhausted without a terminal event, re-open and wait (up to `maxClosedReconnects=8` times).

**Bug 2 — `determineBranch` gating Branch C on `httpClientAvailable` (FIXED):**
`httpClientAvailable` is derived from a result file written by the bash command to the CWD. If the result file is missing (CWD mismatch or timing race with worker abort), `httpClientAvailable=false` even when curl actually ran. Since `arbitraryEgressBlocked = !canaryReceived` and the sink directly observed the canary, `canaryReceived` is the authoritative signal. Removed `&& egressResult.httpClientAvailable` from Branch C condition.

### Anomaly G — `skill setup failed 401` from EnvironmentWorker (non-fatal)

Each EnvironmentWorker session emits `skill setup failed { error: 'Error: 401 ...' }` internally when attempting skill setup against the API. This happens because the worker authenticates with the environment key, which cannot authenticate skill-setup calls that require the API key. This is non-fatal — the worker still claims sessions and executes tools successfully. Same pattern as Sprint 3T.

### Security invariants

- `clearedForRealProjectMounting: false` — unchanged, permanent
- `clearedForSanitizedExternalProjectInput: false` — unchanged; requires Branch A which is not proven
- No real project directories mounted
- No credential values in report; only presence/absence tokens recorded

Completion checklist:

- [x] `src/config/constants.ts` — Sprint 3U constants (K1/K2/K3 tokens, E1/O1 filenames, canary values)
- [x] `src/config/env.ts` — `validateSprint3uLiveEnv()`
- [x] `src/platform/sprint3u-state.ts` — Zod schema + load/save
- [x] `src/worker/credential-boundary.ts` — `parseKeyPresence`, `classifyCredentialBoundary`, `selectBranchFromCredentials`
- [x] `src/worker/egress-boundary.ts` — `startEgressSink`, `buildEgressProbeCommand`
- [x] `src/sessions/run-always-allow-session.ts` — bare event-loop for always_allow sessions; stream reconnect fix
- [x] `src/diagnostics/run-env-visibility-probe.ts` — K1/K2/K3 probes
- [x] `src/diagnostics/run-egress-sink-probe.ts` — E1 probe
- [x] `src/diagnostics/run-output-preservation-probe.ts` — O1 probe
- [x] `src/sessions/run-sdk-boundary-diagnostic.ts` — orchestrator; `determineBranch` fix (Branch C gated on canaryReceived, not httpClientAvailable)
- [x] `src/provision/ensure-sprint3u-agent.ts` — provisions Sprint 3U agent (bash-only, always_allow)
- [x] `src/cli/sprint3u-security-boundary.ts` — CLI entry; prints results table
- [x] `power/agent/SPRINT3U_BOUNDARY_PROBE_SYSTEM.md` — system prompt
- [x] `tests/credential-boundary.test.ts` — 18 cases
- [x] `tests/egress-boundary.test.ts` — 17 cases
- [x] `tests/sprint3u-report.test.ts` — 24 cases
- [x] `package.json` — added `sprint3u:run`, `test:live:sprint3u` scripts
- [x] `npm run typecheck` passes with zero errors
- [x] `npm test` passes (179 tests)
- [x] Live run 2 completed; report at `.powerplant/reports/sprint3u-boundary-2026-05-28T00-04-02-504Z.json`

### What Sprint 3U proves

- `betaAgentToolset20260401` / `scrubbedShellEnv()` successfully strips all `ANTHROPIC_*`-prefixed env vars from bash subprocesses. The API key and environment key are not visible to bash tool calls.
- All non-`ANTHROPIC_*` env vars from the worker process ARE visible to bash subprocesses. Any secret loaded into the worker's environment (e.g., database credentials, private tokens) would be inherited.
- The SDK `EnvironmentWorker` bash tool runs directly on the host network. There is no network isolation layer. Bash can reach any localhost service, LAN endpoint, or internet destination the host can reach.
- The approved output path (`outputs/` subdirectory inside workdir) works correctly as a write boundary for SDK worker sessions.

### What Sprint 3U does NOT prove

- Credential isolation without broker/executor split — Branch B means a broker/executor architecture is required for production (no credential-bearing state in the executor process).
- Network egress containment without OS-level isolation — Branch C means network isolation (iptables, Docker `--network=none`, or equivalent) is required for production executors.
- `clearedForSanitizedExternalProjectInput` — requires Branch A (all conditions met); not achieved.
- `clearedForRealProjectMounting` — permanently false.

---

## Sprint 3V — Custom Tool Broker + Air-Gapped Executor Cell Proof

**Date:** 2026-05-28  
**Goal:** Prove that a Managed Agent with only one custom tool (no built-in toolset) can be
brokered by the host application to launch an air-gapped Docker executor. Verify: credential
isolation, egress containment, non-root execution, and source-project isolation in the executor cell.

**Architecture:** The Sprint 3U verdict (Branch BC) established that the in-process
`EnvironmentWorker` bash path is permanently diagnostic-only. Sprint 3V implements the
production architecture: a cloud Managed Agent exposes NO built-in tools and exactly ONE
custom tool (`executor_probe`). The broker receives `agent.custom_tool_use` events, validates
the typed request via Zod, launches a Docker container with empty environment and `--network none`,
reads the proof artifact from the output bind-mount, and returns a bounded
`user.custom_tool_result`.

**Agent:** provisioned at runtime via `ensure-sprint3v-agent.ts` (no built-in toolset;
`type: 'custom'` tool only; reuses Sprint 1A cloud environment)

### Session invariants enforced

| Check | Enforcement |
|-------|------------|
| No built-in tool calls | broker rejects any `agent.tool_use` event |
| Exactly one custom tool call | broker throws if `customToolUseCount > 1` |
| Custom tool name is `executor_probe` | `isKnownCustomToolName()` gate |
| Input is `{ action: 'verify_isolation_and_output' }` | Zod strict enum + no extra keys |
| Final response exact | `SPRINT3V_FINAL_RESPONSE` constant comparison |

### Executor container controls

| Control | Value |
|---------|-------|
| Image | `powerplant-executor:sprint3v` |
| Network | `--network none` |
| Root filesystem | `--read-only` |
| Capabilities | `--cap-drop ALL` |
| Privilege escalation | `--security-opt no-new-privileges` |
| User | `--user 1001:1001` |
| Environment | empty (no `-e` or `--env-file`) |
| Mounts | output dir only (`/mnt/session/outputs`) |
| tmpfs | `/tmp:rw,noexec,nosuid,size=16m` |

### Security invariants

- `clearedForRealProjectMounting: false` — permanent invariant, never changes
- `clearedForSanitizedExternalProjectInput: false` — unchanged; Sprint 3V is executor cell proof only
- No credential values in any report; only presence/absence booleans
- Broker sends `custom_tool_use_id` (not `tool_use_id`) in the result event
- Host process env vars not passed to Docker subprocess (`env: {}` in `execFileAsync`)
- Egress sink is an independent host-side HTTP listener; `sinkReceivedCanary` is tracked by the
  broker, not derived from executor-written proof

Completion checklist:

- [x] `src/config/constants.ts` — Sprint 3V constants (agent name, paths, tool name, action, image, canary strings, final response)
- [x] `src/config/env.ts` — `validateSprint3vLiveEnv()` (cloud session; API key only)
- [x] `src/platform/sprint3v-state.ts` — Zod schema + load/save for Sprint 3V agent state
- [x] `src/contracts/custom-tool-contract.ts` — `ExecutorProbeInputSchema`, `ExecutorProofSchema`, `CustomToolResultSchema`, `validateExecutorProbeInput()`, `isKnownCustomToolName()`
- [x] `src/broker/executor-launch-policy.ts` — `validateLaunchPolicy()`, `assertLaunchPolicyPass()`, `buildDockerArgv()` (safe argv, no env flags)
- [x] `src/broker/run-isolated-executor.ts` — launches Docker container; manages egress sink; reads and validates proof artifact
- [x] `src/broker/custom-tool-broker.ts` — stream-first event loop; handles `agent.custom_tool_use`; enforces single-call policy; sends `user.custom_tool_result`
- [x] `src/diagnostics/isolation-proof-report.ts` — `validateIsolationProof()`, `buildCustomToolResult()`, `buildIsolationProofReport()`
- [x] `src/sessions/run-custom-executor-probe-session.ts` — provision → broker session → report
- [x] `src/provision/ensure-sprint3v-agent.ts` — provisions agent with custom tool, no built-in toolset
- [x] `src/cli/sprint3v-isolated-executor.ts` — main CLI; validates env; provisions; runs; saves report
- [x] `src/cli/sprint3v-local-proof.ts` — local Docker proof CLI (no API calls)
- [x] `power/executor/run-isolation-probe.sh` — Alpine shell script; env-var presence check; curl egress attempt; proof JSON write
- [x] `power/executor/Dockerfile` — Alpine 3.19, curl, non-root uid 1001, fixed entrypoint
- [x] `power/agent/ISOLATED_EXECUTOR_PROBE_SYSTEM.md` — system prompt (invoke executor_probe once; respond with exact phrase)
- [x] `tests/custom-tool-contract.test.ts` — input validation, tool name gate, proof schema
- [x] `tests/executor-launch-policy.test.ts` — network policy, forbidden env vars, forbidden mounts, Docker argv shape
- [x] `tests/isolation-proof-report.test.ts` — all proof failure conditions; bounded result; invariant constants
- [x] `tests/custom-tool-broker.test.ts` — tool name gate; schema gate; multiple-call guard; clearance invariants
- [x] `tests/sprint3v-isolated-executor.live.test.ts` — gated on `RUN_LIVE_SPRINT3V_TEST=1`; 120s timeout; full proof assertions
- [x] `package.json` — `sprint3v:build`, `proof:executor:local`, `smoke:executor:custom-tool`, `test:live:sprint3v`
- [x] `npm run typecheck` passes with zero errors
- [x] `npm test` passes (258 tests)
- [x] `npm run proof:executor:local` passes (local Docker containment proof)
- [x] `npm run smoke:executor:custom-tool` passes (live Managed Agents custom-tool session proof)

### Bugs found and fixed during Sprint 3V closure

**Bug 1 — `buildCustomToolResult` imported from wrong module (FIXED):**
`custom-tool-broker.ts` imported `buildCustomToolResult` from `custom-tool-contract.ts` — that function
lives in `diagnostics/isolation-proof-report.ts`. TypeScript caught it during typecheck. Fixed: moved
import to the correct module.

**Bug 2 — `SPRINT3V_CUSTOM_TOOL_ACTION` not in constants import (FIXED):**
`custom-tool-broker.ts` referenced `SPRINT3V_CUSTOM_TOOL_ACTION` without importing it. Fixed: added it
to the `constants.js` import.

**Bug 3 — `SPRINT3V_EXECUTOR_IMAGE` imported from `executor-launch-policy` (FIXED):**
`run-isolated-executor.ts` tried to import `SPRINT3V_EXECUTOR_IMAGE` from `executor-launch-policy.ts`,
which only imports it — it doesn't re-export it. Fixed: import directly from `config/constants.js`.

**Bug 4 — Double `server.listen()` on egress sink (FIXED):**
`startEgressSink` called `server.listen` twice: once inside the `listenPromise` closure (never
returned) and once explicitly after. The second call would throw `Server is already listening` at
runtime. Fixed: removed the redundant explicit call; return `ready: Promise<void>` from the function
and `await sink.ready` in the caller instead of the 100ms timeout.

**Bug 5 — Docker build requires `--network=host` on this host (FIXED):**
UFW `DROP_FORWARD` blocks Alpine package mirror access through Docker's default bridge. Same pattern
as Sprint 2B. Fixed: added `--network=host` to `sprint3v:build` script.

**Bug 6 — Runtime base inside `/home` fails launch policy (FIXED):**
`SPRINT3V_RUNTIME_BASE = '.powerplant/runtime/sprint3v'` resolves to a path inside the user's home
directory when `path.join(process.cwd(), ...)` is applied. The launch policy correctly rejects any
mount matching `/home` or `$HOME`. Fixed: changed constant to `'/tmp/powerplant-sprint3v'` and
updated all callers to use it directly without `path.join(process.cwd(), ...)`.

**Bug 7 — Bind-mount output directory not writable by container uid 1001 (FIXED):**
The host creates the output directory as the host user (e.g., uid 1000). The container runs as uid
1001, which has no write access to a directory owned by uid 1000. Fixed: `fs.chmodSync(outputDir, 0o777)`
after `mkdirSync` in `runIsolatedExecutor`, before Docker is launched.

**Bug 8 — Stale Sprint 1A environment state causes 404 (FIXED):**
The Sprint 1A cloud environment (`[REDACTED_LIVE_ENVIRONMENT_ID]`) had been deleted on the Anthropic
platform since it was provisioned on 2026-05-26. The provision code reuses the stored state without
verifying the resource exists, so session creation returned 404. Fixed operationally: deleted stale
state files (`.powerplant/state/cloud-smoke.json`, `.powerplant/state/sprint3v-executor-probe.json`)
and re-provisioned both.

### Live proof results

**Local Docker proof** (`npm run proof:executor:local`):

| Field | Value |
|-------|-------|
| `anthropicApiKeyPresent` | `false` ✓ |
| `anthropicEnvironmentKeyPresent` | `false` ✓ |
| `workerSecretCanaryPresent` | `false` ✓ |
| `egressAttempted` | `true` |
| `egressSucceeded` | `false` ✓ |
| `sinkReceivedCanary` | `false` ✓ |
| `outputPathOperational` | `true` ✓ |
| `executorUid` | `1001` ✓ |
| `executorIsNonRoot` | `true` ✓ |

**Live Managed Agents session** (`npm run smoke:executor:custom-tool`):

| Field | Value |
|-------|-------|
| Agent | `[REDACTED_LIVE_AGENT_ID]` |
| Session | `[REDACTED_LIVE_SESSION_ID]` |
| `customToolUseCount` | `1` ✓ |
| `builtinToolUseCount` | `0` ✓ |
| `finalResponseCorrect` | `true` ✓ |
| Final response | `"ISOLATED EXECUTOR PROBE COMPLETE"` ✓ |
| `credentialIsolationPassed` | `true` ✓ |
| `egressBlocked` | `true` ✓ |
| `outputValidated` | `true` ✓ |
| `executorIsNonRoot` | `true` ✓ |
| `noSourceProjectMounted` | `true` ✓ |
| `clearedForRealProjectMounting` | `false` (permanent) |
| `clearedForSanitizedExternalProjectInput` | `false` |

Report: `.powerplant/reports/sprint3v-isolated-executor-2026-05-28T08-50-56-254Z.json`

### What Sprint 3V proves

- A cloud Managed Agent with no built-in toolset and exactly one custom tool reaches the broker
  exactly once per session, with no path to invoke bash, write, read, or any other built-in.
- The broker/executor split fully isolates credentials: the executor container receives no
  `ANTHROPIC_*` vars, no non-ANTHROPIC_ worker secrets, and no environment at all.
- `--network none` prevents container egress — the egress canary is never received by the sink,
  and the executor's proof correctly reports `egressSucceeded: false`.
- The executor runs as uid 1001 (non-root); uid 0 is rejected by the proof validation.
- The output path (`/mnt/session/outputs`) is the only shared surface between broker and executor.
- No project source code is mounted or accessible in the executor cell.

### What Sprint 3V does NOT prove

- Project source code execution safety — no real project directories are mounted.
- Sanitized external project input safety — `clearedForSanitizedExternalProjectInput: false`.
- Container escape resistance (seccomp, AppArmor, kernel exploit paths) — not in scope.
- Multi-turn executor sessions — each session invokes the probe exactly once.

### Architecture decisions triggered

- **ADR-0015**: Executor process must run with empty env (no inherited secrets) — pass only allowlisted values explicitly.
- **ADR-0016**: Production executor requires network egress isolation (iptables DROP or Docker `--network=none`).
- **ADR-0017**: Broker/executor split is the required production architecture for self-hosted bash workers.

---

## Sprint 4A — Generated External Pilot Project Adapter

### Goal

Prove Powerplant can operate on a separate, harmless, generated project through a
sanitized disposable snapshot, five typed custom tools, the proven isolated executor,
and fixed verification — without modifying or mounting the source project.

### Completion checklist

- [x] External pilot project created at `[REDACTED_LOCAL_PATH]/`
- [x] Pilot contains forbidden canary files (`.env`, `private/secret.txt`, `deployment/release.txt`)
- [x] `SPRINT4A_PILOT_CONTRACT` defined in `src/contracts/project-pilot-contract.ts`
- [x] Five custom tool Zod schemas in `src/contracts/project-tool-contracts.ts`
- [x] Sanitized snapshot builder: `src/projects/build-pilot-snapshot.ts`
- [x] Source integrity verifier: `src/projects/verify-source-unchanged.ts`
- [x] Patch/evidence package generator: `src/projects/generate-patch-package.ts`
- [x] Sprint 4A executor image: `power/executor/Dockerfile.pilot` + `run-pilot-test.sh`
- [x] Agent system prompt: `power/agent/SANITIZED_PROJECT_PILOT_SYSTEM.md`
- [x] Project executor actions: `src/broker/project-executor-actions.ts`
- [x] Five-tool broker session loop: `src/broker/project-tool-broker.ts`
- [x] Agent provisioning: `src/provision/ensure-sprint4a-agent.ts`
- [x] Session orchestration: `src/sessions/run-sanitized-project-pilot.ts`
- [x] CLI entry point: `src/cli/sprint4a-sanitized-project-pilot.ts`
- [x] Unit tests: `project-pilot-contract`, `project-tool-contracts`, `pilot-snapshot`, `project-tool-broker`, `patch-package`
- [x] Live test: `sprint4a-sanitized-project-pilot.live.test.ts`
- [x] npm scripts: `sprint4a:build`, `pilot:create`, `proof:pilot:snapshot`, `smoke:pilot:project`, `test:live:sprint4a`
- [x] `docs/SECURITY_BOUNDARY.md` updated with Sprint 4A source-disclosure and clearance rules
- [x] `docs/ARCHITECTURE.md` updated with Sprint 4A layer

### Key proof points when live run passes

- External pilot is outside Powerplant — path: `[REDACTED_LOCAL_PATH]/`
- Pilot contains forbidden canaries before sanitization: YES
- Canaries absent from sanitized workspace: YES
- Original source project mounted: NO
- Built-in Managed Agent tools: 0
- Custom project tools only: YES (5 tools)
- Model-supplied shell commands: NONE (check ID "test" maps to fixed `node --test`)
- Executor network: DISABLED (`--network none`)
- Executor credentials: NONE (empty env)
- Verification: PASSED (`node --test` exit 0)
- Patch changes only allowed files: YES (`src/status.js`, `tests/status.test.js`)
- Original external pilot source changed: NO
- Patch auto-applied: NO
- `clearedForGeneratedExternalPilot`: true
- `clearedForRealProjectMounting`: false
- `clearedForSanitizedExternalProjectInput`: false

### Architecture decisions triggered

- **ADR-0018**: Custom project tool surface for external pilot — 5 typed tools replace all built-in toolset access.
- **ADR-0019**: Source-disclosure consent model — allowlisted files sent to Claude session context; real projects require explicit contract authorization.
- **ADR-0020**: Include-only sanitizer + SHA-256 source integrity proof is the minimum required before any real project is admitted.

---

## RC2 — Generic Contract-Driven Engine

**Triggered by:** First real-project dogfood preflight (Singularity Inc.) found that RC1 was pilot-hardcoded.

**Dogfood blocker recorded:**

RC1 validated only the generated pilot. The first real-project preflight found that
`powerplant inspect` and `powerplant run` checked for `.powerplant/POLICY.yaml` existence
but then ignored its contents, using `{ ...SPRINT4A_PILOT_CONTRACT, sourcePath: absPath }`
instead. Runtime enforced pilot's hardcoded paths (`src/status.js`, `tests/status.test.js`)
regardless of what the project policy file declared. Creating a Singularity Inc. contract
would have created a false safety boundary. Work stopped immediately.

**What changed:**

- `src/projects/load-project-contract.ts` (new): reads and validates POLICY.yaml + VERIFY.yaml;
  enforces hard-coded invariants (workspaceMode, realProjectMounted, allowBash) regardless of
  YAML content; rejects forbidden read paths (.env, credentials, keys, Steam signing material).
- `src/contracts/project-tool-contracts.ts`: removed `z.enum(PILOT_ALLOWED_READ_PATHS)` etc.
  from input schemas; schemas now validate shape only (safe relative path, bounded string, valid
  identifier regex); new runtime authorization functions (`isReadPathAuthorized`, `isWritePathAuthorized`,
  `isCheckAuthorized`) use `matchesGlob` for consistent glob semantics.
- `src/provision/ensure-sprint4a-agent.ts`: agent tool schemas changed from enum arrays to generic
  string descriptors; `toolSchemaVersion = 2` added to Sprint4a state so stale agents with
  old enum schemas are automatically re-provisioned.
- `src/broker/project-tool-broker.ts`: accepts `LoadedProjectContract`; broker enforces
  authorization on every `project_read_file`, `project_write_file`, `project_run_check` call.
- `src/cli/commands/inspect.ts` + `run.ts`: both now call `loadProjectContract(absPath)` instead
  of spreading the pilot constant.
- `src/projects/generate-patch-package.ts`: `findChangedWritePaths` walks the workspace and
  matches against `contract.allowedWritePaths` globs; no longer references pilot constants;
  `projectId` taken from loaded contract; `clearedForSanitizedExternalProjectInput` is now
  `true` for any run backed by a valid YAML contract.
- `fixtures/generic-game-qa-project/` (new): structurally different from the pilot
  (`src/engine/**`, `src-tauri/`, Steam canary files) to prove the engine is genuinely
  generic and not hardcoded a second time.
- Pilot project `.powerplant/` YAML files rewritten to match the loader's schema.
- `js-yaml` added as the YAML parser (smallest well-maintained option, zero deps).

**Invariants preserved unchanged:**

- No real project source ever mounted into the executor
- No built-in Managed Agent tools
- Executor runs network-disabled, credentialless
- Patch application remains manual
- `clearedForRealProjectMounting` remains permanently `false`

**Test result:** 463 tests passing (34 files). +37 new contract loader tests.

**Next step:** Create Singularity Inc. `.powerplant/` contract (narrow QA-only scope),
run `powerplant inspect` against it, confirm no pilot paths appear in the disclosure.

---

## Gate 6 — Public Release Sanitation (Stage 2B)

**Date:** 2026-05-29
**Branch:** feat/stage2b-preflight
**Objective:** Sanitize current release surface and establish public documentation.

**Gate 6A finding:** No API credentials or private keys found. Real live runtime identifiers and operator-local absolute paths were discovered in already-public tracked files and Git history.

**Gate 6B1 forward sanitation:** Identified runtime metadata removed or redacted from the current tracked tree. Operator-local paths removed from configuration and source. Precise `.gitignore` recurrence-prevention rules added. Empty-path filesystem fallback replaced with explicit fail-closed resolver. Pilot-dependent tests made conditionally skippable in clean-checkout environments.

**Gate 6B2A documentation:** README updated with accurate verified status and explicit claim boundaries. Build log policy established. Release ledger aligned.

**Validation:** 1042/1042 tests passing (local configured checkout); 1002 passing + 40 conditionally skipped (clean checkout without pilot source); typecheck clean.

**Historical exposure:** Earlier non-credential runtime metadata (live session IDs, agent IDs, environment IDs, operator-local paths) remains in already-public Git history. No history rewrite has been performed. Any such decision requires separate explicit authorization.

**Next authorized action:** Gate 6B2B — CI configuration, SECURITY.md, GitHub branch protection, secret scanning, license verification, and optional history-rewrite decision.

---

## Gate 6B2A Correction — Public Documentation Split-Brain Elimination

**Date:** 2026-05-29
**Branch:** `feat/stage2b-preflight`

**Objective:** Eliminate public-documentation split-brain before release hardening. Two competing journals existed (root `BUILDLOG.md` and `docs/BUILD_LOG.md`); the release ledger referenced the stale root copy; ledger "Current Checkpoint" still claimed no live run had occurred; Public Claim Boundary and Completion Condition sections used overclaim language (`immutable fixture binding`, `sanitized immutable evidence`); README Safety Boundary section was not scoped to the accepted Stage 2B L1 path.

**Surfaces changed:**

- Root `BUILDLOG.md` deleted: single-session repair note whose "next steps" had already been completed; stale duplicate of `docs/BUILD_LOG.md`.
- `docs/architecture/Stage 2B Completion and GitHub Release Ledger.md`:
  - `## BUILDLOG.md Authorization` section renamed `## Engineering Journal Authorization`; reference updated from root `BUILDLOG.md` to `docs/BUILD_LOG.md`; retirement of root `BUILDLOG.md` recorded.
  - Gate 4 end-of-section reference updated from `BUILDLOG.md` to `docs/BUILD_LOG.md`.
  - Current Checkpoint section: removed stale "Live Anthropic/API call: not yet authorized", "Live L1 session: not yet executed", and `36b9efc` accepted-HEAD line; replaced with current milestone statement.
  - Public Claim Boundary "After" clause: replaced `immutable fixture binding` with accepted trusted-directory language.
  - Completion Condition: replaced `sanitized immutable evidence` with `sanitized evidence under the documented trusted-directory assumption`.
- `README.md`: `## Safety Boundary` renamed `## Stage 2B L1 Accepted Safety Boundary`; qualifying sentence added before the property table scoping the claims to the bounded Stage 2B L1 accepted execution path.

**Validation result:** `npm test` and `npx tsc --noEmit` pass (no source changes). Sanitation scans: no `immutable fixture binding`, no `sanitized immutable evidence`, no stale no-live-execution language in ledger. Root `BUILDLOG.md` absent. `docs/BUILD_LOG.md` is the sole journal referenced in the ledger and README.

**Accepted claim:** One canonical engineering journal now exists (`docs/BUILD_LOG.md`). Public claim language in the ledger and README matches the accepted trusted-directory boundary. No overclaims remain in public-facing documentation.

**Next authorized action:** Gate 6B2B — CI workflow, restricted `.env` loading review, `SECURITY.md`, license verification, GitHub branch protection, secret scanning and push protection, and optional separate history-rewrite decision.

---

## Gate 6B2B — CI, Environment Safety, and Security Policy Hardening

**Date:** 2026-05-29
**Branch:** `feat/stage2b-preflight`

**Objective:** Complete pre-push repository hardening: restrict Vitest env loading, add CI, add security policy, verify license status, and record final pre-push state.

**Part 1 — Local commit inventory:**
Branch HEAD = `origin/feat/stage2b-preflight` at start of this gate (zero local commits ahead). All prior Gate 6B1/6B2A commits were already on the remote. `882fdf7` is a Gate 6B2A commit ("establish maintained build log and align release status") confirmed present on origin.

**Part 2 — Surface inspection findings:**

| Surface | Finding |
|---|---|
| CI workflow | Absent — `.github/workflows/` directory did not exist |
| Node version pin | Absent — no `.nvmrc`, `.node-version`, or `engines` field |
| `SECURITY.md` | Absent |
| License | Absent — `PUBLIC_RELEASE_LICENSE_DECISION_REQUIRED` |
| `vitest.config.ts` `.env` loading | Broad empty-prefix `loadEnv('test', cwd, '')` — all `.env` vars including `ANTHROPIC_API_KEY` injected into test process |
| `package-lock.json` | Present, lockfileVersion 3, tracked in git |

**Actions taken:**

- `vitest.config.ts`: narrowed `loadEnv` prefix from `''` to `'SPRINT4A_'`. Only `SPRINT4A_*` env vars are injected into the test process. `ANTHROPIC_API_KEY` and other credentials are no longer reachable via Vitest injection. Proof: `1042/1042` tests pass locally; clean checkout without `.env` passes `1002/1042` with 40 correctly skipped (pilot-dependent suites).
- `.node-version`: added, pins Node 20.
- `.github/workflows/ci.yml`: added clean-checkout CI workflow. Runs on push/PR to `master`/`main`; uses `actions/checkout@v4`, `actions/setup-node@v4` with `node-version-file: '.node-version'`; `npm ci`, `npx tsc --noEmit`, `npm test`; no secrets injected; live tests excluded by `vitest.config.ts`; pilot-integration tests skip automatically when `SPRINT4A_PILOT_SOURCE_PATH` is absent.
- `SECURITY.md`: added at repo root. Covers: containment escape, credential leakage, evidence/receipt forgery, trusted-directory bypass, unintended live agent execution. Reports via GitHub private vulnerability reporting. Includes publication prerequisite: feature must be enabled in repository settings before policy is operative.
- `README.md`: added one-line CI disclosure under Development section.
- Release ledger Gate 6B2B section updated from PENDING to COMPLETE (pre-push local) with exact actions, remaining user-decisions, and repository-settings steps.

**Validation:**

- Current-checkout: `1042/1042` tests passing, typecheck clean.
- Clean-checkout (no `.env`): `1002` passing, 40 skipped (pilot-dependent only), typecheck clean. `npm ci` succeeded from committed lockfile.

**Accepted claim:** Vitest no longer injects credentials into the test environment. CI is configured for clean-checkout validation. `SECURITY.md` is in place pending private-reporting channel verification. No history rewrite performed. No live run executed.

**Remaining user decisions before formal release:**

- Select and add a `LICENSE` file.
- Enable GitHub private vulnerability reporting in repository settings.
- Enable GitHub branch protection and secret scanning in repository settings.
- Optional: authorize history-rewrite decision for pre-Gate-6B1 historical exposure.

**Next authorized action:** One normal forward push of the local Gate 6B2B commit stack after user review.

---

## Gate 6B2B Closure — Apache-2.0 License and Owner Decisions

**Date:** 2026-05-29
**Branch:** `feat/stage2b-preflight`

**Objective:** Close the two remaining owner decisions from Gate 6B2B (license selection and
GitHub Private Vulnerability Reporting) and prepare the local commit for forward push.

**Actions taken:**

- **License selected and added:** Repository owner selected Apache License 2.0. `LICENSE` created
  with the unmodified Apache License, Version 2.0 text (standard ASF form; no paraphrasing, no
  added legal notice, no restrictions inconsistent with Apache-2.0).
- **README updated:** `## License` section added referencing `LICENSE`.
- **GitHub Private Vulnerability Reporting confirmed:** Repository owner confirmed that GitHub
  Private Vulnerability Reporting is enabled in repository settings. `SECURITY.md` is now
  operative through that private reporting channel.
- **Gate 6B2B section in release ledger** updated from `COMPLETE (pre-push local)` to `CLOSED`
  with factual entries for license addition and PVR confirmation.
- **No production code, tests, or acceptance evidence modified.**

**Validation:** Tests and typecheck unchanged from Gate 6B2B baseline (1042/1042 local;
typecheck clean). No new runtime identifiers or credentials introduced. Worktree clean after commit.

**Remaining open before formal release:**
- Hosted CI run: pending push and verification (see Gate 6B2C).
- GitHub branch protection: pending post-push configuration in repository settings.
- Secret scanning and push protection: pending owner confirmation.
- Optional: separate authorized history-rewrite decision.

---

## Gate 6B2C — CI Capsule Provisioning Failure Analysis and Actions Upgrade

**Date:** 2026-05-29
**Branch:** `feat/stage2b-preflight`

**Objective:** Diagnose the observed GitHub Actions CI failure, determine the capsule
trust-root case, implement the permitted atomic repair, and record the blocked state.

**CI failure observed:**

First hosted GitHub Actions run (`ubuntu-latest`) failed. P0-C and P0-E capsule tests emitted:

```
CAPSULE_IMAGE_IDENTITY_MISMATCH:
expected sha256:f496aac93ff3459a5142f2e37aedb025c414f5a7244e299160ae82a3aa29ad48,
got null (image not found).
Execution refused before any candidate code runs.
```

Root cause: the CI workflow runs `npm test` without first building the capsule evaluator image.
The P0-C/P0-E tests call `docker image inspect powerplant-evaluator:node-test-js-v1`; when the
image is absent, `getActualCapsuleImageId()` returns `null`; execution is refused before any
candidate code runs. The evaluator behaved correctly — this is a provisioning gap, not a
test-design failure.

**Capsule trust-root case: Case B — trust root is not CI-reproducible from a clean build.**

Local audit: `docker build --no-cache -t powerplant-evaluator-test-rebuild:probe docker/capsule-v1/`
produced `sha256:cc4ae15db26972b3772f0c91d5c84498c80e5e7d58c9ba04c4fa2522d785445e`.
The pinned constant is `sha256:f496aac93ff3459a5142f2e37aedb025c414f5a7244e299160ae82a3aa29ad48`.

These differ because `docker/capsule-v1/Dockerfile` pins `FROM node:20-bookworm` by mutable
tag only. The `node:20-bookworm` tag has moved since the capsule identity baseline was
established. A clean build on the current base produces a different layer hash.

**Public branch reconciliation:** Confirmed via `git ls-tree` and `git cat-file` that the
pushed branch is not stale relative to prior documentation reports:
- Root `BUILDLOG.md` is absent ✓
- `docs/BUILD_LOG.md` is present and is the sole journal ✓
- `README.md` contains `## Stage 2B L1 Accepted Safety Boundary` (narrowed heading) ✓
- `LICENSE` and `SECURITY.md` are tracked ✓
- No prior documentation correction commits were omitted from the push ✓

**Actions taken in Gate 6B2C:**

- **Actions upgrade:** `actions/checkout@v4` → `@v6`, `actions/setup-node@v4` → `@v6` in
  `.github/workflows/ci.yml`. Addresses GitHub Node.js 20 action-runtime deprecation warnings.
  The project Node version is unchanged (governed by `.node-version: 20`).
- **No capsule constant changed:** `CAPSULE_V1_EXPECTED_IMAGE_ID` in `src/config/constants.ts`
  and `docker/capsule-v1/build-manifest.json` remain unchanged. Updating the pinned identity
  without a new proof report would weaken the capsule trust boundary.
- **No P0-C/P0-E tests weakened or skipped.** Capsule tests remain in `npm test`.

**Blocked state:** CI will continue to fail on P0-C/P0-E until a new reviewed capsule
baseline is established. Required repair (not authorized in this gate):
1. Pin `docker/capsule-v1/Dockerfile` base image by immutable digest.
2. Clean build → record new reproducible image ID.
3. Add CI step to build and verify capsule image before `npm test`.
4. Update `CAPSULE_V1_EXPECTED_IMAGE_ID` and `build-manifest.json`.
5. Run full P0-C/P0-E suite locally; record new proof report.
6. Commit as reviewed capsule baseline with explicit authorization.

**Validation:** `npm test` (1042/1042 local with image present; typecheck clean).
No new credentials, runtime identifiers, or paths introduced. Worktree clean after commit.

**Next authorized action:** Reviewed forward push of Gate 6B2C commits; post-push:
initiate capsule trust-root baseline review with explicit authorization.

---

## Gate 6B2C — Capsule Trust-Root Repair (Authorized)

**Date:** 2026-05-29
**Branch:** `feat/stage2b-preflight`

**Authorization:** Repository owner confirmed the capsule trust-root repair should proceed
on `feat/stage2b-preflight` before any merge to `master`.

**Objective:** Pin the capsule Dockerfile base by immutable digest, establish a new
reproducible capsule image identity, re-run the full P0-C/P0-E proof suite, and make
CI capable of provisioning and verifying the exact trusted evaluator image.

**Root cause summary:** `docker/capsule-v1/Dockerfile` used `FROM node:20-bookworm`
(mutable tag). The `node:20-bookworm` tag moved after the original `sha256:f496aac9...`
baseline was established. A clean rebuild on the current base produced `sha256:cc4ae15d...`
(different from pinned). CI runners, starting with no pre-built image, correctly refused
candidate execution when `getActualCapsuleImageId()` returned `null`.

**Repair actions:**

1. **Dockerfile base pinned by immutable digest:**
   `docker/capsule-v1/Dockerfile` updated to:
   ```
   FROM node:20-bookworm@sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5
   ```
   This digest was obtained by `docker pull node:20-bookworm` on 2026-05-29 and confirmed
   via `docker image inspect node:20-bookworm --format '{{index .RepoDigests 0}}'`.

2. **New capsule image identity baseline:**
   Clean build (`docker build --no-cache -t powerplant-evaluator:node-test-js-v1 docker/capsule-v1/`)
   produced:
   ```
   sha256:e76106374cf197074f855721173fd0c0b77265ec2c7a5372a9f39fa9b48ef0bc
   ```
   - `CAPSULE_V1_EXPECTED_IMAGE_ID` updated in `src/config/constants.ts`.
   - `docker/capsule-v1/build-manifest.json` updated with new `imageId`, `baseImage`,
     `baseImageDigest`, and updated `portabilityNote` explaining digest-pinned
     reproducibility requirement.

3. **Full P0-C/P0-E proof suite re-run against new baseline:**
   - P0-C capsule suite: 14/14 tests pass (F1–F12 fixture controls + receipt structure +
     terminal result `STAGE_2B_P0_C_CAPSULE_PROVEN`)
   - P0-C oracle execution suite: 9/9 tests pass
   - P0-E extended suite: 32/32 tests pass (F1–F16, including F5b direct-IP, F5c Docker
     socket absence, F13–F15 result-forgery resistance, F16 image-identity mismatch)
   Full test suite: 1042/1042 passing, typecheck clean.

4. **CI workflow updated** (`add Build and verify capsule evaluator image` step):
   Step runs before `npm test`; builds the image from the digest-pinned Dockerfile;
   reads expected ID from `docker/capsule-v1/build-manifest.json`; fails immediately
   on identity mismatch. Node.js 20 is available on `ubuntu-latest` for the JSON parse.

5. **Release Ledger Gate 6B2C** updated from PARTIALLY BLOCKED to CLOSED.

**Local validation:** 1042/1042 tests passing; typecheck clean. No new credentials, runtime
identifiers, or operator-local paths introduced.

**Status at commit `da7297e`:** Pushed to `feat/stage2b-preflight`. Hosted CI verification
pending. See post-push failure analysis below.

---

## Gate 6B2C — Hosted CI Failure Post-Mortem and Registry Digest Migration (2026-05-29)

**Triggered by:** GitHub Actions run on commit `da7297e` (push to `feat/stage2b-preflight`).

**Failed step:** `Build and verify capsule evaluator image` — the first custom CI step.
P0-C/P0-E tests were **not reached**.

**Observed identity mismatch:**

```
Expected (locally recorded image .Id):
  sha256:e76106374cf197074f855721173fd0c0b77265ec2c7a5372a9f39fa9b48ef0bc

Actual (GitHub-hosted build image .Id):
  sha256:f56124cd65299a19c56f1905b2847aec9ad6896fe5331aa932994deb88d3d5a6
```

**Root cause:** `docker image inspect --format '{{.Id}}'` returns the SHA-256 of the
image config JSON. The config JSON embeds a build timestamp. Two independent `docker build`
runs — even from byte-identical inputs with a digest-pinned base — produce different image
IDs because the timestamp differs between builders. The base digest pin (`sha256:8f693eaa...`)
resolved correctly; it is not the source of the divergence. The final image ID is not a
portable cross-builder identity anchor.

**Consequence:** The "rebuild-and-compare local image ID" CI trust-root design cannot pass
reliably across independent runners. `CAPSULE_V1_EXPECTED_IMAGE_ID` must not be updated
opportunistically to match whichever CI runner last built the image.

**Required repair:** Migrate capsule trust root from a local-build image `.Id` to an
immutable published registry digest on GitHub Container Registry (GHCR). The approved
capsule image must be built once under review, pushed to GHCR, and its immutable digest
recorded in the repository. CI must pull that exact digest rather than rebuilding.

> Gate 6B2C remains open. The capsule base image is digest-pinned, but hosted CI
> demonstrated that local Docker image IDs are not reproducible across independent
> builders. Capsule trust-root migration to a canonical published registry digest is
> required before hosted capsule proof can pass.

**Phase A actions (this commit):**
- Documentation corrected to reflect the actual hosted CI result.
- Manual publication workflow added at `.github/workflows/publish-capsule-v1.yml` to
  allow the repository owner to build and push the reviewed capsule image to GHCR and
  capture its immutable registry digest.

**Phase B actions (pending owner publication and authorization):**
- Publish capsule image via `publish-capsule-v1.yml`; record the immutable GHCR digest.
- Replace `CAPSULE_V1_EXPECTED_IMAGE_ID` with `CAPSULE_V1_EXPECTED_REPO_DIGEST` in
  `src/config/constants.ts`.
- Update `capsule-evaluator.ts` to verify the resolved registry digest instead of the
  local image `.Id`.
- Update `ci.yml` to pull the approved image by digest instead of rebuilding.
- Update P0-E tests to assert registry-digest semantics.
- Re-run full test suite; push; verify hosted CI green.
- Gate 6B2C closes only after hosted P0-C/P0-E validation passes.

**Next authorized action:** Repository owner runs `.github/workflows/publish-capsule-v1.yml`
on `feat/stage2b-preflight` via `workflow_dispatch`; records the output canonical
reference; authorizes Phase B implementation.

---

## Gate 6B2C Phase B — Registry Digest Migration (2026-05-29)

**Branch:** `feat/stage2b-preflight`
**Ending commits:** `95658f5` (trust root), `c02b7e3` (CI), `docs commit TBD`

**Objective:** Implement the approved immutable GHCR registry digest as the sole active
capsule trust root used by production evaluation and CI proof execution.

**Approved canonical reference (owner-supplied, workflow run 26662894783):**
```
ghcr.io/rbardyla-boop/claude_powerplant/capsule-v1@sha256:b9b3f12dada01a7b95d58688ddd1185df2c8500f39b15133c45d94fe7eec506e
```

**Artifact pull verification (local):**
- `docker pull` succeeded; digest confirmed present in resolved `RepoDigests`.

**Files changed:**

- `src/config/constants.ts`: `CAPSULE_V1_EXPECTED_REPO_DIGEST` added as canonical reference;
  `CAPSULE_DOCKER_IMAGE` now equals it; `CAPSULE_V1_EXPECTED_IMAGE_ID` marked deprecated/retired.
- `src/preflight/capsule-evaluator.ts`: `getActualCapsuleImageId`/`.Id` verification retired;
  replaced by `getCapsuleRepoDigests` + `RepoDigests.includes(expectedCanonicalReference)`;
  receipt emits `capsuleCanonicalReference`, `capsuleResolvedRepoDigests`, `capsuleRegistryDigestVerified`;
  `capsuleImageIdentityVerified` retained as alias for l1-runner compatibility.
- `docker/capsule-v1/build-manifest.json`: `registryDigest`, `publishedTag`,
  `publicationWorkflowRunId`, `trustRootMechanism` added; `imageId` field marked as retired
  with migration note.
- `tests/preflight/p0-e-capsule-trust-root.test.ts`: Section 1 and F16 migrated to
  registry-digest semantics; uses `getCapsuleRepoDigests` and `CAPSULE_V1_EXPECTED_REPO_DIGEST`.
- `tests/l1-runner.test.ts`: mock `CapsuleEvaluatorReceipt` updated to match new interface.
- `.github/workflows/ci.yml`: build step removed; pull step authenticates to GHCR and
  verifies `RepoDigests` before `npm test`; `permissions: packages: read` added.
- `.github/workflows/publish-capsule-v1.yml`: docker actions upgraded to
  Node.js 24-compatible versions (login@v4, setup-buildx@v4, build-push@v7).

**Validation result:** 1042/1042 tests passing; `npx tsc --noEmit` clean.
P0-E trust-root tests pass under registry-digest semantics.
P0-C passes against the approved GHCR artifact.

**Accepted claim:**

> Gate 6B2C Phase B implemented locally: the capsule trust root now uses the approved
> immutable GHCR registry digest, and ordinary CI is configured to pull and verify that
> exact artifact before running P0-C/P0-E. Hosted CI confirmation remains pending until
> the implementation is pushed and the workflow passes.

**Next authorized action:** Push `feat/stage2b-preflight`; confirm hosted CI green.
Gate 6B2C closes only after hosted P0-C/P0-E tests pass against the GHCR-sourced artifact.

---

## Gate 6B2C Closeout — Hosted CI Confirmed (2026-05-29)

**Branch:** `feat/stage2b-preflight`
**Ending commit:** `28e942f` (`docs(release): record capsule registry-digest migration pending hosted proof`)

**Objective:** Close Gate 6B2C after hosted GitHub Actions CI pulled and verified the
approved immutable GHCR registry digest and passed the complete test/typecheck workflow.

**Approved canonical GHCR reference:**
```
ghcr.io/rbardyla-boop/claude_powerplant/capsule-v1@sha256:b9b3f12dada01a7b95d58688ddd1185df2c8500f39b15133c45d94fe7eec506e
```

**Hosted CI receipt:**
- Run: `26663770658` — conclusion: `success`
- Triggering commit: `28e942f`
- Workflow: CI
- Step verified: "Pull approved capsule image by immutable registry digest" — success
- "Test and typecheck" job: success

**Accepted claim:**

> Gate 6B2C closed after migration from non-portable local Docker image-ID verification
> to an approved immutable GHCR registry-digest capsule trust root. Hosted GitHub Actions
> CI pulled and verified the canonical capsule artifact and passed the complete
> test/typecheck workflow on `feat/stage2b-preflight`.

**Next authorized action:** Final PR from `feat/stage2b-preflight` into `master`.
Merge only after PR checks pass. No release tag to be created as part of the PR.
