# Skill Lifecycle Stage 2A — Closure Record

**Verdict**: `A — SKILL_LIFECYCLE_STAGE_2A_SYNTHETIC_PILOT_COMMITTED_AND_BASELINED`
**Date**: 2026-05-28
**Branch**: `feat/skill-lifecycle-stage2b`
**Commit**: `06781cb` feat(skill-lifecycle): Stage 2A — synthetic promoted-guidance pilot invocation

> **Record status**: This closure record was created during RC6 preparation
> (`feat/rc6-integrated-baseline`). Stage 2A was accepted at commit time based on the
> evidence in commit `06781cb`'s message and the test/typecheck results it records.
> All evidence below is derived from that immutable commit record. No new historical
> evidence has been constructed. Where RC6 preparation re-ran validation, it is
> explicitly marked **[RC6 re-validation]**.

---

## 1. Baseline Accounting

| Stage | Commit | Tests | Source |
|-------|--------|------:|--------|
| Stage 1 baseline | `04dcd6c` | 730 | `SKILL_LIFECYCLE_STAGE_1_CLOSURE_RECORD.md` §6 |
| Verification diagnostics repair | `9873065` | 748 | Commit message: "+18 regression tests" |
| **Stage 2A baseline entering** | | **748** | |
| Stage 2A additions | `06781cb` | +35 | `tests/synthetic-promoted-guidance-pilot.test.ts` (new) |
| **Stage 2A total** | | **783** | |

The 748 → 783 increment maps exactly to one new test file with 35 tests. Commit message
`06781cb` records: `"Suite: 783 passing, 0 failing (748 baseline + 35 Stage 2A tests)"`.

---

## 2. Files Added or Modified by Stage 2A

Evidence from `git show 06781cb --stat` and commit message body:

| File | Change | Purpose |
|------|--------|---------|
| `src/sessions/run-synthetic-promoted-guidance-pilot.ts` | Created | Main pilot function — pre-invocation check chain (steps 1–8), collect-then-validate batch atomicity, synthetic budget enforcement |
| `src/skills/skill-invocation-audit.ts` | Created | Append-only JSONL audit trail for synthetic invocations (`SkillInvocationRecord`, `openInvocationAuditRecord`) |
| `tests/synthetic-promoted-guidance-pilot.test.ts` | Created | 35 Stage 2A tests |
| `src/config/constants.ts` | Modified | Added `SKILL_INVOCATION_AUDIT_FILENAME` constant |

### Protected Surfaces Not Touched

Confirmed in commit message `06781cb`:

| File | Status |
|------|--------|
| `src/broker/project-tool-broker.ts` | NOT modified |
| `src/contracts/project-tool-contracts.ts` | NOT modified |
| `src/skills/skill-lifecycle.ts` | NOT modified |
| `src/skills/skill-envelope.ts` | NOT modified |

---

## 3. Stage 2A Functional Scope

`runSyntheticPromotedGuidancePilot` implements a pre-invocation check chain with the
following steps (1–8) before any synthetic agent call:

1. Skill registry load and format validation
2. Promotion status check — skill must be in PROMOTED state
3. Content hash verification — `computeSkillContentHash()` must match registry `contentHash`
4. Scope check — `syntheticScope: true` must be present in the invocation request
5. Budget validation — token budget must be within synthetic limits
6. Audit open — `openInvocationAuditRecord()` writes Phase A record before any invocation
7. Collect-then-validate batch — all outputs collected before any validation side-effects
8. Atomicity fence — batch either fully succeeds or fully rolls back

This chain runs entirely before any broker session is started. Steps 1–8 are the
mandatory gate; failure at any step blocks invocation.

---

## 4. Test/Typecheck Results at Commit Time

Recorded in commit message `06781cb`:

| Check | Result |
|-------|--------|
| `npm test` | 783 passing, 0 failing |
| `tsc --noEmit` | clean (exit 0) |

**[RC6 re-validation]** — The frozen RC5 worktree verification (Step 1 of RC6 preparation)
ran the integrated suite against `558881d`, which includes all Stage 2A tests. All 838
tests passed. Stage 2A test files are included in that count. Typecheck was clean.

---

## 5. Invocation Safety Properties

### Synthetic scope isolation

`syntheticScope: true` is a hard precondition (step 4 of the check chain). Without it,
invocation is blocked. Stage 2A cannot trigger live sanitized-project broker sessions —
that path requires Stage 2B's `runSkillGuidedSanitizedProjectPilot`.

### Collect-then-validate atomicity

The batch collection model ensures all pilot outputs are accumulated before any
validation step applies side effects. Partial validation against an incomplete batch
is prevented structurally.

### Audit-before-invocation ordering

Step 6 writes the Phase A audit record before any invocation attempt. The audit
cannot be bypassed — if Phase A persistence fails, the pilot function returns an error
without proceeding to invocation.

### No verification-authority modification

Stage 2A creates no files in `broker/`, `capsule/`, or `verification/` directories.
It adds no imports of broker, capsule, or approved-checks modules to new code.
`skill-lifecycle.ts` and `skill-envelope.ts` are explicitly listed in the commit as
protected surfaces not touched.

---

## 6. Verdict

| Task | Status |
|------|--------|
| Baseline accounting: 748→783 fully reconciled | ✓ |
| New files mapped to commit body | ✓ |
| Protected surfaces confirmed not modified | ✓ |
| Test result recorded at commit time | ✓ 783/783, 0 failing |
| Typecheck result recorded at commit time | ✓ clean |
| Invocation safety properties documented | ✓ |

```
A — SKILL_LIFECYCLE_STAGE_2A_SYNTHETIC_PILOT_COMMITTED_AND_BASELINED
```

### Stage 2A commit record

| Item | Value |
|------|-------|
| Stage 2A commit hash | `06781cb9b366fac6635f3ab29577d9cad358775d` |
| Files committed | `src/sessions/run-synthetic-promoted-guidance-pilot.ts`, `src/skills/skill-invocation-audit.ts`, `tests/synthetic-promoted-guidance-pilot.test.ts`, `src/config/constants.ts` |
| Tests at commit | 783 passing (748 baseline + 35 Stage 2A) |
| Typecheck at commit | clean (tsc --noEmit exit 0) |
| Live invocation | Not implemented in Stage 2A (syntheticScope gate blocks live paths) |
| Verification-authority files | Not modified |
| Capsule/finalize files | Not modified |

### Non-claims

Stage 2A does NOT prove:

- Live sanitized-project broker sessions with skill guidance are safe or authorized (deferred to Stage 2B)
- Skills can produce or authorize code execution with real project access
- The synthetic scope gate is sufficient for production live-invocation use
