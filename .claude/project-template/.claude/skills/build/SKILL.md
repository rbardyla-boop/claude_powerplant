---
name: build
description: Implement an approved vertical slice surgically and prove the changed behavior.
arguments: task
disable-model-invocation: true
---

Build the approved slice for: `$task`

Before edits, state the approved scope and proof. Then:
1. Inspect relevant canonical files and existing patterns.
2. Make the minimum cohesive edits.
3. Do not add speculative features, unrequested refactors or fabricated content/data.
4. Run the narrowest relevant checks, then a real-user-flow check when applicable.
5. Stop and ask before destructive, remote, credentialed or production-changing operations.

End with:
- Changed files and why.
- Verification run and exact outcome.
- Remaining risks/deferred scope.
- Recommended next action.
