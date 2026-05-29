# RC5 Scope and Provenance Addendum

**RC5 tag**: `powerplant-cli-v0.1.4-rc5` (lightweight tag — type: `commit`)
**RC5 commit**: `558881dd332d32bf2b1e1fadc468e701e5f46960`
**Addendum created on**: `feat/rc6-integrated-baseline`
**Disposition**: RC5 archived as valid but scope-expanded. Successor RC6 required for forward integrated QA use.

---

## 1. RC5 Tag Identity

| Field | Value |
|-------|-------|
| Tag name | `powerplant-cli-v0.1.4-rc5` |
| Tag type | Lightweight (`commit`) |
| Resolved commit | `558881dd332d32bf2b1e1fadc468e701e5f46960` |
| Branch at tag time | `feat/skill-lifecycle-stage2b` |
| Original description | "fix(terminal-outcome): unify terminal run outcome and patch eligibility reporting" |

Because RC5 is a lightweight tag, the tag object carries no embedded description beyond the commit message subject. The original description was the commit subject line — which names only the terminal-outcome repair. That description is **materially incomplete**.

---

## 2. Actual Feature Scope Carried by RC5

RC5 at commit `558881d` carries the following accepted features, in commit order:

### Phase 1A — Vault Foundation and Safe Ingestion

| Commits | Description |
|---------|-------------|
| `d024efa` | Phase 1A — vault foundation, Gate 0 filesystem safety, Gate 1 schema validation, candidate-store |
| `df13d85` | Phase 1A acceptance audit corrections |
| `fced3b9` | Phase 1A.1 — handle-based copy with adversarial TOCTOU tests |
| `ec39529` | Docs: Phase 1B payload boundary rule to Gate 2 |
| `3d61e70` | Phase 1A.2 — bounded chunk copy enforces size limits during transfer |

### Skill Lifecycle — Stage 1 (Trust Foundation)

| Commit | Description |
|--------|-------------|
| `04dcd6c` | Stage 1 — skill-lifecycle.ts state machine, skill-envelope.ts prompt envelope, 28 tests, SHA-256 content-hash binding, mandatory SKILL_AUTHORITY_DISCLAIMER |

**Stage 1 test baseline at commit**: 730 passing, 0 failing (three consecutive clean runs)
**Stage 1 verdict**: `A — SKILL_LIFECYCLE_STAGE_1_TRUST_FOUNDATION_COMMITTED_AND_BASELINED`
**Stage 1 closure record**: `docs/architecture/SKILL_LIFECYCLE_STAGE_1_CLOSURE_RECORD.md`

### Verification Diagnostics Repair

| Commit | Description |
|--------|-------------|
| `9873065` | fix(review): derive final verdict from VERIFICATION_REPORT.md, not sessionSummary.passed — 18 new regression tests |

### Skill Lifecycle — Stage 2A (Synthetic Promoted-Guidance Pilot)

| Commit | Description |
|--------|-------------|
| `06781cb` | Stage 2A — runSyntheticPromotedGuidancePilot, pre-invocation check chain (steps 1–8), collect-then-validate batch atomicity, synthetic budget enforcement, 35 tests |

**Stage 2A test baseline at commit**: 783 passing, 0 failing
**Stage 2A evidence**: commit message `06781cb` (no standalone closure-record file — this is the documentation gap addressed by RC6)

### Skill Lifecycle — Stage 2B (Sanitized Project Invocation)

| Commit | Description |
|--------|-------------|
| `349fcd7` | Stage 2B — run-skill-guided-sanitized-project-pilot.ts, two-phase fail-closed audit provenance, 24 tests (T1–T24) |

**Stage 2B test baseline at commit**: 807 passing, 0 failing (three consecutive clean runs)
**Stage 2B verdict**: `A — SKILL_LIFECYCLE_STAGE_2B_SANITIZED_INVOCATION_COMMITTED_AND_BASELINED`
**Stage 2B closure record**: `SKILL_LIFECYCLE_STAGE_2B_CLOSURE_RECORD.md` (committed at root)

### Terminal Outcome and Patch-Eligibility Unification

| Commit | Description |
|--------|-------------|
| `558881d` | fix(terminal-outcome): evaluate-terminal-outcome.ts (pure), extract-check-diagnostics.ts, full conjunction eligibility gate, 38 regression tests |

**RC5 integrated test total (frozen verification)**: 838 passing, 49 files, 0 failures

---

## 3. Stage-by-Stage Acceptance Evidence

| Stage | Verdict | Evidence |
|-------|---------|----------|
| Phase 1A | Accepted | Committed; `SKILL_LIFECYCLE_STAGE_1_CLOSURE_RECORD.md` §2–§3; tests 637→702 |
| Stage 1 | `A — SKILL_LIFECYCLE_STAGE_1_TRUST_FOUNDATION_COMMITTED_AND_BASELINED` | `SKILL_LIFECYCLE_STAGE_1_CLOSURE_RECORD.md`; commit `04dcd6c`; 730 tests × 3 clean runs |
| Verification Diagnostics | Accepted | Commit `9873065`; 18 regression tests; `sessionSummary.passed` bug corrected |
| Stage 2A | Accepted | Commit `06781cb`; 35 tests (748→783); typecheck clean; no standalone closure-record file (gap closed in RC6) |
| Stage 2B | `A — SKILL_LIFECYCLE_STAGE_2B_SANITIZED_INVOCATION_COMMITTED_AND_BASELINED` | `SKILL_LIFECYCLE_STAGE_2B_CLOSURE_RECORD.md`; commit `349fcd7`; 807 tests × 3 clean runs |
| Terminal Outcome | Accepted | Commit `558881d`; 838 tests; typecheck clean; `evaluate-terminal-outcome.ts` pure conjunction |

---

## 4. Audit Findings

### Finding 1 — Incomplete original description

RC5 was tagged with a lightweight tag whose effective description is the commit subject line: "fix(terminal-outcome): unify terminal run outcome and patch eligibility reporting." This names the final commit only. The full scope — Phase 1A, Stage 1, Stage 2A, Stage 2B, and verification diagnostics — is not named.

**Severity**: Documentation defect. The code and tests are accurate; only the description is incomplete.

### Finding 2 — Stale runtime-source typecheck exclusions

At RC5, `tsconfig.json` excludes two runtime-source files:

```json
"src/skills/skill-lifecycle.ts",
"src/skills/skill-envelope.ts"
```

These files were originally excluded during Phase 1A.2 (`3d61e70`) when skill-lifecycle.ts was still untracked and not yet part of the compilation baseline. By Stage 1 (`04dcd6c`), both files were committed and transitively included in typecheck via session runners that import them. The exclusions became stale and redundant but were never removed. Typecheck passes cleanly with and without these exclusions because the files are already reachable via included sources.

**Severity**: Hygiene debt. Explicit exclusions of runtime sources create misleading posture (the compiler appears not to typecheck them; it actually does transitively). RC6 removes these exclusions.

### Finding 3 — Stage 2A lacks standalone closure-record file

Stage 2A acceptance evidence exists entirely in commit message `06781cb`. There is no `SKILL_LIFECYCLE_STAGE_2A_CLOSURE_RECORD.md` file comparable to the Stage 1 record. RC6 adds this closure record.

**Severity**: Documentation gap. Functional and test evidence exists; only the structured record is missing.

### Finding 4 — Untracked Stage 2B session artifacts not in RC5

The following files were present untracked in the working tree at tag time but are **not in the RC5 tree**:

```
SKILL_LIFECYCLE_STAGE_2B_SANITIZED_PROJECT_INVOCATION_PLAN.md
SKILL_LIFECYCLE_STAGE_2B_TRUSTED_TERMINAL_EVIDENCE_AMENDMENT.md
```

Confirmed by `git ls-tree -r powerplant-cli-v0.1.4-rc5 --name-only` at verification time. These are session-working-documents, not release provenance. They are not included in RC6.

**Severity**: Not a defect. Untracked files are not part of the tag.

---

## 5. RC5 Frozen Verification Results

Verified from a clean detached worktree at `558881d` with no local changes:

| Check | Result |
|-------|--------|
| `git status --short` | Empty (clean tree) |
| `npm test` | 838 passed, 49 files, 0 failures, exit 0 |
| `npm run typecheck` (`tsc --noEmit`) | No output, exit 0 |
| `npm run build` (`tsc --noEmit`) | No output, exit 0 |
| Untracked Stage 2B planning files in RC5 tree | Not present |

---

## 6. Disposition

**RC5 is valid.** There is no evidence of contamination by unaccepted code, test regression, or typecheck failure.

**RC5 is scope-expanded relative to its description.** It carries six accepted feature layers; its effective description names only the last.

**RC5 is frozen.** This addendum documents the defect externally. The tag `powerplant-cli-v0.1.4-rc5` must not be moved, rewritten, or recreated.

**RC6 is the forward QA candidate.** RC6 applies the bounded hygiene changes described above (Stage 2A closure record, stale exclusion removal) and carries the same functional content as RC5 plus those documentation additions. Singularity deterministic replay must use RC6.

| Question | Answer |
|----------|--------|
| Is RC5 contaminated by unaccepted code? | **No evidence of contamination** |
| Is RC5's stated scope accurate? | **No — materially incomplete** |
| Should RC5 be rewritten or retagged? | **No — freeze and document** |
| May RC5 be used as the forward QA candidate after cleanup changes? | **No — cleanup creates RC6** |
| Is RC6 preparation authorized? | **Yes** |

---

## 7. Post-RC6 Correction — Stage 2B Status Amendment

> **Added**: 2026-05-29 on `feat/rc6b-provenance-correction`

Section 3 of this addendum records Stage 2B with verdict
`A — SKILL_LIFECYCLE_STAGE_2B_SANITIZED_INVOCATION_COMMITTED_AND_BASELINED`.
That verdict is accurate for what the original closure record proved: code committed,
24 unit tests passing, typecheck clean.

**It does not mean Stage 2B was accepted for live trusted invocation.**

A subsequent audit found that the RC6A annotation drew an unwarranted inference from
this verdict, and identified five code-level defects in the committed Stage 2B
implementation that were not captured by the unit test suite. Stage 2B is therefore:

```
COMMITTED AND UNIT-TESTED — NOT ACCEPTED FOR TRUSTED LIVE INVOCATION
```

Full defect descriptions, RC6A disposition, and the required repair path are in:

- `docs/architecture/RC6A_REPLAY_STOP_AND_SCOPE_CORRECTION.md`
- `docs/architecture/SKILL_LIFECYCLE_STAGE_2B_CLOSURE_SUPERSESSION.md`

The original closure record (`SKILL_LIFECYCLE_STAGE_2B_CLOSURE_RECORD.md`) is preserved
unchanged. This addendum section and the documents above constitute the correction record.
