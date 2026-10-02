# M01 — Anonymous funnel client (issue #637)

Contract: R24-00 §3.1 (events) and §3.4 (mobile). JS-only, OTA-safe: no package.json, app.json,
eas.json or native change; no frozen file touched.

## What changed

| File | Change |
| --- | --- |
| `mobile/src/telemetry/funnel.ts` (new) | The funnel module. Dependency-injected like `clientErrorReporter.ts` (imports nothing at runtime). |
| `mobile/src/config/featureFlags.ts` | New flag `features.anonFunnel.enabled`, default `false`; only a boolean `true` turns it on. |
| `mobile/src/features/gacha/settings/privacyPrefs.ts` (new) | Device-global pref `recallsmith:privacy-prefs:v1` = `{ shareUsageCounts }`, default `true`. |
| `mobile/src/features/gacha/settings/privacy/PrivacySection.tsx` (new) | Settings › Privacy card with the toggle "Share anonymous usage counts". |
| `mobile/src/screens/SettingsScreen.tsx` | Loads the pref on focus, renders `PrivacySection` after Study; turning it off also calls `clearFunnelQueue()`. |
| `mobile/App.tsx` | `configureFunnel(createAppFunnelDeps(funnelInputs))` at module load; `startAppFunnel(funnelInputs)` in the init effect (existing-install check, start, `flushFunnel()` on feature-flag change); `funnelOnForeground()` on AppState `active`. (Wiring moved into `funnel.ts` by r24x F04 so it is unit-tested.) |
| `mobile/src/screens/AudienceSurveyScreen.tsx` | `goal_chosen` (deck slug) after Finish setup saved. |
| `mobile/src/screens/HomeScreen.tsx` | `starter_started` (deck slug) when the starter lesson opens. |
| `mobile/src/features/gacha/starter/starterLesson.ts` | `starter_completed` (deck slug) inside `completeStarterLesson` once the stage closes (covers both SessionCard completion paths). |
| `mobile/src/screens/DrawScreen.tsx` | `first_pack_opened` (deck slug) after a successful pack commit (once per install = the first). |
| `mobile/src/screens/SignUpScreen.tsx` | `signup_started` on submit. |
| `mobile/src/screens/ConfirmSignUpScreen.tsx` | `signup_completed` after the code is confirmed (both `signed_in` and `needs_sign_in`). |
| `mobile/tests/unit/funnel.test.ts` (new) | Module unit tests; since r24x F04 also the exact request headers, the rejection rule, batching, existing-install detection and the App wiring. |
| `mobile/tests/unit/starterLesson.test.ts`, `tests/integration/home-starter-lesson.spec.tsx`, `draw-wallet-atomicity.spec.tsx`, `auth-recovery.screen.test.tsx` | (r24x F04) Each call site: one call with the expected event and slug on success, none on the failure path. |
| `mobile/tests/unit/featureFlags.test.ts`, `featureFlagsSentry.test.ts` | Full-shape expectations gain `anonFunnel`; new anonFunnel parse test. |
| `mobile/tests/integration/onboarding.screen.test.tsx` | Finish setup emits `goal_chosen` with the deck; a failed save emits nothing. |
| `mobile/tests/integration/settings.screen.test.tsx` | Privacy toggle: default on, persists off/on, off clears the queue. |

## Surface shipped

- Storage key `recallsmith:funnel:v1` (AsyncStorage, not user-scoped):
  `{ cohortDay: 'YYYY-MM-DD' | null, sent: { [event]: true }, queue: [{ event, cohortDay, eventDay, deckSlug? }] }`.
- Events: `first_open`, `goal_chosen`, `starter_started`, `starter_completed`, `first_pack_opened`,
  `returned_day_1`, `returned_day_7`, `signup_started`, `signup_completed`. Each at most once per install.
- `cohortDay` = local date of the first recorded event (first_open at App init); `eventDay` = local date now.
- `returned_day_1` / `returned_day_7`: on a foreground (and at cold start, after first_open) when today is
  exactly `cohortDay + 1` / `+ 7`.
- Send: `POST /api/v1/public/events` as a plain XHR (`createFunnelXhrPost`), **not** through `apiJson`.
  The only request header is `content-type: application/json`: no `Authorization`, no `x-dc-trace-id`,
  and the XHR is flagged as Sentry's own request so Sentry's XHR instrumentation adds no
  `sentry-trace` / `baggage` (and starts no span). Primary API base, then the fallback base only after a
  network failure. Body `{ platform, appVersion, events: [≤ 20] }`, `platform` = `Platform.OS`
  (ios/android only), `appVersion` = `getCurrentAppVersion()` (must match `^\d+\.\d+\.\d+$`, else
  nothing is sent). Queue ≤ 50 (new events are not queued once full; the oldest, most valuable steps stay).
- When it sends: at launch (after first_open and the return check), on every foreground, when the
  feature flags change, and 60 s (`FUNNEL_FLUSH_DEBOUNCE_MS`) after the last record. A record never
  sends by itself. Each flush is ONE POST with up to 20 queued events, so a first run sends about two
  POSTs instead of one per event.
- Rejections: only 400 / 413 / 422 (validation) drop the batch. 401 / 403 / 404 (route not applied yet,
  wrong base, authorizer), 408 / 429 / 5xx, network failures and timeouts keep it queued for the next
  flush. Fire-and-forget, never throws.
- Gates (all must hold to send): not `__DEV__` and expo-updates channel `production` (the Sentry rule);
  `features.anonFunnel.enabled === true`; Settings › Privacy "Share anonymous usage counts" on.
  With the toggle off nothing is queued (the step is still marked done, so it is not replayed later) and
  the queue is dropped. With the channel or flag gate closed events stay queued until it opens.
- Payload fields are exactly `platform`, `appVersion`, `events[].{event, cohortDay, eventDay, deckSlug?}`.
  No user id, device id, install id, email or token anywhere.

## How it is tested

- `npx tsc --noEmit` — pass.
- `npx vitest run tests/unit/funnel.test.ts tests/unit/featureFlags.test.ts tests/integration/onboarding.screen.test.tsx tests/integration/settings.screen.test.tsx` — pass.
- Full `npx vitest run` (272 files, 2005 tests) — pass.
- Funnel unit tests (module with fake deps) cover: once-only, cohort day kept across days, day-1/day-7
  only on the exact days, cold start counts as a return, gating by channel / flag / toggle, toggle off
  drops the queue, payload has no id fields, queue cap 50 and one batch of ≤ 20 per flush, a record
  only schedules the debounced flush, retry after a failure, 401/403/404/408/429/5xx/network/timeout kept
  and 400/413/422 dropped, storage errors never throw, concurrent records serialised.
- Since r24x F04 the real POST and App wiring are tested too: `createFunnelXhrPost` sends exactly
  `{ content-type }` (no Authorization / x-dc-trace-id / sentry-trace / baggage, even with the apiClient
  trace provider installed) and sets the Sentry own-request flag; `createAppFunnelDeps` +
  `startAppFunnel` (the code App.tsx calls) seed an existing install on stage `done` or on stored study
  progress, send first_open for a new install, flush on a flag change, and honour the channel / flag /
  privacy gates. App.tsx itself only passes the real modules in; that one-line hand-off is not tested.
- Call sites: each of the seven emitters has a test with the expected event and slug on success and no
  call on the failure path (goal_chosen in onboarding.screen.test.tsx, the rest listed above).

## Owner steps

1. Server (A01) and gateway route (P01) must be live before turning the flag on.
2. Update the privacy policy / App Privacy answers per `docs/privacy-anonymous-funnel-2026-10-02.md` (A01).
3. Publish `features.anonFunnel.enabled: true` in the remote config JSON to start sending. Default is off,
   so this OTA ships dark.

## Deviations / decisions

- **Existing installs**: an install that already has study progress (any `deck-progress:` row, any
  account scope) or an onboarding stage `done` when the funnel first runs is seeded as "all events done"
  and never sends anything — otherwise every updating user would appear as a new `first_open` cohort on
  the update day. A brand-new install that gets this code by OTA early in its first session (no
  progress, onboarding not done) is counted.
- **Known limit until the 1.10.0 binary**: the funnel ships as an OTA on runtime 1.9.0, and a fresh
  store install runs the embedded bundle (no funnel) until the OTA applies on a later cold start or a
  safe-route reload. An install that finished onboarding or studied on the embedded bundle is therefore
  seeded as existing and never counted, and one that was mid-onboarding at the switch gets `first_open`
  (and its cohortDay) late, without the earlier steps. Treat funnel data from before 1.10.0 as partial
  (new installs undercounted, early-step conversions skewed).
- The toggle lives in a new device-global `privacyPrefs.ts` (same pattern as `feedbackPrefs.ts`) and a new
  `PrivacySection.tsx`, both under `features/gacha/settings/` (in scope).
- `starter_completed` is emitted in `starterLesson.completeStarterLesson` (single choke point for both
  SessionCard completion paths) rather than in SessionCardScreen.
- ~~`apiJson` may still add the `x-dc-trace-id` header while Sentry is active; it is a per-request trace id,
  not a user, device or install identifier.~~ **Wrong (corrected in r24x F04):** that value is the active
  span's or the scope's propagation trace id, shared with the other (authenticated) requests of the same
  trace, and the server logs it next to `userSub`, so it could join a batch to an account. The funnel
  POST no longer goes through `apiJson` and carries no trace header at all (see Send above).

## Deferred

- No retention of queued events older than the server's 400-day window is enforced client-side (the
  server rejects such events individually).
- `RemoteFeatures` type in `remoteConfig.ts` is not extended (the parser reads `features` untyped).
- `npm run test:smoke` fails in this worktree with TypeScript lib/global type conflicts from the
  symlinked `node_modules`; `tests/p2-smoke.ts` imports none of the files changed here.
