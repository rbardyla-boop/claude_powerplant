---
name: plan
description: Produce an implementation-grade plan for a feature or milestone before coding; use when scope crosses files, user flows or architecture boundaries.
arguments: task
disable-model-invocation: true
---

Plan: `$task`

Read project instructions, charter and relevant implementation files. Do not implement yet.

Return:
- User outcome and non-goals.
- Existing canonical architecture and files that own the change.
- Simplest vertical slice that proves the idea.
- The deletion/simplification opportunity.
- Files expected to change.
- Stepwise build sequence with proof after each step.
- UX/mobile, security, performance and regression risks as relevant.
- Verification commands or manual checks.
- Decisions that need user approval before building.
