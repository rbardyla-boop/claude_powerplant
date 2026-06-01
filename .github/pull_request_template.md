<!--
Powerplant is trust-bounded. Keep PRs to one bounded change and preserve the
safety boundary. See CONTRIBUTING.md.
-->

## Scope

What this PR changes, and what is explicitly **out of scope**.

## Trust-boundary impact

- [ ] No change to sanitization, `allowedWritePaths`, source-unmodified, or artifact guards
- [ ] No change to `run` / `review` / `approve` semantics
- [ ] No new network / credential / bash access in the executor

If any box is unchecked, explain exactly what changed and why it is still safe.
Behavior changes to the trust path should reference a `docs/DECISIONS.md` entry.

## Tests

- [ ] New behavior is covered by tests
- [ ] `npm run build` clean
- [ ] `npm test` green
- [ ] `npm run smoke:road-to-usable` green

## Dogfood evidence (if relevant)

Command(s) you actually ran and the observed output (redact paths/secrets).

## Non-claims preserved

- [ ] No claim was strengthened beyond the evidence (no "correct", "autonomous",
      "production-ready", or "auto-approve" implications added)
