# A01 — Public anonymous funnel ingest, admin funnel read, migration 043, retention

Issue #638, round r24 wave s. Contract: R24-00 §3.1-§3.2.

## What changed (files)

| File | Change |
| --- | --- |
| `src_C/Vpc/Db/Migrations/043_anon_funnel_events.sql` | New table `anon_funnel_events` (check constraint on the nine events), index `(cohort_day, event)` and index `(received_at)` for the retention delete. Additive, idempotent (`if not exists`), no extension. |
| `src_C/Vpc/Analytics/AnonFunnel.cs` | New: the ingest handler, the admin read and `DeleteExpiredAsync` (retention). |
| `src_C/Vpc/VpcFunction.cs` | Exact `RouteMatcher.Match` branches for both routes. For `/api/v1/public/events` the dispatcher does **not** resolve auth at all (anonymous context), so a bearer is never verified, linked or logged. The anonymous context moved into a small `Anonymous()` helper. |
| `src_C/Vpc/Analytics/UsageAnalytics.cs` | (R24X F05: no longer runs the retention; it was here, after a computed rollup, in r24.) |
| `src_C/Vpc/Automation/AutomationTick.cs` | R24X F05: a new `anon_funnel_retention` step, before `analytics_daily`, runs `AnonFunnel.DeleteExpiredAsync` on every tick. |
| `src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs` | `TemplateRoutes` gains `/api/v1/admin/analytics/funnel` and `/api/v1/public/events`. R24X F05: the metric line of `/api/v1/public/events` never carries `upstreamTraceId` (the app's `x-dc-trace-id` is its Sentry trace id). |
| `src_C/Tests/RecallSmith.Lambda.IntegrationTests/AnonFunnelTests.cs` | New integration tests (below). |

## Surface shipped

### `POST /api/v1/public/events` (no auth)

Request: `{ "platform": "ios"|"android", "appVersion": "1.9.0", "events": [ { "event", "cohortDay", "eventDay", "deckSlug"? } ] }`.

Order of checks:
1. Method must be POST, else 405.
2. Body over 8192 UTF-8 bytes: `413 PAYLOAD_TOO_LARGE`. Nothing is stored and the request does not count against the budget.
3. Per-container budget, 120 requests per 60 s (ClientErrors pattern, static window): `429 RATE_LIMITED` with `Retry-After: 60`. The first refusal in a window writes one `anon_funnel_budget` warn line.
4. Whole-batch checks, each a `400`:
   - invalid JSON: `BAD_REQUEST`;
   - not an object: `VALIDATION_ERROR`;
   - `platform` not in {ios, android}: `VALIDATION_ERROR`;
   - `appVersion` missing, over 20 chars or not `^\d+\.\d+\.\d+$`: `VALIDATION_ERROR`;
   - `events` not an array or over 20 items: `VALIDATION_ERROR`.
5. Per-event checks. An invalid event is skipped and counted in `rejected`. An event is invalid when:
   - it is not an object;
   - `event` is not one of the nine;
   - `cohortDay` or `eventDay` is not a real `YYYY-MM-DD` date in [today − 400, today + 1], where today is the UTC date;
   - `deckSlug` is neither null nor one of `aws-saa-c03`, `claude-ccdv-f`, `csharp-basics`.
6. Global daily cap (R24X F05): every well-formed batch opens a connection and counts the rows received in the last
   24 hours (`received_at >= now() - interval '1 day'`, scan stopped at 20001 rows). Over 20000, nothing is stored:
   `202` with `accepted: 0` and every event of the batch in `rejected`, and a `anon_funnel_daily_cap` warn line at
   most once per container per hour.
7. Accepted rows go in with one `insert … select from unnest(…)`. The response is `202 { success: true, data: { accepted, rejected } }`.
8. Before migration 043 the route answers `503 NOT_READY`; with no PG env, `503 CONFIG_ERROR`. Both hold for every
   batch that passed step 4, including `events: []` and a batch with no valid event (R24X F05: the cap count in
   step 6 runs before the row gate, so it is also the readiness probe).

The per-container budget (step 3) bounds one container only; the real request ceiling is the gateway route throttle
from P01 (burst 10, rate 5), which **must be applied before the route is exposed**. The daily cap (step 6) bounds
storage whatever the concurrency: at most about 20000 + one batch per in-flight request per 24 hours.

The body is never logged. The per-request dispatcher log line for this route has `userSub: null`, because auth is never resolved. Its metric line has no `upstreamTraceId` (R24X F05), so no client trace id from this route is logged.

### `GET /api/v1/admin/analytics/funnel?days=90` (RequireAdmin)

`days` is 1..400 (default 90); anything else is `400 VALIDATION_ERROR`. The window is `cohort_day` in [today − days, today + 1].

```json
{ "days": 90, "fromCohortDay": "2025-12-20",
  "events": ["first_open", "goal_chosen", "starter_started", "starter_completed", "first_pack_opened",
             "returned_day_1", "returned_day_7", "signup_started", "signup_completed"],
  "overall": { "counts": { "first_open": 6, "goal_chosen": 4, "…": 0 },
               "conversion": { "goal_chosen": 0.6667, "…": 0 } },
  "weeks": [ { "weekStart": "2026-03-09", "counts": { … }, "conversion": { … } } ],
  "byDeck": [ { "deckSlug": "aws-saa-c03",
                "counts": { "goal_chosen": 2, "starter_started": 1, "starter_completed": 0, "first_pack_opened": 0 } } ] }
```

- `weekStart` is the ISO week's Monday (`date_trunc('week', cohort_day)`); weeks are in ascending order.
- `counts` always holds every key, filled with 0 where there are no rows.
- `conversion` is each step after `first_open` divided by `first_open`, rounded to 4 decimals, and `null` when `first_open` is 0. There is no `first_open` key in `conversion`.
- `byDeck` follows the usage route's deck scoping: a caller who is not super_admin sees only the decks they can read.
  R24X F05: for such a caller `overall` and `weeks` also count only rows with no deck or a readable deck, so the
  visible `byDeck` totals cannot be subtracted from `overall` to learn an unreadable deck's counts. A super_admin
  sees every row.
- Before migration 043 the route answers `503 NOT_READY`.

### Retention

R24X F05 (replaces the r24 wording, which overclaimed): its own automation step, `anon_funnel_retention`, on every
tick and before `analytics_daily`, so it runs whatever the rollup does (computed, not due, deferred, backed off or
failing). Each run deletes at most 10000 rows (`AnonFunnel.RetentionBatch`), oldest first, received before
`AnonFunnel.UtcNow` − 400 days (the funnel clock, not `UsageAnalytics.UtcNow`), in its own transaction with
`set local statement_timeout = 2000` (`AnonFunnel.RetentionStatementTimeout`). Before 043 it logs
`anon_funnel_not_migrated` and does nothing. Any other failure logs a `anon_funnel_retention_failed` warn line (with
the SQL state) and is thrown, so the tick records `anon_funnel_retention` as a failed step; the next tick retries.

In r24 the delete ran inside `analytics_daily` only after a computed rollup, with no timeout and no cap; a rollup that
failed every day (statement_timeout) stopped the retention silently.

## How it is tested

`AnonFunnelTests` (scratch Postgres per test, fixed today 2026-03-20) goes through the full `VpcFunction` for the ingest:
- a mix of accepted and rejected events (unknown event, unknown deck, out-of-range day, impossible date, wrong shape, wrong type, non-object), with exact stored rows;
- the day-window edges (−400 is valid, −401 is not, +1 is valid, +2 is not);
- whole-batch 400s, including over 20 events, plus 20 events and android accepted;
- oversize bodies, char-counted and multi-byte, give 413;
- method and exact-path behaviour: 405, suffix 404, extra segment 404, and a stage prefix still routes;
- the budget: 120 requests are accepted, the 121st and 122nd get 429 with `Retry-After: 60` and exactly one `anon_funnel_budget` line, and the window rolls over after 60 s;
- 125 oversize bodies (413) do not spend the budget: a valid request after them is accepted (R24X F05);
- the daily cap: at 20000 rows a batch is stored, over it every event is rejected, one `anon_funnel_daily_cap` line per hour, rows older than 24 h do not count (R24X F05);
- no PG env: 503 CONFIG_ERROR, also for an empty or all-invalid batch (R24X F05);
- a bearer with authorizer claims is ignored: the dispatcher line for the path is captured and holds `"userSub":null` (positive control; the test fails if info lines are off), neither the sub nor any body value shows up in stdout or stderr, and a live slug on `signup_completed` is stored as null;
- before 043: 503 from both routes, also for `events: []` and an all-invalid batch, and the analytics step still computes.

Admin read tests:
- weekly, overall and by-deck aggregates, the conversion math, and a week with no first open (conversion null);
- `days` widening and validation;
- an empty table;
- an editor with can_read on one deck sees only that deck in `byDeck`, and `overall`/`weeks` without the other decks' rows; an editor with no grant sees no deck (R24X F05);
- 403 for a learner and 405 for POST;
- exact routing through `VpcFunction`.

Retention tests:
- the 400-day boundary through `DeleteExpiredAsync`, on the funnel clock (the usage clock is moved away);
- the per-run cap (batches of `RetentionBatch`);
- retention through the real automation tick on every tick, with no failed step;
- a rollup that fails (check violation) is recorded as `analytics_daily` and the retention still deletes, on that tick and the next;
- a delete that hits its statement_timeout is recorded as `anon_funnel_retention` only, logs `anon_funnel_retention_failed` with `57014`, and the rollup still computes.

`RouteMetricsTests.RouteTable_AndTheDispatchers_NameTheSameRoutes` stays green with the two new `TemplateRoutes` entries, and `RouteMetrics_LabelsBothRoutes` checks the labels.

Commands:
- `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests --filter "FullyQualifiedName~Funnel|FullyQualifiedName~RouteMetrics|FullyQualifiedName~UsageAnalytics"`: 91 passed.
- `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests`: 2859 passed.

## Owner steps

1. Deploy the code, then run the migration (`POST /api/v1/admin/db/migrate`) so 043 applies. Until then both routes answer 503 NOT_READY and the retention skips with a log line.
   An `anon_funnel_daily_cap` warn line in the core-vpc logs means more than 20000 rows arrived in 24 hours and the ingest is storing nothing; check the gateway throttle and the traffic before raising the cap.
2. P01 (the gateway route `POST /api/v1/public/events`, auth none, throttle burst 10 / rate 5) has to be applied before installs can reach the ingest. Today `ANY /{proxy+}` puts the console JWT on it. The admin read is already covered by `ANY /api/v1/admin/{proxy+}`.
3. The privacy review (A02) and the App Privacy answers should match before the mobile remote flag `features.anonFunnel.enabled` is turned on.

## Deferred / decisions

- The live deck slugs are a constant (`AnonFunnel.LiveDeckSlugs`, matching mobile `GOAL_CHOICES`) rather than a database lookup, so the public route only touches the database for the insert. A new live deck means updating this list.
- A valid `deckSlug` on an event that carries no deck (for example `first_open`) is accepted, but stored as null.
- `eventDay` earlier than `cohortDay` is not rejected; §3.2 does not list that check.
- Test installs cannot be excluded on the server (there are no ids). M01 sends only from the production channel.
