---
name: review
description: Harsh quality review of current work before shipping, looking first for user failure and dramatic structural simplification.
arguments: target
disable-model-invocation: true
---

Review: `$target`

Assume the current work may be impressive-looking but flawed. Inspect actual files and verification evidence.

Find:
1. Blockers in real user outcome.
2. Security/data/permission boundary problems.
3. Mobile/visual/interaction confusion if user-facing.
4. Logic, reliability or performance failures.
5. Code-judo opportunity: the cleanest simplification still missed.
6. Missing proof or overclaimed language.

Conclude with one verdict: `BLOCK`, `FIX THEN SHIP`, or `SHIP`.
