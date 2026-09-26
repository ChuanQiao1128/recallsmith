# E13 — Analytics separation (`analytics-separation`)

Give the analytics pipeline its own private bucket and stop sharing the content bucket: create `developercards-analytics-622994489535` (PAB ×4, SSE-S3, BucketOwnerEnforced, versioning, `raw/` tiering to Glacier IR at 90 d and expiry at 730 d, noncurrent 90 d) in `modules/data/analytics.tf`, wire the S3 → SQS event notification that Snowpipe `auto_ingest` needs behind a `snowpipe_sqs_arn` variable that stays empty until a Snowflake account exists, re-point the Snowflake read policy and the core-vpc inline policy at the new bucket, add the `analytics-salt` SSM name, point `ANALYTICS_S3_BUCKET` / `CI_SNAPSHOT_BUCKET` at the new bucket through `src_C/env/prod.env.json`, salt `user_id_hash` with `ANALYTICS_USER_SALT` in `ProgressEvents.HashUserId`, delete `sent` outbox rows older than 30 days at the end of the scheduled `outbox/publish` action, and ship the Snowflake side that was never written: a 30 d / 90 d re-aggregation view, an external stage on the new bucket and two daily `COPY INTO` tasks that write the `latest.json.gz` the importer already reads. Root: `src_C+infra+snowflake`; one new test file; no mobile, no frontend, no `.github`.

## Context

Base: `delivery/r16-e-prod` (== `main@4b07f19`). Every base-tree line below was read on that tree on 2026-09-22; every AWS fact the same day with `AWS_PROFILE=dev` (account `622994489535`, `ap-southeast-2`), describe/get/list only. Files created by E01–E12 (`infra/**`, `src_C/env/prod.env.json`, `src_C/Vpc/Internal/InternalEvents.cs`, the post-E04 `OutboxPublisher.cs`) do not exist on base — for those, anchor by resource address / method name, never by a line number. `docs/delivery/r16-issues/E00-contracts.md` (E00) is binding; §2.13 (`:387-389`) is this issue's contract; §0 (`:9-36`) the non-negotiables; §1.1/§1.2 (`:43-110`) the file map; §2.1 (`:114-211`) the Terraform conventions; §2.5 (`:281-288`) the E05 policy shape this issue edits; §2.6.2 (`:294`) the SSM names and the env→SSM map; §2.11 (`:359-379`) the `outbox/publish` action this issue extends; §3.1 (`:419-430`) the allow-list; §5 (`:470-482`) the verify conventions; §6 #22 (`:505`) the salt decision. Review: `docs/backend-architecture-review-2026-09-22.md` §2.5.5 (`:148`), §2.5.7 (`:150`), §2.1.2 (`:89`), §2.2.11 (`:115`).

What the tree looks like today:

- **Bucket sharing.** `src_C/Vpc/Analytics/OutboxPublisher.cs:41-45` `AnalyticsBucket()` = `ANALYTICS_S3_BUCKET` ?? `CONTENT_BUCKET`; `:35-39` `NormalizePrefix` defaults to `analytics/raw/review_events`; `:212` writes `{prefix}/event_type=card_reviewed/dt=YYYY-MM-DD/batch-<ts>-<guid>.jsonl`. `src_C/Vpc/Analytics/ContentIntelligenceSnapshotImport.cs:41-47` `DefaultBucket()` = `CI_SNAPSHOT_BUCKET` ?? `ANALYTICS_S3_BUCKET` ?? `CONTENT_BUCKET` ?? `"core-vpc"`; `:49-53` `DefaultKey()` = `CI_SNAPSHOT_KEY` ?? `analytics/marts/content_intelligence/card_snapshot_30d/latest.json.gz`. Live `core-vpc` carries none of `ANALYTICS_S3_BUCKET`, `ANALYTICS_S3_PREFIX`, `CI_SNAPSHOT_BUCKET`, `CI_SNAPSHOT_KEY` (`lambda get-function-configuration --query 'keys(Environment.Variables)'`), so both paths land in the content bucket: `s3api list-objects-v2 --bucket core-vpc --prefix analytics/` → one raw file `analytics/raw/review_events/event_type=card_reviewed/dt=2026-05-09/batch-20260509T112453830Z-….jsonl` (1,134,292 B) and `analytics/marts/content_intelligence/card_snapshot_30d/latest.json.gz` (1,215 B, 2026-06-01). `s3api head-bucket --bucket developercards-analytics-622994489535` → 404 (the bucket does not exist). `s3api get-bucket-notification-configuration --bucket core-vpc` → empty, which is why Snowpipe `auto_ingest = true` (`snowflake/001_content_intelligence_setup.sql:36-52`) has never fired.
- **Snowflake IAM today.** `iam get-policy-version` of `arn:aws:iam::622994489535:policy/snowflake-recallsmith-s3-read` = two statements, Sid `ListAnalyticsPrefix` (`s3:ListBucket` on `arn:aws:s3:::core-vpc` with `s3:prefix` ∈ {`analytics/raw/review_events`, `analytics/raw/review_events/*`}) and Sid `ReadAnalyticsObjects` (`s3:GetObject` on `arn:aws:s3:::core-vpc/analytics/raw/review_events/*`). `list-attached-role-policies snowflake-recallsmith-s3-role` → that policy plus `AmazonS3FullAccess` (E05 destroys the second attachment; E01 adopts the policy as `module.identity.aws_iam_policy.snowflake_read`, E00 §2.1.2). The role's trust is an IAM user in the Snowflake account with an `sts:ExternalId` condition (`iam get-role`); the id is the root variable `snowflake_external_id` (E00 §0) — read-only lookup in the verify, never printed.
- **Outbox retention.** `src_C/Vpc/Db/Migrations/009_content_intelligence_events.sql:32-46` defines `analytics_event_outbox` (`status`, `sent_at timestamptz null`, `available_at`, `attempts`); `:48-50` `idx_analytics_outbox_pending` is partial on `status = 'pending'`. `OutboxPublisher.MarkSent` (`:150-163`) sets `status = 'sent', sent_at = now()`; no C# file ever deletes from the table (`grep -rn "delete from analytics_event_outbox" src_C/Vpc src_C/Worker src_C/Shared src_C/Tests` → only `016_purge_synthetic_test_users.sql:32,40` and the two demo scripts under `Db/Scripts`). After E04 the batch core is `OutboxPublisher.PublishBatchAsync(conn, s3, bucket, prefix, limit)` (E00 §2.4.7) and after E12 the scheduled action `outbox/publish` in `src_C/Vpc/Internal/InternalEvents.cs` loops it, "then E13's retention delete, then `EmitGauge("OutboxPending", …)`" (E00 §2.11) — the slot this issue fills.
- **Unsalted hash.** `src_C/Vpc/Runtime/ProgressEvents.cs:806-810` is `private static string HashUserId(string userSub)` = lowercase hex SHA-256 of the sub; `:112` is the only call site (`var userIdHash = HashUserId(userSub);`); `:431` writes it as `'user_id_hash'` into the outbox payload; `:457` keeps `'device_id'` (E00 §6 #22: `device_id` stays this wave). `using System.Security.Cryptography;` / `System.Text` / `RecallSmith.Lambda.Common` are already imported (`:3-4`, `:9`). `src_C/Vpc/AssemblyInfo.cs:11` has `InternalsVisibleTo("RecallSmith.Lambda.IntegrationTests")`, so an `internal` overload is testable without widening to `public`. E07 owns `:117-241`/`:669-685`, E12 owns `:611-637` of this file (E00 §1.2); this issue owns only the `HashUserId` region.
- **Importer contract.** `ContentIntelligenceSnapshotImport.cs:349-443` `CardSnapshotRow` has exactly 31 `[JsonPropertyName]` properties (`grep -c JsonPropertyName` → 31; they are the only `JsonPropertyName` attributes in the file): `window_days`, `window_start_at`, `window_end_at`, `deck_slug`, `card_stable_uid`, `card_revision`, `stated_difficulty`, `review_count`, `unique_user_count`, `observed_difficulty_raw`, `expected_difficulty`, `difficulty_gap`, `difficulty_gap_z`, `easy_rate`, `good_rate`, `hard_rate`, `again_rate`, `struggle_rate`, `failure_rate`, `repeat_failure_rate`, `median_dwell_time_ms`, `expected_dwell_time_ms`, `dwell_time_ratio`, `high_level_user_failure_rate`, `post_card_dropout_rate`, `review_count_to_mastery`, `difficulty_calibration_status`, `content_quality_status`, `confidence_level`, `fix_priority_score`, `source_generated_at`. Deserialisation is `PropertyNameCaseInsensitive` (`:266`; Snowflake emits UPPERCASE keys), one JSON object per line, gzip when the key ends `.gz` (`:248-251`), and `FlexibleDateTimeOffsetConverter` (`:445-530`) accepts ISO-8601 and Snowflake's `+0000` offsets. PK of `content_intelligence_card_snapshot` is (`window_days`, `deck_slug`, `card_stable_uid`, `card_revision`) with `window_days in (30, 90)` (`010_content_intelligence_snapshot.sql:40-47`). The console reads the snapshot when a window has rows (`src_C/Vpc/Authoring/ContentIntelligence.cs:30`, `:390-396`); the live path excludes MCQ cards (`:127` `and c.mcq is null`) and counts them separately.
- **Snowflake files.** `snowflake/001_content_intelligence_setup.sql:1` is `-- RecallSmith Content Intelligence Snowflake setup.`; `:3-8` list the five placeholders `<WAREHOUSE_NAME> <DATABASE_NAME> <ANALYTICS_BUCKET> <ANALYTICS_PREFIX> <STORAGE_INTEGRATION_NAME>`; `:24-27` stage `raw.review_events_stage` on `s3://<ANALYTICS_BUCKET>/<ANALYTICS_PREFIX>/event_type=card_reviewed/`; `:126-253` `marts.mart_card_quality_daily` keyed by `event_date, deck_slug, card_stable_uid, card_revision, stated_difficulty, answer_mode` (`:190`), with the three CASE expressions and the `fix_priority_score` formula at `:210-253`; `:255-272` `mart_card_revision_impact` re-aggregates it with `where answer_mode = 'qa'`. Nothing exports a snapshot: `grep -rci 'create or replace task\|copy into @' snowflake/` → 0. `snowflake/README.md:33-44` documents the hand-apply rule; `:62` tells the reader to wire the S3 notification by hand.
- **Deploy-time env.** After E06, `src_C/deploy.sh` overlays `src_C/env/prod.env.json` (non-secret keys) and the SSM parameters under `/developercards/prod` onto the live environment before `publish-version`. E06's `src_C/scripts/merge-env.sh` already carries the whole map `SSM_TO_ENV` **including** `"analytics-salt":"ANALYTICS_USER_SALT"` (E06 brief, Changes 12 — `ssm_to_env` exits non-zero on an unmapped leaf, so the row had to exist before the parameter does), and projects the worker's overlay through `WORKER_FILE_KEYS` / `WORKER_SECRET_KEYS = ["PGPASSWORD"]`, so keys E13 adds to the flat file reach core-vpc only. What E13 still owns is the SSM *parameter* (`secret_parameter_names` in `infra/envs/prod/main.tf` ends with the five E06 names; E06 says "E13 appends it here"). `ssm describe-parameters` under `/developercards` → none today (E06 creates them).

What E00 decided (and why), plus the decisions this brief adds:

- §2.13 is followed literally: bucket name, PAB/SSE/ownership/versioning, the two lifecycle rules `raw-tiering` + `noncurrent-90d`, `aws_s3_bucket_notification.analytics` behind `snowpipe_sqs_arn` (absent from this plan), `snowflake_read` and the core-vpc inline policy re-pointed, `analytics-salt` appended to `secret_parameter_names`, the four env keys, `HashUserId` = SHA-256 over `ANALYTICS_USER_SALT + sub`, `DeleteSentOlderThanAsync(conn, days: 30)` at the end of `outbox/publish`, `002_snapshot_export.sql` (view + stage + two tasks), the README account section.
- **Count guard with `""`, not `null`.** Both modules take `variable "analytics_bucket_name" { default = "" }` and every analytics resource is `count = var.analytics_bucket_name == "" ? 0 : 1` (addresses end in `[0]`); `""` rather than `null` so `"arn:aws:s3:::${var.analytics_bucket_name}/…"` never interpolates a null. E10 (its R1) instantiates only `api` and `worker` for staging and declares staging's identity/data-shaped resources in `infra/envs/staging/main.tf`, so today the guard has one caller (prod) — it costs nothing, keeps the modules callable without a bucket, and keeps `${content}/analytics/*` in `S3Content` for any caller whose bucket name is empty. Prod loses that resource and gains `S3Analytics` — exactly §2.13's "removed/added".
- **No staging change.** E10's `infra/envs/staging/main.tf` says "E13 mirrors its analytics-bucket change here when it lands"; resolved as **no edit** (E00 §1.1 gives E13 no staging file): staging has no analytics bucket, its core-vpc keeps `analytics/*` on `developercards-content-staging`, so E12's staging `outbox-publish` schedule keeps publishing into that bucket; a staging analytics bucket is post-wave. E10 declares no `snowpipe_sqs_arn` (its variables list), consistent with this.
- **`snowflake_read` gains write on `marts/`.** §2.13's export task is `COPY INTO @marts.snapshot_stage` on the same bucket, which needs `s3:PutObject` (+ `s3:DeleteObject` for `overwrite = true` housekeeping) on `marts/content_intelligence/*` and `s3:GetBucketLocation` for the storage integration. Read stays confined to `raw/review_events/*`; nothing on `core-vpc` remains.
- **Re-aggregation rules** (the daily mart has no window columns, seams §10): group by (`window_days`, `deck_slug`, `card_stable_uid`, `card_revision`) over `answer_mode = 'qa'` rows (the live console path is QA-only too) with `event_date >= to_date(dateadd(day, -window_days, current_timestamp()))`; `review_count = sum`, `stated_difficulty = max`, `unique_user_count = max(daily unique_user_count)` (a floor — exact distinct users need event grain; documented in the README, post-wave), every rate / difficulty / dwell column = `review_count`-weighted mean, `dwell_time_ratio = median_dwell_time_ms / nullif(expected_dwell_time_ms, 0)`, `post_card_dropout_rate = null` (needs session order, not in the daily mart), the three statuses and `fix_priority_score` recomputed with the CASE rules of `001:210-253` minus the MCQ branch, timestamps rendered as ISO-8601 UTC strings.
- **The plan runs against the real state, read-only.** By E13 the account holds ~60 resources created by E02–E12 that have no `import {}` block (E00 §1.1: `imports.tf` is E01's), so an empty-local-state plan would list every one of them as `create` and no allow-list could be checked. `E13.verify.sh` therefore copies `infra/` to a scratch dir, runs `terraform init` with the committed S3 backend (a `GetObject` of the state) and `terraform plan -lock=false -out=…` (no `.tflock`, no writes), shows it as JSON, prints only addresses/actions/changed-key names and deletes every plan file in a trap. The two live-sourced variables (`snowflake_external_id` from `iam get-role`, `alert_email` from `sns list-subscriptions-by-topic`) are exported as `TF_VAR_*` for the plan only and never echoed. This is the task text's "against the real backend" and the supervisor's exact view; it is still nothing but reads.
- §6 #22: the salt changes every hash; the one 2026-05-09 raw file keeps unsalted hashes and is copied, not rewritten. §2.14: `snowflake/001…sql:1` is the only brand line E13 touches; `snowflake/README.md`'s title is not in E14's exhaustive map and stays.
- §1.2: E13 creates exactly one test file, `HashUserIdSaltTests.cs`; the retention delete needs a real Postgres, so that file holds two classes (`HashUserIdSaltTests`, pure; `OutboxRetentionTests`, `[Collection(PostgresCollection.Name)]`).

## Read first

1. `docs/delivery/r16-issues/E00-contracts.md` §0 (`:9-36`), §1.1 rows for `data/analytics.tf`, `identity/policies.tf`, `identity/ssm.tf`, `envs/prod/*` (`:45-70`), §1.2 rows for `OutboxPublisher.cs`, `ProgressEvents.cs`, `InternalEvents.cs`, `deploy.sh`/`prod.env.json`, `snowflake/*` (`:71-110`), §2.1.3-2.1.4 (`:181-211`), §2.5 (`:281-288`), §2.6.2-2.6.3 (`:294-295`), §2.11 (`:359-379`), §2.13 (`:387-389`), §3.1 (`:419-430`), §5 (`:470-482`), §6 #20-22 (`:503-505`).
2. `infra/modules/data/buckets.tf` (E01/E02 — the shape of `aws_s3_bucket_public_access_block`, `_ownership_controls`, `_server_side_encryption_configuration`, `_versioning`, `_lifecycle_configuration` to mirror), `infra/modules/data/variables.tf`, `outputs.tf`; `infra/modules/identity/policies.tf` (E05 — `aws_iam_role_policy.core_vpc`, Sids `S3Content`, `S3Premium`, `S3Head`, `SqsSend`, `Logs`, `Eni`), `infra/modules/identity/main.tf` (E01 — `aws_iam_policy.snowflake_read`), `infra/modules/identity/ssm.tf` (E06 — `aws_ssm_parameter.secret`), `infra/modules/identity/variables.tf`; `infra/envs/prod/main.tf`, `variables.tf`, `prod.auto.tfvars.example`, `backend.tf`; `infra/scripts/check-plan.py`; `infra/README.md` §6.
3. `src_C/Vpc/Analytics/OutboxPublisher.cs` whole file (base: 243 lines; `:35-45`, `:97-178`, `:212`; after E04 also `PublishBatchAsync`).
4. `src_C/Vpc/Internal/InternalEvents.cs` (E12) — the `outbox/publish` handler; `src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs` `EmitGauge` (E04); `src_C/Shared/RecallSmith.Lambda.Common/Log.cs` `Event(string level, object fields)` (E04).
5. `src_C/Vpc/Runtime/ProgressEvents.cs:1-12`, `:95-115`, `:425-460`, `:800-812`.
6. `src_C/Vpc/Analytics/ContentIntelligenceSnapshotImport.cs:35-63`, `:233-284`, `:349-443`, `:445-530`; `src_C/Vpc/Db/Migrations/009_content_intelligence_events.sql:32-53`; `010_content_intelligence_snapshot.sql:1-81`.
7. `snowflake/001_content_intelligence_setup.sql` whole file (329 lines: `:1-12`, `:24-52`, `:126-253`, `:255-272`); `snowflake/README.md` whole file (63 lines); `snowflake/sample-mart-card-quality-daily-2026-05-07-10-rows.csv:1` (the daily mart's column order).
8. `src_C/deploy.sh` (E06 — the env→SSM map and `DRY_RUN`), `src_C/scripts/merge-env.sh`, `src_C/env/prod.env.json` (E06 seed).
9. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs:27-98` (`PostgresFixture`, `OpenAsync`, `QueryAsync`, `ScalarAsync`), `:158-165` (`PostgresCollection`); `ProgressEventsIntegrationTests.cs:1-60` (usings, constructor shape); `src_C/Vpc/AssemblyInfo.cs:9-11`.
10. `docs/delivery/r16-issues/C05-topic-server.md` + `C05.verify.sh:1-40` (format precedent).

## Constraints

- **Scope (the ONLY files that may change):**
  1. `infra/modules/data/analytics.tf` (new)
  2. `infra/modules/data/variables.tf` (append `analytics_bucket_name`, `snowpipe_sqs_arn`)
  3. `infra/modules/data/outputs.tf` (append `analytics_bucket_arn`, `analytics_bucket_name`)
  4. `infra/modules/identity/policies.tf` (edit `aws_iam_role_policy.core_vpc`; hold the edited `aws_iam_policy.snowflake_read`)
  5. `infra/modules/identity/main.tf` (ONLY if E01 placed the `aws_iam_policy.snowflake_read` block here: move that block verbatim to `policies.tf` — zero added lines in `main.tf`)
  6. `infra/modules/identity/variables.tf` (append `analytics_bucket_name`)
  7. `infra/envs/prod/main.tf` (wiring + `"analytics-salt"`), `infra/envs/prod/variables.tf` (append `snowpipe_sqs_arn`), `infra/envs/prod/prod.auto.tfvars.example` (append `snowpipe_sqs_arn = ""`)
  8. `infra/README.md` (one dated line appended to §6)
  9. `src_C/Vpc/Runtime/ProgressEvents.cs` (the `HashUserId` region only)
  10. `src_C/Vpc/Analytics/OutboxPublisher.cs` (add-only: `DeleteSentOlderThanAsync`)
  11. `src_C/Vpc/Internal/InternalEvents.cs` (the `outbox/publish` handler only)
  12. `src_C/env/prod.env.json` (four keys added)
  13. `src_C/scripts/merge-env.sh` / `src_C/deploy.sh` — ONLY if E06's `SSM_TO_ENV` lacks the `analytics-salt` row (it should not; then one row, nothing else) — expected zero diff
  14. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/HashUserIdSaltTests.cs` (new; two classes)
  15. `snowflake/002_snapshot_export.sql` (new), `snowflake/README.md` (edit), `snowflake/001_content_intelligence_setup.sql` (line 1 only; numstat `1 1`)
  16. `docs/delivery/r16-issues/E13.plan-allow.json` (new; content pinned in Changes 19)
  Nothing else: no `infra/envs/prod/imports.tf` / `backend.tf` / `outputs.tf`, no `infra/envs/staging/**`, no `infra/modules/identity/ssm.tf` / `cognito.tf` / `oidc.tf` / `outputs.tf`, no `modules/{api,worker,edge,observability}/**`, no `src_C/Vpc/VpcFunction.cs`, no `ContentIntelligenceSnapshotImport.cs`, no `ContentIntelligence.cs`, no migration, no `.csproj`, no `mobile/`, no `frontend/`, no `.github/`, no `scripts/`, no top-level `docs/*.md`, no `README.md`.
- **WORKER SAFETY RULE (verbatim, E00 §0):** a worker may run read-only AWS CLI, `terraform init/validate/plan` (plan must be saved with -out and shown as JSON), but NEVER `terraform apply`, `terraform import` (state-changing), `aws ... create/update/delete/put`, `eas`, or any deploy script. The supervisor applies plans after each merge. Each infra brief's verify.sh therefore checks the PLAN (terraform show -json) against an explicit allow-list of resource addresses and actions — nothing else may appear as create/update/delete.
  Consequences here: `import {}` blocks are configuration (allowed; E13 adds none); never leave an E01-era `infra/envs/prod/backend_override.tf` in the worktree (the verify refuses to plan with one present — E13 plans against the real state); `aws iam simulate-custom-policy`, `aws iam get-role`, `aws sns list-subscriptions-by-topic`, `aws s3api head-object`, `aws sts get-caller-identity`, `aws ssm describe-parameters` are read-only and allowed; `aws ssm put-parameter`, `aws s3 cp/rm`, `aws lambda invoke`, `ENV=prod ./deploy.sh` (without `DRY_RUN=1`) and everything under "supervisor post-apply" are the supervisor's. `terraform plan` runs with `-lock=false` and `-out`; plan stdout is never captured into a file that survives the verify, and no plan JSON is committed or pasted (Lambda `environment` blocks are in clear, E00 §0).
- **Terraform rules (E00 §0, §2.1):** `hashicorp/aws ~> 6.0` as locked (never re-lock); no `provisioner`, `local-exec`, `null_resource`, `external`, `archive_file`; no `profile` in any provider; no renames of existing resources; new resources carry the `developercards-` prefix; `terraform fmt` clean; a module never reads another module's output (identity takes strings only — the bucket name is a root `local`, passed to both modules).
- **Frozen files (zero diff):** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. **OTA rule:** nothing under `mobile/` changes (`package.json`, `package-lock.json`, `app.json` at `"version": "1.6.1"`, `eas.json` byte-identical; no `@sentry`).
- **Region rules:** `ProgressEvents.cs` — the five lines of the current `HashUserId` method (`:806-810` on base; E07/E12 may have shifted the number, not the text) are replaced by the region of Changes 9 (doc comment → `AnalyticsSalt` → `internal` overload → delegating method) and nothing else moves: the verify strips the region from HEAD and the old five lines from the merge base and diffs the remainders; `:112` is untouched. `OutboxPublisher.cs` — add-only (numstat removed = 0). `InternalEvents.cs` — only the `outbox/publish` handler changes (≤ 3 hunks; `TryParse`, `Handlers` keys, `DispatchAsync` untouched). `snowflake/001…sql` — line 1 only.
- **Secrets:** never a real salt, password, external id or email in any file, log line, PR text or verify output; `ANALYTICS_USER_SALT` appears only as a name (E00 §5 secret-leak guard). The SSM value is the placeholder E06's `ssm.tf` already sets (`ignore_changes = [value]`); the supervisor puts the real value.
- **No state-changing command lines in prose or code.** The verify greps every added line of the diff (comments, `--`/`#`/`//` lines and `echo` lines excepted, `docs/delivery/r16-issues/` excluded) for `terraform apply`/`terraform import` and `aws <svc> create-|update-|delete-|put-…`; describe the supervisor's steps in words in `snowflake/README.md` / `infra/README.md` §6 or point at `infra/RUNBOOK.md`, never as a command line.
- **Banned literals in any added line** (driver gate, case-insensitive): the six terms of B00 §0 — say "sidestep", "guard", "fallback", "probe". The two live env-var names E00 §0 calls unspellable are never written; `prod.env.json` is an overlay, so they survive untouched. No `[Fact(Skip = …)]`, `[Theory(Skip = …)]`, `#pragma warning disable`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(` anywhere in the diff.
- **Tests:** `HashUserIdSaltTests.cs` is the only test file created or changed; every other file under `src_C/Tests/**` is byte-identical (E00 §1.2). The full server suite (`cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests`, Docker) must stay green — the driver runs it as the `src_C` root gate.
- **Never copy ExamTopics / SAA-C03 content.** Test fixtures use neutral strings (`"sub-1"`, `"pepper"`, `Guid.NewGuid()`).
- **Toolchain:** Terraform 1.16.3 (`terraform`), provider cached in `TF_PLUGIN_CACHE_DIR="$HOME/.terraform.d/plugin-cache"`; dotnet 8.0.413 (implicit cached restore; no `dotnet restore`, no new `PackageReference`); python3 3.8 (stdlib only); Docker for the DB class. No Snowflake account exists: `002` is lint-checked only (column set, placeholders, `create or replace`, task/CRON/COPY literals). No `npm`, `expo`, `eas`, `gh`, network installs.
- Standing rules: no `git push`, no PR, never touch `main`, no deploy, no git inside `/Users/qc/src/recallsmith` (the shared checkout) — only inside your worktree.

## Changes required

### Infra

1. **`infra/modules/data/variables.tf`** — append (descriptions free-form, names exact):
   ```hcl
   variable "analytics_bucket_name" {
     type        = string
     default     = ""
     description = "E13: private analytics bucket (prod: developercards-analytics-622994489535). Empty = no analytics bucket in this env."
   }

   variable "snowpipe_sqs_arn" {
     type        = string
     default     = ""
     description = "E13: Snowpipe notification channel (show pipes → notification_channel). Empty until a Snowflake account exists."
   }
   ```

2. **`infra/modules/data/analytics.tf` (new)** — seven resources, every one `count`-guarded, addresses exactly as below. Mirror the block shapes of `buckets.tf`; no `tags` (provider `default_tags` applies), no bucket policy, no logging.
   ```hcl
   # E13 — private analytics bucket (E00 §2.13). Guarded by analytics_bucket_name so the
   # staging root, which passes nothing, plans nothing here.

   resource "aws_s3_bucket" "analytics" {
     count  = var.analytics_bucket_name == "" ? 0 : 1
     bucket = var.analytics_bucket_name

     lifecycle {
       prevent_destroy = true
     }
   }

   resource "aws_s3_bucket_public_access_block" "analytics" {
     count                   = var.analytics_bucket_name == "" ? 0 : 1
     bucket                  = aws_s3_bucket.analytics[0].id
     block_public_acls       = true
     block_public_policy     = true
     ignore_public_acls      = true
     restrict_public_buckets = true
   }

   resource "aws_s3_bucket_ownership_controls" "analytics" {
     count  = var.analytics_bucket_name == "" ? 0 : 1
     bucket = aws_s3_bucket.analytics[0].id

     rule {
       object_ownership = "BucketOwnerEnforced"
     }
   }

   resource "aws_s3_bucket_server_side_encryption_configuration" "analytics" {
     count  = var.analytics_bucket_name == "" ? 0 : 1
     bucket = aws_s3_bucket.analytics[0].id

     rule {
       apply_server_side_encryption_by_default {
         sse_algorithm = "AES256"
       }
     }
   }

   resource "aws_s3_bucket_versioning" "analytics" {
     count  = var.analytics_bucket_name == "" ? 0 : 1
     bucket = aws_s3_bucket.analytics[0].id

     versioning_configuration {
       status = "Enabled"
     }
   }

   resource "aws_s3_bucket_lifecycle_configuration" "analytics" {
     count      = var.analytics_bucket_name == "" ? 0 : 1
     bucket     = aws_s3_bucket.analytics[0].id
     depends_on = [aws_s3_bucket_versioning.analytics]

     rule {
       id     = "raw-tiering"
       status = "Enabled"

       filter {
         prefix = "raw/"
       }

       transition {
         days          = 90
         storage_class = "GLACIER_IR"
       }

       expiration {
         days = 730
       }
     }

     rule {
       id     = "noncurrent-90d"
       status = "Enabled"

       filter {}

       noncurrent_version_expiration {
         noncurrent_days = 90
       }

       abort_incomplete_multipart_upload {
         days_after_initiation = 7
       }
     }
   }

   resource "aws_s3_bucket_notification" "analytics" {
     count  = var.analytics_bucket_name != "" && var.snowpipe_sqs_arn != "" ? 1 : 0
     bucket = aws_s3_bucket.analytics[0].id

     queue {
       id            = "snowpipe-review-events"
       queue_arn     = var.snowpipe_sqs_arn
       events        = ["s3:ObjectCreated:*"]
       filter_prefix = "raw/review_events/"
     }
   }
   ```
   No `kms_master_key_id`, no `bucket_key_enabled`, no `expected_bucket_owner`, no `force_destroy`. The notification stays at `count = 0` in this plan (§2.13: no Snowflake account); the supervisor sets `snowpipe_sqs_arn` later.

3. **`infra/modules/data/outputs.tf`** — append:
   ```hcl
   output "analytics_bucket_arn" {
     value = one(aws_s3_bucket.analytics[*].arn)
   }

   output "analytics_bucket_name" {
     value = var.analytics_bucket_name
   }
   ```

4. **`infra/modules/identity/variables.tf`** — append `variable "analytics_bucket_name" { type = string, default = "" }` (same description style as 1; identity takes strings only, E00 §2.1.1).

5. **`infra/modules/identity/policies.tf`** — two edits, both `update`s of one attribute (`policy`).
   a. **`aws_iam_role_policy.core_vpc`** (E05): keep every Sid, order and action E05 fixed (`S3Content`, `S3Premium`, `S3Head`, `SqsSend`, `Logs`, `Eni`; `Resource: "*"` only on `Eni`) and make the two S3 statements bucket-aware:
      ```hcl
      locals {
        analytics_enabled = var.analytics_bucket_name != ""

        core_vpc_content_resources = concat(
          ["arn:aws:s3:::${var.content_bucket_name}/content/*"],
          local.analytics_enabled ? [] : ["arn:aws:s3:::${var.content_bucket_name}/analytics/*"],
        )

        core_vpc_head_resources = concat(
          ["arn:aws:s3:::${var.content_bucket_name}", "arn:aws:s3:::${var.premium_bucket_name}"],
          local.analytics_enabled ? ["arn:aws:s3:::${var.analytics_bucket_name}"] : [],
        )

        core_vpc_analytics_statements = local.analytics_enabled ? [{
          Sid      = "S3Analytics"
          Effect   = "Allow"
          Action   = ["s3:PutObject", "s3:GetObject"]
          Resource = ["arn:aws:s3:::${var.analytics_bucket_name}/*"]
        }] : []
      }
      ```
      `S3Content.Resource = local.core_vpc_content_resources`, `S3Head.Resource = local.core_vpc_head_resources`, and the document's `Statement` becomes `concat([ …the six E05 statements… ], local.core_vpc_analytics_statements)` so `S3Analytics` is the last statement in prod and absent in staging. Adapt the local names to E05's file if it already has a `locals` block; the resulting prod JSON is what the verify simulates: `s3:PutObject` allowed on `arn:aws:s3:::developercards-analytics-622994489535/raw/review_events/x`, `s3:GetObject` allowed on `…/marts/content_intelligence/card_snapshot_30d/latest.json.gz`, `s3:ListBucket` allowed on the bucket, `s3:PutObject` **implicitDeny** on `arn:aws:s3:::core-vpc/analytics/x`, `s3:PutObject` still allowed on `arn:aws:s3:::core-vpc/content/x`.
   b. **`resource "aws_iam_policy" "snowflake_read"`** (E01 adopted it under `name = "snowflake-recallsmith-s3-read"`; keep name, path, description and whatever count/for_each guard E01 gave it — the address stays `module.identity.aws_iam_policy.snowflake_read`; the block must live in `policies.tf`: if E01 wrote it in `identity/main.tf`, move it verbatim into `policies.tf` first, then edit): the `policy` becomes exactly four statements —
      ```hcl
      policy = jsonencode({
        Version = "2012-10-17"
        Statement = [
          {
            Sid      = "ListAnalyticsPrefix"
            Effect   = "Allow"
            Action   = "s3:ListBucket"
            Resource = "arn:aws:s3:::${var.analytics_bucket_name}"
            Condition = {
              StringLike = {
                "s3:prefix" = [
                  "raw/review_events",
                  "raw/review_events/*",
                  "marts/content_intelligence",
                  "marts/content_intelligence/*",
                ]
              }
            }
          },
          {
            Sid      = "BucketLocation"
            Effect   = "Allow"
            Action   = "s3:GetBucketLocation"
            Resource = "arn:aws:s3:::${var.analytics_bucket_name}"
          },
          {
            Sid      = "ReadAnalyticsObjects"
            Effect   = "Allow"
            Action   = ["s3:GetObject", "s3:GetObjectVersion"]
            Resource = "arn:aws:s3:::${var.analytics_bucket_name}/raw/review_events/*"
          },
          {
            Sid      = "WriteMarts"
            Effect   = "Allow"
            Action   = ["s3:PutObject", "s3:DeleteObject"]
            Resource = "arn:aws:s3:::${var.analytics_bucket_name}/marts/content_intelligence/*"
          },
        ]
      })
      ```
      `core-vpc` appears nowhere in it. The verify simulates: `s3:GetObject` allowed on `…/raw/review_events/event_type=card_reviewed/dt=2026-01-01/x.jsonl`, `s3:PutObject` allowed on `…/marts/content_intelligence/card_snapshot_30d/latest.json.gz`, `s3:GetBucketLocation` allowed, `s3:ListBucket` allowed with `s3:prefix = raw/review_events/x`, and **implicitDeny** for `s3:GetObject` on `arn:aws:s3:::core-vpc/analytics/raw/review_events/x`, `s3:PutObject` on `…/raw/review_events/x`, `s3:DeleteBucket` on the bucket.

6. **`infra/envs/prod/variables.tf`** — append:
   ```hcl
   variable "snowpipe_sqs_arn" {
     type        = string
     default     = ""
     description = "E13: Snowpipe notification channel ARN from `show pipes`; empty until the Snowflake account exists."
   }
   ```
   **`infra/envs/prod/prod.auto.tfvars.example`** — append a comment and `snowpipe_sqs_arn = ""`.

7. **`infra/envs/prod/main.tf`** — additive wiring only (E00 §1.1):
   ```hcl
   locals {
     analytics_bucket_name = "developercards-analytics-622994489535" # E13 (§2.1.3)
   }
   ```
   `module "identity"` gains `analytics_bucket_name = local.analytics_bucket_name` and its `secret_parameter_names` list (E06; wherever the prod list is written — the module call, a root variable default, or the example tfvars) gains the last element `"analytics-salt"`. `module "data"` gains `analytics_bucket_name = local.analytics_bucket_name` and `snowpipe_sqs_arn = var.snowpipe_sqs_arn`. Nothing else in the file moves; `imports.tf`, `backend.tf`, `outputs.tf` untouched.

8. **`infra/README.md` §6** — append one line: `- <YYYY-MM-DD> E13: analytics bucket developercards-analytics-622994489535 (+lifecycle, versioning), snowflake_read → analytics bucket, core-vpc S3Analytics, SSM analytics-salt; snowpipe_sqs_arn stays "" until show pipes (supervisor).`

### Code (`src_C`)

9. **`src_C/Vpc/Runtime/ProgressEvents.cs`** — replace the five-line `private static string HashUserId(string userSub)` method (base `:806-810`) with, verbatim (same 2-space indent as its neighbours):
   ```csharp
   /// <summary>
   /// E13: user_id_hash in the analytics payload is sha256(ANALYTICS_USER_SALT + sub) when the
   /// salt is set and sha256(sub) when it is not (the pre-E13 shape; E00 §6 #22 accepts that the
   /// one 2026-05-09 raw file keeps unsalted hashes). Read once per container; the warning fires
   /// once, on the first ingest after a cold start, so a deploy without the salt is visible in logs.
   /// </summary>
   private static readonly Lazy<string?> AnalyticsSalt = new(() =>
   {
     var salt = Environment.GetEnvironmentVariable("ANALYTICS_USER_SALT");
     if (string.IsNullOrEmpty(salt))
     {
       Log.Event("warn", new { tag = "analytics-salt-missing" });
       return null;
     }
     return salt;
   });

   internal static string HashUserId(string userSub, string? salt)
   {
     var input = string.IsNullOrEmpty(salt) ? userSub : salt + userSub;
     var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(input));
     return Convert.ToHexString(bytes).ToLowerInvariant();
   }

   private static string HashUserId(string userSub) => HashUserId(userSub, AnalyticsSalt.Value);
   ```
   The call site `var userIdHash = HashUserId(userSub);` (`:112`) is unchanged; no new `using`; `Log.Event` is E04's. Nothing else in the file changes.

10. **`src_C/Vpc/Analytics/OutboxPublisher.cs`** — add-only. After `MarkRetry` (base `:165-178`) insert:
    ```csharp
    /// <summary>
    /// E13 retention: rows the publisher already shipped to S3 are the only copy Postgres no
    /// longer needs. pending / processing / retry rows are never touched, so a stuck batch stays
    /// visible to ClaimPending's reclaim. Returns the number of rows removed.
    /// </summary>
    public static async Task<int> DeleteSentOlderThanAsync(NpgsqlConnection conn, int days = 30)
    {
      if (days < 1) throw new ArgumentOutOfRangeException(nameof(days), days, "retention must be at least one day");

      const string sql = """
        delete from analytics_event_outbox
        where status = 'sent'
          and sent_at < now() - make_interval(days => $1::int);
        """;

      return await ExecuteAsync(conn, null, sql, [days]);
    }
    ```
    Signature verbatim: `public static async Task<int> DeleteSentOlderThanAsync(NpgsqlConnection conn, int days = 30)`. No new index (the delete is a monthly-scale scan of `sent` rows), no batching, no transaction (one statement).

11. **`src_C/Vpc/Internal/InternalEvents.cs`** (E12) — in the `outbox/publish` handler, after the `PublishBatchAsync` loop and **before** `RouteMetrics.EmitGauge("OutboxPending", …)`, using the handler's open `NpgsqlConnection`:
    ```csharp
    var retentionDeleted = await OutboxPublisher.DeleteSentOlderThanAsync(conn, days: 30);
    ```
    and add `retentionDeleted` to the counts object the action returns (`res.Ok(new { …, retentionDeleted })`). Keep the handler's failure semantics (a throw fails the async invoke); a retention failure is a failure. Nothing else in the file changes (no new action, no `Handlers` key).

12. **`src_C/env/prod.env.json`** (E06 seed) — add four keys, values exact; every existing key stays:
    ```json
    "ANALYTICS_S3_BUCKET": "developercards-analytics-622994489535",
    "ANALYTICS_S3_PREFIX": "raw/review_events",
    "CI_SNAPSHOT_BUCKET": "developercards-analytics-622994489535",
    "CI_SNAPSHOT_KEY": "marts/content_intelligence/card_snapshot_30d/latest.json.gz"
    ```
    Nothing else: E06's `WORKER_FILE_KEYS` projection keeps these four away from `worker-lambda`.

13. **Env→SSM map** (E06, `src_C/scripts/merge-env.sh` `SSM_TO_ENV`): confirm the row `"analytics-salt":"ANALYTICS_USER_SALT"` is present (E06 seeds it) and that the worker's secret overlay is still `WORKER_SECRET_KEYS='["PGPASSWORD"]'` — then change nothing. Only if the row is missing, add it in E06's exact JSON syntax to `SSM_TO_ENV` (one row; `merge-env.test.sh` case (c) counts six leaves and is not edited by E13 — a missing row is an E06 defect to report, not to paper over). `bash -n` stays clean on both scripts.

14. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/HashUserIdSaltTests.cs` (new)** — usings as `ProgressEventsIntegrationTests.cs:1-10` plus `System.Security.Cryptography`, `System.Text`, `RecallSmith.Lambda.Vpc.Analytics`, `RecallSmith.Lambda.Vpc.Runtime`; namespace `RecallSmith.Lambda.IntegrationTests`. Two classes:
    - `public class HashUserIdSaltTests` (pure; helper `Sha256Hex(string)` = lowercase hex SHA-256 of UTF-8): `NoSalt_MatchesLegacySha256Hex` (`HashUserId("sub-1", null) == Sha256Hex("sub-1")`), `EmptySalt_MatchesLegacySha256Hex` (`""` salt), `Salt_IsPrependedToSub` (`HashUserId("sub-1", "pepper") == Sha256Hex("pepper" + "sub-1")`), `Salt_ChangesTheHash` (salted ≠ unsalted), and `[Theory]` `[MemberData(nameof(GeneratedCases))]` `Salted_IsDeterministicDistinctAndHex(string sub, string saltA, string saltB)` over ≥ 50 cases from a seeded `Random(20260922)` (random `[A-Za-z0-9-]{8,40}` tokens): same inputs → same output, `^[0-9a-f]{64}$`, salted ≠ unsalted, `saltA != saltB ⇒` different hashes, equals `Sha256Hex(saltA + sub)`.
    - `[Collection(PostgresCollection.Name)] public class OutboxRetentionTests` (constructor `(PostgresFixture db)`; helper `InsertAsync(conn, status, DateTimeOffset? sentAt)` = `insert into analytics_event_outbox (event_id, event_type, aggregate_type, aggregate_id, payload, status, sent_at) values ($1::uuid, 'card_reviewed', 'user', 'e13', '{}'::jsonb, $2, $3::timestamptz) returning id`, minting a fresh `Guid`): `DeleteSentOlderThan_RemovesOnlyOldSentRows` — insert (`sent`, −31 d), (`sent`, −1 d), (`pending`, null), (`pending`, −40 d); `DeleteSentOlderThanAsync(conn, 30)` returns ≥ 1; the first id is gone, the other three remain (assert by own ids — the fixture is shared and rerunnable); `DeleteSentOlderThan_IsIdempotent` — same four rows, call twice, second call leaves the three survivors; `DeleteSentOlderThan_RejectsNonPositiveDays` — `Assert.ThrowsAsync<ArgumentOutOfRangeException>` for `0` and `-1`, and no row of the test's own is removed.

### Snowflake

15. **`snowflake/001_content_intelligence_setup.sql:1`** becomes `-- DeveloperCards Content Intelligence Snowflake setup.` — the only change to the file (numstat `1 1`; E00 §2.14).

16. **`snowflake/002_snapshot_export.sql` (new)** — header in the style of `001:1-12`: purpose, "apply AFTER 001, re-run after every edit (every object is create or replace)", the placeholders it uses — `<WAREHOUSE_NAME>`, `<DATABASE_NAME>`, `<ANALYTICS_BUCKET>`, `<STORAGE_INTEGRATION_NAME>` (`<ANALYTICS_PREFIX>` is not used: marts live under a fixed prefix) — and the note that the tasks write the key `src_C/env/prod.env.json` `CI_SNAPSHOT_KEY` names. Then `use database <DATABASE_NAME>;` and, in this order, every DDL `create or replace` (no `create … if not exists` in this file):
    a. `create or replace view marts.card_snapshot_window as` — CTEs `windows` (`select 30 as window_days union all select 90`), `scoped` (`marts.mart_card_quality_daily` joined to `windows` on `event_date >= to_date(dateadd(day, -window_days, current_timestamp()))`, `where answer_mode = 'qa'`), `agg` (group by `window_days, deck_slug, card_stable_uid, card_revision`; `sum(review_count) as review_count`, `max(stated_difficulty) as stated_difficulty`, `max(unique_user_count) as unique_user_count`, and for each of `observed_difficulty_raw, expected_difficulty, difficulty_gap, difficulty_gap_z, easy_rate, good_rate, hard_rate, again_rate, struggle_rate, failure_rate, first_review_easy_rate, repeat_failure_rate, median_dwell_time_ms, expected_dwell_time_ms, dwell_time_gap_z, high_level_user_failure_rate, review_count_to_mastery` the weighted mean `sum(x * review_count) / nullif(sum(iff(x is null, 0, review_count)), 0)`), `scored` (adds `dwell_time_ratio = median_dwell_time_ms / nullif(expected_dwell_time_ms, 0)`, `post_card_dropout_rate = null`, and the three statuses + `fix_priority_score` copied from `001:210-253` with the `answer_mode = 'mcq'` branch removed). The final `select` projects **exactly 31 columns, one per line, each written `<expr> as <name>` (also `deck_slug as deck_slug`), no `cast(` (use `::`), bracketed by the two sentinel comment lines** the verify keys on:
       ```sql
       select
         -- snapshot-columns:begin
         window_days as window_days,
         to_char(convert_timezone('UTC', dateadd(day, -window_days, current_timestamp())), 'YYYY-MM-DD HH24:MI:SS.FF3') || '+00:00' as window_start_at,
         to_char(convert_timezone('UTC', current_timestamp()), 'YYYY-MM-DD HH24:MI:SS.FF3') || '+00:00' as window_end_at,
         deck_slug as deck_slug,
         card_stable_uid as card_stable_uid,
         card_revision as card_revision,
         stated_difficulty as stated_difficulty,
         review_count as review_count,
         unique_user_count as unique_user_count,
         observed_difficulty_raw as observed_difficulty_raw,
         expected_difficulty as expected_difficulty,
         difficulty_gap as difficulty_gap,
         difficulty_gap_z as difficulty_gap_z,
         easy_rate as easy_rate,
         good_rate as good_rate,
         hard_rate as hard_rate,
         again_rate as again_rate,
         struggle_rate as struggle_rate,
         failure_rate as failure_rate,
         repeat_failure_rate as repeat_failure_rate,
         median_dwell_time_ms as median_dwell_time_ms,
         expected_dwell_time_ms as expected_dwell_time_ms,
         dwell_time_ratio as dwell_time_ratio,
         high_level_user_failure_rate as high_level_user_failure_rate,
         post_card_dropout_rate as post_card_dropout_rate,
         review_count_to_mastery as review_count_to_mastery,
         difficulty_calibration_status as difficulty_calibration_status,
         content_quality_status as content_quality_status,
         confidence_level as confidence_level,
         fix_priority_score as fix_priority_score,
         to_char(convert_timezone('UTC', current_timestamp()), 'YYYY-MM-DD HH24:MI:SS.FF3') || '+00:00' as source_generated_at
         -- snapshot-columns:end
       from scored;
       ```
       The name set equals `CardSnapshotRow`'s `JsonPropertyName` set (Context); the verify diffs them.
    b. `create or replace stage marts.snapshot_stage` with `url = 's3://<ANALYTICS_BUCKET>/marts/content_intelligence/'` and `storage_integration = <STORAGE_INTEGRATION_NAME>`.
    c. Two tasks, one statement each (a task body is one SQL statement):
       ```sql
       create or replace task marts.snapshot_export_30d
         warehouse = <WAREHOUSE_NAME>
         schedule = 'USING CRON 0 1 * * * UTC'
       as
       copy into @marts.snapshot_stage/card_snapshot_30d/latest.json.gz
       from (select object_construct_keep_null(*) from marts.card_snapshot_window where window_days = 30)
       file_format = (type = json compression = gzip)
       single = true
       overwrite = true;
       ```
       and `marts.snapshot_export_90d` identical with `card_snapshot_90d/latest.json.gz` / `where window_days = 90`. Then `alter task marts.snapshot_export_30d resume;` and `alter task marts.snapshot_export_90d resume;` (tasks are created suspended). 01:00 UTC is one hour before E12's `snapshot-import` schedule (`cron(0 2 * * ? *)`), so each day's import reads that day's export.

17. **`snowflake/README.md`** — keep the title; add/replace sections: **Account** (Standard edition, AWS `ap-southeast-2` (Sydney), on-demand billing, one X-Small warehouse with `auto_suspend = 60` and `auto_resume = true`, a resource monitor of 10 credits/month that suspends at 100 %, the storage integration's IAM role `snowflake-recallsmith-s3-role` now reads `s3://developercards-analytics-622994489535/raw/review_events/` and writes `marts/content_intelligence/`); **Bucket and prefix** (`ANALYTICS_S3_BUCKET` / `CI_SNAPSHOT_BUCKET` are set from `src_C/env/prod.env.json`; `ANALYTICS_S3_PREFIX = raw/review_events`; the `001` placeholders map to `<ANALYTICS_BUCKET> = developercards-analytics-622994489535`, `<ANALYTICS_PREFIX> = raw/review_events`; the `CONTENT_BUCKET` fallback in code is for local runs only); **Applying `002_snapshot_export.sql`** (after `001`, re-run after every edit, requires `execute task` on the role, what the two tasks write and when, the `snapshot-import` schedule one hour later, that `unique_user_count` is a daily-peak floor and `post_card_dropout_rate` is null until an event-grain export exists); **Snowpipe notification** (replace the `:62` sentence: `show pipes like 'REVIEW_EVENTS_PIPE' in schema raw;` → `notification_channel` → set `snowpipe_sqs_arn` in `infra/envs/prod/prod.auto.tfvars` → the supervisor plans and applies `module.data.aws_s3_bucket_notification.analytics[0]`); **Salt** (`user_id_hash = sha256(ANALYTICS_USER_SALT + sub)`; the salt lives in SSM `/developercards/prod/analytics-salt` and reaches core-vpc at deploy time; rotating it changes every hash; the 2026-05-09 raw file predates the salt). Update the "Publisher endpoint" env-var bullets to the new names/values and keep the created-objects list, adding `marts.card_snapshot_window`, `marts.snapshot_stage`, `marts.snapshot_export_30d`, `marts.snapshot_export_90d`.

### Allow-list

18. Not a change — the supervisor's post-apply list is under Verify.

19. **`docs/delivery/r16-issues/E13.plan-allow.json` (new)** — the supervisor's `check-plan.py` input (E00 §3.1). Content, byte-for-byte except that the two identity addresses are written exactly as the tree declares them (append `[0]` only if E01/E05 count-guarded that block):
    ```json
    {
      "tags_only_updates": false,
      "changes": {
        "module.data.aws_s3_bucket.analytics[0]": "create",
        "module.data.aws_s3_bucket_public_access_block.analytics[0]": "create",
        "module.data.aws_s3_bucket_ownership_controls.analytics[0]": "create",
        "module.data.aws_s3_bucket_server_side_encryption_configuration.analytics[0]": "create",
        "module.data.aws_s3_bucket_versioning.analytics[0]": "create",
        "module.data.aws_s3_bucket_lifecycle_configuration.analytics[0]": "create",
        "module.identity.aws_ssm_parameter.secret[\"analytics-salt\"]": "create",
        "module.identity.aws_iam_policy.snowflake_read": { "action": "update", "keys": ["policy"] },
        "module.identity.aws_iam_role_policy.core_vpc": { "action": "update", "keys": ["policy"] }
      }
    }
    ```
    Seven creates, two updates, nothing else; no `expect_imports`, no `outputs`. `module.data.aws_s3_bucket_notification.analytics[0]` must NOT be in the plan.

Estimated size: analytics.tf ~95 lines; variables/outputs ~30; policies.tf ~+45/−6; envs/prod ~+12; README §6 1; ProgressEvents +24/−5; OutboxPublisher +18; InternalEvents +2; prod.env.json +4; map +1; test file ~150; 002 ~130; snowflake README ~+45/−8; allow JSON 15.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/E13.verify.sh` re-runs exactly these.

1. Scope files exist (exit 0): `infra/modules/data/analytics.tf`, `snowflake/002_snapshot_export.sql`, `src_C/Tests/RecallSmith.Lambda.IntegrationTests/HashUserIdSaltTests.cs`, `docs/delivery/r16-issues/E13.plan-allow.json`; prerequisites from the queue: `infra/scripts/check-plan.py` (E01), `infra/modules/identity/policies.tf` (E05), `infra/modules/identity/ssm.tf` and `src_C/env/prod.env.json` (E06), `infra/envs/staging/main.tf` (E10), `src_C/Vpc/Internal/InternalEvents.cs` (E12), `PublishBatchAsync` in `OutboxPublisher.cs` and `static void Event(` in `Log.cs` (E04).
2. Literal guards (exit 0):
   - `analytics.tf`: the seven `resource "…" "analytics"` blocks; six occurrences of `count = var.analytics_bucket_name == "" ? 0 : 1`; the notification count `var.analytics_bucket_name != "" && var.snowpipe_sqs_arn != "" ? 1 : 0`; `prevent_destroy = true`; the four PAB flags `= true`; `object_ownership = "BucketOwnerEnforced"`; `sse_algorithm = "AES256"`; `status = "Enabled"` ×3 (versioning + two rules); `id = "raw-tiering"`, `prefix = "raw/"`, `days = 90`, `storage_class = "GLACIER_IR"`, `days = 730`; `id = "noncurrent-90d"`, `noncurrent_days = 90`, `days_after_initiation = 7`; `queue_arn = var.snowpipe_sqs_arn`, `events = ["s3:ObjectCreated:*"]`, `filter_prefix = "raw/review_events/"`; none of `provisioner`, `local-exec`, `null_resource`, `archive_file`, `kms_master_key_id`, `force_destroy`, `tags`.
   - `data/variables.tf`: `variable "analytics_bucket_name"`, `variable "snowpipe_sqs_arn"`, each with `default     = ""`; `data/outputs.tf`: `output "analytics_bucket_arn"`, `output "analytics_bucket_name"`; `identity/variables.tf`: `variable "analytics_bucket_name"`.
   - `identity/policies.tf`: `S3Analytics`, `var.analytics_bucket_name`, `resource "aws_iam_policy" "snowflake_read"`, `ListAnalyticsPrefix`, `BucketLocation`, `ReadAnalyticsObjects`, `WriteMarts`, `s3:GetBucketLocation`, `s3:GetObjectVersion`, `marts/content_intelligence/*`, `raw/review_events/*`; `identity/main.tf` has no `resource "aws_iam_policy" "snowflake_read"` block left and (if changed) zero added lines.
   - `envs/prod/main.tf`: `analytics_bucket_name = "developercards-analytics-622994489535"` once, `analytics_bucket_name = local.analytics_bucket_name` twice, `snowpipe_sqs_arn = var.snowpipe_sqs_arn` once; `"analytics-salt"` in `main.tf`, `variables.tf` or `prod.auto.tfvars.example`; `envs/prod/variables.tf`: `variable "snowpipe_sqs_arn"`; `prod.auto.tfvars.example`: `snowpipe_sqs_arn`; `infra/README.md`: a `- ` line containing `E13`.
   - `ProgressEvents.cs`: `internal static string HashUserId(string userSub, string? salt)`, `private static string HashUserId(string userSub) => HashUserId(userSub, AnalyticsSalt.Value);`, `private static readonly Lazy<string?> AnalyticsSalt`, `"ANALYTICS_USER_SALT"`, `tag = "analytics-salt-missing"`, `salt + userSub`, `var userIdHash = HashUserId(userSub);`; HEAD minus the region (the `///` lines above `AnalyticsSalt` through the delegating method) is byte-identical to the merge base minus the old five-line method.
   - `OutboxPublisher.cs`: `public static async Task<int> DeleteSentOlderThanAsync(NpgsqlConnection conn, int days = 30)`, `where status = 'sent'`, `sent_at < now() - make_interval(days => $1::int)`, `ArgumentOutOfRangeException`; numstat removed = 0.
   - `InternalEvents.cs`: `OutboxPublisher.DeleteSentOlderThanAsync(` with `days: 30` and `retentionDeleted`; its line precedes `EmitGauge("OutboxPending"`; ≤ 3 hunks.
   - `prod.env.json` parses; the four keys carry the exact values of Changes 12; every key present at the merge base is still present.
   - the map: one line of `src_C/scripts/merge-env.sh` (or `deploy.sh`) contains both `analytics-salt` and `ANALYTICS_USER_SALT` (E06's seeded row); `bash -n` on `src_C/deploy.sh` and `merge-env.sh`; if either file changed at all, its added lines invoke neither `aws` nor `terraform`.
   - `HashUserIdSaltTests.cs`: `public class HashUserIdSaltTests`, `[Collection(PostgresCollection.Name)]`, `public class OutboxRetentionTests`, `[Theory]`, `[MemberData(nameof(GeneratedCases))]`, `analytics_event_outbox`, and the eight method names of Changes 14.
   - `001…sql:1` equals `-- DeveloperCards Content Intelligence Snowflake setup.`; numstat `1 1`.
   - `002_snapshot_export.sql`: `create or replace view marts.card_snapshot_window`, `create or replace stage marts.snapshot_stage`, `s3://<ANALYTICS_BUCKET>/marts/content_intelligence/`, `storage_integration = <STORAGE_INTEGRATION_NAME>`, `create or replace task marts.snapshot_export_30d`, `create or replace task marts.snapshot_export_90d`, `warehouse = <WAREHOUSE_NAME>` ×2, `USING CRON 0 1 * * * UTC` ×2, `@marts.snapshot_stage/card_snapshot_30d/latest.json.gz`, `@marts.snapshot_stage/card_snapshot_90d/latest.json.gz`, `object_construct` ×2, `file_format = (type = json compression = gzip)` ×2, `single = true` ×2, `overwrite = true` ×2, `alter task marts.snapshot_export_30d resume`, `alter task marts.snapshot_export_90d resume`, `where window_days = 30`, `where window_days = 90`, `answer_mode = 'qa'`, `use database <DATABASE_NAME>`, `convert_timezone('UTC'`; every `create ` statement is `create or replace`; no `if not exists`; the placeholder set `<[A-Z_]+>` ⊆ the five of `001`; the sentinel lines `-- snapshot-columns:begin` / `-- snapshot-columns:end` exactly once each with exactly 31 `… as <name>` lines between them, no `cast(`, and the sorted name set equals the sorted `JsonPropertyName` set of `ContentIntelligenceSnapshotImport.cs` (31 = 31).
   - `snowflake/README.md`: `002_snapshot_export.sql`, `snowpipe_sqs_arn`, `auto_suspend = 60`, `developercards-analytics-622994489535`, `raw/review_events`, `analytics-salt`, `marts.card_snapshot_window`, `notification_channel`; line 1 unchanged.
   - `E13.plan-allow.json` parses; `tags_only_updates` false; no `expect_imports`/`outputs`; exactly the nine addresses of Changes 19 (identity ones ± `[0]`), seven `"create"` and two `{ "action": "update", "keys": ["policy"] }`.
   - no `Skip =`, `#pragma warning disable`, `.skip(`, `.only(`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable` in any scope file; the E00 secret-leak regex matches no added line; no added line outside comments/echo (excluding `docs/delivery/r16-issues/`) matches `terraform +(apply|import)` or `aws +[a-z0-9-]+ +(create|update|delete|put)-`; the `+` lines of the map file contain neither `aws ` nor `terraform`.
3. Root gates (exit 0): `terraform fmt -check -recursive infra`; `terraform init -backend=false -input=false && terraform validate` in `infra/envs/prod` and `infra/envs/staging`; `cd src_C && dotnet build Tests/RecallSmith.Lambda.IntegrationTests -c Debug --nologo`.
4. Plan + tests (exit 0, `AWS_PROFILE=dev`, Docker): in a scratch copy of `infra/`, `terraform init -input=false -reconfigure` (real S3 backend, read) → `terraform plan -input=false -lock=false -out=e13.tfplan` → `terraform show -json` → the inline checker: the effective set is exactly the nine changes of Changes 19 (creates/updates as listed, update keys ⊆ `{policy}`, no `aws_s3_bucket_notification`, no delete/replace, no output change); `aws iam simulate-custom-policy` over the two planned documents gives the allowed/implicitDeny matrix of Changes 5; `python3 infra/scripts/check-plan.py --plan … --allow docs/delivery/r16-issues/E13.plan-allow.json` prints `PLAN OK`; then `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests -c Debug --no-build --nologo --filter "FullyQualifiedName~HashUserIdSaltTests|FullyQualifiedName~OutboxRetentionTests"`. Plan files are deleted by the trap; nothing but addresses, actions and key names is printed.
5. Scope + frozen + OTA guard (exit 0): `git diff --name-only <merge-base>` ∪ pathspec-scoped untracked scan of `infra src_C/Vpc src_C/Tests src_C/env src_C/scripts src_C/deploy.sh snowflake docs` contains nothing outside the scope list (+ `docs/delivery/r16-issues/`); `imports.tf`, `backend.tf`, `envs/prod/outputs.tf`, `envs/staging/**`, `identity/ssm.tf`, `data/buckets.tf`, `mobile/**`, `frontend/**`, `.github/**`, every other `src_C/Tests/**` file, `ContentIntelligenceSnapshotImport.cs`, `VpcFunction.cs` are zero-diff; the three frozen mobile files, `mobile/package.json`, `package-lock.json`, `app.json` (`"version": "1.6.1"`), `eas.json` zero-diff; no `@sentry` under `mobile/src`; no `.tfplan`/`.plan.json`/`generated*.tf`/`*.auto.tfvars` tracked; no `profile = "` in `infra/**/*.tf`.

## Verify

```bash
export AWS_PROFILE=dev
BASE=delivery/r16-e-prod bash docs/delivery/r16-issues/E13.verify.sh
```
Steps 1–2 are file/literal checks (seconds); step 3 is fmt/validate ×2 + the test-project build (~1–2 min cold); step 4 is the real-state plan (~1–2 min of refresh reads; needs `E01` applied so `s3://recallsmith-tfstate-622994489535/envs/prod/terraform.tfstate` exists), the policy simulations, `check-plan.py`, then one `postgres:16-alpine` container and the two classes; step 5 is the guard. Variables: the plan loads `prod.auto.tfvars` when the worktree has one; otherwise a copy of `prod.auto.tfvars.example` minus `alert_email` / `snowflake_external_id`, which are looked up read-only (only when `variable "alert_email"` / `variable "snowflake_external_id"` exist in `envs/prod/variables.tf`) and exported as `TF_VAR_*`. Optional env: `E13_TFVARS=/path/to/prod.auto.tfvars` (the supervisor's real file) skips the lookups. Runtime < 10 min. The driver additionally runs the `infra` root gate (`cd infra/envs/prod && terraform init -backend=false -input=false && terraform validate && terraform fmt -check -recursive ..`), the `src_C` root gate (full `dotnet test`, Docker), the diff-scoped banned-term grep and the suppression scan — keep every other test class green.

**The supervisor applies** (never the worker), after merge, in this order: `terraform init` (real backend) → `terraform plan -out=e13.tfplan` → `terraform show -json e13.tfplan | python3 infra/scripts/check-plan.py --allow docs/delivery/r16-issues/E13.plan-allow.json` → apply the saved plan (7 creates, 2 updates) → **post-apply**: (1) `aws ssm put-parameter --name /developercards/prod/analytics-salt --type SecureString --value "$(openssl rand -hex 32)" --overwrite`; (2) copy the two historical objects, `aws s3 cp s3://core-vpc/analytics/raw/review_events/ s3://developercards-analytics-622994489535/raw/review_events/ --recursive` and `aws s3 cp s3://core-vpc/analytics/marts/content_intelligence/card_snapshot_30d/latest.json.gz s3://developercards-analytics-622994489535/marts/content_intelligence/card_snapshot_30d/latest.json.gz` (the old copies under `core-vpc/analytics/` are removed only after the Snowflake account has loaded the new bucket and the owner says so in `infra/README.md` §6, like §6 #15); (3) `ENV=prod ./src_C/deploy.sh` (overlay adds the four keys and `ANALYTICS_USER_SALT`); (4) smoke: `scripts/invoke-as-admin.sh core-vpc:prod` with the E12 event `{"source":"developercards.scheduler","action":"outbox/publish","args":{"limit":5000}}` → response carries `retentionDeleted`; `aws s3api list-objects-v2 --bucket developercards-analytics-622994489535 --prefix raw/review_events/ --max-keys 5`; the core-vpc log has no `analytics-salt-missing` after the deploy; (5) second `terraform plan` must be empty. **Owner, when the Snowflake account exists:** apply `001` with `<ANALYTICS_BUCKET> = developercards-analytics-622994489535`, `<ANALYTICS_PREFIX> = raw/review_events`; `describe storage integration` → if the IAM user / external id differ from today's trust, update `snowflake_external_id` (and the trust principal, which is E01's variable set) and re-plan; `show pipes like 'REVIEW_EVENTS_PIPE' in schema raw;` → `notification_channel` → `snowpipe_sqs_arn = "arn:aws:sqs:…"` in `prod.auto.tfvars` → plan (1 create: `module.data.aws_s3_bucket_notification.analytics[0]`) → apply; apply `002`; the next 01:00 UTC export followed by the 02:00 UTC import closes the loop.

## Do NOT

- Do NOT rename, move or re-tag `core-vpc`, `core-vpc-premium`, `snowflake-recallsmith-s3-role`, `snowflake-recallsmith-s3-read` or any adopted address (E00 §0); do NOT touch `imports.tf`, `backend.tf`, the lock file, provider versions or `default_tags`.
- Do NOT create the bucket notification unconditionally, hard-code an SQS ARN, add a bucket policy, a KMS key, logging, `force_destroy`, or a data source that reads Snowflake state; do NOT set the notification's count from anything but `var.snowpipe_sqs_arn`.
- Do NOT leave `arn:aws:s3:::core-vpc/analytics/*` reachable from the prod core-vpc policy or from `snowflake_read`; do NOT add `Resource: "*"` anywhere but `Eni`; do NOT touch `worker`/`edge_public` policies or the Snowflake role's trust.
- Do NOT read the salt per request, HMAC it, trim it, hash `sub + salt` (the order is `salt + sub`), change the call site at `:112`, drop `device_id`, or log the salt/hash; do NOT widen `HashUserId` to `public`.
- Do NOT delete `pending`/`processing` rows, batch the delete, add an index or a migration, or run the retention from the HTTP `HandlePublishOutbox`; the scheduled action is the only caller.
- Do NOT write `object_construct(*)` without the null-keeping variant's intent being clear, `create … if not exists`, `cast(`, a fifth placeholder, MCQ rows (`answer_mode <> 'qa'`), or a `select *` in the view's final projection; do NOT change `001` beyond line 1.
- Do NOT commit or paste `*.tfplan`, `*.plan.json`, `generated*.tf`, a `prod.auto.tfvars`, plan stdout, or any `before`/`after` value; do NOT run `terraform apply`/`import`, `aws ssm put-parameter`, `aws s3 cp/rm`, `aws lambda invoke`, `./deploy.sh` without `DRY_RUN=1`, `eas`, or `git` inside the shared checkout.
