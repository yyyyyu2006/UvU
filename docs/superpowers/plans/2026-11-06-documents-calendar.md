# Character calendars and document sharing

Goal: choose a named character's calendar and share readable documents with that character, receiving edited copies as new messages.

Architecture: calendar selection captures a concrete character, independent of the open chat. An isolated chat_documents module parses documents, renders safe text-only cards and previews, and supplies optional request-scoped document instructions. Original prompt text and ordinary response parsing remain unchanged when no shared document is in the selected history.

Formats: TXT, Markdown, DOCX, text PDF, CSV, TSV, XLSX and XLS. Read documents locally; never execute document HTML, macros or formulas. PDF and Word layout is not round-tripped. Keep original downloads and offer editable text/Word exports. Scanned/encrypted PDFs receive explicit errors. Bound file size, extracted characters and request input; show limits before sending.

## Implementation and verification
- [x] Calendar: concrete character selector, named settings target, stale fetch cancellation; test selection independent of current private chat.
- [x] Document core: bounded parsing, metadata validation, request budgets, source-linked response protocol; tests first for unsafe names, missing sources, canceled/archive-switched sends and failed persistence.
- [x] UI: compact attachment card, preview/editor and downloads, original/new version distinction; existing chat toolbar gets an additive file action.
- [x] Integration: optional request hook after existing history filtering, optional response extraction before legacy thinking/message parsing; preserve 1900 baseline equality. Add backup field validation.
- [x] Verify actual PDF/DOCX/spreadsheet parsing in browser, send/edit/return, 320/390/768 layout, full regression suite, byte-preserving diff check.

Ruling: work in the existing authorized feature branch; no new worktree; final read-only code review completed. Returned files use an explicit source message ID from this request, never overwrite originals, and do not run tools or save arbitrary model-supplied paths.

Verification: named calendar + stale result guard; local English/Chinese PDF, Word and spreadsheet parser fixtures; real full-app request composition, response-to-new-file, manual edits, file-only response, malformed protocol rejection, IndexedDB persistence and backup validation passed. Browser layouts checked at 320/390/768px. The original 1900 prompt/request equality tests now also load the new optional document module.

Final validation: 636 regression tests passed (zero failures/skips), plus four full-app/browser scripts. Review regressions cover filenames not executing legacy transfer/status commands, normal transfer commands still executing, and retaining unsent text when changing recipient.
