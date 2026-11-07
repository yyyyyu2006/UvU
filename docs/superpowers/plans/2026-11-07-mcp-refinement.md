# MCP refinement implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task by task. Track completed work here.

**Goal:** Implement M1–M12 from the approved checklist.
**Architecture:** Extend the existing service, transport, planner and UI modules; no changes to original prompt builders.
**Tech Stack:** Browser JavaScript, JSON Schema, Node fixtures, Playwright.
**Spec:** ../specs/2026-11-07-memory-mcp-speech-refinement.md

## Global constraints
No automatic write replay; role/archive grants remain mandatory; OAuth/remote prompts opt in; no paid calls.

## Review focus
Partial service failure; output schema mutation; expired sessions; authorization callback spoofing; role/cache isolation.

## Tasks
- [x] M1/M2/M3: Failed-first tests for partial success, valid bounded JSON and output schema validation/signatures; implement and run focused suite.
- [x] M4/M5/M9/M10: Transport recovery only for safe requests; bounded concurrent discovery/reads; canonical scope-aware cache; planner budgets. Test cancellation and write non-replay.
- [x] M6/M7/M8: Browser OAuth discovery/PKCE/callback and explicit resource/prompt previews; improve nested fields. Test local fixtures and hostile inputs.
- [x] M11/M12: Explicit environment mappings, result destinations, safe diagnostics and concrete in-app tutorial.
- [x] Verify focused tests, browser checks and review; report all files/settings/defaults and limits.

## Decisions and concrete boundaries

- M5 recovery only reinitializes an expired legacy session once on HTTP 404 for explicitly user-classified read-only calls and list/read previews. There is no blind network/429 retry and no write replay.
- M6 uses public pre-registered client IDs and PKCE S256. Dynamic client registration, OAuth client secrets and native callback schemes are deliberately not implemented. Servers must support browser CORS, protected-resource/authorization metadata and registered callback URLs. Callback state, origin, popup source, issuer and service configuration are checked. Credentials and refresh tokens stay in browser storage outside backups. Same-grant token rotation invalidates service connection/cache without revoking already-approved results; new login/logout/config changes revoke them.
- M7 resources/prompts are explicit list/preview/copy/export only. They are not minted as chat context and never replace system prompts. Binary content is not loaded.
- M8 object fields expand recursively up to 4 levels / 60 fields. Arrays, schema references/composition and extra complex shapes remain JSON-editable. Final full schema validation is authoritative; path-specific diagnostics cover ordinary nested type/required/range fields.
- M9 defaults preserve serial operation: 30s total optional planner budget, concurrency 1, max tool catalog 30. User may choose concurrency 1–3, time 1–60s and catalog 1–30. Cache remains max 40 entries with 0–300s tool-specific TTL; canonical keys include service/tool signature plus role/archive/history identity.
- M11 reuses existing environment mapping UI, adds direct access and explicit fill-from-user/char-location buttons for declared coordinate/timezone/country fields. No guessed coordinates or automatic permission grants. Original environment module not edited.
- M12 tool results have preview/copy/export or explicit one-reply context destination. Long-term memory remains an intentional existing memory-editor workflow rather than automatically persisting weather or remote instructions. Diagnostics only keep stage/status/code/timing/protocol, never arguments or bodies.

## Verification evidence

- `D:/node.exe --test tests/mcp_services.test.cjs tests/mcp_transport.test.cjs tests/mcp_schema.test.cjs tests/mcp_oauth.test.cjs tests/mcp_forms.test.cjs`: 48 passed.
- `tests/browser/mcp_browser.cjs`: passed local cross-origin JSON/SSE, pagination, add/test/authorize/call/queue/export, isolated planner API usage, write confirmation, safe rendering, nested errors, resource/template preview, correct export button label, internal scrolling at 320/390px.
- `tests/browser/mcp_oauth_browser.cjs`: passed real popup navigation through local intercepted HTTPS authorization fixtures, PKCE callback/issuer/state/source checks, token exchange, authenticated discovery, credential-free export and disconnect.
- No paid APIs called. Physical Android/iOS popup, PWA lifecycle and third-party OAuth providers remain unverified.
- Parent owns index script integration, storage validation/redaction, whole-suite compatibility and final diff review. No original prompt builders or request provider flow edited here.
- Final independent review fixed two reproduced races: an obsolete refresh HTTP 400 cannot clear a newer login; a pending old-token discovery cannot overwrite a connection created after rotation. Connection revisions remain separate from authorization/result revisions. New connect/disconnect invalidate previous refresh associations. Focused MCP/OAuth/1900 tests: 45/45; complete application suite: 713/713.
