# CLAUDE_POWERPLANT

A layered, test-first harness for running Anthropic-managed and (in
Sprint 2) self-hosted coding agents against well-defined task workspaces.

This repo is delivered in sprints. Each sprint adds one layer and is
independently verifiable.

## Sprint 0 — what's included

- Zod-validated environment loader (`src/config/env.ts`)
- Output contract schema (`src/contracts/artifact-manifest.ts`)
- Test suite for env + contract (Vitest, 9 cases)
- Minimal fixture project at `fixtures/sample-project/` with its own
  passing test
- Architecture, security boundary, output contract, decisions, and
  build-log docs under `docs/`

No Anthropic API calls. No SDK dependency. Sprint 0 verifies the
contracts before any wire is touched.

## Running

```bash
npm install
npm run typecheck
npm test
```

To run the fixture project's own tests:

```bash
cd fixtures/sample-project
npm install
npx tsc --noEmit
npx vitest run
```

## Environment variables

Copy `.env.example` to `.env` and fill in real values before Sprint 1.

| Variable                       | Required | Default       | Notes                                                |
| ------------------------------ | -------- | ------------- | ---------------------------------------------------- |
| `ANTHROPIC_API_KEY`            | yes      | —             | Used for `client.beta.agents.*` and session calls.   |
| `ANTHROPIC_ENVIRONMENT_KEY`    | Sprint 1 | —             | Used by `client.beta.environments.create(...)`.      |
| `NODE_ENV`                     | no       | `development` | One of `development`, `test`, `production`.          |
| `CLAUDE_POWERPLANT_MAX_TURNS`  | no       | `10`          | Hard cap on session turns.                           |

`.env` is in `.gitignore`. Only `.env.example` is committed.

## Next: Sprint 1 — Managed Agents

Sprint 1 adds `@anthropic-ai/sdk` and wires up Anthropic's managed
agents path via `client.beta.agents`, `client.beta.environments`, and
`client.beta.sessions`. See `docs/ARCHITECTURE.md` for the layer map and
`docs/BUILD_LOG.md` for the Sprint 1 smoke-test spec.

We deliberately use `@anthropic-ai/sdk` (not `@anthropic-ai/claude-agent-sdk`).
The decision and the forbidden-symbol list are in `docs/DECISIONS.md`
(ADR-0005).
