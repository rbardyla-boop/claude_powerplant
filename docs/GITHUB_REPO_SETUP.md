# GitHub Repo Setup (suggestions)

Manual checklist for preparing the repository for public feedback. **Nothing here is
executed automatically** — these are recommendations for the maintainer to apply in
GitHub settings or in a separate, explicitly-approved change.

## Repository description

```
Constrained repo-improvement harness for scoped AI patching, auditing, Scout discovery, and review-first approval.
```

## Topics

```
ai-agents
code-review
developer-tools
software-safety
patch-management
repo-audit
llm-tools
typescript
cli
```

## README badges

The README includes two badges that reflect things that actually exist:

- **CI** — points at `.github/workflows/ci.yml` (real workflow). Accurate as long as
  that workflow exists and runs on push/PR.
- **License** — Apache-2.0, matching `LICENSE`.

Do **not** add badges for systems that do not exist (coverage, npm version, release)
until those systems are real. A green badge for a nonexistent pipeline is a false
claim.

## Security settings

`SECURITY.md` routes vulnerability reports to GitHub **private vulnerability
reporting**. Enable it before going public:

- Settings → Code security and analysis → **Private vulnerability reporting** → Enable.

The issue-template `config.yml` links the advisory form
(`/security/advisories/new`) and disables blank issues so reporters are funnelled to
the right place.

## package.json metadata (suggested, not changed here)

`package.json` is currently `"private": true` with no `description`, `license`, or
`repository` fields. This docs pass deliberately does **not** modify it. If/when the
maintainer wants the package metadata to match the public repo, consider — as a
separate, reviewed change:

- `"description"`: same one-liner as the repo description above.
- `"license": "Apache-2.0"` (matches `LICENSE`).
- `"repository"`: the GitHub URL.
- Keep `"private": true` unless there is a deliberate decision to publish to npm.
  Publishing is explicitly **out of scope** for the public-feedback pass.

## Suggested default branch protection (optional)

- Require the CI workflow to pass before merge to `master`.
- Require a pull request before merging.

These are operator decisions; the harness does not depend on them.

## What this repo does not set up

- No GitHub Release, tag, or npm publish (intentionally — see `CHANGELOG.md` for the
  version line).
- No CD / deploy workflow.
- No analytics or telemetry.
