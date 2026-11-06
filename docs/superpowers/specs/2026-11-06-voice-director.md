# Voice Director

Approved scope: independent, opt-in voice direction for emotion, speed and pauses.
No laughter, sighs or other added vocalizations. Preserve the original chat prompt,
reply pipeline, stored messages, visible transcript and per-character voice IDs.

The director runs only on a user's voice-playback/preview action. It receives a
bounded snapshot of the speaking character and preceding eligible messages from
the specific message's archive. Future messages, thinking/status blocks, media
payloads and excluded messages are omitted. A stale source aborts playback.

It returns JSON containing `emotion`, `speedMultiplier`, and up to six pauses
`{after, seconds}`. `after` must uniquely match an existing punctuation-ended
phrase inside the original line. The client inserts only MiniMax pause tokens,
never arbitrary model text. Emotions are limited to the seven common MiniMax
values or automatic selection; unsupported controls fall back to normal TTS.

Approaches: reusing the primary chat reply to produce speech tags would change
its prompt; rewriting spoken text with an unrestricted director could alter the
line. The chosen independent structured director avoids both changes.

Settings live under `minimaxTtsSettings.director`: enabled (default false), provider
(OpenAI-compatible or Gemini), endpoint, API key, model, context message count,
timeout and additional direction instructions. Preview uses the unsaved form.
Director requests are independently authenticated, cancellable and bounded by a
timeout. Errors fall back to ordinary TTS with a safe explanatory status.

Cache keys include source context, character/archive/message identity, director
settings and voice settings. Retry after autoplay rejection uses prepared audio
synchronously with no extra paid request. No director metadata enters diaries,
chat history or subsequent chat prompts. Settings backup uses the existing
settings category; credentials are included in that category just like other APIs.

Verification: failed-first focused tests, full regression suite including 1900
equivalence, browser playback integration and narrow mobile/desktop layout checks.
