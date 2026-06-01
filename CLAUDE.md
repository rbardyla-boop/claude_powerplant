# Claude Powerplant

TypeScript ESM project proving Managed Agents isolation, credential containment, and evidence-grade
acceptance. Sprint-based architecture; each sprint is independently verified before composition.

## Durable Clearances (never override without an explicit ADR)

- `clearedForRealProjectMounting: false` — invariant since Sprint 3R
- `clearedForSanitizedExternalProjectInput: false` — invariant since Sprint 4A
- `always_ask` cannot gate pre-execution for in-process bash workers — Anomaly F, Sprint 3T

## Engineering Operating Rules

- Plan before editing. Non-trivial changes require an objective, success criteria, and non-goals
  before any file is touched.
- One bounded change per run. Do not expand scope, add dependencies, or alter architecture
  without explicit justification.
- Verify before claiming success. Run the narrowest relevant check first. Never convert
  "not checked" to "passed."
- Do not claim evidence that was not directly observed.
- Do not refactor working code adjacent to a targeted fix.
- Prefer deletion over new abstraction when both achieve the same result.
- Compiled-language approval gate. For any Rust/Tauri (or other compiled-language) code fix, do not
  approve a run unless a host-side compile — `cargo check`/`cargo build`, `tsc`, or equivalent —
  passes on the materialized patch branch. Sandbox verify runs dep-bound checks advisory (network and
  `node_modules`/`target` excluded), so byte-clean + review-PASS is necessary but not sufficient; the
  host compile is the binding gate. (Origin: pp-run-1780272564172 shipped non-compiling Rust at
  review-PASS because the cargo check was advisory.)

## Trust Boundary Routing

For trust-critical, security-critical, data/migration, or release/deployment work: stop the
ordinary feature flow and use the governed validation workflow. Do not apply rapid-shipping
language to these classes.

For ordinary features, fixes, and bounded engineering tasks: use `/powerplant-feature-loop`.

## Project Conventions

- Runtime: Node 20+, strict TypeScript ESM (`"type": "module"`, `NodeNext`)
- Tests: Vitest. `*.live.test.ts` files are excluded from `npm test` (require API key)
- State: `.powerplant/state/` — gitignored; never commit runtime state files
- Evidence: never fabricate; every claim must reference a command that was run and its output
