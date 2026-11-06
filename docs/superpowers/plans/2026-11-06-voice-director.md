# Voice Director Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation.

**Goal:** Add optional independent direction of MiniMax emotion, speed and pauses.
**Architecture:** A separate `VoiceDirector` module owns settings, immutable source
snapshots, constrained JSON parsing, cancellation and bounded caching. Existing TTS
owns playback. It calls the director only after the user requests voice playback.
**Tech Stack:** Existing browser JavaScript, Fetch, AbortController, node:test, Playwright.
**Spec:** `docs/superpowers/specs/2026-11-06-voice-director.md`.

## Global Constraints

- Original prompts, request assembly, visible/stored dialogue and CSS remain intact.
- Disabled by default; disabled path performs no director calls.
- Only emotion, speed and punctuation-anchored pauses; never accept rewritten speech.
- Credentials use the existing settings persistence and backup path.
- Keep the synchronous prepared-audio retry from the playback repair.

## Review Focus

- An edited/deleted message or switched archive must invalidate late voice results.
- Duplicate anchors, out-of-range pauses and injected tags must not alter original words.
- Director failure, missing configuration or timeout must retain ordinary speech playback.
- Repeated playback/permission retry must reuse results, without sharing them across characters.
- Imported malformed nested settings must fail validation; old settings remain accepted.

## Task 1: Independent director and safe speech controls

Files: create `js/modules/voice_director.js`, `tests/voice_director.test.cjs`.
Interfaces: `settings`, `bind`, `capture`, `prepare`, `isCurrent`, `fromForm`, `setupSettings`.

- [x] Write tests for opt-in behavior, source filtering/isolation, constrained controls,
  caching, cancellation/timeout, malformed JSON and unchanged original messages.
- [x] Run tests and verify expected failures before implementation.
- [x] Implement bounded source snapshots and independent OpenAI-compatible/Gemini requests.
- [x] Implement structured controls and safe fallback; run tests to green.

## Task 2: Playback and settings integration

Files: `chat_features.js`, `chat_render.js`, `settings_api.js`, `storage.js`,
`index.html`, `derived_features.css`; extend focused playback/backup tests.

- [x] Write failing tests for directed playback, permission retries, stale source,
  settings save/restore and nested backup validation.
- [x] Bind voice bubbles to their source; prepare controls before TTS and include
  prepared controls/context in cache identity. Do not await on retry of prepared audio.
- [x] Add scoped, compact director settings; persist under existing TTS settings.
- [x] Update loaded resource versions and add nested import validation.
- [x] Run focused tests, full `npm test`, native browser playback and layout checks.

## Task 3: Review and release

- [x] Review diff for original prompt/history/CSS preservation and line-ending churn.
- [x] Obtain independent read-only review and resolve actionable findings.
- [ ] Commit and push within the user's standing authorization; verify remote state.

## Execution Notes

The user approved the design and selected conservative controls. Continue inline
in the existing clean checkout under their prior authorization, with no extra
worktree or approval loop. No actual paid API call is part of automated validation.

Validation: 514/514 regression tests pass. Browser checks pass with true
320 px and 390 px mobile viewports and a 1024 px desktop viewport, including
settings save, preview, directed TTS, cache reuse and no overflowing controls.
The previous desktop/mobile playback lifecycle and permission-retry checks pass.
Original chat_ai.js, chat_ai_prompt.js and group_chat.js match HEAD byte-for-byte.
Independent review found and resolved two director-only source-filtering gaps:
undelivered messages remain excluded after context restoration, and historical
custom status blocks use the source chat's configured extraction pattern.
Both fixes have failed-first regression coverage; stored dialogue stays unchanged.
