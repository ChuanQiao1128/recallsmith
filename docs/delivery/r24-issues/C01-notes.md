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
  The payload must hold either an `overall` object or a `weeks` array; anything else is `BAD_RESPONSE`.
- Section content:
  - **Overall steps**: a table (Step, Installs, From first open) plus a plain inline SVG bar per step. Bars are
    scaled to the largest step. No chart library is used.
  - **Cohort weeks (last 12)**, newest first. Each cell reads "count (share of that week's first opens)".
  - **By deck**: goal chosen, starter started, starter completed and first pack opened, each converted from the
    deck's goal chosen count.
  - **States**: loading; a neutral info callout for `NOT_READY` or HTTP 404 (`data-testid="funnel-not-ready"`);
    a danger callout with the server message for other errors; "No anonymous install has been counted yet." when
    every count is null or 0.

## Response shape assumed (A01 is being built in parallel)

The contract names the figures but not the JSON keys, so the client reads them tolerantly:

```json
{
  "days": 90,
  "overall": { "counts": { "first_open": 40, "goal_chosen": 30, "...": 0 } },
  "weeks": [ { "cohortWeek": "2026-09-28", "counts": { "first_open": 10, "...": 0 } } ],
  "decks": [ { "deckSlug": "aws-saa-c03", "counts": { "goal_chosen": 12, "starter_started": 9 } } ]
}
```

- Counts are keyed by the snake_case event names of contract §3.1. They are read from a nested `counts` object
  when one exists, otherwise from the item itself.
- The week key can be `cohortWeek`, `weekStart` or `week`.
- Any conversion the server sends is ignored; the console derives conversions from the counts.

If A01 ships different key names, only `normalizeFunnelWeek` / `normalizeFunnelDeck` / `readCounts` in
`frontend/src/api/usage.ts` need to change.

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

- Once A01 merges, check the key names against the real response (see above).
- The section does not offer a window picker; it always reads 90 days.
