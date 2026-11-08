# Moments Social Implementation Plan

> For agentic workers: execute inline using superpowers:executing-plans. The user approved the preceding 16-point design and requested implementation.

**Goal:** Add opt-in, identity-safe character/NPC interactions to Moments, preserving the existing private reply pipeline.

**Architecture:** A standalone data module owns typed actors and comment links; an independent AI module uses the existing provider request builder; a scoped UI module renders the enabled experience. Legacy mode, original prompt text and original Moments CSS remain intact. PNG character-card export is researched and presented as a separate interactive design, not shipped as an unapproved export format.

**Tech Stack:** Existing browser JavaScript, IndexedDB persistence, Lucide icon bundle, node:test, Playwright.

**Spec:** The 16-point design approved in the conversation on 2026-11-08.

## Global Constraints

- New interactions are off until explicitly enabled per character/archive.
- Never generate user speech or resolve an ambiguous actor by name.
- Never fall back to another post when a referenced target is missing.
- Keep the 1900 prompt text, private reply assembly and original CSS unchanged.
- NPC requests receive only explicitly shared public context and their own persona.
- Keep changes local; do not push without a new user request.

## Review Focus

- Identical user/character/NPC names and renamed actors retain distinct identities.
- Archive switches, deleted/edited targets and late responses cannot contaminate another conversation.
- Disabled, cancelled and repeated interactions make no unintended network calls.
- Save failure preserves existing comments, drafts and concurrent history arrivals.
- User/model content is rendered as text and backup validation covers the new fields.

## Task 1: Identity and Persistence

Files: `js/modules/moments_social.js`, `tests/moments_social.test.cjs`.

- [x] Test typed identities, ambiguous legacy names, stable legacy IDs, exact comment parents, save rollback, edits/deletions and archive isolation.
- [x] Implement `UvUMoments` settings, actor registry, normalized views and atomic mutations using existing chat mutation helpers.
- [x] Implement NPC management, user publishing, replies, likes, visibility, notifications and reviewed memory drafts.
- [x] Run the focused tests and verify no private history is added by NPC actions.

## Task 2: Bounded Social Generation

Files: `js/modules/moments_social_ai.js`, `tests/moments_social_ai.test.cjs`.

- [x] Test opt-in gates, persona knowledge isolation, actor/parent validation, finite turns, deduplication, cancellation and stale replies.
- [x] Implement independent per-speaker requests, explicit no-action results, cooldown, request caps and same-batch local reply references.
- [x] Implement NPC suggestions and third-person memory summary previews without automatic approval.
- [x] Integrate only gated post-save scheduling; legacy comments cannot also execute in the new social mode.

## Task 3: Feed and Management UI

Files: `js/modules/moments_social_ui.js`, `css/modules/moments_social.css`, `js/modules/peek.js`, `index.html`.

- [x] Add compact settings/publish/unread controls, NPC editors, contextual reply input, expandable comments, notifications and memory review.
- [x] Preserve drafts and scroll position, show cancellable progress and precise errors, retain drafts on failed saves.
- [x] Keep all new styling scoped; add a guarded render handoff in `peek.js`.
- [x] Browser-check 320/390/768 viewports, same-name replies, reload persistence and disabled-mode fallback.

## Task 4: Compatibility and Export Design

Files: `js/modules/storage.js`, regression tests, `docs/moments-social-and-card-export.md`, thread-owned visualization.

- [x] Validate imported social settings and moment references, preserving unrelated legacy fields.
- [x] Research SillyTavern, Character Card V2/V3 and PNG metadata implementations from primary repositories.
- [x] Produce an interactive export-panel draft with persona preview and selectable world books, plus field mapping and round-trip acceptance criteria.
- [x] Run focused/full tests, syntax checks, diff review and browser checks; report the actual verified coverage.

## Execution Notes

- 2026-11-08: Existing checkout is the user's requested `main`; implementation stays here, with no push or history rewrite. Existing `outputs/` is preserved.
- 2026-11-08: No delegated implementation is needed; review the final diff and exercise the high-risk cases directly.
- 2026-11-08: Independent review found and regression-tested archive changes during initial saving, concurrent post/comment rollback, concurrent journal rollback and ignored image removals. All corrected locally.
- 2026-11-08: Final full suite: 996 pass, 0 fail. Focused social tests: 30 pass. Browser flows and 320/390/768 layouts pass, including comment draft restoration after reload. Export draft selection/details and 320/736 layouts pass.
- 2026-11-08: At the end of the social implementation PNG export remained a preview; the subsequent approved card-export plan implemented its production encoder and panel. The user then authorized publishing both features to main. No live paid model validation was performed.
