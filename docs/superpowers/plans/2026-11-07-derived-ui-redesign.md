# Derived UI redesign implementation plan

> Execution: superpowers:executing-plans, inline in the user-authorized main checkout.

**Goal:** Give all second-edition panels a coherent minimal white/gray card layout and publish it to the actual Pages site.

**Architecture:** Consolidate the scoped `ui_harmony.css` layer instead of stacking contradictory overrides. Retain DOM IDs, event handlers, data attributes and original workflows; group static added controls and move long guidance into disclosures.

**Tech stack:** Existing HTML/CSS/JavaScript, local Lucide SVG subset, Playwright.

**Spec:** User's white/light-gray, 20–28px card radii, pill actions, 8pt spacing and minimal secondary copy. Original 1900/custom chat styling and reply/prompt logic are outside scope.

## Constraints and review focus

- No changes to prompt, provider, reply, storage or bridge protocol modules.
- Retain visible Tavern review, character/archive pinning and voice director controls.
- Inputs and help must remain readable in light/dark OS settings and narrow/short viewports.
- All action labels, keyboard access, hidden/open states and original controls must work.
- Preserve mixed source line endings. Verify actual live content, not just a successful push.

## Tasks

- [x] 1. Consolidate shared styling for file, summary/vector memory, MCP, Tavern, voice/director, environment/calendar, relationship, editor, model picker, sticker/backup/notifications and Token add-on panels. Verify with existing and actual-app browser fixtures at 320/390/768px.
- [x] 2. Group MiniMax connection/voice/director controls; simplify Tavern headings/actions and collapse only the tutorial; organize summary guidance and retain all setting controls. Shorten redundant new-panel copy without changing behavior. Verify DOM order, disclosure behavior and callback regressions.
- [ ] 3. Review screenshots and run relevant browser checks plus full unit suite and whitespace diff. Obtain a final independent review, fix substantive findings, commit/push main under existing authorization.
- [ ] 4. Track Pages deployment and verify live new file markup and versioned CSS. Failed Nov 6 run 42240005709 built successfully but deploy timed out; do not alter app code or SW based on that hosting failure.

## Progress

- Deployment diagnosis: public Actions jobs/annotations confirm `Timeout reached, aborting!` in deploy, not build. Site still serves previous successful deployment.
- Baseline: main 3f809e3, clean. User previously explicitly requested direct main push; continue in this checkout.

- Verification: 636/636 unit tests; actual 12-panel app checks at 320/390/768 and 420px height; file parsing/target pinning/short viewport; MCP authorization and real local JSON/SSE; icons, relationship checkbox and keyboard dialog tests passed. HTML IDs and control tags retained.
- Independent review found shared button specificity masking calendar states. Fixed by lowering mixed ID root specificity with :where and retaining explicit day-state styles; actual-app regression observed failure then pass for today/holiday/workday/selected. No outstanding findings.
- Deliberate scope: solid white content cards replace the previous nested glass blur; original 1900/custom chat styling and all JavaScript implementations untouched.
