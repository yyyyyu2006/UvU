# Character Music

Implement the approved 244px opaque white chat card. Preserve all original chat styling outside music cards.

Add a character playlist sheet in Music, reachable from Home and Library. Pin the selected character independently of the open chat; keep the selection on this device. Refresh explicitly calls the configured chat model for six song suggestions based on persona and recent eligible text, then resolves real tracks through the selected music source. Save successful results per character; preserve the previous playlist on errors, cancellations and changed archives/personas. Playback uses the existing queue and source adapters. Show unmatched counts rather than inventing track IDs.

An opt-in character setting enables invitations during normal replies. Extend the existing request-scoped music plan with bounded candidate IDs referencing saved playlist tracks; accept only an explicit invite command outside thinking and returned documents. Persist an assistant music card and let the user accept or decline; never autoplay an incoming invitation. One pending/accepted invitation at a time and a 30-minute cooldown. Do not modify the ordinary prompt or response path when disabled.

Use the existing chat mutation contract for profile and message persistence. Reject stale/replayed plans, changed archives, disabled relationships, withdrawn/context-disabled sources and failed persistence. Validate the profile in backup imports.

Order: focused failing profile/generation and invitation tests; implementation; compact card and sheet UI; unit suite; actual app browser tests at 320/390/768px with hostile bubble styling. No new dependencies or external services.
