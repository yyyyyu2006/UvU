# Music Playback Implementation Plan

Execute inline using executing-plans and test-driven-development. User approved the design in conversation and authorized direct main delivery.

Goal: reliable continuous music, compact interactive chat cards, isolated optional together queues, and usable library/search/lyrics.
Architecture: extend existing music_core, music_chat and music_ui; add focused card presentation helper and timed-lyric parser. One audio engine and bounded listeners/caches.
Spec: docs/superpowers/specs/2026-11-07-music-playback-design.md
Tech: browser JavaScript, HTMLAudio, IndexedDB, Node test, Playwright.

Global constraints: preserve 1900 prompts/reply flow/beautification; no autoplay on refresh; no credentials or stream URLs in portable metadata; outputs excluded.

Review focus: stale audio/request events; queue mutation during loading; deleted/disabled invitation and archive changes; inactive historical card actions; failed settings/local metadata persistence.

## Task 1: Playback and library engine
- [x] Write failing tests in music_core.test.cjs for native pause-ended order, four modes, shuffled history, priority next, queue mutation, bounded skipping/retry, local metadata and playlist edits.
- [x] Extend music_core.js with list mode; shuffle bag/history; queue source label; move/clear; retry/skip toggle; error classification; local metadata update; library edits. Run targeted tests after RED.

## Task 2: Together session and compact cards
- [x] Write failing tests for explicit queue-scoped continuous session and old-message immutability; browser tests for live card controls.
- [x] Extend music_chat.js runtime only; add music_card_ui.js using one delegated event updater; change scoped music.css and script load keys; expose queue/menu UI methods.

## Task 3: Library, search and lyrics
- [x] Test timed LRC parsing; implement original/translation view, highlight/manual scroll hold, search recents, playlist management and local metadata editing. Reuse adapters and transient bounded cache.
- [x] Verify native system media and MiniMax regression; keep casting capability-only and full audio caching deferred to a dedicated user-facing opt-in design.

## Task 4: Verification and delivery
- [x] Full Node suite, music browser at 320/390/768, native real-audio end test, desktop drag; syntax/diff and screenshots.
- [x] Review complete diff, fix important findings with regressions, update music docs, commit/push main and verify Pages assets.

## Evidence / rulings
- BASE bbcb9d9. Existing scratch outputs is excluded. Native inline work under standing main authorization.
- Prior investigation: real Chrome emitted pause then ended; current playing gate prevented advance. Single-song session currently invalidates on track mismatch.
- Ruling: keep full audio download caching outside this pass; metadata caching and cleanup suffice without silently storing large copyrighted audio.
- Ruling: existing standing authorization selects main delivery; no extra branch, integration menu or unrelated code edits. Device casting remains deferred because no target/protocol was configured.
- Engine/session/parser work: regressions observed RED then GREEN for native pause-ended order, shuffled rounds, priority queue, bounded failures, library rollback, continuous queue confinement, archive invalidation, timed lyrics, and bounded ID3 parsing.
- Independent final review found four P2 defects: shuffle replacement excluded previous track; accepted invitation retry bypassed session binding; main toggle reused failed audio; late errors skipped after pause. All four reproduced RED and fixed GREEN; no outstanding important findings.
- Search navigation regression reproduced RED then GREEN. Browser additionally verified local metadata/cover updates, playlist reorder/select-all/bulk removal/rename, ordinary-share controls, real HTMLAudio natural order/list advance, and invitation retry recovery.
- Final Node command: D:/node.exe --test --test-isolation=none tests/*.test.cjs — 812 passed, 0 failed.
- Browser: D:/node.exe tests/music_browser.cjs — passed at 320/390/768; no page errors. D:/node.exe tests/home_drag_browser.cjs — passed including persistence/reload.
- Syntax checks and git diff --check passed. Original prompt/reply files and 1900 beautification are outside the diff. Remote account entitlement, iOS background playback and lock-screen behavior remain real-device verification limits.
- Delivery: feature commit 302e78d pushed to main; remote SHA matched. Pages index includes the new script/cache keys, and all 8 changed music JS/CSS assets matched local content after line-ending normalization. GitHub Actions API was rate-limited; deployment was verified directly against public assets instead.
