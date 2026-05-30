# Road to Usable — v0.2 Status

_Last updated: 2026-05-30_

This document records the completion state of each Road to Usable step and the honest v0.2 usability boundary.

---

## Step Status

| Step | Description | Status |
|------|-------------|--------|
| Step 0 | Stack detection (`detect-stack.ts`, `stackToProfile`) | ✓ Complete |
| Step 1 | Subprocess verification profiles (`subprocess-python-v1`, `subprocess-go-v1`, `subprocess-generic-v1`) | ✓ Complete |
| Step 2 | `powerplant init` wizard with `--yes`, `--force`, `--stack` flags | ✓ Complete |
| Step 3 | `powerplant review` structured TUI with `--json` and `--diff` modes | ✓ Complete |
| Step 4 | `powerplant approve` with source drift check, evidence hash, `--dry-run`, `--pr` | ✓ Complete |
| Step 5 | `powerplant session` chain — create, list, status, close; `run --session`, `approve --extend-session` | ✓ Complete |
| Step 6 | Python capsule tier (Docker-isolated Python execution) | ⏸ Deferred |
| Stage 2C | Live managed-agent path (`stage2c-run.ts`) | 🔒 Gated — not default |

---

## Completed Workflow

```
powerplant init --yes                          # detect stack, write POLICY.yaml + VERIFY.yaml
powerplant run . "task"                        # run against sanitized copy, produce patch bundle
powerplant review <run-id>                     # TUI: diff, checks, risks, next action
powerplant review <run-id> --json              # machine-readable state
powerplant approve <run-id> --dry-run          # pre-flight: drift + patch check, no git writes
powerplant approve <run-id>                    # apply patch to branch with evidence hash
powerplant session create .                    # create iterative session, snapshot base workspace
powerplant run --session <id> . "follow-up"   # run in session context
powerplant approve <run-id> --extend-session <id>  # extend session chain (requires passing run)
powerplant session status <id>                 # inspect session state and chain links
```

---

## Verified Stack Coverage (init wizard + subprocess profiles)

| Stack | Detection file | Verification profile |
|-------|----------------|---------------------|
| node-ts | `package.json` | `node-vitest-typescript-v1` |
| python | `pyproject.toml` | `subprocess-python-v1` |
| go | `go.mod` | `subprocess-go-v1` |
| rust | `Cargo.toml` | `subprocess-generic-v1` |
| generic | (fallback) | `subprocess-generic-v1` |

---

## Deferred: Step 6 — Python Capsule Tier

Python subprocess verification (`subprocess-python-v1`) generates a correct VERIFY.yaml and the check command `pytest` is recorded in the contract. However, no Docker-isolated capsule is wired for Python execution. A Python `powerplant run` would invoke `pytest` in the subprocess profile path, which requires `pytest` to be installed in the local environment. The capsule-isolated Python execution tier (analogous to `capsule-v1` for Node) is deferred.

**What Step 6 requires:**
- A Python-specific Dockerfile or executor entrypoint
- Network isolation proof equivalent to the existing Node capsule vectors
- P0-C capsule trust-root tests for the Python path

---

## Stage 2C — Live Managed-Agent Path

The Stage 2C managed-agent harness (`src/cli/stage2c-run.ts`) is implemented and tested (259 tests, including oracle capsule trust-root proofs). It is intentionally gated:

- Not invoked by default `powerplant run`
- Requires explicit invocation via `npm run stage2c:runner`
- No live API key required for the non-live test suite
- Live smoke is optional and not required for Road to Usable release-readiness

---

## Honest v0.2 Boundary

**What works today without an API key:**
- `powerplant init`, `inspect`, `verify`, `doctor`, `review`, `approve`, `session`

**What requires ANTHROPIC_API_KEY:**
- `powerplant run` — calls Claude to implement the task

**What requires Docker:**
- Stage 2C capsule execution path
- Step 6 Python capsule tier (deferred)

**What is not yet claimed:**
- Production readiness of the Stage 2C trust kernel
- L2–L7 completion
- Cryptographic resistance to a malicious operator with write access to the acceptance directory
- Multi-language capsule isolation (Go, Rust, Python) with verified network isolation

---

## Test and Smoke Coverage

- Unit/integration tests: 1496 passing (as of Step 5 merge)
- End-to-end smoke: `scripts/smoke-road-to-usable.ts` — exercises init → review → approve (dry-run) → session without a live API key
- Live agent run: not in automated smoke (requires API key)

See `scripts/smoke-road-to-usable.ts` for the executable smoke checklist.
