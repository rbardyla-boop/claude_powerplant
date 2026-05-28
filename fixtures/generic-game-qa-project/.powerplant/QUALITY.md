# Quality Guidance

When adding tests to `src/engine/tests/`:

- Use `node:test` and `node:assert/strict` (no external test frameworks)
- Tests must be deterministic (no Date.now(), Math.random(), network)
- Follow the AAA pattern: Arrange, Act, Assert
- Test pure function behavior; do not mutate the state passed as input
- Each test file must be independently runnable
