# Execution Modes

This document describes the two execution modes available for Managed Agents sessions
and the architectural differences between them. It is a reference for understanding which
mode applies to each sprint.

---

## Mode 1 — Cloud Session (no container)

Sessions run against Anthropic's cloud infrastructure. No container worker is required.
Tool execution (write, bash) happens server-side in Anthropic's managed environment.

**Used in:** Sprint 1A (lifecycle smoke), Sprint 1B (output probe)

**Permission policy behaviour (documented):**
- `always_allow`: tool executes without orchestrator confirmation.
- `always_ask`: session pauses at `session.status_idle` with `stop_reason.type ===
  'requires_action'`, waits for `user.tool_confirmation`, then posts result.
- `always_deny`: tool call is rejected immediately.

**Final output path:** `/mnt/session/outputs/<filename>` — files written here appear on
the host via the session output mount.

**Event loop pattern (confirmed for cloud mode, Sprint 1B):**  
Break on `session.status_idle` with `stop_reason.type === 'requires_action'`.
Post `user.tool_confirmation` for pending tool uses, then continue streaming.

---

## Mode 2 — Container Worker Session (ant CLI)

Sessions are claimed by a locally-spawned Docker container running `ant beta:worker run`.
Tool execution happens inside the container. The container mounts a per-session host
directory as `/workspace` and executes tools locally.

**Used in:** Sprint 2B (container smoke), Sprint 3A (project read probe),
Sprint 3R (sanitized workspace boundary proof)

**Permission policy behaviour (observed in Sprint 3R, under investigation):**  
- `always_allow`: tools execute locally without waiting for confirmation.
  `requires_action` idle events may arrive between tool dispatches as a scheduling
  artifact; they do not represent a genuine pause.
- `always_ask`: Sprint 3R observed `posted=false` with a permanent 400 — the tool
  result was rejected before confirmation could arrive. **This diverges from the
  documented contract.** See `KNOWN_COMPATIBILITY_ANOMALIES.md` Anomaly A.

**Final output path (under investigation):**  
The documented path is `/mnt/session/outputs/`. In Sprint 3R, write to bare filenames
succeeded (files appear in the session workdir on the host). Whether `/mnt/session/outputs/`
is accessible from inside the container is not yet tested. See `KNOWN_COMPATIBILITY_ANOMALIES.md`
Anomaly C and Sprint 3S Probe C.

**Event loop pattern (confirmed for `always_allow` container sessions, Sprint 3A/3R):**  
Do NOT break on `requires_action`. Continue streaming until
`stop_reason.type !== 'requires_action'` (e.g., `end_turn`) or `session.status_terminated`.

---

## Security boundary rule (permanent, not under investigation)

In Mode 2, when bash is enabled, the container filesystem and mount configuration are
the authoritative read boundary. Only sanitized disposable workspaces may be mounted.
Post-session transcript audit of `agent.tool_use` events is audit evidence, not
pre-execution authorization.

`clearedForRealProjectMounting: false` — this flag remains false until an adversarial
test suite passes against a sanitized fixture.

---

---

## Mode 3 — TypeScript SDK EnvironmentWorker (in-process)

Sessions are claimed by a TypeScript `EnvironmentWorker` running in-process in the Node.js
orchestrator. Tool execution happens in bash subprocesses spawned by `betaAgentToolset20260401`
**on the host filesystem** — no Docker container is involved. The bash subprocess environment
is the parent process environment with all `ANTHROPIC_*` keys stripped (`scrubbedShellEnv()`).

**Used in:** Sprint 3T (SDK worker selection gate), Sprint 3U (credential/egress boundary proof)

**Permission policy behaviour (confirmed Sprint 3T):**
- `always_allow`: tools execute immediately; worker posts the result without waiting for
  confirmation.
- `always_ask`: `SessionToolRunner` calls `await this.#execute(ev)` immediately upon
  `agent.tool_use` — no confirmation gate. Worker attempts to POST the result; API rejects
  with `400` (no `user.tool_confirmation` posted yet). Same root cause as ant 1.9.1 (Anomaly A).
  **DO NOT rely on `always_ask` as pre-execution authorization for self-hosted SDK workers.**
  See Anomaly F in `KNOWN_COMPATIBILITY_ANOMALIES.md`.

**Bash subprocess environment (confirmed from SDK source `scrubbedShellEnv()`):**
- All `ANTHROPIC_*` vars stripped from child process environment.
- All other vars passed through unchanged (PATH, HOME, arbitrary worker env vars).
- If explicit `env` is passed to `AgentToolContext`, it FULLY REPLACES the default scrubbed env.

**`skill setup failed 401` (non-fatal):**
The `EnvironmentWorker` calls `setupSkills()` using the env-key client. This API call requires
the full API key; the env-key client cannot authenticate it. The error is logged and the worker
continues, claiming and servicing sessions correctly. Skills remain out of scope.

**Security implications (confirmed Sprint 3U):**
- ANTHROPIC_API_KEY: absent from bash subprocess (scrubbed by `ANTHROPIC_*` prefix).
- ANTHROPIC_ENVIRONMENT_KEY: absent from bash subprocess (scrubbed by `ANTHROPIC_*` prefix).
- Arbitrary worker env vars (non-ANTHROPIC_ prefix): PRESENT in bash subprocess — tool
  execution inherits the worker process environment. Credential isolation for non-ANTHROPIC_
  vars requires not setting them in the worker process environment OR using an explicit env
  override to `AgentToolContext`.
- Network egress: bash runs directly on the host; no network restriction without a container
  boundary. Bash can reach any host-reachable network endpoint.

**Event loop pattern (for `always_allow` SDK sessions):**
Do NOT post confirmations. Stream events until `stop_reason.type !== 'requires_action'`
or `session.status_terminated`. `requires_action` may fire as a scheduling artifact between
tool dispatches; re-open the event stream and continue without posting any `user.tool_confirmation`.

---

---

## Mode 4 — Custom Tool Broker + Air-Gapped Executor (Docker)

The cloud Managed Agent has no built-in toolset. It exposes exactly one custom tool
(`executor_probe`). Tool execution is performed by the broker application on the host — the
broker launches a Docker container to run the actual work and returns a bounded result to
the agent as a `user.custom_tool_result`.

**Used in:** Sprint 3V (isolated executor cell proof)

**Why this mode is needed:** Sprint 3U (Branch BC) proved that Mode 3 (SDK in-process) leaks
non-ANTHROPIC_ env vars to bash subprocesses (Branch B) and allows unrestricted host network
egress (Branch C). Mode 4 resolves both by removing bash from the agent surface entirely and
delegating execution to an air-gapped container.

**Agent tool surface:**
- No `agent_toolset_20260401` (no bash, no write, no read, no edit, no glob, no grep).
- One `type: 'custom'` tool: `executor_probe` with schema
  `{ action: { type: 'string', enum: ['verify_isolation_and_output'] } }`.

**Event loop pattern:**
1. Open stream (`events.stream()`) BEFORE calling `events.send()`.
2. On `agent.custom_tool_use`: validate tool name and input via Zod, launch executor, read proof.
3. On `session.status_idle` with `stop_reason.type === 'requires_action'`:
   send `user.custom_tool_result` with `custom_tool_use_id` (not `tool_use_id`).
4. On `agent.tool_use` (built-in): reject immediately — this must never occur with a no-toolset agent.
5. Re-open stream after posting result; continue until `stop_reason.type !== 'requires_action'`.

**Executor container controls:**
- `--network none` — no inbound or outbound network access.
- `--read-only` — root filesystem is read-only.
- `--cap-drop ALL` — no Linux capabilities.
- `--security-opt no-new-privileges` — privilege escalation prohibited.
- `--user 1001:1001` — non-root user.
- Empty environment: no `-e`, no `--env-file`. `execFileAsync` is called with `env: {}`.
- One bind-mount: output directory → `/mnt/session/outputs`.
- One tmpfs: `/tmp:rw,noexec,nosuid,size=16m`.

**Credential isolation:** The executor receives no `ANTHROPIC_*` vars, no non-ANTHROPIC_
worker secrets, and no environment whatsoever. The broker process holds credentials but never
passes `process.env` to the Docker subprocess.

**Egress isolation:** `sinkReceivedCanary` is tracked by the broker's own HTTP listener on
port 19999. The executor proof's `egressSucceeded` is a second independent signal. Both must
be false for the check to pass. With `--network none`, container-to-host HTTP is impossible.

**Clearance invariants (hardcoded):**
- `clearedForRealProjectMounting: false as const`
- `clearedForSanitizedExternalProjectInput: false as const`

These are set in `buildIsolationProofReport()` and cannot be changed by runtime data.

---

## Security boundary rules (permanent)

See `docs/SECURITY_BOUNDARY.md` for the complete set. Key rules affecting mode selection:

| Property | Mode 1 (cloud) | Mode 2 (ant container) | Mode 3 (SDK in-process) |
|---|---|---|---|
| `always_ask` pre-execution gate | Conformant ✓ | NOT preventative ✗ | NOT preventative ✗ |
| Bash env isolation (ANTHROPIC_*) | N/A | Container env boundary | `scrubbedShellEnv()` ✓ |
| Bash env isolation (non-ANTHROPIC_*) | N/A | Container env boundary | Inherited from process ✗ |
| Network egress control | Anthropic sandbox | Operator container policy | None (host network) ✗ |
| Credential (env key) isolation | N/A | Container env boundary | `ANTHROPIC_*` scrub only ✓ |
| Sanitized workspace possible | N/A | Proven (Sprint 3R) | Possible (not yet tested) |

Production candidate for the contained builder: Mode 3 (TypeScript SDK) with explicit `env`
override to `AgentToolContext` (no worker creds in bash env) and network-restricted container
(broker/executor split). Until those boundaries are proven, Mode 3 is diagnostic-only.
