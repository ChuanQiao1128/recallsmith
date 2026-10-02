# F04 — r24b review fixes: me, help, settings copy + guard (#682)

Round r24bx, wave e. Base: `delivery/r24bx-e` (= release/r24b, cd6a0c6). Every finding was checked against the code
first. Gate: `cd mobile && npx tsc --noEmit && npx vitest run` — 290 files, 2259 tests, all green.

## Review findings

### x-interfaces-1
Status: fixed
- Confirmed on the base: `npx vitest run tests/unit/plainWordsGuard.test.ts` failed `keeps PENDING honest` at
  `features/gacha/draw/ceremonyCopy.ts: expected [] to not deeply equal []`. All five PENDING modules have no banned word left.
- Fix: `PENDING` is now `[]`; the honesty test stays, so any future entry still has to hold jargon. The five modules
  (ceremonyCopy V9/V10, homeSelectors, summaryMapper, rewardResolver, mcqConstants) now run their own
  "uses plain words" tests and pass. No module needed a copy change.
- Files: `mobile/tests/unit/plainWordsGuard.test.ts`.
- Proof: `plainWordsGuard.test.ts` — "keeps PENDING honest" plus the twelve "<module> uses plain words" tests (16 tests, green).

### e-correctness-1
Status: fixed
- Confirmed: `ALLOWED_LITERALS` was applied by `collectCopy` to every module, so `'boss'`, `'reserve'`, `'elite'` or
  `'wallet-full'` as copy in faq.ts (or any guarded module) would pass.
- Fix: the global set is gone. `GuardedModule` has an `allow` field; only the homeSelectors.ts entry sets it
  (`reserve`, `wallet-full`, `boss`, `elite`), and `collectCopy(source, only, allow)` applies it to that file only.
- Files: `mobile/tests/unit/plainWordsGuard.test.ts`.
- Proof: new test "applies an allow-list only to the module that declares it": with no allow-list, `'boss'` and
  `'reserve'` are reported (fails on the base, where the global set hid both); it also asserts no other module
  declares `allow`.

### e-tests-1
Status: fixed
- Confirmed as described for the pre-merge branches. On this base the conflict is already resolved: the release
  merge cbf4e1c (`# Conflicts: mobile/tests/unit/otaReleaseScript.test.ts`) kept W03's `OTA_CASE_TIMEOUT_MS`, and
  `releasePlumbing190.test.ts` (also touched by R01, e828c39) has one constant, `SPAWN_TIMEOUT_MS`, and no conflict
  markers. No test file change is needed, and none was made.
- Fix: W04-notes.md now records the conflict, how it was resolved and the R01 overlap (the overclaim was "the gate is green" with no word on the merge).
- Files: `docs/delivery/r24b-issues/W04-notes.md`.
- Proof: `grep -c '<<<<<<<' mobile/tests/unit/otaReleaseScript.test.ts` → 0; the full vitest run (both files included) is green.

### e-tests-2
Status: fixed
- Confirmed: `collectCopy` returns `node.text` without quotes, so `/'pull'/` could never match; a broken
  literal-type skip would still pass. The element-access and property-name skips were not exercised.
- Fix: the self-test now asserts the exact array `['You have ', ' cards', 'Finish run']` on a sample that also holds
  `obj['pity']` and `{ 'node': 1 }`, so breaking any of the four skips (import, literal type, element access, property name) fails it.
- Files: `mobile/tests/unit/plainWordsGuard.test.ts`.
- Proof: "reads string and template literals, skipping `${…}` identifiers and code tokens".

### e-tests-3
Status: fixed
- Same defect as e-correctness-1 (global allow-list), same fix: allow-list keyed by module, homeSelectors.ts only.
- Files: `mobile/tests/unit/plainWordsGuard.test.ts`.
- Proof: "applies an allow-list only to the module that declares it".

### e-tests-4
Status: fixed
- Confirmed: the notes said "Owner steps: None" and that the release merge removes PENDING entries; nothing did, and the
  gate was red on release/r24b (see x-interfaces-1).
- Fix: PENDING emptied here. W04-notes.md now states the manual step that was needed (delete W01-W03 entries after the
  merge), that W03's modules were already clean on r24b-x, and that F04 did it.
- Files: `docs/delivery/r24b-issues/W04-notes.md`, `mobile/tests/unit/plainWordsGuard.test.ts`.
- Proof: `plainWordsGuard.test.ts` green on the merged tree.

## Supervisor items

### A — empty PENDING
Status: fixed. Covered by x-interfaces-1. Every listed module passes; no out-of-scope module had to be reported.

### B1 — Sentry never carries the Cognito sub
Status: fixed
- `@sentry/react-native` 7.2.0 `wrapper.js initNativeSdk` forwards every option except the callbacks to
  `RNSentry.initNativeSdk`, which passes the dictionary to Cocoa's `SentryOptionsInternal initWithDict`. Init now
  spreads `SENTRY_NATIVE_NETWORK_OPTIONS = { enableNetworkBreadcrumbs: false, enableNetworkTracking: false }`
  (native-only keys, not in the JS option types, so they are spread rather than typed).
- `sentryPolicy.ts`: `scrubString` replaces UUID-shaped ids with `<id>` (on top of tokens, emails, query strings);
  `mentionsRevenueCat` checks url / http.url / description / message; `scrubBreadcrumb` returns null for RevenueCat
  breadcrumbs; `scrubEvent` (used by beforeSend and beforeSendTransaction) drops RevenueCat breadcrumbs and spans.
  Event `tags` keep their ids (our own `ota.update_id` is a UUID) but are still scrubbed for tokens, emails and sensitive keys.
- Files: `mobile/src/telemetry/sentryPolicy.ts`, `mobile/src/telemetry/observability.ts`,
  `mobile/tests/unit/sentryPolicy.test.ts`, `mobile/tests/unit/observability.test.ts`.
- Proof: `sentryPolicy.test.ts` › "2.0 privacy: the Cognito sub never reaches Sentry" (5 tests) and
  `observability.test.ts` › "turns off native network breadcrumbs and tracking and keeps RevenueCat and the sub out of every hook"; all 6 fail on the base.

### B2 — client error reporter scrubbing
Status: fixed. `buildClientErrorPayload` runs message and stack through `scrubString` (imported from the import-free
`sentryPolicy.ts`, so the module graph stays minimal) before truncation. The bearer header is untouched.
- Files: `mobile/src/telemetry/clientErrorReporter.ts`, `mobile/tests/unit/clientErrorReporter.test.ts`.
- Proof: "scrubs emails, tokens, query strings and UUIDs from message and stack before posting (2.0 privacy)" (fails on the base).

### B3 — production account deletion fails closed
Status: fixed. `deleteServerAccountData` takes `isDev` (default `__DEV__`). Production: an empty API base throws
`AccountDeletionError('server')` without a fetch, and 404/405/501 throw `AccountDeletionError('server', status)`, so
`deleteAccountNow` never reaches Cognito `deleteUser` (already covered by account-deletion.test.tsx "keeps the session
and does not call deleteUser when the server delete fails"). Dev builds keep `'endpoint_unavailable'`.
- Files: `mobile/src/auth/deleteServerAccount.ts`, `mobile/tests/unit/deleteServerAccount.test.ts`.
- Proof: "production build (2.0): a missing server delete is a failure" (3 of its tests fail on the base) and
  "keeps the dev-build behaviour".

### B4 — privacy toggle body
Status: fixed. `PRIVACY_COPY.shareBody` = "Counts of first steps, like finishing setup or opening a first pack. No
account, email or device ID is sent." (the counts do carry platform and app version).
- Files: `mobile/src/features/gacha/settings/privacy/PrivacySection.tsx`, `mobile/tests/integration/settings.screen.test.tsx`.
- Proof: settings.screen "shows Privacy > Share anonymous usage counts…" pins the new body (failed on the base; no test pinned the old one).

### C — FAQ card-checking and duplicates
Status: fixed. "How are the cards made?" now reads "Cards are drafted with AI assistance from official documentation
and checked by automated checks and AI review passes. If a card looks wrong, sign in and use Report a problem." then
names the sources and Support. The rare-card answer's "so you never get a duplicate" sentence is now "There are no
repeat draws: a card you have drawn never comes up again."
- Files: `mobile/src/content/faq.ts`, `mobile/tests/integration/more.screen.test.tsx`, `docs/delivery/r24b-issues/W04-notes.md`.
- Proof: more.screen "Help renders the real user-language FAQ" pins both new texts and rejects "spot-check",
  "never a duplicate" and "only cards missing from your collection" (failed on the base).
