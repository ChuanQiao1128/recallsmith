# E12 — EventBridge Scheduler, internal invoke contract, migrations gate (`scheduler-and-migrations`)

Give the three chores that today depend on a human (outbox publish, Content Intelligence snapshot import, orphan-publish reaping + manifest fallback) an EventBridge Scheduler schedule each, invoking `core-vpc:prod` **directly** (Scheduler → IAM role → `lambda:InvokeFunction` on the alias; never through API Gateway and its 30 s cap) with a small internal event shape that `VpcFunction.Handler` recognises before it builds an HTTP request. Put migrations on the same path (`db/migrate`, `args.dryRun`) so E11's CD can run them by version number before the alias moves, give the advisory lock a `lock_timeout = '5s'` that turns a second concurrent migration into `409 MIGRATION_IN_PROGRESS`, and replace the two "code ahead of schema" `42703` fallbacks with one explicit schema-version gate: `SchemaVersion.Required = 21`, read from `schema_migrations`, `503 SERVER_NOT_READY_SCHEMA` on the write routes and a thrown `SchemaBehindException` in the worker while the database is behind, plus `health/deep` for smoke. Infra: schedule group, role, three schedules, an async-invoke config with an on-failure destination to `developercards-alerts`, `sns:Publish` on the core-vpc role, alarm 13. Roots `src_C` + `infra`; three new test classes; three bounded test edits; no mobile, no frontend, no `.github`. Worker timeout 90 min.

## Context

Base `delivery/r16-e-prod` (== `main@4b07f19`). Every base-tree `file:line` below was read on that tree on 2026-09-22; every AWS fact the same day with `AWS_PROFILE=dev` (account `622994489535`, `ap-southeast-2`), describe/get/list only, no secret value printed. Files that E01–E10 create (`infra/**`, `PublishReaper.cs`, `ManifestBuilder.cs`, the post-E04 `Log.Event`/`EmitGauge`/`PublishBatchAsync`, E07's `Res.ServiceUnavailable`, E03's `Helpers.ErrorEnvelope`) do not exist on base — for those, anchor by resource address / method name, never by a line number; you rebase on the integration branch where they are all merged (E00 §4: E01 → … → E10 → **E12** → E11).

**How the function is entered today**
- `src_C/Vpc/VpcFunction.cs:32` `Handler(JsonElement evt)` → `:34` `new LambdaRequest(evt)` → `:46` `RouteMetrics.MeasureAsync(ServiceName, req, () => DispatchAsync(req, res))` → `:49` `DispatchAsync`. `LambdaRequest` (`src_C/Shared/RecallSmith.Lambda.Common/LambdaRequest.cs:29-47`) reads `rawPath`, `requestContext.http.method` (default `GET`), `requestContext.requestId`; a direct invoke with no `rawPath` therefore lands on `/` `GET` and gets `404 NOT_FOUND` (`:315`). Nothing distinguishes API Gateway from a direct invoke. `DispatchAsync` computes the auth context `:64-79`, answers `OPTIONS` `:81-84`, then `try { var p = req.Path.TrimEnd('/'); … }` `:101-103` with the `/health` check `:105`, `db/migrate` `:123-126`, manifest rebuild `:207-210`, the two `/api/internal/*` stubs `:306-313`, `404` `:315`, catch-all → `res.Error500(ex)` `:317-321`. E07 inserts its body-cap line as the first statement inside that `try`; E03 adds two routes after `:210`; E06 one after `:126`; E14 later changes only the `Handler` signature (E00 §2.16).
- `RouteMetrics.MeasureAsync` (`RouteMetrics.cs:338-372`) emits `Errors=1` and **rethrows** a thrown dispatch (`:371`), so an exception out of an internal action reaches the Lambda runtime as an invocation error — which is what a scheduler retry and an on-failure destination need. A returned 5xx `APIGatewayProxyResponse` does **not** fail an async invoke. `RouteFor` (`:198-218`) maps `/internal/<action>` → `internal:<action>` after E04.
- `Auth.VerifyInternalSignature` (`Auth.cs:312-346`) is HMAC over `"{ts}.{body}"` with a 5-minute skew window. EventBridge Scheduler's `Input` is static JSON plus `<aws.scheduler.*>` context attributes — it cannot compute a fresh HMAC, so the internal path's trust boundary is IAM (`lambda:InvokeFunction` on `core-vpc:prod`, granted to one role), not a header. The two HMAC stubs stay as they are.

**Migrations today**
- `src_C/Vpc/Db/Migrate.cs`: `LoadMigrations()` `:18-50` (numeric-prefix files under `Db/Migrations`, copied to output), `EnsureMigrationsTable` `:52-63`, `ApplyOne` `:73-94` (one transaction per file, `insert into schema_migrations(version, name) … on conflict (version) do nothing` `:84`), `WithMigrationLock` `:96-108` — `const int lockId = 77889911` `:98`, `select pg_advisory_lock($1)` `:99` with **no `lock_timeout`** (a second caller waits forever, or until API Gateway's 30 s cut it off), unlock in `finally` `:106`. `HandleDbMigrate` `:129-191`: `RequireSuperAdmin` `:134`, the `x-migrate-secret` compare `:137-143` (E06 makes it `Secrets.FixedTimeEquals`), `CONFIG_ERROR` `:145-149`, `MIGRATIONS_EMPTY` `:151-155`, `dryRun` from the query `:157`, the lambda `:159-188` returning either `{dryRun:true, available, pending}` or `{dryRun:false, applied, appliedCount, latestAvailable}`. `src_C/Vpc/Db/Migrations/` holds `001`–`020` on base; E03 adds `021_decks_live_build_id.sql`, so **21** is the highest version on the integration branch. `001_init.sql:8-12` creates `schema_migrations(version int primary key, name text, applied_at)`.
- The review (`docs/backend-architecture-review-2026-09-22.md` §2.4.3 `:134`) calls the two `42703` catch-and-retry blocks "a patch for code shipped before its migration" and asks for the reverse order (CD migrates before the alias moves) plus a startup comparison of `max(version) from schema_migrations` against a code constant, with an Error log, a metric and `503 SERVER_NOT_READY_<feature>` on the affected routes. The two blocks: `src_C/Vpc/Runtime/ProgressEvents.cs:608-637` (`BuildIngestSql(withCardFormat: true)` `:622`, `catch … "42703"` `:624`, the `ingest_card_format_fallback` warn `:629-635`, the legacy re-run `:636`; the builder `BuildIngestSql(bool withCardFormat)` `:377-385` with its comment `:373-376`) and `src_C/Worker/Services/PublishJobProcessor.cs:185-209` (`CardsSql` `:134-150` 11 columns, `CardsSqlTopicOnly` `:152-167`, `CardsSqlLegacy` `:169-183`, nested `42703` catches `:199-209`; the row mapping `:211-224` stays). `ProcessAsync` `:31-81` acquires first (`TryAcquireJobAsync` `:34`) and opens the database only inside `LoadDeckDataAsync` `:91-132`; E03 rewrites `ProcessAsync` (receive count, `JobNotAcquiredException`) and makes every non-`BusinessException` a batch-item failure that SQS redelivers.
- **Tests that pin the fallbacks**: `src_C/Tests/RecallSmith.Lambda.IntegrationTests/PublishJobProcessorSchemaTests.cs:42-63` (`maxVersion: 17`) and `:65-85` (`maxVersion: 18`) assert `LoadCardsAsync` tolerates the old shapes; `ProgressEventsCardFormatTests.cs:246-316` (`WithoutTheMcqColumn_IngestFallsBackToTheLegacyStatement`) swaps `PGDATABASE` to a scratch database at `maxVersion: 18` (`:256-270`), posts through `LambdaHost` (which asserts 200) and expects the legacy statement to run; `:307-315` then proves the env swap was undone. `ContentIntelligenceMcqTests.cs:203-215` and `Migration015BackfillTests.cs:33,68` also build partial-schema scratch databases but call code E12 does not touch.
- **The fixture never records versions.** `IntegrationTestBase.cs:136-155` `ApplyMigrationsAsync` executes each file's SQL (`:148-154`) and never inserts into `schema_migrations` (only `Migrate.ApplyOne` does, `:81-85`). `PostgresFixture.InitializeAsync` `:45-73` applies everything and sets `PG*`/`PG_MAX=8`; `CreateScratchDatabaseAsync` `:118-128`. `LambdaHost` `:172-247` calls route handlers directly (never `VpcFunction.Handler`) and asserts `StatusCode == 200` (`:241-243`); its event shape `:209-221` and `AuthContext` `:225-232` are the template for your own direct calls. Tests that do go through `new VpcFunction().Handler(evt)`: `AuthBearerTests.cs:68,188,225`, `CorsAllowlistTests.cs:242,257`, `CardsPageTests.cs:523`.
- `Warmup.WarmDatabaseAsync(CancellationToken)` `src_C/Vpc/Warmup.cs:290-387` opens the pooled connection, runs `select 1` `:367-370`, logs `step:"db-warmup"` `:389-…`, never throws; `RunOnce` `:141-145` runs it from the constructor once per container. `DbWarmupTests.WarmDatabase_DoesNotSpendOneOfTheTenAutoPrepareSlots` (`:204-235`) asserts zero prepared statements after the probe — a single extra statement is fine (Npgsql auto-prepares after 5 uses).

**The three chores today**
- Outbox: `src_C/Vpc/Analytics/OutboxPublisher.cs` — `S3()` `:19-25` (private, lazy), `NormalizePrefix` `:35-39`, `AnalyticsBucket()` `:41-45` (`ANALYTICS_S3_BUCKET ?? CONTENT_BUCKET`, both private), `ParseLimit` clamp 1..5000 `:53-57`, handler `HandlePublishOutbox` `:180-242` (super_admin, POST, one batch). After E04 the batch core is `public static Task<OutboxPublishResult> PublishBatchAsync(NpgsqlConnection conn, IAmazonS3 s3, string bucket, string prefix, int limit)` (`OutboxPublishResult(int Claimed, int Published, int Retried, int PendingAfter)`) and the handler ends with `RouteMetrics.EmitGauge("OutboxPending", result.PendingAfter)`. Drained exactly once in the product's life (review §2.2.11 `:115`).
- Snapshot import: `src_C/Vpc/Analytics/ContentIntelligenceSnapshotImport.cs` — `DefaultBucket()` `:41-47`, `DefaultKey()` `:49-53`, `ResolveBucket/ResolveKey(req)` `:55-63`, `CreateImportRunAsync(conn, bucket, key, etag)` `:65-84`, `CompleteImportRunAsync` `:86-104`, `ImportSnapshotAsync(conn, bucket, key)` `:233-284`, handler `HandleImportSnapshot` `:286-347`: HEAD for the etag `:307-320` (best-effort, **never compared**), run row `:322`, import `:323`, complete `:324`, failure → `IMPORT_FAILED` 400 `:335-346`. Table `content_intelligence_import_runs` (`010_content_intelligence_snapshot.sql:69-81`) has `s3_bucket, s3_key, s3_etag, status`. No export task exists yet (E13 writes it), so the object is absent today.
- Reaper + manifest: E03 ships `src_C/Vpc/Authoring/PublishReaper.cs` `public static Task<ReapResult> ReapOrphansAsync(NpgsqlConnection conn)` (`ReapResult(int Pending, int Processing, string[] JobIds)`, "keep it free of `Res`" — E03 Changes) and `src_C/Shared/RecallSmith.Lambda.Db/ManifestBuilder.cs` with `RebuildAsync(conn, s3, bucket, contentPrefix, premiumPrefix, nowMs = null)`, `public static IAmazonS3 S3()`, `NormalizePrefix(string? raw, string fallback)`, `ManifestBuildResult(DeckCount, PatchEdgeCount, Key, ETag, GeneratedAtMs)`; the worker rebuilds after each success and debounces on `HeadObject` (E03 Changes 18). Env names the manifest code reads: `CONTENT_BUCKET`, `CONTENT_PREFIX` (default `content`), `PREMIUM_PREFIX` (default `premium`) (`ManifestRebuild.cs:24-36` on base).
- `Res` (`src_C/Shared/RecallSmith.Lambda.Common/Res.cs`): ctor `(string? traceId, string? requestOrigin = null)` `:22`, `Raw` `:139-143`, `Ok/BadRequest/…/NotImplemented/Error500` `:159-201`; no 409 and no 503 helper on base. E07 adds `ServiceUnavailable(string code, string? message, int retryAfterSec)` (header `retry-after`); E03 adds `Vpc.Authoring.Helpers.ErrorEnvelope(Res res, int statusCode, string code, string message)` (the envelope through `res.Raw`, used for its own `409 PUBLISH_IN_PROGRESS`).

**AWS facts (2026-09-22)**
- `aws lambda get-function-event-invoke-config --function-name core-vpc --qualifier prod` → `ResourceNotFoundException` ("doesn't have an EventInvokeConfig"); `list-function-event-invoke-configs` → `[]`. `get-alias core-vpc prod` → version **48**; `get-function-configuration core-vpc:prod` → `Timeout 90`, `MemorySize 128`, `dotnet8`.
- `aws scheduler list-schedule-groups` → only `default`; `list-schedules` → only `RunNewsPipelineDaily` (newsapp, `DISABLED`, group `default`, its own role `Amazon_EventBridge_Scheduler_LAMBDA_c31ff4e06f`) — not this product, never touched. `aws events list-rules` → none (review `:115`). No role named `developercards-*-scheduler-role`, no alarm prefixed `developercards-prod` on base (E04 creates the twelve).
- `terraform console` (1.16.3): `jsonencode({ a = "<aws.scheduler.scheduled-time>" })` → `"{\"a\":\"\\u003caws.scheduler.scheduled-time\\u003e\"}"` — **`jsonencode` escapes `<`/`>` as `<`/`>`**, and Scheduler substitutes context attributes only on the literal text `<aws.scheduler.…>`. A scratch root with `aws_scheduler_schedule_group`, `aws_iam_role` + inline policy, three `aws_scheduler_schedule` (`for_each`, `flexible_time_window { mode = "OFF" }`, `target { retry_policy {…} }`, `input = replace(replace(jsonencode(…), "\\u003c", "<"), "\\u003e", ">")`), `aws_lambda_function_event_invoke_config` (`dynamic "destination_config"`), and an `AWS/Scheduler` `TargetErrorCount` alarm passed `validate`, `fmt -check` and a read-only `plan` on hashicorp/aws 6.66.0 (8 creates; every schedule's `target[0].input` parsed as JSON and carried the three placeholders literally; the invoke config's `destination_config` was `[]` when the variable was null). Two modules referencing each other's outputs (`api` ← `observability.alerts_topic_arn`, `observability` ← `api.schedule_group_name`) plan without a cycle: Terraform's graph is resource-level, and neither the topic nor the schedule group depends on the other module.

**What E00 decided (binding; `docs/delivery/r16-issues/E00-contracts.md`)**: §0 (`:9-36`) the WORKER SAFETY RULE, no renames, no `profile`, secrets policy, the two unspellable env-var names, the `infra` root gate; §1.1 rows `api/scheduler.tf`, `api/core_vpc.tf`, `api/variables.tf`+`outputs.tf`, `observability/alarms.tf`+`variables.tf`, `envs/prod/main.tf`, `envs/staging/main.tf`, `infra/README.md` §6 (`:45-69`); §1.2 rows `VpcFunction.cs`, `PublishJobProcessor.cs`, `ContentIntelligenceSnapshotImport.cs`, `Migrate.cs`, `ProgressEvents.cs`, `InternalEvents.cs`, `SchemaVersion.cs` and the test paragraph (`:71-108`); §2.1.2–2.1.4 (`:170-211`) address naming and curation; §2.3 (`:223-251`) the E03 pieces reused; §2.4.6–2.4.7 (`:278-279`) `Log.Event`, `EmitGauge`, `PublishBatchAsync`; §2.10 (`:351-357`) staging; **§2.11 (`:359-379`) this issue's contract — event shape, recognition rule, `InternalEvents` signatures verbatim, the six actions, failure = throw, the schema gate, `scheduler.tf`, the invoke config, alarm 13**; §2.12 (`:381-385`) what E11 will call; §2.16 (`:411-415`) the `VpcFunction.cs` regions; §3.1 (`:419-430`) the allow file and `check-plan.py`; §3.3 (`:436-438`) the property-test rule (`TryParse`: any HTTP-shaped event → false, ≥ 50 generated cases); §4 (`:446-468`) E12 runs after E10 and before E11; §5 (`:470-482`) verify conventions; §6 #5 (thirteenth alarm), #6 (Text log format), #17 (migrate by version before the alias moves), #20 (`imports.tf` stays), #21 (`fmt -recursive infra`).

**Gaps and contradictions E00 leaves open — resolved here, binding for this issue:**

1. **`jsonencode` would break the placeholders.** §2.11 says `input = jsonencode({...with <aws.scheduler.*> placeholders})`; verified above, that stores `<aws.scheduler.scheduled-time>` and no substitution ever happens. Decision: `local.schedule_inputs` = `replace(replace(jsonencode(merge(input, context)), "\\u003c", "<"), "\\u003e", ">")`; the verify parses every planned `input` and requires the three placeholders literally and no `<`.
2. **The test fixture leaves `schema_migrations` empty**, so the gate would answer 503 to every write-route test. Decision: `IntegrationTestBase.ApplyMigrationsAsync` records each applied file exactly as `Migrate.ApplyOne` does (Changes 10, ≤ 8 added lines, 0 removed, in `:148-154` — disjoint from E14's `LambdaHost` region `:172-247`). §1.2 names only E14 for this file; the supervisor appends this exception to E00 §6.
3. **`ProgressEventsCardFormatTests.cs:246-316` pins the fallback §2.11 deletes.** Decision: that one case becomes "behind schema ⇒ 503 `SERVER_NOT_READY_SCHEMA`, nothing written" (Changes 12); every other case in the file and every other existing test class is byte-identical. §1.2's bounded-edit list gains this file (the supervisor records it in E00 §6).
4. **`"also"` has no field in the record.** §2.11's `InternalEvent(string Action, JsonElement Args, string? ScheduledTime, string? ScheduleArn, string TraceId)` is kept verbatim (positional) and gains an init-only property `IReadOnlyList<string> Also` (default `[]`). `DispatchAsync` runs `Action`, then every `Also` entry in order, and returns the primary result's keys at `data` top level plus `data.also = { "<action>": result }` — so E11's smoke reads `data.ok` / `data.schemaVersion` / `data.required` of `health/deep` unchanged (E11 brief `:212`).
5. **There is no `Res.Conflict`.** `Res.cs` is E07's file (E14 adds only an `Error500` head). Decision: the HTTP `409 MIGRATION_IN_PROGRESS` goes through E03's `Helpers.ErrorEnvelope(res, 409, …)`; `Res.cs` and `Helpers.cs` are zero-diff in this issue.
6. **`Warmup.cs` is absent from §1.2 but §2.11 says "Warmup reads it once per container".** Decision: one call, `await SchemaVersion.ProbeAsync(conn)`, directly after the `select 1` probe (`:367-370`), inside the existing `try`; `ProbeAsync` never throws (Changes 9).
7. **"every authoring write route answers 503" without editing every authoring file.** Decision: one gate in `DispatchAsync`, inserted directly after `var p = req.Path.TrimEnd('/');` (`:103`, i.e. after E07's body-cap statement and before the `/health` check `:105`), keyed by the pure `SchemaVersion.GatesRoute(method, path)`: every non-GET/HEAD/OPTIONS request under `/api/v1/authoring/`, `/api/v1/admin/` (except `/api/v1/admin/db/`), `/api/v1/sync/`, `/api/v1/draw-state/`. It runs before route auth, so an unauthenticated write to a behind database gets 503 instead of 401 — accepted (the body says only that the schema is behind). `ProgressEvents` additionally gates inside its own handler (where the fallback was), because tests and `LambdaHost` call handlers directly. `/health`, the webhooks, `/api/v1/me`, `/api/v1/user/bootstrap`, the premium-url routes, `/api/internal/*`, `db/migrate` and `health/deep` are never gated. Nothing at `:105-313` is reordered.
8. **`outbox/publish` needs `S3()`, `AnalyticsBucket()` and `NormalizePrefix()`, all private.** Decision: `OutboxPublisher` gains `PublishLoopAsync(conn, limit, maxRuns = 20, budget = 60 s)` (add-only, Changes 8) and the action calls it; E13 later inserts `DeleteSentOlderThanAsync` between the loop and the gauge inside `InternalEvents` — the slot is marked with a comment. A 60 s budget is added to `runs < 20` because 20 × (claim + 5000-row JSONL + `PutObject` + mark) can exceed the function's 90 s; the next tick continues.
9. **The on-failure destination needs `sns:Publish` on the execution role** (Lambda publishes the failure record as the function's role). E05's scoped `aws_iam_role_policy.core_vpc` has no SNS statement. Decision: identity gains `variable "alerts_topic_arn" { type = string, default = "" }` and the policy a `SnsAlerts` statement only when non-empty (Changes 20); the prod root passes the ARN **as a string built from `var.region`/`var.account_id`** (`identity` takes only strings, E00 §2.1.1), never `module.observability.alerts_topic_arn`. Plan: one `update` on `module.identity.aws_iam_role_policy.core_vpc`, keys ⊆ `{policy}`.
10. **Alarm 13 is prod-only and needs no guard.** E10 (R1) does not instantiate `observability` for staging, and E04's twelve alarms are plain resources `aws_cloudwatch_metric_alarm.<name>` with `alarm_name = "developercards-${var.env}-…"`. Decision: `aws_cloudwatch_metric_alarm.scheduler_errors` follows that pattern exactly; the staging root needs **no edit** — the schedules, role and invoke config ride inside `modules/api`, which staging already instantiates (E10 Changes 6g), and `async_failure_destination_arn` defaults to `null` (no destination, no SNS on staging).
11. **How the worker plans.** E00 §5 (empty local state) works for E01 but from E02 on every earlier issue's new resources show as `create` in an empty state; the later verifies (E08, E13) plan against the real backend read-only. Decision, prod: `terraform init -reconfigure` + `plan -lock=false` in a **copy** of `infra/` under a mktemp dir (`-lock=false` ⇒ no `.tflock` object is ever written; the worktree's `.terraform` stays the driver's `-backend=false` one), variables from `prod.auto.tfvars.example` minus `alert_email`/`snowflake_external_id`, which two read-only lookups supply (`sns list-subscriptions-by-topic`, `iam get-role`; values never printed), then `check-plan.py --allow E12.plan-allow.json` strict — the same file the supervisor uses. Staging: an empty local state through E01's gitignored `backend_override.tf` (E00 §6 #25 mode (a) — `init -backend=false` cannot serve `plan`; the verify writes the override into its scratch copy of the staging root, runs `terraform init -input=false -reconfigure`, plans with `staging.auto.tfvars.example`): every effective action must be `create` and the seven E12 addresses present; the supervisor checks `E12.staging.plan-allow.json` strictly against the real staging state.
12. **A missing snapshot object is a skip, not a failure.** Until E13's export task runs, `latest.json.gz` does not exist; a nightly throw would page the owner every night for nothing. Decision: HEAD → 404 ⇒ `{ skipped: true, reason: "object_missing" }` with a `Log.Event("warn", …)`; every other error throws.
13. **`lock_timeout` covers the whole `WithMigrationLock` body** (advisory lock **and** the migration DDL) and is `reset` in `finally` so the pooled session (PG_MAX=1) returns clean. `55P03` while acquiring the advisory lock ⇒ `MigrationInProgressException` ⇒ HTTP 409 / internal throw; `55P03` inside a migration file rolls that file back (own transaction, `ApplyOne`) and propagates as today (500 / internal throw) — a DDL that cannot get its lock in 5 s must not block traffic.
14. **The version cache is per database.** `SchemaVersion` caches "current" per `"{Host}:{Port}/{Database}"`; a behind verdict is re-read on every call (cheap, only while behind); `Reset()` exists for tests. The gate opens a pooled connection per gated request only until the first OK (afterwards `EnsureAsync` returns without I/O). The worker gates twice — before acquiring (§2.11) and inside `LoadCardsAsync` (the tests call it directly).
15. **The four chores are gated, the two probes are not.** `outbox/publish`, `content-intelligence/import`, `publish/reap-orphans`, `manifest/rebuild` call `EnsureAsync` first: a deploy that forgot to migrate fails loudly within 5 minutes (reaper → invocation error → alarm 2 + SNS). `db/migrate` and `health/deep` never gate (§2.11).
16. **`manifest/rebuild` staleness** is `max(deck_publishes.updated_at where status='SUCCESS') > manifest.json LastModified + 1 s` (S3 `LastModified` has second granularity); `args.force = true` skips the check; no SUCCESS row ⇒ skip; no object ⇒ rebuild. `CONTENT_BUCKET` unset ⇒ throw (config error, must be visible).
17. **E03's `42703` catches stay.** `ManifestBuilder`'s pointer query, `JobRepository.CompleteJobAsync`, `ContentIntelligence.cs:357,378`, `ContentArtifactsGenerator/Repository` and the worker's E03 tolerance are not this issue's; only the two blocks §2.11 names are deleted.
18. **`dotnet test` classes.** The verify runs the three new classes plus every class the fixture change or the deleted fallbacks can affect: `PublishJobProcessorSchemaTests`, `ProgressEventsCardFormatTests`, `ProgressEventsSingleStatementTests`, `ProgressEventsIntegrationTests`, `DbWarmupTests`, `WarmupDecisionTests`, `Migration015BackfillTests`, `ContentIntelligenceMcqTests`.

## Read first

1. `docs/delivery/r16-issues/E00-contracts.md` §0 (`:9-36`), §1.1 (`:43-69`), §1.2 (`:71-108`), §2.1.2–2.1.4 (`:170-211`), §2.3 (`:223-251`), §2.4.6–2.4.7 (`:278-279`), §2.10 (`:351-357`), **§2.11 (`:359-379`)**, §2.12 (`:381-385`), §2.16 (`:411-415`), §3.1 (`:419-430`), §3.3 (`:436-438`), §4 (`:446-468`), §5 (`:470-482`), §6 #5, #6, #17, #20, #21.
2. `docs/backend-architecture-review-2026-09-22.md` §2.2.2 (`:106`, on-failure destination), §2.2.7 (`:111`), §2.2.11 (`:115`), §2.3.6 (`:126`, deep health), §2.4.3 (`:134`), §3 rows `:205`, `:207`.
3. The merged tree (integration branch): `infra/modules/api/{main,variables,outputs,core_vpc,gateway}.tf`, `infra/modules/observability/{alarms,variables,alerts}.tf`, `infra/modules/identity/{policies,variables}.tf`, `infra/envs/prod/{main,variables}.tf`, `infra/envs/staging/main.tf`, `infra/scripts/check-plan.py` (its exact semantics decide the allow files), `infra/README.md` §2–§6; `src_C/Vpc/Authoring/PublishReaper.cs`, `src_C/Shared/RecallSmith.Lambda.Db/ManifestBuilder.cs`, `src_C/Vpc/Authoring/Helpers.cs` (`ErrorEnvelope`), `src_C/Shared/RecallSmith.Lambda.Common/{Log,RouteMetrics,Res}.cs` (post-E04/E07), `src_C/Vpc/Analytics/OutboxPublisher.cs` (post-E04 `PublishBatchAsync`), `src_C/Worker/Services/PublishJobProcessor.cs` (post-E03 `ProcessAsync`), `src_C/Worker/WorkerFunction.cs` (post-E03 batch-item failures — read, do not edit).
4. `src_C/Vpc/VpcFunction.cs:1-60`, `:100-130`, `:300-323`; `src_C/Vpc/Db/Migrate.cs` (whole, 337 lines); `src_C/Vpc/Runtime/ProgressEvents.cs:72-100`, `:360-400`, `:600-690`; `src_C/Vpc/Analytics/ContentIntelligenceSnapshotImport.cs:1-110`, `:230-350`; `src_C/Vpc/Warmup.cs:141-200`, `:279-400`; `src_C/Shared/RecallSmith.Lambda.Db/{Pg,DbUtil}.cs`; `src_C/Shared/RecallSmith.Lambda.Common/LambdaRequest.cs:1-70`.
5. Tests: `IntegrationTestBase.cs` (whole), `PublishJobProcessorSchemaTests.cs` (whole), `ProgressEventsCardFormatTests.cs:1-80`, `:240-317`, `AuthBearerTests.cs:40-80` (a raw event through `new VpcFunction().Handler`), `DbWarmupTests.cs:200-235`, `RouteMetricsTests.cs` (how `[Theory]`/`[MemberData]` are written in this project).
6. The Terraform docs for `aws_scheduler_schedule`, `aws_scheduler_schedule_group`, `aws_lambda_function_event_invoke_config` (provider 6.x) — attribute names are pinned in Changes 16–17; the scratch probe above validated them.

## Constraints

- **Scope (the ONLY files that may change):**
  Code — `src_C/Vpc/Internal/InternalEvents.cs` (new), `src_C/Shared/RecallSmith.Lambda.Db/SchemaVersion.cs` (new), `src_C/Vpc/VpcFunction.cs` (two regions, Changes 3), `src_C/Vpc/Db/Migrate.cs`, `src_C/Vpc/Runtime/ProgressEvents.cs` (`:373-385` and `:608-637` only — base-tree numbers; E07 edits `:117-241` before you and may shift them, so anchor on the text of Changes 4a/4b, never on the number), `src_C/Worker/Services/PublishJobProcessor.cs` (`ProcessAsync` first statement + `LoadCardsAsync`), `src_C/Vpc/Analytics/ContentIntelligenceSnapshotImport.cs`, `src_C/Vpc/Analytics/OutboxPublisher.cs` (add-only), `src_C/Vpc/Warmup.cs` (one call).
  Tests — `src_C/Tests/RecallSmith.Lambda.IntegrationTests/InternalEventsTests.cs` (new), `SchemaGateTests.cs` (new), `MigrateLockTimeoutTests.cs` (new), `PublishJobProcessorSchemaTests.cs` (bounded), `ProgressEventsCardFormatTests.cs` (bounded), `IntegrationTestBase.cs` (bounded, add-only, ≤ 8 lines).
  Infra — `infra/modules/api/scheduler.tf` (new), `infra/modules/api/core_vpc.tf`, `infra/modules/api/variables.tf`, `infra/modules/api/outputs.tf`, `infra/modules/observability/alarms.tf`, `infra/modules/observability/variables.tf`, `infra/modules/identity/policies.tf`, `infra/modules/identity/variables.tf`, `infra/envs/prod/main.tf`, `infra/envs/staging/main.tf` (expected zero-diff, see gap 10), `infra/README.md` (§6, one line).
  Docs — `docs/delivery/r16-issues/E12.plan-allow.json` (new), `docs/delivery/r16-issues/E12.staging.plan-allow.json` (new). Nothing else.
- **WORKER SAFETY RULE (verbatim, E00 §0):** a worker may run read-only AWS CLI, `terraform init/validate/plan` (plan must be saved with -out and shown as JSON), but NEVER `terraform apply`, `terraform import` (state-changing), `aws ... create/update/delete/put`, `eas`, or any deploy script. The supervisor applies plans after each merge. Each infra brief's verify.sh therefore checks the PLAN (terraform show -json) against an explicit allow-list of resource addresses and actions — nothing else may appear as create/update/delete.
  Clarifications (E00 §0): `import {}` blocks are configuration (untouched here); `aws sts get-caller-identity`, `s3api head-object`, `iam get-role`, `sns list-subscriptions-by-topic`, `iam simulate-custom-policy`, `lambda get-*`/`list-*`, `scheduler list-*` are read-only and allowed. `aws lambda invoke`, `aws ssm get-parameter --with-decryption`, `./deploy.sh` without `DRY_RUN=1`, `scripts/invoke-as-admin.sh` are supervisor-only. The prod plan may read the real S3 state (`plan -lock=false`, gap 11); it never writes it. Never create `prod.auto.tfvars` / `staging.auto.tfvars`.
- **Frozen files (zero diff):** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`; `infra/envs/prod/{imports,backend,versions,providers,variables,outputs}.tf`, `prod.auto.tfvars.example`, both lock files; `src_C/deploy.sh`, `src_C/env/**`, `src_C/Vpc/SnapStartHooks.cs`, `src_C/Worker/WorkerFunction.cs`, `src_C/Shared/RecallSmith.Lambda.Common/{RouteMetrics,Log,Res}.cs`, `src_C/Vpc/Authoring/Helpers.cs`, `src_C/Vpc/Db/Migrations/**` (no migration in this issue), `.github/**`, `frontend/**`, `mobile/**`, `scripts/**`, `snowflake/**`.
- **OTA rule (E00 §0):** no change to `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json` (`"version": "1.6.1"` stays), `mobile/eas.json`; no dependency, no native module, no `@sentry/*`.
- **Terraform:** 1.16.3, `hashicorp/aws ~> 6.0` resolved by the committed lock files (6.66.0); never `terraform init -upgrade`; `TF_PLUGIN_CACHE_DIR="$HOME/.terraform.d/plugin-cache"`; provider blocks carry `region` only; no `provisioner`, `local-exec`, `null_resource`, `data "external"`, `archive_file`, `terraform_remote_state`; `terraform fmt -recursive infra` before every commit; addresses of existing resources never change; the new names use the `developercards-` prefix (E00 §2.1.3); no `tags`.
- **Secrets:** no secret value in any `.tf`, `.json`, `.cs`, test, PR text or verify output; the plan JSON carries the Lambda environment blocks in clear, so it lives under a mktemp dir, is printed only as address/action/keys, and is deleted; the two unspellable env-var names are never written. The scheduler `input` carries no secret and no HMAC (IAM is the trust boundary).
- **Banned literals in any new/changed line and in the README line:** the six terms of B00 §0 (driver gate, case-insensitive). Use "recognise", "sidestep", "guard", "fallback", "probe". No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(`, `[Fact(Skip =`, `#pragma warning disable` in any diff.
- **Tests:** create the three classes named above; edit exactly the three bounded files as Changes 10–12 say; every other file under `src_C/Tests/**` is byte-identical to the base (the verify diffs each one). No `Docker`-free shortcut: the new classes join `PostgresCollection`.
- **Dependency/order:** E12 rebases on E10; E11 (CD) and E13 (retention delete inside `outbox/publish`) build on this issue. Keep `Handlers` a plain dictionary so E13 can find the `outbox/publish` entry.
- Standing rules: no `git push`, no PR, never touch `main`, no EAS / expo / deploy command, no `npm install`/`dotnet restore` beyond the implicit cached restore, no git activity outside your worktree.

## Changes required

### Code

1. **`src_C/Shared/RecallSmith.Lambda.Db/SchemaVersion.cs` (new, namespace `RecallSmith.Lambda.Db`).** Two types:
   ```csharp
   public sealed class SchemaBehindException : Exception
   {
     public int Current { get; }
     public int Required { get; }
     public SchemaBehindException(int current, int required)
       : base($"database schema version {current} is behind the required {required}; run db/migrate before serving traffic") { Current = current; Required = required; }
   }

   public static class SchemaVersion
   {
     /// == the highest numbered file in src_C/Vpc/Db/Migrations (021 after E03). Bump it in the same commit as every new migration; SchemaGateTests pins the equality.
     public const int Required = 21;
     public static Task<int> ReadAsync(NpgsqlConnection conn);      // "select coalesce(max(version), 0) from schema_migrations"; PostgresException 42P01 (no table yet) → 0
     public static Task EnsureAsync(NpgsqlConnection conn);         // cached OK per key → return; else ReadAsync; current >= Required → cache OK; else mark behind + throw new SchemaBehindException(current, Required)
     public static Task<int?> ProbeAsync(NpgsqlConnection conn);     // EnsureAsync that never throws; returns the version read (null when the read failed); Warmup calls it
     public static bool GatesRoute(string method, string path);      // pure, see below
     public static void Reset();                                     // clears the cache (tests)
   }
   ```
   Cache key `$"{conn.Host}:{conn.Port}/{conn.Database}"` in a `ConcurrentDictionary<string, int>` holding the last version read; OK is `>= Required`. On the **first** behind verdict for a key (and again whenever the value read changes), emit exactly one `Log.Event("error", new { tag = "schema", current, required = Required, database = conn.Database })` and `RouteMetrics.EmitGauge("SchemaBehind", 1)`; never emit `0`. `GatesRoute`: `method` upper-cased ∈ {`GET`,`HEAD`,`OPTIONS`} → `false`; `path` trimmed of trailing `/`; starts with `"/api/v1/admin/db/"` → `false`; else `true` iff it starts with `"/api/v1/authoring/"`, `"/api/v1/admin/"`, `"/api/v1/sync/"` or `"/api/v1/draw-state/"` (ordinal-ignore-case). The file never mentions `requestContext`.

2. **`src_C/Vpc/Internal/InternalEvents.cs` (new, namespace `RecallSmith.Lambda.Vpc.Internal`).** E00 §2.11 signatures verbatim plus the `Also` property (gap 4):
   ```csharp
   public sealed record InternalEvent(string Action, JsonElement Args, string? ScheduledTime, string? ScheduleArn, string TraceId)
   {
     public IReadOnlyList<string> Also { get; init; } = [];
   }

   public static class InternalEvents
   {
     public const string Source = "developercards.scheduler";
     public static bool TryParse(JsonElement evt, out InternalEvent ie);
     public static readonly IReadOnlyDictionary<string, Func<InternalEvent, Task<object>>> Handlers;
     public static Task<APIGatewayProxyResponse> DispatchAsync(InternalEvent ie);
     public static bool ManifestIsStale(DateTime? latestSuccessUtc, DateTime? manifestLastModifiedUtc);   // pure: latest null → false; lastModified null → true; else latest > lastModified + 1 s
   }
   ```
   - `TryParse` → `false` unless: `evt.ValueKind == JsonValueKind.Object`, **no** `requestContext` property (any event carrying one is HTTP, whatever else it says), `source` is a string equal to `"developercards.scheduler"`, `action` is a non-empty string matching `^[a-z][a-z0-9-]*(/[a-z][a-z0-9-]*)*$`. Then: `Args` = `args.Clone()` when `args` is an object, else an empty object element; `ScheduledTime`/`ScheduleArn` = the strings when present; `TraceId` = `traceId` when a non-empty string, else `Guid.NewGuid().ToString()`; `Also` = the string entries of `also` when it is an array (each must match the action regex, else `false`). `TryParse` never validates the action against `Handlers` (an unknown action is dispatched and throws).
   - `Handlers` — exactly six keys: `"outbox/publish"`, `"content-intelligence/import"`, `"publish/reap-orphans"`, `"manifest/rebuild"`, `"db/migrate"`, `"health/deep"`. Each handler opens `Pg.OpenConnectionOrNullAsync()` (null → `throw new InvalidOperationException("Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)")`) and returns an anonymous object with lower-camel keys:
     - `outbox/publish`: `limit` = `args.limit` clamped to 1..5000 (default 5000); `await SchemaVersion.EnsureAsync(conn)`; `var r = await OutboxPublisher.PublishLoopAsync(conn, limit)` (Changes 8); `// E13: retention delete goes here` (a comment, so E13's edit is a one-line insert); `RouteMetrics.EmitGauge("OutboxPending", r.PendingAfter)`; if `r.Retried > 0` → `throw new InvalidOperationException($"outbox publish: {r.Retried} rows marked for retry (S3 put failed)")`; return `new { runs = r.Runs, claimed = r.Claimed, published = r.Published, retried = r.Retried, pendingAfter = r.PendingAfter, budgetExhausted = r.BudgetExhausted }`.
     - `content-intelligence/import`: `EnsureAsync`; `var r = await ContentIntelligenceSnapshotImport.RunAsync(conn, bucket: <args.bucket string or null>, key: <args.key string or null>)` (Changes 7); return `new { skipped = r.Skipped, reason = r.Reason, bucket = r.Bucket, key = r.Key, rowCount = r.RowCount, runId = r.RunId }`.
     - `publish/reap-orphans`: `EnsureAsync`; `var r = await PublishReaper.ReapOrphansAsync(conn)`; return `new { pending = r.Pending, processing = r.Processing, jobIds = r.JobIds }`.
     - `manifest/rebuild`: `EnsureAsync`; `force` = `args.force == true`; `bucket` = `CONTENT_BUCKET` (blank → `throw new InvalidOperationException("Missing env CONTENT_BUCKET")`); `contentPrefix` = `ManifestBuilder.NormalizePrefix(Environment.GetEnvironmentVariable("CONTENT_PREFIX"), "content")`, `premiumPrefix` likewise with `PREMIUM_PREFIX`/`"premium"`; `latest` = `select max(updated_at) from deck_publishes where status = 'SUCCESS'` as `DateTime?` (UTC); `lastModified` = `ManifestBuilder.S3().GetObjectMetadataAsync(bucket, $"{contentPrefix}/manifest.json")`.LastModified (UTC) or `null` on `AmazonS3Exception` with `StatusCode == HttpStatusCode.NotFound`; when `!force && !ManifestIsStale(latest, lastModified)` return `new { skipped = true, reason = latest is null ? "no_success" : "manifest_current", latestSuccessAt = latest, manifestLastModified = lastModified }`; else `var r = await ManifestBuilder.RebuildAsync(conn, ManifestBuilder.S3(), bucket, contentPrefix, premiumPrefix)` and return `new { skipped = false, rebuilt = true, deckCount = r.DeckCount, patchEdgeCount = r.PatchEdgeCount, key = r.Key, etag = r.ETag, generatedAtMs = r.GeneratedAtMs }`.
     - `db/migrate`: **no gate**; `dryRun` = `args.dryRun == true`; `return await Migrate.RunAsync(conn, dryRun)` (Changes 4; a `MigrationInProgressException` propagates — CD retries).
     - `health/deep`: **no gate**; `select 1` must return `1` (else `throw new InvalidOperationException("db probe failed")`); `var v = await SchemaVersion.ReadAsync(conn)`; return `new { ok = v >= SchemaVersion.Required, schemaVersion = v, required = SchemaVersion.Required }` — exactly these three keys (E11's smoke reads them).
   - `DispatchAsync(ie)`: build the synthetic request `JsonSerializer.SerializeToElement(new { rawPath = "/internal/" + ie.Action, requestContext = new { requestId = ie.TraceId, http = new { method = "POST" } }, headers = new Dictionary<string, string>(), isBase64Encoded = false })` → `new LambdaRequest(...)`, `new Res(req.TraceId)`; then `return await RouteMetrics.MeasureAsync("core-vpc", req, async () => { … })` where the body: `Handlers.TryGetValue(ie.Action, out var h)` else `throw new InvalidOperationException($"unknown internal action '{ie.Action}'")`; `var data = ToDictionary(await h(ie))` (serialize the anonymous object with `JsonSerializer` and deserialize to `Dictionary<string, object?>` — camelCase keys survive as written); for each `a` in `ie.Also`: unknown → the same throw; `also[a] = await Handlers[a](ie with { Action = a, Also = [] })`; when `ie.Also.Count > 0` set `data["also"] = also`; one `Log.Event("info", new { tag = "internal", action = ie.Action, also = ie.Also, traceId = ie.TraceId, scheduleArn = ie.ScheduleArn, scheduledTime = ie.ScheduledTime, ms = sw.ElapsedMilliseconds, ok = true })`; `return res.Ok(data)`. On any exception: `Log.Event("error", new { tag = "internal", action = ie.Action, traceId = ie.TraceId, error = ex.GetType().Name, message = ex.Message })` then **rethrow** (`MeasureAsync` records `Errors=1` and rethrows; the runtime reports a `FunctionError`; the scheduler retries once and the on-failure destination receives the record). Never return a 5xx from this path; never catch to a response. The file does not reference `VerifyInternalSignature`.

3. **`src_C/Vpc/VpcFunction.cs`** — two regions (E00 §2.16: the internal branch at the top of `Handler`; the gate is E12's second, recorded in gap 7). Add `using RecallSmith.Lambda.Db;` (`:3`).
   a. `Handler` (`:32-34`): the first statement, before `var req = new LambdaRequest(evt);`:
      ```csharp
      // Direct invokes (EventBridge Scheduler, CD, the supervisor) carry no requestContext; IAM
      // lambda:InvokeFunction on the alias is their trust boundary (E00 §2.11). Failure = throw.
      if (Vpc.Internal.InternalEvents.TryParse(evt, out var ie)) return await Vpc.Internal.InternalEvents.DispatchAsync(ie);
      ```
   b. `DispatchAsync`, directly after `var p = req.Path.TrimEnd('/');` (`:103`, which follows E07's body-cap statement) and before the `/health` check (`:105`):
      ```csharp
      // Schema gate (E12): writes to a database behind SchemaVersion.Required answer 503 until
      // db/migrate has run; reads, /health, the webhooks and /api/v1/admin/db/* stay open.
      if (SchemaVersion.GatesRoute(req.Method, p))
      {
        await using var gate = await Pg.OpenConnectionOrNullAsync();   // returned to the pool at the end of this block, before the route opens its own (PG_MAX=1)
        if (gate is not null)
        {
          try { await SchemaVersion.EnsureAsync(gate); }
          catch (SchemaBehindException) { return res.ServiceUnavailable("SERVER_NOT_READY_SCHEMA", "database schema is behind the deployed code; retry after the migration", 30); }
        }
      }
      ```
   Nothing else in the file changes: no `EndsWith` block moves, `health/deep` is **not** an HTTP route (it lives only in `InternalEvents`; the string `/health/deep` must not appear in this file, not even in a comment), the existing routes `/api/v1/admin/db/migrate`, `/api/v1/admin/manifest/rebuild`, `/api/v1/sync/progress/events`, `/api/v1/admin/analytics/outbox/publish`, `/api/v1/admin/analytics/content-intelligence/import`, `/api/internal/entitlements/apply` keep their lines.

4. **`src_C/Vpc/Db/Migrate.cs`**
   a. Add after the `Migration` record (`:10`): `public sealed class MigrationInProgressException : Exception { public MigrationInProgressException() : base("another migration holds the advisory lock (lock_timeout 5s)") { } }` and `public const int MigrationLockId = 77889911;` (the private `lockId` at `:98` goes).
   b. `WithMigrationLock` (`:96-108`) becomes:
      ```csharp
      private static async Task<T> WithMigrationLock<T>(NpgsqlConnection conn, Func<Task<T>> fn)
      {
        // 5 s for the advisory lock AND for every lock a migration file needs: a second migration or a
        // DDL blocked behind a long query fails fast instead of holding traffic (review §2.4.3). Reset in
        // finally so the pooled session (PG_MAX=1) hands the default back to the next request.
        await ExecuteAsync(conn, null, "set lock_timeout = '5s';", []);
        var locked = false;
        try
        {
          try { await ExecuteAsync(conn, null, "select pg_advisory_lock($1);", [MigrationLockId]); locked = true; }
          catch (PostgresException pg) when (pg.SqlState == "55P03") { throw new MigrationInProgressException(); }
          return await fn();
        }
        finally
        {
          if (locked) { try { await ExecuteAsync(conn, null, "select pg_advisory_unlock($1);", [MigrationLockId]); } catch { /* ignore */ } }
          try { await ExecuteAsync(conn, null, "reset lock_timeout;", []); } catch { /* ignore */ }
        }
      }
      ```
   c. New core, the lambda body of `:159-188` moved verbatim: `public static async Task<object> RunAsync(NpgsqlConnection conn, bool dryRun)` — `LoadMigrations()`; `Count == 0` → `throw new InvalidOperationException("No migrations found in Db/Migrations")`; `return await WithMigrationLock<object>(conn, async () => { … })` returning the same two anonymous shapes as today (`dryRun/available/pending` and `dryRun/applied/appliedCount/latestAvailable`).
   d. `HandleDbMigrate` (`:129-191`): auth, secret compare (E06's line), `CONFIG_ERROR`, the `MIGRATIONS_EMPTY` 400 and the `dryRun` parse stay; the lambda is replaced by
      ```csharp
      try { return res.Ok(await RunAsync(conn, dryRun)); }
      catch (MigrationInProgressException)
      {
        return Authoring.Helpers.ErrorEnvelope(res, 409, "MIGRATION_IN_PROGRESS",
          "Another migration holds the lock (waited 5 s). Wait a minute and retry; never run two migrations at once.");
      }
      ```
   `HandleDbMigrationsList`, `HandleDbCreateDatabase`, `HandleDbDropAndRecreate`, `HandleDbPing` are untouched.

5. **`src_C/Vpc/Runtime/ProgressEvents.cs`** — two regions.
   a. `:373-385`: `BuildIngestSql()` loses its parameter; `cardFormatKey` and `cardFormatJoin` become the former `true`-branch strings; the comment reads: "The outbox tag `card_format` reads `cards.mcq` (migration 019). A database behind that migration is refused up front by `SchemaVersion.EnsureAsync` (E12), so there is exactly one statement text and one auto-prepared plan per batch size." No `withCardFormat` identifier remains in the file.
   b. `:608-637` (the comment `:608-617`, `swStatement`, the `try`/`catch "42703"`): replaced by
      ```csharp
      // Timed on its own because this is the claim the design rests on: the whole ingest (users upsert,
      // event insert, outbox, aggregate, last-writer-wins merge) is ONE statement. The schema gate runs
      // first: a database behind SchemaVersion.Required answers 503 and writes nothing — the 42703
      // fallback that used to sit here is gone (E12).
      try { await SchemaVersion.EnsureAsync(conn); }
      catch (SchemaBehindException behind)
      {
        Log.Event("warn", new { traceId = req.TraceId, impl = ProgressEventsImpl, step = "schema_behind", current = behind.Current, required = behind.Required });
        return res.ServiceUnavailable("SERVER_NOT_READY_SCHEMA", "database schema is behind the deployed code; retry after the migration", 30);
      }
      var swStatement = Stopwatch.StartNew();
      var rows = await DbUtil.QueryAsync(conn, null, BuildIngestSql(), parameters);
      ```
   `:117-241` (E07's per-event validation) and `:669-685` (E07's response/catches) are not touched; the file no longer contains `42703` or `ingest_card_format_fallback`.

6. **`src_C/Worker/Services/PublishJobProcessor.cs`**
   a. `ProcessAsync` (post-E03 shape) — the first statement, before E03's acquire:
      ```csharp
      // E12 schema gate, before acquiring: a worker deployed ahead of its migration must not take the
      // job. SchemaBehindException is not a BusinessException → batch-item failure → SQS redelivers.
      await using (var gate = await Pg.OpenConnectionOrNullAsync())
      {
        if (gate is null) throw new InvalidOperationException("Failed to open database connection");
        await SchemaVersion.EnsureAsync(gate);
      }
      ```
   b. `:185-209` `LoadCardsAsync`: first line `await SchemaVersion.EnsureAsync(conn);`, then the single `DbUtil.QueryAsync(conn, null, CardsSql, [deckId])`; delete `CardsSqlTopicOnly` (`:152-167`), `CardsSqlLegacy` (`:169-183`) and both `42703` catches; rewrite the summary `:185-191` ("11 columns; a database behind migration 021 throws SchemaBehindException before any row is read (E12)"). The mapping `:211-224` is unchanged.

7. **`src_C/Vpc/Analytics/ContentIntelligenceSnapshotImport.cs`** — extract the core so the internal action and the HTTP handler share it:
   ```csharp
   public sealed record SnapshotImportResult(bool Skipped, string? Reason, string Bucket, string Key, string? ETag, int RowCount, long RunId);
   public static async Task<SnapshotImportResult> RunAsync(Npgsql.NpgsqlConnection conn, string? bucket = null, string? key = null)
   ```
   = `:304-334` restructured: `bucket ??= DefaultBucket(); key ??= DefaultKey();` HEAD (`GetObjectMetadataAsync`) → `etag`; `AmazonS3Exception` with `StatusCode == HttpStatusCode.NotFound` → `Log.Event("warn", new { tag = "snapshot-import", reason = "object_missing", bucket, key })` and `return new(true, "object_missing", bucket, key, null, 0, 0)`; any other HEAD failure keeps today's best-effort (`etag = null`, proceed). **Etag skip** (E00 §2.11): when `etag` is non-null and `select 1 from content_intelligence_import_runs where s3_bucket = $1 and s3_key = $2 and s3_etag = $3 and status = 'SUCCEEDED' limit 1` returns a row → `return new(true, "etag_unchanged", bucket, key, etag, 0, 0)` (no run row is written). Else `CreateImportRunAsync` → `ImportSnapshotAsync` → `CompleteImportRunAsync("SUCCEEDED")` → `new(false, null, bucket, key, etag, rowCount, runId)`; on exception `CompleteImportRunAsync("FAILED")` best-effort, then rethrow. `HandleImportSnapshot` keeps auth/POST/`ResolveBucket`/`ResolveKey`/`CONFIG_ERROR` and becomes `try { var r = await RunAsync(conn, bucket, key); return res.Ok(new { ok = true, skipped = r.Skipped, reason = r.Reason, bucket = r.Bucket, key = r.Key, rowCount = r.RowCount, runId = r.RunId }); } catch (Exception ex) { Log.Error(…); return res.BadRequest("IMPORT_FAILED", …); }` (same 400 text as `:343-345`). `ImportSnapshotAsync`, `UpsertSnapshotRowAsync`, `CardSnapshotRow` are untouched.

8. **`src_C/Vpc/Analytics/OutboxPublisher.cs` (add-only, after E04's `PublishBatchAsync`):**
   ```csharp
   public sealed record OutboxLoopResult(int Runs, int Claimed, int Published, int Retried, int PendingAfter, bool BudgetExhausted);
   /// Scheduled drain: PublishBatchAsync until a batch comes back short, maxRuns is reached or the budget is spent.
   public static async Task<OutboxLoopResult> PublishLoopAsync(NpgsqlConnection conn, int limit, int maxRuns = 20, TimeSpan? budget = null)
   ```
   bucket = `AnalyticsBucket()` (null → `throw new InvalidOperationException("Missing env ANALYTICS_S3_BUCKET or CONTENT_BUCKET")`), prefix = `NormalizePrefix(Environment.GetEnvironmentVariable("ANALYTICS_S3_PREFIX"))`, `budget ??= TimeSpan.FromSeconds(60)`; loop `do { r = await PublishBatchAsync(conn, S3(), bucket, prefix, limit); runs++; sums += … } while (r.Published == limit && r.Retried == 0 && runs < maxRuns && sw.Elapsed < budget)`; `PendingAfter` = the last batch's; `BudgetExhausted` = `sw.Elapsed >= budget`. Nothing existing changes.

9. **`src_C/Vpc/Warmup.cs`** — inside `WarmDatabaseAsync(CancellationToken)`, directly after the `select 1` block (`:367-370`), before `probeWatch.Stop()`:
   ```csharp
   // E12: read schema_migrations once per container so a database behind SchemaVersion.Required is
   // logged ({tag:"schema"}) and metered (SchemaBehind=1) before the first request. Never throws.
   await SchemaVersion.ProbeAsync(conn).ConfigureAwait(false);
   ```
   (`using RecallSmith.Lambda.Db;` is already at `:6`.) Nothing else in the file changes.

10. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs` (bounded, add-only, ≤ 8 lines)** — in `ApplyMigrationsAsync`, directly after `await DbUtil.ExecuteAsync(conn, null, sql, []);` (`:153`):
    ```csharp
      // Mirror Migrate.ApplyOne: production records every applied file, and E12's SchemaVersion gate
      // reads max(version). A fixture that ran the DDL but left schema_migrations empty would gate
      // every write-route test at 503.
      await DbUtil.ExecuteAsync(conn, null, "insert into schema_migrations(version, name) values ($1, $2) on conflict (version) do nothing;", [version, file[..^4]]);
    ```
    `LambdaHost` (`:172-247`, E14's region) and everything else is byte-identical.

11. **`PublishJobProcessorSchemaTests.cs` (bounded)** — the class summary `:9-16` now says the worker refuses a database behind `SchemaVersion.Required` instead of tolerating it; `LoadCards_PreTopicSchema_FallsBackToLegacyColumns` (`:42-63`) becomes `LoadCards_PreTopicSchema_ThrowsSchemaBehind`: same scratch database at `maxVersion: 17`, `SchemaVersion.Reset()` after the migrations, then `var ex = await Assert.ThrowsAsync<SchemaBehindException>(() => PublishJobProcessor.LoadCardsAsync(conn, deckId)); Assert.Equal(17, ex.Current); Assert.Equal(SchemaVersion.Required, ex.Required);`. `LoadCards_TopicOnlySchema_KeepsTopicAndNullMcq` (`:65-85`) becomes `LoadCards_TopicOnlySchema_ThrowsSchemaBehind` the same way with `18`. `LoadCards_FullSchema_ParsesMcqAsOwnedElement` (`:87-114`) is unchanged. Exactly two `Assert.ThrowsAsync<SchemaBehindException>` in the file.

12. **`ProgressEventsCardFormatTests.cs` (bounded)** — the summary `:20-23` and the one case `:246-316`. `WithoutTheMcqColumn_IngestFallsBackToTheLegacyStatement` becomes `WithoutTheMcqColumn_IngestAnswers503SchemaBehind`: keep the premise `:249-266`, the scratch database at `maxVersion: 18` and the env swap `:268-270` plus `SchemaVersion.Reset()`; inside the `try`, call `RecallSmith.Lambda.Vpc.Runtime.ProgressEvents.HandleProgressEvents(req, res, auth)` directly through a private `PostRawAsync(user, events)` helper that builds the event/`LambdaRequest`/`Res`/`AuthContext` exactly as `LambdaHost.InvokeAsync` does (`IntegrationTestBase.cs:209-232`) but returns the raw `APIGatewayProxyResponse`; assert `StatusCode == 503`, the envelope's `error.code == "SERVER_NOT_READY_SCHEMA"`, a `retry-after` header equal to `"30"`, and zero rows in `analytics_event_outbox` and `user_progress` for that event/user; `finally` restores `PGDATABASE`, `Pg.Reset()`, `SchemaVersion.Reset()`; the after-part `:307-315` stays (a fresh event on the shared database still carries `card_format`). Lines `:1-245` other than the summary are byte-identical.

13. **`InternalEventsTests.cs` (new, `[Collection(PostgresCollection.Name)]`)** — method names verbatim:
    1. `TryParse_RejectsAnyHttpShapedEvent` — `[Theory]` + `[MemberData(nameof(HttpShapedEvents))]`: a generator (seeded `new Random(12)`) yields **60** events that all carry `requestContext` (random method ∈ {GET, POST, PUT, DELETE, OPTIONS}, random `rawPath` from ten routes incl. `/internal/outbox/publish`, random headers), half of them ALSO carrying `source = "developercards.scheduler"` and an `action` — every one → `TryParse == false` (E00 §3.3).
    2. `TryParse_RejectsWrongSource` — objects without `requestContext` whose `source` is absent, `""`, `"scheduler"`, `"developercards.internal"`, a number or `null` → `false`; a JSON array, string and number → `false`; a right source with `action` absent / `""` / `"Outbox/Publish"` / `"outbox//publish"` → `false`.
    3. `TryParse_AcceptsSchedulerEvent_WithContextAndAlso` — E00's sample event plus `"also":["manifest/rebuild"]` → `true`; `Action == "outbox/publish"`, `Args.GetProperty("limit").GetInt32() == 5000`, `ScheduledTime`/`ScheduleArn`/`TraceId` as given, `Also` equals `["manifest/rebuild"]`; an event without `traceId` gets a non-empty one; without `args` → `Args.ValueKind == Object` with zero properties.
    4. `Dispatch_UnknownAction_Throws` — `action = "no/such"` → `await Assert.ThrowsAsync<InvalidOperationException>(() => InternalEvents.DispatchAsync(ie))`.
    5. `Dispatch_HealthDeep_ReportsSchemaVersion` — shared database: `StatusCode == 200`, `data.ok == true`, `data.schemaVersion >= 21`, `data.required == SchemaVersion.Required`.
    6. `Dispatch_ReapOrphans_WithAlso_ReturnsBothResults` — insert a deck and a `deck_publishes` row `PENDING` with `created_at = now() - interval '20 minutes'` (the row shape E03's `PublishReaperTests` uses); event `publish/reap-orphans` with `Also = ["health/deep"]` → 200, `data.pending == 1`, the row is `FAILED`, `data.also["health/deep"].ok == true`.
    7. `Dispatch_DbMigrate_DryRun_ListsPending` — `db/migrate` with `args = { dryRun: true }` → 200, `data.dryRun == true`, `data.pending` is an empty array (the fixture records every version), `data.available.Length >= 21`.
    8. `ManifestIsStale_Table` — `[Theory]` rows: `(null, null) → false`, `(null, t) → false`, `(t, null) → true`, `(t, t) → false`, `(t + 0.5 s, t) → false`, `(t + 2 s, t) → true`.

14. **`SchemaGateTests.cs` (new, `[Collection(PostgresCollection.Name)]`)** — names verbatim:
    1. `Required_EqualsHighestMigrationFile` — the max numeric prefix under `AppContext.BaseDirectory/Db/Migrations` equals `SchemaVersion.Required`.
    2. `ReadAsync_ReportsMaxAppliedVersion` — scratch `sg_v18` at `maxVersion: 18` → `18`; shared → `SchemaVersion.Required`.
    3. `EnsureAsync_Throws_WhenBehind` — scratch@18 after `SchemaVersion.Reset()`: `SchemaBehindException` with `Current == 18` and `Required == SchemaVersion.Required`; shared: no throw twice in a row.
    4. `GatesRoute_Table` — `[Theory]` rows exactly: `("POST","/api/v1/sync/progress/events")→true`, `("POST","/api/v1/sync/push")→true`, `("GET","/api/v1/sync/progress")→false`, `("POST","/api/v1/draw-state/sync")→true`, `("POST","/api/v1/authoring/cards")→true`, `("PUT","/api/v1/authoring/cards")→true`, `("DELETE","/api/v1/authoring/decks")→true`, `("GET","/api/v1/authoring/decks")→false`, `("POST","/api/v1/admin/manifest/rebuild")→true`, `("POST","/api/v1/admin/decks/12/rollback")→true`, `("POST","/api/v1/admin/publish/reap")→true`, `("POST","/api/v1/admin/db/migrate")→false`, `("GET","/api/v1/admin/db/migrations")→false`, `("POST","/api/v1/admin/db/bootstrap-roles")→false`, `("POST","/webhooks/revenuecat/production")→false`, `("POST","/rc/webhook")→false`, `("GET","/health")→false`, `("OPTIONS","/api/v1/authoring/cards")→false`, `("POST","/api/v1/user/bootstrap")→false`, `("POST","/api/internal/entitlements/apply")→false`, `("post","/api/v1/authoring/cards/")→true`.
    5. `Http_WriteRoute_Answers503_WhileBehind` — swap `PGDATABASE` to scratch@18 (`Pg.Reset()`, `SchemaVersion.Reset()`), `new VpcFunction().Handler(evt)` for `POST /api/v1/sync/progress/events` (a small JSON body, no bearer) → `503`, envelope `error.code == "SERVER_NOT_READY_SCHEMA"`, header `"retry-after"` = `"30"`; `finally` restores env + both resets.
    6. `Http_Health_And_DbRoutes_StayOpen_WhileBehind` — same swap: `GET /health` → 200; `POST /api/v1/admin/db/migrate` and `GET /api/v1/authoring/decks` → any status **other than** 503.
    7. `HealthDeep_ReportsBehind` — same swap: internal `health/deep` → 200 with `data.ok == false`, `data.schemaVersion == 18`, `data.required == SchemaVersion.Required`.

15. **`MigrateLockTimeoutTests.cs` (new, `[Collection(PostgresCollection.Name)]`)** — each case takes the advisory lock on its own connection `A` (`select pg_advisory_lock($1)` with `Migrate.MigrationLockId`) and releases it in `finally`:
    1. `RunAsync_Throws_MigrationInProgress_Within_LockTimeout` — `Migrate.RunAsync(connB, dryRun: true)` throws `MigrationInProgressException`; `Stopwatch` ≥ 4.5 s and < 30 s.
    2. `RunAsync_Resets_LockTimeout_On_The_Session` — after that throw, `select current_setting('lock_timeout')` on `connB` is `"0"`.
    3. `HandleDbMigrate_Answers409_WhileLocked` — `Migrate.HandleDbMigrate(req, res, superAdmin)` (event/`Res` as `LambdaHost.InvokeAsync`, `AuthContext` with `Groups: ["super_admin"], IsSuperAdmin: true, IsAdmin: true`, `MIGRATE_SECRET` unset) → `409`, envelope `error.code == "MIGRATION_IN_PROGRESS"`.
    4. `RunAsync_Succeeds_After_Release` — unlock `A`; `RunAsync(connB, dryRun: true)` serialises to JSON with `dryRun == true` and an empty `pending` array.

### Infra

16. **`infra/modules/api/scheduler.tf` (new)** — E00 §2.11 with gap 1:
    ```hcl
    locals {
      schedules = {
        outbox-publish  = { expression = "rate(15 minutes)", input = { source = "developercards.scheduler", action = "outbox/publish", args = { limit = 5000 } } }
        snapshot-import = { expression = "cron(0 2 * * ? *)", input = { source = "developercards.scheduler", action = "content-intelligence/import", args = {} } }
        reap-orphans    = { expression = "rate(5 minutes)", input = { source = "developercards.scheduler", action = "publish/reap-orphans", args = {}, also = ["manifest/rebuild"] } }
      }
      schedule_context = { scheduledTime = "<aws.scheduler.scheduled-time>", scheduleArn = "<aws.scheduler.schedule-arn>", traceId = "<aws.scheduler.execution-id>" }
      # jsonencode escapes < > as < > and Scheduler substitutes only the literal placeholders.
      schedule_inputs = { for k, s in local.schedules : k => replace(replace(jsonencode(merge(s.input, local.schedule_context)), "\\u003c", "<"), "\\u003e", ">") }
    }
    resource "aws_scheduler_schedule_group" "this" { name = "developercards-${var.env}" }
    data "aws_iam_policy_document" "scheduler_trust" { … principals { type = "Service", identifiers = ["scheduler.amazonaws.com"] } condition { test = "StringEquals", variable = "aws:SourceAccount", values = [<account id>] } }
    resource "aws_iam_role" "scheduler" { name = "developercards-${var.env}-scheduler-role", assume_role_policy = data.aws_iam_policy_document.scheduler_trust.json }
    resource "aws_iam_role_policy" "scheduler_invoke" { name = "invoke-core-vpc-alias", role = aws_iam_role.scheduler.id, policy = jsonencode({ Version = "2012-10-17", Statement = [{ Sid = "InvokeCoreVpcAlias", Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = [aws_lambda_alias.core_vpc_prod.arn] }] }) }
    resource "aws_scheduler_schedule" "this" {
      for_each = local.schedules
      name = each.key   group_name = aws_scheduler_schedule_group.this.name   description = "developercards ${var.env}: ${each.key}"
      schedule_expression = each.value.expression   schedule_expression_timezone = "UTC"   state = "ENABLED"
      flexible_time_window { mode = "OFF" }
      target { arn = aws_lambda_alias.core_vpc_prod.arn   role_arn = aws_iam_role.scheduler.arn   input = local.schedule_inputs[each.key]
               retry_policy { maximum_retry_attempts = 1   maximum_event_age_in_seconds = 600 } }
    }
    ```
    (write it out in `terraform fmt` form; the sketch above compresses lines). `<account id>`: reuse `data.aws_caller_identity.current` if `modules/api/main.tf` already declares it, otherwise declare `data "aws_caller_identity" "current" {}` in this file. **Exactly** the alias ARN in the invoke policy — no `*`, no unqualified function ARN. No `aws_lambda_permission` (Scheduler assumes the role; it needs no resource policy).

17. **`infra/modules/api/core_vpc.tf`** — append:
    ```hcl
    resource "aws_lambda_function_event_invoke_config" "core_vpc_prod" {
      function_name          = var.core_vpc_function_name
      qualifier              = var.core_vpc_alias_name
      maximum_retry_attempts = 1
      dynamic "destination_config" {
        for_each = var.async_failure_destination_arn == null ? [] : [var.async_failure_destination_arn]
        content {
          on_failure { destination = destination_config.value }
        }
      }
    }
    ```
    No `maximum_event_age_in_seconds` (E00 names only the retry count and the destination). Plan: one `create`; staging plans it with `destination_config = []`.

18. **`infra/modules/api/variables.tf`** — append `variable "async_failure_destination_arn" { type = string, default = null, description = "SNS topic ARN for the alias's async on-failure destination; null = none (staging)" }`. **`outputs.tf`** — append `output "schedule_group_name" { value = aws_scheduler_schedule_group.this.name }` and `output "scheduler_role_arn" { value = aws_iam_role.scheduler.arn }`.

19. **`infra/modules/observability/alarms.tf`** — alarm 13 in E04's exact shape (plain resource, same `alarm_actions`/`ok_actions`/`treat_missing_data`/description style):
    ```hcl
    resource "aws_cloudwatch_metric_alarm" "scheduler_errors" {
      alarm_name          = "developercards-${var.env}-scheduler-errors"
      alarm_description   = "EventBridge Scheduler could not deliver an invoke to core-vpc (role/alias/throttle); function-side failures are alarm 2 + the on-failure destination"
      namespace           = "AWS/Scheduler"
      metric_name         = "TargetErrorCount"
      statistic           = "Sum"
      period              = 900
      evaluation_periods  = 1
      threshold           = 1
      comparison_operator = "GreaterThanOrEqualToThreshold"
      treat_missing_data  = "notBreaching"
      dimensions          = { ScheduleGroup = var.schedule_group_name }
      alarm_actions       = [aws_sns_topic.alerts.arn]
      ok_actions          = [aws_sns_topic.alerts.arn]
    }
    ```
    **`variables.tf`** — append `variable "schedule_group_name" { type = string }`. (`TargetErrorCount` counts delivery failures; a Lambda that throws is an invocation error, caught by alarm 2 `core-vpc-errors` and by the on-failure destination — say so in the description.)

20. **`infra/modules/identity/policies.tf` + `variables.tf`** (gap 9) — `variable "alerts_topic_arn" { type = string, default = "" }`; in `aws_iam_role_policy.core_vpc` the `Statement` list becomes `concat([ …the six E05 statements unchanged… ], var.alerts_topic_arn == "" ? [] : [{ Sid = "SnsAlerts", Effect = "Allow", Action = ["sns:Publish"], Resource = [var.alerts_topic_arn] }])`. The worker role and every other statement are byte-identical. Plan: `module.identity.aws_iam_role_policy.core_vpc` `update`, changed keys ⊆ `{policy}`.

21. **`infra/envs/prod/main.tf`** (wiring only): `module "identity"` gains `alerts_topic_arn = "arn:aws:sns:${var.region}:${var.account_id}:developercards-alerts"` (a string; E04's topic name); `module "api"` gains `async_failure_destination_arn = module.observability.alerts_topic_arn`; `module "observability"` gains `schedule_group_name = module.api.schedule_group_name`. Nothing else.

22. **`infra/envs/staging/main.tf`** — expected **zero diff**: the staging root instantiates `module "api"` (E10 Changes 6g) so the group `developercards-staging`, role `developercards-staging-scheduler-role`, the three schedules against `core-vpc-staging:staging` and the invoke config (no destination) plan from the module alone. Touch it only if the merged root passes an `api` variable that this issue renamed (it renames none).

23. **`infra/README.md` §6** — append one line: `- 2026-09-22 E12: EventBridge Scheduler group developercards-<env> + role; schedules outbox-publish (15 min), snapshot-import (02:00 UTC), reap-orphans (5 min, also manifest/rebuild) → direct invoke of the core-vpc alias; async invoke config (1 retry, prod on-failure → developercards-alerts) + SnsAlerts on the core-vpc policy; alarm 13 developercards-prod-scheduler-errors; code: InternalEvents (6 actions), SchemaVersion gate (Required=21, 503 SERVER_NOT_READY_SCHEMA), db/migrate lock_timeout 5s → 409 MIGRATION_IN_PROGRESS, the two 42703 fallbacks removed.`

24. **Allow files.** `docs/delivery/r16-issues/E12.plan-allow.json`:
    ```json
    { "tags_only_updates": false,
      "changes": {
        "module.api.aws_scheduler_schedule_group.this": "create",
        "module.api.aws_iam_role.scheduler": "create",
        "module.api.aws_iam_role_policy.scheduler_invoke": "create",
        "module.api.aws_scheduler_schedule.this[\"outbox-publish\"]": "create",
        "module.api.aws_scheduler_schedule.this[\"snapshot-import\"]": "create",
        "module.api.aws_scheduler_schedule.this[\"reap-orphans\"]": "create",
        "module.api.aws_lambda_function_event_invoke_config.core_vpc_prod": "create",
        "module.observability.aws_cloudwatch_metric_alarm.scheduler_errors": "create",
        "module.identity.aws_iam_role_policy.core_vpc": { "action": "update", "keys": ["policy"] } } }
    ```
    `E12.staging.plan-allow.json`: the first seven addresses only, each `"create"`, `"tags_only_updates": false`. No `outputs`, no `expect_imports` in either.

25. **Supervisor after merge (never the worker; recorded so the verify's "plan only" is understood):** (1) precondition: `scripts/invoke-as-admin.sh core-vpc:prod GET /api/v1/admin/db/migrations` shows `pending: []` and `applied` up to 21 (E03's post-apply migrated; otherwise run `db/migrate` through the old alias first — `Required = 21` would 503 every write once the new code is live); (2) prod root: `terraform init` (real backend) → `plan -out` → `check-plan.py --allow E12.plan-allow.json` → apply → staging root the same with `E12.staging.plan-allow.json`; (3) `ENV=prod ./src_C/deploy.sh` (E06's; the alias moves — E11 later inserts the migrate-by-version hook); (4) `aws lambda invoke --function-name core-vpc:prod --cli-binary-format raw-in-base64-out --payload '{"source":"developercards.scheduler","action":"health/deep","args":{},"traceId":"e12-post-apply"}' /dev/stdout` → `FunctionError` absent, `data.ok == true`, `schemaVersion == 21`; then `db/migrate` with `args.dryRun: true` → `pending: []`; (5) `ENV=staging VPC_FN=core-vpc-staging WORKER_FN=worker-lambda-staging PUBLISH_ALIAS=staging ./src_C/deploy.sh` and the same two invokes against `core-vpc-staging:staging`; (6) within 20 minutes: `aws logs filter-log-events --log-group-name /aws/lambda/core-vpc --filter-pattern '{ $.tag = "internal" }'` shows `reap-orphans` and `outbox-publish` runs with `ok:true`; `aws scheduler get-schedule --group-name developercards-prod --name reap-orphans` is `ENABLED`; (7) a second `terraform plan` in both roots is empty; (8) append gaps 2 and 3 (the two extra bounded test files) to E00 §6.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/E12.verify.sh` re-runs exactly these.

1. Scope files exist: `InternalEvents.cs`, `SchemaVersion.cs`, `scheduler.tf`, the three new test classes, both allow files (valid JSON); prerequisites on the integration branch: `infra/scripts/check-plan.py`, `infra/envs/staging/main.tf`, `PublishReaper.cs` with `ReapOrphansAsync`, `ManifestBuilder.cs`, `RouteMetrics.EmitGauge`, `Log.Event`, `OutboxPublisher.PublishBatchAsync`, `Res.ServiceUnavailable`, `Helpers.ErrorEnvelope`, `021_decks_live_build_id.sql`.
2. Literal guards (all exit 0): `SchemaVersion.cs` has the six signatures of Changes 1, `public const int Required = 21;`, the `coalesce(max(version), 0)` statement, `"SchemaBehind"`, `"/api/v1/admin/db/"`, no `requestContext`; the highest migration file is `021`; `InternalEvents.cs` has the four E00 signatures, the record line verbatim, the six action literals, `"/internal/"`, `"OutboxPending"`, `RouteMetrics.MeasureAsync(`, `InvalidOperationException`, `ReapOrphansAsync(`, `ManifestBuilder.RebuildAsync(`, `Migrate.RunAsync(`, `SchemaVersion.Required`, `"manifest_current"`, `"no_success"`, `"object_missing"`, `"also"`, `ManifestIsStale(`, and no `VerifyInternalSignature`; `VpcFunction.cs` has `InternalEvents.TryParse(evt, out var ie)` inside `Handler` before `var req = new LambdaRequest(evt);`, `SchemaVersion.GatesRoute(`, `"SERVER_NOT_READY_SCHEMA"`, `using RecallSmith.Lambda.Db;`, the six existing routes named in Changes 3 and no `/health/deep`; `Migrate.cs` has `MigrationLockId = 77889911`, `set lock_timeout = '5s'`, `reset lock_timeout`, `"55P03"`, `MigrationInProgressException`, `"MIGRATION_IN_PROGRESS"`, `RunAsync(NpgsqlConnection conn, bool dryRun)`, `ErrorEnvelope(res, 409, "MIGRATION_IN_PROGRESS"`; `ProgressEvents.cs` has no `42703`/`withCardFormat`/`ingest_card_format_fallback` and has `SchemaVersion.EnsureAsync(conn)`, `"SERVER_NOT_READY_SCHEMA"`, `BuildIngestSql()`; `PublishJobProcessor.cs` has no `42703`/`CardsSqlLegacy`/`CardsSqlTopicOnly` and ≥ 2 `SchemaVersion.EnsureAsync(`; `ContentIntelligenceSnapshotImport.cs` has `SnapshotImportResult(`, `RunAsync(`, `"etag_unchanged"`, `"object_missing"`, `and s3_etag = $3 and status = 'SUCCEEDED'`; `Warmup.cs` has `SchemaVersion.ProbeAsync(`; `OutboxPublisher.cs` has `PublishLoopAsync(` and `OutboxLoopResult(`; the three new test classes carry every method name of Changes 13–15 (`[Theory]` + `[MemberData(` in `InternalEventsTests`, `"retry-after"` + `new VpcFunction().Handler(` in `SchemaGateTests`, `Migrate.MigrationLockId` in `MigrateLockTimeoutTests`); `PublishJobProcessorSchemaTests.cs` has the two renamed cases, exactly two `Assert.ThrowsAsync<SchemaBehindException>`, and neither old name; `ProgressEventsCardFormatTests.cs` has `WithoutTheMcqColumn_IngestAnswers503SchemaBehind` + `SERVER_NOT_READY_SCHEMA` and not the old name; `IntegrationTestBase.cs` has `insert into schema_migrations`, numstat ≤ 8 added / 0 removed; `Res.cs` and `Helpers.cs` zero-diff; no suppression token in any scope file; `scheduler.tf`/`core_vpc.tf`/`alarms.tf`/`policies.tf`/`variables.tf`/`outputs.tf`/prod `main.tf` carry every literal of Changes 16–21 (names, expressions, placeholders, the two `replace` escapes, `mode = "OFF"`, retry 1 / age 600, `"AWS/Scheduler"`, `"TargetErrorCount"`, `ScheduleGroup`, period 900, `"SnsAlerts"`, `"sns:Publish"`, `var.alerts_topic_arn`, `async_failure_destination_arn = module.observability.alerts_topic_arn`, `schedule_group_name`, `developercards-alerts`); the README has the dated E12 line; no `profile =`, no forbidden construct under `infra`; both allow files carry exactly the E12 address set of Changes 24.
3. Root gates: `terraform fmt -check -recursive infra`; in `infra/envs/prod` and `infra/envs/staging`: `terraform init -backend=false -input=false && terraform validate && terraform fmt -check -recursive ..`; `cd src_C && dotnet build RecallSmith.Lambda.sln -c Release -nologo`.
4. Plans and tests (`AWS_PROFILE=dev`, read-only; Docker): prod — `init -reconfigure` + `plan -lock=false -out` in a copy of `infra/` against the real state (`s3api head-object` must succeed), `show -json`, `check-plan.py --allow E12.plan-allow.json` → `PLAN OK 9`; staging — local `backend_override.tf` in the scratch copy (empty state) + `init -input=false -reconfigure` + `-var-file=staging.auto.tfvars.example`: every effective action `create`, no `importing`, the seven E12 addresses present; content checks on both plan JSONs: each schedule's expression/action/group/`OFF`/retry/target alias and an `input` that parses as JSON, carries the three `<aws.scheduler.…>` placeholders literally and no `<`, `limit == 5000` on outbox, `also == ["manifest/rebuild"]` on reap; the invoke policy has one statement `lambda:InvokeFunction` on the alias ARN only; the trust policy names `scheduler.amazonaws.com` + `aws:SourceAccount`; the invoke config has `maximum_retry_attempts == 1` and (prod) a destination ending in `:developercards-alerts` / (staging) none; alarm 13 has the E00 metric/period/threshold/dimension; the core-vpc policy gains `SnsAlerts`; `aws iam simulate-custom-policy` on the planned documents: `lambda:InvokeFunction` on `core-vpc:prod` `allowed`, on the unqualified `core-vpc` and on `worker-lambda:prod` `implicitDeny`; `sns:Publish` on `developercards-alerts` `allowed`, on another topic `implicitDeny`; all plan files deleted; then `dotnet test … --filter` over `InternalEventsTests|SchemaGateTests|MigrateLockTimeoutTests|PublishJobProcessorSchemaTests|ProgressEventsCardFormatTests|ProgressEventsSingleStatementTests|ProgressEventsIntegrationTests|DbWarmupTests|WarmupDecisionTests|Migration015BackfillTests|ContentIntelligenceMcqTests` green.
5. Scope + frozen + OTA + guards: every changed or untracked path under `src_C`, `infra`, `docs`, `scripts` is one of the scope files (or `docs/delivery/r16-issues/*`); the frozen list of Constraints is zero-diff; `"version": "1.6.1"` in `mobile/app.json`; no `@sentry` under `mobile/src`; every existing test class other than the three bounded ones is byte-identical; no secret-shaped literal in the added lines; no tracked `.tfplan`/`.plan.json`/`generated*.tf`/real `.auto.tfvars`; no added non-comment line contains a state-changing command (`terraform apply`/`import`, `aws … create|update|delete|put-…`, `eas …`).

## Verify

```bash
BASE=delivery/r16-e-prod AWS_PROFILE=dev bash docs/delivery/r16-issues/E12.verify.sh
```

Runs steps 1–5 above (≈ 6–9 min: two plans + one Postgres container). It is the worker's own check and the driver's gate; the supervisor then applies the plans (Changes 25). The driver also runs the diff-scoped banned-term grep, the suppression scan and the two root gates (`infra`, `src_C` with Docker) — leave every other suite green.

## Do NOT

- Do NOT route scheduler events through API Gateway, sign them with `VerifyInternalSignature`, or give the scheduler role anything beyond `lambda:InvokeFunction` on the one alias ARN.
- Do NOT return a 5xx from the internal path — throw. Do NOT gate `db/migrate` or `health/deep`; do NOT expose `health/deep` as an HTTP route.
- Do NOT use `jsonencode` alone for the schedule `input` (gap 1), add `maximum_event_age_in_seconds` to the invoke config, add `count`/`for_each` to any existing resource, edit `infra/envs/prod/{variables,outputs,imports}.tf`, or pass `module.observability.alerts_topic_arn` into `module.identity`.
- Do NOT touch E03's `42703` catches (`ManifestBuilder`, `JobRepository`, `ContentIntelligence.cs`, `ContentArtifacts*`), `WorkerFunction.cs`, `SnapStartHooks.cs`, `Res.cs`, `Helpers.cs`, `deploy.sh`, `RouteMetrics.cs`, `Log.cs`, or add a migration file.
- Do NOT bump `Required` above 21, derive it at runtime from the directory, or make the gate depend on `information_schema` — `schema_migrations` is the source of truth (that is why the fixture now records it).
- Do NOT edit any existing test beyond Changes 10–12; do NOT weaken `ProgressEventsSingleStatementTests`, `DbWarmupTests` or `RouteMetricsTests` to make the gate fit — a single extra `select` in the warmup probe is fine.
