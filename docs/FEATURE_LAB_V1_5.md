# Feature Lab (v1.5)

> Claims-control document, in the spirit of
> [WHAT_POWERPLANT_IS_SAFE_FOR.md](./WHAT_POWERPLANT_IS_SAFE_FOR.md) and
> [ROAD_TO_V1.md](./ROAD_TO_V1.md). It exists to keep Feature Lab from drifting
> into "auto-build / auto-approve." Every "shipped" item below is backed by code
> on `master` and a merged commit; everything else is explicitly labelled
> not-shipped or precondition-gated.

## What Feature Lab is

Feature Lab is a **bounded extension of Scout**, not a new autonomy tier. It adds
**traceability and operator-facing fidelity signals** to the existing trust path
so a human can judge, at review and at the approval moment, whether a sandbox
trial stayed faithful to the candidate it was supposed to test.

The chain it makes visible:

```
Scout candidate
  → FEATURE_TRIAL.json            (evidence record written by run --candidate)
  → review fidelity panel         (powerplant review)
  → approve --dry-run summary     (powerplant approve --dry-run)
  → human decision
```

It answers two questions a reviewer/operator could not see before:

- **File-scope fidelity:** did the patch touch only what the candidate declared? (*drift*)
- **Intent-scope fidelity:** did the patch touch anything a declared *non-goal* forbade? (*advisory*)

## The safety invariant (unchanged)

Feature Lab does **not** change the invariant Scout established
(see [PROJECT_CHARTER.md](./PROJECT_CHARTER.md)):

> Scout recommends. The user selects. Powerplant patches one bounded task within
> the contract ceiling. The user reviews and approves.

A passing run still asserts **contract-bounded integrity, not general correctness**.
Feature Lab's signals are **informational** — they inform the human decision; they
do not make it.

## Shipped (on `master`, evidence-backed)

| Capability | Where | Commit |
|------------|-------|--------|
| Candidate → trial traceability (`FEATURE_TRIAL.json`, evidence-only) | `src/scout/feature-trial.ts`, `run --candidate` | `9d36395` |
| Review fidelity panel (JSON + TUI) | `src/cli/commands/review.ts`, `terminal-output.ts` | `6b27d40` |
| File-scope **drift** visibility (expected vs touched) | review panel + approve dry-run | `6b27d40` |
| **Non-goal** advisory visibility (heuristic, path/text) | `detectNonGoalViolations` | `c5a1e27` |
| Approve **dry-run** fidelity summary | `src/cli/commands/approve.ts` (dry-run block only) | `5dbfba2` |

Properties that hold across all of the above (enforced in code, covered by tests):

- **Evidence-only.** `FEATURE_TRIAL.json` grants no writes, changes no candidate
  status, and approves nothing. Its embedded `claim` says so verbatim.
- **Recomputed, not trusted.** `verificationCoverage` and `scopeCeiling` in the
  trial are derived from the **live contract**, never copied from the untrusted
  candidate file — a hand-edited candidate cannot inject a misleading coverage
  strength or a wider ceiling.
- **Read-only and fail-safe.** A missing `FEATURE_TRIAL.json` preserves prior
  review/approve output exactly; a malformed one yields a warning and omits the
  panel without crashing.
- **Never gates.** None of these signals change `overallStatus`, `nextAction`,
  patch eligibility, PASS/FAIL, the contract ceiling, or git behavior. The approve
  dry-run summary is printed only **after** every approval gate has already passed.

## Advisory, not authoritative

Two signals are explicitly **advisory** and must be read as "a human should look,"
not "the tool decided":

1. **Non-goal adherence** is a *heuristic* path/text match (literal path/glob
   tokens in the non-goal text plus a small curated keyword→path map). It does not
   understand intent; it flags *possible* violations. It can miss real violations
   and can over-flag. Keep it advisory until there is enough real-candidate evidence
   to justify each matcher.
2. **Verification coverage** (`strong` / `weak` / `advisory-only`) is a heuristic
   about whether a required check *covers* the expected path — not proof the change
   is correct. A required hermetic check confirms an artifact is well-formed, not
   that its behavior is right.

## Not shipped (and not implied)

Feature Lab does **not** include, and its existence must not be read to imply:

- automatic approval, or approval without a human;
- **strict drift blocking** or any gate that fails/blocks on drift or a non-goal
  finding (today these are display-only);
- the multi-advisor **Council**;
- an **LLM `CandidateSource`** (the engine is deterministic-only);
- autonomous or multi-step feature development;
- a correctness guarantee, or evidence that a produced patch is behaviorally right;
- safety for live trading, payments, deployment, or unattended operation.

These remain the non-claims of [ROAD_TO_V1.md](./ROAD_TO_V1.md) and
[WHAT_POWERPLANT_IS_SAFE_FOR.md](./WHAT_POWERPLANT_IS_SAFE_FOR.md).

## Preconditions before strict controls or Council

The next behavior-changing step under discussion is an **opt-in strict approval
mode** (e.g. `approve <run-id> --strict-trial`, or `--dry-run --strict-trial`)
that would require an explicit confirmation when drift or a non-goal violation is
present. Because that **changes approve semantics**, it is gated. It may be built
only when **all** of the following hold:

- [ ] It is **opt-in via an explicit flag**. The default `approve` path is never
      gated by a fidelity signal.
- [ ] Drift detection and non-goal heuristics have enough real-candidate evidence
      that their false-positive rate is understood and documented — a strict mode
      that blocks on a noisy heuristic is worse than an advisory one.
- [ ] The strict check is **transparent**: it prints exactly which signal triggered
      and why, and offers a clear override path for a human who has judged it safe.
- [ ] It does not weaken any existing guarantee (sanitization, write ceiling,
      source-unmodified, evidence hash, manual-branch-only application).
- [ ] The change is recorded as an architecture decision in
      [DECISIONS.md](./DECISIONS.md) and reflected here and in
      [WHAT_POWERPLANT_IS_SAFE_FOR.md](./WHAT_POWERPLANT_IS_SAFE_FOR.md).

The **Council** and **LLM `CandidateSource`** remain deferred on the same terms as
[ROAD_TO_V1.md](./ROAD_TO_V1.md): at v1.5 the Council, if adopted, returns to
**pressure-test candidates, not to write code**, and any LLM source stays bound by
the same normalization + ceiling enforcement that constrains the deterministic
source today.

## v1.5 claim (bounded)

> Powerplant can propose (Scout), trial in a sandbox (`run --candidate`), and make
> the trial's fidelity visible to a human at review and at approval — every change
> still scoped, verified against an explicit contract, reviewed, and **manually
> approved**. Feature Lab adds operator judgment at the approval moment; it does
> not add autonomy.

If a claim here is not backed by code on `master` and a merged commit, weaken it or
remove it.
