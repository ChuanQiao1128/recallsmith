# F04 — r24 review fixes: funnel client (issue #657)

Round r24x, wave m. Every finding was checked against the code first; each fix has a test that fails on
the base (`git show HEAD~:mobile/src/telemetry/funnel.ts` with the new `funnel.test.ts` = 27 failures)
and passes after it. JS-only, OTA-safe, no frozen file touched.

## Summary of the change

- `mobile/src/telemetry/funnel.ts`
  - `createFunnelXhrPost`: the funnel POST is a plain XHR, not `apiJson`. It sets only
    `content-type: application/json` (no Authorization, no x-dc-trace-id) and flags the XHR as Sentry's
    own request (`__sentry_own_request__`), which Sentry's XHR instrumentation (the only request
    instrumentation on native: `traceFetch` is off outside web) skips, so no `sentry-trace` / `baggage`
    and no span. Primary base, then the fallback only after a network failure.
  - A record no longer flushes; it (re)starts a 60 s debounce (`FUNNEL_FLUSH_DEBOUNCE_MS`). Flushes run
    at launch, on foreground, on a flag change and after the debounce. Each flush sends ONE POST with up
    to `FUNNEL_BATCH_MAX` (20) events.
  - Only 400 / 413 / 422 drop a batch; every other status, network failure and timeout keeps it queued.
  - `detectExistingInstall`, `createAppFunnelDeps`, `startAppFunnel`: the App wiring, moved here (still
    no runtime imports) so it is unit-tested. Existing install = onboarding stage `done` OR any stored
    `deck-progress:` row.
- `mobile/App.tsx`: passes the real modules (`AsyncStorage`, `XMLHttpRequest`, `resolveApiBase` /
  `resolveApiFallback`, feature flags, privacy prefs, onboarding stage, expo-updates channel) into
  `createAppFunnelDeps` / `startAppFunnel`. No longer imports `apiJson`.
- `docs/delivery/r24-issues/M01-notes.md`: corrected the trace-id claim, the send/rejection rules, the
  existing-install rule, the OTA limit, and narrowed "How it is tested" to what is tested.

### m-correctness-1
Status: fixed

Confirmed: `App.tsx:131` posted via `apiJson`, whose `requestOnce` adds `x-dc-trace-id` from the
installed provider (`getDcTraceHeader`, the active span's or the scope's propagation trace id, shared
across requests), and the API origin is in Sentry's `tracePropagationTargets`, so Sentry's XHR
instrumentation added `sentry-trace` / `baggage` too. The POST now goes through `createFunnelXhrPost`
(content-type only, Sentry own-request flag). `tracePropagationTargets` lives in `sentryPolicy.ts` /
`observability.ts`, outside this issue's scope; the own-request flag keeps Sentry from adding headers to
this one request without touching them.

- Files: `mobile/src/telemetry/funnel.ts`, `mobile/App.tsx`, `docs/delivery/r24-issues/M01-notes.md`
- Tests: `mobile/tests/unit/funnel.test.ts` › "funnel POST (createFunnelXhrPost): no token, no trace
  header" › "sends exactly content-type, flagged as Sentry-own so no sentry-trace/baggage is added"
  (installs the apiClient trace provider and asserts the headers equal `{ content-type }`, none of
  authorization / x-dc-trace-id / sentry-trace / baggage / traceparent); "App funnel wiring" › "a new
  install posts first_open with content-type only and no token or trace header".

### m-tests-1
Status: fixed

Confirmed: M01-notes said the header was "a per-request trace id, not a user, device or install
identifier"; it is shared with the other requests of the same trace and logged with `userSub`. Same
code fix and tests as m-correctness-1; the notes entry is struck through and corrected, and the Send
section now states the exact headers.

- Files: `docs/delivery/r24-issues/M01-notes.md` (plus the m-correctness-1 code)
- Tests: as m-correctness-1.
- Not done here: `docs/privacy-anonymous-funnel-2026-10-02.md` is outside this issue's scope. Its
  text (line 61, server log line holds "the trace id … and a null user") is still true for the funnel
  request, which now carries no client trace id; nothing in it claims the old header, so no edit is
  needed, but the owner may want to add "the funnel POST sends no trace header" there.

### m-correctness-2
Status: partially fixed

Confirmed: the existing-install check was `getOnboardingStage() === 'done'` only, and the funnel ships
by OTA on runtime 1.9.0, so a fresh store install runs the embedded (funnel-less) bundle first.
Fixed per supervisor item (4): existing = onboarding `done` OR any stored study progress
(`deck-progress:` row in any scope, incl. the legacy unscoped key); a brand-new install that gets the
code by OTA in its first session with no progress and onboarding not done is counted. The remaining
limit (an install that finished onboarding or studied on the embedded bundle before the OTA applied is
seeded as existing; one mid-onboarding at the switch gets first_open late) cannot be told apart from an
updating user on the client, so it is recorded in M01-notes as "treat data before 1.10.0 as partial".

- Files: `mobile/src/telemetry/funnel.ts` (`detectExistingInstall`), `mobile/App.tsx`,
  `docs/delivery/r24-issues/M01-notes.md`
- Tests: `funnel.test.ts` › "existing-install detection" (done; signed-out, signed-in and legacy
  progress; brand-new OTA install; mid-onboarding with no progress; storage failure) and "App funnel
  wiring" › "stage done seeds an existing install: no first_open and no later first-run step", "study
  progress with onboarding not done also seeds an existing install".

### m-correctness-3
Status: fixed

Confirmed: `isPermanentRejection` dropped every 4xx except 408/429. Now only 400 / 413 / 422 drop.

- Files: `mobile/src/telemetry/funnel.ts`
- Tests: `funnel.test.ts` › "funnel rejections: only validation drops a batch" › "keeps the queue on
  HTTP 401/403/404/408/429/500/502/503", "keeps the queue on a network failure / a timeout / an error
  without a status", "drops the batch on HTTP 400/413/422", "a 401 batch is sent on the next foreground
  once the route answers".

### m-security-1
Status: fixed

Same defect as m-correctness-1 (x-dc-trace-id from the shared provider; M01-notes:76 wrong). Same fix,
tests and notes correction. The test asserts no Authorization header as well.

- Files: `mobile/src/telemetry/funnel.ts`, `mobile/App.tsx`, `docs/delivery/r24-issues/M01-notes.md`
- Tests: as m-correctness-1.

### m-security-2
Status: fixed

Confirmed: `record()` ended in `.then(flush)`, so each first-run event was its own POST. A record now
only (re)starts a 60 s debounce; flushes happen at launch, on foreground, on a flag change and after the
debounce, one POST of ≤ 20 events each. A first run sends about two POSTs (launch: first_open; then one
for goal_chosen … first_pack_opened if they fall within 60 s of each other, or on the next foreground).
No retry jitter was added: retries ride on foreground/launch, which are already spread per user.

- Files: `mobile/src/telemetry/funnel.ts`
- Tests: `funnel.test.ts` › "funnel batching (one POST per flush, not per event)" (four records → no
  POST until the single live debounce timer fires, then ONE POST with all four; no-op records schedule
  nothing; a foreground flush cancels the pending debounce) and "caps the stored queue … one batch of at
  most FUNNEL_BATCH_MAX per flush". Existing tests that relied on record→POST now flush explicitly.

### m-security-3
Status: fixed

Same defect as m-correctness-3 (404/403 from a missing or misconfigured route dropped already-marked
events). Same fix and tests.

- Files: `mobile/src/telemetry/funnel.ts`
- Tests: as m-correctness-3.

### m-tests-2
Status: fixed

Confirmed: only `createFunnel` with fake deps was tested; App.tsx's wiring and the real POST were not,
and the title "posts it without a token or ids" could not check the token. The wiring moved into
`createAppFunnelDeps` / `startAppFunnel` / `detectExistingInstall` in `funnel.ts` (import-free), which
App.tsx calls with the real modules, and the POST into `createFunnelXhrPost`. The misleading title was
renamed ("posts only the batch fields") and the notes narrowed (the App.tsx hand-off of real modules is
the only untested line).

- Files: `mobile/src/telemetry/funnel.ts`, `mobile/App.tsx`, `mobile/tests/unit/funnel.test.ts`,
  `docs/delivery/r24-issues/M01-notes.md`
- Tests: `funnel.test.ts` › "App funnel wiring (createAppFunnelDeps + startAppFunnel)": exact headers
  and no token for a new install; stage `done` and stored progress seed an existing install; a flag flip
  sends the queue; the unsubscribe is returned; dev build / preview channel / missing flag / sharing off
  send nothing; the stored privacy choice is awaited before deciding.

### m-tests-3
Status: fixed

Confirmed: only goal_chosen had a call-site test. Added a `../telemetry/funnel` mock and assertions to
the existing tests of each other emitter.

- Files: `mobile/tests/unit/starterLesson.test.ts`, `mobile/tests/integration/home-starter-lesson.spec.tsx`,
  `mobile/tests/integration/draw-wallet-atomicity.spec.tsx`, `mobile/tests/integration/auth-recovery.screen.test.tsx`
- Tests:
  - starter_completed: `starterLesson.test.ts` › "completing closes the stage …" (one call,
    `('starter_completed', 'aws')`) and "existing users (stage done) never see the lesson" (none).
  - starter_started: `home-starter-lesson.spec.tsx` › "sends a learner in the starter stage into the
    lesson …" (every open passes `('starter_started', 'aws-saa-c03')`) and "leaves existing users (stage
    done) on Home …" (none).
  - first_pack_opened: `draw-wallet-atomicity.spec.tsx` › "asks for a sync as soon as a draw commits"
    (one call with the slug), "does not ask for a sync when the pull bought nothing" and "leaves the
    wallet whole when the draw-state write is killed" (none).
  - signup_started / signup_completed: `auth-recovery.screen.test.tsx` › "auth screens record the
    anonymous funnel steps": a valid submit → one `signup_started`; a form that cannot submit → none; a
    confirmed code (`signed_in` and `needs_sign_in`) → one `signup_completed`; a wrong code → none.
  - SessionCardScreen has no emitter (starter_completed is in `completeStarterLesson`, the single choke
    point for both SessionCard completion paths), so no SessionCard test was needed.

## Supervisor items

1. Privacy — exact headers tested (`{ content-type }` only; no Authorization / x-dc-trace-id /
   sentry-trace / baggage); M01-notes corrected. See m-correctness-1.
2. One POST per flush, ≤ 20 events. See m-security-2.
3. 401/403/404/408/429/5xx/network transient; only 400/413/422 drop. See m-correctness-3.
4. Existing install = study progress or finished onboarding; brand-new OTA-in-first-session install
   still counts. See m-correctness-2.
