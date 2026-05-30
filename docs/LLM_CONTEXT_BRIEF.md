# LLM Context Brief — Claude Powerplant
_Generated 2026-05-30. Re-run `python scripts/project_snapshot.py --write` after major state changes._

---

## What is this repo?

Trust-bounded skill lifecycle and acceptance harness. Runs Claude against a **sanitized copy**
of a project. Claude gets only 5 typed custom tools — no bash, no browser, no file I/O outside
the allowlist. Original project is never modified. Output: `PATCH.diff` + evidence bundle.
Human reviews and decides whether to apply.

```
powerplant inspect <project-path>        # show what Claude can see — no API call
powerplant run [--yes] <path> "<task>"   # run in sanitized workspace
powerplant review <run-id>               # examine evidence bundle
```

---

## Completed stages

> Stage 2B L1 completed one bounded live acceptance run under a documented trusted-directory assumption.

Supporting evidence:

- One production L1 live invocation was executed; no retry occurred
- L0-generated receipt and isolated promoted registry remained consistent during the operator-controlled bootstrap-to-L1 handoff
- Strict temporal ordering evidence passed
- `builtinToolUseCount === 0` was observed for the live run
- Candidate work remained in a sanitized workspace
- Real-project manifest evidence remained unchanged
- Oracle evaluation ran in a network-isolated, read-only Docker capsule and passed its required vectors
- Sanitized acceptance evidence is recorded in `docs/acceptance/STAGE_2B_L1_LIVE_ACCEPTANCE_REPORT.md`

> This acceptance does not claim cryptographic resistance to pre-run receipt-and-registry co-substitution by an actor with write access to the operator-controlled acceptance directory.

Stage 2C harness: typed tool mediation, symlink-safe boundaries, oracle isolation.
Sprint 4A: sanitized external pilot project adapter (generated harmless pilot only).
Step 0 (detect-stack.ts): merged to master.
Feature 3 (Review TUI): committed on feat/road-to-usable-step3-review-tui — pending merge.

---

## Current state / gap

The safety substrate is solid:
- `powerplant run` produces a patch + evidence bundle with manifest hashes
- Stage 2C harness enforces typed tool mediation, symlink-safe boundaries, oracle isolation
- `powerplant review` surfaces artifacts; `doctor` shows runtime state
- One verification profile exists: `node-vitest-typescript-v1`

The gap: **the safe path is not yet the fast path.** A developer targeting a new project must
hand-author YAML, has no guided way to merge a patch, no ergonomic review surface, no way to
chain follow-up tasks, and Python/Go projects have no capsule.

---

## Next intended step

Step 0 (detect-stack.ts) is merged. Feature 3 (Review TUI) is on branch, pending merge.
**After merge: Feature 1 — `powerplant init` wizard** (see `docs/ROAD_TO_USABLE.md`).

```
powerplant init [project-path]     # defaults to cwd
powerplant init --yes              # non-interactive, accept all defaults
powerplant init --stack python     # override detected stack
```

Build order: `generate-policy.ts` + `generate-verify.ts` →
`src/cli/commands/init.ts` → wire `case 'init':` in `src/cli/powerplant.ts`.

---

## Files that matter first

| Path | Purpose |
|---|---|
| `src/cli/powerplant.ts` | CLI entry, command dispatch |
| `src/projects/build-sanitized-workspace.ts` | Core sanitizer — allowlist-only copy |
| `src/projects/detect-stack.ts` | Stack detection — already merged |
| `src/verification/verification-profiles.ts` | Profiles table |
| `src/contracts/` | All Zod schemas — ground truth |
| `docs/ROAD_TO_USABLE.md` | Implementation plan, build order |
| `docs/architecture/Stage 2B Completion and GitHub Release Ledger.md` | Canonical stage-status authority |
| `tests/*.live.test.ts` | Require `SPRINT4A_PILOT_SOURCE_PATH`; skipped in `npm test` |

---

## DO NOT TOUCH

- `clearedForRealProjectMounting: false` — invariant since Sprint 3R
- `clearedForSanitizedExternalProjectInput: false` — invariant since Sprint 4A
- `always_ask` cannot gate pre-execution for in-process bash workers — Anomaly F, Sprint 3T

Additional permanent invariants (from `docs/SECURITY_BOUNDARY.md`):

- `build-sanitized-workspace.ts` allowlist-only copy + symlink rejection + traversal rejection — core boundary
- `buildIsolationProofReport()` clearance booleans are hardcoded `as const`; must never be runtime-settable
- Custom tool broker 10-rule set (Sprint 3V) — permanent; explicit ADR required to relax any rule
- `.powerplant/state/` — runtime only, gitignored; never commit
- `.env` — credentials; never commit

**`always_ask` does NOT gate pre-execution for self-hosted workers (Anomaly F).
The sanitized workspace is the real protection, not the permission layer.**

---

## Health check

```bash
npm test          # must pass all 1042
npx tsc --noEmit  # must be clean
```

Both must pass before claiming the repo is healthy. Live tests (`*.live.test.ts`) are skipped
unless `SPRINT4A_PILOT_SOURCE_PATH` is set — see `.env.example`.
