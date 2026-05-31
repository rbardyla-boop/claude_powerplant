# Dogfood Coverage Ledger

Evidence spine for [ROAD_TO_USABLE.md](./ROAD_TO_USABLE.md). Each row is a real repo class that
Powerplant has been run against, the risk mode it exercises, the defects it surfaced, and the
release that fixed them. A class is "covered" only when a sanitized run reached a recorded verdict
on a representative repo.

Two risk modes are tracked:

- **Mechanical** — the failure mode is broken code, leaked secrets, or polluted snapshots.
- **Epistemic** — the failure mode is claim contamination: an agent turning excluded outputs,
  draft results, or script-derived numbers into stronger claims than the source supports.

---

## Coverage matrix

| Repo class | Risk mode | Representative repo | Status | First proven |
|------------|-----------|---------------------|--------|--------------|
| Python trading bot | Mechanical | poly (hyperliquid/polymarket) | ✅ Covered | baseline |
| Python simulator / LLM test-bench | Mechanical | pipeline (UEE) | ✅ Covered | v0.2.3–v0.2.5 |
| Rust crypto workspace | Mechanical | scp | ✅ Covered | v0.2.5 |
| Static frontend / PWA | Mechanical | (baseline class) | ✅ Covered | baseline |
| Static game subtree | Mechanical | (baseline class) | ✅ Covered | baseline |
| Tauri / Vite / Rust hybrid (trading artifacts) | Mechanical | crypto-alpha-warroom | ✅ Covered | v0.2.9 → v0.2.10 |
| Tauri / Vite / Rust hybrid (Steam game) | Mechanical | sinularity | ✅ Covered | v0.2.10 |
| ML / research pipeline (result-ledger boundary) | Epistemic | pipeline (NN research) | ✅ Covered | v0.2.9 |
| Research manuscript (no-claims boundary) | Epistemic | lcb_paper2 | ✅ Covered | v0.2.10 |

"baseline" = established before this ledger existed; representative repo recorded where a run ID is
on file, otherwise marked as a baseline class without a fabricated run reference.

---

## Defect ledger

Defects surfaced by dogfooding, and the release that fixed each. All releases dated 2026-05-30
except v0.2.10 (2026-05-31).

| Defect class | Surfaced by | Fix | Release |
|--------------|-------------|-----|---------|
| Exclude-path globs not honored for some sources | early dogfood | exclude-paths fix | v0.2.3 |
| Working-tree isolation / whitespace / new-file labels; SOURCE_MANIFEST excludes; Rust init template | scp Rust workspace | 10 patches | v0.2.5 |
| Review classified a finalize-failed run as success | review dogfood | finalize success classification fix | v0.2.7 |
| `project_finalize` accepted before all required checks passed | broker dogfood | require all required checks to pass before finalize | v0.2.8 |
| Diff file count missed net-new file hunks (`+++ b/` vs `--- a/`) | review dogfood | count new-file hunks in diff file count | v0.2.9 |
| CLI printed `PATCH.diff` / `VERIFICATION_REPORT.md` paths on incomplete runs where no patch package exists | crypto-alpha-warroom | gate artifact paths on `patchArtifactsWritten`; incomplete runs point to `RUN_CLASSIFICATION.json` | v0.2.10 |

The v0.2.10 fix is verified live: the lcb_paper2 first run (a real `FAILED_INCOMPLETE_AGENT_RUN`)
printed "No patch produced — the agent run did not complete." pointing at `RUN_CLASSIFICATION.json`,
not a dangling patch path.

---

## Safety-boundary patterns established

Reusable contract shapes proven across the runs above.

**Artifact / environment exclusion (mechanical).** Exclude build trees and dependency caches that are
large or non-source: `target/` (Rust, up to 8.6 GB), `node_modules/`, `dist/`, `.vite/`, `__pycache__/`,
virtualenvs. Back them with `denyIfPresentAfterCopy` so an accidental include aborts the run.

**Secret / credential containment (mechanical).** Exclude `.env*`, `*.key`, `*.pem`, `*.pfx`, `*.p12`,
SQLite trading databases (`*.db`), and age-encrypted artifacts (`*.age`). Name the specific sensitive
files in `denyIfPresentAfterCopy` (e.g. `alpha.db`, `signal_log.age`) for an explicit post-copy gate.

**Result-ledger boundary (epistemic).** Exclude raw result artifacts — JSONL ledgers, per-run JSON,
simulation `.log` files, `.csv`/`.npy` data dumps — from the bundle. The agent must not read recorded
scores/outputs and repeat them as fresh findings. Proven on the pipeline `experiment_ledger.jsonl`
and the lcb_paper2 `frontier_*.log` files.

**No-claims boundary (epistemic).** Manuscript and result source is included read-only; only the audit
deliverable is writable. The audit reports citation/result **provenance**, never asserting a scientific
result as validated. Proven on lcb_paper2.

**Verification under network isolation.** The executor runs network-disabled with dependency dirs
excluded, so `cargo check`, `npx tsc`, `vitest`, and `pytest`-with-heavy-deps cannot resolve inside the
sandbox. Pattern: one hermetic **required** gate that needs no deps (a `grep` structural check, or
`python3 -m compileall` for syntax), with dependency-bound checks marked **advisory** and a documented
reason. Proven on warroom (cargo/npx), sinularity (vitest/tsc), pipeline (ML deps), lcb_paper2
(compileall).

---

## Audit-run discipline (operational)

- **Audit-only posture.** For harness-readiness runs, write scope is the audit deliverable only;
  product/manuscript/model source stays read-only. Confirmed that the agent stays in lane even when it
  has broader write access (sinularity: engine-tests writable, untouched).
- **Prompt shape.** Lead with the task and required output file, then the audit checklist, then
  constraints, then "finalize." Front-loading a wall of prohibitions can over-constrain the agent into
  an early stop (lcb_paper2 first attempt: read two files, stopped, `FAILED_INCOMPLETE`). Task-forward
  rephrasing produced a clean pass.

---

## Not yet covered

Candidate classes with no run on file yet:

- Document/book repo with no executable code at all (pure prose).
- Small stale app with genuinely broken tests (repair-boundary behavior).
- Live-adjacent / Hyperliquid execution code — audit-only, no execution, if attempted.
- Monorepo with multiple independent sub-projects under one contract.

---

_Last updated: 2026-05-31, at v0.2.10. Update this ledger whenever a new repo class is dogfooded or a
dogfood-surfaced defect ships a fix._
