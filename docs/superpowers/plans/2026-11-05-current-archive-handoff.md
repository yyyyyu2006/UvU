# Current archive handoff correction

Goal: Hand off the selected character's live active archive, with visible identity, range and receipt metadata. Preserve scene isolation and both applications' original prompts and reply flow. Execute inline under the existing user authorization.

Root cause: UvU retains a character selection created at startup; entering the bridge does not follow the last open private chat. Tavern retains an older archive as its default review/source. A UUID-only list and missing transfer metadata make an old transfer look like current archive recognition. Actual publication already reads activeArchiveId and live history, not archives[0].

1. Write failing UvU tests for entering from another character, live branch history versus stale stored archive snapshots, and immutable transfer identity during an awaited save.
2. Add a bridge-local refresh on entry and a use-current-chat action. Show the selected character's live archive name/ID, history count and latest eligible message. Reset range on archive identity changes. Keep explicit character selection within the panel.
3. Attach optional archive name and manual handoff identity/range/count/time metadata to existing memory_packet payloads. No relay protocol or prompt format changes.
4. Write failing Tavern tests for latest manual transfer on refresh, same IDs across branches, metadata for tombstoned records and no cross-character injection. Track archive receipt metadata and make manual refresh browse the latest handoff without changing pinned scene source; retain drafts and deletes.
5. Update both tutorials and plugin version 0.3.5. Run focused then full suites, mobile browser and real publisher-to-relay-to-review verification. Inspect diffs and push only after checks.

Review focus: no automatic source reassignment; existing tombstones survive; metadata never grants approval; queued messages keep their original target after archive switch; current archive means active live data, not saved archive.data.

Verification: UvU 376/376 tests; bridge 44/44 tests. Real Chromium exercised the page-entry observer and actual UvU publisher through the real relay store to Tavern review, approval and pinned scene prompt checks at 320/375/412 px. Existing archive review, guide and 320/390 px layout checks passed. The older browser pairing check now waits for its asynchronous response. Original prompt/reply builders untouched. Physical handset/Termux verification remains outstanding.
