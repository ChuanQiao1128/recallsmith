# V08 notes: usage analytics (daily tick step, 040), usage and freshness routes, suggested measured baselines

Issue #562, contract R20-00 §3 and §7. Zero model cost: everything is SQL over existing tables. No new SSM leaf,
no Terraform change, no webhook change. Every day and every window is **UTC**.

## What changed

| File | Change |
|---|---|
| `src_C/Vpc/Db/Migrations/040_usage_analytics.sql` | New, additive, no extension: `analytics_daily` gains `wau int`, `new_users int`, `cards_learned int`, `d1_retention numeric(5,4)`, `d7_retention numeric(5,4)`, `computed_at timestamptz`; `analytics_deck_daily` gains `new_learners int`. All `add column if not exists`, all nullable. |
| `src_C/Vpc/Analytics/UsageAnalytics.cs` | New. `RunIfDueAsync` (the tick step: once per UTC day), `ComputeAsync` (recompute the last 8 complete days in one transaction), `ExcludedSubs` (env parse), `HandleUsage` (the usage route), `DaysParam` (shared `days` validation). Missing table/column (42P01/42703) → the step logs `analytics_not_migrated` and returns `NotMigrated`; the route answers `503 NOT_READY`. |
| `src_C/Vpc/Automation/Freshness.cs` | New. `HandleFreshness` (the freshness route), `LoadAsync` (the chain walk), `Median`, `StatusAsync` (the status block). |
| `src_C/Vpc/Automation/AutomationTick.cs` | New last step `analytics_daily` in `RunStepsAsync`. The tick returns early when the effective mode is `off`, so the step runs in `dry_run` and `live`. |
| `src_C/Vpc/Automation/StatusRoutes.cs` | `automation/status` gains `freshness: {medianMinutesToPublish, n}`. |
| `src_C/Vpc/Ledger/LedgerRoutes.cs` | `GET /api/v1/admin/automation/baselines` items gain `suggestedMeasuredMinutes` and `suggestedFromN` (`SuggestedReviewMinutesAsync`). The PUT is unchanged. |
| `src_C/Vpc/VpcFunction.cs` | Two routes: `/api/v1/admin/automation/freshness`, `/api/v1/admin/analytics/usage`. |
| `src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs` | Both routes added to the known-route list. |
| `src_C/env/prod.env.json` | `"ANALYTICS_EXCLUDED_SUBS": ""`. |
| `src_C/Tests/RecallSmith.Lambda.IntegrationTests/UsageAnalyticsTests.cs` | New (16 tests incl. theory rows). |
| `src_C/Tests/RecallSmith.Lambda.IntegrationTests/AutomationFreshnessTests.cs` | New (9 tests incl. theory rows): freshness, status block, baseline suggestion. |
| `src_C/Tests/RecallSmith.Lambda.IntegrationTests/AutomationStatusRoutesTests.cs` | Status contract JSON gains `freshness`. |
| `src_C/Tests/RecallSmith.Lambda.IntegrationTests/AutomationLedgerTests.cs` | Pinned baseline item keys gain the two new keys. |
| `docs/runbooks/automation-operations.md` | New section "Usage analytics and freshness (R20 V08)". |

## Metric definitions

Source: `user_progress_events` rows with `event_type = 'card_reviewed'`. A review's **day** is the UTC date of its
`event_time` (`(event_time at time zone 'UTC')::date`), so 23:30Z counts on that date and 00:00Z on the next.
Subs listed in `ANALYTICS_EXCLUDED_SUBS` are removed before anything is counted (they are neither users nor
reviews nor cohort members). Only **complete** UTC days are computed: a review from today is ignored until
tomorrow's run. "First ever" looks at the whole history (before the recomputed window too), minus excluded subs.

For each day D:

| Column / key | Definition |
|---|---|
| `dau` | distinct users with a review on D |
| `wau` | distinct users with a review in the 7 days D−6 … D |
| `mau` | distinct users with a review in the 30 days D−29 … D |
| `reviews` | reviews on D |
| `new_users` / `newUsers` | users whose first ever review is on D |
| `cards_learned` / `cardsLearned` | (user, deck slug, stable uid) triples whose first ever review is on D |
| `d1_retention` / `d1Retention` | share of D's new users with a review on exactly D+1; stored on D (the cohort day); 4 decimals; **null** while D+1 is not a complete day or when D has no new users |
| `d7_retention` / `d7Retention` | same with exactly D+7 |
| `premium_active` | untouched (not part of this issue; stays as it was) |
| `computed_at` | the step's clock when the row was last recomputed |

Per day D and deck slug (`analytics_deck_daily`): `active_users` = distinct users reviewing the deck on D,
`reviews` = its reviews on D, `new_learners` = users whose first ever review in the deck is on D. Only
(day, deck) pairs with at least one review have a row.

**The step.** Tick step `analytics_daily`, last in `RunStepsAsync`. It is due when `max(computed_at)` is before
today's UTC midnight (or there is no row); it then recomputes the **8 complete days before today** (so the oldest
one's D7 has matured: its D+7 is yesterday) in one transaction: `insert … on conflict (day) do update` on
`analytics_daily`, and a delete + insert of those days' `analytics_deck_daily` rows (so a deck whose reviews are
now all excluded loses its row). Days outside the window are never touched. Rerunning gives the same rows.
Before migration 040 it logs `{"tag":"analytics","reason":"analytics_not_migrated","step":"analytics_daily"}`
and skips; the tick reports no failed step. It never logs a sub; the computed log line has the window and the
number of excluded subs.

Worked example (the seed of `UsageAnalyticsTests`, today = 2026-03-20, E excluded):
A reviews x/c1 on 03-05, x/c1 + x/c2 on 03-12, x/c1 on 03-13; B x/c1 on 03-12, y/c9 on 03-13, x/c1 on 03-19;
C x/c1 at 03-12 23:30Z, x/c3 on 03-19; D y/c9 twice on 03-13 and once today. Then 03-12 is
`dau 3, wau 3, mau 3, reviews 4, newUsers 2 (B, C), cardsLearned 3 (A/c2, B/c1, C/c1), d1 0.5 (B back), d7 1.0 (B, C back on 03-19)`;
03-13 is `3, 4, 4, 4, 1 (D), 2, d1 0, d7 null` (03-20 is not complete).

## API surface shipped

All admin routes are `Auth.RequireAdmin` (editor or super_admin with a console token), GET only (405 otherwise),
in the `Res` envelope. `days` must be an integer in range, else `400 VALIDATION_ERROR`.

- `GET /api/v1/admin/analytics/usage?days=30` (`days` 1…365, default 30) →
  ```json
  { "days": [{ "day": "2026-03-12", "dau": 3, "wau": 3, "mau": 3, "reviews": 4, "newUsers": 2, "cardsLearned": 3,
               "d1Retention": 0.5, "d7Retention": 1.0 }],
    "decks": [{ "deckSlug": "x", "activeUsers30d": 3, "reviews30d": 8, "newLearners30d": 3 }],
    "excludedSubsCount": 1, "lastComputedAt": "2026-03-20T10:00:00.000Z" }
  ```
  - `days`: the stored `analytics_daily` rows with day in [today − days, today), oldest first. Days the step never
    computed are absent (no gap filling); a row written before 040 has null for the new keys.
  - `decks`: computed live from `user_progress_events` over the last 30 complete UTC days with the same exclusion:
    distinct users, reviews, and users whose first ever review in the deck falls in the window. Order: reviews
    desc, then slug. Decks with no review in the window are absent.
  - `excludedSubsCount`: the number of distinct non-empty entries in `ANALYTICS_EXCLUDED_SUBS`; the subs are never
    returned. `lastComputedAt`: `max(computed_at)`, null before the first run.
  - Before 040: `503 NOT_READY` "Run the database migration (040_usage_analytics)".
- `GET /api/v1/admin/automation/freshness?days=30` (`days` 1…90, default 30) →
  `{items:[{kind, refId, title, detectedAt, queuedAt, draftedAt, decidedAt, publishedAt}], medians:{minutesToDraft, minutesToDecision, minutesToPublish}, n}`.
  - Items: every `source_watch_events` row of kind `changed`/`gone` (`kind:"page"`, `refId` = event id as a
    string, `title` = the target URL) and every **matched** `source_watch_feed_items` row (`kind:"feed"`,
    `refId` = `"<targetId>:<itemKey>"` as in V07, `title` = item title, else its URL) detected in the last `days`
    days. Newest `detectedAt` first, at most 200 listed.
  - The chain: `detectedAt` = event `created_at` / item `first_seen_at` → `queuedAt` = earliest
    `authoring_queue_items.created_at` of the linked queue items (`source_event_id` = the event, or the item's
    `queue_item_id`) → `draftedAt` = earliest `ai_drafts.created_at` of a draft with an
    `automation_draft_decisions` row in an `automation_runs` run of those queue items → `decidedAt` = earliest final
    decision of such a draft: `least(dd.human_decided_at, ai_drafts.decided_at, dd.decided_at when state = 'auto_accepted')`
    (routing a draft to a person, a `would_accept` in dry run, or a pending QA is not a decision) → `publishedAt` =
    earliest `deck_publishes.created_at` with `status = 'SUCCESS'` in the draft's deck whose `card_ids` contain the
    accepted card (`dd.accepted_card_id`, else `ai_drafts.accepted_card_id`). A missing link leaves that stage and
    every later one null.
  - `medians`: per stage, the median of (stage − `detectedAt`) in minutes over the items that reached the stage
    (mean of the middle two for an even count), 2 decimals, null when no item reached it. Computed over all items in
    the window, not only the 200 listed.
  - `n`: the number of items in the window (the chains considered).
  - Before 034: `503 NOT_READY` "Run the database migration (034_automation)".
- `GET /api/v1/admin/automation/status` gains `freshness: {medianMinutesToPublish, n}` over the default 30 days;
  here `n` is the number of items that reached a publish (the sample behind that median).
- `GET /api/v1/admin/automation/baselines`: each item gains `suggestedMeasuredMinutes` and `suggestedFromN`.
  - For `ai_draft_review`: `suggestedFromN` = the number of `ai_review_events` rows with action `accepted`,
    `edited_accepted` or `rejected` and `review_ms > 0` (all time); `suggestedMeasuredMinutes` = their median
    `review_ms` / 60000, 2 decimals, when `suggestedFromN ≥ 5`, else null. Submits, null and zero times never count.
  - Every other automation: both null. Before 030 (table missing) both are null for every row.
  - Only a suggestion: setting a measured baseline stays the super_admin `PUT /api/v1/admin/automation/baselines/:automation`.
- Env: `ANALYTICS_EXCLUDED_SUBS` (comma-separated subs, trimmed, empties dropped, default `""`), read on every call.

## How it is tested

`dotnet test Tests/RecallSmith.Lambda.IntegrationTests` from `src_C` (Testcontainers Postgres, scratch databases,
fixed clock via `UsageAnalytics.UtcNow`):

- `UsageAnalyticsTests.Analytics_Compute_ExactDailyMetrics_WithExclusion`: the worked example above; all 8 rows
  exact (DAU/WAU/MAU, reviews, new users, cards learned, D1/D7), deck rows exact, `computed_at` from the clock,
  exclusion list with spaces, blanks and a duplicate.
- `…Analytics_Compute_WithoutExclusion_CountsEveryUser`: the same seed without the list (D1/D7 0.6667).
- `…Analytics_Compute_Rerun_IsIdempotent_KeepsPremiumActive_DropsStaleDeckRows`: two runs give identical rows;
  `premium_active` kept; a stale deck row in the window removed; a row outside the window untouched.
- `…Analytics_Retention_MaturesOnlyAfterTheCohortDay`: D1 set once D+1 is complete; a return today does not count.
- `…Analytics_Tick_RunsOncePerUtcDay`: through the signed tick: first tick computes, a later tick the same UTC day
  (23:59) changes nothing even with a new review, the next UTC day recomputes the shifted window with it.
- `…Analytics_BeforeMigration040_StepSkips_RouteAnswers503`: scratch database at 039: the step returns
  `NotMigrated`, the tick has no failed step, the route answers 503 `NOT_READY`.
- `…Usage_Route_ReturnsDaysDecksAndExclusionCount`, `…Usage_Route_BeforeAnyRun_IsEmpty`,
  `…Usage_Route_BadDays_Returns400` (0, 366, abc, −1, 7.5), `…Usage_Route_RequiresAdmin_AndGet`,
  `…Analytics_ExcludedSubs_ParsesCommaList`, `…Analytics_ProdEnvFile_DefaultsExclusionToEmpty`.
- `AutomationFreshnessTests.Freshness_WalksTheChain_GapsAreNull_MediansPerStage`: a complete auto-accepted chain,
  a page event with a queue item and no run, a feed item routed to a person (no decision), a human-accepted chain
  with a failed publish before the successful one; an unmatched feed item, a `failing` event and a 40-day-old
  change are not items (the last one is with `days=90`). Exact timestamps, nulls for gaps, medians 60/150/210,
  `n` 4, status `freshness` 210 over n 2.
- `…Freshness_Empty_MediansNull`, `…Freshness_Median_OddEvenAndRounding`, `…Freshness_BadDays_Returns400`,
  `…Freshness_RequiresAdmin`, `…Freshness_BeforeMigration034_Returns503NotReady`.
- `…Baselines_SuggestedMeasuredMinutes_MedianReviewTime_FromFiveDecisions`: null with 0 and 4 decisions, 3.00
  with 5, 3.50 with 6 (even count), ignored submit/null/zero rows, stored baseline untouched, other rows null.
- `RouteMetricsTests` (existing) checks the two routes are in the known-route list.

Tests first: both new test files do not compile against the base (`UsageAnalytics`, `Freshness`,
`LedgerRoutes.HandleBaselines` without the new keys), and the updated status/baseline shape tests fail on it.

## Owner steps

1. After deploying the code, run `POST /api/v1/admin/db/migrate` (040) through `scripts/invoke-as-admin.sh`.
   Until then the step skips with a log line and the usage route answers 503; freshness and baselines work.
2. Optional: put your own learner sub(s) (test devices) in `ANALYTICS_EXCLUDED_SUBS` in `src_C/env/prod.env.json`
   (comma-separated) and redeploy. The file is merged by `src_C/scripts/merge-env.sh`; removing a key from the file
   does not remove it from the live Lambda, so set it to `""` to clear it.
3. Once `suggestedFromN ≥ 5`, decide whether to adopt `suggestedMeasuredMinutes` for `ai_draft_review` with the
   existing super_admin PUT (`baselineSource: "measured"`).

## Deferred

- The console page that shows these numbers is V10.
- `premium_active` is still never computed (out of scope).
- The usage route does not gap-fill days the step never computed (for example before the first run, or days older
  than the first 8-day window); the console can render a gap.
- The baseline suggestion covers `ai_draft_review` only, over all time; `auto_accept` has no measured human time.
- Days older than the 8-day window are not backfilled; a one-off backfill would be a separate admin action.

## Final test run (2026-10-01)

- `dotnet test Tests/RecallSmith.Lambda.IntegrationTests` (from `src_C`): 2832 passed, 0 failed, 0 skipped.
- Targeted filter `Analytics|Freshness|Usage`: 36 passed.
- The docs path citations in this file and the runbook were checked against the `docsPaths.test.ts` rule: every
  cited path exists. vitest itself could not run, because this worktree's `frontend/node_modules` is incomplete.
