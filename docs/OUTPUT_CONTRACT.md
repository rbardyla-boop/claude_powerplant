# Output Contract

Every completed task in CLAUDE_POWERPLANT produces a single
`ArtifactManifest` value. The manifest is the only structured surface the
rest of the system (callers, CI, dashboards) reads. Everything else lives
on disk as artifacts the manifest points to.

The schema lives in `src/contracts/artifact-manifest.ts` and is enforced
at runtime via Zod. Sprint 1+ writes must round-trip through
`ArtifactManifestSchema.parse(...)` before being returned to a caller.

## Shape

```ts
interface ArtifactManifest {
  status: 'succeeded' | 'failed' | 'blocked'
  taskId: string
  artifacts: ArtifactPaths
  verificationCommands: VerificationCommand[]
  blockedReason?: string
}

interface ArtifactPaths {
  patch: string
  changedFiles: string
  verificationReport: string
  adversarialReview: string
  sessionSummary: string
}

interface VerificationCommand {
  command: string
  result: string
}
```

## Required artifacts

All five paths are non-empty strings. They point to files written during
the session.

| Field                | File                          | Purpose                                                                 |
| -------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| `patch`              | `PATCH.diff`                  | Unified diff of every change the session made to the workspace.         |
| `changedFiles`       | `CHANGED_FILES.md`            | Human-readable list of changed paths with a one-line rationale each.    |
| `verificationReport` | `VERIFICATION_REPORT.md`      | Captured stdout/stderr of every command in `verificationCommands`.      |
| `adversarialReview`  | `ADVERSARIAL_REVIEW.md`       | Red-team pass: what could break, what the reviewer agent challenged.    |
| `sessionSummary`     | `SESSION_SUMMARY.json`        | Structured event log (turn count, tool calls, model usage).             |

The contract does not specify the directory — that is decided per run by
the caller and stored as-is in the manifest. Paths may be absolute or
workspace-relative.

## Field invariants

- `status`:
  - `succeeded` — all verification commands ran and the patch applied
    cleanly.
  - `failed` — the session ran to completion but at least one verification
    command failed.
  - `blocked` — the session stopped early (turn cap, permission denial,
    refusal). `blockedReason` must be set.
- `taskId` — non-empty. Stable across retries of the same task. Used as
  the primary key for downstream storage.
- `artifacts.*` — each entry is a non-empty path string.
- `verificationCommands` — may be empty when `status === 'blocked'`. For
  `succeeded` it must contain at least one passing entry. The schema
  itself does not enforce that minimum; the orchestrator does.
- `blockedReason` — present iff `status === 'blocked'`. The schema
  permits it on any status, but the orchestrator should only set it when
  blocked.

## How Sprint 1 populates this

Once Sprint 1 lands the managed agents path, the manifest is built at the
end of a session:

1. Walk the workspace and produce `PATCH.diff` from a `git diff` against
   the session's starting commit.
2. Derive `CHANGED_FILES.md` from the patch plus per-file notes the
   session emitted.
3. Run every verification command in order, captureing output into
   `VERIFICATION_REPORT.md`, and record `{ command, result }` pairs.
4. Run the adversarial-review pass and write `ADVERSARIAL_REVIEW.md`.
5. Serialize the session event stream into `SESSION_SUMMARY.json`.
6. Build the `ArtifactManifest` object, validate it through
   `ArtifactManifestSchema.parse(...)`, and write it out.

If validation fails, the run is treated as a system error, not a task
failure. Sprint 0's tests exist to make that distinction tight before any
real session can produce data.
