# Steam Beta Release-Quality Gate

> Gate definition + claims-control document, in the spirit of
> [WHAT_POWERPLANT_IS_SAFE_FOR.md](./WHAT_POWERPLANT_IS_SAFE_FOR.md). It defines what
> "beta quality" means as an **evidence gate**, so Powerplant can audit a build
> against it and patch concrete gaps one at a time — never to claim a game is
> "fun" or "award-winning."
>
> This is the first profile of a future `release-audit` capability. The
> `release-audit` command is **roadmap, not shipped**: today the gate is exercised
> via `powerplant run` (an audit task) + `powerplant scout` + `run --candidate`.

## What this gate is — and is not

**Is:** a checklist of *observable, mostly-mechanical* release-readiness conditions.
Powerplant can audit most of them and propose small, scoped fixes.

**Is not:** a judgment of fun, quality of experience, market fit, or
"award-winning." Powerplant can find *missing affordances* (no version display,
no restart, no first-run instruction, a crash on boot); it cannot decide whether
the game is good. See **§10 Non-claims.**

**End state (beta):** stable enough for external players, honest about its
unfinished state, recoverable when it fails, and polished enough that feedback is
about the game — not crashes, broken controls, missing onboarding, or packaging
errors.

## Gate severities

```
BLOCKER       — must fix before any external build
MUST_FIX      — fix before beta
SHOULD_FIX    — fix during beta
NICE_TO_HAVE  — optional polish
NON_CLAIM     — out of scope for Powerplant to assert (record, do not gate)
```

## 1. Steam mechanical gate
- Build/store-page checklist understood; store assets accounted for.
- Build review timeline understood (Valve store review ~3–5 business days; submit ≥7 business days before release).
- Supported OS declared honestly; system requirements drafted.
- Branch/beta strategy defined; Playtest vs Early Access vs Demo choice made (these are distinct Steam mechanisms).
- Powerplant **audits** this from repo evidence; it must **not** fabricate Steamworks state.

## 2. Stability gate
- Launches from a clean install; no crash on boot / first run / scene transition / quit-restart.
- No panics in release build; no missing assets.
- Rust/Tauri checks: `cargo test`, `cargo check`, `npm run build`, a `tauri build`/`dev` smoke. *Mark a check required only if it is hermetic in the sandbox; otherwise advisory* (see the verification-coverage signal in Scout).

## 3. First-10-minutes gate (the "indie quality" bar)
Within 10 minutes a player can answer: What am I? What can I do? What is the
pressure? What is the objective? What changed because of my action? Why play one
more run? — Powerplant audits UI text, menu flow, tutorial prompts, state labels,
and missing feedback hooks. It flags **missing affordances**, not "is it fun."

## 4. Controls / input gate
- Keyboard/mouse documented; controller / Steam Deck intent documented.
- Pause works; quit/back works; no soft-lock from a menu state; remapping or clear defaults.

## 5. UX / onboarding gate
- First screen has a clear action; failure state is explained; success/failure feedback is visible.
- Critical state changes are not invisible; a restart flow exists.

## 6. Save / restart / recovery gate (minimal for beta)
- Restart-run works; settings persist (if settings exist).
- Corrupted/missing save does not brick boot; a crash-log or beta-feedback path exists.

## 7. Performance gate
- No obvious frame stalls in the first scenario; release build size reviewed.
- No debug-log/console spam in release; reasonable loading time.

## 8. Steam packaging gate
- No secrets, `.env`, private keys, dev-only files, raw logs, test fixtures, or giant build caches in the shipped build.
- Version/build number visible in-app.

## 9. Store-page honesty gate
- Description and screenshots match the *current* build.
- Early Access / Playtest limits disclosed; no fake feature claims.
- **AI disclosure:** Valve requires disclosure of AI-generated and live-generated AI content in Steamworks. If the game uses AI-generated or live AI systems, that must be disclosed honestly and store claims must match.

## 10. Non-claims (record, never gate)
Powerplant does **not** assert any of:
- the game is fun, good, polished-feeling, or award-winning;
- the game will sell or find market fit;
- the design is balanced or the "feel" is right;
- Steamworks backend state (it audits repo evidence only).
These belong to human judgment. Powerplant's job is: *"This build is blocked
because X is missing; here is the smallest patch to fix X."*

## How Powerplant exercises this gate today

```
Audit → Scout → Fix one blocker → Review → Approve     (one patch at a time)
```

1. **Audit (no code change):** `powerplant run . "Audit this build for beta-release readiness against docs/STEAM_BETA_RELEASE_QUALITY.md. Write findings only to docs/STEAM_BETA_AUDIT.md. Do not change game logic, rendering, audio, economy, save behavior, Steam integration, or product claims. Record only blockers, evidence, missing checks, and deferred issues."`
2. **Scout:** `powerplant scout .` → small release-readiness candidates (version display, panic/log path, boot smoke test, first-run instruction, restart test, asset-manifest check, packaging excludes, crash-safe config load).
3. **Fix one:** `powerplant run . --candidate .scout/candidates/scout-NNN.json` → one narrow patch → `review` → manual `approve`.

Discipline: **release gate first, small fix candidates second, one patch at a time third.** Never "I made the game better."

> Roadmap: `powerplant release-audit . --profile steam-beta` would emit
> `.release/STEAM_BETA_READINESS.md` + `.release/release-gates.json` with the
> severities above. Not yet implemented.
