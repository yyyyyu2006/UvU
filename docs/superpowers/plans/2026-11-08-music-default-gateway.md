# Music default gateway implementation plan

**Goal:** Let players scan a platform login QR without configuring a gateway once the operator has deployed a real HTTPS gateway.

**Design approved by user:** Ship a public default endpoint in a small standalone configuration file. A saved custom endpoint takes precedence. Account buttons remain visible; gateway settings move under a disclosure. The operator has not deployed a gateway, so the shipped endpoint must remain empty and the UI must state that account login is not yet available.

**Architecture:** Keep stored music settings separate from the effective endpoint so preference changes and backups do not pin a shipped default. Reuse existing session, QR and credential isolation code. Do not change original 1900 prompts, reply flow or styles.

**Tech stack:** Existing plain JavaScript, Node test runner and Playwright.

## Checks and implementation

- [x] Add failing tests for default resolution, custom precedence, reset, no default persistence, invalid/missing defaults, host-bound tokens and QR without manual connection.
- [x] Add `js/modules/music_config.js`, load before core, and expose effective gateway information from core.
- [x] Show platform account actions directly, collapse custom gateway settings, persist the remember option before QR creation, show explicit undeployed status.
- [x] Test browser flows with a fixture default, an unavailable gateway and no default; retain existing custom gateway behavior.
- [x] Update operator/player docs and asset cache versions. Run music tests, full unit suite and browser verification. Review the final diff before the authorized main push.

## Verification results

Four new tests failed before implementation, then all 53 core tests passed. Full unit suite: 863/863 passed. `tests/music_browser.cjs` passed 320/390/768 widths, undeployed buttons, shipped HTTPS gateway login without address/Connect, gateway outage and existing search/playback/playlist/reload behavior. Fixture QR authorization does not establish actual platform login success. Independent read-only code review reported no blocking findings. JavaScript syntax checks and `git diff --check` passed.

## Deployment boundary

No cloud server, DNS or certificate has been configured. No placeholder or local address may be advertised as an available public service. Only the public HTTPS base URL belongs in shipped config; cookies, vault keys and login tokens remain private. Actual platform authorization still requires real-device testing after deployment.
