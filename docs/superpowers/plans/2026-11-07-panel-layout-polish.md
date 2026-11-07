# Derived panel layout polish implementation plan

> Execute inline with superpowers:executing-plans. The user approved the six mockups, fifteen panel groups and restrained motion in the preceding conversation.

**Goal:** Apply the approved white card layouts to all second-edition panels without editing original 1900 styling or reply/prompt/data behavior.

**Architecture:** Add a scoped presentation stylesheet and an idempotent panel decorator. Reparent existing controls without replacing their event handlers, IDs, names or save semantics. Change added file/editor UI builders only where presentation needs direct integration; never rewrite source CSS or request modules.

**Tech stack:** Existing vanilla HTML/CSS/JavaScript, local Lucide subset, existing Playwright application harness.

**Spec:** Approved fifteen-point UI checklist and `uvu-panel-layouts.html` draft from this conversation.

## Constraints

- Original 1900 CSS files, custom CSS, chat controls, prompt assembly, providers, memory algorithms, storage and bridge protocol stay unchanged.
- Scope selectors to known added panels/controls. No generic body/form/input/button restyling.
- Preserve summary/vector separation, visible Tavern review, persistent character/archive selection and independent voice director.
- Respect actual settings save semantics. Keep permissions, scope, costs and actionable errors accessible.
- 16px mobile input text, effective 44px touch controls, 16/24px spacing, 20–28px card radii, white/gray surfaces.
- No new runtime dependencies. Motion uses specific properties and reduced-motion support; no delayed business actions.
- Preserve existing source line endings and all existing control IDs.
- User previously authorized main checkout and direct main publication; use that checkout.

## Review focus

- 320px width, short keyboard viewport and long filenames: no horizontal overflow or inaccessible footer actions.
- Rerendered/dynamically inserted panels: no duplicate controls, infinite observers or lost callbacks.
- Collapsed settings: native validation must reveal invalid fields; hidden vector fields must keep their existing mode rules.
- ST/TT and summary/vector transitions: only applicable fields and actions appear; tutorials/review remain discoverable.
- Original custom chat/status: no added layout participation, intercepted swipe, changed prompt or persistence.

## Tasks

- [x] 1. Establish baseline and application browser checks for layout, toggles, dynamic re-rendering and unchanged original controls.
- [x] 2. Add scoped presentation layer; implement file, summary, vector and memory library layouts.
- [x] 3. Implement Tavern, voice/director and MCP progressive layouts, retaining permission/scope and current save behavior.
- [x] 4. Apply environment/calendar, editor/model, Token/status additions, stickers/avatar, relationships, backups, notifications, reroll and generation layouts.
- [x] 5. Add lightweight panel/tab/disclosure/notification transitions and reduced-motion handling; verify real browser workflows, narrow/short layouts, full suite and original-file diff guard.
- [x] 6. Review final changes and preserve source EOLs. Publish main after verification under standing authorization; report the actual deployed commit in the final response.

## Execution ledger

- Baseline: `ee0a826`, main, clean; work in the existing authorized checkout.
- Ruling: no new attachment transmission or API behavior is introduced for visual mock elements; keep the current file send contract and expose existing operations.
- Ruling: preserve native select/checkbox controls and associated callbacks; use visual switches only for boolean settings, never multi-selection or permissions attestations.
- Ruling: browser workflow checks are the meaningful verification for this reversible presentation change; no mirror-only unit tests.


## Completed panel coverage

| Group | Presentation changes |
| --- | --- |
| File sharing | Current-chat identity, compact replacement upload, left tools, preview, secondary export, cancel/send footer; existing send target and formats preserved. |
| Auto summary | Switch card, three existing coverage counters, floor rules, API selection, optional compression/requirements, concise footer. |
| Vector | Independent view, embedding and rerank sections, optional advanced/retrieval fields; original form values and API routing retained. |
| Memory library | Search first, add in heading, secondary operations in disclosure, expandable text previews. |
| Tavern | ST/TT segment, connection settings, role/archive handoff, compact range, visible incoming review, tutorial last; async rollback reflects actual channel. |
| Voice/director | Playback, independent director, optional API/rules, voice connection; fields save through existing handlers. |
| MCP | Enable card, service/tools/role authorization order retained, progressive planner and call logs. |
| Environment | Location/settings and weather/time overview, optional data services; native calendar date states retained. |
| Expanded editor | Search/replace disclosure, content workspace, bottom draft/discard/apply; shortcuts, Tab loop, draft and scroll restoration verified. |
| Model picker | Search remains first, selected row checkmark, wrapping long names. |
| Token/status additions | Clear numeric hierarchy, compact per-item rows, circular controls; original front-template swipe unchanged. |
| Stickers | Compact options and toggle alignment, preview/list spacing. |
| Avatar/relationships | Open candidate preview, optional explanatory details, autonomy before recovery, consistent controls. |
| Backup | Pill import/export mode, category/credential/index option spacing, progress feedback; original backup format and transactions unchanged. |
| Notifications/reroll/generation | Concise preferences with capability details, white single banner, compact reroll, framed image preview. |

## Verification and review

- Baseline and post-change unit run: 636/636 passed.
- Actual application browser checks: 320/390/768 widths and 390x420 shortened viewports; file preview/draft/scroll/apply, summary save/counts/API disclosure, vector rerank, memory preview idempotence, voice save/director, model search, avatar, reroll, notification save, backup mode, ST/TT file mode and async save rollback, reduced motion. No uncaught page errors.
- Document/calendar workflow passed: TXT/Markdown/DOCX/English and Chinese PDF/CSV/TSV/XLS/XLSX parsing, pinned target sends, download, edited reply files, storage, malformed protocol isolation, stale archive checks.
- Status touch workflow passed with the new layer: left/right historical iframe swipe, Token flip preserving position, 44px non-overlapping controls, delete, location save, permission fallback.
- Local icon callbacks/dynamic decoration, TT file onboarding and MCP HTTP/SSE authorization/call workflow passed.
- Independent read-only review identified and resolved: Ctrl/Cmd+H disclosure, document draft identity, async channel rollback styling, and keyboard Tab trapping with closed details.
- Review caught an overlapping status delete control; retained its existing gap around the original close button. Calendar state colors do not animate.
- A test fixture journal lacked the original required range field; supplied a valid fixture rather than modifying original diary code. Disabled default backup reminder in the test fixture only.
- EOL restoration preserves exact bytes of unchanged lines in existing touched files. Only new scoped CSS/JS, added file UI, asset registration, tests and this plan are changed; no existing CSS or reply/prompt/storage/bridge implementation files modified.
