# Claude Powerplant

Claude Powerplant is a trust-bounded skill lifecycle and acceptance harness for agent-assisted project work. It is designed to separate candidate workspaces from real project state, evaluate candidate changes inside controlled boundaries, and record evidence sufficient to support or reject bounded acceptance claims.

---

## Current Verified Status

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

---

## What Is Not Yet Claimed

This project does not yet claim:

- Cryptographic resistance to a malicious operator controlling the acceptance directory
- Completion of L2–L7
- General production readiness of all trust-kernel surfaces
- Clean removal of older runtime metadata from already-public Git history

---

## Validation / Test Status

- Local configured checkout: `1042/1042` tests passing, typecheck clean
- Clean checkout without external pilot-source configuration: repository-contained tests pass; pilot-dependent integration tests are conditionally skipped when `SPRINT4A_PILOT_SOURCE_PATH` is unset
- Normal validation commands: `npm test` and `npx tsc --noEmit`
- Pilot-integration coverage requires `SPRINT4A_PILOT_SOURCE_PATH` set to the external pilot project directory; see `.env.example`

---

## What It Does

Powerplant runs Claude against a disposable, sanitized copy of a project. Claude operates exclusively through five typed custom tools — it cannot browse the web, run arbitrary shell commands, or read files outside the allowed set. The original project is never modified. The result is a `PATCH.diff` and an evidence bundle you review manually before deciding whether to apply the patch.

```
powerplant inspect <project-path>
powerplant run [--yes] <project-path> "<task>"
powerplant review <run-id>
```

### `powerplant inspect <project-path>`

Shows what Claude would be allowed to read, modify, and run — before starting any session. No API call is made. Writes a signed inspection report to `~/.powerplant/inspections/`.

### `powerplant run [--yes] <project-path> "<task>"`

Runs Claude on a sanitized copy of the project. Claude implements the task using only typed project tools, verifies its work by running the allowed test check, and returns a patch package. The `--yes` flag skips the confirmation prompt.

On completion you receive:
- A run ID (e.g. `pp-run-1779966263586`)
- Pass/fail status of the test check
- A `PATCH.diff` at `~/.powerplant/runs/<project-id>/<run-id>/`

**Patches are not automatically applied.** You decide.

### `powerplant review <run-id>`

Displays the full evidence bundle for a run: task, changed files, verification result, security summary, and (when present) the prompt envelope showing what was actually sent to Claude.

---

## Stage 2B L1 Accepted Safety Boundary

These properties describe the bounded Stage 2B L1 accepted execution path; they are not claims about every historical prototype or future stage.

| Property | Status |
|---|---|
| Original project mounted in executor | Never |
| Original project modified | Never |
| Claude's built-in tools (Bash, browser, file I/O) | 0 — custom tools only |
| Network access inside executor | Disabled |
| Credentials passed to executor | None |
| Patch auto-applied | Never |

Every run is verified and recorded. `SESSION_SUMMARY.json` carries the containment flags. `PROMPT_ENVELOPE.json` carries the exact message sent to the model, its SHA-256 hash, model ID, and protocol version.

---

## Supported Project Profile

Powerplant is appropriate for projects that meet all of the following:

- Small (a few source files), no live secrets or API keys in source
- Has a `.powerplant/` contract folder declaring allowed read/write/check paths
- Uses `node --test` or a similar sandboxed test runner for verification
- Owned by you and not connected to production systems, payments, or live databases

**Not appropriate:**
- Repos containing API keys, database credentials, or deployment config
- Projects connected to live trading, payments, or user data
- Monorepos or large projects with complex build chains
- Anything you would not be comfortable letting Claude read in full

---

## First Use

### 1. Give a project a `.powerplant/` contract

Create `.powerplant/POLICY.yaml` and `.powerplant/VERIFY.yaml` in your project. Both files are required and operative.

**POLICY.yaml** — declares what Claude may see and change:

```yaml
projectId: my-project

includePaths:
  - package.json
  - src/engine/**
  - .powerplant/**

excludePaths:
  - .env
  - src-tauri/**
  - dist/**

denyIfPresentAfterCopy:
  - .env
  - credentials.json

allowedReadPaths:
  - package.json
  - src/engine/**

allowedWritePaths:
  - src/engine/tests/**
```

**VERIFY.yaml** — declares named verification checks:

```yaml
checks:
  test:
    command: "node --test"
```

Hard-coded invariants the YAML cannot override: `workspaceMode: sanitized_copy_only`, `realProjectMounted: false`, no bash, no network, no credential passthrough.

### 2. Inspect before sending anything to Claude

```bash
powerplant inspect /path/to/safe-project
```

### 3. Run one task

```bash
powerplant run --yes /path/to/safe-project \
  "Add validation for empty inputs and add deterministic tests."
```

### 4. Review the returned patch

```bash
powerplant review <run-id>
cat ~/.powerplant/runs/<project-id>/<run-id>/PATCH.diff
```

### 5. Apply manually

Copy the changes yourself. Powerplant proposes; you decide.

---

## Run Artifacts

Every run produces a bundle at `~/.powerplant/runs/<project-id>/<run-id>/`:

| File | Purpose |
|---|---|
| `TASK.md` | Clean developer request |
| `PROMPT_ENVELOPE.json` | Exact message sent to Claude, SHA-256 hash, model ID, protocol version |
| `PATCH.diff` | Proposed changes as a unified diff |
| `CHANGED_FILES.md` | List of files modified by Claude |
| `SOURCE_MANIFEST.json` | Pre- and post-run source integrity verification |
| `SANITIZED_MANIFEST.json` | Files that entered the sanitized snapshot |
| `VERIFICATION_REPORT.md` | Test check output |
| `ADVERSARIAL_REVIEW.md` | Remaining limitations and what the run proves |
| `SESSION_SUMMARY.json` | Containment flags and run metadata |

---

## Installation

```bash
npm install
npm link          # makes `powerplant` available globally
```

Requires `ANTHROPIC_API_KEY` in your environment or a `.env` file.

Copy `.env.example` to `.env` and fill in the values before first use.

---

## Development

```bash
npm run typecheck
npm test
```

---

## Documentation Map

| Document | Purpose | Authority |
|---|---|---|
| `README.md` | Public orientation and current verified status | Public summary only |
| `docs/BUILD_LOG.md` | Chronological engineering journal and work trail | Non-normative |
| `docs/architecture/Stage 2B Completion and GitHub Release Ledger.md` | Formal gate status and trust-boundary record | Canonical stage-status authority |
| `docs/acceptance/STAGE_2B_L1_LIVE_ACCEPTANCE_REPORT.md` | Sanitized record of the accepted bounded live run | Canonical acceptance evidence |
| `docs/architecture/POWERPLANT_TRUST_KERNEL_V0_2_ROADMAP.md` | Deferred milestone and incident-lessons design notes | Non-normative design record |

---

## Security / Public History Note

Current tracked files have been sanitized of identified live runtime identifiers and operator-local paths. Earlier non-credential runtime metadata remains in already-public Git history; no history rewrite has been performed.

---

## What Powerplant Does Not Do

- Apply patches automatically
- Integrate with GitHub or any CI system
- Support arbitrary build systems or languages beyond the pilot contract
- Mount real project directories into the executor
- Support multi-agent workflows
- Claim L2–L7 completion or overall production readiness of the trust kernel
