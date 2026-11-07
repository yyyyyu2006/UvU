# Optional public music source implementation plan

**Goal:** Allow personal-use browser search/playback without a self-hosted gateway, using an explicitly enabled GD NetEase channel.
**Architecture:** A separate `music_public.js` adapter with a fixed HTTPS endpoint and no credentials; narrow additions to the existing music model, cards, settings, backup and screen. Original account sources and 1900 prompts/reply pipeline remain unchanged.
**Approved scope:** User accepted the public-source proposal and requested implementation. Work continues in the existing main checkout under the standing direct-main instruction.

## Source and design decisions

- Read the publisher's API manual at `https://music-api.gdstudio.xyz/api.php` on 2026-11-07. It lists netease/joox/bilibili as available, requires attribution, restricts use to personal study/noncommercial purposes, and states 50 calls per 5 minutes. Public QQ is not advertised as supported and is not implemented.
- Live search/URL/lyric/artwork responses returned 200 and `Access-Control-Allow-Origin:*`. One NetEase sample returned an HTTPS media URL. This is not a guarantee of long-term service or every song's availability.
- Public-source access defaults off, is explicitly enabled in Music settings, and never receives gateway Authorization/cookies. Search defaults to public source when no gateway is configured but requires the toggle before network access.
- The provider key `gd-netease` is distinct from authenticated `netease`. Cards and favorites retain this identity through backup. No silent matching to a different recording.
- Fixed 128kbps request; unknown rights remain unknown; no downloading, authentication bypass, quality escalation or secret persistence. Artwork loads on playback rather than one request per search result.
- Cache bounded metadata/lyrics/artwork, cap this page's API requests below the documented limit, honor aborts/timeouts and surface network/rate-limit failures. Public audio URLs stay transient.
- Audius/Jamendo remain future candidates: adding unverified playback or an extra required client key would not improve this first direct-access channel.

## Tasks

- [x] RED/GREEN adapter tests: explicit activation, safe fixed URLs, credentials omitted, metadata/lyric normalization, cache, expiry, rate limit, abort and unsafe/unavailable streams.
- [x] RED/GREEN model/card/backup tests: provider isolation, no gateway session, disabled-source denial and public-song portability.
- [x] Add compact public-source toggle/attribution, search source selector and contextual instructions; preserve existing account form and styles.
- [x] Real app fixture browser verification of enable/search/play/share/reload at mobile widths; separate live network sample check.
- [x] Whole-suite, syntax and diff review.

Release: commit/push main and inspect Pages after the verified implementation; report the deployed revision to the user.

## Ledger

- Starting revision: 40dd0d6d0375576b71812414035ba6a99dac1dfb.
- Existing untracked outputs are excluded from commits; no server/domain configuration changes are part of this feature.
- Verification: 793/793 automated tests passed, including 62 focused music tests independently repeated by review. Browser checks covered 320/390/768 px layouts, account-source regression, public activation/search/play/lyrics/share, source-disable cancellation and page errors.
- Live verification: public search for `lofi`, real Chrome HTMLAudio playback of one `gd-netease` result (`LOFi`, 229.796875 seconds). Availability remains unknown; no temporary stream URL is saved in the report. This is a single sample, not a platform-wide availability guarantee.
- Read-only code review found no actionable important regression. No reply/prompt modules or original 1900 styles were changed in this follow-up.
