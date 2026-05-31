# Road to Usable — 5 Honest Developer Steps

**Status:** Design complete. Ready to implement in order.  
**Constraint:** All durable clearances from `CLAUDE.md` remain invariant across every feature.

---

## Where We Are Today

The safety substrate is solid:
- `powerplant run` produces a patch + evidence bundle with manifest hashes
- Stage 2C harness enforces typed tool mediation, symlink-safe boundaries, oracle isolation
- `powerplant review` surfaces artifacts; `doctor` shows runtime state
- One verification profile exists: `node-vitest-typescript-v1`

The substrate has been exercised across nine repo classes spanning mechanical and epistemic risk,
with each dogfood-surfaced defect tracked to the release that fixed it — see the
[Dogfood Coverage Ledger](./DOGFOOD_COVERAGE_LEDGER.md).

The gap: **the safe path is not yet the fast path.** A developer targeting a new project must
hand-author YAML, has no guided way to merge a patch, no ergonomic review surface, no way to
chain follow-up tasks, and Python/Go projects have no capsule.

---

## Feature 1 — `powerplant init` Wizard

### Problem
Users must hand-author `.powerplant/POLICY.yaml` + `.powerplant/VERIFY.yaml`. The schema is
correct but opaque. The YAML barrier blocks adoption before the first run.

### Command Surface
```
powerplant init [project-path]     # defaults to cwd
powerplant init --yes              # non-interactive, accept all defaults
powerplant init --stack python     # override detected stack
```

### New Files
| File | Purpose |
|---|---|
| `src/cli/commands/init.ts` | Wizard orchestration, writes generated files, calls `loadProjectContract()` to validate |
| `src/projects/detect-stack.ts` | Sniff `package.json`/`pyproject.toml`/`go.mod`/`Cargo.toml` → return `StackId` |
| `src/projects/generate-policy.ts` | `generatePolicy(stack, projectId)` → POLICY.yaml string |
| `src/projects/generate-verify.ts` | `generateVerify(stack)` → VERIFY.yaml string |

### Stack → Config Mapping
| Stack | includePaths | checks | verificationProfile |
|---|---|---|---|
| `node-ts` | `src/**`, `tests/**`, `package.json`, `tsconfig.json` | `test: npm test`, `typecheck: npx tsc --noEmit` | `node-vitest-typescript-v1` |
| `python` | `src/**`, `tests/**`, `pyproject.toml` | `test: pytest` | `subprocess-python-v1` |
| `go` | `**/*.go`, `go.mod`, `go.sum` | `test: go test ./...` | `subprocess-go-v1` |
| `generic` | `src/**` | _(user must add checks)_ | `subprocess-generic-v1` |

### Invariants
- Generated `projectId` = `<dirname>-<8-char random hex>`
- Always includes `excludePaths: [.git/**, node_modules/**, .env, .env.*, **/*.key, **/*.pem]`
- Runs `loadProjectContract()` on the generated files before reporting success; exits 1 if invalid
- Does not touch any existing `.powerplant/` directory without `--force`

### Integration Point
`src/cli/powerplant.ts` — add `case 'init':` to the switch, import `cmdInit`.

---

## Feature 2 — Approve Flow (branch → patch → commit + draft PR)

### Problem
`powerplant run` produces `~/.powerplant/runs/<project-id>/<run-id>/PATCH.diff` but there is
no automated path from evidence bundle to committed code. Developers copy-paste manually.

### Command Surface
```
powerplant approve <run-id>          # apply patch to git branch + commit
powerplant approve <run-id> --pr     # also draft a PR via `gh pr create --draft`
powerplant approve <run-id> --dry-run  # show what would happen, touch nothing
```

### New Files
| File | Purpose |
|---|---|
| `src/cli/commands/approve.ts` | Orchestrate approve flow |
| `src/runs/apply-patch.ts` | `applyPatch(runDir, projectPath)` — git apply with pre-check |
| `src/runs/evidence-hash.ts` | `computeRunHash(runDir)` → sha256 of run directory manifest |

### Flow (inside `cmdApprove`)
1. Load run artifacts from `~/.powerplant/runs/<project-id>/<run-id>/`
2. Read `SOURCE_MANIFEST.json`; verify project source files are unchanged (same hashes)
   — If drift detected: abort with "Source has changed since run. Re-run or use --force."
3. Compute `evidenceHash = sha256(run directory manifest)` via `computeRunHash()`
4. `git apply --check PATCH.diff` inside the target project — abort if not clean
5. Create branch `powerplant/<run-id>` off current HEAD
6. `git apply PATCH.diff`
7. `git add -A`
8. Commit:
   ```
   feat: <task from TASK.md>

   Powerplant-Run: <run-id>
   Evidence-Hash: <evidenceHash>
   Verification: <PASS|FAIL> (<checks summary from SESSION_SUMMARY.json>)
   ```
9. If `--pr`: `gh pr create --draft --title "<task>" --body "<run-id + evidence link>"`
10. Print: branch name, commit sha, evidence hash, next step

### Invariants
- `clearedForRealProjectMounting: false` is not relevant here — approve operates on the
  **actual** target project's git working tree (the user's own code), which is the intended
  output path. It does not re-mount into any managed agent execution.
- Branch is always `powerplant/<run-id>` — never writes to main/master directly
- If any step fails after branch creation: branch is deleted and error reported
- Requires `git` on PATH; exits with clear error if not found
- `--pr` requires `gh` on PATH; skips PR step with warning if not found

---

## Feature 3 — Review TUI

### Problem
`powerplant review <run-id>` dumps raw artifact text — diffs, verification reports, adversarial
review — in a long unscannable wall. Developers can't see pass/fail at a glance.

### Command Surface
```
powerplant review <run-id>          # structured TUI (default)
powerplant review <run-id> --json   # raw JSON dump for piping
powerplant review <run-id> --diff   # diff only
```

### New Types (`src/contracts/review-render.ts`)
```typescript
interface ReviewRenderState {
  runId: string
  projectId: string
  task: string
  overallStatus: 'PASS' | 'FAIL' | 'RISK' | 'UNKNOWN'
  diff: { files: number; linesAdded: number; linesRemoved: number; raw: string }
  checks: Array<{ name: string; status: 'pass' | 'fail' | 'skip'; exitCode: number; snippet: string }>
  risks: Array<{ severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'; finding: string }>
  nextAction: string   // e.g. "powerplant approve <run-id>" or "Re-run with fixes"
}
```

### TUI Layout (ANSI, no new deps)
```
┌─ Powerplant Review ──────────────────────────────────────── run-id: abc123 ─┐
│ Project: my-app   Task: "Fix the auth token refresh bug"        [  PASS  ]  │
├─ Diff ──────────────────────────────────────────────────────────────────────┤
│ 3 files changed  +47 / -12                                                  │
│  src/auth/refresh.ts   +38 / -8                                             │
│  tests/auth.test.ts    +9  / -4                                             │
├─ Checks ────────────────────────────────────────────────────────────────────┤
│ ✓ test       npm test          exit 0   (12 passed, 0 failed)               │
│ ✓ typecheck  npx tsc --noEmit  exit 0                                       │
├─ Risks ─────────────────────────────────────────────────────────────────────┤
│ [LOW] Token expiry window could be narrowed further                         │
├─ Next ──────────────────────────────────────────────────────────────────────┤
│ powerplant approve abc123                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Changed Files
| File | Change |
|---|---|
| `src/cli/terminal-output.ts` | Add `printReviewTui(state: ReviewRenderState)` alongside existing `printDoctorReport` |
| `src/cli/commands/review.ts` | Parse existing artifacts → `ReviewRenderState`; add `--json`/`--diff` flags |
| `src/contracts/review-render.ts` | New type file |

### Invariants
- Falls back to current raw-dump behavior if terminal width < 60 columns
- `--json` always exits 0 even for failed runs (caller decides what to do)
- Colors respect `NO_COLOR` env var

---

## Feature 4 — Iterative Sessions (Reuse Capsule State)

### Problem
Each `powerplant run` rebuilds from the original sanitized source. Follow-up tasks ("now add
tests for that fix") restart from zero, losing the context of prior approved patches.

### Concept: Session Chain
A **session chain** is a named sequence of approved runs that share a cumulative workspace.
Each `approve` can optionally extend an open session; subsequent `run --session` starts from
that cumulative state instead of the original source.

```
powerplant session create <project-path>          # start a new session
powerplant run --session <session-id> <path> "<task>"  # run against session state
powerplant session list                           # list open sessions
powerplant session status <session-id>            # show chain, manifest hashes
powerplant session close <session-id>             # archive/seal the session
```

### Session State (`~/.powerplant/sessions/<session-id>/`)
```
sessions/<session-id>/
  SESSION.json          # metadata: projectId, created, status, chainLinks[]
  workspace/            # cumulative sanitized workspace (gitignored)
```

`SESSION.json` shape:
```typescript
interface SessionState {
  sessionId: string
  projectId: string
  projectPath: string           // original source path (for drift detection)
  createdAt: string
  status: 'open' | 'closed'
  baseManifestHash: string      // hash of original sanitized workspace
  chainLinks: Array<{
    runId: string
    task: string
    evidenceHash: string
    appliedAt: string
    workspaceManifestHash: string   // cumulative hash after this patch
  }>
}
```

### New Files
| File | Purpose |
|---|---|
| `src/sessions/session-chain.ts` | `createSession()`, `loadSession()`, `extendSession(sessionId, runId)` |
| `src/sessions/session-workspace.ts` | Build and verify cumulative workspace from chain links |
| `src/cli/commands/session.ts` | `cmdSession(subcommand, args)` |

### Changes to Existing Files
| File | Change |
|---|---|
| `src/cli/commands/run.ts` | Add `--session <session-id>` flag; when set, load session workspace instead of re-sanitizing source |
| `src/cli/commands/approve.ts` | Add `--extend-session <session-id>` flag; on success, call `extendSession()` |
| `src/cli/powerplant.ts` | Add `case 'session':` |

### Invariants
- `clearedForRealProjectMounting: false` — unchanged. Session workspace is always a copy, never the live project.
- Session workspace is rebuilt from the stored patch chain on each `run --session`, not persisted as a live directory between runs (avoids stale state drift)
- Session closes automatically if `workspaceManifestHash` doesn't match the expected value (tamper detection)
- A run that fails oracle evaluation cannot extend a session

---

## Feature 5 — Python + Common Stacks

### Problem
Only one verification profile exists: `node-vitest-typescript-v1`. Python, Go, and generic
projects have no capsule and no subprocess evaluator profile, so the `checks` field in POLICY.yaml
is effectively unusable for non-Node projects.

### Two Tiers

**Tier A — Subprocess profiles (fast, no Docker, runs immediately)**
These run checks directly via `execSync` inside a sandboxed subprocess. Same isolation as
`subprocess-node-v1` which already exists for Stage 2C oracle.

**Tier B — Capsule profiles (Docker-isolated, network-off, credential-free)**
These build on the capsule-v1 architecture. Require `docker` on PATH and a pulled image.

### New Verification Profiles (`src/verification/verification-profiles.ts`)

```typescript
'subprocess-python-v1': {
  profileId: 'subprocess-python-v1',
  capsuleImageName: null,   // no Docker; subprocess only
  runtime: 'subprocess',
  defaultChecks: { test: 'pytest', lint: 'ruff check .' },
  networkDuringExecution: false,
  originalProjectMounted: false,
  credentialsPassed: false,
  visibleToAgent: false,
},
'subprocess-go-v1': {
  profileId: 'subprocess-go-v1',
  capsuleImageName: null,
  runtime: 'subprocess',
  defaultChecks: { test: 'go test ./...', build: 'go build ./...' },
  ...
},
'subprocess-generic-v1': {
  profileId: 'subprocess-generic-v1',
  capsuleImageName: null,
  runtime: 'subprocess',
  defaultChecks: {},    // user declares all checks in VERIFY.yaml
  ...
},
'capsule-python-v1': {
  profileId: 'capsule-python-v1',
  capsuleImageName: 'ghcr.io/rbardyla-boop/claude_powerplant/capsule-python-v1@sha256:...',
  runtime: 'capsule',
  ...
},
```

### New Files
| File | Purpose |
|---|---|
| `docker/capsule-python-v1/Dockerfile` | Python 3.12 + pip + poetry + pytest (no network at runtime) |
| `docker/capsule-python-v1/build-manifest.json` | Pinned digest for CI trust root |
| `src/verification/run-subprocess-checks.ts` | Subprocess runner for non-Docker profiles (parallel to `run-capsule-checks.ts`) |

### Changed Files
| File | Change |
|---|---|
| `src/verification/verification-profiles.ts` | Add `subprocess-python-v1`, `subprocess-go-v1`, `subprocess-generic-v1`, `capsule-python-v1` |
| `src/contracts/verification-profile.ts` | Add `runtime: 'subprocess' | 'capsule'` discriminant + `capsuleImageName: string | null` |
| `src/verification/run-approved-checks.ts` | Route to `runSubprocessChecks` vs `runCapsuleChecks` based on `profile.runtime` |
| `src/config/constants.ts` | Add `CAPSULE_PYTHON_V1_*` constants matching capsule-v1 pattern |

### `detect-stack.ts` Integration (shared with Feature 1)
```typescript
export type StackId = 'node-ts' | 'python' | 'go' | 'rust' | 'generic'

export function detectStack(projectPath: string): StackId {
  if (exists(join(projectPath, 'package.json')))    return 'node-ts'
  if (exists(join(projectPath, 'pyproject.toml')))  return 'python'
  if (exists(join(projectPath, 'go.mod')))          return 'go'
  if (exists(join(projectPath, 'Cargo.toml')))      return 'rust'
  return 'generic'
}

export function stackToProfile(stack: StackId): string {
  const map: Record<StackId, string> = {
    'node-ts':  'node-vitest-typescript-v1',
    'python':   'subprocess-python-v1',
    'go':       'subprocess-go-v1',
    'rust':     'subprocess-generic-v1',   // until capsule-rust-v1 exists
    'generic':  'subprocess-generic-v1',
  }
  return map[stack]
}
```

---

## Build Order

Dependencies flow like this — implement in this order to unblock each next feature:

```
Step 0 (shared foundation, needed by F1 + F5):
  src/projects/detect-stack.ts

Step 1 — Feature 5 subprocess profiles (no Docker required, unblocks testing):
  src/contracts/verification-profile.ts          ← add runtime discriminant
  src/verification/verification-profiles.ts      ← add subprocess-* profiles
  src/verification/run-subprocess-checks.ts      ← new subprocess runner
  src/verification/run-approved-checks.ts        ← route by profile.runtime

Step 2 — Feature 1 init wizard (can be done in parallel with Step 1):
  src/projects/generate-policy.ts
  src/projects/generate-verify.ts
  src/cli/commands/init.ts
  src/cli/powerplant.ts                          ← add 'init' case

Step 3 — Feature 3 review TUI (independent of all others):
  src/contracts/review-render.ts
  src/cli/terminal-output.ts                     ← add printReviewTui()
  src/cli/commands/review.ts                     ← --json / --diff flags

Step 4 — Feature 2 approve flow (needs F1 to have runnable contracts):
  src/runs/evidence-hash.ts
  src/runs/apply-patch.ts
  src/cli/commands/approve.ts
  src/cli/powerplant.ts                          ← add 'approve' case

Step 5 — Feature 4 iterative sessions (needs F2 approve to anchor chain):
  src/sessions/session-chain.ts
  src/sessions/session-workspace.ts
  src/cli/commands/session.ts
  src/cli/commands/run.ts                        ← add --session flag
  src/cli/commands/approve.ts                    ← add --extend-session flag
  src/cli/powerplant.ts                          ← add 'session' case

Step 6 — Feature 5 capsule tier (deferred; requires Docker image CI pipeline):
  docker/capsule-python-v1/Dockerfile
  docker/capsule-python-v1/build-manifest.json
  src/config/constants.ts                        ← CAPSULE_PYTHON_V1_* constants
  src/verification/verification-profiles.ts      ← add capsule-python-v1 profile
```

---

## Testing Discipline (per feature)

Each feature follows the existing pattern: negative tests before positive, no fabricated receipts,
evidence checked via actual file reads or command output.

| Feature | Key negative tests |
|---|---|
| init | `--force` absent + existing POLICY.yaml → exits 1 without touching files |
| approve | Source drift detected → abort before branch creation; `git apply --check` fails → abort before branch creation |
| review TUI | Missing artifact → falls back to raw dump or exits 1; `--json` with failed run → exits 0 |
| sessions | Tampered workspace manifest → session closes automatically; chain link with failed oracle → cannot extend |
| Python stacks | Unknown profileId still fails closed; subprocess-python-v1 with missing pytest → honest FAIL check result |

---

## What This Achieves

After these 5 features:

1. **Day-0 experience:** `cd my-project && powerplant init && powerplant run . "fix the login bug"` works in under 2 minutes for Node/TS or Python projects.
2. **Merge path:** `powerplant approve <run-id>` creates a branch + signed commit — reviewer gets a PR with evidence hash traceable to the run.
3. **Scan-able review:** Pass/fail at a glance. Risks sorted. One-line next action.
4. **Iteration:** `powerplant run --session <id> . "now add tests"` continues where the last approved run left off — no re-sanitizing from scratch.
5. **Multi-stack:** Python and Go projects work with subprocess profiles immediately; capsule isolation for Python is the Step 6 hardening path.

The safety invariants — typed tool mediation, symlink-safe boundaries, oracle isolation, `clearedForRealProjectMounting: false` — are unchanged throughout.
