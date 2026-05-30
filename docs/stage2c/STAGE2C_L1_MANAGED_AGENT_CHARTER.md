# Stage 2C — L1 Managed-Agent Harness Charter

## Goal

Prove that the Stage 2B trust-bounded acceptance harness can supervise one bounded
managed-agent coding attempt against a sanitized workspace, then evaluate the result
through the isolated oracle capsule and emit truthful evidence receipts.

## Scope

- Sanitized candidate workspace only.
- Typed tool mediation only.
- Built-in agent browser/network tools forbidden.
- Real repository state immutable.
- Oracle evaluation remains isolated in capsule-v1.
- Evidence receipts must distinguish attempted, observed, blocked, failed, and unobserved events.

## Non-Claims

- No autonomous safety proof.
- No general sandbox escape proof.
- No production containment claim.
- No MCP / watcher / proof graph / skill write-back work.
- No claim that arbitrary agents are safe.

## Required Proof Surfaces

- Pre/post manifest hash comparison for real repo immutability.
- Builtin tool-use count proves zero, or run fails.
- Sanitized workspace diff captured.
- Oracle capsule result captured.
- Terminal outcome classified without fabricated fields.
- Failure paths produce honest receipts.

## Implementation Sequence

1. `stage2c-runner` skeleton — accepts one task, creates sanitized workspace, records
   pre-manifest.
2. Tool mediation contract — only explicit typed tools; no agent-native file/network/browser paths.
3. Managed-agent adapter stub — deterministic local fake first; proves boundary before real
   transport is wired.
4. Receipt schema upgrade — add `agent_attempt`, `tool_events`, `builtin_tool_use_count`,
   `workspace_diff`, `terminal_outcome`.
5. Oracle capsule integration — reuse Stage 2B evaluator unchanged.
6. Negative tests first — builtin tool use, write outside workspace, missing receipt field,
   oracle failure, broker exception.
7. Real managed-agent API transport wired behind the same adapter only after negative tests pass.

## Step 7 Status

Step 7 introduces the live managed-agent transport gate and adapter contract only.
It does not prove live managed-agent execution.

The `--managed-agent` CLI flag and `STAGE2C_MANAGED_AGENT_ENABLED=1` env gate are
both required for the live path to be eligible.  In Step 7 the live path is not yet
wired: when only the CLI flag is present the runner emits a `MANAGED_AGENT_BLOCKED_NOT_ENABLED`
receipt with `agentExecutionAttempted: false`.  No SDK import is added; no API client
is called; no workspace mutation occurs.  The `ManagedAgentAdapter` interface exists
as internal scaffolding for Step 8.

## Step 8 Status

Step 8 proves the enabled adapter execution boundary using a deterministic internal
adapter only.  It still does not prove live managed-agent execution.

When both gates are satisfied (`--managed-agent` flag + `STAGE2C_MANAGED_AGENT_ENABLED=1`)
but no concrete adapter is wired (production CLI path), the runner emits a
`MANAGED_AGENT_BLOCKED_NO_ADAPTER` receipt with `agentExecutionAttempted: false`.

A deterministic test adapter injected via the `_managedAgentAdapterForTesting` seam
(tests only, not reachable from `runStage2cSkeleton`) proves the full execution
boundary: the adapter proposes typed `WRITE_FILE` tool actions; the runner validates
each against the symlink-safe canonical workspace boundary before applying any write.
Denied actions produce an honest `MANAGED_AGENT_ADAPTER_TOOL_DENIED_OUTSIDE_WORKSPACE`
receipt.  Successful execution produces `MANAGED_AGENT_ADAPTER_WORKSPACE_MUTATION_RECORDED`
with `agentExecutionAttempted: true`, `builtinToolUseCount: 0`, `oracleEvaluationAttempted: false`,
and both workspace and repo manifest hashes.

No `@anthropic-ai/sdk` import was added.  No live agent was invoked.

## Step 9 Status

Step 9 introduces the real managed-agent adapter shell and live-run gate.
It still does not prove live managed-agent execution.

A third gate `STAGE2C_MANAGED_AGENT_LIVE=1` is required on top of `--managed-agent`
and `STAGE2C_MANAGED_AGENT_ENABLED=1` before any credential check is reached.

When `STAGE2C_MANAGED_AGENT_ENABLED=1` is set but `STAGE2C_MANAGED_AGENT_LIVE=1` is
absent, the runner emits `MANAGED_AGENT_BLOCKED_NO_ADAPTER` (Step 8 behavior preserved).

When both env gates are set but required credentials are missing (e.g. `ANTHROPIC_API_KEY`
not present), the runner emits a `MANAGED_AGENT_BLOCKED_MISSING_CREDENTIALS` receipt
with `agentExecutionAttempted: false`, `builtinToolUseCount: 0`,
`oracleEvaluationAttempted: false`, and both `repoManifestHashBefore`/`After` fields
capturing real repo immutability.  No workspace mutation occurs.

The real adapter shell lives in `scripts/stage2c-real-adapter.ts`.  It exports only a
synchronous credential-check function.  No `@anthropic-ai/sdk` import exists in any
Stage 2C file.  No live agent is invoked.

## Durable Constraints (inherited from CLAUDE.md)

- `clearedForRealProjectMounting: false` — invariant.
- `clearedForSanitizedExternalProjectInput: false` — invariant.
- No fabricated evidence. Every claim references a command that was run and its output.
