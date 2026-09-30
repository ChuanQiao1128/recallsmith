# F04 — R20 review fixes: mobile (V11)

Issue #585, R20X fix round, wave m. Each finding was checked against the code first; every
fix has a test that fails on the R20 code. Scope: `mobile/src`, `mobile/tests` and these notes.
No dependency, `app.json` or native change; frozen files and `mobile/src/auth/*` untouched.

### m-correctness-1

Status: fixed

Confirmed. `getFreshAccessToken()` returns null both when signed out and when a signed-in
`fetchAuthSession` throws (offline or a temporary failure; `doRefresh` swallows it and keeps the
session). `getCardReportToken` turned both into null, and the sheet and My reports showed the
sign-in copy for a learner who was signed in but offline.

Change:
- `mobile/src/features/cardReport/cardReportApi.ts`: new `getCardReportAuth()` returning
  `{ kind: 'token' | 'signed_out' | 'unavailable' }`. With no token it reads
  `useAuthStore.getState().status` through a guarded dynamic import (loaded only on that path);
  `signed_in` means `unavailable`. A refresh that finds the session really expired calls
  `markSessionExpired()` first, which sets `anonymous`, so that case stays signed out.
  `requireToken()` throws the new `CardReportTokenUnavailableError` (tagged `kind: 'offline'`)
  for `unavailable`, so `cardReportErrorMessage` returns `FRIENDLY_ERROR_COPY.offline`.
  `getCardReportToken` is replaced by `getCardReportAuth` (its only caller was the sheet).
  The `freshToken` import is shared by all callers.
- `mobile/src/features/cardReport/ReportCardSheet.tsx`: for `unavailable` at open, the sheet
  shows the form with the offline copy (`report-card-error`) instead of "Sign in to report a
  problem". Submit tries the token again. My reports needed no change: the offline error is not a
  `CardReportSignedOutError`, so it shows the error text with "Try again".

Tests:
- `mobile/tests/unit/cardReportApi.test.ts`: "rejects with offline copy when signed in but the
  token refresh failed", "treats a signed-in learner whose token refresh failed as offline, not
  signed out", "is signed out when the refresh itself ended the session",
  "tells a token, signed out and unavailable apart".
- `mobile/tests/unit/reportCardSheet.test.tsx`: "shows offline copy with the form, not the
  sign-in message, when signed in but the token refresh failed". This test also retries
  successfully once a token is returned.
- `mobile/tests/integration/myReports.test.tsx`: "shows offline copy and Try again, not the
  sign-in message, when signed in but the token refresh failed".
- The existing signed-out tests now set the mocked auth status to `anonymous`, so they still
  cover a learner who really is signed out.

### m-correctness-2

Status: fixed

Confirmed. `onSubmit` only checked the render-time `phase`, so two taps in the same frame both
passed and both POSTed.

Change: `mobile/src/features/cardReport/ReportCardSheet.tsx` adds an `inFlight` `useRef`. It is
checked and set synchronously at the top of `onSubmit`, before the first await, and cleared in
`finally`.

Test: `mobile/tests/unit/reportCardSheet.test.tsx`, "sends one POST and ends on success when
Submit is tapped twice in the same frame". The test calls `onPress` twice in one `act`, holds
POST #1 open, and would answer a second POST with `duplicate: true`. It fails on the old guard
("expected 1 times, but got 2 times") and passes with the ref.

Note: under vitest, a second concurrent dynamic `import()` of a mocked module fails to parse
(RollupError). With the old per-call import this hid the second POST in the test. The shared
import promise in `cardReportApi.ts` removes that test-only artifact. Metro is not affected.

### m-tests-1

Status: partially fixed

Confirmed: the old test passes whether or not the sheet mount checks the lock.

Change (`mobile/tests/integration/cardDetailReport.test.tsx`):
- Renamed the old test to "renders no answer body and so no report row on a locked card" and
  added a comment saying that is all it proves.
- New "closes an open sheet when the screen moves on to a locked card". It opens the sheet on
  `cs-plain`, picks a reason, re-renders with `cs-locked`, and checks that the sheet is gone and
  no POST was sent.
- New "closes an open sheet on the next render once the flag is turned off". This covers the
  `showReport` gate on the sheet mount. It fails if the condition becomes
  `reportOpen && card && deck` (the reviewer's scratch change).

Why partial: the `!isLocked` term cannot be tested on its own, because it is unreachable.
`useDeckCard` reloads the owned set only when `cardId` changes. That same change also runs
`setReportOpen(false)`, so a card cannot become locked while the sheet is open without the reset
running first. The new locked-card test fails only if both the reset and `!isLocked` are removed.
`!isLocked` stays as a second guard. No source change.

### m-tests-2

Status: fixed

Confirmed: no test re-rendered CardDetail with a new `cardId` while the sheet was open.

Change: `mobile/tests/integration/cardDetailReport.test.tsx`, "does not carry an open sheet
over to another card, so no report goes out for the wrong card". It opens the sheet on
`cs-plain`, picks a reason, calls `tree.update()` with `cardId: 'cs-sourced'`, and checks that
the sheet is gone and `apiJson` was not called. It then opens a new report on `cs-sourced`,
checks that no reason is pre-selected, and checks that the POST body names
`stableUid: 'cs-sourced'`. It fails when the `setReportOpen(false)` line is removed. No source
change was needed.

## Mutation checks run (CardDetailScreen restored after each)

| Change to `CardDetailScreen.tsx` | Fails |
|---|---|
| remove `setReportOpen(false)` | m-tests-2 test |
| sheet condition without `showReport` | flag-off test |
| remove `setReportOpen(false)` and `!isLocked` | locked-card test, m-tests-2 test |
| `ReportCardSheet` without the `inFlight` check | double-tap test |

## Commands

- `cd mobile && npm run -s test:typecheck`: PASS
- `cd mobile && npx vitest run tests/unit tests/integration`: PASS
- `F04.verify.sh`: PASS
