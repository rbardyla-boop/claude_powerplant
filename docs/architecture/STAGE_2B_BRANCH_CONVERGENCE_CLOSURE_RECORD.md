# Stage 2B Branch Convergence — Canonicalization Receipt

**Document class:** Branch audit closure record  
**Date:** 2026-05-29  
**Canonical branch:** `feat/stage2b-preflight`  
**Canonical HEAD at audit time:** `063d254`

---

## Audit Finding

A forensic branch audit was conducted after apparent drift between
`feat/skill-lifecycle-stage2b` (RC5) and `feat/stage2b-preflight`.

**Result: no divergence existed.**

`feat/skill-lifecycle-stage2b` (HEAD `558881d`, tagged `powerplant-cli-v0.1.4-rc5`)
is a **direct linear ancestor** of `feat/stage2b-preflight`. The merge-base is
`558881d` itself. Zero commits are unique to the old branch.

The linear chain from RC5 to canonical HEAD:

| Commit | Description |
|---|---|
| `558881d` | fix(terminal-outcome): unify terminal run outcome — RC5 tag |
| `c260a99` | docs(rc6): remove stale `tsconfig.json` exclusions — RC6 tag |
| `f24acd2` | docs(rc6b): provenance correction — RC6B-QA tag |
| `28b649d` | docs(rc6b): standard-pilot repeatability closure |
| `3db7b51` | fix(stage2b): repair four code-level blockers |
| `db7e8f7` | docs(stage2b): live-acceptance plan corrections |
| `a8958e6` | docs(stage2b): immutable oracle and tool-confinement gates |
| `e7434c6` | docs(stage2b): oracle execution isolation gate, P0-A/B/C structure |
| `92a2f50` | feat(stage2b-preflight): implement P0-A/B/C preflight gates |
| `c9aa2d3` | feat(stage2b-p0d): capsule-v1 evaluator, close P0-C blockers |
| `006274d` | docs(trust-kernel): Trust Kernel v0.2 roadmap |
| `063d254` | feat(stage2b-p0e): close trust-root and result-integrity blockers |

---

## RC5 tsconfig Contamination — Resolved

RC5 (`558881d`) contained `tsconfig.json` exclusions that masked three files
from typecheck:

- `src/skills/skill-lifecycle.ts`
- `src/skills/skill-envelope.ts`
- `tests/skill-lifecycle.test.ts`

These exclusions were removed at `c260a99` ("docs(rc6): remove stale tsconfig
exclusions"). The current `tsconfig.json` excludes only `node_modules` and
`dist`. No transplant or correction is needed.

---

## Terminal-Evidence Behavior — Verified Present

`evaluateTerminalRunOutcome()` and its regression test suite
(`tests/terminal-outcome.test.ts`) were introduced at RC5 and are present
unmodified on the canonical branch. No transplant was required.

---

## Stale Pre-Implementation Documents — Preserved Outside Repo

Two untracked Markdown files were found in the working tree at the time of
audit. They predated implementation and contained statements that directly
contradicted the closure record ("implementation not yet started").
They were not committed.

| File | SHA-256 | Preservation Path |
|---|---|---|
| `SKILL_LIFECYCLE_STAGE_2B_SANITIZED_PROJECT_INVOCATION_PLAN.md` | `454675d1b8cd5c978136a64e169a1c3c18b4a0ca50438388459431998db3529c` | `../stage2b-superseded-untracked-archive/` |
| `SKILL_LIFECYCLE_STAGE_2B_TRUSTED_TERMINAL_EVIDENCE_AMENDMENT.md` | `1dcd286e10b5709cb086362aa1f1118bdf2dc05c1ae9495c8a40e006e0f2d73c` | `../stage2b-superseded-untracked-archive/` |

---

## Verified Baseline at Canonical HEAD

| Check | Result |
|---|---|
| `npm test` | 968 / 968 passing |
| `tsc --noEmit` | clean (exit 0) |
| Worktree state | clean |

---

## Authorization

**L0 is the only next authorized step.** No other gates, branches, merges,
live sessions, registry operations, or promotions are authorized.
