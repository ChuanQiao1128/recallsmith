# E04 — observability (`observability`)

Give prod its first alerting path and its first structured telemetry, as one Terraform plan plus one bounded server change. Infra: SNS topic `developercards-alerts` + email subscription + topic policy, twelve CloudWatch alarms (API 5xx rate, Lambda Errors/Throttles ×2, core-vpc Duration p95, SQS oldest-age, DLQ non-empty, RDS CPU/free-storage/connections, outbox backlog), an RDS event subscription, a JSON access log on both API stages with detailed metrics, and a `developercards-prod` dashboard. Code: every `Log.*` line becomes one JSON object with `ts`+`level`, a new `Log.Event`, the EMF namespace flips to `DeveloperCards`, a dimensionless `RouteMetrics.EmitGauge`, `internal:<action>` route labels, and `OutboxPublisher.PublishBatchAsync` whose HTTP handler ends by emitting the `OutboxPending` gauge alarm 12 reads. Root: `src_C+infra`. Nothing in `mobile/`, `frontend/`, `.github/`.

## Context

Base: `delivery/r16-e-prod` (== `main@4b07f19`). Every `file:line` below was read on that tree on 2026-09-22; every AWS fact was re-read the same day with `AWS_PROFILE=dev` (account `622994489535`, `ap-southeast-2`), describe/get/list only. `docs/delivery/r16-issues/E00-contracts.md` (E00) is binding: §2.4 (`:253-279`) is this issue's contract, §0 the non-negotiables, §1.1/§1.2 the file map, §2.1 the Terraform conventions, §3.1/§3.3 the test contracts, §5 the verify conventions, §6 #4/#5/#6 the three decisions that shape it. E04 sits after E03 in the merge order (§4: alarm 8 needs E03's DLQ output; the gauge/namespace flip must land before E05's role work). The worker rebases on the integration branch that already carries E01–E03 — read their files first, they are the tree this brief extends.

What the account looks like today (CLI, read-only):

- `cloudwatch describe-alarms` → **0** alarms; `sns list-topics` → **0**; `cloudwatch list-dashboards` → **0**; `rds describe-event-subscriptions` → **0**. Review §2.3.1 (`docs/backend-architecture-review-2026-09-22.md:121`) rates this **critical**: "故障由用户发现".
- `apigatewayv2 get-stages --api-id ktbq1sie2c` → both `$default` and `dev` have `AccessLogSettings: null`, `DetailedMetricsEnabled: false` (review §2.3.3, `:123`). `logs describe-log-groups --log-group-name-prefix /aws/apigateway` → none.
- `cloudwatch list-metrics --namespace RecallSmith` → **54** metrics (26 `Latency` series with the three dimensions); `--namespace DeveloperCards` → **0**. The alarms of this issue read `DeveloperCards/…`, so the constant flips here, not in E14 (E00 §6 #4).
- `lambda get-function-configuration core-vpc` → `LoggingConfig.LogFormat = Text`, `Timeout 90`, env has `LOG_LEVEL=info` and no `METRICS_NAMESPACE`/`METRICS_DISABLED`; `worker-lambda` → `Text`, `Timeout 615`. `LogFormat` stays `Text` (E00 §6 #6): the .NET runtime's JSON mode wraps every `Console` line as `{"message":"<escaped>"}`, which Logs Insights does not index, whereas a Text-format line that *is* JSON is auto-indexed.
- RDS `developercards`: `db.t4g.micro`, 20 GiB allocated, `FreeStorageSpace` min over the last day 18.35 GB, `DatabaseConnections` max over the last 7 days **9** — the 2 GiB / 60-connection thresholds of E00 §2.4.2 are far from today's values and alarm on real trouble only.
- `sqs list-queues` → only `recallsmith-publish-jobs`; the DLQ `developercards-publish-jobs-dlq` is created by E03 (`infra/modules/worker/queue.tf`, output `publish_dlq_name`) and is a prerequisite of alarm 8.

What the code looks like today:

- **`src_C/Shared/RecallSmith.Lambda.Common/Log.cs`** (33 lines): `LogLevel` read once from `LOG_LEVEL` (`:5-6`), `Join` (`:8-12`, args joined by one space, `null` → `"null"`), `Debug` (`:14-17`, only when `debug`), `Info` (`:19-22`, `debug|info`), `Warn`/`Error` (`:24-32`, always, to `Console.Error`). Lines are plain text; nothing carries a timestamp or a level.
- **Callers that already hand `Log` a JSON string** and whose tests read its keys at the TOP level: `src_C/Vpc/Warmup.cs:389-416` (`SafeLogDb` builds `{"step":"db-warmup",…}` and calls `Log.Info(line)` `:409` / `Log.Warn(line)` `:410`; `SafeLog` `:418-436` the same for `step = "warmup"`), `src_C/Shared/RecallSmith.Lambda.Common/Auth.cs:127-133` (`Log.Warn(JsonSerializer.Serialize(new { level = "warn", tag = "auth", … }))`) and `:223-234` (`tag = "auth"` line via `Log.Info`/`Log.Warn`). `DbWarmupTests.cs:64-74` selects the line by `l.Contains("\"step\":\"db-warmup\"")` and reads `step`/`outcome`/`ok`/`ms`/`connectMs`/`probeMs` with `GetProperty` (`:134-147`, `:261-262`, `:299`, `:369`). A `Log` that wrapped a JSON argument as `"msg":"{\"step\":…}"` would break that file, and it must stay byte-identical (E00 §1.2). Hence Changes 11's embedding rule.
- **Two `Log.Info(JsonSerializer.Serialize(new {…}))` blocks in `src_C/Vpc/VpcFunction.cs`**: the boot line `:51-62` (`tag = "boot"`, `lambda`, `version`, `apiEnv`, `allowDevPremium`, `disallowSandbox`, `path`, `method`) and the request line `:86-98` (`traceId`, `lambda`, `method`, `path`, `userSub`, `username`, `groups`, `isAdmin`, `isSuperAdmin`). E00 §2.4.6 migrates both to `Log.Event`. E00 §1.2/§2.16 list five other owners of this file (E03 `:207-210`, E06 `:123-126`, E07 `:101`, E12 `:32-34`, E14 signature) and omit E04 from the table; §2.4.6 is the specific contract and wins — the two regions above are disjoint from every other owner's, E03's insert (already merged) sits ≥ 100 lines below, and nothing else in the file moves.
- **`src_C/Vpc/Webhooks/RevenuecatWebhook.cs:407-421`**: `Console.WriteLine(JsonSerializer.Serialize(new { tag = "rc-webhook", impl, mode, isTest, route, eventId, type, environment, appUserId, productId, promo, promoAllowed }))` — the only stdout line in the file that does not go through `Log`. E00 §2.4.6 names it; E07 (webhook semantics, later in the queue) edits other regions of the file and rebases on this. The four `Log.Warn("[rc-webhook] …")` lines (`:338`, `:347`, `:365`, `:404`) are untouched — they become `{"ts","level":"warn","msg":"[rc-webhook] …"}` by Changes 11 alone.
- **`src_C/Shared/RecallSmith.Lambda.Common/Res.cs:188-199`** writes the `tag = "unhandled"` 500 line straight to `Console` (it already carries `level = "error"`, no `ts`). `Res.cs` is E07's file (E00 §1.2); E04 does not open it.
- **`src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs`** (419 lines): `DefaultNamespace = "RecallSmith"` `:42`, `NamespaceEnvVar` `:43`, `DisableEnvVar` `:54`, the `StaticRoutes` allowlist `:93-148`, `TemplateRoutes` `:158-164`, `KnownRoutes` `:190`, `RouteFor` `:198-218` (static suffix walk, then template match, else `"unmatched"`), `BuildLine` `:281-325` (the EMF envelope), `Emit` `:381-418` (`Console.Out.WriteLine(line)` `:411`, swallow-all catch). Comment `:72-92` explains why the route label is an allowlist: a dimension value is billed per unique combination, so it must never be derived from free input. `RouteMetricsTests.cs:525-556` (`RouteTable_AndTheDispatchers_NameTheSameRoutes`) asserts `KnownRoutes` == the `p.EndsWith("…")`/`req.Path == "…"`/`RouteMatcher.Match("…")` literals of the two dispatchers — so the new `internal:` labels must NOT enter `KnownRoutes`.
- **`src_C/Vpc/Analytics/OutboxPublisher.cs`** (243 lines): static `AmazonS3Client` `S3()` `:19-25`, `Reset` `:27-33`, `NormalizePrefix` `:35-39`, `AnalyticsBucket()` `:41-45` (`ANALYTICS_S3_BUCKET ?? CONTENT_BUCKET`), `ParseLimit` `:53-57` (1..5000, default 500), `BuildJsonl` `:78-95`, `ClaimPending` `:97-148` (own transaction, `for update skip locked`, 15-minute reclaim), `MarkSent` `:150-163`, `MarkRetry` `:165-178`, `HandlePublishOutbox` `:180-242`: auth `:185`, POST `:187`, bucket `:189-193`, limit/prefix `:195-196`, connection `:198-202`, then the batch body `:204-241` (claim → key → body → `PutObjectAsync` → `MarkSent` → `Ok{ok,published,bucket,key,bytes}`; catch → `MarkRetry` → `Log.Error` → `res.Error500(ex)`). No console page reads this response (`grep -rn outbox frontend/src` → 0); it is an admin curl/console-button endpoint, so the response keys may change. Index `idx_analytics_outbox_pending` (`src_C/Vpc/Db/Migrations/009_content_intelligence_events.sql:48-50`) covers the pending count.
- **Tests.** `src_C/Tests/RecallSmith.Lambda.IntegrationTests/RouteMetricsTests.cs:39` `private const string Ns = "RecallSmith";`, `:389` `Environment.SetEnvironmentVariable(RouteMetrics.NamespaceEnvVar, "RecallSmith/Staging");`, `:394` `"RecallSmith/Staging",` — the only three `"RecallSmith` literals in any test; E04 may change exactly those (E00 §1.2). `DbWarmupTests.cs:42-62` is the `CaptureAsync` pattern (redirect `Console.Out`/`Console.Error`, restore in `finally`; safe only inside `[Collection(PostgresCollection.Name)]`, `:28-32` of RouteMetricsTests). The test csproj has xunit 2.5.3, Npgsql, Dapper, Testcontainers — no mocking library, so `PublishBatchAsync` is covered by the build + literal guards, not by a fake `IAmazonS3`. `Validation.NormalizePath` (`Validation.cs:160-176`) strips a stage prefix only in front of `/health` and `/api/`, so E12's synthetic `rawPath = "/internal/<action>"` reaches `RouteFor` unchanged.

What E00 decided (and why):

- §2.4.1–2.4.5: the resource set, names, thresholds, categories, log format and widget order below are copied from E00 verbatim; the brief adds only Terraform spelling. §6 #5: twelve alarms, not fourteen (worker Duration is folded into worker Errors, SQS visible backlog into age); E12 adds the thirteenth to `alarms.tf`. §6 #3: the `dev` stage is adopted and kept — the access log and detailed metrics apply to both stages.
- §2.1: no `provisioner`/`null_resource`/`external`/`archive_file`; provider blocks carry `region` only; new names use the `developercards-` prefix; `terraform fmt` clean; `.terraform.lock.hcl` untouched.
- §3.1: the worker's plan is checked by `infra/scripts/check-plan.py` against `docs/delivery/r16-issues/E04.plan-allow.json` — the worker creates that file with exactly the content of Changes 13 (the verify compares it byte-for-byte after JSON normalisation, so it cannot be loosened).
- §0/§5 vs. the tree — **resolved by E01 (gap 13), binding for every infra verify**: E00 §0 says every worker plan runs after `terraform init -backend=false` "against an empty local state". Probed on 2026-09-22 with Terraform 1.16.3 in a scratch root carrying the E00 `backend "s3"` block: `init -backend=false` succeeds, but the following `terraform plan` exits 1 with `Backend initialization required` — a plan cannot run without an initialised backend. E01's brief (`docs/delivery/r16-issues/E01-terraform-adopt.md:39`) therefore made every worker plan use a gitignored `infra/envs/prod/backend_override.tf` (`terraform { backend "local" { path = "<under $TMP>/terraform.tfstate" } }`) + `terraform init -input=false -reconfigure` + `terraform plan -out`, and E02/E03's verifies copy it. The S3 state bucket is never contacted by a worker (E00 §0 "Workers never touch it"). Consequences (E03's brief, "worker-side plan noise"): the empty-state plan carries the 93 `importing` entries, E02/E03's resources as `create` (they exist in the account but are not in `imports.tf`, §6 #20), the provider-side RDS `update` (`apply_immediately`/`skip_final_snapshot`/`final_snapshot_identifier`) and every pre-existing root output as a `create` `output_changes` entry. `E04.verify.sh` step 4 drops exactly those three kinds before `check-plan.py` — creates whose address `E02.plan-allow.json`/`E03.plan-allow.json` list as `create`, the RDS update when its changed keys ⊆ the three, outputs declared in the merge-base `outputs.tf` — printing each dropped address; the supervisor's plan against the real backend has none of them and is checked unfiltered with the same `E04.plan-allow.json`. The scope guard (step 5) is what makes the filter safe. The plan file embeds Lambda environments (E00 §0 "Secrets"): it lives in a `mktemp -d`, only `check-plan.py` and the filter read it, and the `trap` removes it together with the override file.
- §2.2.6/§2.4.1 and the E02 brief: E01 adopted the budget with the live subscriber e-mail **as a literal** in `infra/modules/observability/budget.tf` (three `notification` blocks); E02 left it ("the root variable `alert_email` is created by E04 … E04 swaps the subscriber to `var.alert_email`"). So E04 (a) creates `variable "alert_email"` (root + module, `sensitive = true`, no default; `prod.auto.tfvars.example` carries `alerts@example.invalid`), (b) replaces the three literals by `[var.alert_email]` — after this issue no e-mail address is tracked under `infra/`, and (c) feeds the SNS subscription from the same variable. The worker has no `prod.auto.tfvars`: the verify reads the adopted literal from the **merge-base** copy of `budget.tf` (`git show <mb>:infra/modules/observability/budget.tf`) into `TF_VAR_alert_email` (never printed), so the worker's plan shows the budget as a no-op exactly as the supervisor's does with the real tfvars; the Snowflake ExternalId comes from `aws iam get-role` as in E01 gap 2 / E02's verify.

## Read first

1. `docs/delivery/r16-issues/E00-contracts.md` §0 (`:9-37`), §1.1 (`:43-69`, the `observability`/`api` rows), §1.2 (`:71-110`, E04 column + the tests paragraph), §2.1 (`:114-211`), §2.4 (`:253-279`), §2.11 (`:359-379`, the six internal action names), §3.1 (`:419-430`), §3.3 (`:436-438`), §5 (`:470-482`), §6 #4, #5, #6 (`:488-490`).
2. On the integration branch (E01–E03 merged): `infra/README.md` §1–§5, `infra/envs/prod/{main,variables,outputs,providers}.tf`, `prod.auto.tfvars.example`, `infra/modules/observability/{main,variables,outputs,budget}.tf`, `infra/modules/api/{gateway,variables,outputs}.tf` (the two `aws_apigatewayv2_stage` resources), `infra/modules/worker/{queue,outputs}.tf` (`publish_dlq_name`), `infra/scripts/check-plan.py`, `infra/modules/observability/budget.tf` (the three `notification` blocks E02 kept byte-identical), `infra/.gitignore` (line 8 `backend_override.tf`), `infra/scripts/check-plan.py`; `docs/delivery/r16-issues/E01-terraform-adopt.md:39` (gap 13, the worker plan recipe) and `E03.verify.sh` step 4 (the worker-side noise filter this verify copies).
3. `src_C/Shared/RecallSmith.Lambda.Common/Log.cs` (33 lines); `src_C/Vpc/Warmup.cs:389-436`; `src_C/Shared/RecallSmith.Lambda.Common/Auth.cs:121-135`, `:220-235`; `src_C/Shared/RecallSmith.Lambda.Common/Res.cs:179-202` (read, do not edit).
4. `src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs` whole file (419 lines), especially `:35-68`, `:72-92`, `:190`, `:198-218`, `:281-325`, `:381-418`.
5. `src_C/Vpc/Analytics/OutboxPublisher.cs` whole file (243 lines).
6. `src_C/Vpc/VpcFunction.cs:1-105`; `src_C/Vpc/Webhooks/RevenuecatWebhook.cs:330-425`.
7. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/RouteMetricsTests.cs:1-45`, `:381-401`, `:525-556`, `:575-620`; `DbWarmupTests.cs:20-75`, `:130-150`; `IntegrationTestBase.cs` (the `PostgresCollection`/`PostgresFixture` names).
8. `docs/delivery/r16-issues/C05-topic-server.md` (format precedent) and `C07.verify.sh:151` (the suppression grep).

## Constraints

- **Scope (the ONLY files that may change):**
  1. `infra/modules/observability/alerts.tf` (new)
  2. `infra/modules/observability/alarms.tf` (new)
  3. `infra/modules/observability/dashboard.tf` (new)
  4. `infra/modules/observability/api_logs.tf` (new)
  5. `infra/modules/observability/variables.tf` (append only)
  6. `infra/modules/observability/outputs.tf` (append only)
  7. `infra/modules/api/gateway.tf` (the two stage resources only)
  8. `infra/modules/api/variables.tf` (append only)
  9. `infra/envs/prod/main.tf` (wiring lines only)
  10. `infra/envs/prod/variables.tf` (append `alert_email` if absent)
  11. `infra/envs/prod/outputs.tf` (append `alerts_topic_arn`)
  12. `infra/envs/prod/prod.auto.tfvars.example` (the `alert_email` line if absent)
  13. `infra/README.md` (one dated line appended to §6)
  14. `infra/modules/observability/budget.tf` (the three `subscriber_email_addresses` lines only)
  15. `src_C/Shared/RecallSmith.Lambda.Common/Log.cs`
  16. `src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs`
  17. `src_C/Vpc/Analytics/OutboxPublisher.cs`
  18. `src_C/Vpc/VpcFunction.cs` (regions `:51-62` and `:86-98` only)
  19. `src_C/Vpc/Webhooks/RevenuecatWebhook.cs` (region `:407-421` only)
  20. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/RouteMetricsTests.cs` (three lines: `:39`, `:389`, `:394`)
  21. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/LogShapeTests.cs` (new)
  22. `docs/delivery/r16-issues/E04.plan-allow.json` (new)
  Nothing else: no `imports.tf`, no `backend.tf`, no `providers.tf`, no `.terraform.lock.hcl`, no `infra/modules/{identity,data,edge,worker}/**`, no `retention.tf`, no `core_vpc.tf`/`edge_public.tf`, no `Res.cs`, `Auth.cs`, `Warmup.cs`, `Validation.cs`, no `Worker/**`, no `.csproj`, no `deploy.sh`, no `mobile/`, `frontend/`, `.github/`, `snowflake/`, no top-level `docs/*.md`.
- **WORKER SAFETY RULE (verbatim, E00 §0):** a worker may run read-only AWS CLI, `terraform init/validate/plan` (plan must be saved with -out and shown as JSON), but NEVER `terraform apply`, `terraform import` (state-changing), `aws ... create/update/delete/put`, `eas`, or any deploy script. The supervisor applies plans after each merge. Each infra brief's verify.sh therefore checks the PLAN (terraform show -json) against an explicit allow-list of resource addresses and actions — nothing else may appear as create/update/delete.
  For this issue that means: the plan runs only with the local `backend_override.tf` of E01 gap 13 (never `terraform init` against the S3 backend, never `-migrate-state`); never `aws sns subscribe/publish`, `aws cloudwatch put-*`, `aws logs create-log-group`, `aws apigatewayv2 update-stage`, `aws rds create-event-subscription`, `aws lambda invoke`; never `src_C/deploy.sh` without `DRY_RUN=1`. `aws iam get-role`, `aws budgets describe-*`, `aws cloudwatch list-metrics`, `aws sts get-caller-identity` are read-only and fine.
- **Frozen files (E00 §0) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`.
- **OTA / dependency rule:** nothing under `mobile/` changes; `mobile/package.json`, `package-lock.json`, `app.json` (`"version": "1.6.1"`), `eas.json` stay byte-identical; no `@sentry`. No `PackageReference` is added or changed in any `.csproj`; no Terraform provider/version change; `required_version`/`~> 6.0` stay as E01 wrote them.
- **Secrets (E00 §0 "Secrets"):** no email address, external id, password, secret or key in any `.tf`, `.json`, `.md`, test, verify output or PR text — `prod.auto.tfvars.example` carries `alerts@example.invalid` only. Never commit or paste `*.tfplan`, `*.plan.json`, `generated*.tf`, `*.auto.tfvars`. Never spell the two core-vpc env-var names E00 §0 calls "unspellable" (the verify prints no env keys either).
- **Existing tests:** `RouteMetricsTests.cs` changes exactly three lines (numstat `3 3`); `DbWarmupTests.cs` and every other existing test file are byte-identical. Full suite green (`cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests`, Docker). `LogShapeTests.cs` is the only new test file and is `[Collection(PostgresCollection.Name)]` (Console redirection is process-global, `RouteMetricsTests.cs:28-32`).
- **Banned literals in any added line** (driver gate, case-insensitive): the six terms of B00 §0 — not in code, comments, Terraform descriptions, alarm descriptions or the change-log line; say "sidestep", "guard", "fallback", "probe". No `[Fact(Skip = …)]`/`[Theory(Skip = …)]`, no `#pragma warning disable`, no `@ts-ignore`/`@ts-expect-error`/`eslint-disable`/`.skip(`/`.only(` anywhere in the diff.
- **Terraform hygiene:** `terraform fmt -check -recursive infra` clean; every new resource in `observability` is named by the address in Changes 13 (the allow-list is address-exact); `for_each`/`count` are not used for the alarms (twelve literal resources, so E12 can append a thirteenth without a map edit); no `lifecycle` on new resources; `treat_missing_data = "notBreaching"` on all twelve; the adopted stages keep every attribute E01 curated (§2.1.4: no `deployment_id`).
- **Standing rules:** no `git push`, no PR, never touch `main`, no deploy, no `expo`, no `npm`, no `dotnet restore` by hand, no network beyond the read-only AWS calls and the cached provider (`TF_PLUGIN_CACHE_DIR`). Do not run git inside `/Users/qc/src/recallsmith` (the shared checkout) — only inside your worktree.

## Changes required

### Infra

1. **`infra/modules/observability/variables.tf` (append)** — exactly these, after the E01/E02 variables:
   ```hcl
   variable "alert_email" {
     type      = string
     sensitive = true
   }
   variable "region" { type = string }
   variable "api_id" { type = string }
   variable "api_name" { type = string }
   variable "api_stage_name" {
     type    = string
     default = "$default"
   }
   variable "core_vpc_function_name" { type = string }
   variable "worker_function_name" { type = string }
   variable "publish_queue_name" { type = string }
   variable "publish_dlq_name" { type = string }
   variable "db_identifier" { type = string }
   variable "metrics_namespace" {
     type    = string
     default = "DeveloperCards"
   }
   ```
   If E02 already declared `alert_email` here (it wires the budget subscriber, E00 §2.2.6), do not redeclare it — the verify greps for presence, not for the diff. `terraform fmt` will re-align; keep the names.

2. **`infra/modules/observability/alerts.tf` (new)**
   ```hcl
   resource "aws_sns_topic" "alerts" {
     name = "developercards-alerts"
   }

   resource "aws_sns_topic_subscription" "alerts_email" {
     topic_arn = aws_sns_topic.alerts.arn
     protocol  = "email"
     endpoint  = var.alert_email
   }

   resource "aws_sns_topic_policy" "alerts" {
     arn = aws_sns_topic.alerts.arn
     policy = jsonencode({
       Version = "2012-10-17"
       Statement = [
         {
           Sid    = "AccountOwner"
           Effect = "Allow"
           Principal = { AWS = "arn:aws:iam::${var.account_id}:root" }
           Action   = ["SNS:Publish", "SNS:Subscribe", "SNS:GetTopicAttributes", "SNS:SetTopicAttributes", "SNS:ListSubscriptionsByTopic", "SNS:DeleteTopic", "SNS:RemovePermission", "SNS:AddPermission"]
           Resource = aws_sns_topic.alerts.arn
         },
         {
           Sid    = "AwsServicesPublish"
           Effect = "Allow"
           Principal = {
             Service = [
               "cloudwatch.amazonaws.com",
               "budgets.amazonaws.com",
               "lambda.amazonaws.com",
               "events.rds.amazonaws.com",
               "scheduler.amazonaws.com",
             ]
           }
           Action   = "SNS:Publish"
           Resource = aws_sns_topic.alerts.arn
           Condition = { StringEquals = { "aws:SourceAccount" = var.account_id } }
         },
       ]
     })
   }

   resource "aws_db_event_subscription" "developercards" {
     name             = "developercards-${var.env}-rds-events"
     sns_topic        = aws_sns_topic.alerts.arn
     source_type      = "db-instance"
     source_ids       = [var.db_identifier]
     event_categories = ["availability", "backup", "deletion", "failover", "failure", "low storage", "maintenance", "recovery"]
     depends_on       = [aws_sns_topic_policy.alerts]
   }
   ```
   The email confirmation click is an owner action (E00 §2.4.1); until it happens the subscription reads `pending confirmation` — that is expected and not a plan diff. `depends_on` is there because RDS validates topic access at create time.

3. **`infra/modules/observability/api_logs.tf` (new)**
   ```hcl
   resource "aws_cloudwatch_log_group" "api_access" {
     name              = "/aws/apigateway/${var.api_name}"
     retention_in_days = 30
   }
   ```

4. **`infra/modules/observability/alarms.tf` (new)** — twelve `aws_cloudwatch_metric_alarm` resources, addresses and names exactly as in this table (E00 §2.4.2); each has `alarm_actions = [aws_sns_topic.alerts.arn]`, `ok_actions = [aws_sns_topic.alerts.arn]`, `treat_missing_data = "notBreaching"`, `period = 300` unless the row says otherwise, `evaluation_periods = 1` and `datapoints_to_alarm = 1` unless the row says "N of M", and a one-sentence `alarm_description` (no brand words beyond `developercards`).

   | address (`aws_cloudwatch_metric_alarm.`) | `alarm_name` | metric / stat / dimensions | operator, threshold, periods |
   |---|---|---|---|
   | `api_5xx` | `developercards-${var.env}-api-5xx` | three `metric_query` blocks: `id = "e5xx"` (`AWS/ApiGateway`, `5xx`, `stat = "Sum"`), `id = "count"` (`Count`, `Sum`), both `dimensions = { ApiId = var.api_id, Stage = var.api_stage_name }`, `period = 300`; `id = "rate"`, `expression = "IF(count > 20, e5xx/count, 0)"`, `label = "5xx rate"`, `return_data = true` | `GreaterThanThreshold`, `threshold = 0.01`, `evaluation_periods = 3`, `datapoints_to_alarm = 2` |
   | `core_vpc_errors` | `developercards-${var.env}-core-vpc-errors` | `AWS/Lambda` `Errors` `Sum`, `FunctionName = var.core_vpc_function_name` | `GreaterThanOrEqualToThreshold`, `1` |
   | `worker_errors` | `developercards-${var.env}-worker-errors` | same, `var.worker_function_name` | `>= 1` |
   | `core_vpc_throttles` | `developercards-${var.env}-core-vpc-throttles` | `Throttles` `Sum`, core-vpc | `>= 1` |
   | `worker_throttles` | `developercards-${var.env}-worker-throttles` | `Throttles` `Sum`, worker | `>= 1` |
   | `core_vpc_duration_p95` | `developercards-${var.env}-core-vpc-duration-p95` | `Duration`, `extended_statistic = "p95"`, core-vpc | `GreaterThanThreshold`, `3000`, `evaluation_periods = 3`, `datapoints_to_alarm = 3` |
   | `sqs_oldest_age` | `developercards-${var.env}-sqs-oldest-age` | `AWS/SQS` `ApproximateAgeOfOldestMessage` `Maximum`, `QueueName = var.publish_queue_name` | `GreaterThanThreshold`, `900` |
   | `dlq_nonempty` | `developercards-${var.env}-dlq-nonempty` | `ApproximateNumberOfMessagesVisible` `Maximum`, `QueueName = var.publish_dlq_name`, `period = 60` | `>= 1` |
   | `rds_cpu` | `developercards-${var.env}-rds-cpu` | `AWS/RDS` `CPUUtilization` `Average`, `DBInstanceIdentifier = var.db_identifier` | `GreaterThanThreshold`, `80`, 3 of 3 |
   | `rds_free_storage` | `developercards-${var.env}-rds-free-storage` | `FreeStorageSpace` `Minimum` | `LessThanThreshold`, `2147483648` |
   | `rds_connections` | `developercards-${var.env}-rds-connections` | `DatabaseConnections` `Maximum` | `GreaterThanThreshold`, `60` |
   | `outbox_backlog` | `developercards-${var.env}-outbox-backlog` | `namespace = var.metrics_namespace`, `metric_name = "OutboxPending"`, `statistic = "Maximum"`, **no dimensions**, `period = 3600` | `GreaterThanOrEqualToThreshold`, `50000` |

   Plain-metric alarms use `namespace`/`metric_name`/`statistic` (or `extended_statistic`)/`dimensions` at the top level; only `api_5xx` uses `metric_query`. Spell the metric names exactly as CloudWatch does — `"5xx"`, `"Count"`, `"Errors"`, `"Throttles"`, `"Duration"`, `"ApproximateAgeOfOldestMessage"`, `"ApproximateNumberOfMessagesVisible"`, `"CPUUtilization"`, `"FreeStorageSpace"`, `"DatabaseConnections"`, `"OutboxPending"` — and the dimension maps as `ApiId = var.api_id`, `Stage = var.api_stage_name`, `FunctionName = var.core_vpc_function_name`, `FunctionName = var.worker_function_name`, `QueueName = var.publish_queue_name`, `QueueName = var.publish_dlq_name`, `DBInstanceIdentifier = var.db_identifier` (the verify greps these spellings, whitespace-insensitively). Lambda metrics dimensioned by `FunctionName` alone aggregate the `prod` alias and `$LATEST`, which is what the two functions' error counts should mean.

5. **`infra/modules/observability/dashboard.tf` (new)** — `resource "aws_cloudwatch_dashboard" "prod"` with `dashboard_name = "developercards-${var.env}"` and `dashboard_body = jsonencode({ widgets = local.dashboard_widgets })`. `local.dashboard_widgets` is a list of ten `type = "metric"` widgets in **this order**, laid out two per row (`width = 12`, `height = 6`, `x` ∈ {0, 12}, `y` = 6 × row), each with `properties = { region = var.region, view = "timeSeries", stacked = false, period = 300, title = "…", metrics = [...] }`:
   1. `API Count / 4xx / 5xx` — `["AWS/ApiGateway", "Count", "ApiId", var.api_id, "Stage", var.api_stage_name, { stat = "Sum" }]`, then `4xx`, then `5xx` (same dims, `Sum`).
   2. `API Latency p50 / p95` — `Latency` with `{ stat = "p50" }` and `{ stat = "p95" }`.
   3. `core-vpc Invocations / Errors / Throttles` — `["AWS/Lambda", "Invocations", "FunctionName", var.core_vpc_function_name, { stat = "Sum" }]`, `Errors`, `Throttles`.
   4. `core-vpc Duration p50 / p95 / max` — `Duration` with `p50`, `p95`, `Maximum`.
   5. `worker Invocations / Errors / Duration` — `Invocations` `Sum`, `Errors` `Sum`, `Duration` `p95` for `var.worker_function_name`.
   6. `SQS oldest age / DLQ visible` — `["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", var.publish_queue_name, { stat = "Maximum" }]`, `["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.publish_dlq_name, { stat = "Maximum" }]`.
   7. `RDS CPU / Connections` — `["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", var.db_identifier, { stat = "Average" }]`, `DatabaseConnections` `Maximum`.
   8. `RDS FreeStorageSpace / FreeableMemory` — `"FreeStorageSpace"` and `"FreeableMemory"`, both `Minimum`.
   9. `OutboxPending` — `[var.metrics_namespace, "OutboxPending", { stat = "Maximum" }]`, `period = 3600`.
   10. `Latency p95 by Route (top 10)` — one expression metric: `[{ expression = "SORT(SEARCH('{${var.metrics_namespace},Method,Route,Service} MetricName=\"Latency\"', 'p95', 300), MAX, DESC, 10)", label = "p95 by route", id = "top" }]`.
   The provider suppresses semantic-equal JSON reorderings, so a `jsonencode` body is stable across plans.

6. **`infra/modules/observability/outputs.tf` (append)**
   ```hcl
   output "alerts_topic_arn" { value = aws_sns_topic.alerts.arn }
   output "api_access_log_group_arn" { value = aws_cloudwatch_log_group.api_access.arn }
   output "api_access_log_group_name" { value = aws_cloudwatch_log_group.api_access.name }
   ```

7. **`infra/modules/api/variables.tf` (append)** — `variable "access_log_destination_arn" { type = string }` (no default: prod always logs). **`infra/modules/api/gateway.tf`** — inside BOTH `aws_apigatewayv2_stage.default` and `aws_apigatewayv2_stage.dev`, add (and nothing else in those resources changes):
   ```hcl
     access_log_settings {
       destination_arn = var.access_log_destination_arn
       format          = local.api_access_log_format
     }

     default_route_settings {
       detailed_metrics_enabled = true
     }
   ```
   and one `locals` block (top of `gateway.tf`, after any existing `locals`):
   ```hcl
   locals {
     # E00 §2.4.4, one line, key order kept: $context.* are API Gateway variables, not Terraform interpolation.
     api_access_log_format = chomp(<<-EOT
       {"requestId":"$context.requestId","ip":"$context.identity.sourceIp","requestTime":"$context.requestTime","method":"$context.httpMethod","routeKey":"$context.routeKey","path":"$context.path","status":"$context.status","protocol":"$context.protocol","responseLength":"$context.responseLength","integrationLatency":"$context.integrationLatency","responseLatency":"$context.responseLatency","integrationError":"$context.integrationErrorMessage","authorizerError":"$context.authorizer.error","userAgent":"$context.identity.userAgent"}
     EOT
     )
   }
   ```
   `detailed_metrics_enabled = true` appears exactly twice in the file. HTTP APIs need no CloudWatch role for access logging; the group ARN is enough.

8. **`infra/envs/prod/variables.tf`** — if absent (E02 may have added it), append verbatim:
   ```hcl
   variable "alert_email" {
     type      = string
     sensitive = true
   }
   ```
   **`prod.auto.tfvars.example`** — if absent, append `alert_email = "alerts@example.invalid"`. **`outputs.tf`** — append `output "alerts_topic_arn" { value = module.observability.alerts_topic_arn }`. The real `prod.auto.tfvars` is gitignored (E01) and never created by the worker.

   **`infra/modules/observability/budget.tf`** — in each of the three `notification` blocks replace the adopted literal list by `subscriber_email_addresses = [var.alert_email]` (three lines change, nothing else: thresholds 50/85/100, `notification_type`, `comparison_operator`, `threshold_type`, `limit_amount = var.budget_limit` stay as E02 left them). After this issue `grep -c '@' budget.tf` is 0. The plan shows the budget as a no-op because the worker's `TF_VAR_alert_email` is the adopted literal (Context) and the supervisor's tfvars carries the same address.

9. **`infra/envs/prod/main.tf`** — inside `module "observability"` add the arguments (use the root's existing locals/literals where E01 defined them — the values are what matters):
   ```hcl
     alert_email            = var.alert_email
     region                 = var.region
     api_id                 = module.api.api_id
     api_name               = "developercards-api"
     api_stage_name         = "$default"
     core_vpc_function_name = "core-vpc"
     worker_function_name   = "worker-lambda"
     publish_queue_name     = "recallsmith-publish-jobs"
     publish_dlq_name       = module.worker.publish_dlq_name
     db_identifier          = "developercards"
   ```
   and inside `module "api"`: `access_log_destination_arn = module.observability.api_access_log_group_arn`. The api ↔ observability references are at resource granularity (log group → stages; API id → alarms) and form no cycle; `terraform validate` proves it. No other line of `main.tf` changes.

10. **`infra/README.md` §6** — append one line: `- 2026-09-22 E04: SNS developercards-alerts (+email, policy), 12 alarms, RDS event subscription, API access log /aws/apigateway/developercards-api (30 d) + detailed metrics on both stages, dashboard developercards-prod; code: JSON Log lines, Log.Event, EMF namespace DeveloperCards, EmitGauge OutboxPending.`

### Code

11. **`src_C/Shared/RecallSmith.Lambda.Common/Log.cs`** — rewrite the class; public surface:
    ```csharp
    public static class Log
    {
      public static bool IsEnabled(string level);                 // "debug" only when LOG_LEVEL=debug; "info" when debug|info; "warn"/"error" always; anything else → treated as "info"
      public static void Debug(params object?[] args);
      public static void Info(params object?[] args);
      public static void Warn(params object?[] args);
      public static void Error(params object?[] args);
      public static void Event(string level, object fields);       // NEW
    }
    ```
    Rules (LogShapeTests pins each):
    - One line per call, one JSON object per line, written with a single `WriteLine` (`Console.Out` for debug/info, `Console.Error` for warn/error — the streams do not change). Built with `Utf8JsonWriter` so key order is deterministic: `ts` first, `level` second.
    - `ts` = `DateTime.UtcNow.ToString("o")` (ISO-8601, ends in `Z`); `level` = the lower-case level name.
    - `Debug/Info/Warn/Error(args)`: if `args.Length == 1 && args[0] is string s` and `s` (trimmed) starts with `{`, ends with `}` and `JsonDocument.Parse(s)` yields a `JsonValueKind.Object`, the object's properties are **embedded at the top level** after `ts`/`level` (properties named `ts` or `level` are skipped — the prefix wins). Otherwise the line is `{"ts":…,"level":…,"msg":"<args joined by one space, null → \"null\", same Join as today>"}`. The embedding is what keeps `Warmup.cs:409-410` / `Auth.cs:127,234` lines and `DbWarmupTests.cs:134-147` working unchanged.
    - `Event(level, fields)`: `JsonSerializer.SerializeToElement(fields)`; an object → its properties at top level after `ts`/`level` (skip `ts`/`level` names); a non-object → `"msg"` holding its JSON text. Gated by `IsEnabled(level)` exactly like the named methods; warn/error go to `Console.Error`.
    - `LOG_LEVEL` is still read once into a static field; never throws (wrap the writer in try/catch and fall back to a plain `Console.Error.WriteLine("{\"ts\":…,\"level\":\"error\",\"msg\":\"log serialisation failed\"}")`).
    - Non-ASCII stays as the default encoder escapes it (today's behaviour); newlines inside `ex.ToString()` are escaped by the writer, so a stack trace stays on one line.

12. **`src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs`**
    a. `:42` → `public const string DefaultNamespace = "DeveloperCards";` (the `<remarks>` above it stays; `NamespaceEnvVar`/`DisableEnvVar` unchanged).
    b. After `UnmatchedRoute`/`OtherMethod` (`:64-68`) add
       ```csharp
       /// <summary>Label prefix for E12's scheduler-driven internal events (synthetic path /internal/&lt;action&gt;).</summary>
       public const string InternalRoutePrefix = "internal:";

       /// <summary>The internal actions RouteFor labels; anything else under /internal/ is "unmatched" (same cost rule as the route table).</summary>
       public static readonly IReadOnlyList<string> InternalActions =
       [
         "outbox/publish",
         "content-intelligence/import",
         "publish/reap-orphans",
         "manifest/rebuild",
         "db/migrate",
         "health/deep",
       ];
       ```
       (the six handler-map keys E00 §2.11 calls exhaustive for the wave). They are NOT added to `StaticRoutes`, `TemplateRoutes` or `KnownRoutes` — line `:190` stays byte-identical: `public static IReadOnlyList<string> KnownRoutes { get; } = [.. StaticRoutes, .. TemplateRoutes];`.
    c. `RouteFor` (`:198-218`): after the empty check (`:201`) insert
       ```csharp
       if (p.StartsWith("/internal/", StringComparison.Ordinal))
       {
         var action = p["/internal/".Length..];
         foreach (var known in InternalActions)
         {
           if (string.Equals(action, known, StringComparison.Ordinal)) return InternalRoutePrefix + known;
         }
         return UnmatchedRoute;
       }
       ```
       `/api/internal/entitlements/apply` and `/api/internal/subscriptions/upsert` never start with `/internal/` (NormalizePath keeps their `/api/` prefix), so their labels are unchanged.
    d. New method, placed after `IsServerError` (`:379`):
       ```csharp
       /// <summary>
       /// One EMF line carrying a single dimensionless gauge (e.g. OutboxPending) in the same
       /// namespace as the route metrics. Same kill switch, same namespace override, same
       /// never-throws rule as Emit; unit null → "None".
       /// </summary>
       public static void EmitGauge(string name, double value, string? unit = "Count")
       ```
       Body: return if `IsDisabled(Environment.GetEnvironmentVariable(DisableEnvVar))` or `string.IsNullOrWhiteSpace(name)`; build via a new pure `public static string BuildGaugeLine(string metricNamespace, string name, double value, string unit, long timestampMs)` that serialises `{ _aws = { Timestamp, CloudWatchMetrics = [ { Namespace, Dimensions = [ [] ], Metrics = [ { Name = name, Unit = unit } ] } ] }, <name> = value }` (the metric name is a top-level property — use a `Dictionary<string, object?>` or `Utf8JsonWriter`; `Dimensions` is a one-element array holding an empty array, which is how EMF spells "no dimensions"); `Console.Out.WriteLine(line)` inside `try { } catch { }`.

13. **`src_C/Vpc/Analytics/OutboxPublisher.cs`**
    a. Add, before the class, `public sealed record OutboxPublishResult(int Claimed, int Published, int Retried, int PendingAfter);` (namespace `RecallSmith.Lambda.Vpc.Analytics`).
    b. New method (signature verbatim from E00 §2.4.7):
       ```csharp
       public static async Task<OutboxPublishResult> PublishBatchAsync(NpgsqlConnection conn, IAmazonS3 s3, string bucket, string prefix, int limit)
       ```
       = today's `:204-241` minus the `res.*` returns: `ClaimPending(conn, limit)`; if empty → `new(0, 0, 0, await CountPendingAsync(conn))`; else build `ids`/`key`/`body` exactly as `:210-213`, `await s3.PutObjectAsync(new PutObjectRequest { BucketName = bucket, Key = key, ContentBody = body, ContentType = "application/x-ndjson; charset=utf-8" })`, `MarkSent` → `new(rows.Count, rows.Count, 0, await CountPendingAsync(conn))`; on any exception from the put or `MarkSent`: `MarkRetry(conn, ids, ex.Message)`, `Log.Error("Analytics outbox publish failed:", ex)`, return `new(rows.Count, 0, rows.Count, await CountPendingAsync(conn))` — S3 failure is reported, not thrown (E12's loop decides); DB failures propagate as today.
    c. `private static async Task<int> CountPendingAsync(NpgsqlConnection conn)` — `select count(*) from analytics_event_outbox where status = 'pending'` (covered by `idx_analytics_outbox_pending`).
    d. `HandlePublishOutbox`: keep `:185-202` (auth, POST, bucket, limit, prefix, connection) byte-identical; replace `:204-241` with
       ```csharp
       var result = await PublishBatchAsync(conn, S3(), bucket, prefix, limit);
       RouteMetrics.EmitGauge("OutboxPending", result.PendingAfter);
       if (result.Retried > 0) return res.Error500(null);
       return res.Ok(new { ok = true, claimed = result.Claimed, published = result.Published, retried = result.Retried, pendingAfter = result.PendingAfter, bucket, prefix });
       ```
       The gauge is emitted on every outcome (a failing publisher must still report the backlog); `Error500(null)` keeps the client body (`INTERNAL_ERROR`) while the exception is already logged by `PublishBatchAsync`. `BuildJsonl`, `ClaimPending`, `MarkSent`, `MarkRetry`, `S3()`, `Reset()` are unchanged.

14. **`src_C/Vpc/VpcFunction.cs`** — `:51-62` becomes `Log.Event("info", new { tag = "boot", lambda = ServiceName, version = …, apiEnv = …, allowDevPremium = …, disallowSandbox = …, path = req.Path, method = req.Method });` (same eight properties, same order); `:86-98` becomes `Log.Event("info", new { traceId = req.TraceId, lambda = ServiceName, method = req.Method, path = req.Path, userSub = auth.UserSub, username = auth.Username, groups = auth.Groups, isAdmin = auth.IsAdmin, isSuperAdmin = auth.IsSuperAdmin });`. After this the file has no `JsonSerializer.Serialize(new` left; if `using System.Text.Json;` (`:1`) becomes unused, leave it (E12 needs `JsonElement`).

15. **`src_C/Vpc/Webhooks/RevenuecatWebhook.cs:407-421`** — `Console.WriteLine(JsonSerializer.Serialize(new { tag = "rc-webhook", … }));` becomes `Log.Event("info", new { tag = "rc-webhook", … });` with the same twelve properties in the same order. Nothing else in the file changes (E07 owns the rest).

16. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/RouteMetricsTests.cs`** — exactly three lines: `:39` `private const string Ns = "DeveloperCards";`, `:389` `… "DeveloperCards/Staging");`, `:394` `"DeveloperCards/Staging",`. Numstat `3 3`; no `"RecallSmith` literal remains in the file.

17. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/LogShapeTests.cs` (new)** — `[Collection(PostgresCollection.Name)]`, `public class LogShapeTests` (no fixture injection needed), usings as `RouteMetricsTests.cs:1-6`. Private `CaptureAsync` copied from `DbWarmupTests.cs:42-62` (redirect both streams, restore in `finally`), plus `static JsonElement[] Lines(string text)` = split on `\n`, drop blanks, `JsonDocument.Parse` each. Env-touching tests save/restore the variable in `try/finally` as `RouteMetricsTests.cs:386-400` does. Method names verbatim:
    1. `Info_PlainArgs_IsOneJsonObject_TsLevelMsg` — `Log.Info("hello", 42, null)` → exactly one stdout line; property order `ts`, `level`, `msg`; `level == "info"`, `msg == "hello 42 null"`; `DateTimeOffset.Parse(ts)` succeeds and `ts` ends with `"Z"`.
    2. `WarnAndError_WriteJsonToStderr` — `Log.Warn("w")`, `Log.Error("e:", new InvalidOperationException("boom"))` → two stderr lines, zero stdout lines; levels `warn`/`error`; the error `msg` contains `"boom"` and no raw newline (the captured text has exactly two `\n`).
    3. `Info_SingleJsonObjectArg_IsEmbeddedAtTopLevel` — `Log.Info(JsonSerializer.Serialize(new { step = "db-warmup", ok = true, ms = 12 }))` → one line whose raw text contains `"step":"db-warmup"` (the `DbWarmupTests` selector) and whose parsed object has `ts`, `level == "info"`, `step`, `ok`, `ms` and **no** `msg`.
    4. `Event_PrependsTsAndLevel_ThenFieldsInDeclaredOrder` — `Log.Event("info", new { tag = "boot", lambda = "core-vpc", path = "/health" })` → property names in order `ts, level, tag, lambda, path`.
    5. `Event_DropsFieldsNamedTsOrLevel` — `Log.Event("warn", new { level = "info", ts = "x", tag = "auth" })` → stderr line with exactly one `level` (`"warn"`), `ts != "x"`, `tag == "auth"`.
    6. `Debug_WritesOnlyWhenLogLevelIsDebug` — `Log.Debug("d")` and `Log.Event("debug", new { a = 1 })`; assert `lines.Length == (Log.IsEnabled("debug") ? 2 : 0)`.
    7. `EveryLineWritten_ParsesAsJsonWithTsAndLevel` — call all of `Debug/Info/Warn/Error` (mixed args incl. an exception and a pre-serialised object) and `Event` at each of the four levels; every non-blank line on both streams parses as an object with string `ts` and `level` ∈ {debug, info, warn, error}.
    8. `EmitGauge_IsOneEmfLine_NoDimensions_DefaultNamespace` — `RouteMetrics.EmitGauge("OutboxPending", 12)` → one stdout line; `_aws.CloudWatchMetrics[0].Namespace == "DeveloperCards"`, `Dimensions` is `[[]]` (one element, zero-length array), `Metrics[0].Name == "OutboxPending"`, `Metrics[0].Unit == "Count"`, top-level `OutboxPending == 12`, `_aws.Timestamp > 0`.
    9. `EmitGauge_HonoursNamespaceOverride_AndKillSwitch` — with `METRICS_NAMESPACE=DeveloperCards/Staging` the namespace follows; with `METRICS_DISABLED=1` nothing is written; `EmitGauge("", 1)` writes nothing.
    10. `RouteFor_InternalAction_IsLabelledInternalColonAction` — `[Theory]` with six `[InlineData]` pairs (`"/internal/outbox/publish"` → `"internal:outbox/publish"`, …, `"/internal/health/deep"` → `"internal:health/deep"`); also `RouteFor("/internal/outbox/publish/")` (trailing slash) → same label.
    11. `RouteFor_UnknownInternalAction_IsUnmatched_AndMintsNothing` — `RouteFor("/internal/whatever")` and 200 paths `$"/internal/x-{i:D4}"` all → `"unmatched"`; `RouteFor("/api/internal/entitlements/apply")` still → `"/api/internal/entitlements/apply"`.
    12. `KnownRoutes_ExcludeInternalActions` — no entry of `RouteMetrics.KnownRoutes` starts with `/internal/` or `internal:`; `RouteMetrics.InternalActions.Count == 6`.
    13. `DefaultNamespace_IsDeveloperCards` — `Assert.Equal("DeveloperCards", RouteMetrics.DefaultNamespace)`.

### Allow-list

18. **`docs/delivery/r16-issues/E04.plan-allow.json` (new)** — exactly this (key order free, content exact; the verify normalises and compares):
    ```json
    {
      "tags_only_updates": false,
      "outputs": ["alerts_topic_arn"],
      "changes": {
        "module.observability.aws_sns_topic.alerts": "create",
        "module.observability.aws_sns_topic_subscription.alerts_email": "create",
        "module.observability.aws_sns_topic_policy.alerts": "create",
        "module.observability.aws_db_event_subscription.developercards": "create",
        "module.observability.aws_cloudwatch_log_group.api_access": "create",
        "module.observability.aws_cloudwatch_dashboard.prod": "create",
        "module.observability.aws_cloudwatch_metric_alarm.api_5xx": "create",
        "module.observability.aws_cloudwatch_metric_alarm.core_vpc_errors": "create",
        "module.observability.aws_cloudwatch_metric_alarm.worker_errors": "create",
        "module.observability.aws_cloudwatch_metric_alarm.core_vpc_throttles": "create",
        "module.observability.aws_cloudwatch_metric_alarm.worker_throttles": "create",
        "module.observability.aws_cloudwatch_metric_alarm.core_vpc_duration_p95": "create",
        "module.observability.aws_cloudwatch_metric_alarm.sqs_oldest_age": "create",
        "module.observability.aws_cloudwatch_metric_alarm.dlq_nonempty": "create",
        "module.observability.aws_cloudwatch_metric_alarm.rds_cpu": "create",
        "module.observability.aws_cloudwatch_metric_alarm.rds_free_storage": "create",
        "module.observability.aws_cloudwatch_metric_alarm.rds_connections": "create",
        "module.observability.aws_cloudwatch_metric_alarm.outbox_backlog": "create",
        "module.api.aws_apigatewayv2_stage.default": { "action": "update", "keys": ["access_log_settings", "default_route_settings"] },
        "module.api.aws_apigatewayv2_stage.dev": { "action": "update", "keys": ["access_log_settings", "default_route_settings"] }
      }
    }
    ```
    18 creates + 2 updates = 20 effective changes; one new root output. Anything else in the plan (a budget update from a placeholder email, a tag drift, a stage key outside the two) fails the verify and must be understood, not allow-listed.

Estimated size: alerts.tf ~55 lines; alarms.tf ~230; dashboard.tf ~110; api_logs.tf 4; module variables/outputs ~40; gateway.tf +22; root wiring ~14; budget.tf 3; README 1; Log.cs ~110 (rewrite); RouteMetrics.cs +60; OutboxPublisher.cs ~+35/−30; VpcFunction.cs ±24; RevenuecatWebhook.cs ±15; RouteMetricsTests 3; LogShapeTests ~260; allow file 30.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/E04.verify.sh` re-runs exactly these.

1. Scope files exist (exit 0): the four new `infra/modules/observability/*.tf`, `LogShapeTests.cs`, `E04.plan-allow.json`; prerequisites on the integration branch: `infra/envs/prod/main.tf`, `infra/scripts/check-plan.py` (E01), `infra/modules/worker/queue.tf` naming `developercards-publish-jobs-dlq` and `output "publish_dlq_name"` (E03).
2. Literal guards (exit 0): every name, address, threshold, expression, signature, JSON key and test title of Changes 1–18 (the verify's `-F` list is the union of the tables above); `detailed_metrics_enabled = true` ×2 in `gateway.tf`; `treat_missing_data = "notBreaching"` ×12 and `alarm_name` ×12 in `alarms.tf`; `RouteMetricsTests.cs` numstat `3 3` and no `"RecallSmith` literal; `VpcFunction.cs` has `Log.Event("info", new` ×2 and no `JsonSerializer.Serialize(new`; `RevenuecatWebhook.cs` has no `Console.WriteLine(JsonSerializer.Serialize`; `E04.plan-allow.json` equals Changes 18 after normalisation; no suppression token in any scope file or `+` line; no secret-shaped literal in the `+` lines; no tracked `*.tfplan`/`*.plan.json`/`generated*.tf`/`*.auto.tfvars`; no `profile = "` in `infra`.
3. Gates (exit 0): `terraform fmt -check -recursive infra`; `cd infra/envs/prod && terraform init -backend=false -input=false && terraform validate`; `cd src_C && dotnet build Tests/RecallSmith.Lambda.IntegrationTests -c Debug --nologo`.
4. Plan + tests (exit 0): the verify writes `infra/envs/prod/backend_override.tf` (local state under its temp dir), `terraform init -input=false -reconfigure`, `terraform plan -input=false -var-file=<example minus the two sensitive lines> -out=<tmp>/e04.tfplan` with `TF_VAR_snowflake_external_id` (iam get-role) and `TF_VAR_alert_email` (merge-base `budget.tf` literal) exported → `Plan:` line present, `0 to destroy` → `terraform show -json` → the worker-side noise filter (drops E02/E03 creates, the provider-side RDS update, pre-existing root outputs; prints each dropped address) → `python3 infra/scripts/check-plan.py --plan <filtered> --allow docs/delivery/r16-issues/E04.plan-allow.json` prints `PLAN OK 20`; override, plan and state files removed. Then, Docker running, `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests -c Debug --no-build --nologo --filter "FullyQualifiedName~LogShapeTests|FullyQualifiedName~RouteMetricsTests|FullyQualifiedName~DbWarmupTests"` green (DbWarmupTests is the regression check for the embedding rule).
5. Scope + frozen + OTA + apply guard (exit 0): `git diff --name-only <merge-base>` ∪ pathspec-scoped untracked scan of `infra src_C docs mobile/src mobile/tests frontend/src .github` contains nothing outside the 22 scope files (+ `docs/delivery/r16-issues/`); the three frozen files, `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json`, every `.csproj`, `infra/envs/prod/{imports,backend,providers,versions}.tf`, `.terraform.lock.hcl`, `infra/modules/{identity,data,edge,worker}`, `Res.cs`, `Auth.cs`, `Warmup.cs`, `DbWarmupTests.cs` are zero-diff; no worker artefact under `infra src_C/scripts scripts` or the verify itself carries `terraform apply`/`terraform import`/`aws … create|update|delete|put-` outside comments, `echo`/`DRY_RUN` lines or the supervisor-only scripts E00 §5 names.

## Verify

```bash
AWS_PROFILE=dev BASE=delivery/r16-e-prod bash docs/delivery/r16-issues/E04.verify.sh
```
Steps 1–2 are file/literal checks (seconds); step 3 is `fmt`/`validate` (cached provider, no download) plus the test-project build (~1–2 min cold); step 4 plans against an empty local state through the gap-13 override (93 imports + refresh, ≈ 2–4 min, read-only), filters the worker-side noise, runs the checker, then starts one `postgres:16-alpine` container for the three test classes (single-digit minutes). Every `*.tfplan`/`*.plan.json`/`*.tfstate`/scratch var-file lives in a `mktemp -d` removed by `trap`, which also deletes the override file and `infra/envs/prod/.terraform/terraform.tfstate` so the driver's `init -backend=false` gate starts clean. The driver then runs the root gates in addition (`infra`: init `-backend=false` + validate + fmt; `src_C`: the full `dotnet test`, Docker) plus its diff-scoped banned-term grep and suppression scan.

**The supervisor applies** (never the worker), in this order after merge: `terraform init -reconfigure` (real backend, no override file present) → `plan -out=E04.tfplan` → `check-plan.py` → `apply E04.tfplan`; then the "supervisor post-apply" list: (1) owner clicks the SNS confirmation email (`aws sns list-subscriptions-by-topic` shows a real ARN, not `PendingConfirmation`); (2) `AWS_PROFILE=dev src_C/deploy.sh` ships both functions (namespace flip, gauge, JSON logs); (3) `aws cloudwatch list-metrics --namespace DeveloperCards` shows `Latency`/`Errors` after the first request, and `OutboxPending` after one `POST /api/v1/admin/analytics/outbox/publish` from the console; (4) `aws logs tail /aws/apigateway/developercards-api --since 5m` shows JSON access lines; (5) a second `terraform plan` is empty before E05 starts.

## Do NOT

- Do NOT `terraform apply`/`import` (command), `aws sns subscribe`, `aws cloudwatch put-metric-alarm`/`put-dashboard`, `aws apigatewayv2 update-stage`, `aws logs create-log-group`, `aws rds create-event-subscription`, `aws lambda invoke`, or `src_C/deploy.sh` without `DRY_RUN=1`; do NOT `terraform init` against the S3 backend (workers plan only through the gap-13 local override) or leave `backend_override.tf`/`.terraform/terraform.tfstate` behind; do NOT commit, paste or `cat` a plan file or `show -json` output (it contains the Lambda environments).
- Do NOT change `LoggingConfig`/`logging_config` on any function (E00 §6 #6), add `tags` by hand (provider `default_tags` covers new resources), or use `for_each` for the alarms.
- Do NOT add a fourteenth alarm (worker Duration, SQS visible backlog, `FreeableMemory`, EMF `Errors`, a `level=error` metric filter — E00 §6 #5), a Cost Anomaly Detection monitor, X-Ray tracing, or Chatbot.
- Do NOT put the access-log group in the `api` module, rename the stages, touch `throttling_*` (E08), `deployment_id`, or the `dev` stage's existence (post-wave).
- Do NOT add the `internal:` actions to `StaticRoutes`/`TemplateRoutes`/`KnownRoutes` (breaks `RouteTable_AndTheDispatchers_NameTheSameRoutes`), or derive the label from the free path (cost rule `:72-92`).
- Do NOT double-encode a JSON argument as `msg` (breaks `DbWarmupTests`), change which stream a level writes to, or make `Log`/`EmitGauge` able to throw.
- Do NOT touch `Res.cs` (E07), `Auth.cs`, `Warmup.cs`, `Worker/**`, `ManifestRebuild.cs`, any `.csproj`, `DbWarmupTests.cs`, or any `RouteMetricsTests.cs` line other than `:39`, `:389`, `:394`; do NOT add tests to `RouteMetricsTests.cs` — new tests go in `LogShapeTests.cs`.
- Do NOT run git inside `/Users/qc/src/recallsmith`; do NOT `npm`, `expo`, `eas`, `dotnet restore` by hand, or anything else that needs the network.
