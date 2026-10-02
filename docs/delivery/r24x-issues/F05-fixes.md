# F05 — r24 review fixes: funnel server (fixes ledger)

Issue #658 · round r24x, wave s · base `delivery/r24x-s` (d1c1102). Contract R24-00 §3.1-§3.2.
Every finding was checked against the code first. Each behaviour fix has a test that fails on the base: the new
`AnonFunnelTests` were run against the base `src_C/Vpc` (with only the new internal knobs added so it compiles), and
8 failed there (daily cap, no-PG-env 503, before-043 503 on an empty batch, editor deck scoping, capped retention,
retention on every tick, retention after a failed rollup, retention's own failed step). The trace-id test failed on
the base `RouteMetrics.cs`. All pass after the change.

Commands (all green after the change):
- `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests --filter "FullyQualifiedName~Funnel|FullyQualifiedName~RouteMetrics|FullyQualifiedName~UsageAnalytics"`
- `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests` (full suite)
- `cd frontend && npx vitest run tests/docsPaths.test.ts`

### s-security-1
Status: fixed

Confirmed. The only server limit was the per-container budget (`TakeBudget`, 120 requests / 60 s per container), so
total inserts scaled with Lambda concurrency, up to 20 rows per request, with nothing bounding the table and a
400-day retention.

Fix (supervisor item 1): a global daily row cap. Every well-formed batch now counts the rows received in the last
24 hours (`received_at >= now() - interval '1 day'`, the count stops at 20001 rows so the check stays cheap on the
`received_at` index). Over `AnonFunnel.DailyRowCap` (20000) nothing is stored: `202` with `accepted: 0` and every
event of the batch in `rejected`, and one `anon_funnel_daily_cap` warn line at most once per container per hour.
The A01 notes now state that P01's gateway throttle (burst 10, rate 5) must be in place before the route is exposed,
and the privacy review mentions the cap.

Files: `src_C/Vpc/Analytics/AnonFunnel.cs`, `docs/delivery/r24-issues/A01-notes.md`,
`docs/privacy-anonymous-funnel-2026-10-02.md`.
Test: `AnonFunnelTests.Ingest_DailyCap_Over20000RowsInADay_AcceptsNothing_AndWarnsOncePerHour` (at 20000 a batch is
stored; over it 202 accepted 0 / rejected n, nothing stored, one warn line for two requests, none within the hour,
one more after an hour; rows older than 24 h do not count).

Note: the cap is a 202, not the reviewer's suggested 429, as the supervisor item specifies. A client that is
refused would retry a 429; a 202 makes the app drop the batch, which is what an overloaded ingest wants.

### s-correctness-1
Status: fixed

Confirmed. `HandleEvents` opened a connection only when `rows.Count > 0`, so `events: []` or an all-invalid batch
answered `202` before migration 043 and with no PG env.

Fix (supervisor item 2): the connection is opened and the daily-cap count (s-security-1) runs for every batch that
passed the whole-batch checks, before the row gate, so it is also the readiness probe: a missing table gives
`503 NOT_READY`, missing PG env `503 CONFIG_ERROR`, whatever the events. The migration header and the A01 notes now
say so.

Files: `src_C/Vpc/Analytics/AnonFunnel.cs`, `src_C/Vpc/Db/Migrations/043_anon_funnel_events.sql` (comment only),
`docs/delivery/r24-issues/A01-notes.md`.
Tests: `AnonFunnelTests.Ingest_BeforeMigration043_Answers503_AndTheStepStillRuns` (now also `events: []` and an
all-invalid batch), `AnonFunnelTests.Ingest_NoPgEnv_Is503ConfigError_EvenWhenNoEventIsValid`.

### s-security-2
Status: fixed

Confirmed. `DeleteExpiredAsync` ran only when `ComputeAsync` returned `Computed`, outside the rollup's transaction
(so with no statement timeout), with no row cap, and a failure was reported as an `analytics_daily` failure.

Fix (supervisor item 3): the retention is its own automation step, `anon_funnel_retention`, on every tick, before
`analytics_daily`, and `UsageAnalytics.RunIfDueAsync` no longer calls it. Each run deletes at most
`RetentionBatch` (10000) rows, oldest first (`delete … where id in (select id … order by received_at limit N)`), in
its own transaction with `set local statement_timeout` (`RetentionStatementTimeout`, 2 s). Before 043 it logs
`anon_funnel_not_migrated` and returns 0; any other failure is caught, logged on its own as
`anon_funnel_retention_failed` (with the SQL state) and rethrown, so the tick records `anon_funnel_retention` as the
failed step and the next tick retries. The tick's `Step` wrapper still skips it once the tick budget is spent.

Files: `src_C/Vpc/Analytics/AnonFunnel.cs`, `src_C/Vpc/Analytics/UsageAnalytics.cs`,
`src_C/Vpc/Automation/AutomationTick.cs`.
Tests: `AnonFunnelTests.Retention_StillRuns_WhenTheDailyRollupFails`,
`AnonFunnelTests.Retention_Failure_HitsItsStatementTimeout_IsRecordedAsItsOwnFailedStep_AndTheRollupStillComputes`,
`AnonFunnelTests.Retention_DeletesInCappedBatches`, `AnonFunnelTests.Retention_RunsInsideTheAutomationTick`.

### s-security-3
Status: fixed

Confirmed. `byDeck` was filtered by `ReadableDeckIdsAsync`, but `overall` and `weeks` counted every row, so a
deck-scoped admin could subtract their visible `byDeck` totals from `overall`.

Fix: for a caller who is not super_admin, `overall` and `weeks` count only rows with no deck or a readable deck's
slug (the same `decks`/`admin_deck_permissions` filter as `byDeck`). Rows with no deck (`first_open`, returns,
sign-up) stay visible, since they carry nothing deck-specific. A super_admin sees every row. Documented in the A01
notes.

Files: `src_C/Vpc/Analytics/AnonFunnel.cs`, `docs/delivery/r24-issues/A01-notes.md`.
Test: `AnonFunnelTests.Funnel_EditorWithOneReadableDeck_SeesThatDeckOnly_InByDeck_Overall_AndWeeks`.

### s-tests-1
Status: fixed

Confirmed: every admin-read test used a super_admin context, so `ReadableDeckIdsAsync` always returned null.

Fix: a test with an editor context (`IsSuperAdmin: false, IsAdmin: true`). It seeds `decks` rows for two live
slugs, grants `can_read` on one (and an explicit `can_read = 0` on the other), and asserts `byDeck` holds only the
readable slug. An editor with no grant gets an empty `byDeck`, and a super_admin still sees all three decks.

Files: `src_C/Tests/RecallSmith.Lambda.IntegrationTests/AnonFunnelTests.cs`.
Test: `AnonFunnelTests.Funnel_EditorWithOneReadableDeck_SeesThatDeckOnly_InByDeck_Overall_AndWeeks`.

### s-tests-2
Status: fixed

Confirmed: `select count(*) from users` = 0 is always true on this path, and nothing proved the capture held any line.

Fix: the users-count assertion is dropped (the sub-specific check stays, labelled as a smoke check). The test now
asserts `Log.IsEnabled("info")` with a clear message, so it fails rather than passing on empty logs. It also
asserts that the captured stdout holds exactly one dispatcher line for `/api/v1/public/events`, and that this line
has `"userSub":null` and `"isAdmin":false`. If `DispatchAsync` resolved the claims again, the line would carry the
sub and the test would fail.

Files: `src_C/Tests/RecallSmith.Lambda.IntegrationTests/AnonFunnelTests.cs`.
Test: `AnonFunnelTests.Ingest_IgnoresAnyBearer_CreatesNoUserRow_AndNeverLogsTheBodyOrTheSub`.

Not changed: `Console.SetOut` is process-global. The class is in the `PostgresCollection`, as before, so it does not
run in parallel with other tests in that collection. A redirect from another collection would now make the
positive control fail, not pass silently.

### s-tests-3
Status: fixed

Confirmed. The retention ran only after a computed rollup, the notes said it used "the analytics clock" (the code
uses `AnonFunnel.UtcNow`) and that a failure "follows the step's existing failure path", and no test made the
rollup or the delete fail.

Fix: the retention is its own step (see s-security-2). New tests cover a rollup that throws on every insert (a
check-constraint violation, not a missing table): `analytics_daily` is the failed step and the expired row is still
deleted, on that tick and on the next one, where the rollup backs off. Another test covers a delete that hits its
statement timeout: only `anon_funnel_retention` is failed, `anon_funnel_retention_failed` with `57014` is logged,
and the rollup still computes its 8 days. The boundary test now moves `UsageAnalytics.UtcNow` 30 days away, to prove
the delete reads `AnonFunnel.UtcNow`. The A01 notes are corrected and name `AnonFunnel.UtcNow`.

Files: `src_C/Vpc/Analytics/AnonFunnel.cs`, `src_C/Vpc/Analytics/UsageAnalytics.cs`,
`src_C/Vpc/Automation/AutomationTick.cs`, `src_C/Tests/RecallSmith.Lambda.IntegrationTests/AnonFunnelTests.cs`,
`docs/delivery/r24-issues/A01-notes.md`, `docs/privacy-anonymous-funnel-2026-10-02.md` (§5).
Tests: `AnonFunnelTests.Retention_StillRuns_WhenTheDailyRollupFails`,
`AnonFunnelTests.Retention_Failure_HitsItsStatementTimeout_IsRecordedAsItsOwnFailedStep_AndTheRollupStillComputes`,
`AnonFunnelTests.Retention_DeletesRowsReceivedMoreThan400DaysAgo_ByTheFunnelClock`.

### s-tests-4
Status: fixed

Confirmed: (a)-(e) had no assertion. The behaviour was already correct on the base, so these are coverage tests.
They pass on the base and would catch the regressions the reviewer lists.

Fix:
- (a) and (b): `Ingest_Budget_Is120RequestsPer60Seconds_Then429` sends two refused requests. It asserts both are
  429 with `Retry-After: 60`, and that the captured output holds exactly one `anon_funnel_budget` line.
- (c): `Ingest_OversizeBodies_DoNotSpendTheBudget` sends 125 oversize bodies (all 413), then a valid batch, which is
  still accepted.
- (d): the bearer test asserts that the `signup_completed` row sent with `csharp-basics` is stored with
  `deck_slug` null.
- (e): `Ingest_NoPgEnv_Is503ConfigError_EvenWhenNoEventIsValid`.

Files: `src_C/Tests/RecallSmith.Lambda.IntegrationTests/AnonFunnelTests.cs`.

## Supervisor items

1. Global daily cap: see s-security-1.
2. 503 even when every event is invalid: see s-correctness-1. With no PG env the code is `503 CONFIG_ERROR`, not
   `NOT_READY`, as the A01 notes and the finding's (e) already specify. Both are 503s, and this is the same code
   every other route returns for missing PG env.
3. The retention runs in its own try with a statement timeout, independent of the rollup: see s-security-2.
4. Privacy review §1. It now says the app sends the funnel only when it flushes, one request per batch of at most
   20 events. A flush is one request, or up to three after a long offline spell, because the queue holds 50. On
   trace headers, the plain claim "the request carries no trace id or Sentry header" is **not true of the current
   app**: `mobile/App.tsx` posts through `apiJson`, which adds `x-dc-trace-id` (the Sentry trace id in X-Ray form,
   `toDcTraceHeader`) whenever Sentry is active. Sentry's `tracePropagationTargets` also cover the API origin. Worse,
   the server logged that header as `upstreamTraceId` on the core-vpc metric line for every route, the ingest
   included, which would let a funnel batch be joined to a Sentry event.
   - Fixed on the server (in scope): `RouteMetrics.Emit` drops `upstreamTraceId` for `/api/v1/public/events`.
     Test: `AnonFunnelTests.Ingest_NeverLogsTheClientTraceId_WhichIsTheSentryTraceId` fails on the base and passes
     after. It has a positive control (the route's metric line is captured), and another route still carries the
     field.
   - §1 now states that the server reads and logs no trace id or Sentry header from this request. It also states
     that the app still attaches them today, as a mobile follow-up outside this server-only round.
