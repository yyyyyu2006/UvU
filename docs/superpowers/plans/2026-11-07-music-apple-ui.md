# Approved music UI implementation

Spec: ../specs/2026-11-07-music-apple-ui.md

User authorized direct implementation and main push. Execute inline; one independent read-only final review.

## Task 1: Catalog and acceptance tests

- Add failing tests for saved/recent separation and artist/album grouping; add five-tab browser assertions.
- Implement pure `music_catalog.js` with provider-aware identity.
- Verify baseline suite and focused tests.

## Task 2: Pages and playlist

- Implement the approved five pages, category drilldowns, full-page playlist, compact dock and settings appearance.
- Use real collections for discovery/radio. Retain search/paging and editing controls.
- Add licensed offline icons. Verify UI navigation and persistence.

## Task 3: Player and CSS

- Match the approved player, mini-player, typography, spacing and navigation with scoped CSS.
- Preserve audio engine; add only a tested volume setter if required for a real volume control.
- Compare screenshots at 390px and validate 320/768px, both appearances and reduced motion.

## Task 4: Verify and ship

- Preserve all existing browser functional coverage with adapted navigation.
- Full suite, browser/drag checks, syntax, diff, independent review and repair important findings.
- Update app documentation/cache keys, explicit staging, commit and push main; verify Pages assets.

## Verification ledger

- Tasks 1–3 complete. Baseline f0d2a40: 812/812 tests. Final: 817/817 tests; real Chrome fixture at 320/390/768px and desktop touch-drag persistence checks passed. Syntax and whitespace checks passed.
- Existing browser coverage retains natural audio ending/list looping, QR, source opt-in, search scroll, IndexedDB audio, metadata, playlist sorting/removal, captured invitations/cards, queue/lyrics and reload. Added five tabs, category drilldown, radio queue action, full playlist/player, volume and appearance persistence.
- Screenshots compared with approved reference: five pages, playlist, player and dark discovery. Fake device frame/status bar and example music were excluded from production.
- Independent review found two P2 issues: collection action contrast and recent-addition order. Regression checks failed before fixes and passed after. Existing records have no added timestamp: newest favorites lead, playlist-only tracks use reverse insertion order as fallback, with no storage migration.
- Volume assignment failures are guarded so system-controlled volume cannot prevent playback. Physical-device volume, live platform accounts and provider availability were not claimed from fixtures.
- Task 4 verification complete; shipping follows with explicit staging, main push and Pages checks.
