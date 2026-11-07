# Speech refinement implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task by task. Track completed work here.

**Goal:** Implement T1–T12 from the approved checklist.
**Architecture:** Extend MiniMaxTTS/VoiceDirector and derived settings, preserving transcript and main reply requests.
**Tech Stack:** Browser JavaScript, audio/IndexedDB, Node fixtures, Playwright.
**Spec:** ../specs/2026-11-07-memory-mcp-speech-refinement.md

## Global constraints
No paid calls; preserve role voice precedence; no arbitrary spoken tags; new streaming/cache/segmentation modes opt in; old API configuration accepted.

## Review focus
Oversized response; split SSE frames/final aggregate; autoplay rejection; stale role/archive sources; cache invalidation and quota failures.

## Tasks
- [x] T1/T2/T3: Failed-first tests for model parameters, bounded response decode and staged diagnostics; implement and verify.
- [x] T4/T5/T6/T7: Searchable voice catalog, character voice/director overrides, pronunciation dictionary, inspect/fallback controls; test with API fixtures.
- [x] T8/T9/T10: Optional streaming/segmentation/persistent bounded cache with ordinary MP3 fallback; tests for duplication/cancellation/quota.
- [x] T11/T12: Playback lifecycle/usage diagnostics; compact derived UI and help; test existing playback flows.
- [x] Verify focused tests and browser checks; report all settings/defaults and physical-device limitations.


## Implementation evidence — 2026-11-07

- T1–T3: registered model capabilities, conservative unknown-model fallback, 32 MiB bounded response reader and 12 MiB decoded MP3 limit; fragmented SSE/final aggregate validation; request/response/decode errors and account-region labels; credentials omitted from diagnostics.
- T4–T7: searchable explicitly requested voice catalog/favorites; default and per-character voice/director/style/dictionary settings; legacy chat voice retains precedence. Per-message details show actual returned usage, ordinary/retry controls, and manual supported emotion/speed playback. Neither controls nor spoken pause tags are written to chat.
- T8–T10: optional SSE/MediaSource progressive playback, full already-returned MP3 fallback on unsupported browsers or late decoder initialization failure; optional maximum-eight-segment synthesis; optional hash-keyed local IndexedDB cache with size/expiry bounds, serialized quota-safe writes and targeted failed-audio eviction. Cache defaults 32 MiB/seven days; stream/segmentation/persistence all default off.
- T11–T12: original permission retry remains synchronous and does not call paid APIs twice; archive/message identity guards cover ordinary and directed synthesis; old media events cannot stop a new session. TTS API billed characters and director returned tokens are separate; reused caches show zero new usage, absent fields remain unknown.
- Additional RED→GREEN browser regression: after saving settings, editing a role and switching form selection must not mutate the saved configuration before another Save. Form output now clones profile data.
- Scoped new UI only: `css/modules/minimax_speech.css`; checked with actual `panel_layout.js` and existing derived CSS. Original 1900 beautification untouched. Unchanged existing lines retain their original LF/CRLF bytes.

### Verification

`D:/node.exe --test tests/minimax_refinement.test.cjs tests/minimax_playback.test.cjs tests/minimax_tts.test.cjs tests/voice_director.test.cjs tests/voice_director_settings.test.cjs` → **62 passed, 0 failed**.

`D:/node.exe tests/minimax_speech_browser.cjs` → **passed at 320 and 390 px**: actual derived settings, catalog/search, role/style/dictionary save, unsaved-form isolation, off defaults, 16 px checkbox alignment, no horizontal overflow or browser errors. Requests use local fixtures; no paid synthesis calls.

Screenshots: `outputs/speech-refinement/speech-320.png`, `speech-390.png` (QA artifacts; not required production assets).

### Rulings and limits

- Ruling: total inserted pause time is capped at 4.5 seconds per segment, within the prior maximum-six-pause rule; this prevents excessive gaps. It can intentionally reject an otherwise individually valid pause.
- Ruling: segmentation waits for the bounded segment sequence before ordinary playback and uses complete MP3 fallback; it does not automatically replay failed paid requests. It may add calls and short segment boundaries when explicitly enabled.
- Persistent cache stores audio and safe usage metadata only, with SHA-256 identities; it is a separate disposable local cache and is not included in backups. Exported settings still include user-configured speech/profile options through the existing settings backup path.
- Real MiniMax account/paid API behavior, physical iOS/Android playback, real device quotas and browser-specific MSE support have **not** been verified. Automated tests validate fixture parsing, lifecycle/fallback and mobile-width Chromium layout.
- Fresh integration/full-branch review and full-suite run are owned by the parent integrator. No commits or pushes were made by this worker.
