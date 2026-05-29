# Installation and Upgrade Notes

## 1. Inspect before copying

This starter is intentionally opinionated. Compare any existing `~/.claude/CLAUDE.md` and `~/.claude/settings.json` before merging.

```bash
diff -u ~/.claude/CLAUDE.md global/CLAUDE.md || true
diff -u ~/.claude/settings.json global/settings.json || true
```

## 2. Personal layer

Install once, then keep personal:

```bash
mkdir -p ~/.claude/agents ~/.claude/skills
cp global/CLAUDE.md ~/.claude/CLAUDE.md
cp -R global/agents/. ~/.claude/agents/
cp -R global/skills/. ~/.claude/skills/
```

Merge settings rather than overwriting whenever you already have permissions or plugins configured.

## 3. Project layer

Copy into each new repository:

```bash
cp -R project-template/. /path/to/your-repo/
cd /path/to/your-repo
cp CLAUDE.local.md.example CLAUDE.local.md
printf "\n# Claude Code local-only files\nCLAUDE.local.md\n.claude/settings.local.json\n.mcp.json\n" >> .gitignore
```

`.mcp.json.example` is deliberately disabled. Only rename it to `.mcp.json` after you choose the tools and environment variables for this repository.

## 4. Hook activation

The core template does not enable hooks. After the project has a real test/format command:

1. Customize `.claude/hooks/format-after-write.sh`.
2. Review `.claude/settings.with-hooks.example.json`.
3. Merge its `hooks` object into `.claude/settings.json`.
4. Run `/hooks` inside Claude Code and perform a harmless edit to test it.

## 5. Maintenance rhythm

At the end of each project phase:
- Remove rules that are no longer true.
- Move long repeatable procedures from `CLAUDE.md` into a skill.
- Add a hook only when a deterministic failure has occurred more than once.
- Convert the system into a plugin only after reuse across multiple repositories proves stable.
