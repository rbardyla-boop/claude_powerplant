# Contributing to Claude Powerplant

Thanks for looking. Powerplant is a **trust-bounded** harness, so contributions are
held to a slightly unusual bar: changes must preserve the safety boundary and avoid
overclaiming. This guide is short on purpose.

## The non-negotiables

Read [docs/WHAT_POWERPLANT_IS_SAFE_FOR.md](./docs/WHAT_POWERPLANT_IS_SAFE_FOR.md) and
[docs/PROJECT_CHARTER.md](./docs/PROJECT_CHARTER.md) first. A contribution must not:

- weaken sanitization, the `allowedWritePaths` ceiling, or source-unmodified guarantees;
- make `approve` automatic, or let any advisory signal silently gate approval;
- add network/credential/bash access to the executor;
- claim more than the evidence supports (correctness, autonomy, "production-ready").

> A passing Powerplant run asserts **contract-bounded integrity, not general
> correctness.** Keep docs and code consistent with that.

## How to work

- **One bounded change per PR.** Don't expand scope, add dependencies, or alter
  architecture without explicit justification.
- **Verify before claiming.** Run the narrowest relevant check first; never report
  "not checked" as "passed."
- **Prefer deletion/reuse over new abstraction** when both achieve the same result.
- **Don't refactor working code adjacent to a targeted fix.**

## Local setup

```bash
npm install
npm run build       # tsc --noEmit
npm test            # full Vitest suite
npm run smoke:road-to-usable
```

- Node 20+, strict TypeScript ESM (`"type": "module"`, `NodeNext`).
- `*.live.test.ts` files require an API key and are excluded from `npm test`.
- Pilot-integration tests skip when `SPRINT4A_PILOT_SOURCE_PATH` is unset.
- Never commit `.powerplant/state/` or any runtime/run artifacts.

## What a good PR contains

See [.github/pull_request_template.md](./.github/pull_request_template.md). In short:

- **Scope** — what changed and what is explicitly out of scope.
- **Trust-boundary impact** — none, or exactly what changed and why it is still safe.
- **Tests** — new behavior covered; existing suite + smoke still green.
- **Dogfood evidence** — if relevant, the run/command output you actually observed.
- **Non-claims preserved** — confirm you did not strengthen a claim beyond evidence.

Behavior changes to the trust path (sanitize / run / verify / review / approve /
artifact guards) should reference a decision in
[docs/DECISIONS.md](./docs/DECISIONS.md).

## Reporting bugs and ideas

Use the issue templates. For anything that could be a containment escape, credential
leak, or evidence-forgery path, **do not open a public issue** — follow
[SECURITY.md](./SECURITY.md).

## Commit style

Conventional prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
Attribution trailers are configured globally and are not required in PRs.
