# VERIFY Profile Subprocess Constraints

Observed during first Python dogfood run (v0.2.1, 2026-05-30, poly bot project).

## What the subprocess environment looks like

When `powerplant verify` runs without a capsule image (no `verificationProfile` key), it
executes checks in an isolated subprocess: a sanitized copy of the project, no credentials
passed, no network, no user home directory in scope.

Specifically:
- `HOME` is not the real user home. User-installed Python packages in `~/.local/lib/pythonX.Y/site-packages/` are **not visible**.
- `PATH` contains only system paths. User `~/.local/bin/` is **not in PATH**.
- The Python interpreter used is the system Python (`/usr/bin/python3` or equivalent).
- Commands are executed with `shlex.split`-style splitting: **shell quoting is not processed**. Quoted strings with spaces are not collapsed into single arguments.

## Constraints for generated VERIFY.yaml commands

### Use system-available tools only

```yaml
# GOOD — available in system Python stdlib
checks:
  syntax-check:
    command: python3 -m py_compile src/main.py

# BAD — requires user-installed package not visible in subprocess
checks:
  lint:
    command: pytest tests/
  format:
    command: ruff check src/
```

### Use single-word grep patterns

Shell quoting is not processed by the subprocess executor. Patterns with spaces must be
split into single tokens or expressed as anchored patterns.

```yaml
# GOOD — single-word token, no quoting needed
checks:
  invariant:
    command: grep -q REVIEW_REQUIRED monitor/exit_monitor.py

# BAD — quoted multi-word pattern is split on space by the executor
checks:
  invariant:
    command: grep -q 'daily cap hit' monitor/exit_monitor.py
    # ^ executor sees: grep -q "'daily" "cap" "hit'" "monitor/exit_monitor.py"
    # grep interprets 'daily as the pattern, cap and hit' as filenames
```

### Prefer python3 -m py_compile over project lint tools

`python3 -m py_compile` is part of the stdlib, requires no installed packages, and proves
syntactic correctness. It is the recommended first-pass check for any Python project.

```yaml
# GOOD — stdlib, always available
syntax-check:
  command: python3 -m py_compile main.py orchestrator.py

# BETTER for multi-file projects
syntax-check:
  command: python3 -m compileall -q src/
```

### Acceptable system commands (likely available)

These are safe to use in VERIFY.yaml commands for most Linux CI environments:

- `python3 -m py_compile <file>`
- `python3 -m compileall -q <dir>`
- `grep -q <single-token-pattern> <file>`
- `test -f <file>` (or `[ -f <file> ]`)
- `cat <file>` (when output is needed)
- `go vet ./...` (if Go is system-installed)
- `node --check <file>` (if Node is system-installed)

### What to document when user-installed tools are required

If a project genuinely needs `pytest`, `ruff`, `mypy`, or similar, the right fix is to
document a `setup` step in POWERPLANT_DOGFOOD_NOTES.md and note it as a subprocess
limitation. Do not generate VERIFY.yaml commands that silently fail in isolation.

## Acceptance test for this constraint

From a clean clone, with no user pip packages installed, `powerplant init --yes` then
`powerplant verify` must pass without manual YAML surgery.

This is the P0 acceptance test for all Powerplant-generated VERIFY.yaml files.

## Relation to capsule profiles

Capsule profiles (e.g. `node-vitest-typescript-v1`) solve this problem for Node/TypeScript:
the capsule image ships with all required tools. When a capsule profile is active, the
checks run inside Docker and the image controls the available environment.

The subprocess constraint documented here applies **only when no `verificationProfile` is
set** — i.e., when checks run directly on the host subprocess. All non-capsule stacks
(python, go, rust, generic as of v0.2.1) are subject to these constraints.

The long-term fix for Python is a `capsule-v1-python` image that ships `pytest`, `ruff`,
and `mypy`. Until that image exists, generated VERIFY.yaml files must use stdlib-only commands.
