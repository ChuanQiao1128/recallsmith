# E03 — queue reliability (`queue-reliability`)

Give the publish pipeline a way to fail loudly and recover on its own. Infra (`infra/modules/worker`): a dead-letter queue `developercards-publish-jobs-dlq` (14 d retention, SQS-managed SSE), redrive after 3 receives, `visibility_timeout_seconds = 3700` (≥ 6 × the worker's 615 s timeout), and the event-source mapping moved from `$LATEST` to the `worker-lambda:prod` alias with `ReportBatchItemFailures` and a 0 s batching window. Code (`src_C`): the worker passes `ApproximateReceiveCount` into the acquire statement (whose `$2 > 1` branch is fed `1` today and therefore never runs), returns an `SQSBatchResponse` instead of rethrowing, and rebuilds `manifest.json` in-process after every successful publish through a new shared `ManifestBuilder` (the `MANIFEST_QUEUE_URL` sender that nothing consumes is deleted); migration 021 adds `decks.live_build_id` (the manifest's "live" pointer) and a partial unique index that turns a second active publish for one deck into `409 PUBLISH_IN_PROGRESS`; a super-admin `POST /api/v1/admin/decks/{deckId}/rollback` moves the pointer and rebuilds; `POST /api/v1/admin/publish/reap` fails orphaned PENDING/PROCESSING rows so the queue can re-acquire them. Four new test classes pin all of it. No mobile, no console, no docs outside `infra/README.md` §6 and this issue's own files.

## Context

Base: `delivery/r16-e-prod` (== `main@4b07f19`). Every `file:line` below was read on that tree on 2026-09-22; every AWS fact was read the same day with `AWS_PROFILE=dev` (`sts get-caller-identity` → `622994489535`, `ap-southeast-2`), `get`/`list`/`describe` only, env-var **names** only. `docs/delivery/r16-issues/E00-contracts.md` (E00) is binding: §0 non-negotiables, §1.1/§1.2 file map, §2.1 Terraform conventions, **§2.3 this issue's contract**, §3.1 plan allow-list, §3.3 server tests, §4 order (E01 → E02 → **E03** → E04), §5 verify conventions, §6 #17/#20/#21. Review: `docs/backend-architecture-review-2026-09-22.md` §2.2.1–2.2.5 (`:105-109`) and §3 row "SQS DLQ + redrive 3 + visibility 3 700 s + ESM → alias + 传 receive count" (`:186`) / "Manifest 在 worker 内重建 + live 指针 + 回滚端点" (`:192`).

What the account looks like today (read-only CLI, 2026-09-22):

- **Queue** `recallsmith-publish-jobs` (`aws sqs get-queue-attributes`): `VisibilityTimeout 300`, `MessageRetentionPeriod 345600`, `SqsManagedSseEnabled true`, **no `RedrivePolicy`**; `aws sqs list-queues` → this one queue only (no DLQ, no manifest queue).
- **Worker** `worker-lambda` (`get-function-configuration`): dotnet8, arm64, 512 MB, **`Timeout 615`**, role `core-vpc-role-joizyiwt` (shared with core-vpc until E05), `DeadLetterConfig null`, 9 env keys: `CONTENT_BUCKET`, `CONTENT_PREFIX`, `PREMIUM_BUCKET`, `PREMIUM_PREFIX`, `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` — **no `MANIFEST_QUEUE_URL`**. Alias `prod` → version `4`.
- **ESM** `29e34447-aedd-45cf-8cab-c6ca9ad94f2f` (`list-event-source-mappings`): `FunctionArn` = the **unqualified** function (`$LATEST`), `BatchSize 1`, `MaximumBatchingWindowInSeconds 60`, `FunctionResponseTypes []`, `ScalingConfig.MaximumConcurrency 2`, `State Enabled`.
- **Manifest** `s3://core-vpc/content/manifest.json` (`head-object`): `LastModified 2026-09-21T20:06:23Z`, `Metadata {}`, `Cache-Control public,max-age=60,s-maxage=60` — written by the manual super-admin POST on launch day, never by the worker.
- Provider schema (`terraform providers schema -json`, hashicorp/aws 6.66.0): `aws_sqs_queue.redrive_policy` and `.redrive_allow_policy` are Optional+Computed (a value set by the standalone `aws_sqs_queue_redrive_allow_policy` resource is not drift on the queue); `aws_lambda_event_source_mapping.function_name` is Required and updated in place (`UpdateEventSourceMapping`); the probe's curated ESM block already carries `lifecycle { ignore_changes = [metrics_config] }` and `scaling_config { maximum_concurrency = 2 }`.

What the tree looks like today:

- **Worker handler** `src_C/Worker/WorkerFunction.cs`: `public async Task FunctionHandler(SQSEvent, ILambdaContext)` `:49`, per-record loop `:51-86`, `ParseMessage(record.Body)` `:53` (throws `ArgumentException`, `:92-107` — an unhandled poison message today), `await _processor.ProcessAsync(jobId)` `:62` **never reads `record.Attributes`**, `await _manifestService.RebuildAsync()` `:66`, `catch (BusinessException)` → `FailAsync` + ack `:70-77`, `catch (Exception)` → **rethrow** `:78-85` (the comment at `:81` already states the 6× visibility rule the account ignores). Return type `Task` — `ReportBatchItemFailures` cannot be honoured. Default ctor `:26-33` news `PublishJobProcessor(new JobRepository(), new S3DeckUploader())` + `new ManifestService()`; DI ctor `(IPublishJobProcessor, IManifestService)` `:38-44`. `Amazon.Lambda.SQSEvents 2.2.1` (`Worker/RecallSmith.Lambda.Worker.csproj:17`) ships `SQSBatchResponse` / `SQSBatchResponse.BatchItemFailure` and `SQSMessage.Attributes` (verified in the local NuGet cache).
- **Processor** `src_C/Worker/Services/PublishJobProcessor.cs`: `ProcessAsync(string jobId)` `:31` → `TryAcquireJobAsync(jobId)` `:34` with the default `receiveCount = 1`; not acquired → log + `return` `:35-40` (SQS then deletes the message: an orphan); `LoadDeckDataAsync` `:91-132` opens its own connection via `Pg.OpenConnectionOrNullAsync()`; `CompleteJobAsync(jobId)` `:78`. Interface `Services/IPublishJobProcessor.cs:11` `Task ProcessAsync(string jobId)`. `PublishJobProcessorSchemaTests.cs:57,80,102` call only the static `LoadCardsAsync` — they keep compiling either way.
- **Repository** `src_C/Worker/Repositories/JobRepository.cs`: `TryAcquireJobAsync(string jobId, int receiveCount = 1)` `:13`, SQL `:18-27` with `OR (status = 'PROCESSING' AND ($2 > 1 OR updated_at < now() - interval '15 minutes'))` `:25`; `CompleteJobAsync` `:72-85` sets only `status='SUCCESS', updated_at=now()`; `FailJobAsync` `:90-104`. `IJobRepository.cs:11` already declares `receiveCount = 1`; `:21` `CompleteJobAsync(string jobId)`; `JobInfo` `:32-40` (JobId, BuildId, S3Key, DeckId, DeckSlug, Status). Every method opens its own connection through the env-driven `Pg` (`Shared/RecallSmith.Lambda.Db/Pg.cs`) — the integration fixture points `PG*` at the shared container (`IntegrationTestBase.cs:57-72`), so `JobRepository` is testable there but not against a scratch database.
- **Manifest sender** `src_C/Worker/Manifest/ManifestService.cs`: reads `MANIFEST_QUEUE_URL` `:14`, warns and returns when unset `:36-41`, otherwise `SendMessageAsync` `:43-50`; `IManifestService.cs` is the interface; `Worker/SnapStartHooks.cs:39` calls `ManifestService.Reset()`. Nothing consumes that message anywhere in the repo or the account (review §2.2.4; `docs/aws-saa-demo-deck-plan-2026-09-16.md:137` records the launch-day workaround).
- **Manifest writer** `src_C/Vpc/Authoring/ManifestRebuild.cs` (362 lines) — the only code that writes `manifest.json`: statics `ContentBucket` `:24`, `NormalizePrefix` `:26-32`, `ContentPrefix`/`PremiumPrefix`/`ManifestKey` `:34-36`, lazy `AmazonS3Client` `:38-45`, `Reset()` `:48-54` (called from `src_C/Vpc/SnapStartHooks.cs:77`), `PutJson` `:56-68` (`Cache-Control public, max-age=60, s-maxage=60` `:66`, default `JsonSerializer.Serialize` options `:63`), pure helpers `:70-116`, handler `HandleManifestRebuild(LambdaRequest, Res, AuthContext)` `:118` (`RequireSuperAdmin` `:120`, POST `:123`, `CONFIG_ERROR` `:124,:127`), `generatedAtMs` `:129`, decks query `:131-150`, newest-SUCCESS-per-slug v3/legacy queries with 42703/42P01 tolerance `:152-213`, patch edges `:215-264`, the projection `:266-348` (draft filter `:284-287`, 23 keys per deck `:306-347`), the document `:350-356` (`schemaVersion = 2` `:352`), put `:358`, response `{ ok, manifestKey, generatedAtMs, deckCount }` `:360`. Readers that must not see a different shape: `src_C/Vpc/Runtime/AdminManifest.cs:22` (same key), `src_C/Vpc/Runtime/PremiumDeckUrl.cs:235-258` (`GetObject` + parse), the frozen `mobile/src/content/deckRepository.ts`. `PremiumPrefix` (`:35`) is declared and never used by the document — E00's `RebuildAsync` signature keeps the parameter anyway.
- **Projects.** `src_C/Worker/RecallSmith.Lambda.Worker.csproj:24-25` references only `Shared/RecallSmith.Lambda.Common` and `Shared/RecallSmith.Lambda.Db` — the worker cannot call anything under `src_C/Vpc`. `Shared/RecallSmith.Lambda.Db/RecallSmith.Lambda.Db.csproj:9-11` references `Npgsql 8.0.5` only (Vpc and Worker pin `AWSSDK.S3 4.0.0`: `Vpc/RecallSmith.Lambda.Vpc.csproj:19`, `Worker/…csproj:20`; `~/.nuget/packages/awssdk.s3/4.0.0` is in the local cache, so the new reference restores offline). `AWSSDK.S3 4.0.0` has `PutObjectRequest.IfMatch` / `IfNoneMatch` and `GetObjectMetadataResponse.Metadata` / `LastModified` / `ETag` (checked in `AWSSDK.S3.xml`). `src_C/RecallSmith.Lambda.csproj` (root, globs `**/*.cs`, includes `src_C/Common/SnapStartHooks.cs:40` which also names `ManifestRebuild.Reset()`) is in no solution, no CI step and no package script — dead until E14 deletes it; E03 does not touch it.
- **Schema.** `decks` `src_C/Vpc/Db/Migrations/001_init.sql:18-30` — **no `live_build_id`**; `deck_publishes` `:213-223` (`uq_deck_publishes (deck_id, build_id)`), `007_update_deck_publishes.sql:6-12` (`job_id UNIQUE`, `status` default `'SUCCESS'`, `error_message`), `008_add_updated_at.sql:7-12` (`updated_at`), `011_content_delivery_v3.sql:10-12` (`content_sha256`, `content_bytes`, `package_key`) and `:16-27` (`deck_build_patches`). Last migration on disk: `020_cards_order_in_deck_positive.sql` (idempotent `do $$` style) — **next free number is 021**. Runner `src_C/Vpc/Db/Migrate.cs:20-47` (3-digit prefix, ordinal sort, duplicate-version guard), `ApplyOne` `:73-94` one transaction per file. Migrations ship inside the Vpc zip (`Vpc/RecallSmith.Lambda.Vpc.csproj:31-33`) and reach the test output the same way; the fixture applies every file (`IntegrationTestBase.cs:52`), `CreateScratchDatabaseAsync` + `ApplyMigrationsAsync(conn, maxVersion)` `:118-155` give a schema frozen at an older version. No existing test inserts into `deck_publishes` (grepped `src_C/Tests`), so the new partial unique index breaks nothing.
- **Publish** `src_C/Vpc/Authoring/Publish.cs`: 15-minute dedupe `:271-285` (returns 200 "Resumed existing job"), PENDING insert `:305-310`, SQS send `:317-346` (send failure → `FAILED` `:339-346`), catch clauses `:354-362` (`ValidationError` → 400, everything else → `Error500`). `Helpers.HandlePgError` `Helpers.cs:12-46` maps 23505 to **400** `UNIQUE_VIOLATION` — there is no 409 anywhere in `src_C`.
- **Responses.** `Res` (`src_C/Shared/RecallSmith.Lambda.Common/Res.cs`) has `Ok/BadRequest/Unauthorized/Forbidden/NotFound/MethodNotAllowed/NotImplemented/Error500` `:159-201` (fixed codes; `NotFound` is `NOT_FOUND`) and `Raw(int, object)` `:139-143` with camelCase options; the envelope is `{ success, data, error{code,message}, traceId, version }` `:204-219`, `version` = `API_VERSION` env ?? `"v1"` (`:25`; core-vpc sets no `API_VERSION`). `Res.cs` is **E07's** file — E03 builds its 404 `DECK_NOT_FOUND` / 409 `PUBLISH_IN_PROGRESS` envelopes through `res.Raw` in a `Helpers` function. `Auth.RequireSuperAdmin` `Auth.cs:304-310` → 403 `"Requires super_admin"`; `Auth.GetAuthContextAsync` `:210-238` honours authorizer claims carried in the event (the `CardsPageTests.cs:66-93` pattern). `Validation.ParseJsonBody(req)` `Validation.cs:30-42` (null on empty/invalid).
- **Routing** `src_C/Vpc/VpcFunction.cs`: the manifest-rebuild block is `:207-210`, followed by `// Dashboard` `:211`; `GET /api/v1/admin/decks` is `:231-234` (an `EndsWith("/api/v1/admin/decks")` that a `…/decks/{id}/rollback` path does not match). E00 §2.16: E03 inserts its two blocks **directly after `:210`**, adds nothing else, reorders nothing.
- **Deploy** `src_C/deploy.sh:38-54` publishes a version and moves the `prod` alias for both functions after `update-function-code`; its comment `:42` ("The worker's SQS trigger targets $LATEST") becomes stale with this issue — `deploy.sh` is **E06's** file, the comment is E15's to fix; E03 leaves it.
- **Console** `frontend/src/api/http.ts:17` shows `error.message` from the envelope, so the 409 text must say what to do. `AdminDecks.cs:74-83` shows `latestBuildId` = newest SUCCESS (not the pointer) — after a rollback the console lists the newer build while the manifest serves the pointer; noting it for E15's runbook, not changing the console here.

What E00 decided, and the three places this brief tightens it (recorded here because E00 §6 has no entry for them; none contradicts E00, each narrows it):

- **§2.3 infra**: DLQ + redrive-allow policy + queue update + ESM update = 2 creates, 2 updates; new module outputs `publish_dlq_arn`, `publish_dlq_name`; nothing in the root (`infra/envs/prod/outputs.tf` is E04/E09/E13's; the DLQ address `module.worker.aws_sqs_queue.publish_jobs_dlq` is what E04's alarm 8 references).
- **§2.3 code**: signatures verbatim (Changes 6–9). `JobNotAcquiredException` derives from `Exception`, not `BusinessException`, so the batch item fails and SQS redelivers.
- **Tightening 1 — the acquire branch** (E00 §2.3, seams survey caution): `$2 > 1` alone would let a duplicate delivery take over a job that is still running; E00 already pairs it with `updated_at < now() - interval '11 minutes'` (11 min > the 615 s ceiling). Kept verbatim.
- **Tightening 2 — the debounce needs proof.** E00's "skip when `HeadObject(manifest.json).LastModified > UtcNow − 10 s`" would drop a build: worker A rebuilds and puts at t1, worker B completes at tB with t0 < tB < t1 (A read the database before B committed), B sees a fresh manifest and skips — the manifest never lists B's build, and E12's later `max(updated_at) > LastModified` check does not catch it because tB < t1. E03 keeps the 10 s window as the outer condition and adds proof inside it: the builder stamps user metadata `generated-at-ms` (the `generatedAtMs` captured **before** its first query) on every put, and the worker skips only when `LastModified > UtcNow − 10 s` **and** `generated-at-ms ≥ completedAtMs + 1000` (the manifest's read provably started after this job's commit; 1 s absorbs clock skew). A 404, a manifest without the metadata (today's), or an older stamp → rebuild.
- **Tightening 3 — conditional puts.** Two concurrent rebuilds can land out of order (A read first, B put first, A's older document overwrites). `RebuildAsync` therefore puts with `IfMatch = <ETag from HeadObject>` (or `IfNoneMatch = "*"` when there is no object), and on `412 PreconditionFailed` / `409 Conflict` re-reads and rebuilds, up to three attempts. Same IAM, same key, same shape.
- **Migration 021 gains one defensive statement.** The partial unique index cannot be created while two active rows exist for one deck; the migration first marks stale active rows (`updated_at < now() − 30 min`, the reaper's PROCESSING rule) `FAILED` with `error_message = 'orphaned: pre-021 stale active row'`. Two *fresh* active rows for one deck still fail the migration — loudly, which is the right outcome.
- **42703 tolerance in exactly two places**, the `ManifestRebuild.cs:174-189` precedent: the builder's pointer query and `CompleteJobAsync`'s decks update fall back to the pre-021 behaviour when `live_build_id` does not exist yet, because `deploy.sh` ships the code before the console's Migrate click runs 021 (C05's brief accepted a 500 window for readers; a publish that fails in that window would go to the DLQ, so the worker must not). Nothing else tolerates 42703 — `DeckRollback` and the 23505→409 mapping simply need 021.
- **Worker-side plan noise.** A worker plans against an empty local state (E00 §5, obtained through the E01 brief's gap-13 `backend_override.tf` — `terraform init -backend=false` serves `validate` only, a plan after it stops with "Backend initialization required"), so its plan also shows (a) E02's resources as `create` (they exist in the account but are not in `imports.tf`, which is never edited after E01 — §6 #20), (b) the provider-side RDS `update` on `apply_immediately/skip_final_snapshot/final_snapshot_identifier` (§2.1.4; plus E02's `backup_retention_period` until its maintenance window lands it), and (c) E01's twelve root outputs as `output_changes` of kind `create`. `E03.verify.sh` step 4 filters exactly those three kinds out **before** `check-plan.py`, prints what it dropped (address + action only) and requires exactly four effective entries to remain; the supervisor's plan against the real backend has none of them and is checked unfiltered with the same `E03.plan-allow.json` (which therefore carries no `outputs` key). The scope guard (step 5) is what makes the filter safe: E03 cannot add a resource outside `infra/modules/worker`.
- **Redelivery latency is accepted.** With visibility 3700 s a failed item comes back after ~62 min and reaches the DLQ after ~3 h; that is the price of "never redeliver a running job" (review §2.2.1). The reaper (30 min PROCESSING / 10 min PENDING) is what a human reaches for in between, and E12 schedules it.

## Read first

1. `docs/delivery/r16-issues/E00-contracts.md` §0 (`:9-35`), §1.1 rows `infra/README.md` (`:47`) and `infra/modules/worker/*` (`:66`), §1.2 rows E03 (`:73-108`), §2.1.1 `modules/worker` interface (`:160-163`), §2.1.4 (`:209-211`), **§2.3 (`:223-251`)**, §3.1 (`:419-430`), §3.3 (`:436-438`), §4 (`:446-468`), §5 (`:470-482`), §6 #17 (`:502`), #20 (`:505`), #21 (`:506`).
2. `docs/backend-architecture-review-2026-09-22.md:101-109` (§2.2.1–2.2.5), `:186`, `:192`.
3. `infra/modules/worker/queue.tf`, `function.tf`, `outputs.tf`, `main.tf`, `variables.tf` as E01 left them (and E02's `retention_in_days` line in `function.tf`); `infra/README.md` §2 (WORKER SAFETY RULE), §5, §6; `infra/RUNBOOK.md` §2 (the worker plan recipe) and `docs/delivery/r16-issues/E01-terraform-adopt.md:39` (gap 13, `backend_override.tf`); `infra/scripts/check-plan.py --help`; `infra/envs/prod/imports.tf` (the five `module.worker.*` import lines); `docs/delivery/r16-issues/E02.plan-allow.json` (the allow-file shape one issue earlier).
4. `src_C/Worker/WorkerFunction.cs` (116 lines), `Services/PublishJobProcessor.cs:1-86`, `Services/IPublishJobProcessor.cs`, `Repositories/JobRepository.cs`, `Repositories/IJobRepository.cs`, `Manifest/ManifestService.cs`, `SnapStartHooks.cs`, `BusinessException.cs`, `RecallSmith.Lambda.Worker.csproj`.
5. `src_C/Vpc/Authoring/ManifestRebuild.cs` whole file (362 lines) — you are moving `:24-116` and `:129-358` into `ManifestBuilder`, line by line; `src_C/Vpc/SnapStartHooks.cs:63-81`; `src_C/Vpc/VpcFunction.cs:195-236`.
6. `src_C/Vpc/Authoring/Publish.cs:255-373`; `src_C/Vpc/Authoring/Helpers.cs:1-46`; `src_C/Shared/RecallSmith.Lambda.Common/Res.cs:94-99, 139-219`; `Auth.cs:210-310`; `Validation.cs:30-42`.
7. `src_C/Vpc/Db/Migrations/001_init.sql:18-30, 213-226`, `007_update_deck_publishes.sql`, `008_add_updated_at.sql`, `011_content_delivery_v3.sql`, `020_cards_order_in_deck_positive.sql`; `src_C/Vpc/Db/Migrate.cs:20-47, 73-94`.
8. `src_C/Shared/RecallSmith.Lambda.Db/RecallSmith.Lambda.Db.csproj`, `Pg.cs`, `DbUtil.cs` (the `$n` parameter style every new statement uses).
9. Tests: `src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs` (247 lines), `PublishJobProcessorSchemaTests.cs:33-63` (deck seeding, scratch DB), `CardsPageTests.cs:60-99` (authorizer-claims event + direct handler call), `RecallSmith.Lambda.IntegrationTests.csproj`.
10. `src_C/deploy.sh:1-58` (read only — the supervisor runs it after the apply).

## Constraints

- **Scope (the ONLY files that may change):**
  0. `src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs` — ONLY additive lines registering the two new routes (`/rollback`, `/api/v1/admin/publish/reap`) in `KnownRoutes`, ≤ 4 added / 0 removed (2026-09-22 widening: `RouteMetricsTests.RouteTable_AndTheDispatchers_NameTheSameRoutes` requires every dispatched route to be registered; E04 owns the rest of the file and merges after E03).
  1. `infra/modules/worker/queue.tf` (E)
  2. `infra/modules/worker/function.tf` (E — the ESM block only)
  3. `infra/modules/worker/outputs.tf` (E — append two outputs)
  4. `infra/README.md` (E — one dated line appended to §6)
  5. `docs/delivery/r16-issues/E03.plan-allow.json` (new; content in Changes 4)
  6. `src_C/Vpc/Db/Migrations/021_decks_live_build_id.sql` (new)
  7. `src_C/Shared/RecallSmith.Lambda.Db/ManifestBuilder.cs` (new)
  8. `src_C/Shared/RecallSmith.Lambda.Db/RecallSmith.Lambda.Db.csproj` (E — one `PackageReference`)
  9. `src_C/Vpc/Authoring/ManifestRebuild.cs` (E)
  10. `src_C/Vpc/Authoring/Publish.cs` (E — one catch clause)
  11. `src_C/Vpc/Authoring/Helpers.cs` (E — two functions appended)
  12. `src_C/Vpc/Authoring/DeckRollback.cs` (new)
  13. `src_C/Vpc/Authoring/PublishReaper.cs` (new)
  14. `src_C/Vpc/VpcFunction.cs` (E — add-only, two blocks after `:210`)
  15. `src_C/Vpc/SnapStartHooks.cs` (E — one line)
  16. `src_C/Worker/WorkerFunction.cs` (E)
  17. `src_C/Worker/Services/IPublishJobProcessor.cs` (E)
  18. `src_C/Worker/Services/PublishJobProcessor.cs` (E — `ProcessAsync` only)
  19. `src_C/Worker/Repositories/JobRepository.cs` (E — two statements)
  20. `src_C/Worker/SnapStartHooks.cs` (E — one line)
  21. `src_C/Worker/Manifest/ManifestService.cs` (D), `src_C/Worker/Manifest/IManifestService.cs` (D) — the directory disappears
  22. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/WorkerReceiveCountTests.cs` (new)
  23. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/ManifestBuilderTests.cs` (new)
  24. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/DeckRollbackTests.cs` (new)
  25. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/PublishReaperTests.cs` (new)
  Nothing else: no `infra/envs/**` (not `main.tf`, not `outputs.tf`, not `imports.tf`), no other module, no `infra/scripts/**`, no `src_C/deploy.sh`, no `src_C/Worker/Repositories/IJobRepository.cs`, no `Res.cs`/`Auth.cs`/`Validation.cs`, no `AdminManifest.cs`/`PremiumDeckUrl.cs`/`AdminDecks.cs`/`PublishStatus.cs`/`PublishJobs.cs`/`Dashboard.cs`, no `Migrate.cs`, no other `.csproj`, no `src_C/Common/**`, no `src_C/RecallSmith.Lambda.csproj`, no `mobile/`, no `frontend/`, no `docs/*.md`, no `.github/`.
- **WORKER SAFETY RULE:** a worker may run read-only AWS CLI, `terraform init/validate/plan` (plan must be saved with -out and shown as JSON), but NEVER `terraform apply`, `terraform import` (state-changing), `aws ... create/update/delete/put`, `eas`, or any deploy script. The supervisor applies plans after each merge. Each infra brief's verify.sh therefore checks the PLAN (terraform show -json) against an explicit allow-list of resource addresses and actions — nothing else may appear as create/update/delete.
  Consequences here: `terraform init -backend=false -input=false` for the root gate; for the plan, the E01 brief's gap-13 recipe (`docs/delivery/r16-issues/E01-terraform-adopt.md:39`; `infra/RUNBOOK.md` §2): the gitignored `infra/envs/prod/backend_override.tf` with a `backend "local"` path under `mktemp -d`, `terraform init -input=false -reconfigure`, `terraform plan -input=false -var-file=<prod.auto.tfvars.example minus the external_id line> -out=…`, then delete the override — the S3 state bucket is never contacted. The plan JSON holds Lambda `environment` values in clear (E00 §0) — never paste it, never commit it, `rm -f` it; quote only `check-plan.py`'s `address  actions  keys` lines. Read-only CLI you may use to confirm facts: `aws sqs get-queue-attributes`, `aws lambda list-event-source-mappings`, `aws lambda get-alias`, `aws s3api head-object`. `DRY_RUN=1 ./deploy.sh` packages only — you never need it here.
- **Frozen files (E00 §0) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. Nothing under `mobile/` changes.
- **OTA rule:** `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json` (`"version": "1.6.1"`), `mobile/eas.json` byte-identical; no `@sentry` anywhere.
- **Manifest byte-compatibility:** the document `ManifestBuilder` writes has the same four top-level keys in the same order (`schemaVersion`, `prefix`, `generatedAtMs`, `decks`), the same 23 deck keys in the order of `ManifestRebuild.cs:308-346`, the same patch-edge keys (`fromVersion`, `toVersion`, `path`, `sha256`), the same default `JsonSerializer.Serialize` options, `schemaVersion = 2`, the same `Content-Type` and `Cache-Control`. New: user metadata only. `AdminManifest.cs`, `PremiumDeckUrl.cs` and the phone read it unchanged.
- **No renames (E00 §0):** the queue stays `recallsmith-publish-jobs`, the function `worker-lambda`, the alias `prod`, the ESM keeps its uuid (an in-place `update` — if your plan shows `replace` for the ESM, stop and report; do not widen the allow-list). New resource names carry the `developercards-` prefix.
- **Terraform hygiene (E00 §0, §2.1.4):** no `provisioner`, `null_resource`, `local-exec`, `external`, `archive_file`, `profile =`, no explicit `tags` (E02's `default_tags` cover new resources), no `.tfplan`/`.plan.json`/`generated*.tf`/`*.auto.tfvars` tracked, `.terraform.lock.hcl` untouched. `terraform fmt` clean.
- **Secrets:** no `PGPASSWORD`/`MIGRATE_SECRET`/`INTERNAL_SHARED_SECRET`/`RC_WEBHOOK_AUTH_*` value in any file, log line or PR comment; the two env-var names E00 §0 calls unspellable are not written anywhere.
- **Existing tests:** every existing test file is byte-identical (`PublishJobProcessorSchemaTests.cs` included — the `receiveCount` default is what keeps it compiling). The full suite (`cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests`, Docker) stays green: the fixture now applies 021, and the partial unique index tolerates every existing seed.
- **Tests that may change:** only the four new classes. Real Postgres via the shared fixture for three of them; `WorkerReceiveCountTests` is pure (no fixture, no `[Collection]`) — in-file fakes for `IPublishJobProcessor`, `IJobRepository`, `IS3DeckUploader`, `IContentArtifactsGenerator`; no mocking library, no new `PackageReference` in the test project. xunit `[Theory]` + `[InlineData]`/`[MemberData]` tables for the pure rules (E00 §3.3).
- **Banned literals in any added line** (driver gate, case-insensitive): the six terms of B00 §0 — do not reproduce them, not even in a comment; say "work around", "sidestep", "guard", "fallback", "probe". No `[Fact(Skip = …)]` / `[Theory(Skip = …)]`, no `#pragma warning disable`, no `@ts-ignore`/`@ts-expect-error`/`eslint-disable`/`.skip(`/`.only(` anywhere in the diff.
- **Never copy ExamTopics / SAA-C03 content.** Test fixtures use neutral strings (`"q"`, `"deck a"`, `it-e03-…` slugs).
- **No network beyond the plan and read-only CLI:** `dotnet build`/`test` restore from the local cache (`awssdk.s3/4.0.0` is cached); `terraform init` reuses `TF_PLUGIN_CACHE_DIR`; no `npm`, no `eas`, no `dotnet restore` by hand, no git in `/Users/qc/src/recallsmith` (only in your worktree).

## Changes required

### Infra (`infra/modules/worker`)

1. **`queue.tf` — DLQ, redrive, visibility.** Keep every attribute E01 curated on `aws_sqs_queue.publish_jobs` and change/add exactly this:
   ```hcl
   resource "aws_sqs_queue" "publish_jobs_dlq" {
     name                      = "developercards-publish-jobs-dlq"
     message_retention_seconds = 1209600
     sqs_managed_sse_enabled   = true
   }

   resource "aws_sqs_queue" "publish_jobs" {
     # … E01's attributes unchanged (name, policy, message_retention_seconds = 345600, sqs_managed_sse_enabled = true, …)
     visibility_timeout_seconds = 3700
     redrive_policy = jsonencode({
       deadLetterTargetArn = aws_sqs_queue.publish_jobs_dlq.arn
       maxReceiveCount     = 3
     })
   }

   resource "aws_sqs_queue_redrive_allow_policy" "publish_jobs_dlq" {
     queue_url = aws_sqs_queue.publish_jobs_dlq.id
     redrive_allow_policy = jsonencode({
       redrivePermission = "byQueue"
       sourceQueueArns   = [aws_sqs_queue.publish_jobs.arn]
     })
   }
   ```
   No `redrive_allow_policy` attribute on either `aws_sqs_queue` (the provider documents the two forms as mutually exclusive; the standalone resource is the one E00 names). No `tags`, no `kms_master_key_id`, no `policy` on the DLQ (the default owner policy is fine and Computed). The DLQ's `visibility_timeout_seconds` stays at the provider default (30) — nothing consumes it.

2. **`function.tf` — the ESM.** Only the `aws_lambda_event_source_mapping.worker_sqs` block changes; the function, alias and log group blocks stay byte-identical:
   ```hcl
   resource "aws_lambda_event_source_mapping" "worker_sqs" {
     event_source_arn                   = aws_sqs_queue.publish_jobs.arn
     function_name                      = aws_lambda_alias.worker_prod.arn
     enabled                            = true
     batch_size                         = 1
     maximum_batching_window_in_seconds = 0
     function_response_types            = ["ReportBatchItemFailures"]
     scaling_config {
       maximum_concurrency = 2
     }
     lifecycle {
       ignore_changes = [metrics_config]
     }
   }
   ```
   (`event_source_arn` may already be the expression or the literal ARN E01 chose — keep E01's spelling; the plan must not show it as changed.)

3. **`outputs.tf` — append:**
   ```hcl
   output "publish_dlq_arn" {
     value = aws_sqs_queue.publish_jobs_dlq.arn
   }

   output "publish_dlq_name" {
     value = aws_sqs_queue.publish_jobs_dlq.name
   }
   ```
   No new `variable`. Nothing in `infra/envs/prod/*`.

4. **`docs/delivery/r16-issues/E03.plan-allow.json`** (E00 §3.1 format; the verify pins it after JSON normalisation, so key order and whitespace are free but nothing may be added or dropped):
   ```json
   {
     "tags_only_updates": false,
     "changes": {
       "module.worker.aws_sqs_queue.publish_jobs_dlq": "create",
       "module.worker.aws_sqs_queue_redrive_allow_policy.publish_jobs_dlq": "create",
       "module.worker.aws_sqs_queue.publish_jobs": { "action": "update", "keys": ["visibility_timeout_seconds", "redrive_policy"] },
       "module.worker.aws_lambda_event_source_mapping.worker_sqs": { "action": "update", "keys": ["function_name", "maximum_batching_window_in_seconds", "function_response_types"] }
     }
   }
   ```
   `redrive_policy` may be `after_unknown` at plan time (it references the DLQ's ARN); listing it keeps the allow file valid whichever way `check-plan.py` counts it.

5. **`infra/README.md` §6 — one line**, in the format E01/E02 used, e.g. `- 2026-09-2x E03: DLQ developercards-publish-jobs-dlq (14 d) + redrive 3, publish queue visibility 3700 s, ESM → worker-lambda:prod with ReportBatchItemFailures and window 0; outputs publish_dlq_arn/publish_dlq_name.` Nothing else in that file.

### Shared

6. **`src_C/Shared/RecallSmith.Lambda.Db/ManifestBuilder.cs`** (new, `namespace RecallSmith.Lambda.Db;`) — the port of `ManifestRebuild.cs:24-116` and `:129-358`, statics replaced by parameters. Public surface (E00 §2.3's two members verbatim, plus the five helpers the tests and the two callers need):
   ```csharp
   public sealed record ManifestBuildResult(int DeckCount, int PatchEdgeCount, string Key, string ETag, long GeneratedAtMs);
   public sealed record ManifestBody(string Json, int DeckCount, int PatchEdgeCount);

   public static class ManifestBuilder
   {
     public const string GeneratedAtMetadataKey = "generated-at-ms";           // S3 user metadata, x-amz-meta- prefixed by the SDK
     public static string NormalizePrefix(string? raw, string fallback);        // ManifestRebuild.cs:26-32 verbatim
     public static string ManifestKey(string contentPrefix) => $"{contentPrefix}/manifest.json";
     public static IAmazonS3 S3();                                                // lazy AmazonS3Client, AWS_REGION ?? "ap-southeast-2"
     public static void Reset();                                                  // called from both SnapStartHooks
     public static Task<ManifestBody> BuildAsync(NpgsqlConnection conn, string contentPrefix, long generatedAtMs);   // DB → JSON string, no S3
     public static Task<ManifestBuildResult> RebuildAsync(NpgsqlConnection conn, IAmazonS3 s3, string bucket, string contentPrefix, string premiumPrefix, long? nowMs = null);
   }
   ```
   - `BuildAsync`: (a) the decks query `ManifestRebuild.cs:131-150` verbatim; (b) **new** pointer query, `"42703"`-tolerant (missing `live_build_id` → empty dictionary), `"42P01"`-tolerant like the others:
     ```sql
     select p.deck_slug, p.build_id, p.s3_key, p.content_sha256, p.package_key
     from deck_publishes p
     join decks d on d.id = p.deck_id and d.live_build_id = p.build_id
     where p.status = 'SUCCESS';
     ```
     (c) the newest-SUCCESS v3/legacy queries `:152-213` verbatim as the fallback; (d) patch edges `:215-264` verbatim; (e) the projection `:266-348` verbatim (down to `previewPatches = (object?)null`) except `latestBuild = availability == "live" ? (pointed.TryGetValue(slug, …) ? … : latest.TryGetValue(slug, …) ? … : null) : null` — the pointer wins, else newest SUCCESS, else the draft filter `:284-287` drops the deck; (f) the document `:350-356` (`schemaVersion = 2`) with `generatedAtMs` = the parameter and `prefix = contentPrefix`; (g) serialise with `System.Text.Json.JsonSerializer.Serialize(obj)` (default options, exactly `:63`), return `ManifestBody(json, outDecks.Count, <number of patch edges emitted>)`. Helpers `ToInt/ToLong/InferTier/NormalizeAvailability/DeriveDownloadMode/DerivePreviewCards` move over as `private static`; the records `LatestBuildInfo`/`PatchEdgeRow` too.
   - `RebuildAsync`: `var key = ManifestKey(contentPrefix); var generatedAtMs = nowMs ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();` then up to **3 attempts** of: `HeadObject` (`GetObjectMetadataAsync`; `AmazonS3Exception` with `StatusCode == HttpStatusCode.NotFound` → no object) → `BuildAsync` → `PutObjectRequest { BucketName = bucket, Key = key, ContentBody = body.Json, ContentType = "application/json; charset=utf-8" }`, `put.Headers.CacheControl = "public, max-age=60, s-maxage=60"`, `put.Metadata[GeneratedAtMetadataKey] = generatedAtMs.ToString(CultureInfo.InvariantCulture)`, and `put.IfMatch = head.ETag` when the object existed, else `put.IfNoneMatch = "*"`; on `AmazonS3Exception` whose `StatusCode` is `HttpStatusCode.PreconditionFailed` or `HttpStatusCode.Conflict` → next attempt; on success return `new ManifestBuildResult(body.DeckCount, body.PatchEdgeCount, key, putResponse.ETag ?? string.Empty, generatedAtMs)`. After the third conflict `throw new InvalidOperationException("manifest.json changed under 3 consecutive rebuild attempts")`. `premiumPrefix` is accepted and unused (the document never carried it; E00 fixes the signature). `bucket` empty → `InvalidOperationException("Missing env CONTENT_BUCKET")` as `:58` did.
   - `S3()`/`Reset()`: the `:38-54` pattern (`private static AmazonS3Client? _s3`, dispose on reset).

7. **`RecallSmith.Lambda.Db.csproj`** — add `<PackageReference Include="AWSSDK.S3" Version="4.0.0" />` next to `<PackageReference Include="Npgsql" Version="8.0.5" />` (which stays; E14 lifts it) — exactly two `PackageReference` lines afterwards. Nothing else.

### Vpc

8. **`ManifestRebuild.cs`** shrinks to the handler: keep `ContentBucket` (`:24`), `ContentPrefix`/`PremiumPrefix` via `ManifestBuilder.NormalizePrefix`, and `HandleManifestRebuild(LambdaRequest req, Res res, AuthContext auth)` with the same `RequireSuperAdmin` → `405` → `CONFIG_ERROR` → open-connection sequence (`:120-127`), then `var r = await ManifestBuilder.RebuildAsync(conn, ManifestBuilder.S3(), ContentBucket, ContentPrefix, PremiumPrefix);` and `return res.Ok(new { ok = true, manifestKey = r.Key, generatedAtMs = r.GeneratedAtMs, deckCount = r.DeckCount });` (the `:360` shape, same four keys). Delete `_s3`/`S3()`/`Reset()`/`PutJson`/the helpers/the records/the queries — the file ends well under 80 lines and no longer mentions `schemaVersion`, `distinct on` or `AmazonS3Client`. Route and method unchanged (`VpcFunction.cs:207-210` untouched).

9. **`src_C/Vpc/SnapStartHooks.cs:77`** becomes `try { ManifestBuilder.Reset(); } catch { /* best-effort */ }` (add `using RecallSmith.Lambda.Db;` if the file lacks it; the other reset lines stay).

10. **`Helpers.cs`** — append two functions (nothing existing changes; `HandlePgError` keeps mapping the four named constraints to 400):
    ```csharp
    public static APIGatewayProxyResponse ErrorEnvelope(Res res, int statusCode, string code, string message) =>
      res.Raw(statusCode, new { success = false, data = (object?)null, error = new { code, message }, traceId = res.TraceId, version = "v1" });

    public static APIGatewayProxyResponse? MapUniqueViolation409(Exception ex, Res res)
    {
      if (ex is not PostgresException { SqlState: "23505", ConstraintName: "uq_deck_publishes_active" }) return null;
      return ErrorEnvelope(res, 409, "PUBLISH_IN_PROGRESS",
        "A publish for this deck is still PENDING or PROCESSING. Wait for the worker, or run POST /api/v1/admin/publish/reap and retry.");
    }
    ```
    (`Raw` serialises with the camelCase options, so the body has the envelope's five keys in the envelope's order.)

11. **`Publish.cs`** — one catch clause inserted **before** `catch (Exception ex) when (ex is ValidationError)` (`:354`), nothing else:
    ```csharp
    catch (PostgresException pg) when (pg.SqlState == "23505")
    {
      return Helpers.MapUniqueViolation409(pg, res) ?? res.Error500(pg);
    }
    ```
    The 15-minute dedupe (`:271-285`) stays and still answers 200 "Resumed existing job" for a fresh active row; 409 is what the index says for an active row older than 15 minutes (a dead worker the reaper has not reached yet).

12. **`src_C/Vpc/Authoring/DeckRollback.cs`** (new):
    ```csharp
    public static class DeckRollback
    {
      public delegate Task<ManifestBuildResult> ManifestRebuildFn(NpgsqlConnection conn);
      public static long? ParseDeckId(string path);                 // "/api/v1/admin/decks/{id}/rollback" → id; null unless the segment between is a positive long
      public static Task<APIGatewayProxyResponse> HandleDeckRollback(LambdaRequest req, Res res, AuthContext auth) => HandleDeckRollback(req, res, auth, DefaultRebuildAsync);
      public static async Task<APIGatewayProxyResponse> HandleDeckRollback(LambdaRequest req, Res res, AuthContext auth, ManifestRebuildFn rebuild);
    }
    ```
    Order inside the 4-arg handler: `Auth.RequireSuperAdmin` (403) → `req.Method != "POST"` → `res.MethodNotAllowed("Method not allowed")` → `ParseDeckId(req.Path.TrimEnd('/'))` null → `res.BadRequest("VALIDATION_ERROR", "deckId must be a positive integer")` → body via `Validation.ParseJsonBody`, `buildId` must be a non-empty string → else `res.BadRequest("VALIDATION_ERROR", "buildId is required")` → open connection (`CONFIG_ERROR` as `ManifestRebuild.cs:127`) → `select id, slug, live_build_id from decks where id = $1 and is_deleted = 0` none → `Helpers.ErrorEnvelope(res, 404, "DECK_NOT_FOUND", $"Deck {deckId} not found")` → `select 1 from deck_publishes where deck_id = $1 and build_id = $2 and status = 'SUCCESS'` none → `res.BadRequest("VALIDATION_ERROR", $"No SUCCESS build {buildId} for deck {deckId}")` → `update decks set live_build_id = $2 where id = $1` (only that column — `decks.updated_at` is `AdminDecks.cs:74`'s keyset cursor) → `await rebuild(conn)` → `res.Ok(new { deckId, slug, liveBuildId = buildId, previousBuildId, manifestRebuilt = true })` where `previousBuildId` is the old pointer (nullable). `DefaultRebuildAsync(conn)` = `ManifestBuilder.RebuildAsync(conn, ManifestBuilder.S3(), CONTENT_BUCKET, NormalizePrefix(CONTENT_PREFIX,"content"), NormalizePrefix(PREMIUM_PREFIX,"premium"))` with the `Missing env CONTENT_BUCKET` throw. Unhandled exceptions → `res.Error500(ex)`.

13. **`src_C/Vpc/Authoring/PublishReaper.cs`** (new):
    ```csharp
    public sealed record ReapResult(int Pending, int Processing, string[] JobIds);
    public static class PublishReaper
    {
      public static async Task<ReapResult> ReapOrphansAsync(NpgsqlConnection conn);     // the statement below, one round trip
      public static async Task<APIGatewayProxyResponse> HandlePublishReap(LambdaRequest req, Res res, AuthContext auth);
    }
    ```
    Statement (E00 §2.3 verbatim, through `DbUtil.QueryAsync`):
    ```sql
    update deck_publishes
    set status = 'FAILED', error_message = 'orphaned: no worker pickup', updated_at = now()
    where (status = 'PENDING' and created_at < now() - interval '10 minutes')
       or (status = 'PROCESSING' and updated_at < now() - interval '30 minutes')
    returning job_id, status
    ```
    `Pending`/`Processing` count the returned rows by their **pre-update** status (`returning status` yields `'FAILED'` for every row — count by re-selecting or, simpler, use two CTEs: `with p as (update … where status='PENDING' … returning job_id), q as (update … where status='PROCESSING' … returning job_id) select 'PENDING' as was, job_id from p union all select 'PROCESSING', job_id from q` — either form is acceptable as long as the four literals above appear and the counts are right). Handler: `RequireSuperAdmin` → POST only (405) → connection (`CONFIG_ERROR`) → `res.Ok(new { pending = r.Pending, processing = r.Processing, jobIds = r.JobIds })`. E12 reuses `ReapOrphansAsync` — keep it free of `Res`.

14. **`VpcFunction.cs`** — insert directly after line 210 (`}` of the manifest-rebuild block), before `// Dashboard`, add-only:
    ```csharp
    if (p.EndsWith("/rollback", StringComparison.OrdinalIgnoreCase) && p.Contains("/api/v1/admin/decks/", StringComparison.OrdinalIgnoreCase))
    {
      return await Vpc.Authoring.DeckRollback.HandleDeckRollback(req, res, auth);
    }
    if (p.EndsWith("/api/v1/admin/publish/reap", StringComparison.OrdinalIgnoreCase))
    {
      return await Vpc.Authoring.PublishReaper.HandlePublishReap(req, res, auth);
    }
    ```
    (Method checks live in the handlers so GET answers 405, not 404.) No other line of the file changes.

15. **`src_C/Vpc/Db/Migrations/021_decks_live_build_id.sql`** (new; header comment names the file and the two endpoints it serves; four statements, every one idempotent):
    ```sql
    alter table decks add column if not exists live_build_id text null;

    update decks d
    set live_build_id = p.build_id
    from (
      select distinct on (deck_slug) deck_slug, build_id
      from deck_publishes
      where status = 'SUCCESS'
      order by deck_slug, created_at desc
    ) p
    where p.deck_slug = d.slug
      and d.live_build_id is null;

    update deck_publishes
    set status = 'FAILED',
        error_message = 'orphaned: pre-021 stale active row',
        updated_at = now()
    where status in ('PENDING', 'PROCESSING')
      and updated_at < now() - interval '30 minutes';

    create unique index if not exists uq_deck_publishes_active
      on deck_publishes(deck_id)
      where status in ('PENDING', 'PROCESSING');
    ```
    No `not null`, no `default`, no `drop`, no `check`, no `$$` block (plain statements; `Migrate.ApplyOne` wraps the file in one transaction).

### Worker

16. **`Services/IPublishJobProcessor.cs`** — `Task ProcessAsync(string jobId, int receiveCount = 1);` (doc comment: "receiveCount = SQS ApproximateReceiveCount; 1 on first delivery") and, in the same file after the interface:
    ```csharp
    /// A redelivery found the row PROCESSING and not yet stale: another container may still be
    /// running it. Not a BusinessException on purpose — the batch item fails and SQS redelivers.
    public sealed class JobNotAcquiredException : Exception
    {
      public JobNotAcquiredException(string jobId) : base($"Job {jobId} is PROCESSING and not stale; leaving it for the running worker") { }
    }
    ```

17. **`Services/PublishJobProcessor.cs`** — `public async Task ProcessAsync(string jobId, int receiveCount = 1)`; `TryAcquireJobAsync(jobId, receiveCount)`; when not acquired: `var row = await _jobRepository.GetJobAsync(jobId); if (row is null || row.Status == "SUCCESS") { log "already completed or unknown; acknowledging replay"; return; } throw new JobNotAcquiredException(jobId);`. Lines `:42-80` unchanged, and `public static async Task<List<CardExportData>> LoadCardsAsync(NpgsqlConnection conn, int deckId)` (`:192`) keeps its signature.

18. **`Repositories/JobRepository.cs`** — two statements:
    - `TryAcquireJobAsync` line `:25` becomes exactly
      `OR (status = 'PROCESSING' AND (($2 > 1 AND updated_at < now() - interval '11 minutes') OR updated_at < now() - interval '15 minutes'))`
      (11 min > the 615 s ceiling: a redelivery takes over only a row no container can still be running; the 15-min branch keeps today's behaviour for a first delivery).
    - `CompleteJobAsync` (`:77-84`) becomes one statement (atomic, no explicit transaction needed):
      ```sql
      with done as (
        update deck_publishes
        set status = 'SUCCESS', updated_at = now()
        where job_id = $1
        returning deck_id, build_id
      )
      update decks d
      set live_build_id = done.build_id
      from done
      where d.id = done.deck_id
      ```
      with a `catch (PostgresException pg) when (pg.SqlState == "42703")` that runs the old two-column update (`:78-81`) instead — the pre-021 window between `deploy.sh` and the console's Migrate click. Signature `CompleteJobAsync(string jobId)` unchanged (`build_id` comes from the row, so `IJobRepository.cs` is untouched).

19. **`WorkerFunction.cs`** — the handler:
    ```csharp
    public WorkerFunction() : this(new PublishJobProcessor(new JobRepository(), new S3DeckUploader()), RebuildManifestAfterAsync) { SnapStartHooks.RegisterOnce(); }
    public WorkerFunction(IPublishJobProcessor processor, Func<long, Task> rebuildManifest);        // the hook receives completedAtMs
    public async Task<SQSBatchResponse> FunctionHandler(SQSEvent sqsEvent, ILambdaContext context);
    public static bool ManifestCoversJob(DateTime? lastModifiedUtc, string? generatedAtMsMeta, long completedAtMs, DateTime utcNow);
    ```
    Per record, in this order, **never rethrowing**: `receiveCount` = `record.Attributes is not null && record.Attributes.TryGetValue("ApproximateReceiveCount", out var rc) && int.TryParse(rc, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) && n > 0 ? n : 1`; `ParseMessage` failure → log + `failures.Add(new SQSBatchResponse.BatchItemFailure { ItemIdentifier = record.MessageId })`; `await _processor.ProcessAsync(jobId, receiveCount)`; `var completedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();` `await _rebuildManifest(completedAtMs)`; `catch (BusinessException ex)` → `FailAsync` + log (a throw inside `FailAsync` is a system error → item failure); `catch (JobNotAcquiredException)` and `catch (Exception)` → log + item failure. Return `new SQSBatchResponse { BatchItemFailures = failures }` (empty list = whole batch acknowledged). `ManifestCoversJob`: `false` when `lastModifiedUtc` is null; `false` when `lastModifiedUtc <= utcNow - TimeSpan.FromSeconds(10)`; `false` when `generatedAtMsMeta` does not parse as a long; else `generatedAtMs >= completedAtMs + 1000`. `RebuildManifestAfterAsync(long completedAtMs)` (private static): bucket = `CONTENT_BUCKET` (missing → `InvalidOperationException`), prefixes via `ManifestBuilder.NormalizePrefix`, `head` = `GetObjectMetadataAsync` or null on `NotFound`, `meta` = `head.Metadata.Keys.Contains("x-amz-meta-generated-at-ms") ? head.Metadata["generated-at-ms"] : null`; if `ManifestCoversJob(head?.LastModified?.ToUniversalTime(), meta, completedAtMs, DateTime.UtcNow)` → log "manifest already covers this job; skipping rebuild" and return; else open `Pg.OpenConnectionOrNullAsync()` (null → `InvalidOperationException`) and `await ManifestBuilder.RebuildAsync(conn, ManifestBuilder.S3(), bucket, contentPrefix, premiumPrefix)`; log `deckCount`/`generatedAtMs`. Remove `using RecallSmith.Lambda.Worker.Manifest;` and the `IManifestService` field; keep `ParseMessage`/`LogWithJobId`; the `:81-82` comment moves to the class summary ("visibility 3700 s ≥ 6 × 615 s, set in infra/modules/worker/queue.tf").

20. **`src_C/Worker/SnapStartHooks.cs:39`** becomes `try { Lambda.Db.ManifestBuilder.Reset(); } catch { /* best-effort */ }` (drop `using RecallSmith.Lambda.Worker.Manifest;`). Delete `src_C/Worker/Manifest/ManifestService.cs` and `IManifestService.cs` (the directory goes with them). `AWSSDK.SQS` stays in the worker csproj (untouched file) even though nothing uses it now — E14 cleans packages.

### Tests (`src_C/Tests/RecallSmith.Lambda.IntegrationTests/`)

21. **`WorkerReceiveCountTests.cs`** — no `[Collection]`; in-file `FakeProcessor : IPublishJobProcessor` (records `(jobId, receiveCount)`, throws what a test tells it to, records `FailAsync` calls), `FakeJobRepository : IJobRepository`, `FakeUploader : IS3DeckUploader`, `FakeArtifacts : IContentArtifactsGenerator`; SQS records built by hand (`new SQSEvent.SQSMessage { MessageId, Body, Attributes = new Dictionary<string,string>{["ApproximateReceiveCount"]="3"} }`). Method names:
    `FunctionHandler_PassesApproximateReceiveCount`, `FunctionHandler_MissingAttribute_DefaultsToOne`, `FunctionHandler_MalformedBody_ReportsItemFailure`, `FunctionHandler_JobNotAcquired_ReportsItemFailureWithoutFailing`, `FunctionHandler_BusinessException_MarksFailedAndAcks`, `FunctionHandler_SystemException_ReportsItemFailureWithoutFailing`, `FunctionHandler_Success_RunsManifestHookOnce`, `FunctionHandler_ManifestHookThrows_ReportsItemFailure`, `FunctionHandler_MixedBatch_ReportsOnlyFailedMessageIds` (three records: ok / bad JSON / throwing → exactly two `ItemIdentifier`s, the right ones), `ManifestCoversJob_Table` (`[Theory]`, ≥ 5 rows: null head → false; fresh + stamp ≥ completed+1000 → true; fresh + no stamp → false; fresh + stamp = completed+999 → false; stamp fine but LastModified 11 s old → false), `ProcessAsync_NotAcquiredWhileProcessing_Throws` (`Assert.ThrowsAsync<JobNotAcquiredException>`), `ProcessAsync_NotAcquiredAfterSuccess_ReturnsQuietly`, `ProcessAsync_NotAcquiredAndAbsent_ReturnsQuietly` (fake repository returns `false` then a `JobInfo{Status="PROCESSING"}` / `{Status="SUCCESS"}` / `null`; the uploader is never touched). Also assert `typeof(JobNotAcquiredException).IsSubclassOf(typeof(BusinessException))` is **false** inside the JobNotAcquired test.

22. **`ManifestBuilderTests.cs`** — `[Collection(PostgresCollection.Name)]`; seeds through raw SQL (the `PublishJobProcessorSchemaTests.cs:33-40` style; `it-e03-…` slugs, unique per test; `deck_publishes` rows need `job_id`, `build_id`, `s3_key`, `deck_id`, `deck_slug`, `status`, and for the pointer tests `content_sha256`/`package_key`). Every `Build_*` test calls `ManifestBuilder.BuildAsync(conn, "content", 1700000000000)` and parses `Json` with `JsonDocument`. Method names:
    `Build_GoldenShape_PinsKeyOrder` (top-level keys exactly `schemaVersion, prefix, generatedAtMs, decks` in order, `schemaVersion == 2`, `generatedAtMs == 1700000000000`, `prefix == "content"`; the test's free live deck has exactly the 23 keys of `ManifestRebuild.cs:308-346` in that order, and one patch edge with keys `fromVersion, toVersion, path, sha256` — assert with `EnumerateObject().Select(p => p.Name)`), `Build_LivePointer_WinsOverNewestSuccess` (two SUCCESS builds, pointer on the older → `buildId`, `version`, `path`, `sha256`, `packagePath` all from the older row), `Build_NullPointer_FallsBackToNewestSuccess`, `Build_LiveDeckWithoutSuccess_IsOmitted`, `Build_PremiumDeck_CarriesPreviewFieldsOnly` (`path` null, `previewBuildId == buildId + "-preview"`, `previewPath` set, `sha256`/`packagePath`/`patches` null), `Build_PatchEdges_NewestFourPerSlug` (six edges seeded → four emitted, newest first), `Migration021_BackfillsPointerAndAddsPartialIndex` (scratch DB `e03_mig021` migrated to 20, seed a deck with two SUCCESS rows, apply 21 → `live_build_id` = newest; `select 1 from pg_indexes where indexname = 'uq_deck_publishes_active'`; a second `PENDING` row for the same deck throws `PostgresException` with `SqlState "23505"` and `ConstraintName "uq_deck_publishes_active"`), `Migration021_ReapsStaleActiveRowsBeforeIndex` (scratch DB `e03_mig021b`: two PENDING rows for one deck, one with `updated_at = now() - interval '40 minutes'` → 21 applies, the stale one is `FAILED` with `error_message = 'orphaned: pre-021 stale active row'`, the fresh one stays PENDING), `CompleteJob_SetsSuccessAndMovesPointer` (real `JobRepository` on the shared DB: PROCESSING row → `CompleteJobAsync` → status SUCCESS and `decks.live_build_id == build_id`), `TryAcquire_RedeliveryTakesOverOnlyStaleProcessing` (`[Theory]` over `(receiveCount, minutesStale, expected)` = `(1,5,false) (2,5,false) (2,12,true) (1,12,false) (1,16,true) (3,0,false)` — seed PROCESSING with `updated_at = now() - interval '<n> minutes'`), `NormalizePrefix_Table` (`[Theory]`: `null→fallback`, `"/x/"→"x"`, `"  "→fallback`, `"a/b"→"a/b"`).

23. **`DeckRollbackTests.cs`** — `[Collection(PostgresCollection.Name)]`; events built like `CardsPageTests.cs:66-93` with `method` parameterised and `authorizer.jwt.claims["cognito:groups"] = ["super_admin"]` (or `["editor"]` for the 403 case), `Auth.GetAuthContextAsync(req)`, the 4-arg `HandleDeckRollback` with a stub `ManifestRebuildFn` that counts calls and returns `new ManifestBuildResult(1, 0, "content/manifest.json", "\"etag\"", 1)`. Method names: `Rollback_UnknownDeck_404DeckNotFound` (body `{"success":false,"error":{"code":"DECK_NOT_FOUND"}}`, stub never called), `Rollback_NonNumericId_400`, `Rollback_MissingBuildId_400`, `Rollback_BuildNotSuccess_400` (a FAILED row with that build id), `Rollback_MovesPointerAndRebuildsManifest` (200; `data` keys exactly `deckId, slug, liveBuildId, previousBuildId, manifestRebuilt`; `previousBuildId` = the newer build the pointer was on; stub called once; `decks.live_build_id` re-read from the DB), `Rollback_RequiresSuperAdmin_403` (editor → 403, stub never called), `Rollback_Get_405`, `ParseDeckId_Table` (`[Theory]`: `/api/v1/admin/decks/42/rollback→42`, `/dev/api/v1/admin/decks/42/rollback→42`, `/api/v1/admin/decks/abc/rollback→null`, `/api/v1/admin/decks/-1/rollback→null`, `/api/v1/admin/decks//rollback→null`).

24. **`PublishReaperTests.cs`** — `[Collection(PostgresCollection.Name)]`; one fresh deck per seeded row (the index forbids two active rows per deck). Method names: `Reap_MarksStalePendingAndProcessingOnly` (seed PENDING 11 min / PENDING 2 min / PROCESSING 31 min / PROCESSING 5 min / SUCCESS 60 min / FAILED 60 min → `Pending == 1`, `Processing == 1`, `JobIds` = exactly those two, `error_message == 'orphaned: no worker pickup'`, the other four rows byte-identical), `Reap_IsIdempotent` (second call → `0/0/[]`), `Reap_ReapedRowIsReacquirable` (after the reap, real `JobRepository.TryAcquireJobAsync(jobId, 2)` → `true` and the row is PROCESSING again), `HandlePublishReap_ReturnsCounts` (super-admin POST → 200, `data` keys `pending, processing, jobIds`), `HandlePublishReap_RequiresSuperAdmin_403`, `HandlePublishReap_Get_405`, `Publish_SecondActiveRow_23505MapsTo409` (insert a second PENDING row for one deck inside `Assert.ThrowsAsync<PostgresException>`, pass it to `Helpers.MapUniqueViolation409(pg, new Res("t"))` → `StatusCode 409`, body `error.code == "PUBLISH_IN_PROGRESS"`, and `MapUniqueViolation409(new InvalidOperationException("x"), res)` → null).

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/E03.verify.sh` re-runs exactly these.

1. Scope files exist (exit 0): `[ -f src_C/Vpc/Db/Migrations/021_decks_live_build_id.sql ]` and the other 8 new files of Constraints (7, 12, 13, 22–25, `E03.plan-allow.json`); exactly one `021_*.sql` and no `022_*.sql`; `src_C/Worker/Manifest/` does not exist. Prerequisites from earlier merges (pass on the integration branch, fail on base): `infra/scripts/check-plan.py`, `infra/envs/prod/imports.tf`, `infra/modules/worker/queue.tf`, `infra/modules/worker/function.tf`, `infra/modules/worker/outputs.tf` exist (E01); `grep -q retention_in_days infra/modules/worker/*.tf` and `infra/modules/observability/retention.tf` exists (E02).
2. Literal guards (exit 0):
   - `queue.tf`: `resource "aws_sqs_queue" "publish_jobs_dlq"`, `"developercards-publish-jobs-dlq"`, `message_retention_seconds = 1209600`, `visibility_timeout_seconds = 3700`, `deadLetterTargetArn = aws_sqs_queue.publish_jobs_dlq.arn`, `maxReceiveCount = 3`, `resource "aws_sqs_queue_redrive_allow_policy" "publish_jobs_dlq"`, `redrivePermission = "byQueue"`, `sourceQueueArns`, `aws_sqs_queue.publish_jobs.arn`; `sqs_managed_sse_enabled = true` at least twice; `redrive_allow_policy =` exactly once (the standalone resource); no `tags`.
   - `function.tf`: `function_name = aws_lambda_alias.worker_prod.arn`, `maximum_batching_window_in_seconds = 0`, `function_response_types = ["ReportBatchItemFailures"]`, `batch_size = 1`, `maximum_concurrency = 2`, `ignore_changes = [metrics_config]`; no `function_name = aws_lambda_function.worker`.
   - `outputs.tf`: `output "publish_dlq_arn"`, `output "publish_dlq_name"`.
   - `infra/README.md`: a line containing `E03`; `infra/envs/prod/imports.tf` byte-identical to the merge base; no `provisioner`/`null_resource`/`local-exec`/`archive_file`/`profile =` under `infra/modules/worker`.
   - `E03.plan-allow.json`: parses; after `json.dumps(sort_keys=True)` equals the content of Changes 4.
   - `021_decks_live_build_id.sql`: `alter table decks add column if not exists live_build_id text null;`, `distinct on (deck_slug)`, `and d.live_build_id is null;`, `'orphaned: pre-021 stale active row'`, `interval '30 minutes'`, `create unique index if not exists uq_deck_publishes_active`, `where status in ('PENDING', 'PROCESSING');`; no `not null` on the column line, no `drop `, no `default`, no `check (`, no `$$`.
   - `ManifestBuilder.cs`: `namespace RecallSmith.Lambda.Db;`, `public static class ManifestBuilder`, `public static Task<ManifestBuildResult> RebuildAsync(NpgsqlConnection conn, IAmazonS3 s3, string bucket, string contentPrefix, string premiumPrefix, long? nowMs = null)`, `public static void Reset()`, `public static Task<ManifestBody> BuildAsync(NpgsqlConnection conn, string contentPrefix, long generatedAtMs)`, `public static IAmazonS3 S3()`, `public static string NormalizePrefix(string? raw, string fallback)`, `public const string GeneratedAtMetadataKey = "generated-at-ms";`, `public sealed record ManifestBuildResult(int DeckCount, int PatchEdgeCount, string Key, string ETag, long GeneratedAtMs);`, `public sealed record ManifestBody(string Json, int DeckCount, int PatchEdgeCount);`, `schemaVersion = 2`, `"public, max-age=60, s-maxage=60"`, `d.live_build_id = p.build_id`, `IfMatch`, `IfNoneMatch = "*"`, `HttpStatusCode.PreconditionFailed`, `"42703"`, `"42P01"`, `select distinct on (deck_slug)`, `previewPatches = (object?)null`.
   - `RecallSmith.Lambda.Db.csproj`: `<PackageReference Include="AWSSDK.S3" Version="4.0.0" />` and `<PackageReference Include="Npgsql" Version="8.0.5" />`; exactly two `PackageReference` lines.
   - `ManifestRebuild.cs`: `ManifestBuilder.RebuildAsync(`, `ManifestBuilder.S3()`, `Auth.RequireSuperAdmin`, `manifestKey = r.Key`, `deckCount = r.DeckCount`; absent: `schemaVersion`, `distinct on`, `AmazonS3Client`, `public static void Reset`; ≤ 80 lines.
   - `Vpc/SnapStartHooks.cs`: `ManifestBuilder.Reset()` present, `ManifestRebuild.Reset()` absent. `Worker/SnapStartHooks.cs`: `ManifestBuilder.Reset()` present, `ManifestService` absent.
   - `IPublishJobProcessor.cs`: `Task ProcessAsync(string jobId, int receiveCount = 1);`, `public sealed class JobNotAcquiredException : Exception`.
   - `PublishJobProcessor.cs`: `public async Task ProcessAsync(string jobId, int receiveCount = 1)`, `TryAcquireJobAsync(jobId, receiveCount)`, `throw new JobNotAcquiredException(jobId)`; `LoadCardsAsync` signature unchanged.
   - `JobRepository.cs`: the exact acquire line `OR (status = 'PROCESSING' AND (($2 > 1 AND updated_at < now() - interval '11 minutes') OR updated_at < now() - interval '15 minutes'))`, `with done as (`, `set live_build_id = done.build_id`, `"42703"`; `IJobRepository.cs` byte-identical.
   - `WorkerFunction.cs`: `public async Task<SQSBatchResponse> FunctionHandler(SQSEvent sqsEvent, ILambdaContext context)`, `"ApproximateReceiveCount"`, `ItemIdentifier = record.MessageId`, `public static bool ManifestCoversJob(DateTime? lastModifiedUtc, string? generatedAtMsMeta, long completedAtMs, DateTime utcNow)`, `ManifestBuilder.RebuildAsync(`, `TimeSpan.FromSeconds(10)`, `completedAtMs + 1000`, `catch (JobNotAcquiredException`, `catch (BusinessException`; absent: `IManifestService`, `RecallSmith.Lambda.Worker.Manifest`, a bare `throw;`.
   - `Helpers.cs`: `public static APIGatewayProxyResponse ErrorEnvelope(Res res, int statusCode, string code, string message)`, `public static APIGatewayProxyResponse? MapUniqueViolation409(Exception ex, Res res)`, `"uq_deck_publishes_active"`, `"PUBLISH_IN_PROGRESS"`, `POST /api/v1/admin/publish/reap`.
   - `Publish.cs`: `catch (PostgresException pg) when (pg.SqlState == "23505")`, `Helpers.MapUniqueViolation409(pg, res)`; `numstat` shows 0 deletions.
   - `DeckRollback.cs`: `public static class DeckRollback`, `public delegate Task<ManifestBuildResult> ManifestRebuildFn(NpgsqlConnection conn);`, `public static long? ParseDeckId(string path)`, `HandleDeckRollback(LambdaRequest req, Res res, AuthContext auth)`, `HandleDeckRollback(LambdaRequest req, Res res, AuthContext auth, ManifestRebuildFn rebuild)`, `Auth.RequireSuperAdmin`, `"DECK_NOT_FOUND"`, `"VALIDATION_ERROR"`, `status = 'SUCCESS'`, `set live_build_id = $2`, `manifestRebuilt = true`, `previousBuildId`, `liveBuildId = buildId`; absent: `updated_at`.
   - `PublishReaper.cs`: `public sealed record ReapResult(int Pending, int Processing, string[] JobIds);`, `Task<ReapResult> ReapOrphansAsync(NpgsqlConnection conn)`, `HandlePublishReap(LambdaRequest req, Res res, AuthContext auth)`, `'orphaned: no worker pickup'`, `interval '10 minutes'`, `interval '30 minutes'`, `Auth.RequireSuperAdmin`.
   - `VpcFunction.cs`: `p.EndsWith("/rollback", StringComparison.OrdinalIgnoreCase) && p.Contains("/api/v1/admin/decks/", StringComparison.OrdinalIgnoreCase)`, `Vpc.Authoring.DeckRollback.HandleDeckRollback(req, res, auth)`, `p.EndsWith("/api/v1/admin/publish/reap", StringComparison.OrdinalIgnoreCase)`, `Vpc.Authoring.PublishReaper.HandlePublishReap(req, res, auth)`; the rollback line sits after the `manifest/rebuild` line and before the `// Dashboard` line; `numstat` = `8` added, `0` removed.
   - Tests: the four files carry all method names of Changes 21–24, `[Collection(PostgresCollection.Name)]` on the three DB classes and not on `WorkerReceiveCountTests`, ≥ 4 `[Theory]` across the four files, `EnumerateObject()` in `ManifestBuilderTests.cs`, `"super_admin"` in `DeckRollbackTests.cs` and `PublishReaperTests.cs`, `Assert.ThrowsAsync<JobNotAcquiredException>` in `WorkerReceiveCountTests.cs`, `"uq_deck_publishes_active"` in `ManifestBuilderTests.cs`; no `Skip =`, `#pragma warning disable`, `.skip(`, `.only(`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable` in any new file or added line.
   - Secret guard (E00 §5): no `(PGPASSWORD|MIGRATE_SECRET|INTERNAL_SHARED_SECRET|RC_WEBHOOK_AUTH_(PRODUCTION|DEVELOPMENT)|ANALYTICS_USER_SALT)\s*[=:]\s*"[^"$P]` in added lines; `git ls-files infra` has no `.tfplan`/`.plan.json`/`generated*.tf`/non-example `.auto.tfvars`; `grep -rn 'profile *= *"' infra --include=*.tf` empty.
3. Gates (exit 0): `terraform fmt -check -recursive infra` from the root; `cd infra/envs/prod && terraform init -backend=false -input=false && terraform validate && terraform fmt -check -recursive ..`; `cd src_C && dotnet build RecallSmith.Lambda.sln -c Release -nologo`; (`frontend` lint+build only if `frontend/` shows in the diff — it must not).
4. Plan + tests (exit 0): `aws sts get-caller-identity` → `622994489535`; the verify writes `infra/envs/prod/backend_override.tf` (local state under its temp dir), `terraform init -input=false -reconfigure`, `terraform plan -input=false -var-file=<example minus external_id> -out="$TMP/E03.tfplan"` (the `Plan:` line must say `0 to destroy`) → `terraform show -json` → the worker-side noise filter (drops `create` outside `module.worker.`, the RDS provider-side update, `output_changes` of kind `create`; prints each dropped address; exactly 4 effective entries remain) → `python3 infra/scripts/check-plan.py --plan <filtered> --allow docs/delivery/r16-issues/E03.plan-allow.json` → `PLAN OK 4`; override, plan files and `.terraform/terraform.tfstate` removed by `trap`. Then, Docker running, `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests -c Debug --nologo --filter "FullyQualifiedName~WorkerReceiveCountTests|FullyQualifiedName~ManifestBuilderTests|FullyQualifiedName~DeckRollbackTests|FullyQualifiedName~PublishReaperTests|FullyQualifiedName~PublishJobProcessorSchemaTests"` (the fifth class proves the existing worker tests still compile and pass on the 021 schema).
5. Scope + frozen + OTA + apply guard (exit 0): `git diff --name-only <merge-base>` ∪ untracked scan over `infra src_C scripts docs` ⊆ the 25 scope paths (+ `docs/delivery/r16-issues/`); `src_C/Worker/Manifest/*` appear only as deletions; the three frozen mobile files, `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json`, `infra/envs/**`, `infra/modules/{identity,data,edge,api,observability}/**`, `infra/scripts/**`, `src_C/deploy.sh`, `src_C/Worker/Repositories/IJobRepository.cs`, `src_C/Shared/RecallSmith.Lambda.Common/**`, every other `.csproj`, every existing test file are zero-diff; `grep -Fq '"version": "1.6.1"' mobile/app.json`; no `@sentry` under `mobile/src`; no added line under `infra/`, `src_C/` or `docs/delivery/r16-issues/E03*` (outside comments/`echo`/`DRY_RUN` text) contains `terraform apply`, `terraform import` or `aws <svc> create-/update-/delete-/put-`.

## Verify

```bash
export AWS_PROFILE=dev TF_PLUGIN_CACHE_DIR="$HOME/.terraform.d/plugin-cache"
BASE=delivery/r16-e-prod bash docs/delivery/r16-issues/E03.verify.sh
```
Steps 1–2 are file/literal checks (seconds); step 3 is `terraform init/validate/fmt` (seconds with the cached provider) plus the Release build of the solution (~1–2 min cold); step 4 runs the plan against the live account read-only (~2–4 min: the 93 `import {}` blocks read every adopted resource) and the five xunit classes on one `postgres:16-alpine` container (single-digit minutes). The driver then runs the full root gates (`infra` init/validate/fmt; `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests`, Docker) plus its diff-scoped banned-term grep and suppression scan — keep every other class green.

**The supervisor applies** (never the worker), in this order after the merge: `terraform init -reconfigure` with the real backend in `infra/envs/prod` (no override file present) → `terraform plan -out=E03.tfplan` → `terraform show -json E03.tfplan | python3 infra/scripts/check-plan.py --allow docs/delivery/r16-issues/E03.plan-allow.json` (unfiltered — must print `PLAN OK 4`) → `terraform apply E03.tfplan` → `cd src_C && ./deploy.sh` (both functions; the ESM now follows `worker-lambda:prod`) → console **Migrate** (021 runs on the new core-vpc version, §6 #17) → `POST /api/v1/admin/manifest/rebuild` once (stamps `generated-at-ms`; `head-object` must show `Metadata.generated-at-ms` and the body must differ from the previous manifest only in `generatedAtMs`) → `aws sqs get-queue-attributes … RedrivePolicy VisibilityTimeout` (3700, maxReceiveCount 3) and `aws lambda list-event-source-mappings --function-name worker-lambda` (`FunctionArn` ends in `:prod`, `FunctionResponseTypes ["ReportBatchItemFailures"]`, window 0) → a second `terraform plan` that must be empty → optional smoke: republish one live deck from the console; the job reaches SUCCESS, `decks.live_build_id` moves, and `manifest.json`'s `LastModified` advances **without** a manual POST.

## Do NOT

- Do NOT run `terraform apply`, `terraform import`, `terraform init` with the S3 backend, `aws lambda update-*`, `aws sqs set-queue-attributes`, `aws sqs create-queue`, `./deploy.sh`, or anything under `scripts/` for real. Do NOT paste plan JSON or `terraform plan` text anywhere.
- Do NOT rename the queue, the function, the alias or the ESM; do NOT add `tags`, `kms_master_key_id`, a `policy` on the DLQ, or an inline `redrive_allow_policy` attribute; do NOT touch `infra/envs/**` or any module other than `worker`.
- Do NOT edit `Res.cs` (E07), `deploy.sh` (E06), `IJobRepository.cs`, `Migrate.cs`, `AdminManifest.cs`, `PremiumDeckUrl.cs`, `AdminDecks.cs`, any `.csproj` other than the Db one, `src_C/Common/**`, the root `RecallSmith.Lambda.csproj`, `mobile/**`, `frontend/**`, `docs/*.md`.
- Do NOT change the manifest's key set, key order, `schemaVersion`, serializer options, `Content-Type` or `Cache-Control`; do NOT add `premiumPrefix` to the document.
- Do NOT rethrow from `FunctionHandler`, derive `JobNotAcquiredException` from `BusinessException`, call `FailAsync` on a system error, or make the acquire branch `$2 > 1` alone.
- Do NOT skip the rebuild without the metadata proof, and do NOT put without `IfMatch`/`IfNoneMatch`.
- Do NOT create `022_*.sql`, a second index, a `not null`, a `default`, or a `$$` block in 021.
- Do NOT add `ConfigureAwait`, `[Fact(Skip`, `#pragma warning disable`, Moq/NSubstitute/any package to the test project, or a fake `IAmazonS3` — test the builder through `BuildAsync` and the rollback through the `ManifestRebuildFn` stub.
- Do NOT run `dotnet restore` by hand, `npm …`, `expo …`, `eas …`, or git inside `/Users/qc/src/recallsmith` (the shared checkout) — only inside your worktree.
