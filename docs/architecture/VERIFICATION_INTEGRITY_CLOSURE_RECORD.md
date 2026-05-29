# Verification Integrity Closure Record

**Verdict**: `VERIFICATION_INTEGRITY_REPAIR_OPERATIONALLY_PROVEN`
**Date**: 2026-05-28
**Branch**: Powerplant / Singularity control-plane

---

## 1. Accepted Verdict

```
VERIFICATION_INTEGRITY_REPAIR_OPERATIONALLY_PROVEN
```

This is a Powerplant / Singularity control-plane record.
It must not be written into SCP simulator records.

---

## 2. Repair Commit

**Commit**: `0d938ae` — `fix(verification): close false-positive verification path in broker`

Files changed by the repair:

| File | Change |
|------|--------|
| `src/broker/project-tool-broker.ts` | Switch from `runProjectTestExecutor` to `runCapsuleProjectChecks`; add `checksValidAfterLastWrite` state gate; finalize requires fresh passing checks |
| `src/verification/classify-check-result.ts` | Add `checkKind` param; exit-0 + zero-discovered-tests → `FAIL_VERIFICATION_INTEGRITY` |
| `src/verification/run-approved-checks.ts` | Aligned to `runCapsuleChecks` shared execution path |
| `src/verification/run-capsule-checks.ts` | `inferCheckKind` added; `checkKind` passed to `classifyCheckResult` |
| `src/projects/generate-patch-package.ts` | `PilotVerification` replaced by `CheckResult[]`; patch eligibility requires every `verdict === 'PASS'` |
| `src/sessions/run-sanitized-project-pilot.ts` | Aligned to new `CheckResult[]` output |
| `tests/verification-integrity.test.ts` | New file: 16 tests covering all new invariants |
| `tests/patch-package.test.ts` | Updated to `CheckResult[]` interface |
| `tests/prompt-envelope.test.ts` | Updated to `CheckResult[]` interface |
| `docs/architecture/POWERPLANT_SKILL_REACTOR_PLAN.md` | Added (planning only; no source changes) |

---

## 3. External Reference Points

| Reference | Value |
|-----------|-------|
| Powerplant repair commit | `0d938ae` |
| Sanitized external project last clean commit | `9fcb87a` (external project; not in this repo) |
| Known false-positive run ID | `pp-run-1779984990835` |

---

## 4. False-Positive Evidence — Historical Run

**Run**: `pp-run-1779984990835`

| Evidence | Detail |
|----------|--------|
| Old test command | `node --test` |
| Output | `# tests 0`, `# pass 0` |
| Exit code | `0` |
| Old broker behavior | Accepted exit code 0 as PASS regardless of test count |
| False-positive result | PASSED — incorrect; no tests were actually executed |
| Root cause | `runProjectTestExecutor` (old path) had no zero-test guard |

The old broker called `runProjectTestExecutor` which accepted exit 0 with 0 discovered tests
as a passing result, producing silent false-greens. This path is now replaced by
`runCapsuleProjectChecks` which feeds through `classifyCheckResult` with `checkKind='test'`.
`classifyTestCheckIntegrity` now matches any output containing `# tests 0`, `No test files found`,
or `0 tests` and returns `FAIL_VERIFICATION_INTEGRITY`.

---

## 5. Live Run 1 Evidence

| Evidence | Detail |
|----------|--------|
| Test command | `npm test` via `runCapsuleProjectChecks` capsule path |
| Test failures | Real failing tests returned `FAIL_CHECK` from broker |
| Typecheck | Passed |
| Finalize reached | **No** |
| Reason finalize not reached | Agent exhausted tool-call budget while producing invalid test writes |
| Classification | **Agent-capacity / task-execution failure** — not a verification-gate failure |

The verification gates behaved correctly in Run 1. The agent's inability to complete
within its budget is a separate concern from verification correctness. These must not
be conflated. Gate behavior: ✓ Correct. Agent behavior: ✗ Budget exhausted.

---

## 6. Live Run 2 Evidence

**Run**: `pp-run-1779987413264`

| Evidence | Detail |
|----------|--------|
| Test command | `npm test` through capsule path |
| Test framework | Vitest v2.1.9 |
| External project tests executed | **25 passing** (11 + 14 across 2 test files) |
| Typecheck | Passed |
| `project_write_file` calls | **0** — task found no regressions needing new tests |
| `project_finalize` reached | Yes — accepted after passing checks |
| `clearedForSanitizedExternalProjectInput` | `true` |
| `sourceUnmodified` | `true` |
| `executorNetworkDisabled` | `true` |
| `noCredentialsPassedToExecutor` | `true` |

Run 2 demonstrates a legitimate no-change-needed result: the agent ran `project_run_check`
(test + typecheck), both passed, and `project_finalize` was accepted. No writes were made,
so this run does not prove the write → check → finalize → eligible-patch sequence.

The no-change path confirms: capsule executes `npm test` → Vitest discovers 25 tests →
`FAIL_VERIFICATION_INTEGRITY` cannot fire (tests > 0) → PASS verdict → finalize accepted.

---

## 7. Test Count Baseline

**Important: keep these counts distinct.**

| Surface | Count | Meaning |
|---------|-------|---------|
| Powerplant internal regression suite | **637 passing** | Verified locally via `npm test` after repair commit |
| External capsule-run project tests | **25 passing** | Live sanitized-project verification evidence from Run 2 |

**Note on the reported 653 figure**: The evidence cited "637 previous tests plus 16 new
verification-integrity tests = 653." The current verified local count is **637**, which
already includes the 16 new verification-integrity tests (added by commit `0d938ae`).
The pre-repair count was 637 − 16 = **621**. The 653 figure may reflect a prior state
or counting methodology that could not be reproduced locally. The authoritative current
count is **637** (confirmed by `npm test`).

The 16 new tests are in `tests/verification-integrity.test.ts` and are included in 637.

---

## 8. Repaired Verification Boundary — Frozen Invariants

The following invariants are now protected by the repair and must not be weakened
by any future feature, including `feat/skill-lifecycle`:

1. **Zero-test false-positive blocked**: Exit code 0 with zero discovered tests returns
   `FAIL_VERIFICATION_INTEGRITY` when `checkKind === 'test'`. This cannot be bypassed
   by structuring a check to avoid the `test` check kind if the check actually runs tests.

2. **Write invalidates check evidence**: Any call to `project_write_file` sets
   `checksValidAfterLastWrite = false`. This resets on PASS only after a fresh check run.

3. **Finalize requires fresh valid checks**: `project_finalize` is rejected if
   `checksValidAfterLastWrite` is false. The broker enforces this; the agent cannot
   bypass it.

4. **Required checks are policy-controlled**: The set of allowed checks comes from
   `VERIFY.yaml` in the project contract. The agent may only call declared check IDs.
   Skills, agents, hooks, or future features must not replace required verification
   commands with weaker substitutes without an explicit policy-approved change.

5. **Skills must not bypass check gates**: A skill-triggered project write must
   invalidate verification evidence exactly like any other write. A skill cannot
   directly set `checksValidAfterLastWrite`, finalize eligibility, capsule isolation
   flags, credential isolation flags, or network-isolation flags.

6. **Capsule isolation flags are not agent-visible**: `clearedForSanitizedExternalProjectInput`,
   `executorNetworkDisabled`, `noCredentialsPassedToExecutor`, and `sourceUnmodified`
   are set by Powerplant infrastructure, not by the agent or any skill it triggers.

---

## 9. Deferred Acceptance Requirement

The following live proof remains outstanding and is required before enabling
`powerplant run --skills active` or claiming verified post-write patch generation
is fully operationally proven:

> A live successful sequence of `project_write_file` → `project_run_check` PASS
> after the final write → `project_finalize` PASS → eligible patch has not yet
> been observed in a live run.

Run 2 had zero writes and cannot satisfy this requirement. Record this as
**WRITE_CHECK_FINALIZE_PATCH_PROOF_DEFERRED** until a live run demonstrates it.

---

## 10. Authorization Status

| Gate | Status |
|------|--------|
| Repair committed (`0d938ae`) | ✓ |
| Plan amended (`0ec8ebb`) with Gate 0 corrections | ✓ |
| Architecture accepted | ✓ |
| `feat/skill-lifecycle` creation | ✓ Authorized |
| Phase 1A (vault + safe ingestion) implementation | ✓ Authorized |
| `powerplant run --skills active` | Blocked pending `WRITE_CHECK_FINALIZE_PATCH_PROOF_DEFERRED` resolution |

See `POWERPLANT_SKILL_REACTOR_PLAN.md` for the architecture plan.
