# V11 — Mobile report-a-card (flag `features.cardReport.enabled`, default off) + My reports

Issue #565, wave m (mobile), R20 contract §4 and §8. OTA-safe: JS only, no dependency,
`app.json`, `eas.json` or native change; frozen files (`mobile/src/content/deckRepository.ts`,
`mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`) and `mobile/src/auth/*`,
`mobile/src/sync/*`, `mobile/src/content/*`, `mobile/src/premium/*` are untouched. No paid model
call, no analytics event: the report POST is the only record.

## What changed

| File | Change |
|---|---|
| `mobile/src/config/featureFlags.ts` | New `cardReport: { enabled }` key: type, frozen default `false`, `snapshotsEqual`, `applyRemoteFeatures` (boolean only, anything else → default). |
| `mobile/src/features/cardReport/cardReportApi.ts` | New. `submitCardReport`, `listMyCardReports`, `cardReportErrorMessage`, `getCardReportAuth` (was `getCardReportToken`, see F04), reasons, copy. |
| `mobile/src/features/cardReport/ReportCardSheet.tsx` | New. React Native `Modal` with the report form. |
| `mobile/src/features/cardReport/SessionReportButton.tsx` | New. The small "Report" text button used in a review session; opens the sheet in place. |
| `mobile/src/screens/MyReportsScreen.tsx` | New stack screen listing the learner's own reports. |
| `mobile/src/screens/CardDetailScreen.tsx` | "Report a problem" row at the end of the answer body (after the Source row); only for an unlocked card with the answer open and the flag on. |
| `mobile/src/screens/SessionCardScreen.tsx` | `SessionReportButton` after the card body once the answer is shown (Q/A: revealed; MCQ: verdict stage), flag on. Kept out of the rating dock. |
| `mobile/src/screens/MoreScreen.tsx` | Flag-gated "My reports" row (`more-row-reports`) between Mistake Book and Settings. The Support row is unchanged. |
| `mobile/src/navigation/types.ts`, `mobile/App.tsx` | `MyReports: undefined` route and its `Stack.Screen`. |

## Shipped surface

Flag: `features.cardReport.enabled` (boolean, default `false`). Every reader uses
`cardReport?.enabled === true`, so suites that mock flags without the key keep it off.

API (`mobile/src/features/cardReport/cardReportApi.ts`), both via `apiJson` with the token from
`getFreshAccessToken()`:

- `submitCardReport({ deckSlug, stableUid, reason, note?, clientVersion? })` →
  `POST /api/v1/user/card-reports`, body `{ deckSlug, stableUid, reason, note?, clientVersion? }`,
  timeout 15 s. The note is trimmed and capped at 500; a blank note is omitted. The sheet sends
  `clientVersion` = `app.json` `expo.version`. Returns `{ reportId, status, duplicate }`.
- `listMyCardReports()` → `GET /api/v1/user/card-reports?limit=50`, returns the normalised
  `items` (items with an unknown reason or missing ids are dropped).
- Both accept either the `{ success, data: {...} }` envelope or a bare payload.
- No token and not signed in → `CardReportSignedOutError` before any request. No token while the
  auth store still says `signed_in` (offline refresh failure) → `CardReportTokenUnavailableError`,
  shown as `FRIENDLY_ERROR_COPY.offline` (F04 m-correctness-1; the R20 text treated both as
  signed out).
- `cardReportErrorMessage(err)`: 429 → "You have reached today's report limit"; 503 (either code)
  → "Reporting is unavailable right now"; 404 → "This card can't be reported right now";
  400/409/422 → "We couldn't send this report. Please try again."; everything else (offline,
  timeout, 401, 5xx) → `FRIENDLY_ERROR_COPY` via `classifyError`.

Reasons (contract §4 values → labels): `wrong_answer` "The answer is wrong", `outdated` "It is
out of date", `unclear` "It is hard to understand", `typo` "There is a typo", `other`
"Something else".

Sheet states: checking token → signed out ("Sign in to report a problem", no form, Close only) or
form (with the offline copy when signed in but no token could be read, F04) (5 radio chips, optional note with `n/500` counter, Cancel / Submit, Submit disabled until a
reason is chosen) → success ("Thanks — the author will review it") or duplicate ("You already
reported this card"). A synchronous in-flight ref stops a double tap from sending two POSTs
(F04 m-correctness-2). Errors keep the form and show the mapped copy with `accessibilityRole="alert"`.

My reports: loading skeleton, signed-out text, error text + "Try again", empty state, or a list
with badge (Open / Fixed / Won't fix / Duplicate / Invalid; Closed if resolved without a
resolution), question (≤200 chars from the server, 3 lines), reason label, created day and the
resolution note when present.

testIDs: `card-detail-report`, `session-card-report`, `report-card-sheet`, `report-reason-<value>`,
`report-card-note`, `report-card-note-counter`, `report-card-submit`, `report-card-cancel`,
`report-card-success`, `report-card-duplicate`, `report-card-signed-out`, `report-card-error`,
`more-row-reports`, `my-reports-*`.

Accessibility: role + label (+ hint on entry points and actions) on every control, 44 pt minimum
targets (`a11y.minTouch`), chrome text capped at `CHROME_MAX_FONT_SCALE`; the note input and card
question text are not clamped beyond that.

## Tests

- `mobile/tests/unit/featureFlagsCardReport.test.ts` — default off and frozen, override,
  non-boolean rejection, change-only notification.
- `mobile/tests/unit/featureFlags.test.ts`, `mobile/tests/unit/featureFlagsSentry.test.ts` — every
  full-object `toEqual` gains `cardReport`.
- `mobile/tests/unit/cardReportApi.test.ts` — path, method, body, token, note trim/cap, signed-out,
  list normalisation, error mapping (429, 503, 404, offline, timeout, 500, unknown).
- `mobile/tests/unit/reportCardSheet.test.tsx` — five reasons, note cap + counter, submit body,
  success, duplicate, 429 and 503/offline copy, signed-out (no form), Cancel, a11y props.
- `mobile/tests/integration/cardDetailReport.test.tsx` — row after Source with the flag on, opens
  the sheet in place, hidden with the flag off, no answer body on a locked card. The R20 "hidden on
  a locked card" test did not check the sheet's lock gate. F04 adds tests for closing the sheet
  on a move to a locked card, on a flag flip, and on a card change (no POST for the wrong card).
- `mobile/tests/integration/sessionCardReport.test.tsx` — button only after reveal with the flag
  on, not in the rating dock, opens the Modal without any navigation, hidden with the flag off.
- `mobile/tests/integration/session-card-mcq.screen.test.tsx` — MCQ: button only at the verdict
  stage with the flag on, never in the dock, absent when the flags omit the key.
- `mobile/tests/integration/myReports.test.tsx` — More row gated, Support row unchanged, badges,
  resolution note, empty, signed-out, error + retry, 503, back button and header a11y.

Commands run (all green): `npm run -s test:typecheck`,
`npx vitest run tests/unit tests/integration` (252 files), `V11.verify.sh`.

## Owner steps

1. Deploy V05 (server routes, `CARD_REPORTS_ENABLED=1`) first; until then the sheet shows
   "Reporting is unavailable right now" / an error, never a crash.
2. Update the App Store privacy label for user-submitted report text (contract §9 step 4).
3. Then set `"features": { "cardReport": { "enabled": true } }` in
   `ChuanQiao1128/recallsmith-mobile-config` `recallsmith-config.json`; it reaches devices on the
   next cold start. Ship this JS through the normal OTA/release path first.

## Deferred / notes

- No deep link for My reports (`navigation/linking.ts` unchanged); the screen is reached from More.
- No offline queue: a failed submit shows the friendly copy and the learner can retry.
- A report does not navigate back from My reports to the card; items are read-only.
