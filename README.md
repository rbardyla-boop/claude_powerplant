# Powerplant

**Powerplant lets Claude produce tested patches from sanitized project snapshots without touching your working repository, inheriting your secrets, or receiving unrestricted execution authority.**

Version: v0.1 (contract-driven engine)

---

## What it does

Powerplant runs Claude against a disposable, sanitized copy of a project. Claude operates exclusively through five typed custom tools — it cannot browse the web, run arbitrary shell commands, or read files outside the allowed set. The original project is never modified. The result is a `PATCH.diff` and an evidence bundle you review manually before deciding whether to apply the patch.

```
powerplant inspect <project-path>
powerplant run [--yes] <project-path> "<task>"
powerplant review <run-id>
```

---

## Three commands

### `powerplant inspect <project-path>`

Shows what Claude would be allowed to read, modify, and run — before starting any session. No API call is made. Writes a signed inspection report to `~/.powerplant/inspections/`.

```bash
powerplant inspect /path/to/safe-project
```

### `powerplant run [--yes] <project-path> "<task>"`

Runs Claude on a sanitized copy of the project. Claude implements the task using only typed project tools, verifies its work by running the allowed test check, and returns a patch package. The `--yes` flag skips the confirmation prompt.

```bash
powerplant run --yes /path/to/safe-project "Add input validation and deterministic tests."
```

On completion you receive:
- A run ID (e.g. `pp-run-1779966263586`)
- Pass/fail status of the test check
- A `PATCH.diff` at `~/.powerplant/runs/<project-id>/<run-id>/`

**Patches are not automatically applied.** You decide.

### `powerplant review <run-id>`

Displays the full evidence bundle for a run: task, changed files, verification result, security summary, and (when present) the prompt envelope showing what was actually sent to Claude.

```bash
powerplant review pp-run-1779966263586
```

---

## v0.1 safety boundary

| Property | Status |
|---|---|
| Original project mounted in executor | Never |
| Original project modified | Never |
| Claude's built-in tools (Bash, browser, file I/O) | 0 — custom tools only |
| Network access inside executor | Disabled |
| Credentials passed to executor | None |
| Patch auto-applied | Never |

Every run is verified and recorded. `SESSION_SUMMARY.json` carries the containment flags. `PROMPT_ENVELOPE.json` carries the exact message sent to the model, its SHA-256 hash, model ID, and protocol version — so runs are reproducible.

---

## Supported project profile for v0.1

Powerplant v0.1 is appropriate for projects that meet all of the following:

- Small (a few source files), no live secrets or API keys in source
- Has a `.powerplant/` contract folder declaring allowed read/write/check paths
- Uses `node --test` or a similar sandboxed test runner for verification
- Owned by you and not connected to production systems, payments, or live databases

**Not appropriate for v0.1:**
- Repos containing API keys, database credentials, or deployment config
- Projects connected to live trading, payments, or user data
- Monorepos or large projects with complex build chains
- Anything you would not be comfortable letting Claude read in full

---

## First use

### 1. Give a project a `.powerplant/` contract

Create `.powerplant/POLICY.yaml` and `.powerplant/VERIFY.yaml` in your project. Both files are **required and operative** — Powerplant reads and enforces them. A YAML file that exists but does not match the expected schema fails closed before any snapshot is built.

**POLICY.yaml** — declares what Claude may see and change:

```yaml
projectId: my-project

includePaths:       # files copied into the sanitized snapshot
  - package.json
  - src/engine/**
  - .powerplant/**

excludePaths:       # files that must never enter the snapshot
  - .env
  - src-tauri/**
  - dist/**

denyIfPresentAfterCopy:   # snapshot validation canaries
  - .env
  - credentials.json

allowedReadPaths:   # files Claude may request via project_read_file
  - package.json
  - src/engine/**

allowedWritePaths:  # files Claude may write (disposable workspace only)
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

Read the output. Confirm the file disclosure set is acceptable.

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

## Run artifacts

Every run produces a bundle at `~/.powerplant/runs/<project-id>/<run-id>/`:

| File | Purpose |
|---|---|
| `TASK.md` | Clean developer request (no internal protocol text) |
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

400 tests. Clean typecheck. No network calls in the test suite.

---

## What Powerplant does not do in v0.1

- Apply patches automatically
- Integrate with GitHub or any CI system
- Support arbitrary build systems or languages beyond the pilot contract
- Mount real project directories into the executor
- Support multi-agent workflows
- Provide a dashboard or web UI
- Integrate with `poly/` or any trading system
- Claim to be safe for sensitive enterprise repositories
