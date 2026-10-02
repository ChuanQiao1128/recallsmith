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
| `mobile/App.tsx` | `configureFunnel(...)` at module load; `startFunnel` in the init effect; `funnelOnForeground()` on AppState `active`; `flushFunnel()` when the feature flags change. |
| `mobile/src/screens/AudienceSurveyScreen.tsx` | `goal_chosen` (deck slug) after Finish setup saved. |
| `mobile/src/screens/HomeScreen.tsx` | `starter_started` (deck slug) when the starter lesson opens. |
| `mobile/src/features/gacha/starter/starterLesson.ts` | `starter_completed` (deck slug) inside `completeStarterLesson` once the stage closes (covers both SessionCard completion paths). |
| `mobile/src/screens/DrawScreen.tsx` | `first_pack_opened` (deck slug) after a successful pack commit (once per install = the first). |
| `mobile/src/screens/SignUpScreen.tsx` | `signup_started` on submit. |
| `mobile/src/screens/ConfirmSignUpScreen.tsx` | `signup_completed` after the code is confirmed (both `signed_in` and `needs_sign_in`). |
| `mobile/tests/unit/funnel.test.ts` (new) | Module unit tests. |
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
- Send: `POST /api/v1/public/events` via `apiJson` with **no access token**; body
  `{ platform, appVersion, events: [≤ 20] }`, `platform` = `Platform.OS` (ios/android only),
  `appVersion` = `getCurrentAppVersion()` (must match `^\d+\.\d+\.\d+$`, else nothing is sent).
  Batches of ≤ 20, queue ≤ 50 (new events are not queued once full; the oldest, most valuable steps stay).
  Fire-and-forget, never throws; a network failure / 408 / 429 keeps the batch for the next foreground;
  any other 4xx drops the batch (it will never be accepted).
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
- Funnel unit tests cover: once-only, cohort day kept across days, day-1/day-7 only on the exact days,
  cold start counts as a return, gating by channel / flag / toggle, flag flip then flush sends the queue,
  toggle off drops the queue, payload has no id fields, queue cap 50 and batches of 20, retry after a
  failure, 429 kept / 400 dropped, storage errors never throw, concurrent records serialised,
  existing-install seeding.

## Owner steps

1. Server (A01) and gateway route (P01) must be live before turning the flag on.
2. Update the privacy policy / App Privacy answers per `docs/privacy-anonymous-funnel-2026-10-02.md` (A01).
3. Publish `features.anonFunnel.enabled: true` in the remote config JSON to start sending. Default is off,
   so this OTA ships dark.

## Deviations / decisions

- **Existing installs**: an install whose onboarding stage is already `done` when the funnel first runs
  is seeded as "all events done" and never sends anything — otherwise every updating user would appear
  as a new `first_open` cohort on the update day. Installs mid-onboarding at update time are counted.
- The toggle lives in a new device-global `privacyPrefs.ts` (same pattern as `feedbackPrefs.ts`) and a new
  `PrivacySection.tsx`, both under `features/gacha/settings/` (in scope).
- `starter_completed` is emitted in `starterLesson.completeStarterLesson` (single choke point for both
  SessionCard completion paths) rather than in SessionCardScreen.
- `apiJson` may still add the `x-dc-trace-id` header while Sentry is active; it is a per-request trace id,
  not a user, device or install identifier.

## Deferred

- No retention of queued events older than the server's 400-day window is enforced client-side (the
  server rejects such events individually).
- `RemoteFeatures` type in `remoteConfig.ts` is not extended (the parser reads `features` untyped).
- `npm run test:smoke` fails in this worktree with TypeScript lib/global type conflicts from the
  symlinked `node_modules`; `tests/p2-smoke.ts` imports none of the files changed here.
