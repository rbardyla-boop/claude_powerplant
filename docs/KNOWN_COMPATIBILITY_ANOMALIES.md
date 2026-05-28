# Known Compatibility Anomalies

This document records behaviours observed during development that diverge from the
documented Managed Agents contract. Each entry is a hypothesis requiring a controlled
investigation sprint before it can be promoted to a rule or architectural decision.

**These are observations, not rules.**

---

## Version context

| Component             | Version                                      |
|-----------------------|----------------------------------------------|
| ant CLI (in container)| 1.9.1 (`powerplant-sandbox:sprint2b`)        |
| `@anthropic-ai/sdk`   | 0.98.0                                       |
| Node.js               | v22.22.3                                     |
| Docker image digest   | `8f7946d52540` (`powerplant-sandbox:sprint2b`) |
| Observed through      | Sprint 3V                                    |

---

## Anomaly A — `always_ask` timing incompatibility with ant container worker

**Documented contract:**  
When a tool is configured with `permission_policy: { type: 'always_ask' }`, the worker
should pause after dispatching the tool call, emit `session.status_idle` with
`stop_reason.type === 'requires_action'`, and wait for a `user.tool_confirmation` event
with `result: 'allow'` or `result: 'deny'` before posting the tool result.

**Observed behaviour (Sprint 3R):**  
The ant container worker attempted to POST the tool result immediately after local
execution — before the orchestrator had any opportunity to post confirmation. The API
responded with `400 Bad Request`: "`tool_use_id` has `evaluated_permission` `ask` and no
`user.tool_confirmation` with `result` `allow` has been posted". The ant worker logged
`posted=false` and did not retry. The session hung for 10 minutes, then the container
re-ran the tool in a second attempt but the confirmation window had closed.

**Workaround used in Sprint 3R:**  
Switched both tools to `always_allow`. Post-session audit via `agent.tool_use` events
serves as audit evidence only — it does not replace a pre-execution confirmation gate.

**Investigation target:** Sprint 3S Probe A  
**Status:** UNRESOLVED — pending minimal reproducible proof  
**Scope caution:** This may be specific to ant 1.9.1 or to this network/timing environment.

---

## Anomaly B — `requires_action` idle event semantics under `always_allow`

**Documented contract:**  
`session.status_idle` with `stop_reason.type === 'requires_action'` should signal that
the session is paused waiting for a `user.tool_confirmation` before it can continue.

**Observed behaviour (Sprint 3R, `always_allow` run):**  
`requires_action` idle events arrived between consecutive tool dispatches while ant was
still executing. Breaking out of the event loop on `requires_action` caused a "No pending
tool permission request" error. The Sprint 3A pattern (continue past `requires_action`,
break only on non-`requires_action` stop reason) was required for the session to complete.

**Hypothesis:**  
Under `always_allow` (no confirmation needed), `requires_action` may be emitted as a
scheduling artifact between tool dispatches rather than as a genuine pause signal. Under
conformant `always_ask`, `requires_action` should be a real pause. These two cases may
be structurally different.

**Investigation target:** Sprint 3S Probe A  
**Status:** UNRESOLVED — pending side-by-side comparison  
**Scope caution:** The observation was made only under `always_allow`; `always_ask`
behaviour was not observable because tools failed before completion.

---

## Anomaly C — ant write tool rejects absolute `/workspace/...` paths

**Documented contract:**  
No explicit documented path format for the write tool. General assumption: tools accept
absolute paths.

**Observed behaviour (Sprint 3R):**  
Writing to `/workspace/SPRINT3R_BOUNDARY_RESULT.json` (absolute path) produced
`is_error=true`. Writing to `SPRINT3R_BOUNDARY_RESULT.json` (bare filename) succeeded;
the file appeared at `/workspace/SPRINT3R_BOUNDARY_RESULT.json` on the host via the
session workdir mount.

**Note on output contract:**  
The documented final-output path is `/mnt/session/outputs/`. This path was not tested in
Sprint 3R. Whether `/mnt/session/outputs/` is a valid write destination (and whether the
container exposes it) is an open question. Sprint 3S Probe C will test both absolute
paths to `/mnt/session/outputs/` and relative paths, and compare what appears on the host.

**Investigation target:** Sprint 3S Probe C (output path contract)  
**Status:** UNRESOLVED — one observation, controlled path comparison pending

---

---

## Anomaly D — ant rejects bash tool results with empty stdout (NEW — Sprint 3S Probe D)

**Documented contract:**  
No documented minimum stdout length requirement for bash tool results.

**Observed behaviour (Sprint 3S Probe D):**  
Bash command `printf '%s' '...' > /mnt/session/outputs/BASH_OUTPUT_PROBE.txt` ran
successfully inside the container (file appeared on host with correct content). But ant's
tool result POST failed: `400 Bad Request: "events.0.content.0.text: minimum string length
is 1"`. The bash command redirected all output to a file, producing zero bytes of stdout.
Ant tried to post an empty string as the tool result content and the API rejected it.
`posted=false`; the session hung until killed.

**Workaround:**  
Ensure bash commands always produce at least one character of stdout. For redirect-only
commands, add `&& echo "done"` or similar. Example:
```bash
printf '%s' '...' > /mnt/session/outputs/out.txt && echo "written"
```

**Investigation target:** Sprint 3S Probe D (observed)  
**Status:** CONFIRMED anomaly — single observation; workaround identified  
**Scope caution:** This is a constraint of the ant worker tool result format, not a
security boundary issue. It affects bash commands that redirect all output to files.

---

## Sprint 3R Anomaly A — reclassification (Sprint 3S Probe A)

**Sprint 3S Probe A** tested `always_ask` against cloud sessions (no container worker).
Cloud sessions correctly issued `requires_action` before tool execution, waited for
`user.tool_confirmation`, and continued/ended as expected after `allow`/`deny`.

**Reclassification:**  
Anomaly A is confirmed to be specific to the **ant container worker**, not to the API
or cloud session infrastructure. The documented `always_ask` contract IS implemented
correctly for cloud sessions. The anomaly is in ant's local tool execution timing — ant
executes tools before posting the result, meaning it has already run the tool when the
API receives the confirmation. The API enforces confirmation at POST time, but the tool
has already executed locally.

**Updated status:** RESOLVED-SCOPED — not a universal anomaly; specific to ant container
workers where tools execute locally before the result is posted to the API.

---

## Anomaly E — self-hosted queue pollution from concurrent probe runs (NEW — Sprint 3S Probe C)

**Documented contract:**
A self-hosted Environment is a work queue. Sessions created in an environment are claimable
by any running worker that polls that environment. When a worker is started for a specific
session, it should service only the session that was intended for it.

**Observed behaviour (Sprint 3S Probe C):**
Sprint 3S ran Probe A (cloud sessions) and Probe C (container worker) sequentially against
the SAME self-hosted environment. The Probe A deny path left a session in a terminal state
but the queue had not fully drained before Probe C's container worker started. The Probe C
container worker claimed the residual Probe A deny session (not the Probe C session), serving
the wrong session. The Probe C session was then served by the cloud agent (fallback), which
writes to cloud storage — not to the host-mounted output directory. Result: Probe C produced
no host-visible files, so all path comparisons returned INCONCLUSIVE.

**Root cause:**
No queue depth/pending check before creating the Probe C session + starting the Probe C
worker. A container worker polls for ANY session in the environment queue — it cannot
distinguish between sessions created for it and sessions from prior probes.

**Rule established:**
Before creating a target session and starting a self-hosted worker for that session:
1. Query `client.beta.environments.work.stats(environmentId)`.
2. Require `depth === 0` AND `pending === 0`.
3. After the worker claims a session, assert the claimed session ID matches the intended ID.
Shared-queue + run-specific-mount execution is prohibited.

**Workaround:**
Use a dedicated self-hosted environment per probe run, OR enforce the depth===0/pending===0
pre-flight and claimed-session-ID assertion described above.

**Investigation target:** Sprint 3T (Queue-Isolated SDK Worker Selection Gate)
**Status:** CONFIRMED — root cause identified; rule established; Sprint 3T enforces the fix
**Scope caution:** Does not affect cloud sessions (no work queue involved).

---

---

## Anomaly F — TypeScript SDK `SessionToolRunner` `always_ask` local-execution timing (NEW — Sprint 3T Probes A/B)

**Documented contract:**  
When a tool is configured with `permission_policy: { type: 'always_ask' }`, the worker
should pause after the model dispatches the tool call, emit `session.status_idle` with
`stop_reason.type === 'requires_action'`, and wait for a `user.tool_confirmation` event
before the tool executes.

**Observed behaviour (Sprint 3T Probe B):**  
The TypeScript SDK `EnvironmentWorker` / `SessionToolRunner` executed bash locally and
attempted to POST the tool result before the orchestrator had any opportunity to post
confirmation. The API responded with `400 Bad Request`:

> `` `tool_use_id` "sevt_018fntvRf2SjvK8JPMR53o1j" has `evaluated_permission` `ask` and no `user.tool_confirmation` with `result` `allow` has been posted; send `user.tool_confirmation` first ``

The bash command had already run on the local filesystem. When the orchestrator subsequently
posted `deny`, the API accepted the denial, but the side effect (file creation) had already
occurred. `fileFound (expected false): true`.

**Root cause (confirmed by source inspection):**  
`SessionToolRunner.ts` handles `agent.tool_use` as:

```typescript
case 'agent.tool_use':
  if (!this.#seen.has(ev.id)) {
    this.#seen.add(ev.id);
    await this.#execute(ev);   // immediate local execution — no confirmation gate
  }
  return false;
```

The runner executes tools immediately upon receipt of `agent.tool_use`. It then tries to
POST the result. The API enforces confirmation at POST time, but the local execution has
already completed. `always_ask deny` cannot undo local side effects.

**Confirmation:**  
This is the same root cause as Anomaly A (ant 1.9.1). Sprint 3T Probe B confirms that the
timing incompatibility is not specific to ant — it is inherent in the self-hosted worker
model where tools execute locally before results are acknowledged by the API.

**Probe A (allow) result:**  
The allow path succeeded end-to-end (file present, content matched, session completed) but
for the same reason: bash ran before the confirmation, then the orchestrator posted `allow`,
and the API acknowledged the already-completed result. The allow path appears CONFORMANT
in outcome, but the mechanism is not — execution precedes confirmation.

**Implication:**  
`always_ask` DOES NOT prevent tool execution in self-hosted workers (neither ant 1.9.1 nor
TypeScript SDK `EnvironmentWorker`). It only enforces whether the API acknowledges the tool
result. For bash tools, the side effects happen before the API gate fires.

The sanitized workspace (Sprint 3R) is the real protection for self-hosted bash workers —
denying file access at the filesystem mount level, not at the confirmation layer.

**Updated status:** CONFIRMED — same root cause as Anomaly A; now confirmed for SDK workers  
**Investigation target:** Sprint 3T Probe B  
**Scope caution:** Cloud sessions (`always_ask`) still conform — the confirmation gate fires
before any tool execution in that path (confirmed Sprint 3S Probe A). This anomaly is
specific to self-hosted workers where tool execution is local-process, not API-mediated.

---

## Anomaly H — Stale Managed Agents environment state causes 404 on session create

**Documented contract:**  
A Managed Agents environment, once created, should persist until explicitly deleted. The provision
code stores the environment ID and reuses it across runs.

**Observed behaviour (Sprint 3V closure):**  
The Sprint 1A cloud environment (`env_011EQX7YyqAt2F7MQRRDfXGd`, created 2026-05-26) returned 404
two days later. The provision code treated the stored state as authoritative without verifying
liveness, so both `ensure-cloud-environment.ts` and `ensure-sprint3v-agent.ts` attempted to use
the dead environment and failed at session creation time.

**Workaround:**  
Delete stale state files (`cloud-smoke.json`, sprint state files) and re-run the provision chain.
Long-term fix: provision code should catch 404 on first use, clear state, and re-provision.

**Updated status:** UNDER INVESTIGATION — root cause (TTL? admin deletion? org policy?) unknown  
**Investigation target:** Sprint 4+ when environment lifecycle is better understood  
**Scope caution:** This is a control-plane state management issue, not a runtime execution issue. It
does not affect the execution isolation properties proven in Sprint 3V.

---

## Adding new anomalies

Each anomaly entry must include:
- The documented contract (what should happen)
- The observed behaviour (what did happen)
- The version context
- The investigation sprint and probe identifier
- Status: UNRESOLVED / UNDER INVESTIGATION / RESOLVED-CONFIRMED / RESOLVED-RETRACTED
- A scope caution (what this anomaly does NOT prove)
