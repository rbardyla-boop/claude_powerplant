---
name: Bug report
about: A reproducible problem with a Powerplant command or its output
title: "[bug] "
labels: bug
---

> Security issues (containment escape, credential leak, evidence forgery) must NOT
> be filed here — follow SECURITY.md and use private vulnerability reporting.

## What happened

A clear description of the problem.

## Environment

- Powerplant version (`powerplant --version`):
- Command run (exact):
- Target repo stack (Python / TS / Rust/Tauri / docs / other):
- OS / Node version:

## Contract (if relevant)

Minimal `POLICY.yaml` / `VERIFY.yaml` snippets (redact anything sensitive):

```yaml
# allowedWritePaths, checks, etc.
```

## Expected vs actual

- **Expected:**
- **Actual:**

## Trust-boundary observations

- Was the original source repo modified? (yes / no / unsure)
- Was a `PATCH.diff` produced? (yes / no)
- Run id and evidence hash, if available:

## Logs / artifacts

Relevant output from the run bundle (`VERIFICATION_REPORT.md`, `RUN_CLASSIFICATION.json`,
review output). Redact paths/secrets.
