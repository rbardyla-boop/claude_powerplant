---
name: powerplant-feature-loop
description: Convert a bounded engineering objective into the smallest verified, documented, claim-calibrated implementation delta. Use for ordinary features, fixes, refactors, and documentation. Do NOT use for trust-critical, security-critical, migration, or release work.
origin: powerplant-local
---

# Powerplant Feature Loop

Convert a bounded engineering objective into the smallest verified, documented, claim-calibrated
implementation delta.

**In scope:** features, bug fixes, refactors explicitly requested, documentation, test additions.

**Not in scope:** trust-kernel gates, evidence harnesses, live acceptance workflows, migration
scripts, release automation, security boundary changes. For those, stop here and use the
governed workflow appropriate to the class of change.

---

## Phase 0 — Classify the Change

Before anything else, classify:

| Class | Route |
|---|---|
| STANDARD_FEATURE / BUG_FIX / REFACTOR / DOCS / TEST | Continue below |
| TRUST_CRITICAL | Stop — use governed harness workflow |
| SECURITY_CRITICAL | Stop — use security-reviewer + governed workflow |
| DATA_OR_MIGRATION | Stop — requires explicit ADR and rollback plan |
| RELEASE_OR_DEPLOYMENT | Stop — requires explicit sign-off sequence |

If class is unclear, ask. Do not default to STANDARD_FEATURE for ambiguous cases.

---

## Phase 1 — Lock the Work Package

State explicitly before editing anything:

- **Objective** — one sentence on what changes and why
- **Success criteria** — how we verify it is done (specific commands and expected outcomes)
- **Non-goals** — what is explicitly out of scope
- **Allowed surfaces** — which files or directories are in play
- **Forbidden changes** — what must not be touched (architecture, clearances, unrelated modules)
- **Verification commands** — the exact commands that will prove success
- **Risks** — what could go wrong and what would detect it

Do not proceed until the work package is coherent and scope is locked.

---

## Phase 2 — Inspect Before Planning

Read the relevant code. Do not plan from memory or assumption.

- Read the files in the allowed surfaces
- Find existing helpers, types, and patterns that apply
- Identify the smallest structural solution
- Look for a simplification opportunity (can deletion solve this instead of addition?)
- Identify any scope expansion risk before it happens

Produce a bounded edit plan: which files change, what moves, what stays.

Flag required scope expansion — get acknowledgment before doing it.

---

## Phase 3 — Implement Surgically

Change only what the work package requires.

- Reuse canonical helpers; do not rewrite what already exists
- No speculative abstractions — three similar lines is better than a premature abstraction
- No refactoring of adjacent working code
- No new dependencies without justification tied to the work package
- No architecture changes without an explicit ADR
- Immutable patterns: create new objects, do not mutate existing state

---

## Phase 4 — Verify Immediately

Run the narrowest relevant check first.

Report exactly:
- Commands run (full command text)
- Exit codes
- Tests passed / failed / skipped counts
- Any remaining uncertainty
- Evidence not yet obtained

Never convert "not checked" to "passed."
Never convert a passing type check into a claim that tests pass.
Never convert a local pass into a claim about CI.

---

## Phase 5 — Review the Delta

Before declaring done, inspect:

- Changed files and actual diff scope
- Architectural leakage (did this change something it should not have?)
- Duplicated logic (is this already expressed elsewhere?)
- Secret or runtime artifact risk (state files, API keys, build output in diff?)
- Missed simplification (could this be smaller?)
- Claim / evidence alignment (does every success claim have an observed result behind it?)

---

## Phase 6 — Commit and Deliver Receipt

Commit only when:
- Scope is clean (no accidental files, no runtime artifacts)
- Relevant verification passed (with evidence)
- Commit message follows conventional commits format

Deliver a receipt:

```
Objective:    <what was accomplished>
Files changed: <list>
Verification: <command and result>
Limitations:  <known gaps or deferred items>
Commit:       <hash if committed>
Next step:    <one bounded next action, or "done">
```

The receipt is a claim document. Every field must be observable, not inferred.
