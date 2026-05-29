# Stage 2B Completion and GitHub Release Ledger

## Mission

Finish the Claude-Powerplant Stage 2B L1 acceptance path without expanding scope, then publish an honest, secure and reproducible GitHub repository.

This ledger is the canonical finish line. No task may expand beyond it without explicit authorization.

## Current Checkpoint

* Branch: `feat/stage2b-preflight`
* P0-A / P0-B / P0-C: previously proven and not to be reopened without evidence of regression
* L1 temporal evidence field: `sessionStartedAt`
* Contract meaning of `sessionStartedAt`: timestamp captured immediately before the broker invocation begins, as defined by the Stage 2B L1 acceptance-plan boundary
* L2–L7: out of scope

Stage 2B L1 completed one bounded live acceptance run under the documented trusted-directory assumption. Gate 6B current-tree sanitation and public documentation alignment are complete or in progress as recorded below; CI/security/license hardening remains pending.

## Engineering Journal Authorization

`docs/BUILD_LOG.md` is the sole maintained engineering journal for Stage 2B. It records the repair trail, investigation reasoning, and milestone work entries chronologically. It is **non-normative**: if it conflicts with this ledger, the acceptance plan, committed validation tests, or any final acceptance receipt, those authoritative artifacts control.

Root `BUILDLOG.md`, which was introduced at commit `c841065` as a single-session repair note, was retired as a stale duplicate after `docs/BUILD_LOG.md` was established as the canonical non-normative engineering journal. Root `BUILDLOG.md` no longer exists.

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

### Gate 4 — One Bounded Live L1 Execution — **CLOSED** (one bounded live run accepted under trusted-directory assumption)

Status: `CLOSED — one bounded live L1 execution accepted under trusted-directory assumption`

Final verdict: `L1_LIVE_ACCEPTED_UNDER_TRUSTED_DIRECTORY_ASSUMPTION`

One live L1 run was executed. No retry was performed. No source, test, or documentation
files were modified during or after the run. The post-run worktree was clean.

**Trusted-directory qualification (exact language):**

> Stage 2B L1 completed one bounded live acceptance run under a documented trusted-directory
> assumption. The run verified consistency between the L0-generated receipt and isolated promoted
> registry during an operator-controlled bootstrap-to-L1 handoff.
>
> This acceptance does not claim cryptographic resistance to pre-run receipt-and-registry
> co-substitution by an actor with write access to the operator-controlled acceptance directory.

**Sanitized evidence summary:**

| Evidence Item | Result |
|---|---|
| Acceptance directory control | Fresh operator-controlled directory; owner-only permissions confirmed |
| L0 bootstrap | Completed successfully once |
| Trusted-directory handoff | Receipt and registry hashes unchanged between bootstrap and L1 invocation |
| Live invocation count | Exactly one; no retry |
| External session | Entered; identifier redacted |
| Built-in tool evidence | `builtinToolUseCount === 0` |
| Temporal proof | `17:28:43.606Z < 17:28:43.620Z` |
| Audit ordering | Phase A line `0` before Phase B line `1` |
| Candidate containment | `sanitizedWorkspaceUsed: true`; `originalProjectMounted: false` |
| Real-project immutability | `manifestUnchanged: true` |
| Oracle isolation | Network disabled; read-only rootfs; capabilities dropped; `PASS (4/4)` |
| Repository integrity after run | Clean worktree; no source/test/doc changes |
| Secret hygiene | No credentials committed; external session identifier redacted |

Raw runtime evidence (acceptance directory contents, unredacted receipts, JSONL audit log)
remains outside version control, pending separate sanitation and disposition review.

The sanitized acceptance report is committed at:
`docs/acceptance/STAGE_2B_L1_LIVE_ACCEPTANCE_REPORT.md`

GitHub publication remains blocked pending Gate 6 security, CI, and public-claim review.

`docs/BUILD_LOG.md` remains the authorized non-normative engineering journal: if it conflicts with this ledger, the acceptance plan, committed validation tests, or the final acceptance receipt, those authoritative artifacts control.

### Gate 5 — Stage 2B Closeout Documentation — **CLOSED** (Gate 6B2A)

Completed:

* Sanitized Stage 2B L1 acceptance report added at
  `docs/acceptance/STAGE_2B_L1_LIVE_ACCEPTANCE_REPORT.md`.
* Gate 4 section in this ledger closed with exact trust-boundary language and sanitized
  evidence table.
* README updated (Gate 6B2A) to truthfully state proven surfaces, limitations, and claim
  boundaries; no overclaims present.
* Runtime artifacts and credentials confirmed excluded from version control; `.gitignore`
  recurrence-prevention rules added at Gate 6B1; full history scan completed at Gate 6A.

### Gate 6 — GitHub Release Readiness

Required outcomes:

* Full secret/history review complete.
* No credentials or unsafe live artifacts are committed.
* CI runs tests and typecheck from a clean checkout.
* `main` is protected by required checks.
* Public README contains no overclaims.
* Release version follows the repository’s actual version convention.

#### Gate 6A — Secret and Credential Scan — **COMPLETED**

No private keys or raw API credentials were found in tracked files at HEAD.

The following already-public real runtime metadata was identified in the current release surface:

* A live Managed Agents session identifier in `docs/BUILD_LOG.md` (class: live session ID)
* Live `sessionId`, `agentId`, and `environmentId` values in `data/sprint1b-allow-report.json`
  and `data/sprint1b-deny-report.json` (class: live runtime IDs)
* Operator-local absolute paths in `.claude/settings.json`, `src/config/constants.ts`,
  `docs/BUILD_LOG.md`, and five test files (class: operator-local filesystem path)
* Six runtime acceptance artifacts tracked under `.powerplant/acceptance/gate4-*/`
  (class: operator-local runtime state)

Historical exposure: these items exist in already-public Git history. No history rewrite was
performed; a separately authorized rebase/filter-branch decision is required for that.

#### Gate 6B1 — Forward Sanitation of Current Release Surface — **COMPLETED**

Actions taken:

* Removed six runtime acceptance artifacts from tracked tree
  (`.powerplant/acceptance/gate4-1780075485/**`)
* Redacted live session identifier in `docs/BUILD_LOG.md`
* Redacted two live agent IDs and one live environment ID in `docs/BUILD_LOG.md`
  (Sprint 3U and Sprint 3V sections; class: live runtime IDs)
* Redacted live session, agent, and environment IDs in `data/sprint1b-allow-report.json`
  and `data/sprint1b-deny-report.json`; sanitized evidence structure preserved
* Removed operator-local `.claude/settings.json` from tracked tree (personal permission
  overrides for a different project; Case B local override)
* Replaced hardcoded operator-local path in `src/config/constants.ts`
  (`SPRINT4A_PILOT_SOURCE_PATH`) with env-variable-driven resolution
* Added `resolveSprint4aPilotSourcePath()` function that throws explicitly before any
  filesystem operation when `SPRINT4A_PILOT_SOURCE_PATH` is unset or empty, eliminating
  the empty-string-to-CWD ambiguity in `path.resolve('')`
* Updated production callsites (`run-sanitized-project-pilot.ts`,
  `proof-pilot-snapshot.ts`, `create-external-pilot.ts`) to use
  `resolveSprint4aPilotSourcePath()` instead of the deprecated constant directly
* Added `.env.example` entry documenting `SPRINT4A_PILOT_SOURCE_PATH`
* Updated five test files to import `SPRINT4A_PILOT_SOURCE_PATH` from constants
  instead of hardcoding the operator path
* Replaced adversarial sentinel path in `tests/synthetic-promoted-guidance-pilot.test.ts`
  with a synthetic non-operator path; test intent preserved
* Redacted two operator-local path references in `docs/BUILD_LOG.md` (Sprint 4A checklist
  and key proof points)
* Added narrow `.gitignore` rules to prevent recurrence:
  - `.powerplant/acceptance/` — runtime acceptance artifacts
  - `data/sprint1b-*.json` — runtime probe output
  - `.claude/settings.json` — personal local Claude permission overrides
* Updated `vitest.config.ts` to load `.env` via `vite.loadEnv` so the operator-local
  pilot path is supplied at test time from the gitignored `.env` file
* Added three targeted tests to `tests/config.test.ts` proving
  `resolveSprint4aPilotSourcePath()` throws before any filesystem operation when
  the env var is absent or empty, and returns the configured path when set

Recurrence prevention: the added `.gitignore` rules block future accidental tracking of
the same artifact classes.

Historical exposure remains on the already-public remote for commits prior to this gate.
A separate authorized history-rewrite decision is required to address that.

Recurrence prevention: the added `.gitignore` rules block future accidental tracking of
the same artifact classes.

Historical exposure remains on the already-public remote for commits prior to this gate.
A separate authorized history-rewrite decision is required to address that.

No release tag or GitHub launch announcement is authorized until Gate 6B2 hardening
(CI, branch protection, SECURITY.md, license verification) is complete.

The accepted Stage 2B L1 live verdict (`L1_LIVE_ACCEPTED_UNDER_TRUSTED_DIRECTORY_ASSUMPTION`)
is unchanged.

#### Gate 6B2A — Public Documentation Alignment — **COMPLETED**

Actions taken:

* README rewritten with accurate verified status, explicit trust-boundary language, and bounded
  claim scope; all overclaims removed.
* `docs/BUILD_LOG.md` policy block added at top: establishes non-normative authority boundary,
  entry discipline, and safety discipline for future entries.
* Gate 6 milestone entry appended to `docs/BUILD_LOG.md` recording Gate 6A/6B1/6B2A work.
* Gate 5 closed in this ledger (all Gate 5 conditions now satisfied).
* Documentation authority hierarchy established in README.
* No production code, tests, or acceptance evidence modified.

Validation: `1042/1042` tests passing (local configured checkout); typecheck clean;
no live runtime identifiers or operator-local paths introduced.

#### Gate 6B2B — CI, Security Hardening, and Release Authorization — **PENDING**

Required before public release:

* CI workflow: configure GitHub Actions to run `npm test` and `npx tsc --noEmit` from a
  clean checkout; verify pilot-dependent tests skip correctly when `SPRINT4A_PILOT_SOURCE_PATH`
  is unset.
* Restricted `.env` loading review: confirm `vitest.config.ts` `.env` load does not
  leak secrets in CI.
* SECURITY.md: create root-level security policy with contact method and scope.
* License verification: confirm or add an appropriate root-level `LICENSE` file.
* GitHub branch protection: require passing CI checks on `master`/`main` before merge.
* Secret scanning and push protection: enable GitHub Advanced Security secret scanning.
* Optional: separate authorized decision on history-rewrite to address already-public
  historical runtime metadata exposure (live session IDs, agent IDs, environment IDs,
  operator-local paths in commits prior to Gate 6B1).

## Public Claim Boundary

Before a successful live L1 run:

> Stage 2B L1 harness implemented and non-live validated. Live L1 acceptance has not yet been executed.

After a successful live L1 run:

> Stage 2B L1 accepted through one bounded live execution. Trusted-directory L0 receipt consistency verified during an operator-controlled bootstrap-to-L1 handoff; cryptographic resistance to pre-run receipt-and-registry co-substitution is not claimed. Isolated oracle evaluation, sanitized workspace containment, and recorded evidence receipts.

Do not state or imply that L2–L7, downstream integrations or production deployment have been proven.

## Completion Condition

Stage 2B is ready for public GitHub release only when:

* Gate 1 through Gate 6 are closed.
* Full tests and typecheck pass in clean CI.
* The live L1 outcome, if claimed, is supported by sanitized evidence under the documented trusted-directory assumption.
* The public repository contains no secrets or misleading claims.
