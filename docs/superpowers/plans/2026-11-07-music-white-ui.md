# Music white UI and together-listening implementation plan

**Goal:** Apply the user's Apple Music references as a white music surface, show an accepted and playing together session above its private chat, and display centered lyrics without timing codes.

**Architecture:** Keep the existing player, source adapters and invitation protocol. Add a small presentation-only LRC formatter and scoped UI/styles. No 1900 stylesheet, prompt or reply-path edits.

**Approach:** Reuse the existing three working tabs (home/library/search), large artwork shelves, quiet list separators, white/gray surfaces and a restrained rose accent. Do not add nonfunctional discovery/radio tabs. A small floating-style row below the original chat header avoids overlapping its controls and appears only for the bound character/archive; its state follows the existing session and player. Paused sessions remain visible, ended/stopped/invalid sessions disappear. The new row does not change the invitation acceptance rules.

User supplied the visual specification and requested implementation; continue directly under the standing main/push authorization. Implementation choices: a row in normal chat flex flow rather than covering the header; independent local formatter rather than rewriting source lyrics.

## Files and steps

- [x] Add failing unit tests for LRC presentation (multiple time tags, metadata, enhanced timing, plain text, literal brackets, translations, bounds). Implement `music_lyrics.js`, load before UI.
- [x] Add failing browser assertions for white surfaces, centered clean lyrics, together status visibility, pause/open/end and unrelated-chat isolation.
- [x] Reshape `music_ui.js` home/library/player and scoped `music.css`: big titles, artwork shelves, compact tools, white sheets, floating mini-player/tab bar; preserve search/account/local/import/share functions.
- [x] Add the session-bound row using existing session/player events and screen observation, with no changes to chat replies or original CSS.
- [x] Verify screenshots at 320/390/768, all music/browser/desktop-drag checks, whole test suite, syntax/diff; update documentation, commit/push main and verify Pages.

## Evidence ledger

- Baseline: 890bdb7. Untracked `outputs/` is excluded.
- Memory baseline: preserve 1900 reply construction; this task changes presentation modules only.

- Verification: 798/798 unit tests; music browser checks at 320/390/768 with real WAV playback, IndexedDB, account/public fixtures, together state and centered clean lyrics; desktop touch-drag regression passed. No browser page errors.
- Review found missing recent-song actions after artwork redesign. Added a failing menu regression, restored independent play/menu controls, and reran browser checks successfully.
- Visually inspected nonempty home artwork shelf and playlist grid. Original 1900 styles and reply modules were not edited. Deployment verification follows the push.
