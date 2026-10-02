# F07 — r24 review fixes: funnel console (fixes ledger)

Issue #660 · round r24x, wave c · base `delivery/r24x-c` (= `release/r24`).
Each finding was checked against the code first, using the merged server
(`src_C/Vpc/Analytics/AnonFunnel.cs` `HandleFunnel`, pinned by
`src_C/Tests/RecallSmith.Lambda.IntegrationTests/AnonFunnelTests.cs`). The new tests were committed
on their own first. Against the base `usage.ts`/`UsagePage.tsx` they failed (13 failures), and they
pass after the fix.

The server sends:
`data = { days, fromCohortDay, events, overall: { counts, conversion }, weeks: [{ weekStart, counts, conversion }], byDeck: [{ deckSlug, counts }] }`.
`counts` is a `Dictionary<string,long>` keyed by the snake_case event names. `Res.cs` sets only
`PropertyNamingPolicy = CamelCase` and no `DictionaryKeyPolicy`, so the keys stay snake_case. Every
event is present, with 0 when there is none (`Counts()`). `byDeck` holds only rows that have a slug,
because the query filters on `deck_slug is not null`.

Files changed: `frontend/src/api/usage.ts`, `frontend/src/pages/UsagePage.tsx`,
`frontend/tests/usageApi.test.ts`, `frontend/tests/usagePage.test.tsx`, `frontend/README.md`,
`docs/delivery/r24-issues/C01-notes.md`, this ledger.

### x-interfaces-1
Status: fixed

Confirmed. `fetchFunnel` read per-deck rows only from `data.decks`, and the server sends `byDeck`,
so the By deck table always showed its empty state. Fix: `fetchFunnel` now reads `data.byDeck` only.
The supervisor asked for the guessed `data.decks` fallback to be dropped, so it is gone. The
`usageApi.test.ts` fixture (`serverFunnel()`) is now exactly the shape that `AnonFunnelTests` asserts:
`overall.counts`, `weeks[].weekStart`/`counts`, and `byDeck[].deckSlug`/`counts` with every event key.
Tests: `fetchFunnel › reads … in the exact shape the server sends`, and `refuses a payload with
decks instead of byDeck` / `no byDeck` as BAD_RESPONSE.

### c-correctness-1
Status: declined

The premise does not hold for the merged server. Property names are camelCase (`weekStart`,
`byDeck`, `deckSlug`), but the counts are dictionary keys, and with no `DictionaryKeyPolicy` they
stay snake_case (`AnonFunnelTests` reads `counts.first_open`). The server never sends `firstOpen`,
so the client does not add a camelCase fallback. The silent-empty risk behind this finding is
handled under c-tests-1: camelCase keys are now BAD_RESPONSE, not an all-null funnel. Test:
`refuses a payload with camelCase count keys as BAD_RESPONSE`.

### c-correctness-2
Status: fixed

Partly confirmed. The `byDeck` alias was real (see x-interfaces-1). The other shapes the reviewer
listed (`overall` as an `[{event,count}]` array, `cohorts`/`byWeek`) are not what the server sends,
so they are not accepted as aliases. The client now accepts one shape, the server's, and pins it in
tests. Every other shape is BAD_RESPONSE. The loose check "overall is an object or weeks is an
array" is replaced by: `weeks` and `byDeck` must be arrays, `overall.counts` must hold every event,
and every week and deck row must parse. Otherwise the result is BAD_RESPONSE. Tests: the
`refuses a payload with …` table in `usageApi.test.ts` (list-shaped overall, no overall/weeks/byDeck,
`cohortWeek` week key, flat counts).

### c-tests-1
Status: fixed

Confirmed. `readCounts` returned null for every key it could not find, and `isFunnelEmpty` then
showed "No anonymous install has been counted yet." Fix: `readCounts` now requires a `counts`
object holding every expected event key, which the server always sends. If any key is missing, the
row is refused and `fetchFunnel` returns BAD_RESPONSE, which the page shows as the danger callout
with the message. A real empty table (all zeros) still reads as empty. Tests: `usageApi.test.ts`
`reads an empty table as an empty funnel` and the BAD_RESPONSE table (camelCase keys, flat counts);
`usagePage.test.tsx` `shows a mismatched response as an error, not as "no install counted yet"`.
These tell "mismatched keys" apart from "really empty". Contract §3.2 is outside this issue's scope,
so the shape is pinned in the C01 notes and in the test fixture instead (see DEVIATIONS in the PR
report).

### c-correctness-3
Status: declined

The server never sends a null-slug deck row: the `byDeck` query has `deck_slug is not null`
(`AnonFunnel.cs`, the deck query in `HandleFunnel`). A null slug in `byDeck` is therefore a shape
error. It now returns BAD_RESPONSE, not a silent drop, and the comment on `normalizeFunnelDeck`
documents this. The By deck table can still add up to less than the overall goal-chosen count
(installs with no deck). That is by design on the server and not hidden by the client. Test:
`refuses a payload with a deck without a slug as BAD_RESPONSE`.

### c-correctness-4
Status: fixed

Confirmed. `isFunnelNotReady` treated any 404 as "not set up". Fix: removed. The page now uses
`isNotReady` (error code `NOT_READY`, which the server sends with 503) for the neutral callout.
Every other error, a 404 included, shows the danger callout with the server message. The callout
text no longer tells the owner to deploy the route. Tests: `usagePage.test.tsx` `shows a neutral
callout only for 503 NOT_READY` and `shows a 404 as an error with the server message, not as a
pending setup step`; `usageApi.test.ts` checks that a 404 keeps its code and message.

## Notes corrected

`docs/delivery/r24-issues/C01-notes.md` described a guessed response shape (`decks`, `cohortWeek`,
flat counts), an acceptance rule that let either `overall` or `weeks` through, and 404 as "not set
up". It now records the verified server shape and the strict rules. `frontend/README.md` is updated
to match.

## How it is checked

```
cd frontend
npx tsc --noEmit -p . && npx vitest run tests/usageApi.test.ts tests/usagePage.test.tsx tests/usageView.test.ts tests/funnelView.test.ts
npx tsc -b && npx eslint . && npx vitest run
```
