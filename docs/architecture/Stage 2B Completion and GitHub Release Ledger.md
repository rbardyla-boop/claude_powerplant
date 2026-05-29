# Stage 2B Completion and GitHub Release Ledger

## Mission

Finish the Claude-Powerplant Stage 2B L1 acceptance path without expanding scope, then publish an honest, secure and reproducible GitHub repository.

This ledger is the canonical finish line. No task may expand beyond it without explicit authorization.

## Current Checkpoint

* Branch: `feat/stage2b-preflight`
* Accepted checkpoint HEAD: `36b9efc` (bounded/yielding timestamp capture repair)
* P0-A / P0-B / P0-C: previously proven and not to be reopened without evidence of regression
* L1 temporal evidence field: `sessionStartedAt`
* Contract meaning of `sessionStartedAt`: timestamp captured immediately before the broker invocation begins, as defined by the Stage 2B L1 acceptance-plan boundary
* Live Anthropic/API call: not yet authorized
* Live L1 session: not yet executed
* L2–L7: out of scope

## BUILDLOG.md Authorization

`BUILDLOG.md`, introduced at commit `c841065`, is an authorized Stage 2B development journal
written by the project operator. It records the repair trail and implementation reasoning for
Gate 1 work. It is **non-normative**: if it conflicts with this ledger, the acceptance plan,
committed validation tests, or any final acceptance receipt, those authoritative artifacts control.

## Frozen Exclusions

Do not:

* Work on Polymarket, NN collectors or other downstream projects
* Begin L2–L7
* Add new agent tools or permissions
* Relax path containment or capsule isolation
* Mutate real Powerplant state during L1
* Commit secrets, raw credentials or unsanitized live receipts
* Claim production readiness without matching evidence

## Remaining Gates

### Gate 1 — Non-Live Reproducibility Repair — **CLOSED** (`36b9efc`)

Repairs completed (commits `db4dd08`, `1ac408b`, `c841065`, `36b9efc`):

1. Strict temporal ordering: `sessionStartedAt` guaranteed strictly after `invocationTimestamp`
   via bounded async spin (T39 strict assertion, T40 frozen-clock proof, T41/T42 fail-closed proofs).
2. Portable acceptance temp root: `ACCEPTANCE_HOME_PREFIX` uses `os.tmpdir()`, containment preserved.
3. Bounded timestamp capture: `awaitStrictlyAfterTimestamp()` uses wall-clock truth with
   monotonic timeout; fails closed on frozen/regressed clock rather than hanging.

Validated at `36b9efc`: `1021/1021` tests passing across 56 files, `npx tsc --noEmit` clean.

No live API call or live session was executed.

### Gate 2 — Fixture Binding and Production CLI — **CLOSED** (repairs `589821d`, `4782563`; trust-boundary language corrected by hostile pre-live audit)

Repairs completed (commits `589821d`, `4782563`); trust-boundary language corrected during Gate 3 hostile pre-live audit:

1. Side-effect-free import boundary: `L0_FIXTURE_RECEIPT_FILENAME` extracted to pure
   `src/acceptance/l0-fixture-receipt.ts`. Both `acceptance-bootstrap.ts` and
   `l1-harness-run.ts` import from it. No mock needed in tests. Import of the CLI
   entrypoint triggers no side effects (proven by `l1-harness-run.test.ts` safe-import test).
2. L0 fixture binding (Case B — trusted acceptance directory): `loadL0Receipt()` validates
   JSON structure and hash format; `runL1Harness()` Step 2 cross-checks `receipt.contentHash`
   against the registry entry written by `promoteSkill()` at bootstrap time. Single-file
   tampering (altered receipt only, or altered registry only) fails closed before
   `pilotExecutor` is called (proven by `l1-runner.test.ts`).

   **Accepted trust assumption (Case B)**: Both `l0-fixture-receipt.json` and
   `skill-registry.json` reside in the operator-controlled isolated `POWERPLANT_HOME`
   acceptance directory (`/tmp/powerplant-stage2b-acceptance/<run-id>/`). This directory is
   created, controlled, and operated by the same trusted operator who runs both the bootstrap
   and the L1 harness. Pre-run co-substitution of both files by an actor with write access to
   that directory is outside the proved boundary. The proved claim is: L1 verifies structural
   consistency between the L0-generated receipt and the isolated registry, under the assumption
   that the acceptance directory remains unmodified between L0 promotion and L1 invocation.
   Cryptographic immutability against pre-run operator co-substitution is not claimed.

3. Truthful `builtinToolUseCount` (Case B verified correct): The broker increments
   `builtinToolUseCount` only on `agent.tool_use` events (prohibited Anthropic built-in tools).
   Permitted project broker tools emit `agent.custom_tool_use` and do not touch this counter
   (proven by source-inspection tests in `project-tool-broker.test.ts`). Exception path
   (broker threw, `brokerResult` null) emits sentinel `-1` on both pilot return paths,
   preventing a false zero assertion on paths where tool use was unobservable (proven by
   source-inspection test in `l1-runner.test.ts` and rejection test for `-1` sentinel).

Validated at `4782563` (original): `1032/1032` tests passing across 57 files, clean typecheck.
Validated after hostile pre-live audit: `1039/1039` tests passing across 57 files, clean typecheck.

No live API call or live session was executed.

### Gate 3 — Hostile Pre-Live Audit — **CLOSED** (this commit; verdict below)

Audit findings and dispositions:

| Surface | Finding | Disposition |
|---------|---------|-------------|
| CLI import boundary | `_runL1HarnessForTesting` absent from non-comment CLI code; import causes no side effects | **Pass** — confirmed by static and safe-import tests |
| Receipt validation ordering | `loadL0Receipt` precedes `runL1Harness` in source | **Pass** — confirmed by source-ordering test |
| `builtinToolUseCount` event semantics | `agent.tool_use` increments counter; `agent.custom_tool_use` does not; broker exception → -1, never 0 | **Pass** — confirmed by 7 source-inspection and harness tests |
| Fixture A co-substitution | Both receipt and registry are mutable files in operator-controlled `/tmp/` dir; co-substitution by hostile pre-run actor undetected | **Case B accepted** — operator-controlled development environment; cryptographic external anchor not claimed; trust assumption documented in ledger |
| Docker oracle isolation | Network-isolated (`--network=none`), read-only rootfs, image identity verified, cleanup confirmed | **Pass** — 1039/1039 including P0-E capsule tests |
| Real Powerplant state immutability | Pre/post manifest checks on all terminal paths | **Pass** — no regression from Gate 2 changes |
| Candidate workspace confinement | Writes bounded to `state.snapshot.workspacePath` via contract path checks | **Pass** — unchanged from accepted baseline |
| Failure and exception paths | Pilot throw → evidence computed; oracle throw → evidence computed; all produce truthful verdicts | **Pass** — covered by existing tests |

**Live-run verdict: `L1_HOSTILE_PRELIVE_AUDIT_PASSED_READY_FOR_ONE_BOUNDED_LIVE_RUN`**

Qualifying condition: the accepted Case B trust assumption must hold — the operator must run bootstrap and L1 without external write access to the acceptance directory between the two operations.

Validated: `1039/1039` tests passing across 57 files, `npx tsc --noEmit` clean.

### Gate 4 — One Bounded Live L1 Execution

Allowed only after explicit authorization.

Required evidence:

* Immutable L0 fixture binding verified.
* Strict Phase A-before-broker timestamp evidence.
* JSONL record ordering.
* Tool-channel confinement.
* Sanitized workspace containment.
* Real project immutability.
* Oracle isolation.
* Honest termination evidence.
* Sanitized evidence bundle.

Allowed verdicts:

* `L1_LIVE_ACCEPTED`
* `L1_LIVE_FAILED_WITH_TRUTHFUL_EVIDENCE`
* `L1_LIVE_EVIDENCE_INCOMPLETE_BLOCKED`

### Gate 5 — Stage 2B Closeout Documentation

Required outcomes:

* README truthfully states proven and unproven surfaces.
* Sanitized Stage 2B acceptance report is added.
* Threat model and security policy exist.
* Runtime artifacts and credentials are excluded from version control.

### Gate 6 — GitHub Release Readiness

Required outcomes:

* Full secret/history review complete.
* No credentials or unsafe live artifacts are committed.
* CI runs tests and typecheck from a clean checkout.
* `main` is protected by required checks.
* Public README contains no overclaims.
* Release version follows the repository’s actual version convention.

## Public Claim Boundary

Before a successful live L1 run:

> Stage 2B L1 harness implemented and non-live validated. Live L1 acceptance has not yet been executed.

After a successful live L1 run:

> Stage 2B L1 accepted through one bounded live execution with immutable fixture binding, isolated oracle evaluation, sanitized workspace containment and recorded evidence receipts.

Do not state or imply that L2–L7, downstream integrations or production deployment have been proven.

## Completion Condition

Stage 2B is ready for public GitHub release only when:

* Gate 1 through Gate 6 are closed.
* Full tests and typecheck pass in clean CI.
* The live L1 outcome, if claimed, is supported by sanitized immutable evidence.
* The public repository contains no secrets or misleading claims.
