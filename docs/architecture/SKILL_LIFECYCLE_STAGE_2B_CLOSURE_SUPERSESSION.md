# Skill Lifecycle Stage 2B — Closure Supersession Record

**Status**: `STAGE_2B_CLOSURE_SUPERSEDED_PENDING_BLOCKER_RESOLUTION`  
**Supersedes**: `SKILL_LIFECYCLE_STAGE_2B_CLOSURE_RECORD.md` (repo root)  
**Correction branch**: `feat/rc6b-provenance-correction`  
**Created**: 2026-05-29  
**Authority**: `docs/architecture/RC6A_REPLAY_STOP_AND_SCOPE_CORRECTION.md`

---

## 1. Original Closure Record — What It Accurately Stated

`SKILL_LIFECYCLE_STAGE_2B_CLOSURE_RECORD.md` (committed at repo root) made the
following claims, all accurate at commit time:

| Claim | Accuracy |
|-------|----------|
| Code committed to repository | Accurate |
| 24 unit tests (T1–T24) passing × 3 clean runs | Accurate |
| Typecheck clean (`tsc --noEmit` exit 0) | Accurate |
| Protected enforcement files not modified | Accurate |
| L1–L7 live acceptance runs remain pending | **Accurate — and explicit** |
| Verdict: `A — SKILL_LIFECYCLE_STAGE_2B_SANITIZED_INVOCATION_COMMITTED_AND_BASELINED` | Accurate for its scope |

The closure record was correctly scoped: it described unit-test and typecheck
evidence, and explicitly noted that L1–L7 live acceptance runs were not yet executed.
It did not claim trusted live invocation was safe or authorized.

---

## 2. Where the Closure Record Was Misread

The verdict `A — SKILL_LIFECYCLE_STAGE_2B_SANITIZED_INVOCATION_COMMITTED_AND_BASELINED`
was treated as equivalent in weight to prior stage verdicts (Stage 1, Stage 2A) in the
context of the RC6A annotation:

> "RC6A — Integrated skill-lifecycle through Stage 2B..."

This reading ignored the closure record's explicit L1–L7 caveat and failed to account
for five code-level defects in the committed implementation that were not surfaced by
the unit test suite.

The closure record was not wrong. The RC6A annotation drew an inference the record
did not support.

---

## 3. Five Code-Level Defects Not Captured in the Closure Record

These defects exist in the committed Stage 2B implementation. The unit tests (T1–T24)
do not exercise the conditions that expose them. Full defect descriptions are in
`docs/architecture/RC6A_REPLAY_STOP_AND_SCOPE_CORRECTION.md` §4.

| # | Defect | Classification |
|---|--------|----------------|
| 1 | `agentMessage: envelope.text` — skill guidance displaces operator task | Hard blocker |
| 2 | `derivePatchEligible` re-derives from `checkResults` instead of broker terminal facts | Open, partially addressed |
| 3 | `CAPSULE_ISOLATION` hardcoded constants written as observed run evidence in Phase B | Hard blocker |
| 4 | `loadProjectContract()` and `buildPilotSnapshot()` execute before `appendPhaseARecord()` — Phase A ordering contradicts its stated semantics | Hard blocker |
| 5 | No accepted runtime skill; `~/.powerplant/state/skill-registry.json` absent; L1–L7 never run | Acceptance blocker |

---

## 4. Effect of This Supersession

The original closure record is **not deleted or rewritten** — it remains historical
evidence. Its verdict `A — SKILL_LIFECYCLE_STAGE_2B_SANITIZED_INVOCATION_COMMITTED_AND_BASELINED`
stands as an accurate description of unit-test and typecheck evidence.

This supersession record adds:

1. **Explicit acknowledgment** that the closure record's L1–L7 caveat was load-bearing and was overlooked in RC6A provenance work.
2. **Documentation of five code-level defects** discovered by the audit that were not captured in the original record.
3. **Revised status**: Stage 2B is committed and unit-tested, but is **not accepted** for live trusted replay. The verdict is narrowed:

```
STAGE_2B_COMMITTED_AND_UNIT_TESTED — NOT ACCEPTED FOR TRUSTED LIVE INVOCATION
```

---

## 5. Required Path to Restore Stage 2B Acceptance

Stage 2B may be re-evaluated after ALL of the following are resolved:

| Requirement | Description |
|-------------|-------------|
| Fix Blocker 1 | Preserve operator task; implement two-hash guidance model |
| Fix Blocker 2 | Replace `derivePatchEligible` with authoritative broker terminal fact consumption |
| Fix Blocker 3 | Label `capsuleIsolationIndicators` as declared policy, not observed evidence |
| Fix Blocker 4 | Correct Phase A ordering (Phase A before any session state construction) or correct Phase A's stated semantics |
| Fix Blocker 5 | Produce an accepted runtime skill via approved auditable mechanism |
| L1–L7 live runs | Execute all seven acceptance scenarios; record evidence |
| New integrated tag | Create a new accurately-described tag after all blockers resolved and L1–L7 passed |

Until all requirements are met, Stage 2B remains in state:

```
BLOCKED — PENDING BLOCKER RESOLUTION AND LIVE ACCEPTANCE
```
