# Architecture

CLAUDE_POWERPLANT is delivered in sprints. Each sprint adds one well-defined
layer to the system. The sprint boundaries exist so we can verify each layer
in isolation before composing them.

## Sprint 0 — Config + Contracts (done)

No Anthropic API calls. No SDK dependency. The goal is a clean, type-safe
foundation:

- `src/config/env.ts` — Zod-validated environment loader. Throws on missing
  or malformed env vars at startup, not later.
- `src/config/constants.ts` — single source of truth for package name,
  default policy, default max-turns, sprint version.
- `src/contracts/artifact-manifest.ts` — Zod schema + inferred type for the
  output contract Sprint 1B will populate from real session results.
- `fixtures/sample-project/` — minimal TypeScript project Sprint 2 onward
  will target as the workspace inside a sandboxed environment.
- `tests/` — Vitest suite that exercises env validation and manifest schema.

Out of scope for Sprint 0: API clients, agent creation, environment
provisioning, session orchestration.

## Sprint 1A — Cloud Lifecycle Smoke (this sprint)

Goal: prove the Anthropic-hosted managed-agents lifecycle works end-to-end
with the smallest possible surface area. No tools, no MCP, no custom
tooling — a single text round-trip that verifies the entire control plane.

Components added:

- `src/platform/client.ts` — thin wrapper around `new Anthropic()`.
- `src/platform/managed-agent-state.ts` — Zod schema + load/save for the
  persisted agent/environment IDs. State stored under
  `.powerplant/state/cloud-smoke.json`, gitignored.
- `src/platform/event-transcript.ts` — pure transcript assertion logic. No
  API calls — fully unit-testable.
- `src/provision/ensure-cloud-agent.ts` — load-or-create the agent.
  System prompt comes from `power/agent/SYSTEM.md`. No `tools` field.
- `src/provision/ensure-cloud-environment.ts` — load-or-create the
  environment. Handles the HTTP 409 "name already taken" case by listing
  environments and finding the existing one by name.
- `src/sessions/run-cloud-lifecycle-smoke.ts` — orchestrator: provision,
  open stream, send a single user message, collect events with the
  terminal-break gate, assert the transcript, write a sanitized JSON
  report.
- `src/cli/sprint1a-cloud-smoke.ts` — CLI entry point. `tsx`-executable.

What Sprint 1A proves:

- Agent creation and persistence round-trip.
- Environment creation, 409-conflict reuse, persistence round-trip.
- Session creation with a pinned agent version.
- Stream-first event collection (`events.stream` before `events.send` so no
  early events are lost).
- Correct terminal-break gate: break on `session.status_terminated`; on
  `session.status_idle`, break only when `stop_reason.type !==
  'requires_action'`.
- A round-trip text response matches an expected canary string.

What Sprint 1A does NOT prove:

- Tool execution (no tools exist on this agent).
- Artifact retrieval (no artifacts produced).
- Sandbox isolation, network policy, or filesystem safety (no tool runs).
- Permission policies — `always_allow` vs `always_ask` are irrelevant when
  no tool calls happen.

## Sprint 1B — Controlled Cloud Tool / Artifact Proof (future)

Add a small, controlled tool (or use a built-in) so we can:

- Observe `agent.tool_use` and `agent.tool_result` events.
- Exercise `always_ask` permission flow via `user.tool_confirmation`.
- Produce an artifact and validate it against `ArtifactManifestSchema`.

## Sprint 2 — Self-hosted EnvironmentWorker + Docker (future)

Replace the managed sandbox with `EnvironmentWorker`. The worker connects
to Anthropic's orchestration plane but executes tool calls inside a Docker
container we control:

- Non-root container user.
- Read-only mounts where possible.
- Restricted egress.
- Worker lifecycle tied to session lifecycle.

This is where we earn real isolation. Sprint 1A's contracts and Sprint 0's
config still apply unchanged.

## Sprint 3R — Sanitized Workspace Builder + Bash Boundary Proof (done)

Goal: prove that a host-side sanitized workspace can be built, mounted read-only, and
that a bash-enabled container session can read only permitted files.

Key outcome: the sanitized workspace (allowlist-only copy, symlink rejection, SHA-256
verification) is the real protection for self-hosted bash sessions. `always_ask` in the
ant container worker was not effective as a pre-execution gate (Anomaly A, Sprint 3R).

`clearedForRealProjectMounting: false` — invariant since Sprint 3R.

## Sprint 3S — Worker Contract Reconciliation (done)

Goal: determine whether Sprint 3R anomalies (always_ask timing, output path contract,
bash empty-stdout) are specific to ant 1.9.1 or general to the Managed Agents contract.

Key outcomes:
- Cloud sessions with `always_ask` conform to the documented contract.
- ant 1.9.1 `always_ask` anomaly is specific to the ant container worker.
- Bash empty-stdout causes permanent 400 in ant (Anomaly D). Workaround: `&& echo "done"`.
- Sprint 3S Probe C was INCONCLUSIVE due to session queue pollution (no depth===0 check).

## Sprint 3T — Queue-Isolated SDK Worker Selection Gate (done)

Goal: test whether TypeScript SDK `EnvironmentWorker` (Mode 3, in-process) provides a
reliable session/worker/mount binding mechanism and whether `always_ask` is conformant
in that runner.

Key outcomes:
- Queue isolation (depth===0/pending===0 preflight + session-ID assertion) works correctly.
- TypeScript SDK `SessionToolRunner` has the same `always_ask` local-execution timing
  incompatibility as ant 1.9.1 (Anomaly F). `always_ask deny` cannot prevent bash execution.
- Production builder profile: bash only, always_allow, sanitized workspace.
- Built-in `write` tool retired from the self-hosted production profile.
- Privileged actions (patch, git, deployment) must use custom tools or host-controlled
  execution, not autonomous bash.

## Sprint 3U — Credential Isolation + Egress Containment Gate (done)

Goal: determine whether the TypeScript SDK `EnvironmentWorker` (Mode 3, in-process) can
safely run a bash-enabled contained builder without exposing worker credentials or allowing
arbitrary outbound exfiltration.

Verdict: **Branch BC** — both Branch B (env leak: non-ANTHROPIC_ canary visible to bash) and
Branch C (egress unrestricted: bash reached local HTTP sink) were true. The in-process bash
worker path is permanently diagnostic-only. See `docs/BUILD_LOG.md` Sprint 3U for details.

`clearedForRealProjectMounting: false` — invariant; unchanged since Sprint 3R.

## Sprint 3V — Custom Tool Broker + Air-Gapped Executor Cell Proof (current)

Goal: prove that a Managed Agent with no built-in toolset and exactly one custom tool can be
brokered by the host application to invoke an air-gapped Docker executor with credential
isolation, egress containment, non-root execution, and no source-project access.

Architecture: broker (credentialed, cloud-facing) + executor (uncredentialed Docker container,
`--network none`, empty environment, non-root uid 1001). The only shared surface is the output
directory bind-mount.

See `docs/BUILD_LOG.md` Sprint 3V section for checklist and proof assertions.

## Sprint 4A — Generated External Pilot Project Adapter (current)

Goal: prove that Powerplant can operate on a separate harmless generated project through a
sanitized disposable snapshot, typed custom tools only, the proven isolated executor, and fixed
verification — without modifying or mounting the source project itself.

Architecture:
```
External pilot repo
  → host-side contract validation + include-only sanitizer
Immutable baseline snapshot
  → copy
Writable disposable workspace
  → broker-controlled custom tools only (5 tools)
Isolated executor cell (node:20-alpine, --network none, uid 1001)
  → node --test
Tests + patch + evidence package
  → Original external pilot repo remains unchanged
```

The Managed Agent has exactly 5 custom tools and no built-in toolset:
- `project_list_files` — list sanitized workspace files
- `project_read_file` — read one allowlisted file
- `project_write_file` — write to one of two allowed paths in disposable workspace
- `project_run_check` — run the named "test" check (mapped to `node --test`)
- `project_finalize` — generate patch/evidence package (only after test passes)

Clearances after Sprint 4A: `clearedForGeneratedExternalPilot: true` (if all gates pass).
`clearedForRealProjectMounting: false` and `clearedForSanitizedExternalProjectInput: false`
remain permanently false until explicit separate ADRs.

## Layer map summary

| Concern              | Sprint 0 | Sprint 1A/1B        | Sprint 2            | Sprint 3R/3S/3T          | Sprint 3U               | Sprint 3V                    | Sprint 4A                              |
| -------------------- | -------- | ------------------- | ------------------- | ------------------------ | ----------------------- | ---------------------------- | -------------------------------------- |
| Env validation       | yes      | yes                 | yes                 | yes                      | yes                     | yes                          | yes                                    |
| Output contract      | yes      | populated           | populated           | file on host             | file on host            | executor bind-mount          | patch package + evidence               |
| SDK dependency       | none     | `client.beta`       | `client.beta`       | `client.beta` + workers  | same                    | `client.beta` (broker only)  | `client.beta` (broker only)            |
| Agent creation       | no       | once, persisted     | once, persisted     | once per sprint          | once, persisted         | once, persisted              | once, persisted                        |
| Environment          | no       | cloud               | self-hosted Docker  | self-hosted SDK in-proc  | same                    | cloud (custom tool broker)   | cloud (5-tool custom broker)           |
| Tool execution       | no       | Anthropic sandbox   | our container       | host bash (no container) | host bash (no container)| Docker executor (air-gapped) | Docker executor (air-gapped, node:20)  |
| Permission policy    | constant | `always_ask` (cloud)| `always_allow`      | `always_allow`           | `always_allow`          | custom tool only             | custom tool only                       |
| Workspace isolation  | no       | N/A                 | `always_allow` only | sanitized workspace      | diagnostic only         | output bind-mount only       | baseline + writable workspace          |
| Credential isolation | N/A      | N/A                 | container env       | ANTHROPIC_* scrubbed     | diagnostic only         | proven (empty env)           | proven (empty env)                     |
| Egress isolation     | N/A      | Anthropic sandbox   | operator policy     | host network (none)      | diagnostic only         | proven (`--network none`)    | proven (`--network none`)              |
| Source protection    | N/A      | N/A                 | N/A                 | sanitized copy           | diagnostic only         | no source mount              | snapshot + SHA-256 source integrity    |
