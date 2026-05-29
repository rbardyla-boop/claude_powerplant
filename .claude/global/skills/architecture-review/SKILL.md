---
name: architecture-review
description: Review an implementation plan or code change for dramatic simplification, boundary quality, security and proof before further building.
arguments: target
disable-model-invocation: true
---

Review `$target` as a lead hybrid designer/engineer.

Inspect the relevant code and project instructions. Search first for a structural deletion move:
- Can a layer, branch, wrapper, state variable or duplicate path disappear?
- Is feature logic leaking into shared infrastructure?
- Is user-facing complexity being hidden rather than removed?
- Does this increase attack surface or irreversible actions?
- Is the proof of success direct and runnable?

Return:
1. Current architecture in five bullets or fewer.
2. Blockers.
3. Code-judo simplification.
4. Minimal patch sequence.
5. Verification and visual/user-flow checks.
6. Verdict: REWORK / BUILD / SHIP.
