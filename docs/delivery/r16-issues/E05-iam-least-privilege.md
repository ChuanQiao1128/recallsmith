# E05 — IAM least privilege (`iam-least-privilege`)

Give `worker-lambda` its own execution role (`developercards-worker-lambda-role`) instead of sharing `core-vpc-role-joizyiwt`, replace the four `*FullAccess` managed policies on the shared role with two scoped inline documents (`aws_iam_role_policy.core_vpc` / `.worker`: specific bucket prefixes, one queue, one log group each, ENI actions as the only `Resource: "*"`), detach `AmazonS3FullAccess` from the Snowflake role so only the prefix-scoped `snowflake-recallsmith-s3-read` remains, and prove the two documents with `aws iam simulate-custom-policy` at plan time (the supervisor repeats the matrix with `simulate-principal-policy` after apply). Root `infra`; Terraform only; the worker never applies. Base `delivery/r16-e-prod` (== `main@4b07f19`) + E01–E04 merged; every `file:line` below was read on that tree on 2026-09-22, every AWS fact re-read the same day with `AWS_PROFILE=dev` (describe/get/list only; no secret value printed).

## Context

What the account looks like today (`aws iam …`, `aws lambda …`, read-only, 2026-09-22):

- **One role, two functions, four `*FullAccess`.** `aws iam list-attached-role-policies --role-name core-vpc-role-joizyiwt` → 7 ARNs: `arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole`, `arn:aws:iam::aws:policy/AmazonEC2FullAccess`, `…/AmazonRDSFullAccess`, `…/AmazonSQSFullAccess`, `…/AmazonS3FullAccess`, `arn:aws:iam::622994489535:policy/service-role/AWSLambdaBasicExecutionRole-033fad1a-ba7b-4152-ba28-7cf61f0c3423` (`logs:CreateLogGroup` on `arn:aws:logs:ap-southeast-2:622994489535:*`, `CreateLogStream`/`PutLogEvents` on `log-group:/aws/lambda/core-vpc:*`) and `…/AWSLambdaVPCAccessExecutionRole-0916ae0e-b0bc-43bf-9827-cf383da694db` (`ec2:CreateNetworkInterface`, `ec2:DeleteNetworkInterface`, `ec2:DescribeNetworkInterfaces` on `*`). No inline policy. `aws lambda get-function-configuration --function-name worker-lambda --query Role` → the same role (review §2.1.2, `docs/backend-architecture-review-2026-09-22.md:89`; §1 table `:64`, `:67`).
- **A published Lambda version snapshots its role.** `aws lambda get-function-configuration --function-name worker-lambda:prod --query '[Version,Role]'` → `4`, `…/core-vpc-role-joizyiwt`. Changing `role` on the function only changes `$LATEST`; the alias `prod` (which E03's ESM targets) keeps version 4's role until a new version is published — the supervisor's first post-apply step (see Verify). `core-vpc` is unaffected by this: its permissions live on the role object, which keeps its name.
- **Snowflake role**: `aws iam list-attached-role-policies --role-name snowflake-recallsmith-s3-role` → `arn:aws:iam::aws:policy/AmazonS3FullAccess` + `arn:aws:iam::622994489535:policy/snowflake-recallsmith-s3-read` (customer-managed; Sid `ListAnalyticsPrefix` = `s3:ListBucket` on `arn:aws:s3:::core-vpc` with `s3:prefix` ∈ `analytics/raw/review_events`, `analytics/raw/review_events/*`; Sid `ReadAnalyticsObjects` = `s3:GetObject` on `arn:aws:s3:::core-vpc/analytics/raw/review_events/*`). The read policy is already prefix-scoped; the task's "Snowflake user policy scoped to the analytics prefix" is satisfied by detaching `AmazonS3FullAccess` and keeping `["read"]` untouched (E13 re-points it to the new analytics bucket, E00 §2.13 `:389` — not here).
- **edge-public**: `AWSLambdaBasicExecutionRole-4587d025-3600-45c8-9409-a1ead0afc685` + inline `edge-public-cognito` (5 `cognito-idp:*` actions on pool `ap-southeast-2_4Vf8uCXKt`) — already least-privilege; E05 does not touch it (E00 §2.5).
- **Managed-policy contents that shape the documents** (`aws iam get-policy-version`): `AWSLambdaVPCAccessExecutionRole` v3 = `ec2:CreateNetworkInterface`, `ec2:DescribeNetworkInterfaces`, `ec2:DescribeSubnets`, `ec2:DeleteNetworkInterface`, `ec2:AssignPrivateIpAddresses`, `ec2:UnassignPrivateIpAddresses` + 3 `logs:*` on `*`; `AWSLambdaSQSQueueExecutionRole` = `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes` + 3 `logs:*` on `*`.
- **Bucket policy** `core-vpc` (adopted as `module.edge.aws_s3_bucket_policy.content`): Sid `AllowCloudFrontOACReadOnly` + Sid `AllowCoreVpcLambdaWriteContent` (`s3:PutObject`, `s3:GetObject` on `arn:aws:s3:::core-vpc/content/*` for `…/core-vpc-role-joizyiwt`). A same-account identity policy is sufficient for the new worker role; the bucket policy is not edited (its file belongs to E01/E09, E00 §1.1 `:63`).
- **Live non-secret env** (`get-function-configuration --query 'Environment.Variables.<key>'`): core-vpc `CONTENT_BUCKET=core-vpc`, `PREMIUM_BUCKET=core-vpc-premium`, `CONTENT_PREFIX=content`, `PREMIUM_PREFIX=premium`, `PUBLISH_JOB_QUEUE_URL=https://sqs.ap-southeast-2.amazonaws.com/622994489535/recallsmith-publish-jobs`, no `ANALYTICS_S3_BUCKET` / `ANALYTICS_S3_PREFIX` / `CI_SNAPSHOT_BUCKET` (so analytics reads/writes hit the content bucket under `analytics/`); worker-lambda has 9 keys incl. `CONTENT_BUCKET`, `PREMIUM_BUCKET`, `CONTENT_PREFIX`, `PREMIUM_PREFIX`. Queue ARN `arn:aws:sqs:ap-southeast-2:622994489535:recallsmith-publish-jobs`; ESM `29e34447-aedd-45cf-8cab-c6ca9ad94f2f` targets the bare function ARN today (E03 moves it to `worker-lambda:prod`).

What the code actually calls (exhaustive: `grep -rn` over `src_C/Vpc src_C/Worker src_C/Shared` for the S3/SQS SDK; no `AmazonSimpleSystemsManagement`, `AmazonRDS`, `AmazonEC2`, `SecretsManager` client exists anywhere in those roots):

- core-vpc S3: `GetObject` on `content/manifest.json` (`src_C/Vpc/Runtime/PremiumDeckUrl.cs:237-244`, `src_C/Vpc/Runtime/AdminManifest.cs:22`, `:60`); `PutObject` on `content/manifest.json` (`src_C/Vpc/Authoring/ManifestRebuild.cs:36`, `:59-67`); presigned `GET` on `core-vpc-premium/premium/decks/<slug>/builds/<buildId>/deck.json` signed with the function's own credentials (`PremiumDeckUrl.cs:278-292`) — the role therefore needs `s3:GetObject` on the premium bucket; `PutObject` under `analytics/raw/review_events` (`src_C/Vpc/Analytics/OutboxPublisher.cs:37-38`, `:43-44`, `:217`); `GetObject` on `analytics/marts/content_intelligence/card_snapshot_30d/latest.json.gz` (`src_C/Vpc/Analytics/ContentIntelligenceSnapshotImport.cs:52`, `:238`). After E03 the worker also puts `content/manifest.json` and heads it (`ManifestBuilder`, E00 §2.3) — `s3:ListBucket` on the bucket is what turns a missing key into 404 instead of 403 for `HeadObject`, hence Sid `S3Head` on both roles.
- core-vpc SQS: `SendMessage` (`src_C/Vpc/Authoring/Publish.cs:19`, `:328-336`), `GetQueueAttributes` (`src_C/Vpc/Warmup.cs:232-239`) — one queue.
- worker S3: `PutObject`/`GetObject` with the bucket chosen by the key's first segment (`src_C/Worker/S3/S3DeckUploader.cs:45-58`: `premium` → `PREMIUM_BUCKET`, else `CONTENT_BUCKET`; `:94`, `:122`, `:135`) — keys are `content/decks/…` and `premium/decks/…`. worker SQS: only through the event source mapping (no SDK call in `src_C/Worker/WorkerFunction.cs`); `src_C/Worker/Manifest/ManifestService.cs:14`, `:49` sends to `MANIFEST_QUEUE_URL`, which is unset live and deleted by E03.

What E00 decided (binding; `docs/delivery/r16-issues/E00-contracts.md`): §2.5 (`:281-288`) is this issue's contract — Sids, actions, the six attachment deletes, the worker role update, the six new identity variables and two outputs; §3.2 (`:432-434`) the simulation matrix; §3.1 (`:419-430`) the allow-list format and `infra/scripts/check-plan.py`; §2.1.2 (`:176-183`, `:200`) the adopted addresses (`module.identity.aws_iam_role_policy_attachment.core_vpc["sqs_exec"|"ec2_full"|"rds_full"|"sqs_full"|"s3_full"|"logs"|"vpc"]`, `.snowflake["read"|"s3_full"]`, `module.worker.aws_lambda_function.worker`); §2.1.3 (`:207`) the name `developercards-worker-lambda-role`; §2.1.4 (`:211`) curation rules that must survive; §6 #8 (`:493`) — the Lambda roles get **no** SSM permission; §1.1 (`:55-56`, `:66`) the file owners; §4 (`:446-468`) E05 follows E04 (the worker role update follows E03's ESM alias switch).

Facts probed on 2026-09-22 (terraform 1.16.3, hashicorp/aws 6.66.0, `-backend=false`, read-only) that E00 did not state — binding for this issue and recorded here so the supervisor can fold them into E00:

1. **An `import {}` block whose target is no longer in configuration is a hard plan error** (`Error: Configuration for import target does not exist … All target instances must have an associated configuration to be imported.`). Removing the six attachment keys from the two `for_each` maps therefore REQUIRES deleting the six matching `import {}` blocks from `infra/envs/prod/imports.tf`. E00 §1.1 says `imports.tf` is "never edited after E01" and §6 #20 says it is never *deleted*; the intent (every later worker plans against an empty local state, §5) survives a deletions-only edit of exactly those six blocks. Nothing else in the file changes and `E01.imports.txt` stays byte-identical (it is E01's historical record).
2. **An empty local state cannot show a `delete`.** The worker's plan runs against an empty local state (E01 gap 13: a gitignored `infra/envs/prod/backend_override.tf` with a `backend "local"` under the verify's temp dir, `terraform init -input=false -reconfigure`, then `plan -out`; `init -backend=false` serves only `validate`). In that state the six detached attachments have no state and no config, so the worker's plan simply omits them; only the supervisor's plan against the remote state shows the 6 destroys. Likewise every resource *created* by E02–E04 (lifecycle rules, CloudTrail, DLQ, SNS, alarms, …) is neither imported nor in state and shows as `create`, the adopted RDS instance shows its provider-side update (`apply_immediately`, `skip_final_snapshot`, `final_snapshot_identifier`, E00 §2.1.4; `backup_retention_period` until E02's maintenance window), and every root output shows as a `create`. `E05.verify.sh` keeps the E03/E04 verify precedent — a worker-side noise filter that drops exactly (a) `create` entries whose address `E02/E03/E04.plan-allow.json` list as create, (b) that RDS update, (c) `create` output_changes for outputs present in the merge-base `outputs.tf`, plus (d) an imported resource whose `update` changes no attribute and only re-marks a value as sensitive (the Snowflake trust policy fed by `sensitive = true` `var.snowflake_external_id`, the budget subscriber fed by `var.alert_email`: the live value is imported plain, the config marks it sensitive, Terraform plans an in-place update with "The value is unchanged" — probed 2026-09-22; the supervisor's remote state already carries the marking, so it never appears there) — and adds (e): when the plan carries any `importing` entry, `check-plan.py` runs with `E05.plan-allow.json` minus its six `delete` entries and the verify asserts those six addresses are absent from the plan altogether (steps 2c/2e prove their config and import blocks are gone). Without `importing` (the supervisor's remote-state plan) the committed file applies verbatim and the six deletes must be present. One committed allow file serves both, as §3.1 intends.
3. **`Eni` carries the six EC2 actions of the current AWS-managed `AWSLambdaVPCAccessExecutionRole` (v3)**, not the three of E00 §2.5: the three-action customer policy on the shared role has never run alone (AmazonEC2FullAccess masked it), Lambda validates ENI permissions on the new role at `UpdateFunctionConfiguration`, and `AssignPrivateIpAddresses`/`UnassignPrivateIpAddresses`/`DescribeSubnets` are what the service documents for Hyperplane ENIs. Still one Sid, still the only `Resource: "*"`, no new service.
4. **The policy simulator needs one `--resource-arns` per call** (several ARNs collapse into one templated row with a wrong decision), takes the document text in `--policy-input-list` (not a `file://` reference), and models CloudWatch Logs ARNs only in the `…:log-group:/aws/lambda/<fn>:*` form (a `:log-stream:` ARN returns `implicitDeny` even against the live role). The matrix below is written in that form; all 43 rows were run against the exact documents of Changes 2 on 2026-09-22 and returned the expected decision.
5. **Worker-role propagation.** The function's `role` update depends on `aws_iam_role.worker` but not on `aws_iam_role_policy.worker`; Lambda rejects a role without ENI permissions. The identity output `worker_role_arn` therefore carries `depends_on = [aws_iam_role_policy.worker]` so the function update is ordered after the policy. IAM eventual consistency can still surface as "The role defined for the function cannot be assumed by Lambda" — the provider retries; if the apply still fails, the supervisor re-plans and re-applies (idempotent).

## Read first

1. `docs/delivery/r16-issues/E00-contracts.md` §0 (`:9-36`; the WORKER SAFETY RULE `:11`, no renames `:27`, secrets `:30`, supervisor procedure `:32`, root gates `:33`, banned terms `:34`, plan-first `:35`), §1.1 (`:43-69`), §2.1.1 (`:116-167`), §2.1.2 (`:170-203`), §2.1.3 (`:205-207`), §2.1.4 (`:209-211`), §2.5 (`:281-288`), §2.13 (`:389`, the E13 follow-up you must NOT pre-empt), §3.1 (`:419-430`), §3.2 (`:432-434`), §4 (`:446-468`), §5 (`:470-482`), §6 #8, #12, #20, #21 (`:493`, `:497`, `:505-506`).
2. `docs/backend-architecture-review-2026-09-22.md` §1 table rows IAM / Lambda (`:60-76`), §2.1.2 (`:89`), §3 row "IAM 拆角色" (`:189`).
3. On the integration branch (E01–E04 merged): `infra/README.md` (§2 safety rule, §5 supervisor procedure, §6 change log), `infra/RUNBOOK.md` §2 (the worker plan recipe with `backend_override.tf`), `infra/envs/prod/main.tf` (the `module "identity"` and `module "worker"` blocks), `infra/envs/prod/imports.tf` (the six blocks you delete), `infra/modules/identity/{main,variables,outputs}.tf` (the adopted roles, `local.core_vpc_attachments` and the snowflake attachment map, the interface you extend), `infra/modules/worker/{variables,function}.tf` (`var.role_arn` → `role`), `infra/scripts/check-plan.py`, `docs/delivery/r16-issues/E0{2,3,4}.plan-allow.json`; `docs/delivery/r16-issues/E01-terraform-adopt.md` gaps 2, 3, 6, 13 and change 3.1 (how E01 laid out `identity/main.tf` and the root variables) and `E04.verify.sh` step 4 (the noise filter this verify extends).
4. Code that fixes the resource list: `src_C/Vpc/Runtime/PremiumDeckUrl.cs:175-192`, `:237-244`, `:278-292`; `src_C/Vpc/Authoring/ManifestRebuild.cs:24-36`, `:56-67`; `src_C/Vpc/Analytics/OutboxPublisher.cs:33-45`, `:196`, `:217`; `src_C/Vpc/Analytics/ContentIntelligenceSnapshotImport.cs:41-53`, `:238`; `src_C/Vpc/Authoring/Publish.cs:19`, `:328-336`; `src_C/Vpc/Warmup.cs:225-239`; `src_C/Worker/S3/S3DeckUploader.cs:22-23`, `:45-58`, `:94`, `:122`, `:135`.
5. Format precedent: `docs/delivery/r16-issues/C05-topic-server.md`, `C05.verify.sh:1-24`.

## Constraints

- **Scope (the ONLY files that may change):**
  1. `infra/modules/identity/policies.tf` (new)
  2. `infra/modules/identity/variables.tf` (append only: the six variables of Changes 3)
  3. `infra/modules/identity/outputs.tf` (append only: the two outputs of Changes 3)
  4. `infra/modules/identity/main.tf` (ONLY the removal of five keys from the `core_vpc` attachment map and one key from the `snowflake` attachment map — no added `resource` block; if E01 expressed those maps as a variable default or a `locals` entry, edit that place instead and leave `main.tf` untouched)
  5. `infra/envs/prod/main.tf` (wiring only: six new arguments on `module "identity"`, `role_arn` on `module "worker"`)
  6. `infra/envs/prod/imports.tf` (deletions only: exactly the six `import {}` blocks of Changes 5)
  7. `infra/modules/worker/function.tf` (expected zero diff; may change only if E01 did not route the role through `var.role_arn`)
  8. `infra/README.md` (one dated line appended to §6)
  9. `docs/delivery/r16-issues/E05.plan-allow.json` (new, byte content of Changes 7)
  Nothing else: no `src_C/`, `mobile/`, `frontend/`, `snowflake/`, `scripts/`, `.github/`, no `infra/envs/prod/{versions,providers,backend,variables,outputs}.tf`, no `infra/envs/prod/.terraform.lock.hcl`, no `infra/modules/{data,edge,api,observability}/**`, no `infra/modules/identity/cognito.tf`, no `infra/scripts/**`, no `docs/delivery/r16-issues/E01.imports.txt`, no other `E0*.plan-allow.json`, no top-level `docs/*.md`, and never a tracked `infra/envs/prod/backend_override.tf` (gitignored; the verify creates and deletes its own).
- **WORKER SAFETY RULE (E00 §0, verbatim):** a worker may run read-only AWS CLI, `terraform init/validate/plan` (plan must be saved with -out and shown as JSON), but NEVER `terraform apply`, `terraform import` (state-changing), `aws ... create/update/delete/put`, `eas`, or any deploy script. The supervisor applies plans after each merge. Each infra brief's verify.sh therefore checks the PLAN (terraform show -json) against an explicit allow-list of resource addresses and actions — nothing else may appear as create/update/delete.
  For this issue that means: `aws iam simulate-custom-policy`, `aws iam get-role`, `aws iam get-policy-version`, `aws lambda get-function-configuration`, `aws sts get-caller-identity` are allowed; `aws lambda publish-version`, `aws lambda update-alias`, `aws iam attach/detach-role-policy`, `src_C/deploy.sh` without `DRY_RUN=1` are supervisor-only. `terraform init -backend=false -input=false` serves `validate`; the plan uses the gitignored `infra/envs/prod/backend_override.tf` local backend of E01 gap 13 (`terraform init -input=false -reconfigure`, S3 never contacted) and you delete the override afterwards — never `init` against the real S3 backend. Never print, paste or commit plan JSON beyond address/actions/changed-keys (the Lambda `environment` block is in it, E00 §0 "Secrets"); `*.tfplan` / `*.plan.json` / the temp var-file / the override are removed by the verify's `trap`.
- **Frozen files (E00 §0) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`.
- **OTA rule:** nothing under `mobile/` changes; `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json` (`"version": "1.6.1"`) and `mobile/eas.json` stay byte-identical; no `@sentry` anywhere.
- **No renames (E00 §0):** `core-vpc-role-joizyiwt`, `edge-public-role-zezx326f`, `snowflake-recallsmith-s3-role`, `snowflake-recallsmith-s3-read`, `worker-lambda`, `core-vpc`, `recallsmith-publish-jobs` keep their names; `path = "/service-role/"` stays on the two adopted execution roles. The new role is `developercards-worker-lambda-role` at the default path `/`.
- **Terraform hygiene (E00 §0, §2.1.4):** no `provisioner`, `local-exec`, `null_resource`, `external` data source, `archive_file`, `terraform_remote_state`; no `profile = "…"` in any provider; no `inline_policy` / `managed_policy_arns` arguments on any `aws_iam_role` (the deprecated in-role forms would fight the standalone resources); no `data "aws_iam_policy_document"` in `policies.tf` (documents are `jsonencode` over `var.*`/`local.*` strings only, so `change.after.policy` is fully known in the plan); `.terraform.lock.hcl` is never regenerated or upgraded; `terraform fmt` clean.
- **Secrets:** no value of any SSM/env secret, no Snowflake `sts:ExternalId` value (it stays `var.snowflake_external_id`), no plan JSON, in any file, commit message or output.
- **Banned literals in any added line** (driver gate, case-insensitive): the six terms of B00 §0 — do not reproduce them, not even in a comment; the two core-vpc env-var names E00 §0 calls unspellable are never written. No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(`, `Skip =`, `#pragma warning disable` anywhere in the diff.
- **Tests:** this issue has no test files. Nothing under `src_C/Tests`, `mobile/tests`, `frontend/tests` may change; `docs/delivery/r16-issues/E01.imports.txt` and every other issue's `*.plan-allow.json` are byte-identical.
- **Toolchain:** `terraform` 1.16.3 (`required_version = ">= 1.10"` unchanged), provider `hashicorp/aws` 6.66.0 from `TF_PLUGIN_CACHE_DIR="$HOME/.terraform.d/plugin-cache"` (no upgrade); `python3` stdlib; `aws` CLI v2 with `AWS_PROFILE=dev`. The plan takes 2–4 minutes (87 imports); run it once, keep the JSON in a temp dir, delete it.
- Standing rules: no `git push`, no PR, never touch `main`, no deploy, no `eas`, no `npm`, no `dotnet`, no git inside `/Users/qc/src/recallsmith` (only your worktree).

## Changes required

1. **`infra/envs/prod/imports.tf` — delete six `import {}` blocks, nothing else.** Remove the blocks whose `to` is:
   - `module.identity.aws_iam_role_policy_attachment.core_vpc["ec2_full"]`
   - `module.identity.aws_iam_role_policy_attachment.core_vpc["rds_full"]`
   - `module.identity.aws_iam_role_policy_attachment.core_vpc["sqs_full"]`
   - `module.identity.aws_iam_role_policy_attachment.core_vpc["s3_full"]`
   - `module.identity.aws_iam_role_policy_attachment.core_vpc["sqs_exec"]`
   - `module.identity.aws_iam_role_policy_attachment.snowflake["s3_full"]`
   `git diff --numstat` for the file must show `0` added lines; the set of remaining `to =` addresses equals the base set minus exactly these six (87 remain). Keep `core_vpc["logs"]`, `core_vpc["vpc"]`, `snowflake["read"]` and every other block verbatim.

2. **`infra/modules/identity/policies.tf` (new).** Content (run `terraform fmt` afterwards; the verify greps names, not bytes):

   ```hcl
   # E05 — per-function execution roles with scoped inline policies (E00 §2.5, §3.2).
   # Every document is built from var.* strings only (never from a resource or data
   # attribute) so `change.after.policy` is fully known in the plan JSON and can be
   # fed to `aws iam simulate-custom-policy` before anything is applied.

   locals {
     content_bucket_arn = "arn:aws:s3:::${var.content_bucket_name}"
     premium_bucket_arn = "arn:aws:s3:::${var.premium_bucket_name}"
     publish_queue_arn  = "arn:aws:sqs:${var.region}:${var.account_id}:${var.publish_queue_name}"
     core_vpc_log_arn   = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${var.core_vpc_function_name}:*"
     worker_log_arn     = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${var.worker_function_name}:*"
     # The six EC2 actions of the AWS-managed AWSLambdaVPCAccessExecutionRole (v3) — the only Resource "*".
     eni_actions = [
       "ec2:CreateNetworkInterface",
       "ec2:DescribeNetworkInterfaces",
       "ec2:DescribeSubnets",
       "ec2:DeleteNetworkInterface",
       "ec2:AssignPrivateIpAddresses",
       "ec2:UnassignPrivateIpAddresses",
     ]
   }

   resource "aws_iam_role" "worker" {
     name = var.worker_role_name
     assume_role_policy = jsonencode({
       Version = "2012-10-17"
       Statement = [{
         Sid       = "LambdaAssume"
         Effect    = "Allow"
         Principal = { Service = "lambda.amazonaws.com" }
         Action    = "sts:AssumeRole"
       }]
     })
   }

   resource "aws_iam_role_policy" "core_vpc" {
     name = "developercards-core-vpc-scoped"
     role = aws_iam_role.core_vpc.id
     policy = jsonencode({
       Version = "2012-10-17"
       Statement = [
         {
           Sid      = "S3Content"
           Effect   = "Allow"
           Action   = ["s3:GetObject", "s3:PutObject"]
           Resource = ["${local.content_bucket_arn}/content/*", "${local.content_bucket_arn}/analytics/*"]
         },
         {
           Sid      = "S3Premium"
           Effect   = "Allow"
           Action   = ["s3:GetObject"]
           Resource = ["${local.premium_bucket_arn}/*"]
         },
         {
           Sid      = "S3Head"
           Effect   = "Allow"
           Action   = ["s3:ListBucket"]
           Resource = [local.content_bucket_arn, local.premium_bucket_arn]
         },
         {
           Sid      = "SqsSend"
           Effect   = "Allow"
           Action   = ["sqs:SendMessage", "sqs:GetQueueAttributes"]
           Resource = [local.publish_queue_arn]
         },
         {
           Sid      = "Logs"
           Effect   = "Allow"
           Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
           Resource = [local.core_vpc_log_arn]
         },
         {
           Sid      = "Eni"
           Effect   = "Allow"
           Action   = local.eni_actions
           Resource = "*"
         },
       ]
     })
   }

   resource "aws_iam_role_policy" "worker" {
     name = "developercards-worker-lambda-scoped"
     role = aws_iam_role.worker.id
     policy = jsonencode({
       Version = "2012-10-17"
       Statement = [
         {
           Sid      = "S3Builds"
           Effect   = "Allow"
           Action   = ["s3:GetObject", "s3:PutObject"]
           Resource = ["${local.content_bucket_arn}/content/*", "${local.premium_bucket_arn}/*"]
         },
         {
           Sid      = "S3Head"
           Effect   = "Allow"
           Action   = ["s3:ListBucket"]
           Resource = [local.content_bucket_arn, local.premium_bucket_arn]
         },
         {
           Sid      = "SqsConsume"
           Effect   = "Allow"
           Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]
           Resource = [local.publish_queue_arn]
         },
         {
           Sid      = "Logs"
           Effect   = "Allow"
           Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
           Resource = [local.worker_log_arn]
         },
         {
           Sid      = "Eni"
           Effect   = "Allow"
           Action   = local.eni_actions
           Resource = "*"
         },
       ]
     })
   }
   ```
   Rules the verify enforces on the planned documents: Sid sets exactly `{S3Content, S3Premium, S3Head, SqsSend, Logs, Eni}` and `{S3Builds, S3Head, SqsConsume, Logs, Eni}`; the union of actions is exactly the lists above (no `*`, no `<service>:*`, no `ssm:*`, `rds:*`, `iam:*`, `s3:DeleteObject`, `sqs:SendMessage` on the worker, `sqs:ReceiveMessage` on core-vpc); `Resource: "*"` only on `Eni`; every other Resource is one of `arn:aws:s3:::core-vpc/content/*`, `arn:aws:s3:::core-vpc/analytics/*`, `arn:aws:s3:::core-vpc-premium/*`, `arn:aws:s3:::core-vpc`, `arn:aws:s3:::core-vpc-premium`, `arn:aws:sqs:ap-southeast-2:622994489535:recallsmith-publish-jobs`, `arn:aws:logs:ap-southeast-2:622994489535:log-group:/aws/lambda/core-vpc:*`, `arn:aws:logs:ap-southeast-2:622994489535:log-group:/aws/lambda/worker-lambda:*`. No SSM statement (E00 §6 #8). `aws_iam_role.core_vpc` is E01's adopted resource — reference it, do not redeclare it.

3. **`infra/modules/identity/variables.tf` / `outputs.tf` (append only).**
   ```hcl
   variable "worker_role_name"       { type = string } # prod "developercards-worker-lambda-role"
   variable "content_bucket_name"    { type = string } # prod "core-vpc"
   variable "premium_bucket_name"    { type = string } # prod "core-vpc-premium"
   variable "publish_queue_name"     { type = string } # prod "recallsmith-publish-jobs"
   variable "core_vpc_function_name" { type = string } # prod "core-vpc"
   variable "worker_function_name"   { type = string } # prod "worker-lambda"
   ```
   No defaults (the root wires them, staging E10 wires its own). Outputs:
   ```hcl
   output "worker_role_arn" {
     value      = aws_iam_role.worker.arn
     depends_on = [aws_iam_role_policy.worker] # the function update must follow the policy (Context #5)
   }
   output "worker_role_name" {
     value = aws_iam_role.worker.name
   }
   ```
   `var.region` and `var.account_id` already exist on the module (E00 §2.1.1); do not redeclare them.

4. **`infra/modules/identity/main.tf` — drop the six attachment keys.** E01 (change 3.1) declared `aws_iam_role_policy_attachment.core_vpc` with `for_each = local.core_vpc_attachments` (seven keys) and the snowflake attachment with a two-key map; remove `sqs_exec`, `ec2_full`, `rds_full`, `sqs_full`, `s3_full` from the first map so it keeps only `logs` and `vpc`, and `s3_full` from the second so it keeps only `read`. After this, `grep -rn -E 'AmazonEC2FullAccess|AmazonRDSFullAccess|AmazonSQSFullAccess|AmazonS3FullAccess|AWSLambdaSQSQueueExecutionRole' infra --include='*.tf'` returns nothing. The `+` lines of this file's diff contain no `resource "` (new resources live in `policies.tf`). `aws_iam_policy.core_vpc_logs`, `.core_vpc_vpc`, the two remaining attachments and every Cognito resource are untouched (E00 §2.5: the redundant `logs`/`vpc` attachments stay for the wave).

5. **`infra/envs/prod/main.tf` — wiring.** In `module "identity"` add the six arguments with the same expressions the root already passes for the same names to `module "data"` (`content_bucket_name`, `premium_bucket_name`), `module "worker"` (`queue_name` → `publish_queue_name`, `function_name` → `worker_function_name`) and `module "api"` (`core_vpc_function_name`) — E01 change 2.4 made those literals (`"core-vpc"`, `"core-vpc-premium"`, `"recallsmith-publish-jobs"`, `"worker-lambda"`, `"core-vpc"`), so repeat the literal; if E01 ended up with a `local`/`var`, use that — plus `worker_role_name = "developercards-worker-lambda-role"` (a literal: the root `variables.tf` is not yours to edit). In `module "worker"` change `role_arn` from `module.identity.core_vpc_role_arn` to `module.identity.worker_role_arn`; the `module "worker"` block must no longer mention `core_vpc_role_arn`. `module "api"` and `module "edge"` keep `module.identity.core_vpc_role_arn`. No other line of the file changes.

6. **`infra/modules/worker/function.tf`** — no change expected: `aws_lambda_function.worker.role = var.role_arn` (E00 §2.1.1). Touch it only if E01 hard-wired something else, and then only that line.

7. **`docs/delivery/r16-issues/E05.plan-allow.json` (new)** — exactly this object (whitespace free; the verify compares parsed JSON):
   ```json
   {
     "tags_only_updates": false,
     "changes": {
       "module.identity.aws_iam_role.worker": "create",
       "module.identity.aws_iam_role_policy.core_vpc": "create",
       "module.identity.aws_iam_role_policy.worker": "create",
       "module.identity.aws_iam_role_policy_attachment.core_vpc[\"ec2_full\"]": "delete",
       "module.identity.aws_iam_role_policy_attachment.core_vpc[\"rds_full\"]": "delete",
       "module.identity.aws_iam_role_policy_attachment.core_vpc[\"s3_full\"]": "delete",
       "module.identity.aws_iam_role_policy_attachment.core_vpc[\"sqs_exec\"]": "delete",
       "module.identity.aws_iam_role_policy_attachment.core_vpc[\"sqs_full\"]": "delete",
       "module.identity.aws_iam_role_policy_attachment.snowflake[\"s3_full\"]": "delete",
       "module.worker.aws_lambda_function.worker": { "action": "update", "keys": ["role"] }
     }
   }
   ```
   Ten effective changes in the supervisor's plan (3 create, 6 delete, 1 update); four in the worker's empty-state plan (3 create, 1 update — Context #2). E00 §2.5 says "3 creates (inline policies)"; the section itself defines two documents (`core_vpc`, `worker`) and leaves `edge_public` untouched, so the address list above is the contract and the tally in that sentence is a count slip.

8. **`infra/README.md` §6** — append one line: `- 2026-09-22 E05: worker-lambda moved to developercards-worker-lambda-role; core-vpc-role-joizyiwt lost AmazonEC2FullAccess/AmazonRDSFullAccess/AmazonSQSFullAccess/AmazonS3FullAccess/AWSLambdaSQSQueueExecutionRole; snowflake-recallsmith-s3-role lost AmazonS3FullAccess; six import blocks dropped from envs/prod/imports.tf (87 remain). Supervisor: publish-version + update-alias prod on worker-lambda right after apply.` (the date is the day you merge; the verify checks only that a `§6` line names `E05`).

9. **Self-check before you finish** (the verify repeats it; all read-only): `terraform fmt -recursive infra`; `cd infra/envs/prod && terraform init -backend=false -input=false && terraform validate`; then the `infra/RUNBOOK.md` §2 recipe — write the gitignored `backend_override.tf` (local backend under `$TMP`), `terraform init -input=false -reconfigure`, `terraform plan -input=false -var-file=<example minus the two sensitive lines> -out="$TMP/e05.tfplan"` with `TF_VAR_snowflake_external_id` from `aws iam get-role` and `TF_VAR_alert_email` from `aws budgets describe-subscribers-for-notification` (both read-only, never echoed); `terraform show -json "$TMP/e05.tfplan" > "$TMP/e05.plan.json"`; apply the noise filter of Context #2 and `python3 infra/scripts/check-plan.py --plan <filtered> --allow <E05.plan-allow.json minus deletes>`; the 43-row `simulate-custom-policy` matrix; `rm -f "$TMP"/*.tfplan "$TMP"/*.plan.json infra/envs/prod/backend_override.tf`. Then `BASE=delivery/r16-e-prod bash docs/delivery/r16-issues/E05.verify.sh`.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/E05.verify.sh` re-runs exactly these.

1. Scope files exist (exit 0): `infra/modules/identity/policies.tf` and `docs/delivery/r16-issues/E05.plan-allow.json` exist (base fails here); prerequisites from E01–E04 exist: `infra/scripts/check-plan.py`, `infra/envs/prod/{main,imports}.tf`, `infra/envs/prod/.terraform.lock.hcl`, `infra/modules/identity/{main,variables,outputs}.tf`, `infra/modules/worker/function.tf`, `infra/README.md`, `infra/modules/observability/alarms.tf`, `docs/delivery/r16-issues/E0{2,3,4}.plan-allow.json`.
2. Literal guards (exit 0):
   - `policies.tf`: `resource "aws_iam_role" "worker"`, `name = var.worker_role_name`, `"sts:AssumeRole"`, `"lambda.amazonaws.com"`, `resource "aws_iam_role_policy" "core_vpc"`, `resource "aws_iam_role_policy" "worker"`, `role = aws_iam_role.core_vpc.id`, `role = aws_iam_role.worker.id`, `"developercards-core-vpc-scoped"`, `"developercards-worker-lambda-scoped"`, the Sids `S3Content`, `S3Premium`, `S3Head`, `SqsSend`, `S3Builds`, `SqsConsume`, `Logs`, `Eni`, the six `ec2:*` action strings, `"sqs:ChangeMessageVisibility"`, `jsonencode(`; no `aws_iam_policy_document`, no `ssm:`, no `"*:*"`, no `Action` equal to `"*"`, no `inline_policy`, no `managed_policy_arns`, no `sts:ExternalId`.
   - `variables.tf`: the six `variable "…"` names; `outputs.tf`: `output "worker_role_arn"` with `depends_on = [aws_iam_role_policy.worker]`, `output "worker_role_name"`.
   - No `.tf` under `infra/` contains `AmazonEC2FullAccess`, `AmazonRDSFullAccess`, `AmazonSQSFullAccess`, `AmazonS3FullAccess` or `AWSLambdaSQSQueueExecutionRole`.
   - `infra/envs/prod/main.tf`: the `module "identity"` block carries the six argument names and `worker_role_name = "developercards-worker-lambda-role"`; the `module "worker"` block carries `role_arn = module.identity.worker_role_arn` and not `core_vpc_role_arn`.
   - `infra/envs/prod/imports.tf`: `git diff --numstat` added lines = 0; removed `to =` set == exactly the six addresses of Changes 1.
   - `infra/modules/identity/main.tf`: no `+` line contains `resource "`.
   - `E05.plan-allow.json`: parsed JSON equals Changes 7.
   - `infra/README.md`: a line under `## 6` mentions `E05`.
   - Terraform hygiene over the diff's `+` lines: none of `provisioner`, `local-exec`, `null_resource`, `"external"`, `archive_file`, `terraform_remote_state`, `profile = "`; no `SFCRole=` fragment; suppression grep (`.skip(`, `.only(`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `Skip =`, `#pragma warning disable`) empty over the new files and `+` lines.
3. Gates (exit 0): `terraform fmt -check -recursive infra`; `cd infra/envs/prod && terraform init -backend=false -input=false && terraform validate && terraform fmt -check -recursive ..`; `.terraform.lock.hcl` zero-diff; `infra/scripts/check-plan.py` parses (`python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())'` — no `py_compile`, which would drop a `__pycache__` into `infra/scripts`); `python3 -c 'import json; json.load(open("docs/delivery/r16-issues/E05.plan-allow.json"))'`.
4. Plan + policy verification (exit 0; `AWS_PROFILE=dev`, read-only): `backend_override.tf` (local state under the temp dir) → `terraform init -input=false -reconfigure` → `terraform plan -input=false -var-file=<temp> -out=$TMP/e05.tfplan` (`TF_VAR_snowflake_external_id` from `iam get-role`, `TF_VAR_alert_email` from `budgets describe-subscribers-for-notification`) → `terraform show -json` → the noise filter of Context #2 → `check-plan.py` with the committed allow file (supervisor mode) or the committed file minus its six `delete` entries (worker mode) → `PLAN OK` → the six deleted addresses absent in worker mode / present as `delete` in supervisor mode → `change.after.policy` of `module.identity.aws_iam_role_policy.core_vpc` and `.worker` parsed: Sid sets, action sets and Resource sets exactly as Changes 2; `aws_iam_role.worker.after.name == "developercards-worker-lambda-role"`, `after.path == "/"`, trust = one statement, `lambda.amazonaws.com`, `sts:AssumeRole`; `module.worker.aws_lambda_function.worker` action `update`; then the 43-row `aws iam simulate-custom-policy` matrix (E00 §3.2 + the rows of Context #4), every row returning the expected `allowed` / `implicitDeny`:

   | doc | action | resource | expected |
   |---|---|---|---|
   | core_vpc | `s3:PutObject` | `arn:aws:s3:::core-vpc/content/x` | allowed |
   | core_vpc | `s3:GetObject` | `arn:aws:s3:::core-vpc/content/manifest.json` | allowed |
   | core_vpc | `s3:PutObject` | `arn:aws:s3:::core-vpc/analytics/raw/review_events/x` | allowed |
   | core_vpc | `s3:GetObject` | `arn:aws:s3:::core-vpc/analytics/marts/content_intelligence/card_snapshot_30d/latest.json.gz` | allowed |
   | core_vpc | `s3:GetObject` | `arn:aws:s3:::core-vpc-premium/premium/decks/x/builds/y/deck.json` | allowed |
   | core_vpc | `s3:ListBucket` | `arn:aws:s3:::core-vpc` / `arn:aws:s3:::core-vpc-premium` | allowed ×2 |
   | core_vpc | `sqs:SendMessage`, `sqs:GetQueueAttributes` | `arn:aws:sqs:ap-southeast-2:622994489535:recallsmith-publish-jobs` | allowed ×2 |
   | core_vpc | `logs:PutLogEvents` | `arn:aws:logs:ap-southeast-2:622994489535:log-group:/aws/lambda/core-vpc:*` | allowed |
   | core_vpc | `ec2:CreateNetworkInterface` | `*` | allowed |
   | core_vpc | `s3:PutObject` | `arn:aws:s3:::core-vpc-premium/x`, `arn:aws:s3:::core-vpc/other/x` | implicitDeny ×2 |
   | core_vpc | `s3:DeleteObject` | `arn:aws:s3:::core-vpc/content/x` | implicitDeny |
   | core_vpc | `s3:DeleteBucket`, `rds:DeleteDBInstance`, `ec2:TerminateInstances`, `sqs:DeleteQueue`, `iam:PassRole`, `sqs:ReceiveMessage`, `ssm:GetParameter` | `*` | implicitDeny ×7 |
   | core_vpc | `sqs:ReceiveMessage` | the publish queue | implicitDeny |
   | core_vpc | `logs:PutLogEvents` | `…:log-group:/aws/lambda/worker-lambda:*` | implicitDeny |
   | worker | `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes`, `sqs:ChangeMessageVisibility` | the publish queue | allowed ×4 |
   | worker | `s3:PutObject` | `arn:aws:s3:::core-vpc-premium/x`, `arn:aws:s3:::core-vpc/content/decks/x/builds/y/deck.json` | allowed ×2 |
   | worker | `s3:GetObject` | `arn:aws:s3:::core-vpc/content/manifest.json` | allowed |
   | worker | `s3:ListBucket` | `arn:aws:s3:::core-vpc` | allowed |
   | worker | `logs:PutLogEvents` | `…:log-group:/aws/lambda/worker-lambda:*` | allowed |
   | worker | `ec2:CreateNetworkInterface` | `*` | allowed |
   | worker | `sqs:SendMessage` | `*`, the publish queue | implicitDeny ×2 |
   | worker | `s3:PutObject` | `arn:aws:s3:::core-vpc/analytics/x` | implicitDeny |
   | worker | `s3:DeleteBucket`, `rds:DeleteDBInstance`, `ec2:TerminateInstances`, `sqs:DeleteQueue`, `iam:PassRole`, `ssm:GetParameter` | `*` | implicitDeny ×6 |
   | worker | `logs:PutLogEvents` | `…:log-group:/aws/lambda/core-vpc:*` | implicitDeny |

5. Scope + frozen + OTA + secret/apply guards (exit 0): `git diff --name-only <merge-base>` ∪ pathspec-scoped untracked scan of `infra docs` contains nothing outside the nine scope files (+ `docs/delivery/r16-issues/`); the three frozen mobile files, `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json`, `mobile/src`, `src_C`, `frontend`, `snowflake`, `scripts`, `.github`, `infra/envs/prod/{versions,providers,backend,variables,outputs}.tf`, `infra/modules/{data,edge,api,observability}`, `infra/modules/identity/cognito.tf`, `infra/scripts`, `docs/delivery/r16-issues/E01.imports.txt` and every other `E0*.plan-allow.json` are zero-diff; `grep -Fq '"version": "1.6.1"' mobile/app.json`; no `@sentry` under `mobile/src`; no `+` line assigns a literal to `PGPASSWORD|MIGRATE_SECRET|INTERNAL_SHARED_SECRET|RC_WEBHOOK_AUTH_(PRODUCTION|DEVELOPMENT)|ANALYTICS_USER_SALT`; no tracked `*.tfplan`, `*.plan.json`, `generated*.tf`, non-example `*.auto.tfvars`; no non-comment line of `infra/scripts`, `src_C/scripts`, `scripts` or `E05.verify.sh` matches `terraform +(apply|import)` or `aws +[a-z0-9-]+ +(create|update|delete|put)-`.

## Verify

```bash
export AWS_PROFILE=dev
BASE=delivery/r16-e-prod bash docs/delivery/r16-issues/E05.verify.sh
```
Steps 1–2 are file/literal checks (seconds); step 3 runs `terraform init -backend=false` (cached provider) + `validate` + `fmt -check` (< 30 s); step 4 writes the gitignored `backend_override.tf` (local state under the temp dir), runs `terraform init -reconfigure` and one `terraform plan` (2–4 min, read-only against the live account through `AWS_PROFILE=dev`; the var-file is `prod.auto.tfvars.example` minus its two sensitive lines, `TF_VAR_snowflake_external_id` comes from `aws iam get-role` and `TF_VAR_alert_email` from `aws budgets describe-subscribers-for-notification` — never printed, removed by `trap` together with the override) → `terraform show -json` → the noise filter → `check-plan.py` → the policy extraction → 43 simulator calls (~1 min); step 5 is the negative scope/frozen/secret/apply guard. The driver then runs the `infra` root gate (`cd infra/envs/prod && terraform init -backend=false -input=false && terraform validate && terraform fmt -check -recursive ..`) plus its diff-scoped banned-term grep and suppression scan.

**Supervisor, after merge (never the worker) — E00 §0 "What the supervisor does after each merge", in this order:**
1. `cd infra/envs/prod && terraform init -reconfigure` (real S3 backend; no override file present) → `terraform plan -out=e05.tfplan` → `terraform show -json e05.tfplan | python3 infra/scripts/check-plan.py --allow docs/delivery/r16-issues/E05.plan-allow.json` → expect exactly 10 effective changes (3 create, 6 delete, `module.worker.aws_lambda_function.worker` update keys `[role]`) → `terraform apply e05.tfplan`. If Lambda answers "The role defined for the function cannot be assumed by Lambda" or an ENI-permission error after the provider's retries, re-plan and re-apply once (IAM propagation, Context #5).
2. Immediately roll the new role into the alias the ESM targets: `aws lambda publish-version --function-name worker-lambda --description "E05 worker role" --query Version --output text` → `aws lambda update-alias --function-name worker-lambda --name prod --function-version <that version>` (or `ONLY=worker AWS_PROFILE=dev ./src_C/deploy.sh`, which does the same after re-uploading the current zip). Confirm `aws lambda get-function-configuration --function-name worker-lambda:prod --query Role --output text` == `arn:aws:iam::622994489535:role/developercards-worker-lambda-role`. Between the apply and this step the ESM (`worker-lambda:prod` → version 4 → old role, which no longer holds `sqs:ReceiveMessage`) reports a permission problem and stops polling; messages wait in the queue (nothing is received, so no receive count is spent, no DLQ move), and polling resumes on the alias move. `aws lambda list-event-source-mappings --function-name worker-lambda:prod --query 'EventSourceMappings[].[State,LastProcessingResult]'` must read `Enabled` and not a permission message afterwards.
3. `aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::622994489535:role/service-role/core-vpc-role-joizyiwt …` and `… --policy-source-arn arn:aws:iam::622994489535:role/developercards-worker-lambda-role …` over the same 43 rows (one `--resource-arns` per call); every decision must match the table. `AWSLambdaBasicExecutionRole-033fad1a` and the customer VPC policy stay attached to core-vpc, so `logs:CreateLogGroup` on `*` still reads `allowed` there — expected, not in the matrix.
4. Smoke: console publish of one deck end-to-end (SQS send by core-vpc → worker receive/put → `content/manifest.json` rebuilt); `GET /api/v1/content/premium-url` returns a presigned URL that downloads (proves `s3:GetObject` on the premium bucket for the role that signs); `POST /api/v1/admin/analytics/outbox/publish` writes under `analytics/raw/review_events/` (proves `S3Content`); CloudWatch shows fresh log streams for both functions.
5. Second `terraform plan` → all `no-op`. IAM Access Analyzer "unused access" on the two roles is a note for `infra/README.md` §6, not a gate.
6. Post-wave, not now: detach `core_vpc["logs"]` / `core_vpc["vpc"]` (redundant with the inline `Logs`/`Eni`, E00 §2.5) and drop `imports.tf` (E00 §6 #20).

## Do NOT

- Do NOT run `terraform apply`, `terraform import`, `aws lambda publish-version` / `update-alias`, `aws iam attach-role-policy` / `detach-role-policy` / `create-role` / `put-role-policy`, `src_C/deploy.sh` without `DRY_RUN=1`, or `terraform init` with the real backend. The plan is your only output; the supervisor applies it.
- Do NOT rename `core-vpc-role-joizyiwt`, move it off `/service-role/`, redeclare `aws_iam_role.core_vpc`, or touch `aws_iam_role.edge_public`, `aws_iam_role_policy.edge_public_cognito`, `aws_iam_policy.snowflake_read`, `aws_iam_role.snowflake` (its trust stays `var.snowflake_external_id`), `aws_iam_role.rds_monitoring`, or any Cognito resource.
- Do NOT add `ssm:*`, `rds:*`, `iam:*`, `s3:DeleteObject`, `s3:ListAllMyBuckets`, `kms:*`, or any `Resource: "*"` outside Sid `Eni`; do NOT grant the worker `sqs:SendMessage` or core-vpc `sqs:ReceiveMessage`; do NOT widen `S3Content` beyond `content/*` + `analytics/*` (E13 swaps the second for the analytics bucket), do NOT give core-vpc `s3:PutObject` on the premium bucket.
- Do NOT use `data "aws_iam_policy_document"`, `aws_iam_policy` + attachment for the new documents, `inline_policy`/`managed_policy_arns` on a role, or a policy `Resource` built from a resource/data attribute (the plan must carry the full document).
- Do NOT edit `imports.tf` beyond deleting the six blocks; do NOT touch `E01.imports.txt`, `check-plan.py`, `.terraform.lock.hcl`, the root `variables.tf`/`outputs.tf`, the bucket policy in `edge`, or `modules/worker/queue.tf`.
- Do NOT commit, paste or print plan JSON (`terraform show -json`) or plan text beyond `Plan: N to add…` and address/action lines; do NOT print any `Environment.Variables` value.
- Do NOT run git inside `/Users/qc/src/recallsmith` (the shared checkout) — only inside your worktree; no `git push`, no PR, no `npm`, no `dotnet`, no `eas`.
