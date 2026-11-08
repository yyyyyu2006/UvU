# Render free music gateway deployment plan

**Goal:** Prepare the existing music gateway for the user's chosen free Render deployment, then guide account-owned creation without promising a deployed service prematurely.

**Approved direction:** User chose Render because another paid server is not affordable. Use a native Node web service on the Free plan; Render terminates HTTPS. Keep the existing 1900 reply pipeline untouched.

**Architecture:** A dedicated Render entry point binds `0.0.0.0:$PORT`, checks the pinned provider is installed, and uses a fresh private temporary encrypted vault per process. Existing Windows/local startup is unchanged. Optional health metadata identifies the ephemeral deployment. The account UI waits on a public, cancellable health check before accounts/QR requests; provider requests retain their normal timeout.

**References:** Render official `docs/blueprint-spec`, `docs/web-services`, `docs/free`, `docs/node-version`, `docs/environment-variables`. Free services sleep after inactivity and have no persistent filesystem. The generated `.onrender.com` URL is not known until deployment; keep shipped endpoint empty until that URL has been tested.

## Work

- [x] Add failing tests for Render port/host/origin/private vault config, deployment health metadata, credential-free cancellable wakeup and unchanged normal request deadlines.
- [x] Add `render.yaml` with `plan: free`, Node 22, build-time pinned setup, dedicated start and health check. No paid disk/database/predeploy task.
- [x] Implement Render entry point and optional public health metadata without disclosing credentials or file paths.
- [x] Wait for health before account/QR requests and display the free hosting login limitation in the account panel/tutorial.
- [x] Add concrete Render UI instructions plus manual fallback settings.
- [x] Run targeted tests, full unit suite, browser tests and a local entry point smoke test; complete independent review. Publish on main under existing authorization after recording results.

## Boundaries

No Render account is attached. The user must sign in, authorize the repo and create the Free service. No automatic credit card/payment action, keep-alive service, custom-domain change or paid resource is part of this plan. A QR fixture proves UI flow, not actual platform authorization or playback from Render's network.

## Verification

- Full unit suite: 872 passed, zero failures. Targeted music/Render review: 77 passed.
- Official Render Blueprint JSON schema validation passed; only one Free Web Service is declared.
- Actual local Render entry point smoke: public listener, ready health and isolated session/CORS checks passed without platform calls.
- Independent review identified a cold-start 503 issue. Added bounded retries with cancellation and total-deadline tests; reviewer confirmed the issue is resolved.
- Browser fixture verification passed for 320/390/768 layouts, built-in/custom/unconfigured gateway, QR login, cancellation during service outage, stream/local audio, queue/lyrics and reload. Real Render deployment and platform login/playback remain user-account steps.
