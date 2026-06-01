---
name: Feature request / idea
about: Suggest an improvement, scoped to what Powerplant claims to be
title: "[idea] "
labels: enhancement
---

> Powerplant is a **constrained** repo-improvement harness. Proposals that require
> autonomous coding, auto-approval, or unbounded scope are out of scope by design —
> see docs/WHAT_POWERPLANT_IS_SAFE_FOR.md.

## Category

Which area is this? (pick one)

- [ ] Harness safety / trust boundary
- [ ] Scout candidate quality (discovery, ranking, suppression)
- [ ] Release-audit profile (e.g. the Steam beta gate)
- [ ] Feature Lab / trial fidelity (review + approve signals)
- [ ] Docs / UX
- [ ] Other

## Problem

What is missing or awkward today? Ground it in a concrete situation if you can.

## Proposed direction

What you'd like — and, importantly, how it stays **bounded** (scoped, verifiable,
review-first, no new autonomy).

## Trust-boundary impact

Does this change `run` / `review` / `approve` semantics or any guarantee? If so, say
how, and why it would still be safe. (Changes here typically need a DECISIONS.md ADR.)

## Non-claims to preserve

Confirm the idea does not imply correctness guarantees, auto-approval, or "production
readiness" beyond current evidence.
