# Powerplant Skill Reactor — Architecture Plan

**Status:** Planning only. No source files modified.
**Date:** 2026-05-28
**Scope:** Phase 1 design — manual/imported candidate skills, testing, promotion, activation, rollback.

---

## 1. What This Is

The Skill Reactor is the layer above Powerplant's runtime that turns proven work into reusable, tested, versioned capability. A skill is a named bundle — instructions, optional scripts, optional tests, per-skill memory — that can be loaded when Claude runs a task.

Phase 1 is deliberately narrow:
- Humans or external tools produce candidate skills
- Powerplant evaluates, stores, activates, and rolls them back
- No automatic skill generation from Claude runs (Phase 3+)

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
    candidate-store.ts        Read/write candidates/ on disk
    active-registry.ts        Read/write active/ registry + versions
    skill-evaluator.ts        Run tests, hash check, secret scan
    skill-promoter.ts         Candidate → active (with rollback record)
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

---

## 4. State Persistence Layout

All skill state lives under `~/.powerplant/` (same root as existing operator state).

```
~/.powerplant/
  skills/
    candidates/
      <candidate-id>/         UUID generated on import
        SKILL.md              Required — instructions for Claude
        manifest.json         Required — see §5
        .memory.md            Optional — observational log
        scripts/              Optional — shell scripts referenced by SKILL.md
        tests/                Optional — vitest/shell tests run before promotion
        resources/            Optional — data files referenced by SKILL.md

    active/
      <skill-name>/           Kebab-case name from manifest
        current -> v3/        Symlink to current version
        v1/                   Promoted snapshot (immutable after promotion)
        v2/
        v3/

    quarantine/               Failed evaluations (never injected into runs)
      <candidate-id>/

  state/
    skill-registry.json       Index of all active skills and their versions
    skill-audit.jsonl         Append-only: every promote/rollback/quarantine event
```

---

## 5. Data Model Interfaces

### `SkillManifest`

```typescript
interface SkillManifest {
  schemaVersion: 1
  id: string                  // UUID — stable across versions
  name: string                // kebab-case — becomes the active/ directory name
  version: number             // monotonic integer, starts at 1
  description: string
  tags: string[]
  createdAt: string           // ISO 8601
  promotedAt: string | null   // null until first promotion
  sourceRunId: string | null  // null for hand-authored skills
  sha256: string              // hash of SKILL.md + scripts/ content
  evaluationPassed: boolean
  evaluationAt: string | null
}
```

### `SkillMemory`

```typescript
interface SkillMemory {
  schemaVersion: 1
  skillName: string
  validatedObservations: string[]   // human/system reviewed facts
  knownFailures: string[]           // conditions where this skill does not help
  pendingHypotheses: string[]       // not yet validated — never injected as instructions
}
```

Pending hypotheses are **never injected into prompts**. Only `validatedObservations` are surfaced, and only as read-only context, not as instructions.

### `SkillRegistryEntry`

```typescript
interface SkillRegistryEntry {
  name: string
  activeVersion: number
  candidateId: string      // the candidate that was promoted to this version
  activatedAt: string
  previousVersions: Array<{ version: number; candidateId: string; activatedAt: string }>
}
```

### `SkillAuditEvent`

```typescript
type SkillAuditEvent =
  | { event: 'imported';   candidateId: string; name: string;    at: string }
  | { event: 'evaluated';  candidateId: string; passed: boolean; at: string }
  | { event: 'promoted';   candidateId: string; name: string; version: number; at: string }
  | { event: 'rolled-back'; name: string; fromVersion: number; toVersion: number; at: string }
  | { event: 'quarantined'; candidateId: string; reason: string; at: string }
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
  Import a skill directory or bare SKILL.md as a candidate.
  Assigns a UUID, writes manifest skeleton, does NOT evaluate.

powerplant skill test <skill-name|--candidate <id>>
  Run evaluation: content hash, secret scan, optional tests/.
  Does NOT promote. Prints PASS/FAIL with detail.

powerplant skill promote <skill-name|--candidate <id>>
  Evaluate (if not already passed) then promote to active.
  Increments version. Writes audit event.

powerplant skill rollback <skill-name>
  Revert active to previous version. Writes audit event.
  Fails with clear error if there is no previous version.

powerplant skill quarantine <skill-name|--candidate <id>>
  Move to quarantine/. Removes from active if currently active.
  Writes audit event.

powerplant run --skills active <project-path> "<task>"
  Inject all active skills into the Claude prompt.
  (Extends existing `run` command — no breaking change.)

powerplant run --skill <name> <project-path> "<task>"
  Inject one specific active skill.
```

---

## 7. Promotion / Rollback State Machine

```
               import
                 │
                 ▼
           CANDIDATE ─── quarantine ──► QUARANTINED
                 │
           test / promote
                 │
          ┌──────┴──────┐
          │ EVAL FAIL   │ EVAL PASS
          ▼             ▼
     QUARANTINED      ACTIVE (v_n)
                         │
                    rollback (if v_{n-1} exists)
                         │
                         ▼
                      ACTIVE (v_{n-1})
                         │
                    promote new candidate
                         │
                         ▼
                      ACTIVE (v_{n+1})
```

Transitions are recorded in `skill-audit.jsonl`. Rollback is only possible when a prior version exists in `active/<name>/`. If `v1` is active and there is no `v0`, rollback errors with a message rather than deleting the skill silently.

No transition deletes skill history. Quarantined candidates stay in `quarantine/` indefinitely until explicitly purged by the operator.

---

## 8. Security Threat Model

### 8.1 Threat: Skills as prompt injection vectors

A skill's `SKILL.md` is injected into the Claude system prompt. Malicious content could attempt to override Powerplant's instructions.

**Mitigation:**
- Skills are injected as clearly-delimited read-only context blocks, not as top-level system instructions.
- Content hash is stored in `manifest.json` and verified at load time. A tampered `SKILL.md` that doesn't match the hash is rejected.
- Promotion requires explicit human invocation (`powerplant skill promote`). No auto-promotion in Phase 1.

### 8.2 Threat: Skills leaking secrets

A skill's `scripts/` could reference environment variables or access `~/.powerplant/.env`.

**Mitigation:**
- Secret scan runs before any promotion: checks `SKILL.md`, all files in `scripts/`, and all files in `resources/` against the same 20+ regex patterns used by the open-source sanitizer.
- Scripts inside a skill run in the existing sandboxed executor environment, not in the host shell with operator credentials.
- `.memory.md` `pendingHypotheses` are never surfaced as instructions.

### 8.3 Threat: Skills becoming stale instructions

A promoted skill may describe a procedure that no longer applies to the project. Stale instructions can produce confidently-wrong Claude behavior.

**Mitigation:**
- `.memory.md` has a `knownFailures` field explicitly for recording staleness conditions.
- `powerplant skill inspect` always shows `promotedAt` and `evaluationAt` so operators can judge age.
- No automatic retirement in Phase 1. Manual quarantine is the mechanism.

### 8.4 Threat: Memory contamination

Appending raw Claude output to `.memory.md` as instructions would create an injection path from Claude's output back into its own future prompts.

**Mitigation:**
- `.memory.md` has three typed sections: `validatedObservations`, `knownFailures`, `pendingHypotheses`.
- Only `validatedObservations` are surfaced during runs.
- `pendingHypotheses` require human promotion to `validatedObservations` via explicit CLI operation (Phase 2+).
- No CLI command in Phase 1 writes to memory automatically.

### 8.5 Threat: Version confusion under rollback

Rolling back to a previous version of a skill after a security patch is applied to the new version would re-expose the vulnerability.

**Mitigation:**
- Rollback requires explicit operator invocation and prints the version being restored.
- Every rollback writes to `skill-audit.jsonl` with both version numbers.
- Rollback does not delete the quarantined/newer version — it remains in `active/<name>/v_n/`.

---

## 9. Evaluation Pipeline (`skill-evaluator.ts`)

Run by both `skill test` and `skill promote`. All steps must pass for evaluation to succeed.

```
Step 1 — Content hash verification
  Recompute SHA-256 over SKILL.md + all files in scripts/.
  Compare to manifest.sha256. Mismatch → FAIL.

Step 2 — Secret scan
  Regex scan all text files in the candidate directory.
  Patterns: API keys, private keys, bearer tokens, connection strings, etc.
  Any match → FAIL.

Step 3 — Path safety check
  SKILL.md and scripts/ must not reference absolute host paths
  or try to read from ~/ or ~/.powerplant.
  Any reference → FAIL.

Step 4 — Skill tests (if tests/ directory present)
  Run each *.test.ts or *.sh in tests/ in the existing isolated executor.
  Any non-zero exit → FAIL.

Step 5 — Write evaluation result to manifest
  evaluationPassed: true/false
  evaluationAt: ISO timestamp
```

Evaluation is idempotent. Running it twice on an unchanged candidate produces the same result.

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

`loadActiveSkills` reads `skill-registry.json`, resolves each active version's `SKILL.md`, verifies content hash, and returns typed blocks. A hash mismatch at load time logs a warning and skips that skill rather than aborting the run.

This is a **non-breaking additive change**. Without `--skills`, run behavior is identical to today.

---

## 11. Test Plan

### Unit tests (no network, no disk mutation)

| File | What it covers |
|------|----------------|
| `tests/skill-manifest.test.ts` | Schema validation, ID format, version increment |
| `tests/skill-memory.test.ts` | Load/append/section isolation |
| `tests/candidate-store.test.ts` | Import, read, list, quarantine |
| `tests/active-registry.test.ts` | Promote, rollback, registry JSON round-trip |
| `tests/skill-evaluator.test.ts` | Hash check, secret scan, path safety (fixture-based) |
| `tests/skill-lifecycle.test.ts` | Full state machine: import → test → promote → rollback → quarantine |

### CLI integration tests (temp directory, no network)

| File | What it covers |
|------|----------------|
| `tests/cli-skill-list.test.ts` | Output format, empty state |
| `tests/cli-skill-import.test.ts` | File/directory import, manifest creation |
| `tests/cli-skill-test.test.ts` | PASS/FAIL output with fixture skills |
| `tests/cli-skill-promote.test.ts` | Promotion + registry update |
| `tests/cli-skill-rollback.test.ts` | Version decrement + error when no prior version |
| `tests/cli-skill-inspect.test.ts` | Full detail output |

### Fixture skills (in `fixtures/skills/`)

| Fixture | Purpose |
|---------|---------|
| `valid-minimal/` | Bare SKILL.md, no scripts, no tests — should pass evaluation |
| `valid-with-tests/` | SKILL.md + passing test script |
| `invalid-secret/` | SKILL.md containing a fake API key pattern — must fail secret scan |
| `invalid-path/` | SKILL.md referencing `~/.ssh/id_rsa` — must fail path check |
| `tampered/` | Valid manifest.sha256 but modified SKILL.md — must fail hash check |
| `failing-test/` | SKILL.md + a test script that exits non-zero |

---

## 12. Phased Implementation Sequence

### Phase 0 — Prerequisite (current work)

Stabilize the credential resolution and in-progress verification changes. Confirm `npm test` is green. Do not start Phase 1 until the existing diff is committed and tests pass.

**Blocker items listed in §13.**

### Phase 1 — Skill vault (this plan)

Build `src/skills/`, `src/cli/commands/skill.ts` and the CLI subcommands. Add unit and integration tests to `tests/`. No changes to `run`, no auto-generation.

Milestone: `powerplant skill import`, `test`, `promote`, `rollback`, `list`, `inspect` all work with fixture skills.

### Phase 2 — Run-time injection

Add `--skills active` and `--skill <name>` flags to `run`. Extend the prompt envelope to carry skill blocks. Add a skill audit entry for every run that loaded skills.

Milestone: `powerplant run --skills active ./myproject "fix the bug"` correctly injects the active skill text and the run audit records which skills were active.

### Phase 3 — Memory persistence

Add `pendingHypotheses` logging from run outcomes. Add `powerplant skill memory validate <skill-name>` to promote a hypothesis to a validated observation. No auto-promotion.

### Phase 4 — Candidate distillation

Add `powerplant skill distill --from-run <run-id>` to propose a candidate skill from a successful run's evidence. The operator then reviews, tests, and promotes.

### Phase 5 — Benchmark harness

Add `powerplant benchmark <task>` that runs the same task with and without skills and records outcome differences. This is the evidence layer required before claiming measurable improvement.

---

## 13. Blockers Before Phase 1 Begins

The following must be resolved and the test suite confirmed green before any skill reactor code is written:

1. **In-progress diff** — Ten files are modified (`src/broker/project-tool-broker.ts`, `src/cli/commands/run.ts`, `src/contracts/verification-preflight-report.ts`, `src/projects/generate-patch-package.ts`, `src/sessions/run-sanitized-project-pilot.ts`, `src/verification/classify-check-result.ts`, `src/verification/run-approved-checks.ts`, `src/verification/run-capsule-checks.ts`, `tests/patch-package.test.ts`, `tests/prompt-envelope.test.ts`) plus one new test file. These must be committed.

2. **New test file** — `tests/verification-integrity.test.ts` is untracked. It must be committed or explicitly removed.

3. **Test suite green** — `npm test` must exit 0 with no failing tests before Phase 1 starts.

4. **No credential ambiguity** — `powerplant doctor` must report a non-`none` credential source. The credential path introduced in commit `9302e3c` must be confirmed working.

---

## 14. What This Does Not Do

- Does not auto-generate skills from Claude runs (Phase 4+)
- Does not push skills to any remote registry
- Does not modify existing `setup`, `doctor`, `inspect`, `verify`, or `review` commands
- Does not create a skill "marketplace" or sharing mechanism
- Does not auto-retire stale skills
- Does not change the credential resolution path
- Does not introduce any new runtime dependencies
