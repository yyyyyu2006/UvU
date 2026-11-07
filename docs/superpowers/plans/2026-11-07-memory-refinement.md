# Vector refinement implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task by task. Track completed work here.

**Goal:** Implement V1–V12 from the approved checklist.
**Architecture:** Extend the existing vector entrypoints; new advanced modes opt in. Preserve ordinary prompt assembly.
**Tech Stack:** Browser JavaScript, IndexedDB/Dexie, Node tests, Playwright.
**Spec:** ../specs/2026-11-07-memory-mcp-speech-refinement.md

## Global constraints
Preserve original 1900 behavior when disabled; no paid calls; preserve mixed EOL.

## Review focus
Archive switch during indexing; edited/deleted source messages; malformed model output; partial index quota failure; expired cached results after source/config changes.

## Tasks
- [x] V1/V2: Add failed-first cleaning and stable provenance tests; implement in auto_memory.js; verify safety/regression suite.
- [x] V3/V5: Add tests for index-only calls and query caching/invalidation; implement separate job/query modes; verify cancellation and partial completion.
- [x] V4/V6/V8/V9/V10/V11: Add retrieval quality fixtures; implement optional hybrid search, budgets, score-aware filtering and source dedup; preserve baseline when off.
- [x] V7: Add bounded structured rewrite with fallback and explicit independent settings; test malformed/failed/stale responses.
- [x] V12: Implement optional incremental index store; test migration, quota rollback, archive switching and portable backup compatibility.
- [x] UI/docs: Compact settings, cleanup preview, index controls, retrieval details. Update in-app help.
- [x] Verify whole suite and browser layout, then independent review and commit.

## Implementation evidence

- V1/V2: cleaning preview and complete body/exclusion tag scanner; exclusions run before body extraction so reasoning examples cannot become story. Original messages remain untouched. Stable source IDs/provenance are opt in.
- V3/V5: library indexing calls indexOnly and never embeds a dummy query; retrieval-only never builds missing chunks. Per-chat 16-query embedding LRU and 8-result/30-second cache, invalidated by source, timeline/category, settings, archive/model/API configuration and portable index identity. Queries themselves remain plain data.
- V4/V6/V8/V9/V10: character/overlap controls plus optional estimated per-chunk/per-batch token budgets; surrogate-safe sentence ranges; optional keyword/cosine fusion; current-history/summary/source/exact-content dedup; scored native rerank filtering with ordinary fallback. Full recall budget includes heading and entry metadata.
- V7: independent structured query organizer, maximum two queries, eight-second timeout, no persona/full-history disclosure; failures retain original query. API rewrite credentials are redacted and restored only for the same rewrite endpoint.
- V11: each source retains at most three scored hits; bounded heap retains final candidate shortlist. Local 100,000-row/top-30 ranking fixture: 43.08 ms full sort vs 4.46 ms heap, identical order. This measures shortlist ranking only, not end-to-end device retrieval latency. Exact cosine/worker fallback retained.
- V12: optional IndexedDB manifests/chunks, atomic incremental diff writes, character/group/archive/model scopes. Migrate by reusing old chunk hashes; preserve legacy source data. Quota failure after a partial write aborts the entire transaction. Chat-only and full backups materialize matching local cached indexes; excluding vector indexes performs no cache read.
- In-app settings keep advanced groups collapsed; ordinary summary panel never shows these controls. Browser actual app at 320/390/768 px verifies cleaning preview, saving/reopening new settings, and original chat controls.

## Rulings and limits

- Ruling: independent index is an optional derivative cache with a portable runtime mirror. Building it avoids global saveData; later ordinary saves may still persist the mirror for compatibility. No destructive migration, no deletion of original memory, no requirement for other UvU versions to understand the new DB.
- Ruling: no ANN dependency added. Bounded exact selection improves ranking without introducing approximate misses; physical-device large-library benchmarking remains useful.
- Ruling: the existing local Token counter is an estimate. Chunk/context budgets include metadata and user prefixes but do not claim official model tokenizer counts or billing equality.
- Query rewriting, reranking, overlap and explicit reindexing can add billed requests/tokens. Batch mode reduces round trips, not necessarily token charges. All advanced switches default off.
- Paid APIs and physical iOS/Android runtime/quotas were not used. Integration tests use fake IndexedDB and local responses; real browser QA uses Chromium.

## Verification ledger

- Initial baseline: 636/636 Node tests.
- Core first batch: 88/88 focused tests.
- Additional failed-first cases: configured chunk/state mismatch, malformed provenance, source duplication, result cache, token-budget chunks/batches, chat-only cache export, full recall header budget, native rerank omissions, timeline invalidation, reasoning/body tag order and UTF16 boundaries. All subsequently green.
- `tests/vector_index_store.test.cjs`: real fake-indexeddb transactions, delta writes, scope isolation, rollback, injected quota failure and closing late connections after failed opens: 4/4.
- `tests/legacy_1900_compat.test.cjs` with all new helpers loaded: 15/15, baseline comparisons available and not skipped.
- `tests/derived_panels_browser.cjs`, `tests/optimization_memory_browser.cjs`, `tests/documents_calendar_browser.cjs`, `tests/derived_icons_browser.cjs`: passed.
- Final frozen-tree suite: 713/713 passed, zero failed/cancelled/skipped. Changed production scripts pass syntax checks; local script/style references exist; diff whitespace checks pass with CR-at-EOL accepted.
- Independent review identified two OAuth races: stale refresh failure clearing a new login, and stale discovery replacing a renewed connection. Both reproduced in failed-first regression tests and repaired; independent re-review plus 45 focused MCP/OAuth/1900 tests passed.
- Final vector boundary fixes preserve original source offsets through whitespace and token chunking, count stable message sources in the library status, and close late IndexedDB connections after timeout/blocked rejection. Vector helper tests: 20/20.
- Final browser rerun: derived application panels at 320/390/768px and OAuth popup/callback passed. Earlier memory, document/calendar, icon, MCP and speech browser fixtures also passed. Original prompt builders, main reply request modules and original beautification styles are outside this diff.
