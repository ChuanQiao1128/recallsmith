# C01 — Console Usage page: anonymous funnel section (issue #641)

Round r24, wave c. Contract: `R24-00-contracts.md` §3.2 (admin read) and §3.5 (console).

## What changed

| File | Change |
| --- | --- |
| `frontend/src/api/usage.ts` | `fetchFunnel(days = FUNNEL_DAYS)` → `GET /api/v1/admin/analytics/funnel?days=90`; types `FunnelReport`, `FunnelCounts`, `FunnelWeek`, `FunnelDeck`; constants `FUNNEL_DAYS`, `FUNNEL_EVENTS`, `FUNNEL_DECK_EVENTS`. |
| `frontend/src/lib/funnelView.ts` (new) | Pure helpers: `overallFunnelSteps` (conversion from first open), `deckFunnelSteps` (conversion from goal chosen), `recentCohortWeeks` (newest 12), `formatStep`, `formatConversion`, `barWidth`, `isFunnelEmpty`, `FUNNEL_STEP_LABELS`. |
| `frontend/src/pages/UsagePage.tsx` | New section "Funnel (anonymous installs)" between By deck and Freshness, with its own load state; Refresh reloads it too. |
| `frontend/tests/usageApi.test.ts` | `fetchFunnel` tests. |
| `frontend/tests/funnelView.test.ts` (new) | Helper tests. |
| `frontend/tests/usagePage.test.tsx` | Funnel section tests; the existing NOT_READY and Refresh tests now cover the funnel too. |
| `frontend/README.md` | Describes the section. |

## Surface shipped

- `fetchFunnel` follows `fetchUsage`: it returns an `ApiResult`, never throws, turns numeric strings into numbers,
  and keeps a missing figure as `null` (shown as "—"). A refusal (e.g. `503 NOT_READY`) passes through.
  The payload must hold `overall.counts`, a `weeks` array and a `byDeck` array in the server's shape; anything
  else is `BAD_RESPONSE` (corrected in r24x F07; the first version accepted either `overall` or `weeks`).
- Section content:
  - **Overall steps**: a table (Step, Installs, From first open) plus a plain inline SVG bar per step. Bars are
    scaled to the largest step. No chart library is used.
  - **Cohort weeks (last 12)**, newest first. Each cell reads "count (share of that week's first opens)".
  - **By deck**: goal chosen, starter started, starter completed and first pack opened, each converted from the
    deck's goal chosen count.
  - **States**: loading; a neutral info callout for `503 NOT_READY` only (`data-testid="funnel-not-ready"`);
    a danger callout with the server message for every other error, a 404 or `BAD_RESPONSE` included (r24x F07;
    the first version also showed the neutral callout for any 404); "No anonymous install has been counted yet." when
    every count is null or 0.

## Response shape (verified against A01 in r24x F07)

The first version guessed the keys (it read per-deck rows from `decks`, accepted `cohortWeek`/`week` week keys and
flat counts). That guess was wrong for the per-deck rows: the merged server sends them as `byDeck`, so the By deck
table always showed its empty state. r24x F07 (`docs/delivery/r24x-issues/F07-fixes.md`) replaced the guess with the
shape `AnonFunnel.HandleFunnel` (`src_C/Vpc/Analytics/AnonFunnel.cs`) sends and `AnonFunnelTests` pins:

```json
{
  "days": 90,
  "fromCohortDay": "2026-07-04",
  "events": ["first_open", "goal_chosen", "..."],
  "overall": { "counts": { "first_open": 40, "goal_chosen": 30, "...": 0 }, "conversion": { "goal_chosen": 0.75 } },
  "weeks": [ { "weekStart": "2026-09-28", "counts": { "first_open": 10, "...": 0 }, "conversion": { } } ],
  "byDeck": [ { "deckSlug": "aws-saa-c03", "counts": { "goal_chosen": 12, "starter_started": 9, "...": 0 } } ]
}
```

- Counts are keyed by the snake_case event names of contract §3.1 (dictionary keys; `Res.cs` sets no
  `DictionaryKeyPolicy`). The server sends every event, 0 when none.
- `byDeck` holds only rows with a deck slug (the query filters `deck_slug is not null`).
- A missing `overall`/`weeks`/`byDeck`, a missing count key, or a row in another shape is `BAD_RESPONSE`.
- The server's `conversion` is ignored; the console derives conversions from the counts.

## How it is tested

```
cd frontend
npx tsc --noEmit -p . && npx vitest run tests/usageApi.test.ts tests/usagePage.test.tsx tests/usageView.test.ts tests/funnelView.test.ts
npx tsc -b && npx eslint . && npx vitest run   # full gates
```

The tests were committed first and failed against the base. `src/api/usage` (page tests) and `src/api/http`
(API tests) are mocked, so no test makes a network call.

## Owner steps

None for this issue. The section shows the neutral callout until A01's migration 043 and admin route are deployed.
The admin route needs no gateway change: `ANY /api/v1/admin/{proxy+}` already covers it.

## Deferred

- The section does not offer a window picker; it always reads 90 days.
