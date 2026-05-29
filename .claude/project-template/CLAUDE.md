# Project Operating Manual

> Replace placeholders before substantial implementation. Keep this file short; put detailed procedures in `.claude/skills/` and specialized rules in `.claude/rules/`.

## Product

- **Name:** `[PROJECT NAME]`
- **What it is:** `[ONE SENTENCE]`
- **User outcome:** `[WHAT A USER CAN DO OR FEEL]`
- **Non-goals:** `[WHAT THIS PROJECT REFUSES TO BECOME]`
- **Current phase:** discovery / prototype / vertical slice / hardening / ship

## The Vibe

- **Experience:** `[WORDS: e.g., tactile, eerie, fast, trustworthy]`
- **Visual/interaction bar:** `[WHAT MUST FEEL EXCELLENT]`
- **Avoid:** generic dashboards, filler copy, dead controls, fake data unless explicitly marked.

## Architecture

- **Stack:** `[FRAMEWORK/LANGUAGE/RUNTIME]`
- **Entry points:** `[FILES]`
- **Canonical state/model owner:** `[FILE OR MODULE]`
- **Rendering/UI owner:** `[FILE OR MODULE]`
- **Assets/content owner:** `[PATH]`
- **Data or persistence owner:** `[PATH / NONE]`

## Commands

```bash
# Install:
[COMMAND]

# Develop/run:
[COMMAND]

# Targeted test:
[COMMAND]

# Full verification:
[COMMAND]

# Build:
[COMMAND]
```

## Definition of Done

A feature is done only when:
- it works in the real user path, not merely as code,
- appropriate tests/checks pass,
- mobile/responsive behavior is inspected when UI exists,
- failure states are handled,
- no secrets or unsafe capabilities are introduced,
- changed behavior and evidence are summarized.

## Engineering Rules

- Plan before non-trivial structural work.
- Implement the smallest complete vertical slice.
- Reuse canonical helpers and ownership boundaries.
- Prefer deletion/simplification over new indirection.
- Do not broaden scope without recording it in `docs/PROJECT_CHARTER.md`.
- Never claim completion without reporting verification performed.

## Project Files to Read First

1. `docs/PROJECT_CHARTER.md`
2. `[KEY ARCHITECTURE FILE]`
3. `[KEY UI OR SIMULATION FILE]`
4. `[TEST LOCATION]`
