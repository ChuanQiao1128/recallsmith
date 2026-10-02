# S01 — Server: stop the analytics outbox, remove export/import/content-intelligence routes, migration 045

Round r26, wave s (issue #712). Contract: `R26-00-contracts.md` §0 and §1 (retire Snowflake and the analytics outbox).

## What changed

| File | Change |
| --- | --- |
| `src_C/Vpc/Runtime/ProgressEvents.cs` | The sync ingest no longer inserts into `analytics_event_outbox`. The `outbox` CTE is gone, along with the code that only fed it: the `card_format` tag and its 42703 fallback for databases without migration 019, the `user_id_hash` / `client_features` / `update_id` parameters, `HashUserId`, `ReadClientFeatures` and `ReadUpdateId`. The ingest is still one statement (`ensure_user`, `ins`, `agg`, `last_row`, `merged`, `upsert`). `on conflict (event_id) do nothing` idempotency and the progress upsert are unchanged. |
| `src_C/Vpc/Analytics/OutboxPublisher.cs` | Deleted (outbox → S3 export, `ANALYTICS_S3_BUCKET` / `ANALYTICS_S3_PREFIX` reads, the `OutboxPending` gauge). |
| `src_C/Vpc/Analytics/ContentIntelligenceSnapshotImport.cs` | Deleted (Snowflake snapshot import from S3). |
| `src_C/Vpc/Authoring/ContentIntelligence.cs` | Deleted (`GET /api/v1/authoring/content-intelligence`). |
| `src_C/Vpc/Db/ContentIntelligenceDemo.cs`, `src_C/Vpc/Db/Scripts/{seed,cleanup}_content_intelligence_demo.sql` | Deleted (demo seed route and its scripts). The `Db\Scripts\*.sql` copy item is removed from `RecallSmith.Lambda.Vpc.csproj` because the folder is now empty. |
| `src_C/Vpc/VpcFunction.cs` | The four route registrations are removed. |
| `src_C/Vpc/SnapStartHooks.cs` | The `Reset()` calls for the two deleted S3 clients are removed. |
| `src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs` | Allow-list entries removed for the four routes and for the `outbox/publish` and `content-intelligence/import` internal actions. Those paths now report as `unmatched`. |
| `src_C/Vpc/Db/DbSafety.cs` | Comments only: there are two destructive routes now, not three. |
| `src_C/Vpc/Runtime/AccountDeletion.cs` | Outbox rows are deleted only while the table exists (`to_regclass` check, the same pattern as `card_reports`). After migration 045 the step counts 0 and does not raise 42P01, so the transaction is not aborted. R26X F01: the delete itself runs inside a savepoint and treats 42P01 as 0 rows, so 045 committing between the check and the delete no longer aborts the deletion. |
| `src_C/Vpc/Db/Migrations/045_retire_content_intelligence.sql` | New migration. `set local lock_timeout = '5s'`, then `drop table if exists` on `analytics_event_outbox` (009), `content_intelligence_card_snapshot` and `content_intelligence_import_runs` (010). No foreign key points at these tables, so the drops cascade nothing. It is idempotent. R26X F01: its header carries `-- destructive: true`, so Migrate never applies it without `confirmDestructive=45` (see Owner steps). |
| `src_C/Vpc/Db/Migrate.cs` (R26X F01) | A migration whose leading comment block holds `-- destructive: true` is destructive. `POST /api/v1/admin/db/migrate` applies pending migrations in order and stops before the first pending destructive one unless the query has `confirmDestructive=<its version>` (exact match with the `version` dryRun prints, e.g. `45`). When it stops it returns 200 with what it did apply, `blockedBy: {version, name, file}` and a `message`; nothing after the blocked migration runs, and one confirmation never unlocks another destructive version. `dryRun=true` marks each pending migration `destructive: true/false`. The migration lock, the audit entries and the vector step are unchanged. |
| `src_C/Shared/RecallSmith.Lambda.Common/LambdaRequest.cs` (R26X F01) | A query string inside `rawPath` (how `scripts/invoke-as-admin.sh` sends `/api/v1/admin/db/migrate?confirmDestructive=45`) is split off into `Query`; `queryStringParameters` wins on a name clash. API Gateway never puts `?` in `rawPath`, so real traffic is unchanged. Before this the owner command would have answered 404. |

## Surface shipped

Removed (each now returns 404 `Route not found`, and its metric label is `unmatched`):
- `POST /api/v1/admin/analytics/outbox/publish`
- `POST /api/v1/admin/analytics/content-intelligence/import`
- `POST /api/v1/admin/db/content-intelligence-demo`
- `GET /api/v1/authoring/content-intelligence`
- Internal metric labels `internal:outbox/publish` and `internal:content-intelligence/import`

Unchanged:
- `POST /api/progress/events` keeps its request and response shape. `clientFeatures` and `updateId` (still sent by the frozen mobile client) are accepted and ignored.
- `DELETE /api/v1/me` and `/api/v1/user/me` still return 204, before and after 045. Both routes are tested through `VpcFunction.Handler` on a 044 database (R26X F01) and on the post-045 shared database (`AccountDeletionTests`).

The code works before and after migration 045. Nothing left in the code reads or writes the content-intelligence tables. The only remaining reference to the outbox is in the account deletion, and it is guarded.

## How it is tested

The new `src_C/Tests/RecallSmith.Lambda.IntegrationTests/AnalyticsOutboxRetiredTests.cs` uses real Postgres via Testcontainers. Every case except the pre-045 deletion failed on the base. The pre-045 deletion passed on the base, as expected, because that behaviour is unchanged.
- `Migration045_...AndIsIdempotent`: on a scratch database frozen at 044, the three tables exist. The test applies 045 twice inside a transaction; the tables are then gone and `user_progress*` is untouched.
- `SharedFixture_HasRunMigration045`: the shared database (all migrations applied) has none of the three tables.
- `Ingest_BeforeMigration045_WritesNoOutboxRow_AndKeepsIdempotency`: on the 044 database, an ingest plus a replay leaves 0 outbox rows, 2 events, review_count 2 and 2 duplicates on the replay.
- `Ingest_AfterMigration045_StillSucceeds`: an ingest works with the table absent.
- `RetiredRoutes_Are404_ForASuperAdmin`: all four routes return 404 through `VpcFunction.Handler`.
- `RetiredRoutes_HaveNoMetricLabel`: all four routes and both internal actions map to `unmatched`.
- `AccountDeletion_BeforeMigration045_StillDeletesTheCallersOutboxRows`: on the 044 database, the caller's outbox row is deleted and another user's row stays.
- `AccountDeletion_AfterMigration045_TreatsTheMissingOutboxAsZeroRows`: `OutboxRows == 0` and the user is deleted.
- R26X F01 additions: `AccountDeletion_OutboxDroppedAfterTheCheck_CountsZero_AndTheDeletionStillCommits` (the outbox delete on a database without the table returns 0 and the same transaction still commits) and `DeleteMeRoute_BeforeMigration045_Is204_AndDeletesTheCallersOutboxRows` (both routes through `VpcFunction.Handler` on the 044 database: 204, the caller's outbox row and user row gone, another user's kept). The route case passes on the base too: it closes a coverage gap, the behaviour did not change. `MigrateDestructiveGateTests` covers the migrate gate (see `docs/delivery/r26x-issues/F01-fixes.md`).

Updated tests:
- `ProgressEventsSingleStatementTests`: F5 asserts that the statement no longer mentions `analytics_event_outbox`. The envelope-marker case asserts that neither marker is bound and that the ingest is still one statement. The outbox count is dropped from the race test.
- `ProgressEventsIntegrationTests`: the outbox count is dropped.
- `AccountDeletionTests`: no outbox seed or count, because the shared database is post-045. B keeps 12 rows.
- `LogShapeTests`: 4 internal actions. The gauge example name is now `WebhookEnqueueFailures`.
- `DestructiveDbRoutesTests`: the demo-route case is removed with the route.

Deleted together with the code they tested:
- `ContentIntelligenceFocusPracticeTests`, `ContentIntelligenceFreshnessTests`, `ContentIntelligenceMcqTests` (the CI route and the import).
- `ProgressEventsCardFormatTests`, `ProgressEventsClientFeaturesTests` (outbox payload keys and the card-format fallback).

Gate: `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests` (full suite).

## Owner steps

1. Deploy the code first. Until 045 runs, the code keeps working with the tables present. A plain `POST /api/v1/admin/db/migrate` (the supervisor's call for additive migrations, now or in a later round) applies everything before 045 and stops there with `blockedBy` 045; it never runs 045.
2. The supervisor smoke-tests the deployed R26 core-vpc build in prod: one signed-in sync push and one account deletion of a test account.
3. Only after that, the owner runs migration 045: `MIGRATE_SECRET=… scripts/invoke-as-admin.sh core-vpc:prod POST '/api/v1/admin/db/migrate?confirmDestructive=45'` (check first with `?dryRun=true`: 045 is listed with `destructive: true`). It permanently deletes the outbox and the content-intelligence snapshot rows. The supervisor never passes `confirmDestructive`.
4. Roll forward only once 045 has run: no core-vpc version older than R26 may become the prod alias target again. Those builds still insert into `analytics_event_outbox` on every sync push and delete from it on account deletion, so `POST /api/progress/events` and `DELETE /api/v1/me` would fail with 42P01 (500). A regression after 045 is fixed with a new build, not by moving the alias back past R26. There is no recreate script on purpose.
5. S3, checked by the supervisor on 2026-10-02 with `list-object-versions`: `s3://core-vpc/analytics/raw/` holds 0 object versions (the owner deleted the only test export earlier that day), so no exported outbox row with a user hash or device id is left behind account deletion. What remains under `analytics/` is `analytics/marts/content_intelligence/card_snapshot_30d/latest.json.gz` (30 aggregate rows for the demo deck `content-intelligence-demo`, no user identifiers) plus three zero-byte folder keys; the owner deletes them.
6. Infra (P03) removes the outbox alarm and dashboard widget, the Snowflake IAM role and any scheduler that still calls the removed routes. Until then, such a call returns 404 and is labelled `unmatched`.

## Deferred / not in scope

- The console page and its API client: C01. Infra, alarms, IAM and the `ANALYTICS_S3_*` Lambda env wiring in Terraform: P03. The `snowflake/` folder and docs: D01.
- The `AWSSDK.S3` package reference in the Vpc project stays, because `Publish`, `AdminManifest` and `PremiumDeckUrl` still use S3.
- Historical migrations 009, 010, 016 and 024 still mention the dropped tables. They are already applied and must not be edited.
