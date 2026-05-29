---
name: ship
description: Prepare a clean project handoff after verified work; use before commit, PR, deployment request or user-facing delivery.
arguments: milestone
disable-model-invocation: true
---

Prepare the ship memo for: `$milestone`

Do not push, deploy, publish or mutate remote systems without explicit instruction.

Produce:
- Outcome shipped.
- Files changed grouped by purpose.
- Verification evidence.
- Screens/user flow checked, when applicable.
- Known limitations and deferred work.
- Security/permissions/integrations changed, if any.
- Suggested commit message.
- Next highest-leverage slice.

If verification is incomplete, mark the milestone as `NOT READY TO SHIP` and name the missing check.
