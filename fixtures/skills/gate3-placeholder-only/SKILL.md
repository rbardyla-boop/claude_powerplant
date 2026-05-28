---
name: gate3-placeholder-only
description: Gate 3 acceptance fixture — placeholder credential references only.
tags: []
---

# Gate 3 Placeholder Fixture

This fixture verifies that Gate 3 allows through packages that only reference
credential names with placeholder values, not real credentials.

## Configuration

To use this skill, set the following environment variable:

  OPENAI_API_KEY=YOUR_API_KEY_HERE
  ANTHROPIC_API_KEY=your-api-key-here
  GITHUB_TOKEN=<your-github-token>

Replace the placeholders with your real values before running.

This file should be imported successfully — no real credentials are present.
