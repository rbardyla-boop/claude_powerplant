# Skill Lifecycle MVP — Security Design Plan

**Status**: `A — SKILL_LIFECYCLE_MVP_SECURITY_BOUNDARY_SPECIFIED`
**Date**: 2026-05-28
**Branch**: Planning only on `feat/skill-lifecycle`. No `src/skills/` source created.
**Predecessor**: `VERIFICATION_INTEGRITY_CLOSURE_RECORD.md`

---

## 0. Non-Negotiable Invariant

```
No skill installation, activation, execution, update, or removal may bypass,
weaken, replace, spoof, or stale-cache the verification evidence required
for project_finalize.
```

This invariant supersedes all design convenience in every section below.
If a design choice would require relaxing this invariant, the choice is rejected.

---

## 1. Audit 1 — Existing Architecture Surface

### Files inspected

| File | Role |
|------|------|
| `src/broker/project-tool-broker.ts` | Central tool dispatch; `checksValidAfterLastWrite` state; finalize gate |
| `src/contracts/project-tool-contracts.ts` | Tool name registry; path/check schema validation; `PILOT_TOOL_NAMES` |
| `src/verification/classify-check-result.ts` | `classifyCheckResult`; zero-test guard; `CheckVerdict` enum |
| `src/verification/run-capsule-checks.ts` | Docker capsule executor; network/credential isolation |
| `src/verification/verification-profiles.ts` | Built-in profile registry; profile resolution (fails closed for unknown IDs) |
| `src/contracts/verification-preflight-report.ts` | `CheckResult`, `VerificationReport` schemas |
| `src/contracts/verification-profile.ts` | `VerificationProfile` type |
| `src/config/constants.ts` | Tool names, limits (`SPRINT4A_MAX_TOOL_CALLS = 30`) |
| `src/projects/generate-patch-package.ts` | Patch eligibility: every `check.verdict === 'PASS'` required |
| `src/projects/load-project-contract.ts` | VERIFY.yaml loading; allowed checks |
| `src/projects/build-sanitized-workspace.ts` | Workspace copy; glob matching |
| `src/cli/powerplant.ts` | Top-level CLI router |
| `src/cli/commands/` | `run`, `verify`, `inspect`, `review`, `setup`, `doctor` |
| `docs/architecture/POWERPLANT_SKILL_REACTOR_PLAN.md` | Existing detailed skill-reactor design (562 lines) |

### Concepts already present

| Concept | Location | Notes |
|---------|----------|-------|
| Tool name registry | `project-tool-contracts.ts: PILOT_TOOL_NAMES` | Hard-coded; no dynamic extension |
| Dispatch | `broker/project-tool-broker.ts: switch(toolName)` | Direct switch; no plugin hook |
| Capsule execution | `verification/run-capsule-checks.ts` | Docker; network=none; creds=empty |
| Required checks | Project `VERIFY.yaml` via `LoadedProjectContract` | Policy file; not runtime-mutable |
| `checksValidAfterLastWrite` | `BrokerState` in broker | Bool; reset on write; set true on PASS |
| Verification profiles | `verification-profiles.ts: BUILT_IN_PROFILES` | Hard-coded; only known IDs accepted |
| Write gate | `handleWriteFile` in broker | Resets `checksValidAfterLastWrite` |
| Finalize gate | `handleFinalize` in broker | Requires `testCheckPassed && checksValidAfterLastWrite` |

**No existing concept named `skill`, `plugin`, `hook`, `capability`, or `routine` exists in production `src/`.**
The skill-reactor plan exists only in `docs/architecture/POWERPLANT_SKILL_REACTOR_PLAN.md` (planning only).

### Safest insertion point

Skills are loaded before the broker session starts and injected into the **prompt envelope**
(specifically: appended to the system-prompt or user-message prefix as static text).
This is the only insertion point that does not touch:

- `BrokerState`
- `checksValidAfterLastWrite`
- `PILOT_TOOL_NAMES`
- `handleRunCheck` / `handleFinalize`
- `runCapsuleChecks`
- `resolveVerificationProfile`

A skill is injected text. It cannot add new tools, change check commands, or touch
finalize gating. The broker and capsule executor remain completely unchanged by skill loading.

---

## 2. Audit 2 — Threat Model

For each threat: **Prevention**, **Detection**, **Required test evidence**.

### T1 — A skill changes the required test command from `npm test` to a no-op

| | |
|-|-|
| **Prevention** | Required checks come from `VERIFY.yaml` in the project contract, loaded by `loadProjectContract()`. Skills are loaded before the session and injected as text only. No skill code path touches `LoadedProjectContract.allowedChecks`. The check command is not a runtime-mutable field. |
| **Detection** | If a skill could somehow alter the check map, `isCheckAuthorized` would still reject any check ID not in VERIFY.yaml. |
| **Test** | Assert that loading a skill does not alter `contract.allowedChecks`. Assert that `project_run_check` with a skill-injected check ID that is not in VERIFY.yaml returns error. |

### T2 — A skill writes project files after verification but before finalize

| | |
|-|-|
| **Prevention** | `project_write_file` always calls `state.checksValidAfterLastWrite = false`. This applies regardless of who triggered the write — agent or skill-injected instruction. The broker enforces it unconditionally. |
| **Detection** | `handleFinalize` checks `!state.checksValidAfterLastWrite` and throws before accepting finalize. |
| **Test** | The zero-test false-positive regression test already covers write-then-finalize. Extend with: inject a skill instruction "write first, then finalize without re-running checks" — finalize must be rejected. |

### T3 — A skill claims a check passed without capsule evidence

| | |
|-|-|
| **Prevention** | `checksValidAfterLastWrite` is set to `true` only by `handleRunCheck` after `checkResult.verdict === 'PASS'`. No skill-accessible path (write, read, list, finalize) sets this flag to true. |
| **Detection** | `handleFinalize` checks `!state.checksValidAfterLastWrite`; if a skill somehow caused a false-true value, this is the last line of defense. |
| **Test** | Assert that no skill-loaded content can cause `checksValidAfterLastWrite` to become true without a real `project_run_check` call returning `PASS`. |

### T4 — A skill executes outside network/credential isolation boundaries

| | |
|-|-|
| **Prevention** | Skills as declarative text do not execute. The capsule (`runCapsuleChecks`) is invoked only through `handleRunCheck` → `runCapsuleProjectChecks`. The capsule always uses `--network none` and `env: {}`. A skill has no mechanism to invoke a capsule with different parameters. |
| **Detection** | `assertSafeCapsuleMount` enforces workspace-under-`/tmp/` and blocks home/`.env`/socket paths before any Docker invocation. |
| **Test** | Assert that building capsule Docker argv always includes `--network none` and `env: {}` regardless of skill state. This is already tested by `tests/create-verification-workspace.test.ts` and capsule-check tests. |

### T5 — A skill modifies `clearedForSanitizedExternalProjectInput`

| | |
|-|-|
| **Prevention** | `clearedForSanitizedExternalProjectInput` is a static constant defined in `src/config/constants.ts`. It is set at build time, not runtime. Skills are text injected before the session; they have no access to Powerplant's own state. |
| **Detection** | The flag value is only readable by the operator; the agent/skill never sees it. |
| **Test** | Assert that all capsule isolation flags in `VerificationReport` are set by Powerplant infrastructure, not derived from any skill-loaded content. |

### T6 — A skill installs executable code from the project being tested

| | |
|-|-|
| **Prevention** | Option A (declarative-only skills): skills contain no executable code. A skill manifest is validated SKILL.md text + metadata JSON. No `scripts/` or `tests/` directories are executed by the MVP lifecycle. |
| **Detection** | Gate 0 in `skill-ingestion.ts` (to be built) rejects symlinks, path-escape entries, and oversized packages before content is read. |
| **Test** | Assert that a skill with executable scripts cannot trigger those scripts during MVP-phase load or activation. |

### T7 — A skill introduces shell-command injection through metadata

| | |
|-|-|
| **Prevention** | Skill manifests are parsed as structured JSON (Zod schema). Skill text injected into the prompt is inert text — the broker never `exec`s it. Check IDs in `RunCheckInputSchema` are validated against `/^[a-zA-Z][a-zA-Z0-9_-]*$/` — no shell metacharacters accepted. |
| **Detection** | Schema validation at skill load time (Gate 0 + Gate 1). Any manifest field that fails the schema is rejected before the skill can be activated. |
| **Test** | Assert that a skill manifest with shell metacharacters in any field is rejected at ingestion. Assert that injected skill text does not alter broker behavior beyond adding prompt content. |

### T8 — A skill changes verification-report output without changing evidence

| | |
|-|-|
| **Prevention** | `VerificationReport` is assembled by `generatePatchPackage` from `CheckResult[]` — runtime evidence produced by the capsule executor. Skills are not consulted during report generation. |
| **Detection** | `CheckResult.verdict` is a closed enum (`PASS | FAIL_CHECK | BLOCKED_MISSING_TOOLING | FAIL_BOUNDARY | FAIL_VERIFICATION_INTEGRITY`). No field can be set by skill text. |
| **Test** | Assert that the verification report generated from a run with an active skill is structurally identical to a run without the skill (same evidence fields, same verdict logic). |

### T9 — A skill consumes excessive tool calls or loops indefinitely

| | |
|-|-|
| **Prevention** | `SPRINT4A_MAX_TOOL_CALLS = 30` enforced by broker. Skills do not add new tools — they are prompt text. The tool-call counter still applies to any tool calls the agent makes in response to skill instructions. |
| **Detection** | Broker throws `Error: Broker safety: exceeded ${MAX_TOOL_CALLS} custom tool calls` after the limit. |
| **Test** | This is already covered by broker tests. Assert that an agent following skill instructions cannot exceed the call limit without broker intervention. |

### T10 — A skill is updated after approval without invalidating trust/provenance

| | |
|-|-|
| **Prevention** | Validated skills are stored in `~/.powerplant/skills/validated/<name>/vN/` as immutable version directories. A new version requires a new promotion through all gates. The active-registry pointer records the version in use. Any change to the active version creates a new audit entry. |
| **Detection** | `manifest.json` in each version directory records a SHA-256 hash of the skill content at ingestion time. Gate 2 re-verifies the hash before any activation. A hash mismatch returns `FAIL_VERIFICATION_INTEGRITY` for the skill check. |
| **Test** | Assert that modifying a validated skill's SKILL.md after ingestion causes the hash check to fail. Assert that promotion of a modified candidate requires re-running all gates from scratch. |

---

## 3. Audit 3 — Trust Model Options

### Option A — Declarative skills only

**Definition**: Skills contain only validated text (SKILL.md instructions, metadata, per-skill memory). No executable scripts, no test runners, no hook callbacks. Skill injection is limited to appending pre-validated text to the agent's prompt.

**Threat surface**: Minimal. A skill cannot execute code, invoke tools, or modify Powerplant state. The only attack surface is prompt injection — a skill containing misleading instructions. Prompt injection is an agent-quality concern, not a verification-integrity concern.

**Limitations**: Cannot run skill-specific tests, cannot execute setup scripts.

### Option B — Bundled trusted executable skills

**Definition**: Skills may contain scripts and test stubs, but these are only executed if they shipped with Powerplant or came from explicitly trusted, hash-verified signed sources. No dynamic skill installation from untrusted sources.

**Threat surface**: Script execution adds a new attack surface inside the Powerplant host process. Requires sandboxing for script runs and a separate trust chain from the project-under-test.

### Option C — Arbitrary user/project-installed executable skills

**Definition**: Skills may execute extension code supplied dynamically by operators or projects.

**Threat surface**: Maximum. This directly reopens the verified-code-execution boundary that the Singularity repair just closed. Must not be allowed until a separate security review is complete.

### Recommendation

**Option A is the correct trust model for the MVP.**

The verification-integrity repair just proved that separating verified code execution
(capsule) from agent instructions (broker) is the correct boundary. Option A preserves
that boundary. Option B adds a new execution surface before the boundary is hardened.
Option C is explicitly off-limits until a separate security review authorizes it.

Begin with Option A. Do not implement Option B or C in this planning pass.
Do not design for Option B unless Option A is fully working and the boundary hardened.

---

## 4. Audit 4 — Verification-Integrity Boundary

Rules keeping skills subordinate to the repaired verification boundary:

| Rule | Detail |
|------|--------|
| Skills may trigger writes | Only through existing `project_write_file` broker tool |
| Every skill-triggered write invalidates checks | `handleWriteFile` resets `checksValidAfterLastWrite`; unconditional |
| Skills may request checks | Only through `project_run_check` with a declared VERIFY.yaml check ID |
| Skills may not modify required checks | `allowedChecks` comes from VERIFY.yaml; no skill path can change it |
| Skills may not declare checks passed | `checksValidAfterLastWrite = true` is set only by broker on real PASS verdict |
| Skills may not request finalize | `project_finalize` is agent-controlled; finalize still requires fresh PASS |
| Finalize revalidates after skill activity | `checksValidAfterLastWrite` is already state-tracked; any write resets it |
| Skill metadata in verification reports | Every skill loaded in a session is recorded with name + version + hash in the run audit record |
| Skills cannot weaken capsule isolation | Profile resolution uses `BUILT_IN_PROFILES` only; no skill path reaches `buildCapsuleDockerArgv` |

---

## 5. Audit 5 — Minimal Viable Lifecycle

The smallest useful initial feature for Phase 1:

### Supported operations

| Operation | Description | Safe? |
|-----------|-------------|-------|
| `skill list` | Show installed skills (name, version, active status) | Yes — read-only |
| `skill inspect <name>` | Show full manifest, hash, gates passed, memory | Yes — read-only |
| `skill import <path>` | Gate 0 ingestion: copy to candidates/, compute hash | Yes — side-effect is a new read-only directory |
| `skill test <name>` | Re-run Gates 1–4 on a candidate | Yes — no writes to production dirs |
| `skill promote <name>` | Move validated to active registry (Gate 5) | Yes — operator-explicit action |
| `skill disable <name>` | Remove from active-registry pointer | Yes — reversible |
| `skill rollback <name>` | Decrement version pointer | Yes — operator-explicit action |

### Not supported in MVP

| Operation | Reason |
|-----------|--------|
| Automatic skill generation from runs | Phase 4+ (requires distillation layer) |
| Package download / marketplace | Untrusted execution risk |
| Script execution during activation | Option A: declarative only |
| Dynamic hook registration | Would touch broker dispatch |
| Per-skill network or credential access | Capsule isolation is not per-skill |

### Lifecycle state machine

```
[import] → candidates/<id>/  (Gate 0: symlink/path-escape/size checks)
    ↓ [test] runs Gates 1–4
[validated/<name>/vN/]        (hash committed; immutable)
    ↓ [promote]
[active-registry pointer]     (active/<name> → vN)
    ↓ [disable/rollback]
[inactive / prior version]    (audit trail preserved)
```

### Storage layout

```
~/.powerplant/skills/
  candidates/<uuid>/
    SKILL.md
    manifest.json       { name, version, sha256, importedAt, gates: [...] }
    .memory.md
  validated/<name>/
    v1/                 (immutable after promotion)
  registry.json         { active: { <name>: 'v2' } }
```

### Broker integration point (Phase 2, not MVP)

In Phase 2 only: skills are loaded from `registry.json` before the broker session starts
and appended to the prompt envelope header. The broker loop is not modified. No new tools
are added.

---

## 6. Audit 6 — Tests Required Before Implementation Approval

| # | Test | File |
|---|------|------|
| 1 | A valid minimal declarative skill manifest (`SKILL.md` only) passes all gates | `tests/skill-ingestion.test.ts` |
| 2 | A manifest missing required fields is rejected at Gate 1 (schema) before hash | `tests/skill-ingestion.test.ts` |
| 3 | `import` records a complete audit trail entry (name, version, hash, timestamp) | `tests/skill-ingestion.test.ts` |
| 4 | `disable` removes skill from active list; disabled skill cannot be invoked | `tests/skill-lifecycle.test.ts` |
| 5 | A skill instruction that causes `project_write_file` resets `checksValidAfterLastWrite` | `tests/verification-integrity.test.ts` (extend) |
| 6 | No skill code path can set `checksValidAfterLastWrite = true` directly | `tests/skill-lifecycle.test.ts` |
| 7 | No skill can cause `allowedChecks` to contain an unrecognized check ID | `tests/skill-lifecycle.test.ts` |
| 8 | A finalize call without fresh checks after a skill-triggered write is rejected | `tests/verification-integrity.test.ts` (extend) |
| 9 | Skills are not given network or credential parameters at any point in their lifecycle | `tests/skill-ingestion.test.ts` |
| 10 | Manifest hash is included in the lifecycle audit entry | `tests/skill-ingestion.test.ts` |
| 11 | Zero-test false-positive regression remains blocked when a skill-initiated workflow runs tests | `tests/verification-integrity.test.ts` (extend) |
| 12 | Full `npm test` baseline passes after adding skill infrastructure (637 → 637 + N) | CI baseline |

### Gate-0 fixture tests (from existing plan)

| Fixture | Must fail at Gate 0 | No hash computed | No secret scan attempted |
|---------|---------------------|-------------------|--------------------------|
| `gate0-symlink/` | ✓ | ✓ | ✓ |
| `gate0-path-escape/` | ✓ | ✓ | ✓ |
| `gate0-oversized/` | ✓ | ✓ | ✓ |

These are required before implementation approval.
Tests must assert that Gate 0 blocks content reads before any other gate runs.

---

## 7. Proposed Production File Modifications

**MVP Phase 1 only. No changes to existing broker, capsule, or verification files.**

### New files to create

| File | Purpose |
|------|---------|
| `src/skills/skill-manifest.ts` | `SkillManifest` Zod schema + validation |
| `src/skills/skill-ingestion.ts` | Gate 0: filesystem safety checks |
| `src/skills/candidate-store.ts` | Read/write `~/.powerplant/skills/candidates/` |
| `src/skills/validated-store.ts` | Read/write `~/.powerplant/skills/validated/` (immutable versions) |
| `src/skills/active-registry.ts` | Read/write registry pointer |
| `src/skills/skill-evaluator.ts` | Gates 1–4: schema, hash, secret-scan, declarative validation |
| `src/skills/skill-promoter.ts` | Candidate → validated + registry update |
| `src/cli/commands/skill.ts` | `powerplant skill` CLI router |
| `src/cli/commands/skill-commands/list.ts` | |
| `src/cli/commands/skill-commands/inspect.ts` | |
| `src/cli/commands/skill-commands/import.ts` | |
| `src/cli/commands/skill-commands/test.ts` | |
| `src/cli/commands/skill-commands/promote.ts` | |
| `src/cli/commands/skill-commands/disable.ts` | |
| `src/cli/commands/skill-commands/rollback.ts` | |

### New test files

| File | Coverage |
|------|----------|
| `tests/skill-ingestion.test.ts` | Gate 0 + manifest validation + hash + audit trail |
| `tests/skill-lifecycle.test.ts` | import → test → promote → disable → rollback state machine |
| `tests/cli-skill-list.test.ts` | `powerplant skill list` output |
| `tests/cli-skill-inspect.test.ts` | `powerplant skill inspect <name>` output |
| `tests/cli-skill-import.test.ts` | Happy path + gate-0 rejection |
| `tests/cli-skill-promote.test.ts` | Promotion + registry pointer |
| `tests/cli-skill-rollback.test.ts` | Rollback semantics |

### Fixture skills required (under `fixtures/skills/`)

| Fixture | Purpose |
|---------|---------|
| `valid-minimal/` | SKILL.md only, no scripts — must pass all gates |
| `gate0-symlink/` | Contains symlink — must fail Gate 0 |
| `gate0-path-escape/` | Contains `../../etc/passwd` — must fail Gate 0 |
| `gate0-oversized/` | Exceeds size limit — must fail Gate 0 |
| `gate3-secret/` | SKILL.md with fake API key pattern — must fail Gate 3 |
| `tampered/` | Valid sha256 but content modified after ingestion — must fail Gate 2 re-verify |

---

## 8. Prohibited Capabilities

Skills in the MVP may **not**:

1. Execute arbitrary code (scripts, hooks, test runners)
2. Install packages from the internet
3. Modify `VERIFY.yaml`, `allowedChecks`, or the verification profile
4. Set `checksValidAfterLastWrite` to any value
5. Invoke `project_finalize` without a preceding `project_run_check` returning PASS
6. Add new tool names to `PILOT_TOOL_NAMES`
7. Access the credential boundary (`ANTHROPIC_API_KEY` or equivalents)
8. Modify or bypass the capsule Docker argv (network, user, env)
9. Install themselves from project-provided code or project-provided VERIFY.yaml
10. Modify another skill's manifest, hash, or registry entry
11. Alter the verification report produced by `generatePatchPackage`
12. Change any capsule isolation flag: `clearedForSanitizedExternalProjectInput`,
    `executorNetworkDisabled`, `noCredentialsPassedToExecutor`, `sourceUnmodified`

---

## 9. Can This Be Implemented Without Weakening Verification Integrity?

**Yes.** The skill lifecycle as designed operates entirely outside the verified-execution path:

- Skills are injected as text before the session starts
- The broker loop, capsule executor, check classifier, and finalize gate are not modified
- `checksValidAfterLastWrite` semantics are unchanged
- `VERIFY.yaml`-driven `allowedChecks` are not skill-accessible
- The zero-test false-positive guard (`classifyTestCheckIntegrity`) is not modified

The only new trust surface is the skill manifest schema and the Gate 0–5 ingestion pipeline.
These are entirely new code with no coupling to existing verification logic.

---

## 10. Feature Branch Sequence

Before implementation begins:

1. **Create `feat/skill-lifecycle` branch** from current `main` tip
2. **Accept closure record** `VERIFICATION_INTEGRITY_REPAIR_OPERATIONALLY_PROVEN`
3. **Implement fixture skill directories** in `fixtures/skills/` (no src changes)
4. **Write failing tests** for all 12 audit-6 requirements (RED phase)
5. **Implement `src/skills/` modules** to make tests pass (GREEN phase)
6. **Implement `src/cli/commands/skill.ts`** and subcommands
7. **Verify full baseline**: `npm test` must remain green (637 + N new tests)
8. **Typecheck**: `npm run typecheck` must pass with no errors

---

## 11. Verdict

```
A — SKILL_LIFECYCLE_MVP_SECURITY_BOUNDARY_SPECIFIED
```

The feature can be implemented without weakening the repaired verification-integrity
boundary. The trust model is Option A (declarative only). The MVP lifecycle is narrowly
scoped to import, validate, promote, disable, and rollback operations on declarative
skill manifests. All 12 required tests are specified. No prohibited capabilities are
included in the design.
