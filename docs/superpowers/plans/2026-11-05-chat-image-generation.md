# Chat Image Generation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation.

**Goal:** Generate and send a picture from the photo-description dialog on demand.
**Architecture:** A new ChatImageGeneration module owns UI state, fixed send targets,
image normalization, cancellation and retry. The workshop retains API transport;
the existing chat mutation helpers retain persistence and rollback.
**Tech Stack:** Browser JavaScript, Fetch, AbortController, node:test, Playwright.
**Spec:** docs/superpowers/specs/2026-11-05-chat-image-generation-design.md.

## Global Constraints

- Preserve original text-photo behavior and all chat prompts/reply assembly.
- Reuse workshop image configuration and current providers; no new credentials.
- Generate only after explicit submission; no paid API calls in verification.
- Preserve original file line endings and scope styling to the new dialog controls.

## Review Focus

- A late image must never enter another character's chat or a different archive.
- Cancellation and modal closure must discard late results, even if transport ignores abort.
- Failed persistence must roll back the image and allow retry without another generation.
- Provider images can be base64 or remote URLs; save validated durable image data.
- Existing workshop callers must work without supplying the new optional signal.

## Task 1: Generation, durable image sending and transport cancellation

Files: new js/modules/chat_image_generation.js and tests/chat_image_generation.test.cjs;
modify js/modules/image-workshop/generation.js.

Interfaces: ChatImageGeneration.setup/open/isSelected/send/cancel;
executeImageGeneration(settings, customPrompt, { signal } = {}).

- [x] Add failed-first coverage for sending, fixed targets, stale archives,
  cancellation, duplicate submits, malformed images, remote retrieval and save retry.
- [x] Forward an optional AbortSignal through both workshop provider requests.
- [x] Implement isolated generation and normal image-message persistence.
- [x] Run focused tests and confirm original workshop transport remains compatible.

## Task 2: Dialog integration and verification

Files: index.html, js/modules/chat_features.js, css/modules/derived_features.css.

- [x] Add compact text-photo / AI-image mode controls and cancellation/status UI.
- [x] Keep legacy text submit unchanged; bind generated-image mode to its module.
- [x] Update only affected resource versions.
- [x] Run full regressions, browser workflow/layout checks and prompt byte comparisons.
- [x] Complete independent review and prepare release under standing authorization.

## Execution Notes

The user explicitly requested implementation. Continue within the existing checkout
and prior publication authorization. The image API choice follows the existing
workshop configuration; this is an implementation choice, not a new user setting.

Verification: 527/527 regression tests pass. Chromium checks use the actual dialog,
styles, workshop transport/parser and message renderer at 320, 390 and 1024 px.
Original text sending, GPT and NovelAI picture generation, decoded image rendering,
cancellation and layout pass with mocked APIs. Original chat_ai.js,
chat_ai_prompt.js, group_chat.js, utils.js and chat_render.js match the base commit.

Final review: fixed modal ownership during a reopened dialog's earlier save and
timeout recovery when provider preparation never settles. Each has failed-first
regression coverage. No paid request or physical-device test was performed.
