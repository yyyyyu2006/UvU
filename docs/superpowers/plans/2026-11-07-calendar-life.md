# Calendar life implementation plan

> Implement inline with executing-plans and test-driven-development. User approved the preceding 14-part proposal, with mood UI replaced by round monochrome faces and dates below them.

**Goal:** Extend the existing calendar with persistent schedules, range selection, character planning, moods and private period tracking.
**Architecture:** Independent calendarData setting, serialized targeted persistence, pure civil-date calculations; scoped calendar UI; optional independent AI planner and bounded shared context. Original prompts and styling remain intact.
**Tech:** Vanilla JavaScript/CSS, Dexie, node:test, Playwright/Chrome.
**Spec:** Approved conversation proposal and supplied mood-calendar image, November 7, 2026.

## Global constraints
- Default-off AI and sharing; no original prompt builder modifications.
- Only selected character/archive may receive changes or shared data.
- White/light gray, 24px cards, 8/16/24px spacing, compact pills, 14px body; circular SVG moods with date below.
- Local records work offline without location; predicted period dates never become actual records automatically.
- No external dependencies or paid API calls during verification.

## Review focus
- Stale AI responses after archive/import/manual changes must not apply.
- Quota failure restores previous calendar state without saving unrelated chats.
- Calendar dates remain stable across timezone changes and leap/month boundaries.
- Disabled sharing yields empty context and zero planner calls.
- Nested panel styling and touch scrolling must not obstruct range selection.

### Task 1: Calendar data and calculations
Files: create js/modules/calendar_core.js, tests/calendar_core.test.cjs; integrate js/db.js and js/modules/storage.js.
Interfaces: UvUCalendar.owner(chat), state(), mutate(fn), events(owner,start,end), saveEvent(record,expectedRev), saveMood(record), savePeriod(record), predict(), context(chat).
- [x] Write failing tests: civil dates/ranges, recurrence exceptions, isolated owners, median prediction, overlap validation, targeted rollback, strict backup validation, sharing gates.
- [x] Run failing tests, implement pure calculations and serialized setting persistence, rerun.

### Task 2: Calendar UI and range gestures
Files: create js/modules/calendar_ui.js, css/modules/calendar.css, tests/calendar_life_browser.cjs; integrate environment_ui.js, panel_layout.js, index.html, music_ui.js.
Interfaces: UvUCalendarUI.open(); existing openEnvironmentCalendar delegates; existing environment providers remain unchanged.
- [x] Browser test fails for missing mood grid/range/editor/persisted selection/title home action.
- [x] Build month/calendar modes, timeline, editors, range pointer state, persistent view, weather/holiday details and local annotations; title returns home.
- [x] Verify 320/390/768 widths, touch/cancel, persistence, selected char weather settings and stale results.

### Task 3: Independent AI planning and shared cards/context
Files: create js/modules/calendar_ai.js, tests/calendar_ai.test.cjs; additive hooks in chat_ai.js.
Interfaces: UvUCalendarAI.generate(chat,date,signal), apply(chat,proposal), afterReply(chat); UvUCalendar.context(chat).
- [x] Test default-off no calls, valid structured proposals, stale revisions, locked/user record protection, failed/duplicate requests, bounded privacy-aware context.
- [x] Implement explicit preview/save, opt-in daily generation and autonomous updates, undo, permission UI and card sharing.
- [x] Exercise real request builder with fixture provider response; no live credentials.

### Task 4: Verification and documentation
- [x] Full node suite; existing calendar browser regression; new browser tests; screenshots visually inspected.
- [x] Review all diffs for disabled-path prompt identity, backup import and scoped styles.
- [x] Document operations and prediction/sharing limitations in app, commit verified result.

## Execution ledger
Baseline: 823 tests passed. Working in existing main checkout per user's standing main preference; no worktree created. No implementation changes before core failing tests.


### Verified completion — 2026-11-08
- Task 1: separate calendarData persistence, civil dates, recurrence, owner/archive permissions, mood and period records; targeted writes and quota rollback verified.
- Task 2: scoped white calendar, circular mood faces/dates, compact controls, internal scrolling, click/mouse/touch ranges, cancellation and selected-character restoration verified at 320/390/768px.
- Task 3: explicit AI preview/apply and opt-in automation; existing provider request builder exercised with fixture HTTP response. Shared cards are sent to the selected character and retain relationship restrictions.
- Task 4: full Node suite 851/851 passed. New calendar browser, original calendar/file browser and full music browser passed; screenshots visually checked at 320 and 390px. No live paid APIs used.
- Final review: independent calendar_review found queued AI archive validity, native touch long-press cancellation and sticky post-drag click suppression. All reproduced and corrected with regression coverage.
- Additional RED→GREEN checks: unknown import keys, stale mood/period editors, maximum-year prediction, modified AI preview dates, malformed AI times and conflict reporting, date-range cap, timezone gates, shared-card status-command isolation, blocked-share feedback.
- Compatibility: original prompt builders and group prompt file unchanged; normal reply ordering preserved. Calendar facts append only under explicit per-character grants; planner uses a separate request after delivery and is default-off. New CSS is scoped; original 1900 beautification files were not edited.
- Ruling: retain the existing main checkout and push directly to main under standing authorization. Cost: no separate review branch; covered by the complete suite and independent review.
- Ruling: monthly events on missing dates are skipped; ranges count both endpoints and preview at most 400 days. Cost: users select shorter ranges for longer searches.
- Ruling: long-press prevents native pan only after activation; normal short swipes retain native scrolling. Verified with real Chrome touch dispatch, with physical iOS/Android follow-up still recommended.
- Deferred minor: none from the independent review.

### Operations and limits
Open 日历, choose 我的日历 or a character, then select 日程 / 心情 / 经期. Click dates or long-press and drag; 选择范围 also supports two endpoint taps. 日历设置 contains routine, automation and per-character sharing. Manual AI plans require preview confirmation; automatic generation/autonomy need explicit switches. Existing chat API is used and may incur its usual usage.
Period predictions are separate from actual records and can be disabled. They are estimates for personal logging, not diagnosis or contraception. Calendar records and health records are included in settings backups; standalone export defaults to omitting health. Closing the webpage stops AI scheduling and does not guarantee system reminders.
