# What Powerplant Is Safe For Today

> Claims-control document. It exists to keep the project from outrunning its evidence.
> It is not marketing copy. Every claim here is bounded by the runs recorded in
> [DOGFOOD_COVERAGE_LEDGER.md](./DOGFOOD_COVERAGE_LEDGER.md).

## One-Sentence Claim

Powerplant is a useful constrained patch/audit harness for real repositories when the task is scoped, write paths are narrow, and the verification contract is explicit.

**A passing Powerplant run asserts contract-bounded integrity, not general correctness.**

## What This Means

Within those conditions, Powerplant is designed and dogfooded to:

- Initializes a per-repo harness (`POLICY.yaml` + `VERIFY.yaml`) and validates the contract before any run.
- Builds a sanitized snapshot that excludes dangerous artifacts (secrets, environments, build trees,
  databases, encrypted blobs, raw result data) and aborts if a denied path reaches the bundle.
- Runs the agent through typed tools only, network-disabled, without credentials, never mounting the
  real project.
- Confines writes to the contract's `allowedWritePaths`, so a run cannot drift across the repo.
- Produces a reviewable patch plus an evidence bundle (manifests, verification report, run classification).
- Applies an approved patch to a `powerplant/<run-id>` branch with an evidence hash — never to `main`/`master`
  directly, and never automatically.

## What This Does Not Mean

- It does **not** verify that the produced code is correct, only that the declared checks passed against
  the produced artifact.
- A hermetic check passing means the artifact is structurally sound (e.g. it compiles), **not** that its
  behavior or claims are valid.
- It does not reason about a repo it was not given an explicit contract for.
- It does not replace human review of the patch before it is applied.

## Proven Workflow

```
init → verify → run → review → approve
```

- **init** — generate and validate `POLICY.yaml` + `VERIFY.yaml` for the repo.
- **verify** — confirm the contract and that required checks are runnable.
- **run** — execute the scoped task in the sandbox; emit a patch + evidence bundle.
- **review** — read the diff, verification report, and run classification.
- **approve** — apply to a `powerplant/<run-id>` branch with an evidence hash, manually.

## Evidence Base

Powerplant has been dogfooded in bounded runs across Python, Rust, frontend/static, Tauri hybrid, ML/research,
manuscript, and code-write repositories. These runs exposed and fixed trust-kernel defects including
exclude-boundary failures, review/approve classification mismatch, required-check semantics, misleading
incomplete-run artifacts, and corrupt source-artifact materialization.

Coverage and the per-defect fix history are recorded in
[DOGFOOD_COVERAGE_LEDGER.md](./DOGFOOD_COVERAGE_LEDGER.md). The strongest evidence is not the number of
repos — it is that the harness found and fixed its own trust-kernel defects through use, each tied to
the release that fixed it.

## Known Limits

- **Verification under isolation.** The executor is network-disabled with dependency directories
  excluded, so dependency-bound checks (`cargo check`, `npx tsc`, `vitest`, `pytest`-with-deps) cannot
  resolve inside the sandbox and are run **advisory**. A hermetic structural check (e.g. a `grep` or
  `compileall`) must carry the required gate. Promoting dependency-bound compile/test checks to required
  needs either an already-hermetic repo check or a shipped capsule profile that provisions dependencies;
  that is not yet available for all stacks.
- **Structure, not correctness.** A required hermetic check confirms the artifact is well-formed, not
  that it is correct. Agent-authored code/tests can encode wrong assumptions about a repo's real APIs
  that the sandbox cannot catch, because it cannot execute against the real dependencies.
- **Artifact-integrity guard is conservative.** Powerplant rejects source writes whose line separators
  appear to be escaped (`\n`) rather than real newlines. It does not attempt to repair them, because
  un-escaping could corrupt legitimate string data. A legitimate single-line source file carrying many
  escaped `\n` would be rejected; split it or write real newlines.
- **VERIFY command surface is narrow.** Commands run as plain subprocesses split on whitespace — no
  shell, pipes, redirection, quoting, or single arguments containing spaces.
- **Approve operates on your working tree.** It writes to a `powerplant/<run-id>` branch in the real
  project's git tree; approval should be run from a clean or intentionally staged working tree, the
  patch must be reviewed before approval, and merge to a mainline is a separate human step.

## When Not To Use Powerplant

- For live trading, payments, or any financial-execution path.
- For unsupervised or unattended operation.
- As a correctness oracle, or as evidence that a result/claim is true.
- For broad, multi-file refactors that require wide write scope.
- For any repo where you cannot write an explicit, honest verification contract.

## Operator Checklist

Before a run:

- [ ] The task is a single, scoped objective.
- [ ] `allowedWritePaths` is as narrow as the task allows (audit-only → the audit deliverable).
- [ ] Secrets, environments, build trees, and raw result/data artifacts are excluded **and** named in
      `denyIfPresentAfterCopy`.
- [ ] At least one **required** check is hermetic (passes with no network and no excluded dependencies).
- [ ] The task prompt leads with the objective and output file; constraints come last.

After a run:

- [ ] Read the patch and the verification report; treat PASS as **contract-bounded**, not correct.
- [ ] Confirm no product/manuscript/model logic changed in an audit-only run.
- [ ] Approve manually; review the `powerplant/<run-id>` branch before any mainline merge.

## Current Status

- Version: v0.2.11.
- Test suite: 1578 passing; road-to-usable smoke: 21/21.
- Repo classes dogfooded: 10 (mechanical, epistemic, and code-write modes).
- Standing posture: a useful constrained patch/audit harness with bounded claims — not a general
  autonomous coding safety system.

---

_Draft — wording under review. Keep this document conservative; if a claim here is not backed by a
recorded run in the ledger, weaken it or remove it._
