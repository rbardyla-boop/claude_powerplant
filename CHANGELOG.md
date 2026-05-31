# Changelog

All notable, user-facing changes to Claude Powerplant. This file starts at the
v0.2.12 release; earlier history lives in git tags and `docs/BUILD_LOG.md`.

## v0.2.13

Extends artifact newline-escaping protection to Markdown/prose deliverables.

Powerplant now rejects suspicious document artifacts, including Markdown audit
reports, when they appear to contain escaped line separators instead of real
newlines. This closes a P1 gap where code artifacts were protected but primary
audit deliverables such as `docs/*.md` could still materialize as single-line
escaped text and pass review. Surfaced by a Steam-beta release-audit run whose
`docs/STEAM_BETA_AUDIT.md` was written as one escaped physical line.

Guard remains reject-not-repair; the conservative signature (many escaped `\n`,
≤2 real newlines, a very long physical line) does not flag normal multi-section
Markdown, and data files (JSON/CSV) remain excluded.

## v0.2.12

Adds bounded Scout Mode as an additive capability.

Scout is read-only, policy-gated, and uses the same sanitized bundle as the
agent. It recommends small, evidence-backed repo-improvement candidates but does
not write code or approve changes. A selected candidate can be handed into
`powerplant run --candidate`, where the normal contract ceiling, sandbox run,
review, and manual approval flow apply.

**Evidence**

- Deterministic Scout produced bounded candidates across real repos.
- A live Screenpipe candidate run produced a tests-only patch for `ai_provider.py`.
- Scope drift: none.
- Product-code changes: none.
- `approve --dry-run`: clean.

**Known caveat**

- The Screenpipe generated test was semantically inspected but **not executed**
  under pytest, because pytest remains advisory in that repo's isolated contract
  (its dependencies are excluded from the sandbox). Scout remains experimental
  and evidence-bounded; it is an additive capability, not a public flagship
  claim.

See `docs/ROAD_TO_V1.md` for the v0.3 → v1.0 → v1.5 ladder and `docs/PROJECT_CHARTER.md`
for the Scout Mode architectural decision.
