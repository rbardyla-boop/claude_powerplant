#!/usr/bin/env python3
"""Generate docs/LLM_CONTEXT_BRIEF.md from project documentation.

Usage:
    python3 scripts/project_snapshot.py          # print to stdout
    python3 scripts/project_snapshot.py --write  # write docs/LLM_CONTEXT_BRIEF.md
"""

import argparse
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).parent.parent


def read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""


def extract_section(text: str, heading: str) -> str:
    """Return body of the first markdown section matching heading (any level)."""
    h = re.escape(heading)
    pattern = r"#{1,6} " + h + r"\s*\n(.*?)(?=\n#{1,6} |\Z)"
    m = re.search(pattern, text, re.DOTALL)
    if not m:
        return ""
    body = m.group(1).strip()
    # Drop trailing horizontal rules that came from section separators
    body = re.sub(r"\n+---+\s*$", "", body).strip()
    return body


def first_paragraph(text: str) -> str:
    return text.split("\n\n")[0].strip()


def generate() -> str:
    readme = read(ROOT / "README.md")
    claude_md = read(ROOT / "CLAUDE.md")
    road = read(ROOT / "docs" / "ROAD_TO_USABLE.md")

    # --- dynamic extractions ---
    verified_status = extract_section(readme, "Current Verified Status")

    where_we_are = extract_section(road, "Where We Are Today")

    # First feature heading + its command surface
    feature1_match = re.search(
        r"(## Feature 1.*?)(?=\n## Feature 2|\Z)", road, re.DOTALL
    )
    feature1_raw = feature1_match.group(1).strip() if feature1_match else ""
    # Trim to command surface + new files only
    cmd_match = re.search(r"### Command Surface\s*\n(```.*?```)", feature1_raw, re.DOTALL)
    feature1_cmd = cmd_match.group(1).strip() if cmd_match else ""

    clearances = extract_section(claude_md, "Durable Clearances (never override without an explicit ADR)")

    today = date.today().isoformat()

    return f"""# LLM Context Brief — Claude Powerplant
_Generated {today}. Re-run `python3 scripts/project_snapshot.py --write` after major state changes._

---

## What is this repo?

Trust-bounded skill lifecycle and acceptance harness. Runs Claude against a **sanitized copy**
of a project. Claude gets only 5 typed custom tools — no bash, no browser, no file I/O outside
the allowlist. Original project is never modified. Output: `PATCH.diff` + evidence bundle.
Human reviews and decides whether to apply.

```
powerplant inspect <project-path>        # show what Claude can see — no API call
powerplant run [--yes] <path> "<task>"   # run in sanitized workspace
powerplant review <run-id>               # examine evidence bundle
```

---

## Completed stages

{verified_status}

Stage 2C harness: typed tool mediation, symlink-safe boundaries, oracle isolation.
Sprint 4A: sanitized external pilot project adapter (generated harmless pilot only).

---

## Current state / gap

{where_we_are}

---

## Next intended step

**Feature 1 — `powerplant init` wizard** (see `docs/ROAD_TO_USABLE.md`).

{feature1_cmd}

Build order: `detect-stack.ts` → `generate-policy.ts` + `generate-verify.ts` →
`src/cli/commands/init.ts` → wire `case 'init':` in `src/cli/powerplant.ts`.

---

## Files that matter first

| Path | Purpose |
|---|---|
| `src/cli/powerplant.ts` | CLI entry, command dispatch |
| `src/projects/build-sanitized-workspace.ts` | Core sanitizer — allowlist-only copy |
| `src/verification/verification-profiles.ts` | Profiles table |
| `src/contracts/` | All Zod schemas — ground truth |
| `docs/ROAD_TO_USABLE.md` | Implementation plan, build order |
| `docs/architecture/Stage 2B Completion and GitHub Release Ledger.md` | Canonical stage-status authority |
| `tests/*.live.test.ts` | Require `SPRINT4A_PILOT_SOURCE_PATH`; skipped in `npm test` |

---

## DO NOT TOUCH

{clearances}

Additional permanent invariants (from `docs/SECURITY_BOUNDARY.md`):

- `build-sanitized-workspace.ts` allowlist-only copy + symlink rejection + traversal rejection — core boundary
- `buildIsolationProofReport()` clearance booleans are hardcoded `as const`; must never be runtime-settable
- Custom tool broker 10-rule set (Sprint 3V) — permanent; explicit ADR required to relax any rule
- `.powerplant/state/` — runtime only, gitignored; never commit
- `.env` — credentials; never commit

**`always_ask` does NOT gate pre-execution for self-hosted workers (Anomaly F).
The sanitized workspace is the real protection, not the permission layer.**

---

## Health check

```bash
npm test          # must pass all 1042
npx tsc --noEmit  # must be clean
```

Both must pass before claiming the repo is healthy. Live tests (`*.live.test.ts`) are skipped
unless `SPRINT4A_PILOT_SOURCE_PATH` is set — see `.env.example`.
"""


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate LLM context brief for claude-powerplant"
    )
    parser.add_argument(
        "--write", action="store_true", help="Write to docs/LLM_CONTEXT_BRIEF.md"
    )
    args = parser.parse_args()

    brief = generate()

    if args.write:
        out = ROOT / "docs" / "LLM_CONTEXT_BRIEF.md"
        out.write_text(brief, encoding="utf-8")
        print(f"Written: {out}", file=sys.stderr)
    else:
        print(brief)


if __name__ == "__main__":
    main()
