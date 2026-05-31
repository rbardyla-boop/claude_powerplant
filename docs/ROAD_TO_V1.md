# Road to v1.0 (and v1.5)

> Roadmap + claims-control document. Like [WHAT_POWERPLANT_IS_SAFE_FOR.md](./WHAT_POWERPLANT_IS_SAFE_FOR.md),
> it exists to keep the project from outrunning its evidence. Every "shipped" claim here is bounded by a
> run, a test, or a commit that was actually observed. Forward items are labelled as gates, not promises.
>
> Anchored at master `bb94d34` · `package.json` 0.2.11 · untagged.

## Bounded claim (today)

Powerplant is a useful **constrained repo-improvement harness**: it can audit, patch, and now *scout* for
small overlooked improvements in a real repository when the task is scoped, write paths are narrow, and the
verification contract is explicit. A passing run asserts **contract-bounded integrity, not general
correctness** (see [WHAT_POWERPLANT_IS_SAFE_FOR.md](./WHAT_POWERPLANT_IS_SAFE_FOR.md)).

Scout extends this claim by exactly one capability and no new autonomy:

> Scout recommends. The user selects. Powerplant patches one bounded task within the contract ceiling. The
> user reviews and approves. (See [PROJECT_CHARTER.md](./PROJECT_CHARTER.md).)

## Non-claims

- Not automated product management, roadmap generation, or autonomous feature development.
- Scout does **not** write product code, approve, or chain into a run on its own.
- A required hermetic check confirms an artifact is well-formed, **not** that it is correct or behaviorally
  useful.
- No reasoning about a repo without an explicit `.powerplant/` contract.
- Does not replace human review of the patch before it is applied.

## Shipped trust path

The proven workflow is unchanged by Scout:

```
init → verify → run → review → approve
```

Scout sits *before* this path as read-only advisory discovery, and feeds one selected candidate into the
same `run`:

```
scout  →  (human selects one candidate)  →  run --candidate  →  review  →  approve
```

Invariants that hold across the whole surface (enforced in code, not docs):

- **No policy, no scout / no run.** Both require `.powerplant/POLICY.yaml`.
- Scout and the agent see the **same sanitized snapshot** (includePaths − excludePaths); no privileged
  repo-wide read. Secrets/envs/build trees never enter the bundle.
- Writes are confined to the contract's `allowedWritePaths`; `run --candidate` **re-checks** the ceiling
  against the (untrusted) candidate file and fails closed — it can never widen scope.
- Approve applies only to a `powerplant/<run-id>` branch with an evidence hash, manually.

## Scout status

| Slice | What | State |
|-------|------|-------|
| Bounded discovery | `scout` (read-only, policy-gated), `run --candidate` (ceiling re-checked), scope-drift in `review` | landed |
| Stack-aware test-gap | heuristic fires on Python/TS modules (not just CLI); Rust skipped; ceiling-gated; cap 3 | landed |
| Candidate quality | composite ranking: app-facing + importable modules rise; hook/script/non-importable down-ranked (not excluded) | landed |

- **Engine:** deterministic only (`deterministic-v1`). LLM `CandidateSource` and the multi-advisor Council
  are **deferred** by design — they add autonomy/cost and are not needed to prove bounded discovery.
- **Dogfood evidence:** scout has run cleanly and with zero drift in bounded checks across a Python app,
  a node-ts/Tauri trading app, and research repos. After the test-gap + ranking slices, Screenpipe-to-Obsidian yields 3 RECOMMENDED,
  tests-only candidates, top-ranked `ai_provider.py` / `vault_sync.py` / `cleanup_legacy.py`.
- **Handoff proven non-billable:** `run --candidate` derives the scoped task, re-checks the ceiling, and
  shows a bounded disclosure — verified without a live agent run.

## Remaining gate before a version claim

One **live** `run --candidate` (billable: API + Docker + provisioned agent), parked until explicitly
authorized. It answers a question the prior slices did not: *can a top-ranked candidate become a
**semantically useful** patch, not merely a well-formed one?*

Pass bar: patch touches only the expected test file(s); no product-code change; required checks pass; review
shows no scope drift; the produced test asserts real `ai_provider` behavior (not empty smoke); `approve
--dry-run` is clean; no secrets/env enter the bundle.

Three-way outcome:

- **Clean PASS** → make the version decision (below).
- **P0/P1 defect** → patch first, no version claim.
- **Weak/meaningless test** → candidate quality still insufficient; improve Scout before tagging.

## The ladder

| Version | Theme | Adds |
|---------|-------|------|
| **v0.3** | Scout Mode version decision | scout, run --candidate, scope-drift review, normalization, RECOMMENDED/DEFER/REJECT, stack-aware + ranked candidates — *all landed; tagging gated on the live run* |
| v0.4 | Candidate quality (continued) | (started: ranking) richer scoring, duplicate suppression, evidence snippets, better reject explanations |
| v0.5 | Candidate→run hardening | expected-vs-actual files panel, candidate-specific VERIFY expectations, non-goals in review, candidate-scope hash |
| **v1.0** | Constrained repo-improvement harness | maturity, not new autonomy |
| **v1.5** | Feature Lab | sandboxed feature-discovery + trial loop |

**v1.0 claim:** Powerplant can audit, patch, and scout for small overlooked repo improvements — every change
stays scoped, verified, reviewable, and manually approved.

**v1.5 claim:** Powerplant can propose, prototype, and verify small repo improvements in a sandbox, then
present one bounded patch for human review and approval. Loop:

```
Scout → Rank → (pressure-test) → one Sandbox Trial → Verify → Review → Human Approve
```

At v1.5 the Council returns to **pressure-test candidates, not write code**. The LLM CandidateSource, if
adopted, stays bounded by the same normalization + ceiling enforcement that constrains the deterministic
source today.

## Version decision (pending)

Untagged on purpose. After one clean live run:

- **v0.3.0** — if Scout is declared public product surface.
- **v0.2.12** — if Scout stays quiet/additive while candidate-quality work continues.

Council and LLM CandidateSource remain deferred until after v0.3 lands and is dogfooded.
