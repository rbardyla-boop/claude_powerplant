# Security Policy

## Supported Version

The current development line is the `feat/stage2b-preflight` branch (Stage 2B).
No stable release has been tagged. Security reports should target the current
`master` or active development branch.

## Reporting a Vulnerability

**Do not report security vulnerabilities through public GitHub issues.**

Use GitHub's private vulnerability reporting to submit a report confidentially:

1. Go to the repository's **Security** tab.
2. Click **"Report a vulnerability"**.
3. Fill in the details and submit.

GitHub will notify the maintainer without making the report public.

> **Publication prerequisite**: GitHub private vulnerability reporting must be
> enabled in repository settings (Security → Code security → Private
> vulnerability reporting) before this channel is operative. Verify this is
> enabled before the repository is formally released.

## What to Include

Please include:

- Affected commit hash or branch
- Step-by-step reproduction
- Observed behavior and expected behavior
- Assessed impact (containment escape, credential leakage, evidence forgery,
  trusted-directory bypass, unintended live agent execution, or other)

Do **not** include live API keys, raw session tokens, or other sensitive
credentials in your report.

## Scope

Security reports are relevant for:

- Containment escape: candidate workspace files reaching outside the sanitized
  snapshot or real project source directories
- Credential leakage: API keys, environment keys, or other secrets being
  accessible to an executor or recorded in a report
- Evidence or receipt forgery: L0/L1 acceptance receipt or registry manipulation
  that could produce a false acceptance verdict
- Bypass of the trusted-directory assumption: automated co-substitution of the
  L0 receipt and skill registry between bootstrap and L1 invocation
- Unintended live tool or agent execution: a test or CLI path that triggers a
  real Anthropic API call without explicit operator authorization

## Out of Scope

- Theoretical cryptographic weaknesses in the trusted-directory assumption that
  are already disclosed in the acceptance documentation
- L2–L7 functionality that has not yet been implemented
- Issues in third-party dependencies (report directly to those maintainers)
