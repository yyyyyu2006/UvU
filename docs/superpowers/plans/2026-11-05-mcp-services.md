# MCP implementation plan

Spec: ../specs/2026-11-05-mcp-services-design.md
Base: 1b72ccbdce975b6a1269cfb040a9a73847e77918

Global constraints: additive modules; original prompts untouched; off means no request change; no new CDN runtime; credentials outside backups; no unbounded remote reads or automatic writes; mixed EOL preserved. Continue the user's authorized in-place main workflow and push after checks.

## Task 1: Protocol and validation
- [x] Add failing protocol tests; observe missing transport failure.
- [x] Add mcp_transport.js: endpoint checks, abort/deadline, bounded JSON/SSE, strict IDs, modern metadata and legacy initialization, pagination, explicit unsupported results. No tool-call retries.
- [x] Bundle pinned Ajv 2020 and draft-07 validator locally with license/source/rebuild instructions. Reject unsupported schema references/formats instead of guessing.
- [x] Pass focused transport/schema tests.

## Task 2: Service state and permissions
- [x] Add failing tests for sanitization, vault, atomic persistence rollback, role/archive scope and one-request contexts.
- [x] Add mcp_services.js: normalized nonsecret settings, separate vault, test/discover/call, explicit manual confirmation, read-only grants, bounded transient logs/results.
- [x] Integrate global settings/backup validation with imported configurations disabled and credentials stripped.
- [x] Pass focused state/security tests.

## Task 3: Optional chat planner and environment adapter
- [x] Add failing tests for disabled zero-impact, bounded planner input, grant enforcement, stale/cancel/failure fallback and token separation.
- [x] Add mcp_chat.js independent nonstream planner; opt-in hook in chat_ai.js; append only data context and account separately without rewriting original prompts or provider handling.
- [x] Add optional central environment service mapping, preserving existing public/legacy paths.
- [x] Pass focused compatibility tests.

## Task 4: UI and documentation
- [x] Add MCP service management, paginated tools, generated simple forms/JSON parameters, safe results, manual confirmation, per-role authorization and planner configuration.
- [x] Scoped compact CSS, API and role entries, in-app tutorial and supported limits. Config export/import omits secrets/results.
- [x] Browser fixture end-to-end at 320/390px: add/test/discover/call/queue, close cancellation, no horizontal overflow. Verify existing main chat path and full suite.

## Task 5: Review and ship
- [x] Fresh read-only whole-change review (explicit executing-plans review), fix important findings with red/green coverage.
- [x] Restore unchanged EOL, diff/check/suite; commit and push; verify remote SHA and clean worktree.

Interfaces: MCPTransport.create(config, token).listTools/call; MCPServices settings/vault/scope/test/call/queue; prepareMcpChatContext(chat,type,signal) returns only a bounded text context. All consumers use these interfaces; no original prompt builder imports the service manager.

Review focus: raw secrets in export/logs/error bodies; stale credentials after endpoint edits; role/archive and config changes during network awaits; untrusted schema compilation and server text; tool-call duplicate side effects; modern/legacy era negotiation; session mismatch; HTTP redirects; ordinary replies with no MCP grants.
