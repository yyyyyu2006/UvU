# Online review refresh and status deletion

Implementation plan; execute inline under existing authorization.

Goal: Refresh received online archives in Tavern, review the latest 50 messages, delete received copies, and delete one displayed status snapshot.

Architecture: Retain the authenticated relay and existing scene guards. UvU owns the source chat; Tavern refresh reads transferred events. Draft selections remain separate from approved injection. Deletion never touches source messages or prompt templates.

1. Add failing regression tests for latest-50 eligible ranges, accurate handoff results, edited source revisions, review draft preservation, deletion persistence and current status deletion/rollback.
2. Extend UvU handoff defaults and explicit resend revision handling; keep normal chat assembly unchanged.
3. Add Tavern refresh/count feedback, draft latest-50 selection, received-copy deletion with tombstones and revision re-review. Retain archive/chat/scene isolation.
4. Add matching circular status delete control to the right of close; persist only the displayed snapshot and retain template/history navigation.
5. Update both in-app tutorials and asset/version identifiers. Run both full suites, baseline 1900 comparisons, and mobile-width browser checks before commit/push.

Review focus: unsaved edits during polling; source edits need reapproval; deleted copies cannot replay; archive switches during operations; last status snapshot and storage failure.

Verification: UvU 373 tests pass, including eight 1900 baseline comparisons. Bridge 28 tests pass. Chromium checks cover refresh with unsaved edits, deletion replay, status snapshot deletion, touch swipes and flip preservation at mobile widths. No default prompt/request builder changes. Physical phone and live Tavern installation remain user-side validation.
