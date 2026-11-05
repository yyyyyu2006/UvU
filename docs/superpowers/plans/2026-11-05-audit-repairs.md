# Audit repairs and TT onboarding implementation plan

> Approved scope: the user's 2026-11-05 instruction to repair the preceding audit checklist and clarify TT operation. Implement with focused regression tests and a final independent review.

**Goal:** Repair the ten concrete audit defects and explain usable TT file handoff without a backend, while preserving 1900 prompt text and ordinary request order.

**Architecture:** Keep existing modules and public entry points. Add session/scope guards and local rollback rather than replacing prompt builders or global persistence. TT file exchange and optional private HTTPS relay must be visibly separate in both apps.

**Constraints:** Preserve source line endings in untouched code. No modifications to 1900 reference. No blanket database dirty tracking or approximate retrieval without performance evidence. Never include pairing/admin credentials in exported backups. Existing MiniMax API backup policy follows explicit API configuration export. No paid API use during tests.

## Task 1: Backup validation and missing voice configuration
- Files: js/modules/storage.js; tests/backup_formats.test.cjs; tests/storage_persistence.test.cjs.
- RED: malformed required message fields and worldBookIds rejected; legacy valid media preserved; voice configuration exported/restored.
- GREEN: validate consumed structures and add minimaxTtsSettings to appropriate backup setting keys; preserve unknown extension data and atomic selected-category imports.
- Verify: focused backup/persistence tests, then full suite.

## Task 2: Archive runtime and failure recovery
- Files: js/modules/chat_archives.js; tests/chat_safety.test.cjs or dedicated archive regression.
- RED: empty/branched archives reset or clamp derived autonomy counters and do not inherit stale vector indexes; failed switching/creation restores old state without overwriting newer navigation.
- GREEN: separate preserved configuration from runtime state; local rollback of archive changes; keep save transaction behavior.
- Verify: focused archive tests, vector/archive safety tests.

## Task 3: Call, response persistence, duplicate override and editor scope
- Files: js/modules/video_call.js; js/modules/chat_ai_call.js; js/modules/chat_ai.js; js/modules/settings_chat.js; js/modules/text_editor.js; relevant tests.
- RED: late call responses ignored after hangup/replacement/archive change; old finalizers cannot reset new controls; save failure removes only uncommitted AI mutation; punctuation names work using real script order; editor progress isolated by owner.
- GREEN: session controller and immutable request scope; response mutation rollback; single escaped status implementation; owner-qualified editor key.
- Verify: targeted tests and 1900 request equivalence.

## Task 4: World-book regex and MCP schema
- Files: js/modules/worldbook_rules.js; js/modules/mcp_services.js; relevant tests.
- RED: pathological imported regex bounded/rejected without blocking main thread; const/default/examples never interpreted as schemas for headers.
- GREEN: bounded supported regex subset or isolated timeout matching without changing synchronous legacy keyword path; schema-aware header traversal.
- Verify: worldbook activation/ordering and MCP suites.

## Task 5: TT file workflow and tutorials in both apps
- Files: UvU index.html, js/modules/story_bridge.js and bridge tests; sibling bridge index.js, style.css, docs/tt-deployment.md, README.md, manifest/package version if needed, tests.
- RED/browser: TT file mode never requests backend/pairing, hides ST instructions and relay credentials, exports/imports by selected character/archive; HTTPS mode has explicit prerequisites and rejects static Pages as relay.
- GREEN: default TT to clearly labelled no-server file workflow, visible ordered steps and correct contextual errors; progressive optional private-relay setup. Preserve scene identity/review gates and original prompts.
- Verify: both suites and mobile-width browser fixtures.

## Task 6: Final verification and review
- Run UvU and bridge complete suites, JS syntax, existing mobile browser fixtures and 1900 fixture comparisons.
- Review diff/line endings; request independent review of concurrency, rollback, backup compatibility and TT controls.
- Performance items: retain measured conservative behavior; document what remains benchmark-driven rather than silently rewriting save/index paths.
