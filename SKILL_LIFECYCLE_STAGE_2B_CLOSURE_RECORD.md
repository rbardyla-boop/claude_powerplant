# Skill Lifecycle Stage 2B — Closure Record

**Stage 2B verdict:** `A — SKILL_LIFECYCLE_STAGE_2B_SANITIZED_INVOCATION_COMMITTED_AND_BASELINED`

**Branch:** `feat/skill-lifecycle-stage2b`  
**Base commit (Stage 2A):** `06781cb` — `feat(skill-lifecycle): Stage 2A — synthetic promoted-guidance pilot invocation`  
**Stage 2A authoritative baseline:** `783 passing, 0 failing`

---

## Baseline Accounting

| Baseline | Tests |
|---|---|
| Stage 2A (`06781cb`) | 783 passing |
| Stage 2B additions (24 new tests in T1–T24) | +24 |
| **Stage 2B total** | **807 passing** |

All 24 new test functions map 1:1 to the T1–T24 inventory from the plan. No additional test functions were added, no existing tests were split or combined.

---

## Files Changed

| File | Change type | Notes |
|---|---|---|
| `src/config/constants.ts` | Modified | Added 3 Stage 2B constants: `SKILL_GUIDED_PILOT_RUNNER_TYPE`, `SKILL_INVOCATION_PHASE_A`, `SKILL_INVOCATION_PHASE_B` |
| `src/skills/skill-invocation-audit.ts` | Modified | Extended with `SkillInvocationPhaseARecord`, `SkillInvocationPhaseBRecord`, `LiveRunTerminationReason`, `LiveRunFinalOutcome`, `CapsuleIsolationIndicators` types; added `appendPhaseARecord`, `appendPhaseBRecord` functions; Stage 2A `SkillInvocationRecord` and `openInvocationAuditRecord` unchanged |
| `src/sessions/run-skill-guided-sanitized-project-pilot.ts` | Created | New Stage 2B session runner — skill validation (steps 1–7), Phase A persistence, broker session, Phase B persistence (single terminal funnel), SkillGuidedRunReport |
| `tests/skill-guided-sanitized-project-pilot.test.ts` | Created | 24 unit tests T1–T24 |

**Protected enforcement files not modified (confirmed via `git diff HEAD`):**
- `src/broker/project-tool-broker.ts` — enforcement semantics unchanged
- `src/verification/run-capsule-checks.ts` — capsule isolation unchanged
- `src/verification/run-approved-checks.ts` — host-process check path unchanged
- `src/verification/classify-check-result.ts` — zero-test guard unchanged
- `src/projects/load-project-contract.ts` — contract loading unchanged
- `src/projects/build-pilot-snapshot.ts` — snapshot construction unchanged

---

## Unit/Integration Test Inventory (T1–T24)

| # | Test | What is proven |
|---|---|---|
| T1 | Phase A audit record exists on disk before broker is called | Phase A write ordering |
| T2 | Phase B completion record is keyed to same invocationId as Phase A | Phase A/B linkage |
| T3 | Phase A record has syntheticScope: false and correct runnerType | Runtime constants in Phase A |
| T4 | envelopeHash in Phase A equals SHA-256 of agentMessage passed to broker | Envelope hash binding |
| T5 | checksInvalidatedByWrite: true when write occurred and finalize attempted but rejected | Write-invalidation in Phase B |
| T6 | finalizeAccepted: false when broker finalize was attempted but not accepted | Finalize rejection in Phase B |
| T7 | terminationReason FAILED_TOOL_BUDGET_EXHAUSTED when broker throws budget error | Budget exhaustion terminal path |
| T8 | sourceTreeUnmodified in Phase B reflects verifySourceUnchanged result | Source integrity derivation |
| T9 | runner does NOT directly import capsule or approved-checks modules | Import graph containment |
| T10 | Malicious envelope text cannot alter checkResults in Phase B | Envelope text isolation from Phase B |
| T11 | sanitizedProjectId in Phase A matches contract.projectId | Project ID provenance binding |
| T12 | SHA-256 of agentMessage passed to broker equals Phase A envelopeHash | Cross-artifact hash consistency |
| T13 | Phase B appendPhaseBRecord is called before eligible patch is returned | Phase B ordering before result |
| T14 | Phase B persistence failure returns FAILED_INVOCATION_AUDIT_PERSISTENCE | Phase B fail-closed |
| T15 | Phase B persistence failure forces patchEligibleForApplication: false | Phase B fail-closed — eligibility |
| T16 | Phase B persistence failure forces clearedForSanitizedExternalProjectInput: false | Phase B fail-closed — clearance |
| T17 | Phase B attempted and records finalizeAttempted: true, finalizeAccepted: false after finalize denial | Phase B on finalize denial |
| T18 | Phase B attempted after check failure; records FAIL_CHECK result | Phase B on check failure |
| T19 | Phase B attempted after FAIL_VERIFICATION_INTEGRITY; finalOutcome not FAILED_INVOCATION_AUDIT_PERSISTENCE | Phase B on zero-test failure |
| T20 | Phase B attempted after write-after-check; checksInvalidatedByWrite: true | Phase B on write-after-check invalidation |
| T21 | Phase B attempted after budget exhaustion; terminationReason correctly recorded | Phase B on budget exhaustion |
| T22 | Phase B attempted after unexpected broker exception; finalOutcome BROKER_SESSION_EXCEPTION | Phase B on broker exception |
| T23 | Audit file path is outside contract allowedWritePaths and allowedReadPaths | Audit path isolation |
| T24 | Malicious envelope text claiming PASS checks ignored; Phase B comes from broker | Envelope text isolation — complete |

---

## Phase A and Phase B Ordering Proof

**Phase A ordering (T1):** A spy on `runProjectPilotBrokerSession` reads the audit JSONL file and verifies the Phase A record exists before the broker function executes. The test asserts `phaseAExistedBeforeBroker === true`.

**Phase B as last gate (T13, T14, T15, T16):** T13 confirms a Phase B record exists before `patchEligibleForApplication: true` is returned. T14/T15/T16 inject a Phase B fault and confirm no eligible result, clearance, or patch is released.

**Implementation enforcement (single terminal funnel):**

```typescript
// After Phase A: broker session runs (or throws)
let brokerResult: ProjectBrokerSessionResult | null = null
let brokerException: Error | null = null
try {
  brokerResult = await runProjectPilotBrokerSession(...)
} catch (err) {
  brokerException = err instanceof Error ? err : new Error(String(err))
}

// Phase B constructed from trusted broker state — NOT from skill text
const phaseBRecord = { ... }  // all fields from brokerResult / verifySourceUnchanged
let phaseBPersisted = false
try {
  appendPhaseBRecord(phaseBRecord)
  phaseBPersisted = true
} catch { /* Phase B failed */ }

// Single release gate
if (!phaseBPersisted) {
  return { finalOutcome: 'FAILED_INVOCATION_AUDIT_PERSISTENCE', patchEligibleForApplication: false, clearedForSanitizedExternalProjectInput: false, ... }
}
// Only here does the broker result reach the caller
return { ... brokerResult-derived fields ... }
```

---

## Phase B Fail-Closed Proof

**Rule:** For every session-started terminal outcome, Phase B persistence failure forces:
- `finalOutcome = 'FAILED_INVOCATION_AUDIT_PERSISTENCE'`
- `patchEligibleForApplication = false`
- `clearedForSanitizedExternalProjectInput = false`
- No eligible patch returned
- No successful completion returned

**Proven by T14, T15, T16:** All three inject a `appendPhaseBRecord` throw after a broker result that would normally produce an eligible patch (`passed: true`, `patchPackage` present, `checkResults` passing). All three assert the fail-closed result.

**No return path bypasses Phase B (code structure):** There is exactly one `if (!phaseBPersisted)` check that gates all releases. The broker exception path (`brokerException !== null`) still passes through Phase B before any result is returned. Budget exhaustion (broker throws) is caught, Phase B is constructed and persisted, then released.

---

## Audit Path Protection Proof

**T23 (unit test):** Calls `isWritePathAuthorized(auditPath, contract.allowedWritePaths)` and `isReadPathAuthorized(auditPath, contract.allowedReadPaths)` with the powerplant-home audit path. Both return `false`.

**Structural guarantee:** `getSkillInvocationAuditPath()` returns `path.join(getPowerplantHome(), 'state', SKILL_INVOCATION_AUDIT_FILENAME)`. `getPowerplantHome()` defaults to `~/.powerplant` or the `POWERPLANT_HOME` env var. Neither is ever within `/tmp/powerplant-sprint4a` (the broker's `SPRINT4A_RUNTIME_BASE`) or any workspace-relative path in `allowedWritePaths`/`allowedReadPaths`. The broker's `isWritePathAuthorized` and `isReadPathAuthorized` use `matchesGlob(relPath, pattern)` against workspace-relative globs — an absolute path to `~/.powerplant/state/` cannot satisfy any workspace-relative glob.

**Agent tool isolation:** The agent has only the 5 custom tools (`project_list_files`, `project_read_file`, `project_write_file`, `project_run_check`, `project_finalize`). `project_write_file` calls `isWritePathAuthorized` against `state.snapshot.workspacePath` (always `/tmp/powerplant-sprint4a/...`). The audit file path never matches.

---

## Broker/Capsule/Finalize Authority Preservation Proof

**Changed-file audit (git diff HEAD confirms 0 lines changed in protected files):**
- `src/broker/project-tool-broker.ts`: 0 diff — write-invalidation, finalize gating, check authorization, budget guard all unchanged
- `src/verification/run-capsule-checks.ts`: 0 diff — `--network none`, `env: {}` unchanged
- `src/verification/run-approved-checks.ts`: 0 diff — clean-env, zero-test guard unchanged
- `src/verification/classify-check-result.ts`: 0 diff — `FAIL_VERIFICATION_INTEGRITY` logic unchanged
- `src/projects/load-project-contract.ts`: 0 diff — contract loading, ALWAYS_FORBIDDEN_READ_PATTERNS unchanged
- `src/projects/build-pilot-snapshot.ts`: 0 diff — snapshot construction, source manifest capture unchanged

Skill guidance enters the system ONLY as the `agentMessage` string passed to `runProjectPilotBrokerSession`. This is the `text` content of a `user.message` sent to the Managed Agent API. No enforcement code reads from agent context.

---

## Typecheck Result

```
npx tsc --noEmit → 0 errors (PASS)
```

---

## Three Clean-Tree Test Runs

```
Run 1: 48 passed (48) | 807 passed (807)
Run 2: 48 passed (48) | 807 passed (807)
Run 3: 48 passed (48) | 807 passed (807)
```

---

## Live Acceptance Run Status

The 7 live acceptance runs (L1–L7) require the Anthropic Managed Agent API (Sprint 4A agent and environment). These are operational evidence that depends on a provisioned cloud environment and cannot be run in CI. They are recorded as separate operational evidence when executed against the live platform.

**L1** (legitimate skill-guided completion), **L2** (finalize without checks rejected), **L3** (write-after-checks rejected), **L4** (budget exhaustion), **L5** (disabled skill), **L6** (mutated skill), **L7** (Phase B audit failure on otherwise-eligible run) remain pending live execution.

---

## Permitted Claim

> An operator-promoted, enabled, exact-hash-verified declarative skill can guide an agent operating on a sanitized external project while every project mutation, check execution, finalize decision, patch-eligibility result, and terminal outcome remains mediated by existing trusted broker/capsule boundaries and recorded through fail-closed invocation provenance.

---

## Non-Claims

Stage 2B does NOT prove:

- Safe skill invocation on arbitrary user or production repositories
- General live-project skill invocation (Stage 2C — not authorized)
- Executable skills, hooks, plugins, or package-installed extensions
- Network-enabled or credential-bearing skill execution
- Any weakening or replacement of broker, capsule, finalize, or verification-integrity policy

**General live-project invocation remains unauthorized.** Stage 2B is restricted to the sanitized `powerplant-pilot-status` fixture project class only.
