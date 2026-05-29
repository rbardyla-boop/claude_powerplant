# CLAUDE FOUNDRY BASE v0.1

A portable Claude Code operating layer for shipping ambitious projects without letting speed turn into generic output, configuration clutter, or unsafe autonomy.

## The core move

Do **not** treat `~/.claude/` as one giant brain dump. Use two layers:

| Layer | Location | Purpose | Commit? |
|---|---|---|---|
| Personal operator layer | `~/.claude/` | Your permanent quality bar, portable skills, personal agents, conservative global permissions | No |
| Project execution layer | repository root + `.claude/` | Architecture, commands, build/test rules, project agents, project guardrails | Yes |
| Local override layer | `CLAUDE.local.md`, `.claude/settings.local.json` | Machine-only or personal project adjustments | No |

## What this kit contains

```
global/                     -> copy selected contents into ~/.claude/
  CLAUDE.md                  -> permanent operator doctrine
  settings.json              -> conservative baseline permission rules
  agents/                    -> reusable architecture, critic, verification specialists
  skills/                    -> repeatable cross-project workflows

project-template/            -> copy into a new repository
  CLAUDE.md                  -> project charter template
  CLAUDE.local.md.example    -> private local override starter
  .mcp.json.example          -> opt-in MCP template at the correct project-root scope
  .claude/
    settings.json            -> shared, safe project defaults
    settings.with-hooks.example.json
    hooks/                   -> optional deterministic safety/formatting scripts
    rules/                   -> modular path-aware rules
    skills/                  -> plan/build/review/verify/ship loops
  docs/PROJECT_CHARTER.md    -> scope, proof, risks, architecture decisions

optional/                    -> adopt only when the basic loop earns it
```

## The design doctrine

1. **Context is scarce.** Put permanent invariants in `CLAUDE.md`; put procedures in skills.
2. **Fast is not unverified.** Every build loop ends with proof: tests, visual checks, or falsification.
3. **Autonomy is earned.** Begin with conservative permissions. Add allowed commands only after a repository has stable test and build scripts.
4. **Subagents need jobs, not personas.** Architect, adversarial reviewer, verification lead. No pretend organization chart.
5. **Hooks enforce only deterministic rules.** Secret protection and formatting are valid. “Judge design taste on every tool call” is not.
6. **Integrations are opt-in.** MCP, plugins, and mobile channels are capability expansion, not the foundation.

## Install in ten minutes

### Personal layer

Preview first. Do not overwrite an existing Claude configuration blindly.

```bash
mkdir -p ~/.claude
cp -R global/agents ~/.claude/
cp -R global/skills ~/.claude/
cp global/CLAUDE.md ~/.claude/CLAUDE.md
# Merge global/settings.json into your existing settings if one exists.
```

### New project layer

From the repository root:

```bash
cp -R /path/to/CLAUDE_FOUNDRY_BASE_v0.1/project-template/. .
mv .mcp.json.example .mcp.json.disabled
cp CLAUDE.local.md.example CLAUDE.local.md
printf '\nCLAUDE.local.md\n.claude/settings.local.json\n' >> .gitignore
```

Then fill in `CLAUDE.md` and `docs/PROJECT_CHARTER.md` before asking Claude to build features.

## First working loop

1. `/project-init` — understand the repo and fill missing charter sections.
2. `/plan <feature>` — establish architecture, scope and proof.
3. `/build <feature>` — implement only the approved vertical slice.
4. `/verify <feature>` — run evidence checks and inspect the result.
5. `/review <feature>` — search for structural simplification, risk and polish debt.
6. `/ship <feature>` — generate the ship memo and clean stopping point.

## Adopt in waves

| Wave | Install | Why |
|---|---|---|
| 0: Baseline | CLAUDE files, settings, plan/build/verify/review/ship skills | Produces disciplined results immediately |
| 1: Taste | Architect, critic, verification agents; UI/research rules as needed | Separates building from judging |
| 2: Enforcement | Optional hooks after build/test commands are defined | Adds deterministic guardrails without slowing exploration |
| 3: Tools | MCP only for a proven recurring need | Avoids unnecessary tool and secret surface |
| 4: Packaging | Plugin after the same workflow survives 3 real repositories | Reuse what proved itself, not what sounded cool |
| 5: Remote | Channels only after permissions and sender access are locked | Mobile capability without uncontrolled execution |

## What this deliberately does not do

- It does not silently give Claude permission to deploy, publish, push, delete data, or read secrets.
- It does not load seven decision frameworks into every session; they live in `/decision-lab`.
- It does not install plugins, MCP servers, or channels before you know why you need them.
- It does not promise that configuration replaces taste, review, or testing.

## Version

`CLAUDE FOUNDRY BASE v0.1` — portable foundation for game, agent, research, product and creative-engineering repositories.
