# Architecture Decision Records

Each ADR captures one decision, the alternatives considered, and the
reasoning. Decisions are append-only; later ADRs may supersede earlier
ones but must not silently rewrite them.

---

## ADR-0001: Zod over manual validation

**Status:** accepted (Sprint 0)

**Context.** We need runtime validation for environment variables and for
the output contract. Both are external/untrusted: env comes from the
process, manifests come from sessions.

**Decision.** Use Zod schemas as the single source of truth and derive
TypeScript types with `z.infer<...>`.

**Alternatives considered.**

- Hand-written `if (typeof x !== 'string') throw ...` checks. Faster to
  start, painful to keep in sync with types, no structured error output.
- `class-validator` decorators. Requires `reflect-metadata`, ties us to a
  decorator runtime, awkward in pure ESM.
- `io-ts` / `runtypes`. Capable but smaller ecosystem and steeper
  ergonomics for the team.

**Consequences.** One library across config and contracts. Inferred
types stay aligned with runtime validation by construction. Error
messages are structured (`result.error.issues`) and easy to format.

---

## ADR-0002: Vitest over Jest

**Status:** accepted (Sprint 0)

**Context.** The codebase is strict ESM (`"type": "module"`,
`"module": "NodeNext"`). The test runner must work without a transform
config and without CommonJS shims.

**Decision.** Use Vitest.

**Alternatives considered.**

- Jest. Native ESM support is still rough; requires `--experimental-vm-modules`
  or `ts-jest` config. Slower cold start.
- `node --test`. Ships with Node 20, no extra dep. Missing the snapshot
  and watch ergonomics Vitest gives for free, and lighter ecosystem for
  TS-first projects.

**Consequences.** Tests run with no transform pipeline. `vitest.config.ts`
is one declarative block. We can adopt `vitest --coverage` and the UI
later without re-tooling.

---

## ADR-0003: NodeNext module resolution

**Status:** accepted (Sprint 0)

**Context.** TypeScript supports several module resolution strategies.
We want one that matches how Node actually resolves ESM in production,
including `.js` extensions on TypeScript imports.

**Decision.** Use `"module": "NodeNext"` and `"moduleResolution": "NodeNext"`.

**Alternatives considered.**

- `"Bundler"`. Convenient (no `.js` suffix), but lies about runtime
  behavior — code that type-checks may fail at `node` runtime.
- `"NodeNext"` with `"type": "module"`. Strictly aligned with Node's
  ESM rules. Imports must include `.js` suffix; that maps to the
  emitted `.js` file at runtime.

**Consequences.** Test files import from `'../src/config/env.js'`, not
`'../src/config/env'`. This is intentional. It future-proofs us against
moving to a different runtime (Bun, Deno) and avoids the bundler-only
trap.

---

## ADR-0004: SDK dependency deferred to Sprint 1

**Status:** accepted (Sprint 0)

**Context.** It is tempting to add `@anthropic-ai/sdk` immediately and
write thin wrappers ahead of time.

**Decision.** Sprint 0 has zero SDK dependency. Only Zod, TypeScript,
Vitest, and `@types/node`.

**Alternatives considered.**

- Pull in `@anthropic-ai/sdk` now and stub the calls. Adds surface area
  before any contract is verified. Would tempt us to write speculative
  glue that does not survive contact with the real API.

**Consequences.** Sprint 0 verifies the contracts (env validation,
manifest schema) in isolation. Sprint 1 adds the SDK and writes the
first integration against a real, working contract. No speculative
adapters live in the tree.

---

## ADR-0005: `@anthropic-ai/sdk` with `client.beta.*` (not `@anthropic-ai/claude-agent-sdk`)

**Status:** accepted (Sprint 0)

**Context.** Two SDK surfaces exist in the wild. The correct one for
managed agents and self-hosted environments is `@anthropic-ai/sdk`
exposing `client.beta.agents`, `client.beta.environments`, and
`client.beta.sessions`. A separate `@anthropic-ai/claude-agent-sdk`
package exists with a different API surface (`query()`, `startup()`,
`permissionMode`, `acceptEdits`, `SDKResultMessage`, etc.) and is the
wrong target for this project.

**Decision.** Use `@anthropic-ai/sdk` exclusively. Treat the agent-sdk
package and its symbols as forbidden in this repo.

**Alternatives considered.** None — the choice is dictated by which API
surface actually supports managed agents and self-hosted environments.

**Consequences.** Sprint 0 includes a grep-based check that no source,
test, or fixture file references the forbidden symbols. The check
prevents accidental drift onto the wrong SDK during Sprint 1 wiring.

---

## ADR-0006: `ArtifactManifest` (not `AgentRunResult` / `SDKResultMessage`)

**Status:** accepted (Sprint 0)

**Context.** The wrong-SDK surface exposes types like `AgentRunResult`
and `SDKResultMessage`. Those are not what we return to callers, and
modeling our output contract on them would couple us to an API we are
not using.

**Decision.** Our output contract is the locally defined
`ArtifactManifest` in `src/contracts/artifact-manifest.ts`. Sprint 1+
maps session results into this shape; we never expose SDK types as the
public contract.

**Alternatives considered.**

- Re-export an SDK result type as our contract. Tighter coupling, weaker
  forward compatibility, wrong-SDK-shaped surface area.

**Consequences.** The contract is stable across SDK version bumps and
across the Sprint 1 -> Sprint 2 transition from managed to self-hosted
environments. Both sprints produce the same `ArtifactManifest` shape.

---

## ADR-0007: Split Sprint 1 into 1A (lifecycle smoke) and 1B (tool/artifact proof)

**Status:** accepted (Sprint 1A)

**Context.** Sprint 1 originally combined "first live SDK call" with
"verify the output contract end-to-end." Conflating those two goals
means one failure mode (tool wiring) can mask a different failure
(lifecycle), and any debugging conflates the two.

**Decision.** Sprint 1A is a no-tools cloud lifecycle smoke. It proves
the agent/environment/session/event/terminal-break loop independently of
any tool, MCP, or artifact concern. Sprint 1B adds a controlled tool and
produces the first real `ArtifactManifest`.

**Alternatives considered.**

- Keep Sprint 1 monolithic. Faster on paper, but harder to bisect when
  the first run fails.
- Skip the lifecycle smoke and go straight to tools. Loses the smallest
  possible reproducer of the control plane.

**Consequences.** Sprint 1A ships with a sharply bounded scope: prove
the lifecycle, write a sanitized JSON report, exit non-zero on
assertion failure. No `ArtifactManifest` is produced in 1A — that
happens in 1B against a real artifact-producing run.

---

## ADR-0008: Load-or-create with 409 fallback for environments

**Status:** accepted (Sprint 1A)

**Context.** `client.beta.environments.create` enforces globally unique
names. A second run of the smoke without state on disk would fail with
HTTP 409. Agent names are not unique, so the same problem does not
apply to agents.

**Decision.** Environment provisioning catches `Anthropic.APIError`
with `status === 409` and iterates `client.beta.environments.list()`
(which is `AsyncIterable<BetaEnvironment>` via `PagePromise`) to find
the existing environment by name and reuse it. Agent provisioning
relies on persisted state alone — without persisted state we create a
new agent because the name uniqueness constraint does not block us.

**Alternatives considered.**

- Pre-list environments on every run. More requests, slower, and still
  needs the 409 fallback for the race where two processes create at
  the same time.
- Store the environment ID in the repo. Wrong: that file is gitignored
  precisely because the environment is per-developer and per-account.

**Consequences.** The smoke is idempotent. First run creates and
persists. Lost state files (deleted `.powerplant/state/`) still
recover via the 409 fallback for environments. Lost agent state
creates a new agent — acceptable because agent names are not unique
and the smoke is read-only.

---

## ADR-0009: Stream-first event collection, then send

**Status:** accepted (Sprint 1A)

**Context.** The managed-agents event stream does not replay. If we
call `events.send(...)` before opening `events.stream(...)`, any events
emitted before the stream connects are lost forever.

**Decision.** Always call `client.beta.sessions.events.stream(sessionId)`
first, then `client.beta.sessions.events.send(sessionId, ...)`. The
terminal break gate exits on `session.status_terminated` and on
`session.status_idle` when `stop_reason.type !== 'requires_action'`.

**Alternatives considered.**

- Send first, stream second. Loses early events. Documented as broken
  in the README.
- Concurrent send + stream via `Promise.all`. The send doesn't need to
  race the stream — sequencing stream-first is simpler and matches the
  vendor's stated pattern.

**Consequences.** Single-direction control flow. No reliance on event
replay semantics. The pattern carries forward into Sprint 1B and
Sprint 2 unchanged.

---

## ADR-0010: `tsx` for CLI execution (no compiled `dist/` for smoke)

**Status:** accepted (Sprint 1A)

**Context.** The smoke CLI runs occasionally and must execute the
TypeScript sources directly without a manual `tsc` step.

**Decision.** Use `tsx` as a devDependency and run
`tsx src/cli/sprint1a-cloud-smoke.ts`. The CLI itself does not need
a compiled artifact; `npm run typecheck` enforces type safety.

**Alternatives considered.**

- Compile to `dist/` with `tsc` and run `node dist/...`. Adds a build
  step before every run. The `outDir: "dist"` is also a fixture-shared
  directory, and adding compiled output complicates the `.gitignore`.
- `ts-node`. Less reliable in `NodeNext` ESM mode than `tsx`.

**Consequences.** The smoke is a one-command invocation. CI later can
either keep `tsx` or compile — both work because the source is the
canonical TypeScript and the type discipline is unchanged.

---

## ADR-0011: Self-hosted production builder profile — bash only, always_allow

**Status:** accepted (Sprint 3T)

**Context.** Sprint 3T proved that `always_ask` is NOT a pre-execution gate for self-hosted
workers (neither ant 1.9.1 nor TypeScript SDK `SessionToolRunner`). Tools execute locally
before any deny can prevent the side effect. Sprint 3R proved that the sanitized workspace
(filesystem-level access denial) is the real protection. The `write` built-in tool adds no
production capability over `bash` for self-hosted builder sessions.

**Decision.** The self-hosted contained-builder agent profile uses:
- `bash` only (no `write`, `read`, `edit`, `glob`, `grep`, web tools, MCP, skills)
- `always_allow` permission policy (because `always_ask` is not preventative in the tested worker paths)
- Sanitized disposable workspace as the input boundary (not a permission policy)
- `/mnt/session/outputs` as the only approved output path

**Alternatives considered.**
- `always_ask` with bash: tested in Sprint 3T Probe B. A `deny` confirmation arrived after
  bash had already executed locally. File was present after deny. Not a viable security gate.
- `write` tool with always_allow: Sprint 3T Probe C was INCONCLUSIVE (design issue).
  Even if write works, bash makes it redundant for the self-hosted builder use case.

**Consequences.** Pre-execution authorization for bash commands must come from orchestrator-side
input validation (the sanitized workspace and workdir confinement), not from the permission
policy. Privileged actions (patch application, git, deployment) must use custom tools or
host-controlled command execution, not autonomous bash.

---

## ADR-0012: always_ask divergence is version-scoped; reproducer preserved

**Status:** accepted (Sprint 3T/3U)

**Context.** Anthropic's public documentation states that `always_ask` pauses execution until
the application sends a `user.tool_confirmation` event. The SDK source also documents this:
"Tool calls require user confirmation before execution." Sprint 3T Probe B confirmed that
both ant 1.9.1 and TypeScript SDK `SessionToolRunner` execute tools locally before the
confirmation gate fires.

**Decision.** Treat this as a **version-scoped platform/runtime divergence** in the tested
worker paths. Document it precisely (Anomaly A/F in `KNOWN_COMPATIBILITY_ANOMALIES.md`).
Preserve the Sprint 3T minimal reproducer (run IDs logged in BUILD_LOG). Do not depend
on self-hosted `always_ask` as a security mechanism. Cloud sessions remain conformant
(Sprint 3S Probe A confirmed).

**Alternatives considered.**
- Treat as a permanent architectural constraint and never use `always_ask`. Overcorrects:
  cloud sessions work correctly and `always_ask` is correct for Mode 1 use.
- File an Anthropic bug report. Appropriate but outside project scope. The reproducer is
  preserved for that purpose.

**Consequences.** `always_ask` remains valid for cloud sessions (Mode 1). Self-hosted worker
code and docs must not describe `always_ask` as pre-execution authorization. Security must
come from the container boundary, workspace isolation, and credential scrubbing.

---

## ADR-0013: Queue isolation as a permanent invariant for session/mount binding

**Status:** accepted (Sprint 3S → Sprint 3T enforced)

**Context.** Sprint 3S found that a self-hosted Environment is a work queue; any running
worker can claim any session in that queue. If two sessions exist simultaneously (e.g., from
sequential probe runs without queue drain), a worker intended for session B may claim session A.
Sprint 3T implemented and confirmed queue isolation enforcement.

**Decision.** Before creating a target session and starting a worker for a specific mount:
1. Query `client.beta.environments.work.stats(environmentId)`.
2. Require `depth === 0 AND pending === 0`.
3. After the worker claims a session, assert the claimed session ID matches the intended ID.
This invariant applies to every future session with a specific output mount.

**Alternatives considered.**
- Separate environment per probe run. Correct but expensive; requires environment creation per
  run and doesn't scale to production use. The queue drain check is a lighter-weight alternative.
- Optimistic run without queue check. Sprint 3S showed this causes session mis-claiming.

**Consequences.** `QueueIsolationError` is a fatal error for session creation. The queue must
be fully drained before any run with a specific output surface. This limits parallelism in
shared environments but is required for correctness.

---

## ADR-0014: Broker/executor split required for self-hosted bash credential isolation

**Status:** confirmed (Sprint 3U — K2 PRESENT, Branch B proven)

**Context.** Sprint 3U probed whether the current TypeScript SDK `EnvironmentWorker` (Mode 3,
in-process) can safely execute bash without exposing worker credentials or allowing egress.
The `scrubbedShellEnv()` function in `betaAgentToolset20260401` strips all `ANTHROPIC_*` env
vars from the bash subprocess. However, non-ANTHROPIC_ vars (arbitrary worker env vars) pass
through unchanged, and bash runs directly on the host network with no egress restriction.

**Decision.** A two-process / two-boundary design is required before the SDK worker can be used
for project input:
- **Credentialed broker**: holds ANTHROPIC_ENVIRONMENT_KEY, talks to the work queue, has no
  project mount, never executes user-directed bash.
- **Uncredentialed executor**: receives sanitized workspace only, has no ANTHROPIC_* vars and
  no other worker credentials, has network-restricted or air-gapped execution, runs bash, writes
  outputs to a mounted output directory.
The executor may be implemented as a Docker container with explicit env (no worker vars)
and a restricted network policy, or as a direct Environments Work endpoint implementation
(documented as a supported pattern in the SDK).

**Alternatives considered.**
- Pass explicit `env: {}` to `AgentToolContext` to isolate bash env. Feasible for ANTHROPIC_*
  isolation but does not solve network egress.
- Add prompt-level rules prohibiting credential access. Not a security mechanism; the model
  can be prompted to exfiltrate regardless.
- Accept the current architecture. Only valid for diagnostic runs with no sensitive input.

**Consequences.** The `runSdkIsolatedWorker` function in its current form is not cleared for
project input. `clearedForSanitizedExternalProjectInput: false` until broker/executor split
is implemented and proven with Sprint 3U Branch A confirmation.

---

## ADR-0015: Executor process must be started with an empty environment

**Status:** confirmed (Sprint 3U — K2 PRESENT, Branch B)

**Context.** `betaAgentToolset20260401`'s `scrubbedShellEnv()` strips `ANTHROPIC_*` env vars from
bash subprocesses but passes all other `process.env` vars through. Any secret stored in the worker
process environment (database password, deploy token, private API key under a non-ANTHROPIC_ name)
is inherited by every bash command the agent runs.

**Decision.** The executor process must be launched with an explicitly minimal environment. No
credential-bearing env vars may be present in the executor's `process.env`. Required vars (e.g.,
`PATH`, `HOME`, `TMPDIR`) must be passed explicitly; all others must be absent. The environment
key is NOT passed to the executor — only the broker holds it.

**Alternatives considered.**
- Pass explicit `env` map to `AgentToolContext`. Feasible within `betaAgentToolset20260401` if the
  SDK exposes this; avoids the need for a separate process but requires SDK-level support.
- Rely on `scrubbedShellEnv()` alone. Insufficient — only strips `ANTHROPIC_*` prefix.

**Consequences.** Executor launch scripts must enumerate allowed env vars explicitly. CI/CD pipelines
that export secrets as env vars require review before running near executors.

---

## ADR-0016: Production executor requires OS-level network egress isolation

**Status:** confirmed (Sprint 3U — E1 canaryReceived=true, Branch C)

**Context.** The TypeScript SDK `EnvironmentWorker` runs bash directly on the host with no network
boundary. Sprint 3U Probe E1 confirmed that bash can POST to a localhost HTTP endpoint — and by
extension, can reach any host-reachable address including the LAN, cloud metadata endpoints, and
the internet.

**Decision.** The production executor must enforce network egress at the OS level:
- Docker: `--network=none` (air-gap) or a `--network` with explicit allow-list and iptables DROP for
  everything else.
- Bare metal / VM: iptables `OUTPUT REJECT` except for explicitly whitelisted destinations.
- Cloud: Security group / VPC policy that allows only the approved output sink.

Prompt-level restrictions are not a security mechanism and must not be relied upon.

**Alternatives considered.**
- Restrict to a dedicated VPC with no internet route. Adequate for most cases but does not prevent
  lateral movement within the VPC.
- Accept unrestricted egress for internal diagnostic runs only. Acceptable only while no sensitive
  project data is mounted and no credentials are in scope.

**Consequences.** Sprint 3U Branch A (arbitraryEgressBlocked=true) requires network isolation to be
implemented and re-proven before `clearedForSanitizedExternalProjectInput` can be set to true.

---

## ADR-0017: Broker/executor split is the required production architecture for SDK workers

**Status:** confirmed (Sprint 3U — Branch BC)

**Context.** Sprint 3U proved both Branch B (env leak) and Branch C (egress unrestricted) for the
current in-process `EnvironmentWorker`. Neither condition can be resolved without splitting the
credential-holding and execution roles into separate processes with separate trust boundaries.

**Decision.** The production architecture for self-hosted SDK workers is a two-process design:

```
┌─────────────────────────────────────┐   ┌──────────────────────────────────────┐
│  BROKER (credentialed)              │   │  EXECUTOR (uncredentialed)            │
│  - holds ANTHROPIC_ENVIRONMENT_KEY  │   │  - no ANTHROPIC_* vars               │
│  - calls work queue API             │   │  - no other worker secrets            │
│  - receives sessions                │   │  - empty env (PATH, HOME only)        │
│  - owns sanitized workspace mount   │   │  - network: output sink only          │
│  - never runs bash                  │   │  - runs bash, writes to outputs/      │
└─────────────────────────────────────┘   └──────────────────────────────────────┘
         │  session + workspace path                   ▲
         └────────────────────────────────────────────►│  (IPC or shared volume)
```

The broker may be implemented using a direct Environments Work API call (supported path per SDK
documentation) instead of `EnvironmentWorker`, which allows finer control over what runs in
which process.

**Consequences.** `runSdkIsolatedWorker` is not the target production primitive. The broker/executor
split must be implemented and Sprint 3U re-run to achieve Branch A and unlock
`clearedForSanitizedExternalProjectInput`.

---

## ADR-0018: Custom tool broker as the production execution primitive

**Status:** accepted (Sprint 3V)

**Context.** ADR-0017 established that the production architecture requires a broker/executor
split. Sprint 3V implements this with a cloud Managed Agent that has NO built-in toolset and
exactly one custom tool (`executor_probe`). The broker application receives `agent.custom_tool_use`
events, validates the typed request via Zod, launches a Docker executor with `--network none` and
empty environment, and returns a bounded `user.custom_tool_result`.

**Decision.** Use the custom tool API (`type: 'custom'` in the agent tools array) as the
broker/executor IPC mechanism. The agent cannot call built-in tools. The broker dispatches exactly
one Docker container invocation per session. The executor writes a proof artifact to the output
bind-mount; the broker reads and validates it before returning the result.

**Key design choices:**

1. `env: {}` is passed to `execFileAsync` for the Docker subprocess so that no broker environment
   variable leaks into the Docker CLI process or through it to the container.
2. `sinkReceivedCanary` is tracked host-side by the broker's HTTP listener, not derived from
   executor-written proof, to prevent a compromised executor from lying about egress success.
3. The stream must be opened before `events.send()` is called to avoid losing early events. The
   broker calls `events.stream()` first, then sends the result on `requires_action`.
4. `custom_tool_use_id` (not `tool_use_id`) is the correct field in `user.custom_tool_result`.
5. The broker enforces a max-one-call policy: if `customToolUseCount > 1`, it throws and the
   session terminates with an error.

**Alternatives considered.**

- `EnvironmentWorker` + explicit `env` override: would resolve credential leak (Branch B) but
  not network egress (Branch C) — broker process still has host network. Requires proving safe
  bash env under controlled conditions before this path is usable.
- Named pipe / Unix socket IPC: more complex than a bind-mount; adds attack surface without
  clear benefit for a single-call proof session.

**Consequences.** The production pattern for project execution is: cloud Managed Agent + custom
tool broker + air-gapped Docker executor. The clearance invariants (`clearedForRealProjectMounting`,
`clearedForSanitizedExternalProjectInput`) remain false until project content is introduced in a
later sprint.

---

## ADR-0021: Generic contract-driven project engine over per-project hardcoding

**Status:** accepted (RC2 dogfood repair)

**Context.** RC1 was validated against a generated pilot project with hardcoded
allowed paths. The first real-project preflight found that the CLI checked for
`.powerplant/POLICY.yaml` existence but then ignored its contents — the runtime
enforced the pilot's paths regardless of what any external project's YAML declared.

**Decision.** All enforcement layers (inspect, run, broker, sanitizer, patch generator)
now load the operative policy from the project's `.powerplant/POLICY.yaml` and
`.powerplant/VERIFY.yaml` via `loadProjectContract()`. Tool schemas validate input
**shape** only (path safety, bounded length, identifier regex). **Authorization**
(is this specific path/check permitted?) is the broker's responsibility, not the
schema's. Hard-coded invariants (workspaceMode, realProjectMounted, allowBash) are
enforced by the loader regardless of what the YAML declares.

**Alternatives considered.**

- Per-project hardcoded constants: rejected — requires code changes for every new
  project, and silently creates false safety boundaries if a YAML file exists but
  is not the operative policy.
- Schema-level enum validation: rejected for runtime authorization — the Managed Agent
  is provisioned once with a fixed schema; per-project path enums would require
  re-provisioning a new agent per project. The broker is the right authorization layer.

**Consequences.** Any project can supply its own `.powerplant/` contract without
requiring Powerplant code changes. The pilot remains supported as one ordinary
contract-driven project. `toolSchemaVersion = 2` marks the generic schema; old
agents with version 1 enum schemas are automatically re-provisioned.

---

## ADR-0022: js-yaml as the YAML parser

**Status:** accepted (RC2)

**Context.** The project has no YAML parser. POLICY.yaml and VERIFY.yaml must be
parsed at runtime to drive all enforcement layers.

**Decision.** Add `js-yaml`. It is the most widely deployed YAML parser in the
Node.js ecosystem (30M+ weekly downloads), has zero runtime dependencies, ships
TypeScript type definitions via `@types/js-yaml`, and is actively maintained.

**Alternatives considered.**

- `yaml` (eemeli/yaml): capable and spec-complete, but larger and slower for the
  simple YAML structures we need.
- Hand-rolled parser: fragile and unnecessary for a well-structured schema.

**Consequences.** Single added runtime dependency. The loader validates the parsed
document with explicit TypeScript guards rather than relying on js-yaml's type system.
