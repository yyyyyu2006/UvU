# Character ID Cover Implementation Plan

> Execute inline with superpowers:executing-plans and test-driven-development. User approved the visual and requested implementation; keep the existing main checkout. No new push requested.

**Goal:** Render the approved 3:4 identification-card PNG cover and move its export entry into the chat-settings header.

**Spec:** Approved `uvu-character-id-classic.html` draft in this thread's visualization directory: black serif title strip, left portrait and decorative barcode, right NAME/DATE OF BIRTH/IDENTITY/NATIONALITY fields, signature and blue UvU seal, white body, bottom black strip. The submitted corner adjustment is 12px at the 360px design width.

**Architecture:** A local Canvas renderer owns card layout and bounded public cover fields. The existing exporter continues to own image loading, cancellation, snapshots, PNG metadata and download. Optional cover fields live only in `extensions.uvu.cover`; importing them does not change persona or prompt injection.

**Tech:** Existing browser Canvas, PNG codec, node:test and Playwright; no dependencies or API calls.

## Constraints and decisions

- Output 900×1200 PNG (3:4), 30px corner radius corresponding to 12px in the approved 360px draft. Opaque white corners keep a consistent white PNG background.
- Use current saved name and portrait. Blank birthday/nationality stay blank and display an em dash; default identity is 角色. Never infer personal facts or copy the draft's sample birthday.
- Optional manually editable cover fields persist within exported card metadata, not live chat settings. Preserve them on reimport/reexport.
- Barcode is decorative, derived from public card data, with no link or credentials. Signature is styled name text, not a digital signature.
- Header gets one compact accessible icon button at right; preserve existing back button, centered title and original CSS files. All added CSS remains scoped.
- Preserve selected books, safe original metadata, failure/cancellation guards, prompt assembly, reply flow and .ee backups.

## Task 1: Cover rendering and metadata

Files: new `js/modules/character_card_cover.js`, existing `character_card_export.js`, new `tests/character_card_cover.test.cjs`.
Interfaces: `UvUCardCover.profile(cardData, overrides)` normalizes bounded public fields and derives display serial; `draw(canvas, cardData, profile, image)` paints a 900×1200 cover without I/O or live-data writes. Export `build` optionally accepts `metadata.cover`.

- [x] Test missing fields, overrides, Unicode/control characters, long fields, public-only serial and round-trip storage RED→GREEN.
- [x] Implement pure normalization plus clipped text, centered portrait crop and the approved card layout.

## Task 2: Exporter integration and header entry

Files: `character_card_export_ui.js`, `character_card_export.css`, `chat_settings_html.js`, `index.html`, existing browser test.

- [x] Add browser expectations for header-only entry, 3:4 image pixels/dimensions and cover-field readback; run red.
- [x] Render live preview through the same renderer as download, allow portrait replacement and optional cover fields, reuse image-fetch/abort/snapshot guards.
- [x] Add the header icon and scoped styles, remove the old body entry, update asset versions.
- [x] Verify local portrait crop and fallback, preview edits, repeated export, remote errors, cancellation and character/archive changes.

## Task 3: Validation and documentation

- [x] Full unit suite, real browser export/reimport and 320/390/768px checks; inspect actual exported PNG and header screenshots.
- [x] Fresh read-only review, fix important findings with regressions.
- [x] Document header entry, optional display fields and verification boundaries. Leave work local unless a push is requested.

## Ledger

- Pre-flight: cover renderer consumes only normalized public fields; exporter passes the same fields to draw and metadata. PNG codec and importer remain unchanged.
- Decision: implement the approved draft directly; optional facts stay manual to avoid inventing birthday or nationality. Cost if wrong: users fill a small export-only form.
- Decision: keep existing main checkout as requested in prior turns; no commit/push in this task.
