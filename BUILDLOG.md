# BUILDLOG

## Session: 2026-05-29 — Stage 2B L1 reproducibility repair

### What I built today

Closed the two remaining non-live reproducibility defects that were blocking
live-entrypoint authorization for Stage 2B L1:

**Defect 1 — Strict temporal evidence (commits db4dd08 + T39/T40 in pilot tests)**

- Identified that `invocationTimestamp` and `sessionStartedAt` were both
  captured with `new Date().toISOString()` at different points in the same
  synchronous path. On fast execution they could land on the same millisecond.
  The L1 harness enforces strict `<`; equality would fail.
- Implemented a spin-loop in `run-skill-guided-sanitized-project-pilot.ts`
  that waits on the real wall clock (`Date.now()`) until it strictly exceeds
  the parsed Phase A timestamp before recording `sessionStartedAt`. No future
  timestamp is synthesised — the recorded value is the actual clock value the
  instant the loop exits.
- Updated T39 assertion from `>=` to `>` (strict invariant).
- Added T40: mocks `Date.now()` to freeze at a baseline for 10 calls, then
  returns baseline+1000. Proves spin loop exits and Phase B `sessionStartedAt`
  is strictly after Phase A `invocationTimestamp`.

**Defect 2 — Portable acceptance temp root (commits 1ac408b)**

- Identified that `ACCEPTANCE_HOME_PREFIX = '/tmp/powerplant-stage2b-acceptance/'`
  was hardcoded. In this environment `os.tmpdir()` returns `/tmp/claude-1000`,
  so all 49 l1-runner tests failed in `beforeEach` (the `startsWith` check
  failed), left `tmpAuditDir`/`tmpStateRoot` undefined, and the `afterEach`
  threw `'path argument must be of type string... Received undefined'`.
- Changed `ACCEPTANCE_HOME_PREFIX` to `path.join(os.tmpdir(), 'powerplant-stage2b-acceptance') + path.sep`.
  Containment is preserved: harness still uses `realpathSync` + `path.relative`
  to enforce strict descendant membership. All traversal/symlink/sibling
  escape checks still pass.
- Updated the hardcoded sibling-prefix test path to use `os.tmpdir()`.

### What went wrong and how I fixed it

The `beforeEach` failure in `l1-runner.test.ts` cascaded into a misleading
secondary error (`path argument must be of type string... Received undefined`)
in `afterEach`. The root cause was one constant, not a broken test or
corrupted infrastructure. Reading the `afterEach` carefully revealed that
`tmpAuditDir` and `tmpStateRoot` were never set (lines after the failing
assertion) so `fs.rmSync(undefined, ...)` threw on teardown.

For the temporal test (T40), tried `vi.useFakeTimers()` first — the spin-loop
causes an infinite hang under fake timers because `Date.now()` never advances
automatically. Switched to `vi.spyOn(Date, 'now')` which mocks only the
static method without freezing the Date constructor, allowing `new Date()`
(used for `invocationTimestamp`) to still read real time while the spin loop
exercises the controlled mock.

### What I want to build next

The two pre-live-entrypoint gates are now closed:
- Live-entrypoint wiring is now authorized (no more L1 non-live blockers).
- Next: wire the CLI entrypoint for `runL1Harness` and prove the first
  fully-live end-to-end invocation with a real Anthropic session.
- After that: L2–L7 scope as per the Stage 2B governing plan.
