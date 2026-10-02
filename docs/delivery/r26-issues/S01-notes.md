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
| `src_C/Vpc/Runtime/AccountDeletion.cs` | Outbox rows are deleted only while the table exists (`to_regclass` check, the same pattern as `card_reports`). After migration 045 the step counts 0 and does not raise 42P01, so the transaction is not aborted. |
| `src_C/Vpc/Db/Migrations/045_retire_content_intelligence.sql` | New migration. `set local lock_timeout = '5s'`, then `drop table if exists` on `analytics_event_outbox` (009), `content_intelligence_card_snapshot` and `content_intelligence_import_runs` (010). No foreign key points at these tables, so the drops cascade nothing. It is idempotent. |

## Surface shipped

Removed (each now returns 404 `Route not found`, and its metric label is `unmatched`):
- `POST /api/v1/admin/analytics/outbox/publish`
- `POST /api/v1/admin/analytics/content-intelligence/import`
- `POST /api/v1/admin/db/content-intelligence-demo`
- `GET /api/v1/authoring/content-intelligence`
- Internal metric labels `internal:outbox/publish` and `internal:content-intelligence/import`

Unchanged:
- `POST /api/progress/events` keeps its request and response shape. `clientFeatures` and `updateId` (still sent by the frozen mobile client) are accepted and ignored.
- `DELETE /api/v1/me` and `/api/v1/user/me` still return 204, before and after 045.

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

1. Deploy the code first. Until 045 runs, the code keeps working with the tables present.
2. Then run migration 045 (`POST /api/v1/admin/db/migrate`). It permanently deletes the outbox and the content-intelligence snapshot rows. The supervisor never runs it.
3. Infra (P03) removes the outbox alarm and dashboard widget, the Snowflake IAM role and any scheduler that still calls the removed routes. Until then, such a call returns 404 and is labelled `unmatched`.

## Deferred / not in scope

- The console page and its API client: C01. Infra, alarms, IAM and the `ANALYTICS_S3_*` Lambda env wiring in Terraform: P03. The `snowflake/` folder and docs: D01.
- The `AWSSDK.S3` package reference in the Vpc project stays, because `Publish`, `AdminManifest` and `PremiumDeckUrl` still use S3.
- Historical migrations 009, 010, 016 and 024 still mention the dropped tables. They are already applied and must not be edited.
