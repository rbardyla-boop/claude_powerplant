# Project Charter

Durable product-surface commitments and the safety invariants they must
preserve. Detailed architecture decision records — alternatives considered and
consequences — live in [DECISIONS.md](./DECISIONS.md). This charter captures the
bounded commitments that define what Powerplant is, and is not, allowed to do.

## Architecture decisions

### Scout Mode — advisory discovery only

Scout Mode is advisory discovery only. It may propose small, evidence-backed
repo improvements using the same sanitized bundle the agent would see, but it
may not mutate product code. A candidate becomes executable only after user
selection, contract re-checking, scoped task derivation, normal sandbox run,
review, and manual approval.

**Non-claim.** Scout Mode is not automated product management, roadmap
generation, or autonomous feature development.

**Safety invariant.** Scout recommends. The user selects. Powerplant patches one
bounded task within the contract ceiling. The user reviews and approves.

**Evidence.** Implemented on `feat/scout-mode-bounded-discovery` (commit
`fdb452d`): read-only `powerplant scout` (policy-gated; reasons only over the
sanitized snapshot), `powerplant run --candidate` (re-checks the contract
write/check ceiling on the untrusted candidate file and fails closed), and
scope-drift reporting in `powerplant review`. Verified at that commit: build
clean, 1612/1612 tests, smoke 21/21.
