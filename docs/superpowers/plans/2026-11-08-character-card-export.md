# PNG Character Card Export Implementation Plan

> For agentic workers: use superpowers:executing-plans inline. The user approved the export design and requested implementation; keep the existing main checkout and do not commit or push.

**Goal:** Export the current character and explicitly selected bound world books as a verified V2 PNG card through the approved compact white panel.

**Architecture:** A standalone PNG codec handles bounded binary parsing, CRC and metadata. A pure card module projects safe character fields and portable world books from an immutable snapshot. A scoped panel owns selection, image normalization, cancellation and download. Import integration preserves source metadata and prefers V3 without changing existing prompt injection defaults.

**Tech Stack:** Browser JavaScript, Canvas/Blob, existing Lucide bundle and feature-dialog lifecycle, node:test and Playwright.

**Spec:** `docs/moments-social-and-card-export.md`, sections 2–5, approved in the conversation on 2026-11-08.

## Global Constraints

- Preserve original prompt files, reply order, original CSS, custom beautification and `.ee` backup behavior.
- Export current saved persona; unsaved settings require saving through the existing form first.
- Export no user persona/history/journals/credentials; redact recognizable sensitive keys from imported extensions.
- Default V2 `chara`; read V3 `ccv3` preferentially. V3 export and optional NPC metadata remain later work.
- Use 24px panel corners, 14px body, 8px spacing increments, compact capsule buttons; match the approved draft.
- No external API, new backend or dependency download required for export.

## Review Focus

- Concurrent character/archive changes and edits during image processing must prevent a wrong or stale export.
- Unselected/foreign books and imported private fields must not appear in exported metadata.
- Truncation, CRC damage, oversized metadata and conflicting old chunks must fail clearly.
- UTF-8, placeholders, unknown safe extensions and rules must survive round-trip without enabling advanced injection.
- Remote image failure, cancellation and repeated clicks must not create a success download or mutate live data.

## Task 1: Bounded PNG Codec

Files: `js/modules/character_card_png.js`, `tests/character_card_png.test.cjs`.

Interfaces: `UvUCardPng.read(bytes) -> card`, `write(bytes, card) -> Uint8Array`, `inspect(bytes) -> chunks`.

- [x] Write tests using a known PNG and independently extracted metadata for UTF-8 round-trip, stale block replacement, V3 preference, CRC/truncation and size rejection.
- [x] Run tests red, implement signature/chunk/CRC checks and Base64 UTF-8 metadata, rerun green.
- [x] Preserve non-character chunks and verify final data before returning.

## Task 2: Card Projection and Import Compatibility

Files: `js/modules/character_card_export.js`, `js/modules/character_import.js`, `js/modules/worldbook_rules.js`, `tests/character_card_export.test.cjs`.

Interfaces: `UvUCharacterCard.capture(chat, books)`, `isCurrent(scope)`, `build(scope, selectedIds, metadata)`, `retain(card)`.

- [x] Test typed selection, Unicode/persona mapping, static versus advanced worldbook rules, credentials exclusion, source-field retention and archive/edit invalidation.
- [x] Implement explicit field projection, bound-book groups and portable extensions with stable export ordering.
- [x] Replace PNG import parsing with the codec, keep JSON/text imports working, retain safe source metadata without injecting additional fields into prompts.
- [x] Test the real importer and worldbook converter; advanced rules stay disabled after import.

## Task 3: Export Panel and Download

Files: `js/modules/character_card_export_ui.js`, `css/modules/character_card_export.css`, `js/modules/chat_settings_html.js`, `index.html`, `tests/character_card_export_browser.cjs`.

Interfaces: `UvUCharacterCardUI.open(chat)` opens the approved panel; character settings gets one entry button.

- [x] Browser-test entry, current saved persona, group/all/entry selections, safe content, local cover and real PNG download/readback.
- [x] Implement snapshot-bound panel, scoped CSS, short compatibility notices, cancellation and bounded image normalization (max 2048px edge, 16 MiB input).
- [x] Verify download Blob through the reader and compare to the generated card before offering the file.
- [x] Test missing books/cover, narrow layouts, cancelled operations and archive/character changes.

## Task 4: Verification and Documentation

- [x] Run full project tests, new browser tests, syntax and CRLF-aware diff checks.
- [x] Independently review the export changes and fix important findings with regressions.
- [x] Update the in-app help and report tested interoperability honestly; no real ST/TT compatibility claim without an actual import test.

## Ledger

- Ruling: Work in the existing main checkout because the user explicitly prefers main; preserve all prior uncommitted Moments changes. No commit or push authorized in this turn.
- Ruling: Implement V2 export plus safe V2/V3 reading now; synchronized V3 writing and optional NPC extensions stay deferred as in the approved priority order.
- Pre-flight: PNG codec is consumed by importer and UI; projection creates V2 objects accepted by codec. Worldbook extensions retain original configuration while importer keeps advanced rules off.
- Compatibility regressions reproduced and fixed: legacy world_info/wi import, nested group round-trip, and ownership-only rollback on failed save.
- Fresh read-only review: four Important findings, all addressed with red/green regressions: sensitive extension key aliases; unsupported-position quarantine; distinct portable group identity; book-container settings/extensions preservation.
- Final verification: 1015 project unit tests passed, including 19 card/PNG tests. Browser verified real download, independent metadata extraction, actual UvU reimport, local cover, no-book export, remote failure, cancellation, unsaved edits, target changes before/during generation, visible disclosure icons, and 320/390/768px layouts.
- No original CSS or prompt assembly file changed for this feature. Existing Moments changes remain uncommitted. Real ST/TT import and mobile-device saving remain external verification items.
- Publication authorization: the user subsequently requested pushing this completed work to main, including the existing Moments implementation. Keep local test outputs out of the commit.
