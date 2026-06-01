# Claude Powerplant

[![CI](https://github.com/rbardyla-boop/claude_powerplant/actions/workflows/ci.yml/badge.svg)](https://github.com/rbardyla-boop/claude_powerplant/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

**Powerplant is a constrained repo-improvement harness.** It can audit, patch, and
*scout* for small overlooked improvements in a real repository — while keeping every
change scoped, verified against an explicit contract, reviewable, and **manually
approved**.

> **A passing Powerplant run asserts contract-bounded integrity, not general correctness.**

It runs an agent against a disposable, sanitized **copy** of your project, behind a
contract you write. The agent works only through typed tools — no shell, no network,
no credentials, and the real project is never mounted or modified. The output is a
`PATCH.diff` plus an evidence bundle that **you** review before deciding to apply it.

---

## What it is

- A harness that turns a scoped task into a reviewable patch, under an explicit
  per-repo contract (`POLICY.yaml` + `VERIFY.yaml`).
- A **discovery** layer (Scout) that proposes small, evidence-backed candidates
  — read-only, no code written.
- A **review-first** approval flow that applies an approved patch only to a
  `powerplant/<run-id>` branch with an evidence hash — never to `main`/`master`,
  never automatically.

## What it is not

- Not autonomous coding, and not a claim that autonomous coding is solved.
- Not a correctness oracle — a passing check means the artifact is *well-formed*
  against the declared checks, not that its behavior or claims are right.
- Not a replacement for human review of the patch before it is applied.
- Not automated product management or feature development.
- Not safe for live trading, payments, deployment, or unattended operation.

See [docs/WHAT_POWERPLANT_IS_SAFE_FOR.md](./docs/WHAT_POWERPLANT_IS_SAFE_FOR.md) for
the full bounded claim and known limits.

---

## Core workflow

```
init → verify → scout → run → review → approve
```

| Step | What it does |
|------|--------------|
| `init` | Generate and validate `.powerplant/POLICY.yaml` + `VERIFY.yaml` for the repo |
| `verify` | Confirm the contract and that the required checks are runnable (no agent, no network) |
| `scout` | Read-only discovery of small candidate improvements (no code written) |
| `run` | Execute one scoped task in the sandbox → emit a `PATCH.diff` + evidence bundle |
| `review` | Read the diff, verification report, run classification, and fidelity signals |
| `approve` | Apply to a `powerplant/<run-id>` branch with an evidence hash — manually |

`scout` sits *before* the trust path as advisory discovery; one selected candidate
feeds into `run --candidate`. Everything after `run` is the same review-first flow.

---

## Safety model

The properties below are enforced in code (not just documented) and covered by the
test suite:

- **Policy-gated, sanitized snapshot.** No `.powerplant/POLICY.yaml`, no run and no
  scout. The agent and Scout see the *same* sanitized bundle (`includePaths −
  excludePaths`); secrets, environments, build trees, and result data never enter it,
  and a denied path reaching the bundle aborts the run.
- **`allowedWritePaths` ceiling.** Writes are confined to the contract's declared
  paths; `run --candidate` re-checks the ceiling against the (untrusted) candidate
  file and **fails closed** — it can never widen scope.
- **Required vs advisory checks.** The executor is network-disabled with dependency
  directories excluded, so dependency-bound checks (`cargo check`, `tsc`, `pytest`)
  run **advisory**; a hermetic structural check must carry the required gate. A
  required check confirms structure, not correctness.
- **Artifact-integrity guards.** Source/document writes whose newlines or quotes are
  escaped (invalid bytes the model sometimes emits) are **rejected, not repaired**.
- **Review before approve.** Approval is manual, applies only to a
  `powerplant/<run-id>` branch, and stamps an **evidence hash** over the run bundle.
  Merging to a mainline is a separate human step.

---

## Scout Mode

Scout finds small repo *affordances* (test gaps, docs mismatches, missing version
display, packaging excludes, …) — never product strategy or roadmaps.

- **Read-only and policy-gated.** Reasons only over the sanitized bundle. No policy,
  no scout.
- **Cannot self-promote.** A candidate is normalized against the live contract; only
  low-risk, evidence-bound, verifiable-within-the-ceiling candidates become
  `RECOMMENDED`.
- **`run --candidate <file>`** derives a scoped task from a selected candidate and
  re-checks the write/check ceiling before anything runs.
- **Verification coverage.** Each candidate carries a `strong` / `weak` /
  `advisory-only` signal — does a required check actually cover the file the
  candidate would change? A signal for the human, never a gate.

The engine is **deterministic** today. An LLM candidate source and a multi-advisor
Council are **deferred by design** (they add autonomy/cost and are not needed to
prove bounded discovery).

---

## Feature Lab (v1.5 foundation)

Feature Lab adds **traceability and operator-facing fidelity signals** — not
autonomy. It makes one question answerable by a human: *did the sandbox trial stay
faithful to the candidate it was supposed to test?*

```
Scout candidate → FEATURE_TRIAL.json → review fidelity panel → approve --dry-run summary → human decision
```

- **`FEATURE_TRIAL.json`** — an evidence-only record written by `run --candidate`
  (candidate, expected files, non-goals, verification coverage, scope ceiling). It
  grants no writes and approves nothing; coverage and ceiling are recomputed from the
  live contract, not trusted from the candidate file.
- **Review fidelity panel** — `review` shows file-scope **drift** (expected vs
  touched) and **advisory** non-goal findings (heuristic path/text match).
- **`approve --dry-run` summary** — the same signals at the approval moment.

Everything here is **advisory**. It informs the human decision; it does not change
PASS/FAIL, approve eligibility, or any gate. See
[docs/FEATURE_LAB_V1_5.md](./docs/FEATURE_LAB_V1_5.md) for what is shipped, what is
advisory, and what is explicitly **not** shipped (auto-approval, strict drift
blocking, Council, LLM candidate source, autonomous feature development).

---

## Release-audit / Steam beta gate

Powerplant can run an **audit** against a release-readiness gate and propose small,
scoped fixes one at a time. The gate is an **evidence gate** — it finds *missing
affordances* (no version display, a crash on boot, secrets in the bundle). It does
**not** judge whether a product is fun, polished, beta-ready, or commercially viable.
See [docs/STEAM_BETA_RELEASE_QUALITY.md](./docs/STEAM_BETA_RELEASE_QUALITY.md).

---

## Quickstart

```bash
# install
npm install
npm link                      # makes `powerplant` available globally
cp .env.example .env          # add ANTHROPIC_API_KEY for `run`

# 1. give your repo a contract (auto-detects stack)
powerplant init --yes

# 2. confirm the contract + required checks (no agent, no network)
powerplant verify .

# 3. (optional) discover small candidates, read-only
powerplant scout .

# 4. run one scoped task — requires ANTHROPIC_API_KEY
powerplant run . "Add validation for empty inputs and deterministic tests."

# 5. review the proposed patch + evidence
powerplant review <run-id>

# 6. pre-flight, then apply to a powerplant/<run-id> branch
powerplant approve <run-id> --dry-run
powerplant approve <run-id>
```

`run` and `approve` never touch `main`/`master`, and patches are never auto-applied.

---

## Known limits

- **Structure, not correctness.** A required hermetic check confirms an artifact is
  well-formed (e.g. it compiles), not that it is behaviorally right. Agent-authored
  code can encode wrong assumptions the sandbox cannot catch.
- **Verification under isolation.** Dependency-bound checks (`cargo`, `tsc`,
  `pytest`-with-deps) cannot resolve in the network-disabled sandbox and run
  *advisory*. For compiled languages, a host-side compile before approve is required
  (see [CLAUDE.md](./CLAUDE.md)).
- **Narrow VERIFY surface.** Checks run as plain subprocesses split on whitespace —
  no shell, pipes, redirection, or quoting.
- **Approve writes to your tree.** Run it from a clean working tree; review the
  `powerplant/<run-id>` branch before any mainline merge.
- **Conservative artifact guard.** A legitimate single-line source file with many
  escaped separators may be rejected; split it or write real newlines.

When **not** to use it: repos with secrets/credentials/deploy config in source; live
trading/payments/user-data systems; large monorepos with complex build chains; any
repo you would not be comfortable letting the agent read in full.

---

## Run artifacts

Every run produces a bundle at `~/.powerplant/runs/<project-id>/<run-id>/`:

| File | Purpose |
|------|---------|
| `TASK.md` | The developer request |
| `PROMPT_ENVELOPE.json` | Exact message sent to the model, SHA-256 hash, model ID, protocol version |
| `PATCH.diff` | Proposed changes as a unified diff |
| `CHANGED_FILES.md` | Files the agent modified |
| `SOURCE_MANIFEST.json` | Pre/post-run source-integrity verification |
| `SANITIZED_MANIFEST.json` | Files that entered the sanitized snapshot |
| `VERIFICATION_REPORT.md` | Check output |
| `ADVERSARIAL_REVIEW.md` | Remaining limitations + what the run proves |
| `RUN_CLASSIFICATION.json` | Termination reason + patch eligibility |
| `CANDIDATE_SCOPE.json` / `FEATURE_TRIAL.json` | Present for candidate-driven runs |
| `SESSION_SUMMARY.json` | Containment flags and run metadata |

---

## Development

```bash
npm run build       # tsc --noEmit
npm test            # full Vitest suite
npm run smoke:road-to-usable
```

CI runs `npm test` and `npx tsc --noEmit` from a clean checkout on every push and PR.
No `.env` is present in CI; pilot-dependent integration tests skip automatically when
`SPRINT4A_PILOT_SOURCE_PATH` is unset (see `.env.example`). `*.live.test.ts` files
require an API key and are excluded from `npm test`.

Contributions: see [CONTRIBUTING.md](./CONTRIBUTING.md). Security reports: see
[SECURITY.md](./SECURITY.md).

---

## Documentation

| Document | Purpose |
|----------|---------|
| [docs/WHAT_POWERPLANT_IS_SAFE_FOR.md](./docs/WHAT_POWERPLANT_IS_SAFE_FOR.md) | The bounded claim, non-claims, and known limits |
| [docs/ROAD_TO_V1.md](./docs/ROAD_TO_V1.md) | Roadmap and version ladder (claims-controlled) |
| [docs/FEATURE_LAB_V1_5.md](./docs/FEATURE_LAB_V1_5.md) | What Feature Lab is, advisory vs shipped vs not-shipped |
| [docs/DOGFOOD_COVERAGE_LEDGER.md](./docs/DOGFOOD_COVERAGE_LEDGER.md) | Per-defect fix history from real dogfood runs |
| [docs/STEAM_BETA_RELEASE_QUALITY.md](./docs/STEAM_BETA_RELEASE_QUALITY.md) | Release-audit gate (evidence gate, not "is it good") |
| [docs/PROJECT_CHARTER.md](./docs/PROJECT_CHARTER.md) | Durable commitments and safety invariants |
| [CHANGELOG.md](./CHANGELOG.md) | User-facing changes |

---

## Security / public history note

Tracked files have been sanitized of identified live runtime identifiers and
operator-local paths. Earlier non-credential runtime metadata remains in
already-public Git history; no history rewrite has been performed.

---

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](./LICENSE).
