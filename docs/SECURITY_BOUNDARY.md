# Security Boundary

This document describes what we trust, what we do not trust, and where the
boundary is enforced.

## Secrets

- `ANTHROPIC_API_KEY` and (for future sprints) `ANTHROPIC_ENVIRONMENT_KEY`
  are required env vars.
- They are loaded via `validateEnv()` / `validateLiveEnv()` in
  `src/config/env.ts` and never embedded in source, fixtures, docs, or
  tests.
- `.env` is in `.gitignore`. Only `.env.example` (with placeholder values)
  is committed.
- Secrets must never be logged. The Sprint 1A logger emits only resource
  IDs, names, event-type strings, and the assertion outcome.
- `.powerplant/state/cloud-smoke.json` is gitignored and stores only IDs,
  names, and a timestamp. It MUST NEVER contain credentials. The schema in
  `src/platform/managed-agent-state.ts` enforces this — there is no slot
  for an API key.
- `.powerplant/reports/*.json` is gitignored and stores the session ID,
  resource IDs, event-type list, response text, assertion booleans, and a
  timestamp. It MUST NEVER contain credentials.
- If a key is ever exposed (committed, pasted into logs, shared in a
  ticket), rotate it before doing anything else.

## Boundary between Anthropic-hosted and self-hosted

| Layer                  | Sprint 1A / 1B (managed) | Sprint 2 (self-hosted)        |
| ---------------------- | ------------------------ | ----------------------------- |
| Orchestration          | Anthropic                | Anthropic                     |
| Model inference        | Anthropic                | Anthropic                     |
| Tool execution         | none (1A) / Anthropic    | our Docker container          |
| Workspace filesystem   | Anthropic sandbox        | our mount, scoped per task    |
| Network egress         | Anthropic sandbox        | restricted to Anthropic API   |

Sprint 2 is the first point where untrusted model-driven actions touch our
infrastructure. Every Sprint 2 design decision has to be defensible at
that boundary.

## Sprint 1A specifics

- The Sprint 1A agent has zero tools. The `agents.create` call omits the
  `tools` field entirely. No MCP servers. No custom tools.
- The expected event timeline contains no `agent.tool_use`,
  `agent.mcp_tool_use`, or `agent.custom_tool_use` events. The transcript
  assertion fails if any are observed.
- The smoke run terminates on `session.status_idle` with
  `stop_reason.type === 'end_turn'` (or `retries_exhausted` on failure),
  never on a `requires_action` state — there is nothing to act on.

## Permission policy

We use the documented policy values, not legacy SDK flags:

- `permission_policy: 'always_allow'` — auto-approve tool calls. Use only
  for trusted automation in isolated environments.
- `permission_policy: 'always_ask'` — surface a prompt for every tool
  call. Use for anything touching credentials, external APIs, or shared
  data.

We do not use `permissionMode`, `acceptEdits`, or `bypassPermissions` —
those names belong to a different SDK surface (`@anthropic-ai/claude-agent-sdk`)
and are explicitly out of scope. The architecture lock in this repo only
allows the managed-agents bindings in `@anthropic-ai/sdk` `client.beta`.

## Self-hosted worker constraints (Sprint 2)

- Container runs as a non-root user.
- The only writable mount is the per-task workspace.
- All other mounts (toolchain, node_modules cache, etc.) are read-only.
- Outbound network is restricted to Anthropic API endpoints. No general
  internet egress.
- Container has no access to host secrets beyond what the worker process
  explicitly forwards.
- Worker lifecycle ends with the session — no long-lived containers.

## Things we do not trust

- Model output as a permission decision.
- Tool arguments as path-safe — always normalize and confine to the
  workspace mount.
- The fixture project's `package.json` scripts — they run inside the
  sandbox, never on the host.
- Any artifact produced by a session — validate against
  `ArtifactManifestSchema` before reading it as structured data.

## Permanent self-hosted worker security rules (Sprint 3+)

These rules are invariant and must not be loosened without a new adversarial sprint.

### Sanitized workspace requirement

Real project directories (including poly/, any game repo, home directory, .git, .env,
credentials, or runtime state) must never be mounted into any worker — ant or SDK.
The host-side sanitized workspace builder (`src/projects/build-sanitized-workspace.ts`)
must run first. Only the sanitized workspace output may be mounted. The sanitizer uses
an allowlist-only copy (never copy-then-delete), rejects symlinks, rejects traversal
paths containing `..`, and SHA-256 verifies all copied files.

`clearedForRealProjectMounting: false` — invariant; unchanged since Sprint 3R.

### Queue isolation requirement (established Sprint 3S → enforced Sprint 3T)

A self-hosted Environment is a work queue. Workers claim ANY session in the queue.
Shared-queue + run-specific-mount execution is therefore prohibited.

Before starting any self-hosted worker for a specific session:
1. Query `client.beta.environments.work.stats(environmentId)`.
2. Require `depth === 0 AND pending === 0` before creating the target session.
3. After the worker claims a session, assert the claimed session ID matches the expected ID.

### Credential isolation for self-hosted workers

The SDK worker (EnvironmentWorker) must be constructed with an env-key client
(`new Anthropic({ authToken: environmentKey })`), NOT with the API key client.
Control-plane operations (agent creation, session creation, stats queries) use the
API-key client and must run outside the worker process/goroutine. The worker process
must not receive: ANTHROPIC_API_KEY, project .env, host home mount, Docker socket,
any real source directory, or any external project snapshot.

### Post-session verification is audit, not authorization

`always_allow` + post-session transcript review does not constitute pre-execution
authorization. It is diagnostic evidence only.

### `always_ask` does NOT gate pre-execution in self-hosted workers (Sprint 3T confirmed)

For **cloud sessions**: `always_ask` correctly gates pre-execution — the confirmation fires
before any tool runs. Cloud sessions with `always_ask deny` prevent the tool from executing
(Sprint 3S Probe A confirmed).

For **self-hosted workers** (both ant 1.9.1 and TypeScript SDK `EnvironmentWorker`):
`always_ask` does NOT prevent tool execution. The worker executes tools locally and then
attempts to POST the result. The API enforces confirmation at result-posting time, but the
local execution has already completed. A `deny` confirmation prevents the API from
acknowledging the result, but cannot undo local side effects (e.g., files created by bash).

**For self-hosted bash workers, the sanitized workspace (Sprint 3R) is the real protection.**
Use `always_allow` and deny access at the filesystem mount level, not at the confirmation layer.
`always_ask` with self-hosted workers should be treated as audit/logging only, not as a
pre-execution gate. See Anomaly F in `docs/KNOWN_COMPATIBILITY_ANOMALIES.md`.

### Bash empty-stdout workaround (Anomaly D — ant worker only)

Bash commands that redirect all stdout to a file (e.g., `cmd > /path/file`) cause ant
worker (1.9.1) to receive empty stdout and fail the tool result POST with a permanent 400.
Workaround: append `&& echo "done"` or similar to produce at least one character of stdout.
This applies only to ant workers — SDK workers (EnvironmentWorker) are not affected.

### Custom tool broker rules (Sprint 3V)

The custom tool broker is the only path from a cloud Managed Agent session to host-side
execution. The following rules are permanent and may not be relaxed without an explicit ADR.

1. **No built-in toolset.** The Sprint 3V agent is created without `agent_toolset_20260401`.
   The broker rejects any `agent.tool_use` event (built-in tool use) and terminates the session.

2. **Zod-gated input.** Every `agent.custom_tool_use` payload is validated against
   `ExecutorProbeInputSchema` before the executor is launched. Shell commands, path strings,
   source code, and any action other than `'verify_isolation_and_output'` cause an immediate
   throw without launching Docker.

3. **Empty executor environment.** The Docker subprocess is spawned with `env: {}` (empty object
   passed to `execFileAsync`). No host env var reaches the container. The executor container
   itself receives no `-e` or `--env-file` flags.

4. **Network isolation.** The executor container runs with `--network none`. There is no path
   from the container to any host service, LAN endpoint, or internet destination.

5. **Broker-side egress tracking.** `sinkReceivedCanary` is set by the broker's own HTTP
   listener. The executor proof's `egressSucceeded` field is a second signal but is not
   authoritative on its own — a compromised executor could lie. Both must be false for the
   egress check to pass.

6. **Bounded result.** `buildCustomToolResult()` emits only boolean presence/absence tokens.
   Raw credential values, canary strings, and raw environment values are never serialized into
   any result, report, or log line.

7. **Single-call enforcement.** The broker allows at most one `executor_probe` call per session.
   A second call causes an immediate error and session termination.

8. **No source project mount.** The only bind-mount is the output directory. Project source
   directories, home directories, `.env` files, and the Docker socket are permanently forbidden
   by `validateLaunchPolicy()`. This is enforced even if the image is correct and all other
   params pass.

9. **Non-root execution.** The executor runs as uid/gid 1001. The proof must report
   `executorIsNonRoot: true` and `executorUid !== 0`; otherwise the session fails.

10. **Clearance invariants.** `clearedForRealProjectMounting: false` and
    `clearedForSanitizedExternalProjectInput: false` are hardcoded `as const` in
    `buildIsolationProofReport()`. They cannot be set to `true` by any runtime data path.

## Sprint 4A — Sanitized External Pilot Project Adapter

### Source-disclosure disclosure

A sanitized snapshot protects against accidental secret exposure and executor
escape. It does not prevent explicitly allowlisted source content returned by a
custom read tool from being processed by Claude. The `project_read_file` tool
returns file content as session context to the Managed Agent.

For the Sprint 4A generated harmless pilot, this is acceptable. Future real
project contracts must explicitly authorize which files may be disclosed to the
Managed Agent session.

### 5-tool custom broker rules (Sprint 4A)

The production-candidate project agent is created without `agent_toolset_20260401`.
It has exactly these application-executed custom tools:

1. `project_list_files` — no input; returns only allowlisted workspace file paths.
2. `project_read_file` — strict path enum; reads from sanitized workspace only; never from original source.
3. `project_write_file` — strict path enum (`src/status.js`, `tests/status.test.js` only); max 20000 chars; rejects forbidden canary marker `POWERPLANT_FORBIDDEN`.
4. `project_run_check` — strict check enum (`"test"` only); model never supplies a command string; broker maps to fixed action `node --test`.
5. `project_finalize` — bounded summary only; gated on `testCheckPassed === true`; does not apply patch to source project.

### Source integrity proof

`verifySourceUnchanged()` re-hashes every file in the original external source directory
after the session completes and compares against the pre-session `SOURCE_MANIFEST.json`.
`sourceUnmodified: true` is required for `clearedForGeneratedExternalPilot` to be set.

### Sprint 4A clearance invariants

- `clearedForRealProjectMounting: false` — hardcoded; invariant since Sprint 3R.
- `clearedForSanitizedExternalProjectInput: false` — hardcoded; requires separate ADR.
- `clearedForGeneratedExternalPilot: true` — only if all gates pass:
  - builtinToolUseCount === 0
  - verification.passed === true
  - sourceUnmodified === true

## Things we trust

- `validateEnv()` / `validateLiveEnv()` to fail fast if the environment is
  misconfigured.
- The contract schemas in `src/contracts/` and `src/platform/` as the
  ground truth for what Sprint 1+ may emit.
