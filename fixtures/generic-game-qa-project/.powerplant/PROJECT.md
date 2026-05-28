# Generic Game QA Fixture

This is a harmless fixture project used to prove that Powerplant's contract engine
is generic (not hardcoded to the pilot project).

## Structure

- `src/engine/` — deterministic simulation engine (QA-safe to read)
- `src/engine/tests/` — tests (QA-safe to write)
- `src/steam/` — Steam integration (excluded from QA contract)
- `src-tauri/` — Tauri desktop integration (excluded from QA contract)
- `dist/` — build output (excluded from QA contract)

## Disclosure note

Content returned through `project_read_file` becomes Claude session context.
This fixture is intentionally non-sensitive and contains no credentials,
API keys, or production business logic.
