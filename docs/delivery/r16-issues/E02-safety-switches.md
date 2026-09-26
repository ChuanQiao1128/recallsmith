# E02 — safety switches (`safety-switches`)

Turn on the production safety switches that E01 adopted into Terraform without changing them: RDS `deletion_protection = true` and 14-day automated backups (plus a supervisor-only manual-snapshot script), S3 versioning + a noncurrent-90-day lifecycle on `core-vpc` and `core-vpc-premium`, log retention 90 d (`core-vpc`) / 30 d (`worker-lambda`, `edge-public`), a multi-region management-events CloudTrail into a new locked bucket, the budget raised to $60, and provider-level tags on both providers. The cost cleanups the review lists under §2.6 (dead SnapStart/PC versions, stray aliases, the stray log group, the stale Secrets Manager entry, the unattached policy) and the deletion of the public `devcards-content-dev` bucket are **supervisor CLI after apply**, listed at the end of this brief — the worker plans, never applies, never deletes. `infra` only: no `src_C`, no `mobile`, no `frontend`.

## Context

Base: `delivery/r16-e-prod` (== `main@4b07f19`, JWT verification merged) **plus E01 merged** — this issue edits files E01 creates. `docs/delivery/r16-issues/E00-contracts.md` (E00) is binding: §0 non-negotiables (`:9-35`), §1.1 file map (`:43-69`), §2.1.1 module interfaces (`:116-168`), §2.1.4 curation rules (`:209-211`), **§2.2 is this issue's contract** (`:213-222`), §3.1 plan allow-list (`:419-430`), §4 order (`:446-467`: E01 → **E02** → E03), §5 verify conventions (`:470-481`), §6 #15 (`:500`, `devcards-content-dev` is deleted after the owner's OK, never locked) and #21 (`:506`, `fmt -check` from the root as well).

What the account looks like today (every fact re-read 2026-09-22 with `AWS_PROFILE=dev`, account `622994489535`, `ap-southeast-2`, describe/get/list only):

- **RDS `developercards`** (`rds describe-db-instances`): `DeletionProtection false`, `BackupRetentionPeriod 7`, backup window `12:55-13:25`, maintenance `wed:17:19-wed:17:49`, engine `17.9`, **no tags**, **0 manual snapshots** (`describe-db-snapshots --snapshot-type manual`). Review §1 table `docs/backend-architecture-review-2026-09-22.md:68`, §2.5.1 `:144` (critical), §2.5.2 `:145` (major: PITR 14–35 d, a manual snapshot before every migration), §3 row `:184`. E01 adopted it as `module.data.aws_db_instance.developercards` with `prevent_destroy = true`, `skip_final_snapshot = false`, `final_snapshot_identifier = "developercards-final-tf"`, `apply_immediately = false`, `engine_version = "17.9"` exact and none of the forbidden attributes (E00 §2.1.4).
- **S3** (`s3api get-bucket-versioning` returns no `Status` = never versioned; `get-bucket-lifecycle-configuration` → `NoSuchLifecycleConfiguration` on both): `core-vpc` (content + analytics, PAB ×4 on, SSE-S3 + bucket key, BucketOwnerEnforced) and `core-vpc-premium` (paid decks, PAB ×4 on) have **versioning off and no lifecycle**; `content/manifest.json` is overwritten in place on every rebuild, so one bad publish is unrecoverable. Review `:70`, §2.5.5 `:148`, §3 row `:185`. E01 adopted `module.data.aws_s3_bucket_versioning.content` / `.premium` with `status = "Disabled"` (the provider's documented import value, E00 §2.1.4) — flipping it is this issue.
- **`devcards-content-dev`**: PAB all four **false**, `get-bucket-policy-status` → `IsPublic: true`, policy `Principal "*"` `s3:GetObject` on `manifest/*` and `decks/*`, 6 objects, referenced by nothing (`grep -rn devcards-content-dev src_C mobile/src frontend/src` → 0). Review §2.1.7 `:94`. **Not adopted, not locked** (E00 §2.1.2 "never imported", §2.2.7, §6 #15): the supervisor deletes it after the owner's one-word OK is recorded in `infra/README.md` §6. Nothing in this issue's plan or verify depends on it.
- **Log groups** (`logs describe-log-groups --log-group-name-prefix /aws/lambda/`): `/aws/lambda/core-vpc` (35 MB), `/aws/lambda/worker-lambda` (69 KB), `/aws/lambda/edge-public` (4.5 KB) all **Never expire**; stray `/aws/lambda/developercards-api` (1 MB, function gone). Review §2.3.2 `:122`, §3 row `:188`. E01 adopted the three live groups as `module.api.aws_cloudwatch_log_group.core_vpc`, `module.api.aws_cloudwatch_log_group.edge_public`, `module.worker.aws_cloudwatch_log_group.worker` with `retention_in_days = 0`; the stray group is supervisor CLI.
- **CloudTrail** (`cloudtrail describe-trails` → `{"trailList": []}`): no trail, only the 90-day Event History. Review §2.1.5 `:92`, §3 row `:196`. The first management-events trail is free; the bucket `developercards-cloudtrail-622994489535` does not exist (`head-bucket` → 404).
- **Budget** (`budgets describe-budget`): `My Monthly Cost Budget`, COST/MONTHLY, `limit 20.0 USD`, three notifications (ACTUAL > 50 %, FORECASTED > 85 %, ACTUAL > 100 %, all `ALARM`), one e-mail subscriber. Review `:74`, §2.6 `:162`, §2.3.1 `:121` ("预算改 $60"). E01 adopted it as `module.observability.aws_budgets_budget.monthly` with `limit_amount` fed by the module variable `budget_limit` (`"20"` in E01, E00 §2.1.1). The provider suppresses the `20` vs `20.0` formatting difference, so the only change is the number.
- **Tags**: no resource carries a tag (review §2.6 `:163`); E01 deliberately set none (E00 §2.1.4 "No `tags` anywhere in E01 (tags are E02's planned change, §2.2.6)"). A `default_tags` block on both providers tags every taggable adopted resource in one plan; the checker's `tags_only_updates` flag (E00 §3.1) admits those updates without listing them. Probe of 2026-09-22 (scratch, 3 imports, read-only plan): with `default_tags` the changed keys are exactly `['limit_amount', 'tags_all']` for the budget, `['retention_in_days', 'tags_all']` for a log group and `['versioning_configuration']` for a versioning resource.
- **Cost cleanups** (`lambda list-versions-by-function`, `list-provisioned-concurrency-configs`, `list-aliases`, `secretsmanager list-secrets`, `iam get-policy`): `core-vpc` versions 2–48 exist, SnapStart `On` for **30, 31, 32**, provisioned concurrency `1` on **version 33** (`READY`), aliases `prod → 48`, `dev → 43`, `developercards_api_rds → $LATEST`; `worker-lambda` versions 1–4, SnapStart `On` for **1**, alias `prod → 4`; Secrets Manager holds one entry `rds-db-credentials/cluster-Y4XJLKMCRUJBDLTD3M7RHF7OKI/postgres/1765436207646` (last accessed 2025-12-11, cluster gone); policy `AWSLambdaBasicExecutionRole-a8a93ed4-36c7-46ba-88b0-02e1b1de9feb` has `AttachmentCount 0`. Review §2.6 `:158-159` ($4.93 + $0.40/month for versions that serve no traffic), §3 row `:193`. None of these is a Terraform resource (E00 §2.1.2 "never imported"); all are supervisor CLI after apply (§2.2.4). Keep `core-vpc` 47 and 48 and `worker-lambda` 4.

What E00 decided for this issue (and two consequences the contract text does not spell out):

- §2.2.1: RDS `deletion_protection = true`, `backup_retention_period = 14`, `apply_immediately` stays `false`. Both are non-disruptive changes (a non-zero → non-zero retention change and a deletion-protection flip need no reboot).
- §2.2.2: `infra/scripts/rds-snapshot.sh <label>` — supervisor/owner tool; workers run it **only** with `DRY_RUN=1`.
- §2.2.3: versioning `Enabled` on both buckets + one lifecycle configuration per bucket (`noncurrent-90d`, whole bucket, noncurrent 90 d, abort incomplete multipart 7 d). **No `expiration` block** — current objects (live builds, the manifest, paid decks) are never expired by lifecycle; the review's "old build cleanup" is a later, reference-aware job (§2.5.5 `:148`), not a lifecycle rule.
- §2.2.4: retention is set on the adopted log-group resources **where they live** (`modules/api/core_vpc.tf`, `modules/api/edge_public.tf`, `modules/worker/function.tf`) — §1.1's later-editor columns for those three files omit E02, but §1.1's `retention.tf` row and §2.2.4 both say the retention lines go into the owning modules; this brief follows §2.2.4 and adds the three files to the scope.
- §2.2.5: the trail + its bucket set live in the new `infra/modules/observability/retention.tf` (§1.1: "this file holds only the CloudTrail bucket+trail").
- §2.2.6: `limit_amount = "60"`, notification blocks **byte-identical to E01** (three blocks, thresholds 50/85/100, the adopted subscriber literal untouched). §2.2.6 also says "subscriber email is `var.alert_email` (§2.4.1)", but §1.1 gives the root `alert_email` variable, `prod.auto.tfvars.example` and root `outputs.tf` to **E04**, and the E04 brief already owns the swap: `docs/delivery/r16-issues/E04-observability.md:35` creates `variable "alert_email"` (root + module) and replaces the three literals, and `E04.verify.sh:360` reads the adopted literal from the **merge-base copy** of `budget.tf` into `TF_VAR_alert_email` so E04's worker plan shows the budget as a no-op. E02 must therefore leave that literal exactly where E01 put it — swapping it here would break E04's verify. Consequence: the E02 budget plan touches `limit_amount` (+ tags) only. `default_tags` in `infra/envs/prod/providers.tf` (both providers) — §1.1 lists no later editor for `providers.tf`, but §2.2.6 and §2.1.4 name E02 as the owner of that change, so `providers.tf` is in scope.
- §5 "why the empty-state plan is valid": the worker's plan runs against an empty local state, so every adopted resource is imported again and `module.data.aws_db_instance.developercards` shows the same three provider-side keys E01's plan showed (`apply_immediately`, `skip_final_snapshot`, `final_snapshot_identifier` — no `ModifyDBInstance` behind them) **on top of** `deletion_protection`, `backup_retention_period`, `tags_all`. The allow file lists all of them; the supervisor's plan against the remote state shows only the E02 keys and passes the same file (§3.1: one allow file serves both).
- §5 "empty-state plan": `terraform init -backend=false` skips backend initialisation, and a following `terraform plan` refuses to run ("Backend initialization required") because `backend.tf` declares S3. The verify therefore drops the gitignored `infra/envs/prod/backend_override.tf` (`docs/delivery/r16-issues/E01-terraform-adopt.md` gap 13, the mechanism every later infra brief copies; `backend "local"` with a path under `mktemp -d`) into the root for the plan only, initialises with `-reconfigure`, and removes the override file and `.terraform/terraform.tfstate` (the backend-config cache, not a state) in its `trap`. The remote state is never opened. The root gate's `terraform init -backend=false -input=false && terraform validate` still runs verbatim in step 3 (validate needs no backend).
- Root variables: the real `prod.auto.tfvars` is gitignored and absent in a worktree; the verify feeds the plan `prod.auto.tfvars.example` minus any `external_id` line plus the live Snowflake `sts:ExternalId` read from `iam get-role` (read-only, exported as `TF_VAR_snowflake_external_id`, never printed), so the adopted Snowflake trust policy stays a no-op. E02 adds no root variable. E01's twelve root outputs appear as `create` in every empty-state plan (E01 brief gap 3), so the allow file lists them under `outputs`; on the supervisor's plan they are no-op.

## Read first

1. `docs/delivery/r16-issues/E00-contracts.md` §0 (`:9-35`), §1.1 (`:43-69`), §2.1.1 (`:116-168`), §2.1.4 (`:209-211`), §2.2 (`:213-222`), §3.1 (`:419-430`), §5 (`:470-481`), §6 #15 (`:500`) and #21 (`:506`).
2. `docs/delivery/r16-issues/E01-terraform-adopt.md` (the skeleton you are editing; gaps 2, 3, 6, 11, 13 explain the ExternalId, root outputs, root variable defaults, stripped tags and the backend override) and `infra/README.md` §1–§6, `infra/RUNBOOK.md` as merged on `delivery/r16-e-prod`.
3. `infra/envs/prod/providers.tf`, `main.tf`, `variables.tf`, `prod.auto.tfvars.example`, `imports.tf` (read only — never edited after E01).
4. `infra/modules/data/rds.tf`, `buckets.tf`, `variables.tf`; `infra/modules/api/core_vpc.tf`, `edge_public.tf`; `infra/modules/worker/function.tf`; `infra/modules/observability/budget.tf`, `variables.tf`, `main.tf`.
5. `infra/scripts/check-plan.py` (its `--allow` JSON shape is E00 §3.1) and `docs/delivery/r16-issues/E01.plan-allow.json` as the format precedent.
6. `docs/backend-architecture-review-2026-09-22.md` `:60-76` (§1 table), `:92-95` (§2.1.5, §2.1.7), `:122` (§2.3.2), `:144-148` (§2.5.1, §2.5.2, §2.5.5), `:156-164` (§2.6), `:184-196` (§3 rows).
7. `docs/delivery/r16-issues/E02.verify.sh` — every check below is enforced there.

## Constraints

- **Scope (the ONLY files that may change):**
  1. `infra/scripts/rds-snapshot.sh` (new, `chmod +x`)
  2. `infra/modules/observability/retention.tf` (new)
  3. `docs/delivery/r16-issues/E02.plan-allow.json` (new, byte content in Changes 9)
  4. `infra/modules/data/rds.tf` (two attribute values)
  5. `infra/modules/data/buckets.tf` (two `status` values + two new lifecycle resources)
  6. `infra/modules/api/core_vpc.tf` (one `retention_in_days`)
  7. `infra/modules/api/edge_public.tf` (one `retention_in_days`)
  8. `infra/modules/worker/function.tf` (one `retention_in_days`)
  9. `infra/modules/observability/budget.tf` (only if E01 hard-coded the limit — `limit_amount = var.budget_limit`; see Changes 6)
  10. `infra/modules/observability/variables.tf` (only if E01 gave `budget_limit` a `"20"` default; see Changes 6)
  11. `infra/envs/prod/providers.tf` (`default_tags` on both providers)
  12. `infra/envs/prod/main.tf` (wiring: `budget_limit = "60"`)
  13. `infra/README.md` (one dated line appended to §6)
  Nothing else: no `infra/envs/prod/imports.tf`, `backend.tf`, `versions.tf`, `variables.tf`, `outputs.tf`, `prod.auto.tfvars.example`, `.terraform.lock.hcl`; no `infra/scripts/check-plan.py`, `infra/RUNBOOK.md`, `infra/.gitignore`, `infra/bootstrap/`; no `infra/modules/identity/**`, `infra/modules/edge/**`, `modules/api/gateway.tf`, `modules/worker/queue.tf`, `modules/data/network.tf`, `modules/data/variables.tf`, `modules/data/outputs.tf`, any module `main.tf`/`outputs.tf`; no `src_C/`, `mobile/`, `frontend/`, `site/`, `.github/`, `snowflake/`, `scripts/`, top-level `docs/*.md`.
- **WORKER SAFETY RULE (verbatim, E00 §0):** a worker may run read-only AWS CLI, `terraform init/validate/plan` (plan must be saved with -out and shown as JSON), but NEVER `terraform apply`, `terraform import` (state-changing), `aws ... create/update/delete/put`, `eas`, or any deploy script. The supervisor applies plans after each merge. Each infra brief's verify.sh therefore checks the PLAN (terraform show -json) against an explicit allow-list of resource addresses and actions — nothing else may appear as create/update/delete.
  Consequences here: `import {}` blocks already in `imports.tf` are configuration and stay; `infra/scripts/rds-snapshot.sh` is written by you but executed by you **only** as `DRY_RUN=1 infra/scripts/rds-snapshot.sh <label>`; the plan JSON is never committed, pasted into the PR or printed beyond `check-plan.py`'s `address  actions  keys` lines (E00 §0 "Secrets": `aws_lambda_function.environment.variables` is in clear in every plan); every `*.tfplan` / `*.plan.json` you produce is deleted before you finish; `terraform init` in the prod root is only ever `-backend=false` (the verify's `backend_override.tf` local init is the one exception and cleans up after itself).
- **Frozen files (E00 §0) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts` (an infra issue never opens them).
- **OTA rule (E00 §0):** nothing under `mobile/` changes; `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json` (`"version": "1.6.1"`), `mobile/eas.json` stay byte-identical; no `@sentry/*`.
- **No renames (E00 §0):** every adopted name/id stays (`developercards`, `core-vpc`, `core-vpc-premium`, `/aws/lambda/core-vpc`, `/aws/lambda/worker-lambda`, `/aws/lambda/edge-public`, `My Monthly Cost Budget`). New names use the `developercards-` prefix: `developercards-cloudtrail-622994489535`, `developercards-management` (E00 §2.1.3).
- **Terraform rules (E00 §0, §2.1.4):** no `provisioner`, `local-exec`, `null_resource`, `external` data source, `archive_file`; no `profile` in any provider; no `password`/`manage_master_user_password` on the DB; no `tags` argument on any resource (tags come from `default_tags` only); no `force_destroy = true`; no `prevent_destroy` removed; `required_version`/provider constraint/lock file untouched; `terraform fmt` clean.
- **Secrets (E00 §0, §5):** no secret value in any `.tf`, `.json`, `.sh`, `.md`, PR text or log; the guard `grep -E '(PGPASSWORD|MIGRATE_SECRET|INTERNAL_SHARED_SECRET|RC_WEBHOOK_AUTH_(PRODUCTION|DEVELOPMENT)|ANALYTICS_USER_SALT)\s*[=:]\s*"[^"$P]'` over your added lines must find nothing. The two core-vpc env-var names E00 §0 calls unspellable are not written anywhere.
- **Banned literals in any added line** (driver gate, case-insensitive): the six terms of B00 §0 — never reproduce them, not even in a comment; say "work around", "sidestep", "guard", "fallback", "probe". The apply guard (E00 §5) additionally rejects `terraform apply`, `terraform import` and any `aws <svc> create-/update-/delete-/put-` literal outside comment lines in every file you write **except** `rds-snapshot.sh`, which is a named supervisor-only script and must contain exactly its two `aws rds` commands behind the `DRY_RUN` gate.
- **Suppression tokens:** none of `Skip =`, `#pragma warning disable`, `.skip(`, `.only(`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable` anywhere in the diff.
- **Tests that may / may not change:** there are no test files in this issue. `infra/scripts/check-plan.py` and E01's allow/imports files are read-only. The root gates for `mobile`/`frontend`/`src_C` are not run because those roots do not change; the `infra` root gate (E00 §0) runs verbatim.
- Standing rules: no `git push`, no PR, never touch `main`, no `eas`/`expo`/deploy command, no git activity outside your worktree; no `npm install`; `terraform init` may download the pinned provider once into `TF_PLUGIN_CACHE_DIR="$HOME/.terraform.d/plugin-cache"`.

## Changes required

1. **`infra/modules/data/rds.tf` — two values on `aws_db_instance.developercards`.** Change `deletion_protection = false` → `deletion_protection = true` and `backup_retention_period = 7` → `backup_retention_period = 14`. Nothing else in the resource moves: `apply_immediately = false`, `skip_final_snapshot = false`, `final_snapshot_identifier = "developercards-final-tf"`, `engine_version = "17.9"`, `backup_window = "12:55-13:25"`, `maintenance_window = "wed:17:19-wed:17:49"`, `lifecycle { prevent_destroy = true }` all stay verbatim. Do not add `tags`, `copy_tags_to_snapshot` changes, `enabled_cloudwatch_logs_exports`, a parameter group, or `multi_az` (review §5 `:288` says no Multi-AZ now).

2. **`infra/scripts/rds-snapshot.sh` — new, executable, supervisor/owner tool (E00 §2.2.2).** Exact behaviour:
   ```bash
   #!/usr/bin/env bash
   # infra/scripts/rds-snapshot.sh <label> — manual RDS snapshot of the prod instance.
   # Supervisor/owner tool (E00 §0): run before every migration / risky apply.
   # Workers run it ONLY as DRY_RUN=1 (prints the two commands, calls nothing).
   set -euo pipefail
   label="${1:-}"
   [[ "$label" =~ ^[a-z0-9-]{1,40}$ ]] || { echo "usage: $0 <label>   (label must match ^[a-z0-9-]{1,40}$)" >&2; exit 2; }
   DB_ID="${DB_ID:-developercards}"
   SNAP="developercards-${label}-$(date -u +%Y%m%d-%H%M)"
   if [ "${DRY_RUN:-0}" = "1" ]; then
     echo "DRY_RUN: aws rds create-db-snapshot --db-instance-identifier $DB_ID --db-snapshot-identifier $SNAP"
     echo "DRY_RUN: aws rds wait db-snapshot-available --db-snapshot-identifier $SNAP"
     exit 0
   fi
   aws rds create-db-snapshot --db-instance-identifier "$DB_ID" --db-snapshot-identifier "$SNAP" --query 'DBSnapshot.DBSnapshotIdentifier' --output text
   aws rds wait db-snapshot-available --db-snapshot-identifier "$SNAP"
   echo "$SNAP"
   ```
   Pinned: shebang, `set -euo pipefail`, the regex literal `^[a-z0-9-]{1,40}$`, `DRY_RUN`, the identifier pattern `developercards-${label}-$(date -u +%Y%m%d-%H%M)`, the real snapshot line beginning `aws rds create-db-snapshot --db-instance-identifier "$DB_ID" --db-snapshot-identifier "$SNAP"`, `aws rds wait db-snapshot-available`, exit 2 on a bad label (`Pre_E02`, 41 characters, missing), exit 0 after the two `DRY_RUN:` lines. The `DRY_RUN` branch precedes the first real `aws` line; exactly two lines start with `aws`. No other command, no `--tags`, no cross-region copy (E00 keeps AWS Backup for later), no `aws configure`.

3. **`infra/modules/data/buckets.tf` — versioning on, lifecycle added.** In `aws_s3_bucket_versioning.content` and `aws_s3_bucket_versioning.premium` change `status = "Disabled"` → `status = "Enabled"` (never `"Suspended"`). Append, verbatim except for the two bucket names/references:
   ```hcl
   resource "aws_s3_bucket_lifecycle_configuration" "content" {
     bucket = aws_s3_bucket.content.id

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

     depends_on = [aws_s3_bucket_versioning.content]
   }
   ```
   and the same block as `"premium"` with `aws_s3_bucket.premium.id` / `aws_s3_bucket_versioning.premium`. Exactly one `rule` per resource, `filter {}` (whole bucket, no `prefix`), **no `expiration` block, no `transition`**, no `expected_bucket_owner`. (Validated against hashicorp/aws 6.66.0 on 2026-09-22: `terraform validate` + `fmt -check` pass.) The console bucket (`module.edge`) and the newsapp buckets are not touched.

4. **Log retention in the owning modules (E00 §2.2.4).** `infra/modules/api/core_vpc.tf`: `aws_cloudwatch_log_group.core_vpc` `retention_in_days = 0` → `90`. `infra/modules/api/edge_public.tf`: `aws_cloudwatch_log_group.edge_public` → `30`. `infra/modules/worker/function.tf`: `aws_cloudwatch_log_group.worker` → `30`. No other attribute of those resources changes (`log_group_class`, `skip_destroy`, `kms_key_id` stay as E01 wrote them); no new log group (E04 owns the API access-log group); no `logging_config` change on any function (E00 §6 #6). After this issue `grep -rn 'retention_in_days *= *0' infra/modules` is empty.

5. **`infra/modules/observability/retention.tf` — new: CloudTrail + its bucket set (E00 §2.2.5).** Verbatim:
   ```hcl
   # CloudTrail: one multi-region management-events trail into a locked, SSE-S3 bucket.
   # Log retention for the adopted Lambda log groups lives in modules/api and modules/worker (E00 §2.2.4).

   data "aws_region" "current" {}

   locals {
     cloudtrail_bucket_name = "developercards-cloudtrail-${var.account_id}"
     cloudtrail_trail_arn   = "arn:aws:cloudtrail:${data.aws_region.current.region}:${var.account_id}:trail/developercards-management"
   }

   resource "aws_s3_bucket" "cloudtrail" {
     bucket = local.cloudtrail_bucket_name
   }

   resource "aws_s3_bucket_public_access_block" "cloudtrail" {
     bucket                  = aws_s3_bucket.cloudtrail.id
     block_public_acls       = true
     block_public_policy     = true
     ignore_public_acls      = true
     restrict_public_buckets = true
   }

   resource "aws_s3_bucket_ownership_controls" "cloudtrail" {
     bucket = aws_s3_bucket.cloudtrail.id
     rule {
       object_ownership = "BucketOwnerEnforced"
     }
   }

   resource "aws_s3_bucket_server_side_encryption_configuration" "cloudtrail" {
     bucket = aws_s3_bucket.cloudtrail.id
     rule {
       apply_server_side_encryption_by_default {
         sse_algorithm = "AES256"
       }
     }
   }

   resource "aws_s3_bucket_lifecycle_configuration" "cloudtrail" {
     bucket = aws_s3_bucket.cloudtrail.id

     rule {
       id     = "expire-400d"
       status = "Enabled"

       filter {}

       expiration {
         days = 400
       }

       abort_incomplete_multipart_upload {
         days_after_initiation = 7
       }
     }
   }

   resource "aws_s3_bucket_policy" "cloudtrail" {
     bucket = aws_s3_bucket.cloudtrail.id
     policy = jsonencode({
       Version = "2012-10-17"
       Statement = [
         {
           Sid       = "AWSCloudTrailAclCheck"
           Effect    = "Allow"
           Principal = { Service = "cloudtrail.amazonaws.com" }
           Action    = "s3:GetBucketAcl"
           Resource  = aws_s3_bucket.cloudtrail.arn
           Condition = {
             StringEquals = { "aws:SourceArn" = local.cloudtrail_trail_arn }
           }
         },
         {
           Sid       = "AWSCloudTrailWrite"
           Effect    = "Allow"
           Principal = { Service = "cloudtrail.amazonaws.com" }
           Action    = "s3:PutObject"
           Resource  = "${aws_s3_bucket.cloudtrail.arn}/AWSLogs/${var.account_id}/*"
           Condition = {
             StringEquals = {
               "s3:x-amz-acl"  = "bucket-owner-full-control"
               "aws:SourceArn" = local.cloudtrail_trail_arn
             }
           }
         }
       ]
     })

     depends_on = [aws_s3_bucket_public_access_block.cloudtrail, aws_s3_bucket_ownership_controls.cloudtrail]
   }

   resource "aws_cloudtrail" "management" {
     name                          = "developercards-management"
     s3_bucket_name                = aws_s3_bucket.cloudtrail.id
     is_multi_region_trail         = true
     include_global_service_events = true
     enable_log_file_validation    = true
     enable_logging                = true

     depends_on = [aws_s3_bucket_policy.cloudtrail]
   }
   ```
   `var.account_id` is already in the module interface (E00 §2.1.1); the region comes from the `aws_region` data source so the interface does not grow. No `event_selector`, `advanced_event_selector`, `insight_selector`, `cloud_watch_logs_*`, `kms_key_id`, `sns_topic_name`; no versioning on the trail bucket; no `prevent_destroy`. (Validated on 2026-09-22 against 6.66.0; a read-only plan of this file in a scratch root produced seven `create` entries and nothing else — the data source does not appear in `resource_changes`.) Do not add `aws_sns_topic`, alarms, an RDS event subscription or an API access-log group here — those are E04's `alerts.tf`/`alarms.tf`/`api_logs.tf`.

6. **Budget $60 (E00 §2.2.6).** In `infra/envs/prod/main.tf`, the `module "observability"` block passes `budget_limit = "60"` (add the line if E01 relied on a module default). `infra/modules/observability/budget.tf` must read `limit_amount = var.budget_limit` — if E01 hard-coded `"20"` there, replace the literal with the variable; that is the **only** line `budget.tf` may gain (the verify diffs it against the merge-base). If `infra/modules/observability/variables.tf` declares `budget_limit` with `default = "20"`, change the default to `"60"` (the only edit that file may receive). After this issue `grep -rEn 'budget_limit\s*=\s*"20|limit_amount\s*=\s*"20' infra` is empty. The three `notification` blocks (thresholds 50 / 85 / 100, `subscriber_email_addresses` literal, `subscriber_sns_topic_arns` empty or absent) stay byte-identical to E01 — E04 creates `var.alert_email`, swaps the subscriber and adds the SNS topic (Context); `var.alert_email` must not appear anywhere in this issue.

7. **`infra/envs/prod/providers.tf` — `default_tags` on both providers.** Each `provider "aws"` block (the default one and `alias = "use1"`) gains, verbatim:
   ```hcl
     default_tags {
       tags = {
         Project   = "DeveloperCards"
         Env       = var.env
         ManagedBy = "terraform"
       }
     }
   ```
   `var.env` is E01's root variable (`"prod"`). No `profile`, no other provider attribute changes. This is what makes every taggable adopted resource show a `tags`/`tags_all`-only `update` in the plan — admitted by `"tags_only_updates": true` (Changes 9), never by listing them.

8. **`infra/README.md` §6 — one dated line.** Append to the change log, in E01's line format, one line that names `E02`, the six switches in a few words, and ends with `devcards-content-dev: deletion pending owner OK (E00 §6 #15)`. The supervisor appends the OK and the deletion date later; the worker writes no CLI command into the README.

9. **`docs/delivery/r16-issues/E02.plan-allow.json` — new, exactly this content** (the verify compares it as parsed JSON, so whitespace is free but keys and values are not):
   ```json
   {
     "tags_only_updates": true,
     "outputs": ["api_id", "api_endpoint", "content_distribution_id", "content_domain_name", "console_distribution_id", "console_domain_name", "core_vpc_alias_arn", "worker_alias_arn", "queue_url", "db_address", "console_pool_endpoint", "mobile_pool_endpoint"],
     "changes": {
       "module.data.aws_db_instance.developercards": { "action": "update", "keys": ["deletion_protection", "backup_retention_period", "tags", "tags_all", "apply_immediately", "skip_final_snapshot", "final_snapshot_identifier"] },
       "module.data.aws_s3_bucket_versioning.content": { "action": "update", "keys": ["versioning_configuration"] },
       "module.data.aws_s3_bucket_versioning.premium": { "action": "update", "keys": ["versioning_configuration"] },
       "module.data.aws_s3_bucket_lifecycle_configuration.content": "create",
       "module.data.aws_s3_bucket_lifecycle_configuration.premium": "create",
       "module.api.aws_cloudwatch_log_group.core_vpc": { "action": "update", "keys": ["retention_in_days", "tags", "tags_all"] },
       "module.api.aws_cloudwatch_log_group.edge_public": { "action": "update", "keys": ["retention_in_days", "tags", "tags_all"] },
       "module.worker.aws_cloudwatch_log_group.worker": { "action": "update", "keys": ["retention_in_days", "tags", "tags_all"] },
       "module.observability.aws_budgets_budget.monthly": { "action": "update", "keys": ["limit_amount", "tags", "tags_all"] },
       "module.observability.aws_s3_bucket.cloudtrail": "create",
       "module.observability.aws_s3_bucket_public_access_block.cloudtrail": "create",
       "module.observability.aws_s3_bucket_ownership_controls.cloudtrail": "create",
       "module.observability.aws_s3_bucket_server_side_encryption_configuration.cloudtrail": "create",
       "module.observability.aws_s3_bucket_lifecycle_configuration.cloudtrail": "create",
       "module.observability.aws_s3_bucket_policy.cloudtrail": "create",
       "module.observability.aws_cloudtrail.management": "create"
     }
   }
   ```
   Nine `create`, seven listed `update`, no `delete`, no `replace`, no `expect_imports`; `outputs` = E01's twelve root outputs verbatim (they are `create` in every empty-state plan, no-op for the supervisor). The RDS entry carries E01's three provider-side keys because the worker's empty-state plan re-imports the instance (Context); on the supervisor's remote-state plan those keys simply do not appear. If your plan shows any other address as `create`/`update`/`delete` (a versioning resource on the console bucket, a fourth log group, an `expiration` on the content buckets…), fix the `.tf`, never the allow file.

10. **Plan, check, clean (the only "run" of this issue).** From the worktree root, with `AWS_PROFILE=dev` and `TF_PLUGIN_CACHE_DIR="$HOME/.terraform.d/plugin-cache"`: run `bash docs/delivery/r16-issues/E02.verify.sh`. It formats/validates, plans against an empty **local** state through a temporary backend override (Context), runs `check-plan.py` with the allow file, prints only `address  actions  keys` lines and `PLAN OK <n>`, and deletes the plan files. Expected shape: `Plan: 93 to import, 9 to add, N to change, 0 to destroy` where N = the seven listed updates + the tag-only updates. Paste the `Plan:` line and the `PLAN OK` line into your PR body — nothing else from the plan.

Estimated size: `rds.tf` 2 lines changed; `buckets.tf` 2 changed + ~40 added; three log-group lines; `retention.tf` ~110 lines; `providers.tf` +14; `main.tf` 1 line; `budget.tf`/module `variables.tf` 0–1 line each; `rds-snapshot.sh` 18 lines; allow JSON 22 lines; README 1 line.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/E02.verify.sh` re-runs exactly these.

1. Scope files exist (exit 0): `infra/scripts/rds-snapshot.sh` (executable), `infra/modules/observability/retention.tf`, `docs/delivery/r16-issues/E02.plan-allow.json`; E01 prerequisites present on the integration branch: `infra/envs/prod/{main,providers,backend,imports,versions,variables}.tf`, `prod.auto.tfvars.example`, `.terraform.lock.hcl`, `infra/scripts/check-plan.py`, `infra/modules/data/{rds,buckets}.tf`, `infra/modules/api/{core_vpc,edge_public}.tf`, `infra/modules/worker/function.tf`, `infra/modules/observability/budget.tf`, `infra/README.md`.
2. Literal guards (exit 0):
   - `rds.tf`: `deletion_protection = true`, `backup_retention_period = 14`; no `deletion_protection = false`, no `backup_retention_period = 7`; `prevent_destroy = true`, `skip_final_snapshot = false`, `apply_immediately = false`, `final_snapshot_identifier = "developercards-final-tf"`, `engine_version = "17.9"` still present; no `password`, `manage_master_user_password`, `multi_az = true`, `tags`.
   - `buckets.tf`: exactly four `status = "Enabled"` lines (two versioning + two lifecycle rules), no `status = "Disabled"`/`"Suspended"`; `resource "aws_s3_bucket_lifecycle_configuration" "content"` and `"premium"`; two `id = "noncurrent-90d"`, two `noncurrent_days = 90`, two `days_after_initiation = 7`, two `filter {}`, `depends_on = [aws_s3_bucket_versioning.content]` and `.premium`; no `expiration {`, `transition`, `prefix`, `force_destroy = true`.
   - `core_vpc.tf`: `retention_in_days = 90`; `edge_public.tf` and worker `function.tf`: `retention_in_days = 30`; `grep -rEn 'retention_in_days\s*=\s*0\b' infra/modules` empty; no `logging_config` change.
   - `retention.tf`: `data "aws_region" "current"`, `developercards-cloudtrail-${var.account_id}`, `trail/developercards-management`, the six `"cloudtrail"` bucket-set resources, `resource "aws_cloudtrail" "management"`, `name = "developercards-management"`, `is_multi_region_trail = true`, `include_global_service_events = true`, `enable_log_file_validation = true`, four PAB `= true`, `BucketOwnerEnforced`, `AES256`, `id = "expire-400d"`, `days = 400`, `AWSCloudTrailAclCheck`, `AWSCloudTrailWrite`, `cloudtrail.amazonaws.com`, `s3:GetBucketAcl`, `s3:PutObject`, `bucket-owner-full-control`, `aws:SourceArn`, `/AWSLogs/${var.account_id}/*`, `depends_on = [aws_s3_bucket_policy.cloudtrail]`; no `event_selector`, `advanced_event_selector`, `insight_selector`, `cloud_watch_logs`, `kms_key_id`, `aws_sns_topic`, `aws_cloudwatch_metric_alarm`, `aws_db_event_subscription`.
   - budget: `budget_limit = "60"` in `infra/envs/prod/main.tf`; `limit_amount = var.budget_limit` in `budget.tf`; no `"20"` for `budget_limit`/`limit_amount` under `infra`; exactly three `notification {` blocks with thresholds 50, 85, 100 in `budget.tf`; the three `subscriber_email_addresses` lines are byte-identical to the merge-base copy and the only `+` line `budget.tf` may carry is `limit_amount = var.budget_limit`; no `var.alert_email` anywhere under `infra`; no non-empty `subscriber_sns_topic_arns`; no `aws_sns_topic`/`aws_cloudwatch_metric_alarm`/`aws_db_event_subscription` under `infra/modules/observability`.
   - `providers.tf`: exactly two `provider "aws"` blocks, two `default_tags {`, two `Project = "DeveloperCards"`, two `Env = var.env`, two `ManagedBy = "terraform"`; no `profile`; no literal `tags = {` map on any resource under `infra/modules`.
   - `rds-snapshot.sh`: the pinned literals of Changes 2; exactly two real `aws` lines (the pinned snapshot line and the wait); `DRY_RUN=1 … pre-e02-verify` (run in a credential-less environment) exits 0 and prints both `DRY_RUN: aws rds …` lines ending in `-YYYYMMDD-HHMM`; label `Pre_E02`, a 41-character label and a missing label exit non-zero; the first non-comment `DRY_RUN` line precedes the first real `aws` line; no other AWS service is called.
   - `E02.plan-allow.json` parses and equals Changes 9 as JSON.
   - `infra/README.md` has a `- …E02…devcards-content-dev…` line.
   - no suppression token, no banned literal, no secret-name-with-value in any scope file or added line; `git ls-files infra` has no `.tfplan`/`.plan.json`/`generated*.tf`/`*_override.tf`/non-example `.auto.tfvars`; `grep -rn 'profile *= *"' infra --include=*.tf` empty; `imports.tf`, `backend.tf`, `versions.tf`, root `variables.tf`/`outputs.tf`, `prod.auto.tfvars.example`, `.terraform.lock.hcl`, `check-plan.py` zero-diff.
3. Gates (exit 0): `cd infra/envs/prod && terraform init -backend=false -input=false && terraform validate && terraform fmt -check -recursive ..`; from the root `terraform fmt -check -recursive infra`; `bash -n infra/scripts/rds-snapshot.sh`; `python3 -c 'import json; json.load(open("docs/delivery/r16-issues/E02.plan-allow.json"))'`; `python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' infra/scripts/check-plan.py` (a parse, not `py_compile` — no `__pycache__` is written into the tree).
4. Plan (exit 0, `AWS_PROFILE=dev`, read-only, ~2–4 min): temporary `infra/envs/prod/backend_override.tf` (`backend "local"`) → `terraform init -input=false -reconfigure` → `terraform plan -input=false -out=<tmp>/e02.tfplan -var-file=<example minus external_id>` with the live Snowflake ExternalId in `TF_VAR_snowflake_external_id` → `terraform show -json` → `python3 infra/scripts/check-plan.py --plan <tmp>/e02.plan.json --allow docs/delivery/r16-issues/E02.plan-allow.json` prints `PLAN OK`; override file, `.terraform/terraform.tfstate`, `*.tfplan`, `*.plan.json`, the tfvars copy and the plan text are removed by the script's `trap`. No `terraform` command other than `init`/`validate`/`fmt`/`plan`/`show` runs.
5. Scope + frozen + OTA + apply guard (exit 0): `git diff --name-only <merge-base>` ∪ pathspec-scoped untracked scan of `infra docs` contains nothing outside the thirteen scope files (+ `docs/delivery/r16-issues/`); `mobile/`, `frontend/`, `src_C/`, `site/`, `.github/`, `snowflake/`, `scripts/`, the three frozen files, `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json` are zero-diff; `mobile/app.json` still says `"version": "1.6.1"`; no `@sentry` under `mobile/src`; the added lines of every scope file except `rds-snapshot.sh` contain no `terraform apply`/`terraform import`/`aws <svc> create-|update-|delete-|put-` outside comment lines.

## Verify

```bash
export AWS_PROFILE=dev TF_PLUGIN_CACHE_DIR="$HOME/.terraform.d/plugin-cache"
BASE=delivery/r16-e-prod bash docs/delivery/r16-issues/E02.verify.sh
```
Steps 1–3 are file/literal/format checks (seconds; `terraform init` reuses the cached 6.66.0 provider). Step 4 is the read-only plan (~2–4 min for the 93 imports + the E02 diff; needs the `dev` profile; prints only `Plan: …`, the checker's `address  actions  keys` lines and `PLAN OK <n>`). Step 5 is a purely negative guard. **The supervisor applies** (E00 §0): after merge, `infra/scripts/rds-snapshot.sh pre-e02` → `terraform init -reconfigure` with the real backend → `terraform plan -out=e02.tfplan` with the gitignored `prod.auto.tfvars` carrying the real `snowflake_external_id` → `check-plan.py` with the same allow file → apply → the post-apply list below → a second plan that must be empty. The driver's diff-scoped banned-term grep and suppression scan run separately.

## Supervisor post-apply (CLI, after `terraform apply e02.tfplan`; never a worker; order matters)

```bash
export AWS_PROFILE=dev AWS_DEFAULT_REGION=ap-southeast-2
# 0. before the apply (first real use of the script)
infra/scripts/rds-snapshot.sh pre-e02
# 1. provisioned concurrency and stray aliases must go before their versions can be deleted
aws lambda delete-provisioned-concurrency-config --function-name core-vpc --qualifier 33
aws lambda delete-alias --function-name core-vpc --name dev
aws lambda delete-alias --function-name core-vpc --name developercards_api_rds
# 2. dead versions (SnapStart cache on 30–32 and worker 1 disappears with them); keep core-vpc 47+48, worker-lambda 4
for v in $(seq 2 46); do aws lambda delete-function --function-name core-vpc --qualifier "$v"; done
for v in 1 2 3;       do aws lambda delete-function --function-name worker-lambda --qualifier "$v"; done
# 3. stray log group, stale secret, unattached policy
aws logs delete-log-group --log-group-name /aws/lambda/developercards-api
aws secretsmanager delete-secret --secret-id 'rds-db-credentials/cluster-Y4XJLKMCRUJBDLTD3M7RHF7OKI/postgres/1765436207646' --recovery-window-in-days 7
aws iam delete-policy --policy-arn arn:aws:iam::622994489535:policy/service-role/AWSLambdaBasicExecutionRole-a8a93ed4-36c7-46ba-88b0-02e1b1de9feb
# 4. the public bucket — ONLY after the owner's one-word OK is recorded in infra/README.md §6 (E00 §6 #15)
aws s3 rm s3://devcards-content-dev --recursive && aws s3api delete-bucket --bucket devcards-content-dev
# 5. confirm
aws rds describe-db-instances --db-instance-identifier developercards --query 'DBInstances[0].[DeletionProtection,BackupRetentionPeriod]'
aws cloudtrail get-trail-status --name developercards-management --query 'IsLogging'
aws s3api get-bucket-versioning --bucket core-vpc; aws s3api get-bucket-versioning --bucket core-vpc-premium
```
Then the second `terraform plan` must be all `no-op` before E03 starts. The verify checks nothing about this list.

## Do NOT

- Do NOT run `terraform apply`, `terraform import`, `terraform state …`, `terraform init` against the S3 backend, `aws rds create-db-snapshot` without `DRY_RUN=1`, or any of the post-apply commands — planning is the whole job.
- Do NOT rename anything, add `tags = {…}` to a resource, add `expiration`/`transition` to the content or premium lifecycle, set `versioning` on the console bucket, add a fourth log group, alarms, SNS, an RDS event subscription, an API access log (E04), a DLQ (E03), Multi-AZ, a parameter group, log exports, or `multi_az`.
- Do NOT create any root variable or output (`alert_email` and the subscriber swap are E04's — Context), touch the three `subscriber_email_addresses` lines, or edit `imports.tf`, `backend.tf`, `versions.tf`, root `variables.tf`/`outputs.tf`, `prod.auto.tfvars.example`, the lock file, `check-plan.py`, `RUNBOOK.md`, `.gitignore`, any `identity`/`edge` file, or any module `main.tf`/`outputs.tf`.
- Do NOT commit or paste plan output beyond the `Plan:` line and the checker's lines; do NOT leave `backend_override.tf`, `*.tfplan`, `*.plan.json`, `*.tfvars` (other than the `.example`) or `.terraform/terraform.tfstate` in the tree.
- Do NOT touch `devcards-content-dev` in any way (no PAB, no policy, no adoption) — its fate is the owner's OK + supervisor CLI.
- Do NOT spell the two core-vpc env-var names E00 §0 calls unspellable, and do NOT use any of the six banned terms in code, comments, commit message or PR text.
