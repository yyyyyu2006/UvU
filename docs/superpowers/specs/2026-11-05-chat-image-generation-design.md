# Chat Image Generation

Add an optional AI image mode to the existing photo/video description dialog.
The original text-photo mode stays the default and calls sendMyPhotoVideo unchanged.
AI image mode uses the user's description and the workshop's current image API,
model, preset and image settings through executeImageGeneration. A separate image
API form or automatic chat-prompt rewrite would duplicate existing configuration.

The user requests generation followed by sending: generate one real picture, store
it as a normal user image message with its description in text parts, and use the
existing rendering, backup and request formatting. Do not auto-trigger a reply.
Do not edit chat prompts, history selection, custom CSS or persona settings.

Capture the target character/group, archive and workshop settings before awaiting.
Never render into another chat; a deleted target, switched archive or changed
relationship invalidates the send. Allow cancellation and a 180-second timeout.
Disable duplicate submissions. Preserve the draft on failure; retain a generated
picture after a failed save so retrying the same draft does not regenerate it.

Accept workshop base64/data-URL and HTTP(S) image responses. Download remote images
without API credentials before persistence, validate PNG/JPEG/WebP signatures and
limit images to 15 MiB. Keep original image resolution. If downloading fails, show
an actionable error rather than sending an expiring or broken URL.

Use scoped compact mode controls and loading/error status. Reuse document expansion.
Verify success, cancellation, save rollback, stale targets, alternate chat routing,
both workshop providers, old text-photo behavior and mobile/desktop layout. Use
mocked APIs only; paid generation and physical-device testing remain manual.
