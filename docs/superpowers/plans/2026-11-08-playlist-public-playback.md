# Imported playlists with public playback

**Goal:** Let the user's existing imported NetEase/QQ playlists play through the already integrated, explicitly enabled public source.

**Design:** Preserve original track IDs, metadata and playlist order. A visible public-playback checkbox in playlist/source settings selects a global playback preference; selecting it also explicitly enables the public source. The default account path remains unchanged. NetEase IDs map directly; QQ songs require conservative title/artist/version matching, with ambiguity rejected. Resolve on demand, cache only bounded matching metadata, never bulk-fetch an entire playlist or store media URLs. Lyrics follow the selected recording.

**Files:** `music_public.js` owns matching; `music_core.js` owns optional routing, cancellation and cache isolation; `music_ui.js` exposes the setting; `storage_features.js` preserves only the portable preference; existing music tests cover behavior. Only additive music styling is eligible for layout changes.

**Video evidence:** Imported tracks/artwork exist. Playback fails at source resolution with the unavailable-source message, not during playlist import.

- [x] Write failing matching tests: direct NetEase identity, QQ artist/version discrimination, ambiguity, cancellation, bounded cache.
- [x] Write failing core tests: no gateway/login calls in public mode, original identity preserved, matching lyrics, switching/disabled source cancels pending audio, normal account route unchanged.
- [x] Implement matching and routing. Keep rights/availability unknown and preserve existing request budgets.
- [x] Add compact controls to playlist and source panels; update tutorial, portable preferences and asset cache keys.
- [x] Run relevant unit tests, full suite and browser flows at 320/390/768; verify optional routing and unchanged playlist identity.
- [ ] Publish main under standing authorization; verify Pages and report remaining external availability limits.

Validation: 880 unit tests passed. Full music browser suite passed, including imported NetEase/QQ routing, public lyrics, settings after reload and source disabling. Independent review found and verified fixes for extra-singer mismatches and misleading network errors. A real Chrome run from the Pages origin matched QQ metadata for Take Me Hand (WONDER Tourism) to NetEase ID 26092806, decoded the public stream and advanced playback. This sample does not establish availability of other songs or platforms. Original reply/prompt files and 1900 styles are outside the change.
