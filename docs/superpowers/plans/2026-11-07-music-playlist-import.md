# Music Playlist Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Preview and import NetEase / QQ playlists into the existing local music library.

**Architecture:** Parse allowlisted playlist references locally. Read pages through the existing gateway; normalize and deduplicate a bounded draft, then commit it with one existing library transaction. UI owns cancellation and preview state.

**Tech Stack:** Existing browser JavaScript, Node test runner, Chrome / Playwright.

**Spec:** `docs/superpowers/specs/2026-11-07-music-playlist-import.md`

## Global Constraints

- Preserve 1900 prompts, reply flow and beautification; music-only changes.
- Keep the approved music layout, concise labels and scoped styles.
- Maximum 1000 songs / 100 local playlists; preserve portable backup schema.
- Main-branch edits and push are authorized by the user; reuse this checkout.
- Do not stage `outputs/` or credentials.

## Review Focus

- Canonical URLs, share text, malicious host suffixes, ambiguous IDs and short links.
- Multiple pages, repeated pages and misleading pagination.
- Close / cancel, changed gateway, failed later pages: no partial import.
- Storage rollback and concurrent local playlist changes.
- Small viewport preview and an existing cloud playlist import entry.

### Task 1: Import core

**Files:** `js/modules/music_core.js`, `tests/music_core.test.cjs`

- [x] Add failing URL, pagination, cancellation, limits and atomic rollback tests; run the focused suite (expected: missing import APIs fail).
- [x] Implement `parsePlaylistReference`, `previewPlaylist`, `importPlaylist` using the existing transport and persistence.
- [x] Run the focused suite (expected: all pass).

### Task 2: UI and shipping

**Files:** `js/modules/music_ui.js`, music-scoped CSS if needed, `tests/music_browser.cjs`, `docs/music-app.md`, `index.html`

- [x] Add browser coverage for link preview, editable name, save and persistence; run it before UI implementation (expected: missing entry).
- [x] Add playlist-page import button, cancel-safe preview sheet and cloud playlist import entry; update tutorial and cache keys.
- [x] Run focused tests, browser verification and repository suite (expected: all pass).
- [x] Request one fresh read-only whole-change review, fix substantive findings with regression coverage.
- [x] Stage only intended files, commit and push `main`; verify remote commit and Pages assets.
