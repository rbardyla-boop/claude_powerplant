# Stage 2B L1 Live Acceptance Report

Gate 4 outcome — one bounded live L1 execution under trusted-directory assumption.

---

## Scope

- Exactly one bounded live L1 run was executed. No retry was performed.
- No source files, test files, or documentation were modified during or after execution.
- L2 through L7 were not exercised and are not claimed.
- This report covers the single Gate 4 execution only.

---

## Preconditions

| Item | Value |
|---|---|
| Branch | `feat/stage2b-preflight` |
| Starting commit | `8bfc1ff` |
| Worktree state | Clean |
| Pre-run test suite | 1039/1039 passed |
| Pre-run typecheck | `npx tsc --noEmit` — clean |

---

## Trust Boundary

### Substantive Claim

> Stage 2B L1 completed one bounded live acceptance run under a documented trusted-directory
> assumption. The run verified consistency between the L0-generated receipt and isolated promoted
> registry during an operator-controlled bootstrap-to-L1 handoff.

### Limitation

> This acceptance does not claim cryptographic resistance to pre-run receipt-and-registry
> co-substitution by an actor with write access to the operator-controlled acceptance directory.

---

## Sanitized Evidence Table

| Evidence Item | Result |
|---|---|
| Acceptance directory control | Fresh operator-controlled directory; owner-only permissions confirmed |
| L0 bootstrap | Completed successfully once |
| Trusted-directory handoff | Receipt and registry hashes unchanged between bootstrap and L1 invocation |
| Live invocation count | Exactly one; no retry |
| External session | Entered; identifier redacted |
| Built-in tool evidence | `builtinToolUseCount === 0` |
| Temporal proof | `17:28:43.606Z < 17:28:43.620Z` |
| Audit ordering | Phase A line `0` before Phase B line `1` |
| Candidate containment | `sanitizedWorkspaceUsed: true`; `originalProjectMounted: false` |
| Real-project immutability | `manifestUnchanged: true` |
| Oracle isolation | Network disabled; read-only rootfs; capabilities dropped; `PASS (4/4)` |
| Repository integrity after run | Clean worktree; no source/test/doc changes |
| Secret hygiene | No credentials committed; external session identifier redacted |

---

## Verdict

```
L1_LIVE_ACCEPTED_UNDER_TRUSTED_DIRECTORY_ASSUMPTION
```

---

## Raw Runtime Artifacts

Raw runtime artifacts (acceptance directory contents, unredacted receipts, JSONL audit log)
remain outside version control. They are pending separate sanitation and disposition review
before any version-controlled representation is considered.

---

## Remaining Release Work

Public GitHub publication remains blocked pending Gate 6 review. The following tasks are
required before publication:

- Committed-artifact secret scan (full history)
- History scan for secrets across all branches
- README truth-language review (no overclaims)
- CI workflow validation from a clean checkout
- Security policy and repository hardening review (branch protection, required checks)
- Pull-request-based publication workflow

No source, test, or documentation changes were made as part of this Gate 4 execution.
