# RC6A Replay Stop and Scope Correction

**Status**: `RC6A_SINGULARITY_REPLAY_BLOCKED`  
**Correction branch**: `feat/rc6b-provenance-correction`  
**Created**: 2026-05-29  
**Supersedes**: RC6A annotation claim of accepted Stage 2B baseline

---

## 1. Stop Condition Accepted

The skill-guided Singularity replay authorized under RC6A is **blocked**. The audit
established that RC6A's embedded annotation overstates the proven feature surface:

> "RC6A — Integrated skill-lifecycle through Stage 2B plus verification diagnostics
> and terminal-outcome integrity repairs."

**The phrase "through Stage 2B" is invalid as a replay claim.** Stage 2B unit tests
pass and its code is committed, but Stage 2B has unresolved code-level defects and no
completed live-acceptance evidence (L1–L7 never executed). The annotation was created
under an incorrect premise.

---

## 2. RC6A Tag Disposition

| Question | Answer |
|----------|--------|
| RC6A tag commit (`c260a99`) | Valid — code compiles, 865 tests pass, typecheck clean |
| RC6A annotation claim | **Invalid** — overstates accepted surface |
| RC6A for skill-guided replay | **Withdrawn** |
| RC6A tag moved or deleted | **No** — frozen as created |
| Forward QA use | RC6B-QA replaces RC6A for replay under the narrow claim below |

RC6A must not be used as the basis for any skill-guided replay. Treat it as:

```
RC6A — annotated marker created under invalid Stage 2B acceptance premise.
Withdrawn from skill-guided replay use. Tag preserved as immutable historical record.
```

---

## 3. Proven Surface (RC6 / RC6A commit)

The following are proven for the integrated baseline at `c260a99`:

| Feature | Status |
|---------|--------|
| Phase 1A vault foundation and safe ingestion | Proven |
| Stage 1 trust foundation (28 tests) | Proven |
| Verification diagnostics repair (18 regression tests) | Proven |
| Stage 2A synthetic promoted-guidance pilot (35 tests) | Proven |
| Stage 2B unit test suite (24 tests, T1–T24) | Proven — tests pass |
| Terminal-outcome and patch-eligibility unification (38 tests) | Proven |
| RC6 hygiene (Stage 2A closure record, RC5 addendum, stale tsconfig exclusions removed) | Proven |
| **Stage 2B trusted skill-guided execution** | **Not proven** |
| **RC6A as accepted Stage 2B baseline** | **Invalid** |

---

## 4. The Five Stage 2B Blockers

Each blocker is a defect in the committed implementation at
`src/sessions/run-skill-guided-sanitized-project-pilot.ts`.

### Blocker 1 — Skill guidance replaces the operator task (HARD BLOCKER)

**Location**: `run-skill-guided-sanitized-project-pilot.ts:362`

```typescript
// Current — skill envelope becomes the message the agent receives
agentMessage: envelope.text,
```

`runProjectPilotBrokerSession` sends `agentMessage` as the sole content of the initial
user turn (broker line 349: `content: [{ type: 'text', text: agentMessage }]`).
`taskDescription` (the operator's task, line 361) is stored in session state but is NOT
sent to the agent when `agentMessage` is provided (broker line 301: `agentMessage = taskDescription`
applies only when `agentMessage` is omitted).

**Result**: The agent receives only `envelope.text`. The operator's task is invisible to the
agent at runtime. Skill authority displaces operator authority.

**Required fix**: Preserve the operator's task as the primary agent content. Attach skill
guidance as bounded supplementary material. Implement a two-hash model: one hash over the
operator task, one over the appended guidance, both recorded in Phase A.

---

### Blocker 2 — Wrapper inference competes with broker truth (OPEN, PARTIALLY ADDRESSED)

**Location**: `run-skill-guided-sanitized-project-pilot.ts:175–188`

```typescript
function derivePatchEligible(
  brokerResult: ProjectBrokerSessionResult,
  sourceUnmodified: boolean,
): boolean {
  // ...
  const checksPassed =
    brokerResult.checkResults !== null &&
    brokerResult.checkResults.length > 0 &&
    brokerResult.checkResults.every(r => r.verdict === 'PASS')
  return checksPassed
}
```

`derivePatchEligible` re-evaluates `brokerResult.checkResults` independently of the
broker's authoritative `passed` determination. This creates a parallel eligibility path
that may agree with or diverge from broker enforcement state. The wrapper should consume
post-final-write verification validity, finalize acceptance, and broker-determined patch
eligibility as terminal facts — not re-derive them from historical check arrays.

---

### Blocker 3 — Static capsule isolation claims recorded as run evidence (HARD BLOCKER)

**Location**: `run-skill-guided-sanitized-project-pilot.ts:117–120, 432`

```typescript
// Constants — never observed at runtime
const CAPSULE_ISOLATION: CapsuleIsolationIndicators = {
  executorNetworkDisabled: true,
  noCredentialsPassedToExecutor: true,
}

// Written into the Phase B record as if they were observed facts
capsuleIsolationIndicators: CAPSULE_ISOLATION,
```

`CAPSULE_ISOLATION` is a compile-time constant. Writing it into the Phase B provenance
record as `capsuleIsolationIndicators` fabricates observed-fact provenance for controls
that were not measured during the run.

**Required fix**: Phase B must distinguish:

| Type | Meaning |
|------|---------|
| Declared policy | What isolation controls are configured / intended |
| Observed receipt | What this specific run actually demonstrated |
| Unknown | Control not evidenced in this run |

Static constants must be labelled as declared policy, not observed evidence.

---

### Blocker 4 — Phase A ordering claim is false (HARD BLOCKER)

**Location**: `run-skill-guided-sanitized-project-pilot.ts:313–332`

```typescript
// Contract and snapshot loaded BEFORE Phase A
const contract = loadProjectContract(pilotSourcePath)   // line 313
const snapshot = buildPilotSnapshot(contract, runDir)   // line 314

// Phase A written here — after contract and snapshot construction
auditPath = appendPhaseARecord(phaseARecord)            // line 332
```

The code comment at line 311 rationalizes this as "contract is pre-session,
not skill-influenced." That may be true of intent, but Phase A cannot truthfully
serve as the pre-execution boundary record if contract loading and snapshot
construction already occurred.

The Phase A record includes `contract.projectId` (line 326), derived from the already-loaded
contract. If Phase A is meant to mark the boundary before any session state is computed,
the ordering is wrong. Either the ordering must be corrected (Phase A first, before any
session state is derived) or the stated semantics of Phase A must change to acknowledge
that contract loading precedes it.

---

### Blocker 5 — No accepted runtime skill; L1–L7 never run (ACCEPTANCE BLOCKER)

The Stage 2B closure record explicitly states:

> "L1–L7 remain pending live execution."

The missing `~/.powerplant/state/skill-registry.json` produces a `SKILL_NOT_FOUND`
failure on any live invocation. There is no usable promoted skill in the runtime
environment and no live acceptance evidence for any of the seven mandatory scenarios:

| Run | Scenario |
|-----|----------|
| L1 | Legitimate skill-guided completion |
| L2 | Finalize without checks rejected |
| L3 | Write-after-checks rejected |
| L4 | Budget exhaustion |
| L5 | Disabled skill |
| L6 | Mutated skill |
| L7 | Phase B audit failure on otherwise-eligible run |

Until all seven run and produce evidence of correct behavior, Stage 2B cannot be
claimed as accepted. A seeded registry record must not be manually injected — any
skill used for acceptance must be created through an approved, auditable mechanism.

---

## 5. Standard Pilot Path — Isolation Proof

`npm run smoke:pilot:project` invokes:

```
src/cli/sprint4a-sanitized-project-pilot.ts
  → runSanitizedProjectPilot (src/sessions/run-sanitized-project-pilot.ts)
```

`run-sanitized-project-pilot.ts` imports exclusively:

```typescript
import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import { ... } from '../config/constants.js'
import { loadProjectContract } from '../projects/load-project-contract.js'
import { buildPilotSnapshot } from '../projects/build-pilot-snapshot.js'
import { verifySourceUnchanged } from '../projects/verify-source-unchanged.js'
import { runProjectPilotBrokerSession } from '../broker/project-tool-broker.js'
import type { Sprint4aState } from '../platform/sprint4a-state.js'
```

It does **not** import from:

- `run-skill-guided-sanitized-project-pilot.ts`
- `skill-lifecycle.ts`
- `skill-envelope.ts`
- `skill-invocation-audit.ts`

**The standard pilot execution path has no import-graph edge to any Stage 2B
skill-guided code.** This is verified by the invariant test at
`tests/stage2b-boundary-invariant.test.ts`.

---

## 6. Stage 2B Closure Record Status

`SKILL_LIFECYCLE_STAGE_2B_CLOSURE_RECORD.md` (committed at repo root) is **not
deleted or rewritten**. It is superseded in scope by this document and by
`docs/architecture/SKILL_LIFECYCLE_STAGE_2B_CLOSURE_SUPERSESSION.md`.

The closure record's verdict `A — SKILL_LIFECYCLE_STAGE_2B_SANITIZED_INVOCATION_COMMITTED_AND_BASELINED`
accurately describes what was proven at commit time:

- Code committed to repository
- 24 unit tests passing × 3 clean runs
- Typecheck clean

It does **not** prove, and never claimed to prove, that Stage 2B is ready for
trusted live replay. The closure record itself notes "L1–L7 remain pending live
execution." The misinterpretation arose when this verdict was treated as equivalent
to full acceptance in the context of the RC6A annotation.

---

## 7. Correct Path Forward

### Path A — Standard non-skill-guided pilot replay (Recommended immediately)

Proceed under this exact claim:

> **Testing terminal-outcome and verification repeatability of the integrated
> Powerplant baseline through the standard non-skill-guided sanitized project pilot.
> Incomplete Stage 2B skill-guided code is present in the repository but is
> explicitly outside the execution path and outside the claim.**

Tag: **RC6B-QA** (annotated, narrow truthful claim — see below)

### Path B — Stage 2B live acceptance (Separate stream, not yet authorized)

Required before any new skill-guided replay claim:

1. Fix Blocker 1: implement two-hash guidance model, preserve operator task authority
2. Fix Blocker 2: consume authoritative broker terminal facts for eligibility
3. Fix Blocker 3: replace static isolation constants with observed evidence or explicit
   policy declarations
4. Fix Blocker 4: correct Phase A ordering or correct its stated semantics
5. Fix Blocker 5: produce controlled accepted skill via approved mechanism; run L1–L7
6. Create a new accurately-described integrated tag for skill-guided replay

---

## 8. Decisions

| Decision | Verdict |
|----------|---------|
| Accept the audit stop | **Yes** |
| Run RC6A skill-guided Singularity replay | **No** |
| Preserve RC6A tag as originally created | **Yes — mark withdrawn from claimed use** |
| Correct provenance on successor commit/tag | **Required** — this document |
| Proceed with standard non-skill pilot replay after correction | **Recommended** |
| Begin Stage 2B live acceptance now | **No** |
| Implement Stage 2B blockers as a separate stream | **Yes** |
