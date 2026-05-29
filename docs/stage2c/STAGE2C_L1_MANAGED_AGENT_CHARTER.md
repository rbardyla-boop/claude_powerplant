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

## Durable Constraints (inherited from CLAUDE.md)

- `clearedForRealProjectMounting: false` — invariant.
- `clearedForSanitizedExternalProjectInput: false` — invariant.
- No fabricated evidence. Every claim references a command that was run and its output.
