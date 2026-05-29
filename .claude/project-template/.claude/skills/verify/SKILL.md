---
name: verify
description: Verify a built feature against its user outcome and project quality bar before a completion claim.
arguments: task
disable-model-invocation: true
---

Verify: `$task`

Read the Definition of Done, charter proof target and changed code. Determine the shortest trustworthy proof.

Check as applicable:
- Runtime behavior in the actual user path.
- Relevant automated tests/type checks/build.
- Mobile/narrow viewport and interaction state for UI.
- Determinism/performance for simulations or games.
- Evidence language and falsification for research artifacts.
- Secret exposure, unsafe commands and permission expansion.

Do not pretend unavailable evidence was checked.

Output a verification report:
- PASS / FAIL / NOT TESTED for each relevant surface.
- Exact commands or observation method.
- Failures and smallest correction.
- Final status: VERIFIED / PARTIAL / BLOCKED.
