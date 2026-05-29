---
name: mobile-audit
description: Audit a user-facing web or game flow for mobile usability, hierarchy, touch interaction and performance before declaring polish complete.
arguments: flow
disable-model-invocation: true
---

Audit the mobile experience for: `$flow`

Inspect the relevant UI code and, when possible, render/run it at narrow widths.

Evaluate:
- First-screen hierarchy and legibility.
- Thumb reach, tap target comfort and gesture conflict.
- Overflow, clipping, modal/panel behavior and scrolling.
- Performance-sensitive animation or excessive density.
- Loading, empty, failure and restart states.
- Whether the interface feels authored rather than template-generated.

Output:
- Three highest-impact failure points.
- The smallest changes that improve them.
- Verification plan at phone-sized viewports.
- Verdict: UNUSABLE / FUNCTIONAL / POLISHED.
