# UvU MCP services

Approved scope: an optional remote tool center, explicit role/archive grants, manual calls and an independent assistant planner. The original 1900 prompt builders, history selection, provider parsing and default reply path remain intact. With MCP disabled there are no MCP requests and no added context.

Support HTTPS Streamable HTTP, plus loopback HTTP for a user-operated local service (browser permissions/CORS still apply). Modern 2026-07-28 request metadata and legacy 2025-11-25/2025-06-18 initialization are separate modes. JSON and bounded SSE are supported. OAuth, stdio process startup, server-requested elicitation/sampling and native provider tool calls are not part of this delivery; show clear unsupported errors.

Nonsecret configuration is persisted as mcpSettings. Bearer and planner credentials use a separate per-origin browser vault, session by default, optionally remembered locally. They never enter new MCP configuration or database exports. This is browser storage, not encrypted secret storage. Imports are sanitized, disabled and grants reset. No automatic connection after import.

Tools require schema validation, explicit enablement and classification by the user; server annotations are advisory. Manual external writes require confirmation of tool/target/arguments. The automatic planner can use only tools expressly authorized as read-only for that role. It sees a bounded recent user question and tool descriptions, not the original persona, world books or complete history. Its output cannot grant permissions. Tool output is untrusted data, rendered as text; no executable HTML. No output is automatically saved as diary/vector memory.

Manual results may be explicitly queued for one selected role and active archive. Queues expire, are bounded, and are consumed for one reply attempt only. All requests capture chat object, archive and history identities; cancellation, configuration changes, grant revocation and archive changes invalidate late results. Errors fall back to the original chat path. Logs hold metadata and usage only, never credentials or raw arguments/results.

UI: API settings entry, per-role entry, central group/role selector; compact scoped CSS and internal scrolling; services, tools, independent planner, permissions and clear in-app tutorial. Existing environment configuration remains supported; a central-service mapping is optional.

Verification: protocol fixtures, hostile/malformed schemas/results, safe configuration import, vault isolation, persistence rollback, grants/revocation, stale archives, cancellation, planner boundary, disabled-path regression, mobile browser layout and full existing suite. No claim of physical iOS verification.
