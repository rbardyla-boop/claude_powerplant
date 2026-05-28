# Powerplant Skill Reactor — Architecture Plan

**Status:** Planning only. No `src/skills/` source files created or modified.
**Date:** 2026-05-28 (amended 2026-05-28)
**Scope:** Phase 1 design — manual/imported candidate skills, testing, promotion, activation, rollback.

---

## 1. What This Is

The Skill Reactor is the layer above Powerplant's runtime that turns proven work into reusable, tested, versioned capability. A skill is a named bundle — instructions, optional scripts, optional tests, per-skill memory — that can be loaded when Claude runs a task.

Phase 1 is deliberately narrow:
- Humans or external tools produce candidate skills
- Powerplant evaluates, stores, activates, and rolls them back
- No automatic skill generation from Claude runs (Phase 4+)

---

## 2. Compatibility

Skills follow Anthropic's `SKILL.md` format so they remain portable across Claude Code tooling. A Powerplant skill is a superset: it adds a `manifest.json` (provenance, version, hash) and a `.memory.md` (observational log) that the vanilla format does not require.

A valid vanilla `SKILL.md` can be imported directly as a Powerplant candidate.

---

## 3. Module Tree

```
src/
  skills/
    skill-manifest.ts         SkillManifest schema + validation (Zod)
    skill-memory.ts           SkillMemory load/save/append
    skill-ingestion.ts        Gate 0: filesystem safety checks on import
    candidate-store.ts        Read/write candidates/ on disk
    validated-store.ts        Read/write validated/ immutable version snapshots
    active-registry.ts        Read/write registry pointer + version history
    skill-evaluator.ts        Gates 1-5: schema, hash, scan, tests, record
    skill-promoter.ts         Candidate → validated + registry update
    skill-lifecycle.ts        State machine: candidate → promoted / quarantined
    load-active-skills.ts     Load active skills for injection into a run

  cli/commands/
    skill.ts                  Top-level `powerplant skill` router

    skill-commands/
      list.ts
      inspect.ts
      test.ts
      import.ts
      promote.ts
      rollback.ts
      quarantine.ts
```

`skill-ingestion.ts` is the Gate 0 module. It runs before any other module reads candidate content. No other module calls into `candidates/` without ingestion having completed first.

---

## 4. State Persistence Layout

All skill state lives under `~/.powerplant/` (same root as existing operator state).

```
~/.powerplant/
  skills/
    candidates/
      <candidate-id>/         UUID generated on import; contents become immutable
        SKILL.md              once Gate 0 ingestion completes
        manifest.json
        .memory.md
        scripts/
        tests/
        resources/

    validated/
      <skill-name>/
        v1/                   Immutable forever after promotion
        v2/
        v3/                   Each is a complete copy of the candidate at promotion time

    quarantine/               Failed evaluations — never read by active skill loader
      <candidate-id>/

  state/
    skill-registry.json       Active-version pointer per skill name; only mutable state
    skill-audit.jsonl         Append-oriented audit trail — see §5 for event schema
```

The `validated/<skill>/v_n/` directories are the permanent, immutable record of what was promoted. The registry's `activeVersion` field is the only thing that changes during promotion or rollback. Rollback does not restore files — it moves the registry pointer back to an already-stored, already-validated prior version.

---

## 5. Data Model Interfaces

### `SkillManifest`

```typescript
interface SkillManifest {
  schemaVersion: 1
  id: string                  // UUID — stable across all versions of this skill
  name: string                // kebab-case — becomes the validated/ directory name
  version: number             // monotonic integer, starts at 1
  description: string
  tags: string[]
  createdAt: string           // ISO 8601
  promotedAt: string | null   // null until first promotion
  sourceRunId: string | null  // null for hand-authored skills
  // Powerplant computes this hash — never trust a hash supplied by the imported package.
  // Set by Gate 2 (content hashing) after Gate 0 (filesystem safety) passes.
  sha256: string
  evaluationPassed: boolean
  evaluationAt: string | null
}
```

### `SkillMemory`

```typescript
interface SkillMemory {
  schemaVersion: 1
  skillName: string
  validatedObservations: string[]   // human-reviewed facts; surfaced as read-only context
  knownFailures: string[]           // conditions where this skill does not help
  pendingHypotheses: string[]       // not yet validated — never injected as instructions
}
```

`pendingHypotheses` are **never injected into prompts**. Only `validatedObservations` are surfaced during runs, and only as clearly-delimited read-only context, not as top-level system instructions.

### `SkillRegistryEntry`

```typescript
interface SkillRegistryEntry {
  name: string
  activeVersion: number             // only mutable field — updated by promote/rollback
  candidateId: string               // candidate that was promoted to activeVersion
  activatedAt: string
  previousVersions: Array<{
    version: number
    candidateId: string
    activatedAt: string
  }>
}
```

### `SkillAuditEvent`

`skill-audit.jsonl` is an append-oriented audit trail. Each line is one JSON event. It is not cryptographically hash-chained in Phase 1; tamper-evident chaining is a later hardening milestone. Each event carries enough information to reconstruct the full transition history without trusting adjacent events.

```typescript
type SkillAuditEvent =
  | {
      eventId: string           // UUID
      event: 'imported'
      at: string                // ISO 8601
      command: string           // e.g. 'powerplant skill import'
      candidateId: string
      name: string
      contentHash: string | null  // null if Gate 0 failed before hash was computed
    }
  | {
      eventId: string
      event: 'evaluated'
      at: string
      command: string
      candidateId: string
      name: string
      passed: boolean
      failedGate: string | null   // e.g. 'gate0-filesystem' | 'gate3-secret-scan' | null
      contentHash: string
    }
  | {
      eventId: string
      event: 'promoted'
      at: string
      command: string
      candidateId: string
      name: string
      version: number
      priorActiveVersion: number | null
      contentHash: string
    }
  | {
      eventId: string
      event: 'rolled-back'
      at: string
      command: string
      name: string
      fromVersion: number
      toVersion: number
      reason: string
    }
  | {
      eventId: string
      event: 'quarantined'
      at: string
      command: string
      candidateId: string
      name: string
      reason: string
      contentHash: string | null
    }
```

---

## 6. CLI Command Surface

Extends `powerplant` with a `skill` subcommand. No existing commands change.

```
powerplant skill list
  Show all active skills and their versions.

powerplant skill list --candidates
  Show all pending candidates.

powerplant skill inspect <skill-name>
  Print SKILL.md, manifest, memory, and version history.

powerplant skill inspect --candidate <id>
  Inspect a specific candidate before promotion.

powerplant skill import <path>
  Run Gate 0 on the source path, then copy into candidates/ with a new UUID.
  Writes manifest skeleton. Does NOT evaluate beyond Gate 0.

powerplant skill test <skill-name|--candidate <id>>
  Run full evaluation pipeline (Gates 0-5).
  Does NOT promote. Prints PASS/FAIL with gate-level detail.

powerplant skill promote <skill-name|--candidate <id>>
  Run full evaluation (if not already passed) then promote to validated/.
  Updates registry activeVersion pointer. Writes audit event.

powerplant skill rollback <skill-name>
  Atomically update registry activeVersion to the prior version.
  Does not touch validated/ directories — they are immutable.
  Fails with clear error if there is no prior version.
  Writes audit event with reason.

powerplant skill quarantine <skill-name|--candidate <id>>
  Move candidate or active skill to quarantine/.
  If quarantining an active skill: clears the registry entry.
  Does not delete from quarantine/ — operator must purge explicitly.
  Writes audit event with reason.

powerplant run --skills active <project-path> "<task>"
  Inject all active skills into the Claude prompt.
  (Extends existing `run` command — no breaking change.)

powerplant run --skill <name> <project-path> "<task>"
  Inject one specific active skill.
```

---

## 7. Promotion / Rollback State Machine

```
               import (Gate 0)
                 │
                 ├── Gate 0 FAIL ──────────────────► QUARANTINED
                 │
                 ▼
           CANDIDATE (immutable after Gate 0)
                 │
           test / promote (Gates 1-5)
                 │
          ┌──────┴──────┐
          │ EVAL FAIL   │ EVAL PASS
          ▼             ▼
     QUARANTINED      validated/v_n written
                         │
                      registry.activeVersion = n
                         │
                      ACTIVE (pointer to v_n)
                         │
                    rollback (if v_{n-1} exists in validated/)
                         │  (pointer only — no file mutation)
                         ▼
                      ACTIVE (pointer to v_{n-1})
                         │
                    promote new candidate
                         │  (v_{n+1} written to validated/, pointer updated)
                         ▼
                      ACTIVE (pointer to v_{n+1})
```

Key invariants:
- `validated/<name>/v_*/` directories are written once and never modified.
- Rollback is a registry pointer update. If it fails mid-write, the previous pointer is still valid.
- Quarantine moves files but never deletes them.
- No transition removes history from `validated/` or `quarantine/`.

---

## 8. Security Threat Model

### 8.1 Threat: Untrusted package reads host filesystem before safety checks run

An imported skill package could contain symlinks, path traversal sequences, device nodes, or oversized files. A naive implementation that hashes or scans content before validating filesystem boundaries could read outside the skill root.

**Mitigation:** Gate 0 (filesystem safety) runs before any recursive content read, hash computation, secret scan, or test execution. See §9, Gate 0 for the full checklist.

### 8.2 Threat: Skills as prompt injection vectors

A skill's `SKILL.md` is injected into the Claude system prompt. Malicious content could attempt to override Powerplant's instructions.

**Mitigation:**
- Skills are injected as clearly-delimited read-only context blocks, not as top-level system instructions.
- Powerplant computes the content hash at Gate 2 and re-verifies it at load time. A candidate that does not match the stored hash is quarantined immediately.
- Promotion requires explicit human invocation (`powerplant skill promote`). No auto-promotion in Phase 1.

### 8.3 Threat: Skills embedding secrets

A skill's `scripts/` or `SKILL.md` could contain hardcoded credentials or paths referencing `~/.powerplant/.env`.

**Mitigation:**
- Gate 3 (secret scan) runs on all validated file content before any promotion. Patterns cover API keys, private keys, bearer tokens, connection strings, and local paths to credential-bearing locations.
- Gate 0 rejects the package if any file references an absolute host path in its filesystem structure (filenames, symlink targets). Gate 3 scans file *contents* for the same.
- Scripts inside a skill's `tests/` run in the sandboxed executor (Gate 4) with no host credential mounts.

### 8.4 Threat: Memory contamination

Appending raw Claude output to `.memory.md` as instructions creates an injection path from Claude's output back into its own future prompts.

**Mitigation:**
- `.memory.md` has three typed sections: `validatedObservations`, `knownFailures`, `pendingHypotheses`.
- Only `validatedObservations` are surfaced during runs.
- `pendingHypotheses` require human promotion to `validatedObservations` via explicit CLI operation (Phase 3+).
- No CLI command in Phase 1 writes to `.memory.md` automatically.

### 8.5 Threat: Stale skills producing confidently-wrong behavior

A promoted skill may describe a procedure that no longer applies to the project.

**Mitigation:**
- `.memory.md` has a `knownFailures` field for recording staleness conditions.
- `powerplant skill inspect` always shows `promotedAt` and `evaluationAt` so operators can judge age.
- No automatic retirement in Phase 1. Manual quarantine is the mechanism.

### 8.6 Threat: Rollback re-exposing a security vulnerability

Rolling back to a previous version of a skill after a security patch is applied to the active version re-exposes the vulnerability.

**Mitigation:**
- Rollback is an explicit operator command that prints both the from-version and to-version.
- Every rollback writes a full audit event including the reason field.
- The patched version remains in `validated/v_n/` — it is not deleted. The operator can re-promote it.
- Rollback does not mutate `validated/` directories. Prior versions cannot be tampered with to create a fake "clean" rollback target.

---

## 9. Evaluation Pipeline (`skill-evaluator.ts`)

Run by both `skill test` and `skill promote`. All gates must pass for evaluation to succeed. **Gate 0 must complete before any gate that reads file content.**

### Gate 0 — Quarantine Ingestion and Filesystem Safety

Runs at `import` time in `skill-ingestion.ts`. No other module reads candidate content before this gate.

- Treat the imported path as untrusted input.
- Walk every entry under the source path before copying anything.
- Canonicalize each path and verify it remains inside the declared package root after resolution. Reject any path that escapes.
- Reject all symlinks (both files and directories).
- Reject hardlinks where detectable; document the platform limitation where not.
- Reject device files, sockets, FIFOs, and any entry that is not a regular file or directory.
- Enforce: max file count (e.g. 100), max individual file size (e.g. 512 KB), max total package size (e.g. 5 MB), max directory depth (e.g. 5 levels).
- Document the archive-extraction escape risk for if archive import is ever added (not in Phase 1).
- Only after all entries pass: copy into `candidates/<uuid>/`.
- Candidate contents are immutable after this gate completes.

Gate 0 failure → quarantine immediately, no further evaluation.

### Gate 1 — Schema and Identity Validation

- Validate that `SKILL.md` exists and is a regular file.
- Validate `manifest.json` exists and parses as valid `SkillManifest` via Zod.
- Validate skill name is kebab-case, no empty components, no path separators.
- Reject unexpected top-level entries (anything outside the documented package structure).

### Gate 2 — Powerplant-Computed Content Hashing

- Compute SHA-256 over a deterministic canonical representation: sorted relative paths + file contents.
- Write this hash to `manifest.sha256` in the candidate. Powerplant owns this value.
- An imported package must not contain a pre-populated `sha256` in its manifest (or it is ignored and overwritten). The imported package never supplies a trusted hash.
- Any later hash mismatch (e.g. at load time before a run) immediately quarantines the candidate.

### Gate 3 — Secret and Content Safety Scan

- Scan all regular-file content in the candidate: `SKILL.md`, `.memory.md`, all files in `scripts/`, `tests/`, `resources/`, and any supporting files.
- Apply the same regex patterns used by the existing open-source sanitizer: API key formats, private keys, bearer tokens, connection strings, AWS/GCP/Azure credential patterns.
- Also reject explicit references to sensitive host paths: `~/.powerplant`, `~/.ssh`, `/etc/shadow`, etc.
- Any match → FAIL.

### Gate 4 — Sandboxed Test Evaluation

Only runs if a `tests/` directory is present. Skipped (not failed) if absent.

- Execute each `*.test.ts` and `*.sh` in the isolated executor environment.
- No network access.
- No host `.env` or credential exposure.
- No writable access to `validated/`, `candidates/`, or `skill-registry.json`.
- Writable temporary directory only (cleaned after execution).
- Explicit timeout (default: 60s per test file), process limit, output size limit.
- Any non-zero exit or timeout → FAIL. Classify as `gate4-test-failure` or `gate4-timeout`.

### Gate 5 — Record Evaluation Result

- Write `evaluationPassed: true`, `evaluationAt: <ISO timestamp>` to `manifest.json`.
- Append a `evaluated` event to `skill-audit.jsonl`.
- A candidate is promotion-eligible only after reaching this gate with all prior gates passed.

---

## 10. Integration Seam with Existing `run` Command

The `run` command in `src/cli/commands/run.ts` currently builds a prompt envelope and dispatches to the sanitized project pilot. The skill injection seam is a single optional step before prompt construction:

```
run()
  │
  ├── (existing) load project contract
  ├── (existing) build prompt envelope
  │
  ├── (NEW, gated by --skills flag)
  │   loadActiveSkills() → SkillBlock[]
  │   appendSkillsToPromptEnvelope(envelope, skills)
  │
  └── (existing) dispatch to pilot
```

`loadActiveSkills` reads `skill-registry.json`, resolves each active version's path in `validated/`, re-verifies the content hash, and returns typed blocks. A hash mismatch at load time quarantines the affected skill entry and excludes it from the run (with a warning), rather than aborting the whole run.

This is a **non-breaking additive change**. Without `--skills`, run behavior is identical to today.

---

## 11. Test Plan

### Unit tests (no network, no disk mutation)

| File | What it covers |
|------|----------------|
| `tests/skill-ingestion.test.ts` | Gate 0: symlink rejection, path escape, device files, size/count/depth limits |
| `tests/skill-manifest.test.ts` | Schema validation, ID format, name rules, hash field ownership |
| `tests/skill-memory.test.ts` | Load/append/section isolation; pendingHypotheses never leak to observations |
| `tests/candidate-store.test.ts` | Import, read, list, quarantine |
| `tests/validated-store.test.ts` | Write, read, immutability of written versions |
| `tests/active-registry.test.ts` | Promote pointer, rollback pointer, registry JSON round-trip |
| `tests/skill-evaluator.test.ts` | All 5 gates with fixture skills (see below) |
| `tests/skill-lifecycle.test.ts` | Full state machine: import → test → promote → rollback → quarantine |

### CLI integration tests (temp directory, no network)

| File | What it covers |
|------|----------------|
| `tests/cli-skill-list.test.ts` | Output format, empty state |
| `tests/cli-skill-import.test.ts` | File/directory import, manifest creation, Gate 0 rejection |
| `tests/cli-skill-test.test.ts` | PASS/FAIL output with gate-level detail |
| `tests/cli-skill-promote.test.ts` | Promotion + registry pointer update |
| `tests/cli-skill-rollback.test.ts` | Pointer decrement + error when no prior version |
| `tests/cli-skill-inspect.test.ts` | Full detail output |

### Fixture skills (in `fixtures/skills/`)

| Fixture | Purpose |
|---------|---------|
| `valid-minimal/` | Bare SKILL.md, no scripts, no tests — must pass all gates |
| `valid-with-tests/` | SKILL.md + passing test script — must pass Gate 4 |
| `gate0-symlink/` | Contains a symlink — must fail Gate 0 before hash is computed |
| `gate0-path-escape/` | Contains `../../etc/passwd` style entry — must fail Gate 0 |
| `gate0-oversized/` | Total package > size limit — must fail Gate 0 |
| `gate3-secret/` | SKILL.md containing a fake API key pattern — must fail Gate 3 |
| `gate3-sensitive-path/` | SKILL.md referencing `~/.ssh/id_rsa` — must fail Gate 3 |
| `tampered/` | Valid stored sha256 but SKILL.md modified after ingestion — must fail Gate 2 re-verify |
| `failing-test/` | SKILL.md + a test script that exits non-zero — must fail Gate 4 |

The `gate0-*` fixtures prove that Gate 0 blocks content reads before any other gate runs. Tests for these fixtures must assert that no hash was computed and no secret scan was attempted.

---

## 12. Phased Implementation Sequence

### Phase 0 — Prerequisite

Working tree is currently clean. Verification-integrity repair is committed at `0d938ae`. The repair and this planning document were committed together in that commit; the required sequence below applies to future work.

**Remaining prerequisite before Phase 1 begins: see §13.**

### Phase 1 — Skill vault (this plan)

Build `src/skills/`, `src/cli/commands/skill.ts` and the CLI subcommands. Add unit and integration tests. No changes to `run`, no auto-generation.

Milestone: `powerplant skill import`, `test`, `promote`, `rollback`, `list`, `inspect` all work with fixture skills and the full 6-gate pipeline is exercised by tests.

### Phase 2 — Run-time injection

Add `--skills active` and `--skill <name>` flags to `run`. Extend the prompt envelope to carry skill blocks. Add a skill audit entry for every run that loaded skills.

Milestone: `powerplant run --skills active ./myproject "fix the bug"` injects active skill text and the run audit records which skills were active.

### Phase 3 — Memory persistence

Add `pendingHypotheses` logging from run outcomes. Add `powerplant skill memory validate <skill-name>` to explicitly promote a hypothesis to a validated observation. No auto-promotion.

### Phase 4 — Candidate distillation

Add `powerplant skill distill --from-run <run-id>` to propose a candidate from a successful run's evidence. The operator reviews, tests, and promotes it — no auto-promotion path.

### Phase 5 — Benchmark harness

Add `powerplant benchmark <task>` to run the same task with and without skills and record outcome differences. This is the evidence layer required before claiming measurable improvement.

---

## 13. Current Status and Blockers

### Working tree status (as of 2026-05-28)

Working tree is clean. The branch is ahead of `origin/master` by 1 commit (`0d938ae`).

The verification-integrity repair and this plan document were committed together in `0d938ae`. This is a provenance deviation from the intended sequence (the plan should have landed on a separate feature branch). The deviation is already committed; correcting it requires the following steps before Phase 1 implementation begins:

### Required sequence before Phase 1 implementation

1. **Operational QA** — Run the clean Singularity operational acceptance retry. Confirm real post-write Vitest verification passes and `finalize` behaves correctly under the repaired broker path.

2. **Verification-integrity closure** — Record `VERIFICATION_INTEGRITY_REPAIR_OPERATIONALLY_PROVEN` once QA passes. This is the gate between the repair commit and implementation authorization.

3. **Feature branch** — Create `feat/skill-lifecycle` from the current `master` tip. All Phase 1 implementation commits land on that branch.

4. **Amend commit provenance** — The plan document (`docs/architecture/POWERPLANT_SKILL_REACTOR_PLAN.md`) should ideally be re-committed on `feat/skill-lifecycle` only. If the team accepts it on `master` as-is (it is planning-only, no source changes), document that decision here and proceed.

5. **Implementation authorization** — Phase 1 implementation begins only after steps 1-3 are complete and this blockers section is updated to reflect closure.

### Blocker summary

| Blocker | Status |
|---------|--------|
| Verification-integrity repair committed | ✓ Done (`0d938ae`) |
| Test suite green | Verify with `npm test` after repair |
| Operational QA: Singularity live retry passes | Pending |
| `VERIFICATION_INTEGRITY_REPAIR_OPERATIONALLY_PROVEN` recorded | Pending |
| Feature branch created | Pending |
| Phase 1 implementation authorized | **Blocked pending items above** |

---

## 14. What This Does Not Do

- Does not auto-generate skills from Claude runs (Phase 4+)
- Does not push skills to any remote registry
- Does not modify existing `setup`, `doctor`, `inspect`, `verify`, or `review` commands
- Does not create a skill "marketplace" or sharing mechanism
- Does not auto-retire stale skills
- Does not change the credential resolution path
- Does not introduce any new runtime dependencies
- Does not create any `src/skills/` source files (planning only)
