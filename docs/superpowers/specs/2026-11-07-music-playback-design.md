# Music cards and continuous playback

Approved: user accepted the preceding music optimization proposal and requested implementation.

Keep one audio engine and existing source adapters. Fix native pause-before-ended sequencing, add list repeat, shuffled rounds with actual history, priority next queue, bounded error skipping and explicit retry. Persist preferences/queue, never autoplay on reload. Existing order/one/shuffle values remain compatible.

Use white compact chat cards: artwork/title/artist/menu, elapsed/seek/remaining, favorite/previous/play/next/queue, invitation-only status. Historical cards keep their original song; only the current song gets live progress. Use delegated updates to mounted visible cards, never create an audio element per card. Preserve original chat gestures/quotes and styles outside music selectors.

Continuous together-listening is opt-in on an accepted invitation, bound to its original character/archive/history. Capture permitted queue keys at enable time; only those songs continue the session. Switching to an unrelated song, stopping, archive invalidation or ending clears the runtime binding. Auto switching never changes old message text, sends messages or calls AI.

Complete queue UI (move/remove/next/clear), explicit four-mode selection, playlist play/shuffle/rename/reorder/bulk removal, stable search and recent searches, clean synchronized original/translated lyrics with manual-scroll pause, local metadata editing, bounded metadata cache and cleanup, existing system media/voice safeguards. Whole audio download cache and external-device casting are capability-dependent and must not be represented by nonfunctional controls.

Alternatives: replacing the engine with a third-party player risks adapter/session regressions; embedding a player per card multiplies audio and subscriptions. Retain and extend the existing engine.

Constraints: no original 1900 stylesheet, base prompt, reply assembly, source credentials or unrelated modules changed. Only explicit music invitations use existing music request rules. No new paid API requests or remote deployment services.
