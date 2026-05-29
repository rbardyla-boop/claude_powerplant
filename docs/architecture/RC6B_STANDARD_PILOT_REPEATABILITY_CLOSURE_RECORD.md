# RC6B Standard-Pilot Repeatability Closure Record

**Final verdict:** `STANDARD_PILOT_VERIFICATION_REPEATABLE_PATCH_NONDETERMINISTIC`

---

## 1. RC6B-QA Tag Identity

| Field                  | Value                                                                          |
| ---------------------- | ------------------------------------------------------------------------------ |
| Tag name               | `powerplant-cli-v0.1.5-rc6b-qa`                                                |
| Tag type               | Annotated                                                                      |
| Resolved commit        | `f24acd2dabf56fc11223356445de8e26b52792b6`                                     |
| Commit subject         | `docs(rc6b): provenance correction — RC6A replay stop and Stage 2B scope clarification` |
| Test baseline at tag   | 864 passing, 50 files, 0 failures                                              |
| TypeScript check       | `tsc --noEmit` exit 0                                                          |
| Boundary invariants    | 26/26 (`tests/stage2b-boundary-invariant.test.ts`)                             |

The RC6B-QA tag was authored as a provenance-corrected continuation of RC6A.
Its tagger note explicitly names the Stage 2B code as dormant, incomplete, and
not accepted for live invocation — five blocking defects documented in
`docs/architecture/RC6A_REPLAY_STOP_AND_SCOPE_CORRECTION.md`.

---

## 2. Narrow Scope of This Claim

This record proves:

> **Standard synthetic-pilot terminal-outcome and verification repeatability under RC6B-QA.**

It does **not** prove, claim, or imply:

- Singularity real-project replay or determinism
- Real-project mounting readiness (`clearedForRealProjectMounting = false` in both runs)
- Stage 2B skill-guided execution correctness or acceptance
- Correctness of any Singularity Vitest workflow
- Patch-level determinism (patches differ between runs — expected and documented)

The replay targeted the **synthetic** `powerplant_pilot_status` project, not
the Singularity repository. Both runs report:

```
clearedForRealProjectMounting = false
```

The standard pilot passed its own permitted claim while remaining explicitly
uncleared for real-project mounting.

---

## 3. Worktree State at Tag

The Powerplant tracked tree was clean at the RC6B-QA tag.
The working tree contained two untracked Stage 2B planning documents
(`SKILL_LIFECYCLE_STAGE_2B_SANITIZED_PROJECT_INVOCATION_PLAN.md` and
`SKILL_LIFECYCLE_STAGE_2B_TRUSTED_TERMINAL_EVIDENCE_AMENDMENT.md`)
that were outside the committed RC6B-QA tag and outside the executed
standard-pilot path. Their presence does not affect the replay.

A clean worktree strictly means: **tracked tree clean; untracked Stage 2B
planning documents existed outside the committed tag and replay path.**

---

## 4. Complete Sanitized Baseline Manifest

Both runs were seeded from the same sanitized baseline snapshot.
The following table covers all regular files in both retained baseline
directories.

**Run A baseline:** `/tmp/powerplant-sprint4a/sprint4a-1780042520458/baseline`  
**Run B baseline:** `/tmp/powerplant-sprint4a/sprint4a-1780042697182/baseline`

| Relative path              | Size (B) | Run A SHA-256                                                      | Run B SHA-256                                                      | Match |
| -------------------------- | -------: | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ----- |
| `.powerplant/POLICY.yaml`  |      672 | `e6f3575e6861ee7e9b716970a964a5c6739cf306d3f550ef4223384cf3798fc3` | `e6f3575e6861ee7e9b716970a964a5c6739cf306d3f550ef4223384cf3798fc3` | ✓     |
| `.powerplant/PROJECT.md`   |     1016 | `ac584ccb8754563787115c8e0309d21e465668923744b62a0708886dc3708ccf` | `ac584ccb8754563787115c8e0309d21e465668923744b62a0708886dc3708ccf` | ✓     |
| `.powerplant/QUALITY.md`   |      682 | `c281bf31d970e30731ffc09694d6cefe8e6e01faa72c3614feb4571ebeee455d` | `c281bf31d970e30731ffc09694d6cefe8e6e01faa72c3614feb4571ebeee455d` | ✓     |
| `.powerplant/VERIFY.yaml`  |       43 | `ab5617e2eb3e541fa5012f6961e0e9c6174599aa9b05a29f96e07dad0d20e8e4` | `ab5617e2eb3e541fa5012f6961e0e9c6174599aa9b05a29f96e07dad0d20e8e4` | ✓     |
| `package.json`             |      147 | `e89a5e479be4b162f1075a4107f0d64aace1ec7b2a6ba2893e3e0900489e84bf` | `e89a5e479be4b162f1075a4107f0d64aace1ec7b2a6ba2893e3e0900489e84bf` | ✓     |
| `README.md`                |      997 | `0b53eda2f18654ee0c832c5591a2c0af46e56b925c6995d134368f8bc8b51770` | `0b53eda2f18654ee0c832c5591a2c0af46e56b925c6995d134368f8bc8b51770` | ✓     |
| `src/status.js`            |      286 | `6737363a0faaf2b0063251cb03f289a2dd6921307036dbb7068b221d7032929c` | `6737363a0faaf2b0063251cb03f289a2dd6921307036dbb7068b221d7032929c` | ✓     |
| `tests/status.test.js`     |      439 | `549e45f2562aacc19b30102bce6cb5011736d5d4d679d0d7cf00fb1812dc9240` | `549e45f2562aacc19b30102bce6cb5011736d5d4d679d0d7cf00fb1812dc9240` | ✓     |

**All 8 files match.** No `.powerplant/**` files beyond the four above were
present in either snapshot.

### Canonical Manifest Hash

Computed from sorted `relative_path sha256` entries piped through `sha256sum`:

| Run   | Canonical manifest hash                                              |
| ----- | -------------------------------------------------------------------- |
| Run A | `9a85aeb98c302260864a5c8c80b313d88809394367997aaf79e25b21a404b21a`  |
| Run B | `9a85aeb98c302260864a5c8c80b313d88809394367997aaf79e25b21a404b21a`  |

**Manifest hashes are identical. Starting-state identity is proven.**

---

## 5. Run Evidence

### Common to Both Runs

| Property                         | Value                                          |
| -------------------------------- | ---------------------------------------------- |
| Agent                            | Standard non-skill-guided pilot                |
| Task                             | Sanitized `powerplant_pilot_status` project    |
| Stage 2B in execution path       | No (excluded by boundary invariants 26/26)     |
| Skill registry lookup            | None                                           |
| Skill invocation                 | None                                           |
| Test runner                      | `node --test`                                  |
| Tests discovered                 | 16                                             |
| Tests passed                     | 16                                             |
| Post-write check verdict         | Pass                                           |
| Finalize result                  | Success                                        |
| Terminal outcome                 | Match                                          |
| Patch eligibility                | Match                                          |
| `clearedForRealProjectMounting`  | `false`                                        |

### Produced Patch Hashes (differ — expected)

| Run   | `src/status.js` SHA-256                                              | `tests/status.test.js` SHA-256                                       |
| ----- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Run A | `951e88afb968e9da2b516ef97bbaadd625bafec6a13e578e3f3e8d9f4a569323`  | `41fa7d259c21e6ac02248e6df7368574b6948fe7eac3902fecb144c4e9da99c2`   |
| Run B | `a31c0e742492248ce448959020cee7443a6a8d17e124e1e3d8234b740f0647a2`  | `e6dce271e75a58bf1c26cadcd2b9b39e1136e004a3ebeee50154e642687d6d22`   |

Both patches satisfy the verification contract (16/16 tests pass) while
containing different but equivalent implementations of `healthLabel` and
`summarizeChecks`. Patch nondeterminism is confirmed and expected.

---

## 6. Verification Profile Name Clarification

Both runs report verification profile `node-vitest-typescript-v1`.
The profile name is misleading: this synthetic pilot genuinely executes
`node --test` with 16 discovered tests, not the Vitest runner implied by the
name.

The test evidence in this replay is authentic `node --test` execution.
It is **not** evidence that the Singularity Vitest profile executed
successfully. A later cleanup may rename or split the profile to remove the
semantic ambiguity.

---

## 7. Stage 2B Exclusion

Stage 2B skill-guided code is committed in the RC6B-QA tree but is not
accepted and was not in the execution path of either replay run. The
26/26 boundary invariant suite
(`tests/stage2b-boundary-invariant.test.ts`) confirms this exclusion.

Five blocking defects that prevent Stage 2B acceptance are documented in
`docs/architecture/RC6A_REPLAY_STOP_AND_SCOPE_CORRECTION.md`. Stage 2B
remains unaccepted and outside the scope of this closure record.

---

## 8. Accepted Evidence Summary

| Evidence area                                                              | Verdict       |
| -------------------------------------------------------------------------- | ------------- |
| RC6B-QA tag resolves to the intended provenance-corrected commit           | **Accepted**  |
| Boundary invariant suite passes 26/26                                      | **Accepted**  |
| Stage 2B code absent from both runtime executions                          | **Accepted**  |
| No skill registry lookup or skill invocation in either run                 | **Accepted**  |
| Genuine non-zero test execution (16 `node --test` tests) in both runs      | **Accepted**  |
| Post-write check validity and finalize success match across runs           | **Accepted**  |
| Terminal outcome and patch-eligibility results match across runs           | **Accepted**  |
| Patch hashes differ between runs                                           | **Accepted**  |
| All 8 sanitized baseline files match; canonical manifest hash identical    | **Accepted**  |
| Patch nondeterminism compatible with repeatable integrity outcomes         | **Accepted**  |

---

## 9. Final Verdict

`STANDARD_PILOT_VERIFICATION_REPEATABLE_PATCH_NONDETERMINISTIC`

The complete sanitized starting snapshot was identical across Run A and Run B.
The terminal-outcome and verification-bearing results were repeatable.
The produced patches differ, confirming model-level nondeterminism in patch
generation is decoupled from verification outcome repeatability.

This evidence supports the RC6B-QA standard-pilot claim as stated. It does not
extend to Singularity real-project readiness, Stage 2B acceptance, or any
claim not explicitly listed in Section 8 above.
