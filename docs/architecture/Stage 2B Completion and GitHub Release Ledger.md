# Stage 2B Completion and GitHub Release Ledger

## Mission

Finish the Claude-Powerplant Stage 2B L1 acceptance path without expanding scope, then publish an honest, secure and reproducible GitHub repository.

This ledger is the canonical finish line. No task may expand beyond it without explicit authorization.

## Current Checkpoint

* Branch: `feat/stage2b-preflight`
* Reported checkpoint HEAD: `b4b6ff1`
* P0-A / P0-B / P0-C: previously proven and not to be reopened without evidence of regression
* L1 temporal evidence field: `sessionStartedAt`
* Contract meaning of `sessionStartedAt`: timestamp captured immediately before the broker invocation begins, as defined by the Stage 2B L1 acceptance-plan boundary
* Live Anthropic/API call: not yet authorized
* Live L1 session: not yet executed
* L2–L7: out of scope

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

### Gate 1 — Non-Live Reproducibility Repair

Open defects:

1. T39 currently allows `sessionStartedAt === phaseA.invocationTimestamp`, while the harness requires strict `<`.
2. L1 tests currently fail in Claude’s environment because the acceptance test root assumes `/tmp`.

Required outcomes:

* Production temporal evidence is truthfully guaranteed to satisfy strict ordering.
* A deterministic same-millisecond test proves the repair.
* Temporary-directory logic is portable without weakening write containment.
* `npm test` and `npx tsc --noEmit` pass in a clean environment.

No live API call or live session is permitted.

### Gate 2 — Immutable Fixture Binding and Production CLI

Required outcomes:

* `fixtureAContentHash` is bound to immutable L0 evidence.
* A real L1 CLI entrypoint exists.
* The CLI calls only `runL1Harness`, never `_runL1HarnessForTesting`.
* Missing, altered or malformed receipts fail closed.
* All tests and typecheck pass.

No live API call or live session is permitted.

### Gate 3 — Hostile Pre-Live Audit

Required outcomes:

* Entry point cannot reach test-only code.
* Agent built-in browser/network tools remain forbidden.
* Docker oracle remains network-isolated.
* Candidate writes remain confined to sanitized workspace.
* Real Powerplant state remains immutable.
* Failure and exception paths produce truthful terminal evidence.
* Secrets cannot enter committed artifacts.

Deliverable:

* A commit-bounded authorization report with an explicit live-run verdict.

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
