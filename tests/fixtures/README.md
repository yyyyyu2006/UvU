# Memory, bridge and MCP repeatable checks

All fixtures use synthetic stories and isolated databases. None calls a paid model or a private account.

- `node --test tests/memory_provenance_coverage.test.cjs tests/vector_refinement.test.cjs`: merge permission chains, effective summary replacement, deep edits, index preview, model-scope failure recovery and real storage projection.
- `node tests/vector_recall_benchmark.cjs`: fixed old promise, paraphrase, time change, same-name NPC and irrelevant questions; compare cosine/hybrid/rerank/query-rewrite code paths. Embeddings, rewrite and rerank are synthetic fixtures, so this measures regression contracts and request/token counts, not a real provider's recall quality. Replace fixtures with consented measured outputs before claiming model quality improvements.
- `node --expose-gc tests/optimization_memory_benchmark.cjs`: 1k/10k/25k × 128 dimensions, seven runs, stage P95 and heap delta. Main-thread local fallback is exercised; GC scheduling, workers and mobile memory differ. Linear scan stays available; this is not evidence that ANN is necessary.
- `npm ci --prefix tests/fixtures/mcp-sdk --ignore-scripts --no-audit --no-fund`, then `node --test tests/mcp_sdk_interop.cjs`: real official SDK 1.24.3 (MIT, pinned lockfile), loopback JSON/SSE, modern-probe to legacy negotiation, pagination, resources, prompt arguments, changed definitions, 401, abort and interrupted stream. Browser app does not load this SDK. Modern 2026 URI/name encoding uses `tests/mcp_transport.test.cjs`; the 2025 SDK fixture does not validate the 2026 protocol.
- `node tests/optimization_memory_browser.cjs`, `node tests/browser_bridge_summary.cjs`, `node tests/browser/mcp_browser.cjs`, `node tests/browser/mcp_oauth_browser.cjs`: actual isolated Chromium UI. Set `PLAYWRIGHT_MODULE` and `CHROME_PATH` for the local installation. These are desktop emulations, not iOS certification.

## Device checks still requiring hardware

Record device/OS, TT version and host ABI, bridge protocol, frontend build, transport and each result. Never attach story text, auth codes or tokens to diagnostics.

| Flow | Repeatable action | Required result |
| --- | --- | --- |
| TT ABI2 file handoff | Export selected floors; cancel system share; export again; import back | Cancellation creates no approved diary; successful roundtrip preserves floor, role and archive |
| TT history pagination | Select a range spanning multiple host pages | Count/order match source; no duplicate floors |
| TT extension.store failure | Deny/fill storage, send; restart host; retry | Error visible; draft retained; no cross-archive application |
| TT background suspend | Queue a transfer, suspend during part upload, resume and retry | Complete scene only once; receipts identify the fixed target |
| TT online relay | Use TT-compatible HTTPS relay; disconnect/reconnect | No ST server installation steps required; no insecure fallback |
| OAuth popup return | Authorize in popup/system browser, background UvU, return | Matching state/source/issuer only; credentials absent from export |
| OAuth same-tab callback | Use provider's supported same-tab flow, reload callback | Explicit supported recovery or clear unsupported state; do not assume desktop popup success covers it |
| OAuth expiry/logout | Expire authorization while backgrounded, resume, disconnect | Refresh/relogin bounded; logout does not resurrect old credentials |
| OAuth two services | Start two logins and complete in reverse order | Each callback bound to its own service and state; no token crossover |

No iOS/Android hardware or real OAuth account was used in the repair run. The device rows are pending verification, not passed tests.
