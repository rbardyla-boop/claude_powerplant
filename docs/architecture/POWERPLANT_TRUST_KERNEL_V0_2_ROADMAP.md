# Trust Kernel v0.2 Roadmap

**Recorded:** 2026-05-29  
**Branch baseline:** `feat/stage2b-preflight` @ `c9aa2d3`

---

## Product boundary

Claude-Powerplant is the control plane and the product.

Polymarket and NN are downstream clients and adversarial validation environments only.
No downstream work is authorized unless it either contains an active production incident
or validates an already-defined generic Powerplant primitive.

---

## Extracted incident lessons

The Row 79 incident and subsequent Phase 0D.2 containment work produced reusable trust-kernel
requirements. The primitives derived from these lessons must be built in Claude-Powerplant
first and validated against downstream clients later — not developed inside the downstream
repos and ported back.

| Incident lesson | Generic Powerplant primitive | Status |
|---|---|---|
| Unauthorized write occurred before authorization | `ActionAuthorizationReceipt` / pre-side-effect provenance seal | Deferred until after P0 |
| Dirty or untracked runtime source produced false provenance | `RuntimeProvenanceSeal` | Deferred until after P0 |
| Contaminated event needed exclusion without deletion | `EvidenceDispositionLedger` | Deferred until after P0 |
| Mutable/gitignored epoch could not establish authority | Durable authorization receipt ledger | Deferred until after P0 |
| False verification PASS | Broker verification-integrity gate | Already implemented/proven |
| Task/guidance authority defect | Two-hash composition and broker truth repair | Implemented; live acceptance pending |
| Oracle can execute hostile generated code | Isolated oracle evaluator | **Current P0 scope — proven** |

---

## Current implementation slice

**Trust Kernel v0.2 / Milestone 1:**  
Stage 2B Preflight Gates P0-A, P0-B, and P0-C only.

### P0-A — Immutable oracle artifact

- Source-controlled operator-task oracle (`tests/oracle/operator-task-oracle.mjs`)
- Isolated bundle creation with SHA-256 lock (`src/preflight/oracle-bundle.ts`)
- Tamper-detection receipt; `agentModifiedCodeExecuted: false` field
- 12 tests passing: `tests/preflight/p0-a-oracle-artifact.test.ts`
- Terminal: `P0_A_ORACLE_ARTIFACT_PROVEN`

### P0-B — Deterministic tool-channel confinement

- Model-free policy enforcer evaluated against the managed-agent tool boundary (`src/preflight/tool-policy.ts`)
- Forbidden categories: unrestricted write, shell execution, credential read, unrestricted network, state-path access, unknown builtins
- `deniedBeforeExecution: true` on every DENY result; `noActionTaken: true`
- 23 tests passing: `tests/preflight/p0-b-tool-confinement.test.ts`
- Terminal: `P0_B_TOOL_CHANNEL_CONFINEMENT_PROVEN`

### P0-C — Isolated oracle execution

Subprocess-layer proof (`src/preflight/oracle-evaluator.ts`, 9 tests) plus full Docker
capsule-v1 proof (`src/preflight/capsule-evaluator.ts`, 14 tests against F1–F12 hostile fixtures):

| Control | Mechanism | Verified |
|---|---|---|
| `network_isolation` | `--network=none` | F5 async HTTP blocked |
| `full_filesystem_isolation` | Three mounts only; no host state | F3, F8, F10 |
| `timeout_enforcement` | `spawn` + `setTimeout` + `docker kill` | F6 infinite loop |
| `output_cap` | Stdout byte counting + kill | F7 flood |
| `workspace_readonly` | `chmod` + Docker read-only bind | F4 write blocked |
| `env_scrubbing` | Docker default env isolation | F11 sentinel absent |
| `readonly_rootfs` | `--read-only` | F12 oracle mutation blocked |

Oracle visibility contract: `PUBLIC_BY_DESIGN` — oracle is source-controlled; test vectors are the spec.  
Docker image: `powerplant-evaluator:node-test-js-v1` (Node 20, non-root `ppeval`, 200 MB).  
Terminal: `STAGE_2B_P0_C_CAPSULE_PROVEN`

---

## Milestone 2 — Evidence and side-effect governance (deferred)

Design after P0 passes. Build domain-neutral primitives:

- `ActionAuthorizationReceipt`
- `RuntimeProvenanceSeal`
- `EvidenceDispositionLedger`
- `EligibleClaimCohort`

These govern any project Claude-Powerplant touches, not just trading.

## Milestone 3 — Stage 2B controlled acceptance (deferred)

L0–L7 using isolated state, bounded guidance fixtures, immutable oracle evidence,
and tool-channel proof. Only after P0.

## Milestone 4 — Downstream validation (deferred)

One external client after the trust kernel exists:
- Polymarket for write-provenance / cohort-quarantine validation; or
- NN for execution / evidence-capture validation.

Not both at once.

---

## Freeze rule

Polymarket and NN repos remain frozen except for:

1. Emergency containment of a new production-impacting incident.
2. Read-only evidence retrieval needed to define a Powerplant primitive.
3. Later validation of a primitive already implemented in Claude-Powerplant core.

Active downstream milestone, final:
`PHASE_0D2_ANALYTICAL_QUARANTINE_AND_PREWRITE_PROVENANCE_HARDENED_NEW_EPOCH_STILL_NOT_ARMED`

Do not arm the new Polymarket epoch, enable cron, resume production paper writes,
or begin another downstream feature phase.
