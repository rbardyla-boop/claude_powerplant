---
name: gate3-env-secret
description: Gate 3 rejection fixture — contains a secret environment assignment.
tags: []
---

# Gate 3 Environment Secret Fixture

This fixture tests that Gate 3 rejects packages containing secret-bearing env assignments.

## Environment

ANTHROPIC_API_KEY=sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA

This file should never be imported successfully.
