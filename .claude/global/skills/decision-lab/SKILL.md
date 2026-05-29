---
name: decision-lab
description: Apply a rigorous decision lens to a project decision, direction or recurring failure. Use manually for first principles, inversion, five-whys, second-order, regret, opportunity-cost or premortem analysis.
arguments: mode subject
disable-model-invocation: true
---

Run the requested decision analysis.

Mode: `$mode`
Subject: `$subject`

Supported modes:
- `first-principles`: assumptions -> challenged assumptions -> irreducible truths -> rebuilt solution.
- `inversion`: guaranteed failure modes -> preventative rules -> anti-failure playbook.
- `five-whys`: ask targeted why questions until the fixable root cause is identified; do not invent the user's answers.
- `second-order`: immediate, knock-on and 6–12 month consequences for acting versus not acting.
- `regret`: evaluate the decision through long-horizon regret without pretending emotion is evidence.
- `opportunity-cost`: identify what this displaces and compare long-term optionality.
- `premortem`: assume failure, narrate plausible concrete failure paths and preventative actions.

Output requirements:
1. Decision frame and scope.
2. Explicit assumptions and unknowns.
3. Analysis using the selected lens.
4. Brutal finding: the most uncomfortable useful observation.
5. One clear recommendation.
6. What evidence or event would change the recommendation.

Produce an auditable decision memo. Do not claim hidden reasoning, facts or certainty that are not supported.
