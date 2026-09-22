# E10 — Staging environment (`staging-env`)

Stand up a second, data-isolated environment in the same account: the staging database `developercards_staging` (already created by E06's bootstrap inside the one RDS instance `developercards`), a second Terraform root `infra/envs/staging` that instantiates the `api` and `worker` modules with staging names (`developercards-api-staging`, `core-vpc-staging` / `worker-lambda-staging` behind aliases `staging`, `developercards-publish-jobs-staging` + `-dlq`) and declares at root level what the other modules cannot provide for a second environment (three scoped IAM roles, five SSM placeholders under `/developercards/staging/*`, the `developercards-content-staging` / `-premium-staging` / `-console-staging` buckets, two CloudFront distributions without WAF, the `api-staging.` / `cdn-staging.` / `console-staging.developercards.app` records in the prod-owned zone), two new app clients on the existing Cognito pools (created by the **prod** root), the committed non-secret env file `src_C/env/staging.env.json`, and the three-line `mobile/eas.json` fix that points `staging-internal-release` at an EAS channel `staging`. Migrations run on staging first: that is a procedure (E15 `staging-promotion.md`) enforced by E11's job order, not code in this issue. No C# changes, no console code, no mobile source: `infra` + one JSON + three JSON lines.

## Context

Base: `delivery/r16-e-prod` (== `main@4b07f19`, JWT verification merged). Every `file:line` below was read on that tree on 2026-09-22; every AWS fact was read the same day with `AWS_PROFILE=dev` (account `622994489535`, `ap-southeast-2`), describe/get/list only. `docs/delivery/r16-issues/E00-contracts.md` (E00) is binding: §0 non-negotiables (`:9-36`), §1.1 file map (`:43-69`), §1.2 (`:71-108`), §2.1.1 module interfaces (`:116-168`), §2.1.2 addresses (`:170-203`), §2.1.3 names (`:205-207`), §2.1.4 curation rules (`:209-211`), §2.5 (`:281-288`), §2.6 (`:290-296`), §2.8 (`:305-332`), §2.9 (`:334-349`), **§2.10 this issue** (`:351-357`), §2.11 (`:359-379`, staging schedules arrive in E12), §3.1 (`:419-430`), §3.2 (`:432-434`), §5 (`:470-482`), §6 #7, #9, #10, #11, #20 (`:492`, `:494`, `:495`, `:496`, `:505`). E10 is queued after E09 and before E12 (E00 §4 `:446-466`).

What the tree looks like today (nothing under `infra/` exists on base; E01–E09 create it):

- **EAS profiles.** `mobile/eas.json:52-65` is the `staging-internal-release` profile: `"channel": "production",` (`:54`), `"environment": "production",` (`:55`), `"EXPO_PUBLIC_ENV": "production"` (`:62`) — an internal build that receives production OTA updates and talks to production (review `docs/backend-architecture-review-2026-09-22.md:132`, `:172`). The `production` profile (`:66-79`) has the same three values and must stay. `mobile/app.json:7` is `"version": "1.6.1"`, `runtimeVersion.policy = "appVersion"` (`:51-53`), so an EAS channel is a pure server-side routing key: no binary changes.
- **What `EXPO_PUBLIC_ENV=staging` does to the app.** `mobile/src/config/appEnv.ts:4` types `AppEnv = 'development' | 'production'`; `getAppEnv()` (`:17-27`) treats any other value as "not development" and falls through to `production` in a release build. A staging build therefore behaves as a production-shaped client (`/api/v1/content/premium-url`, `:32-34`) whose API/CDN base is moved by `EXPO_PUBLIC_API_BASE` / `EXPO_PUBLIC_CONTENT_BASE_URL` in the EAS `preview` environment (E09's `hosts.ts` resolves them) and whose Cognito client comes from `EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID` — all EAS environment values, owner actions, not files.
- **Deploy script.** `src_C/deploy.sh:17` reads `VPC_FN`/`WORKER_FN` and `:44` `PUBLISH_ALIAS` from the environment; E06 rewrites the script "same CLI contract + `ENV`" (E00 §2.6.3), reading `env/${ENV}.env.json` and overlaying `/developercards/${ENV}/*` SSM values before `publish-version`. The supervisor's staging deploy is therefore `ENV=staging VPC_FN=core-vpc-staging WORKER_FN=worker-lambda-staging PUBLISH_ALIAS=staging ./deploy.sh` — E10 does not edit `deploy.sh` (E00 §1.2: "E10 creates `src_C/env/staging.env.json` only").
- **Env the code reads** (so the staging file is complete): `PGHOST`/`PGDATABASE`/`PGUSER`/`PGPASSWORD` are all required or the pool is null (`src_C/Shared/RecallSmith.Lambda.Db/Pg.cs:27-37`), `PGPORT` `:42`, `PGSSLMODE` `:45`, `PG_MAX` `:48`; `API_ENV` (`src_C/Shared/RecallSmith.Lambda.Common/Auth.cs:38`, `:41-46`: `AUTH_ALLOW_UNVERIFIED=1` is honoured only when `API_ENV` is not `production` — staging's file must never carry `AUTH_ALLOW_UNVERIFIED`); `AUTH_ISSUERS` defaults to both pools when unset (`JwtVerifier.cs:176-178`), so staging needs no issuer override; `METRICS_NAMESPACE` (`RouteMetrics.cs:42-43`; `RouteMetricsTests.cs:389,394` already exercise a `…/Staging` namespace); `CONTENT_BUCKET`/`PREMIUM_BUCKET`/`CONTENT_PREFIX`/`PREMIUM_PREFIX` (`src_C/Vpc/Runtime/PremiumDeckUrl.cs:180-184`; worker: `src_C/Worker/S3/S3DeckUploader.cs:22-23`, `ContentArtifactsGenerator.cs:25`); `PUBLISH_JOB_QUEUE_URL` (`src_C/Vpc/Authoring/Publish.cs:19`); `CORS_ORIGIN` (`Res.cs:30`); `ALLOW_DEV_PREMIUM`/`DISALLOW_SANDBOX_PREMIUM` (`VpcFunction.cs:58-59`); `RC_WEBHOOK_EXPECT_ENV_*` (`RevenuecatWebhook.cs:87-88`); `LOG_LEVEL` (`Log.cs:6`). `Migrate.cs:267` and `:304` refuse create/drop-database unless `PGDATABASE == "postgres"` — on staging (`developercards_staging`) those two admin routes answer 400 by design.
- **Console deploy** reads `CONSOLE_BUCKET` / `CONSOLE_DISTRIBUTION_ID` (`frontend/deploy.sh:9-10`) and, after E09, `CONSOLE_URL` (`:26`); Vite reads `VITE_*` from the shell ahead of `.env.production`, so a staging console needs no new `frontend/` file (supervisor step 7 below).

AWS facts (read-only CLI, 2026-09-22):

- Every staging name is free: `lambda get-function` → `ResourceNotFoundException` for `core-vpc-staging`, `worker-lambda-staging`, `developercards-edge-public-staging`; `sqs get-queue-url` → `NonExistentQueue` for `developercards-publish-jobs-staging` and `-dlq`; `s3api head-bucket` → `404` (name free, S3 names are global) for `developercards-content-staging`, `developercards-premium-staging`, `developercards-console-staging`; `iam get-role` → `NoSuchEntity` for the three `developercards-*-staging-role`; `apigatewayv2 get-apis` lists only `developercards-api` (`ktbq1sie2c`) and the newsapp API; `ssm describe-parameters --parameter-filters Key=Path,Values=/developercards/staging` → empty; no `/aws/lambda/core-vpc-staging` or `/aws/apigateway/*` log groups.
- Pools: `ap-southeast-2_4Vf8uCXKt` has one client `My SPA app - mrj1i9`; `ap-southeast-2_04hd6iisb` has one client `MobileDeveloperCards` (`7agirr7f56r9k5p6v6o63al1on`): `ExplicitAuthFlows` = `ALLOW_ADMIN_USER_PASSWORD_AUTH, ALLOW_CUSTOM_AUTH, ALLOW_REFRESH_TOKEN_AUTH, ALLOW_USER_AUTH, ALLOW_USER_PASSWORD_AUTH, ALLOW_USER_SRP_AUTH`, OAuth `code`, scopes `email openid phone`, callback `https://d84l1y8p4kdic.cloudfront.net`, access/id 60 min, refresh 5 d, `PreventUserExistenceErrors ENABLED`, token revocation on, `AuthSessionValidity 3`, no secret. The staging mobile client copies that shape (Changes 9).
- RDS `developercards`: postgres 17.9, port 5432; the `aws_db_instance` **data source** exposes `address` and `port`, so `PGHOST`/`PGPORT` for staging come from Terraform at create time and are never committed (see R4).
- **Drift against E00 §2.9 that E10 depends on:** `route53 list-hosted-zones` now returns one zone `developercards.app.` (`Z0284954BSN00C8BF94Q`, comment "HostedZone created by Route53 Registrar", 2 record sets) and `route53domains list-domains` shows `developercards.app` registered 2026-09-22 (expiry 2027-09-22, auto-renew) with its name servers already pointing at that zone. E00 §2.9.1 / §6 #7 planned a new `aws_route53_zone.main` plus an owner NS delegation; **E09 must import `Z0284954BSN00C8BF94Q` instead** (a second zone with the same name would be dead). E10 pins the zone by id (Changes 4), never by name (two zones of one name make a name lookup ambiguous). No ACM certificate exists yet in either region (`acm list-certificates` empty in Sydney and us-east-1) and `recallsmith-tfstate-622994489535` is still absent (`head-bucket` → 404): both arrive with E01/E09 before this issue starts.

What E00 decided for E10 (§2.10, `:351-357`): a second root `infra/envs/staging` with backend key `envs/staging/terraform.tfstate`; staging names of §2.1.3; `manage_cognito = false` (pool ids as strings); the two staging app clients are created by the **prod** root and their ids are pasted into `staging.auto.tfvars` by the supervisor; separate buckets, not prefixes (§6 #11); hostnames `api-staging.` / `cdn-staging.` / `console-staging.developercards.app` in the prod-owned zone using the prod wildcard certs (ARNs as root variables `cloudfront_cert_arn` / `api_cert_arn`); no WAF, no budget/alarms/dashboard on staging; `src_C/env/staging.env.json` with the exact 17 keys of §2.10.3; `mobile/eas.json` numstat `3 3` with the three exact lines (§2.10.4, §5 OTA guard); migrations-first is procedure (§2.10.5).

**Resolved against E00 (this brief records them; the driver ratifies them as E00 §6 #25–#31 before queueing E10):**

- **R1 — the staging root instantiates `api` and `worker`; the other four modules are not instantiated for staging.** E00 §0 says "both call the six modules", but `module.identity.aws_iam_role.rds_monitoring`, `.aws_iam_role.snowflake` (+ its policy and attachment), `.aws_iam_policy.core_vpc_logs` / `.core_vpc_vpc` / `.edge_public_logs` (customer-managed policies whose names are the live ARNs), `module.data.aws_db_instance.developercards`, `.aws_db_subnet_group.default_vpc`, `module.edge.aws_wafv2_web_acl.content` and `module.observability.aws_budgets_budget.monthly` are unconditional addresses in `infra/envs/prod/imports.tf` (E00 §2.1.2). Making any of them conditional adds `[0]` to the address, which `imports.tf` (never edited after E01, §1.1, §6 #20) cannot follow, and instantiating those modules unguarded for staging would create a second RDS instance, a second WAF, a second budget and IAM entities with prod names (`EntityAlreadyExists` at apply, invisible in the plan). Therefore: identity-shaped, data-shaped and edge-shaped staging resources are declared in `infra/envs/staging/main.tf`; `variable "manage_db"` and `variable "create_alarms"` (§2.10.1) are **not** added to any module; `manage_cognito` already exists and is simply unused by staging.
- **R2 — file map widening, bounded.** §1.1 lists E10 only for `identity/{variables,outputs,cognito}.tf`, `api/{variables,outputs}.tf`, `edge/{variables,outputs}.tf` and the staging root; a second environment also needs the `api` and `worker` modules to be free of prod literals. E10 may edit any `infra/modules/{api,worker}/*.tf` line **only** to (a) replace a prod literal with a variable whose default is that literal, (b) derive a name/ARN from a value the module already owns (the API's `execution_arn`, `var.core_vpc_function_name`), or (c) add a create-time `environment` block under the existing `ignore_changes`. Never `count`/`for_each`/`moved`/`removed`/`import`, never an address change; the prod plan delta must be exactly the two Cognito clients (Verify 4c enforces it). `infra/modules/edge/**`, `data/**`, `observability/**` are not touched.
- **R3 — the two staging client ids are prod outputs** (§2.10.2), so E10 appends two outputs to `infra/envs/prod/outputs.tf` although §1.1's row names only E04/E09/E13 for that file.
- **R4 — the staging functions are born with their non-secret env from Terraform.** §2.10.3 says `PGHOST`/`PGPORT` are "supervisor fills". A function created by Terraform has no env at all, and E06's overlay only adds the file's keys and the SSM secrets, so the worker function (which E06's file subset gives only `PGUSER`, `PGSSLMODE`, `PG_MAX`, `LOG_LEVEL`) would never learn `PGDATABASE`, `CONTENT_BUCKET`, `PREMIUM_BUCKET`, `PGHOST`. Decision: `modules/api` and `modules/worker` gain `variable "core_vpc_environment"` / `variable "worker_environment"` (`map(string)`, default `{}`), used in an `environment { variables = … }` block that E00 §2.1.4's `ignore_changes = [… environment …]` already covers (prod: no-op); the staging root passes `jsondecode(file("${path.root}/../../../src_C/env/staging.env.json"))` merged with `PGHOST`/`PGPORT` from `data.aws_db_instance` to **both** functions. After creation `deploy.sh`'s overlay owns the env; the JSON file stays the single committed source. Secrets never appear in `.tf` (they come from SSM at deploy).
- **R5 — staging gets a placeholder `edge-public`.** `modules/api` declares `aws_lambda_function.edge_public` (imported, unconditional) and its three routes; its source is not in the repo (E00 §6 #10). Staging therefore creates `developercards-edge-public-staging` from `infra/bootstrap/placeholder.zip` with a logs-only role `developercards-edge-public-staging-role`; `/api/v1/{ai,billing,admin/cognito}` answer 5xx on staging until the function is vendored (post-wave). Recorded in `infra/README.md` §6.
- **R6 — the zone is looked up by id.** `data "aws_route53_zone" "main" { zone_id = var.hosted_zone_id }` with default `Z0284954BSN00C8BF94Q` (the registrar-created zone the domain delegates to), not by name (§2.10.1 said `data.aws_route53_zone` without saying how).
- **R7 — the staging API also gets the adopted `dev` stage** (`module.api.aws_apigatewayv2_stage.dev` is unconditional, §6 #3). Harmless; removing `dev` from both APIs is the same post-wave chore.
- **R8 — two allow files.** E10 touches two roots, so the supervisor checks two plans: `docs/delivery/r16-issues/E10.plan-allow.json` (prod) and `E10.staging.plan-allow.json` (staging). Both are written by the worker (they are the only E10 artefacts under `docs/`), and Verify 4 checks them structurally and runs `check-plan.py` on both.
- **R9 — the API access-log group for staging is a root resource** (`/aws/apigateway/developercards-api-staging`, 30 d) passed to `module.api` under whatever variable E04 introduced for the destination ARN; no `dynamic` block is added to `gateway.tf`.

## Read first

1. `docs/delivery/r16-issues/E00-contracts.md` §0, §1.1, §1.2, §2.1.1, §2.1.3, §2.1.4, §2.5, §2.6.2–2.6.3, §2.8 (route table, authorizer variables), §2.9.1–2.9.3, **§2.10**, §2.11 (last paragraph), §3.1, §5, §6 #7, #9, #10, #11, #20.
2. The merged modules as they are on the integration branch: `infra/envs/prod/{main,variables,outputs,providers,versions,backend}.tf`, `infra/envs/prod/prod.auto.tfvars.example`, `infra/modules/api/{variables,outputs,gateway,core_vpc,edge_public}.tf`, `infra/modules/worker/{variables,outputs,queue,function}.tf`, `infra/modules/identity/{variables,outputs,cognito,policies,ssm}.tf` (copy the E05 policy statements and the E06 SSM shape), `infra/modules/edge/{cdn,dns,certs,console_bucket}.tf` and `infra/modules/data/buckets.tf` (copy the distribution / bucket-set shapes), `infra/scripts/check-plan.py` (its exact semantics decide what the allow files must list), `infra/README.md` §2–§6, `infra/.gitignore`.
3. `docs/delivery/r16-issues/E09.plan-allow.json` and `E09.verify.sh` (how the previous infra issue invoked the prod plan; start the prod allow file from it).
4. `src_C/env/prod.env.json`, `src_C/deploy.sh` (E06 version), `src_C/scripts/merge-env.sh`.
5. `mobile/eas.json` (88 lines), `mobile/src/config/appEnv.ts` (34 lines), `mobile/src/config/hosts.ts` (E09).
6. `frontend/deploy.sh:1-28`.
7. `docs/delivery/r16-issues/C05-topic-server.md` + `C05.verify.sh:1-24` (format precedent), `E10.verify.sh` (this issue's gate — read it before writing a line; every literal it greps is named under Changes required).

## Constraints

- **Scope (the ONLY files that may change):**
  1. `infra/envs/staging/versions.tf` (new)
  2. `infra/envs/staging/providers.tf` (new)
  3. `infra/envs/staging/backend.tf` (new)
  4. `infra/envs/staging/variables.tf` (new)
  5. `infra/envs/staging/staging.auto.tfvars.example` (new)
  6. `infra/envs/staging/main.tf` (new)
  7. `infra/envs/staging/outputs.tf` (new)
  8. `infra/envs/staging/.terraform.lock.hcl` (new; byte-identical copy of `infra/envs/prod/.terraform.lock.hcl`)
  9. `infra/modules/identity/cognito.tf` (add two resources) and `infra/modules/identity/outputs.tf` (append two outputs)
  10. `infra/envs/prod/outputs.tf` (append two outputs); `infra/envs/prod/main.tf` only if a new module variable needs prod wiring (normally nothing)
  11. `infra/modules/api/variables.tf`, `infra/modules/api/outputs.tf` (append), plus `core_vpc.tf` / `gateway.tf` / `edge_public.tf` lines under rule R2 only
  12. `infra/modules/worker/variables.tf` (append), plus `queue.tf` / `function.tf` lines under rule R2 only
  13. `src_C/env/staging.env.json` (new)
  14. `mobile/eas.json` (exactly three lines, §2.10.4)
  15. `infra/README.md` (§6: one dated line)
  16. `docs/delivery/r16-issues/E10.plan-allow.json`, `docs/delivery/r16-issues/E10.staging.plan-allow.json` (new)
  Nothing else: no `infra/envs/prod/{imports,backend,versions,providers,variables}.tf`, no `prod.auto.tfvars.example`, no `infra/envs/prod/.terraform.lock.hcl`, no `infra/modules/{data,edge,observability}/**`, no `infra/modules/identity/{main,policies,ssm}.tf`, no `src_C/**/*.cs`, no `src_C/deploy.sh`, no `src_C/env/prod.env.json`, no `frontend/`, no `mobile/src`, no `mobile/tests`, no `.github/`, no `scripts/`, no top-level `docs/*.md`, no `snowflake/`.
- **WORKER SAFETY RULE (verbatim, E00 §0):** a worker may run read-only AWS CLI, `terraform init/validate/plan` (plan must be saved with -out and shown as JSON), but NEVER `terraform apply`, `terraform import` (state-changing), `aws ... create/update/delete/put`, `eas`, or any deploy script. The supervisor applies plans after each merge. Each infra brief's verify.sh therefore checks the PLAN (terraform show -json) against an explicit allow-list of resource addresses and actions — nothing else may appear as create/update/delete.
  Clarifications (E00 §0): `import {}` blocks are configuration and allowed in prod's `imports.tf` (untouched here); the staging root has none. `aws sts get-caller-identity`, `aws iam simulate-custom-policy`, `aws ssm describe-parameters`, `describe/get/list/head` are allowed. `aws lambda invoke`, `aws ssm get-parameter --with-decryption`, `eas channel:create`, `eas update`, `./deploy.sh` without `DRY_RUN=1`, `frontend/deploy.sh` are supervisor/owner only. `terraform init -backend=false -input=false` serves `validate` only; every plan of this issue (prod at HEAD, prod at the merge-base, staging) runs against an **empty local state** through E01's gitignored `backend_override.tf` (gap 13; `terraform init -input=false -reconfigure`, then `plan -out`; the verify writes and removes the overrides itself — E00 §6 #25 mode a); never `terraform init` with the real S3 backend; never create `staging.auto.tfvars` (the real file) — only the `.example`.
- **Module-edit rules (R2):** in `infra/modules/{api,worker}/**` an added or changed line may only (a) turn a prod literal into `var.<name>` whose `default` is that literal, (b) derive a value from something the module owns (`aws_apigatewayv2_api.http.execution_arn`, `var.core_vpc_function_name`, `var.function_name`), or (c) add `environment { variables = var.core_vpc_environment }` / `var.worker_environment`. No `count =`, `for_each =`, `moved {`, `removed {`, `import {`, `provisioner`, `null_resource`, `local-exec`, `external`, `archive_file`, `terraform_remote_state` anywhere in the diff, except the two `count = var.manage_cognito ? 1 : 0` lines of Changes 9. Prod addresses never change; the prod plan delta is exactly the two client creates and the two outputs (Verify 4c).
- **Frozen files (E00 §0) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`.
- **OTA rule:** `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json` byte-identical; `"version": "1.6.1"` stays; no `@sentry` under `mobile/src`; `mobile/eas.json` diff is numstat `3	3` and the three added lines are exactly `"channel": "staging",`, `"environment": "preview",`, `"EXPO_PUBLIC_ENV": "staging"` (stripped), the removed lines the three `production` values at `:54`, `:55`, `:62`; every other profile, `cli`, `submit` byte-identical.
- **Secrets:** never a value in `.tf`, `.tfvars`, `.json`, `.md` or output. The staging env file carries no `PGPASSWORD`, `MIGRATE_SECRET`, `INTERNAL_SHARED_SECRET`, `RC_WEBHOOK_AUTH_*`, `ANALYTICS_USER_SALT`, `PGHOST`, `PGPORT`, `AUTH_ALLOW_UNVERIFIED`. SSM placeholders are the literal `PLACEHOLDER-set-by-supervisor` with `ignore_changes = [value]`. Plan JSON is never committed, pasted or printed beyond address/actions/changed keys (the prod plan holds prod env values in clear). Every plan artefact lives in a `mktemp` dir removed by `trap`.
- **Banned literals in any added line** (driver gate, case-insensitive): the six terms of B00 §0 — do not reproduce them, not in a comment, not in a variable description; the two unspellable core-vpc env names are never written (E00 §0). No `@ts-ignore`/`@ts-expect-error`/`eslint-disable`/`.skip(`/`.only(`/`#pragma warning disable`/`Skip =` anywhere in the diff.
- **Tests:** no test file changes in any root (`src_C/Tests`, `frontend/tests`, `mobile/tests` zero-diff). The `src_C` root gate (`dotnet test Tests/RecallSmith.Lambda.IntegrationTests`, Docker) and the `mobile` gate (`npm run test:typecheck && npx vitest run`, because `mobile/eas.json` changes) are run by the driver and must stay green — nothing here can move them.
- **Terraform:** 1.16.3, `hashicorp/aws ~> 6.0` resolved by the committed lock file (6.66.0); never `terraform init -upgrade`; `TF_PLUGIN_CACHE_DIR="$HOME/.terraform.d/plugin-cache"`; provider blocks carry `region` only (no `profile`); `terraform fmt -recursive infra` before every commit.
- **No renames** (E00 §0): every prod name/id stays; staging names are exactly those of §2.1.3 plus the three of R5/R9 (`developercards-edge-public-staging`, `developercards-edge-public-staging-role`, `/aws/apigateway/developercards-api-staging`).
- Standing rules: no `git push`, no PR, never touch `main`, no `npm install`, no `dotnet restore` by hand, no `eas`, no `expo`, never run git inside `/Users/qc/src/recallsmith` (only in your worktree).

## Changes required

1. **`infra/envs/staging/versions.tf` (new)** — identical to prod's, fmt-aligned, no `backend` block here (backend is file 3):
   ```hcl
   terraform {
     required_version = ">= 1.10"
     required_providers {
       aws = {
         source  = "hashicorp/aws"
         version = "~> 6.0"
       }
     }
   }
   ```

2. **`infra/envs/staging/providers.tf` (new)** — two providers, both with E02's default tags, no `profile`:
   ```hcl
   provider "aws" {
     region = "ap-southeast-2"
     default_tags {
       tags = {
         Project   = "DeveloperCards"
         Env       = "staging"
         ManagedBy = "terraform"
       }
     }
   }

   provider "aws" {
     alias  = "use1"
     region = "us-east-1"
     default_tags {
       tags = {
         Project   = "DeveloperCards"
         Env       = "staging"
         ManagedBy = "terraform"
       }
     }
   }
   ```
   `use1` is required by E00 §0 in every root even though staging creates nothing in us-east-1 (certs are passed in).

3. **`infra/envs/staging/backend.tf` (new)** — E00 §0's block with the staging key, byte for byte:
   ```hcl
   terraform {
     backend "s3" {
       bucket       = "recallsmith-tfstate-622994489535"
       key          = "envs/staging/terraform.tfstate"
       region       = "ap-southeast-2"
       encrypt      = true
       use_lockfile = true
     }
   }
   ```
   No `dynamodb_table` (S3-native lock), no `envs/prod/` key.

4. **`infra/envs/staging/variables.tf` (new)** — exactly these variables (all `type = string` unless noted; descriptions one line, no secrets):
   - no default (pasted by the supervisor into `staging.auto.tfvars`): `console_staging_client_id`, `mobile_staging_client_id`, `cloudfront_cert_arn` (the prod wildcard cert in us-east-1, prod output `cloudfront_cert_arn`), `api_cert_arn` (the regional one, prod output `api_cert_arn`);
   - with defaults: `region = "ap-southeast-2"`, `account_id = "622994489535"`, `domain = "developercards.app"`, `hosted_zone_id = "Z0284954BSN00C8BF94Q"` (R6), `db_identifier = "developercards"`, `console_pool_id = "ap-southeast-2_4Vf8uCXKt"`, `mobile_pool_id = "ap-southeast-2_04hd6iisb"`, `vpc_id = "vpc-04af44dd8f5f48717"`, `subnet_ids` (`list(string)`, `["subnet-0cc7a99faf631cee2", "subnet-0dd0ac42e1bb9648a", "subnet-0a365ac32e28958ed"]`), `lambda_security_group_ids` (`list(string)`, `["sg-00ad6c62d292a475e", "sg-04af3c6fa45f10113"]` — core-vpc's pair), `worker_security_group_ids` (`list(string)`, `["sg-00ad6c62d292a475e", "sg-04af3c6fa45f10113", "sg-0d2541aec08b1a215", "sg-0fbc6607e6473cbd3"]` — worker-lambda's four), `cors_allowed_origins` (`list(string)`, `["https://console-staging.developercards.app", "http://localhost:5173"]`).
   No `sensitive` variable, no `variable "env"` (the root is staging by construction), no `alert_email`, no `snowflake_external_id`, no `snowpipe_sqs_arn`.

5. **`infra/envs/staging/staging.auto.tfvars.example` (new)** — the four pasted values with visible placeholders (the real `staging.auto.tfvars` is gitignored by E01's `infra/.gitignore` and written by the supervisor after the prod apply):
   ```hcl
   console_staging_client_id = "replace-with-prod-output-console_staging_client_id"
   mobile_staging_client_id  = "replace-with-prod-output-mobile_staging_client_id"
   cloudfront_cert_arn       = "arn:aws:acm:us-east-1:622994489535:certificate/00000000-0000-0000-0000-000000000000"
   api_cert_arn              = "arn:aws:acm:ap-southeast-2:622994489535:certificate/00000000-0000-0000-0000-000000000000"
   ```
   The verify plans with `-var-file=staging.auto.tfvars.example`; placeholders are only validated at apply.

6. **`infra/envs/staging/main.tf` (new)** — in this order, one file (E00 §1.1 names six root files; no `buckets.tf`/`cdn.tf` split). Every name below is a literal in `locals`, not a variable:
   a. **Locals + data sources.**
      ```hcl
      locals {
        api_name                  = "developercards-api-staging"
        core_vpc_function_name    = "core-vpc-staging"
        worker_function_name      = "worker-lambda-staging"
        edge_public_function_name = "developercards-edge-public-staging"
        alias_name                = "staging"
        publish_queue_name        = "developercards-publish-jobs-staging"
        publish_dlq_name          = "developercards-publish-jobs-staging-dlq"
        content_bucket_name       = "developercards-content-staging"
        premium_bucket_name       = "developercards-premium-staging"
        console_bucket_name       = "developercards-console-staging"
        core_vpc_role_name        = "developercards-core-vpc-staging-role"
        worker_role_name          = "developercards-worker-lambda-staging-role"
        edge_public_role_name     = "developercards-edge-public-staging-role"
        api_hostname              = "api-staging.${var.domain}"
        cdn_hostname              = "cdn-staging.${var.domain}"
        console_hostname          = "console-staging.${var.domain}"
        secret_parameter_names    = ["pg-password", "migrate-secret", "internal-shared-secret", "rc-webhook-auth-production", "rc-webhook-auth-development"]
        content_bucket_arn        = "arn:aws:s3:::${local.content_bucket_name}"
        premium_bucket_arn        = "arn:aws:s3:::${local.premium_bucket_name}"
        publish_queue_arn         = "arn:aws:sqs:${var.region}:${var.account_id}:${local.publish_queue_name}"
        core_vpc_log_group_arn    = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${local.core_vpc_function_name}:*"
        worker_log_group_arn      = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${local.worker_function_name}:*"
        edge_public_log_group_arn = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${local.edge_public_function_name}:*"
        staging_env = merge(
          jsondecode(file("${path.root}/../../../src_C/env/staging.env.json")),
          {
            PGHOST = data.aws_db_instance.developercards.address
            PGPORT = tostring(data.aws_db_instance.developercards.port)
          }
        )
      }

      data "aws_db_instance" "developercards" {
        db_instance_identifier = var.db_identifier
      }

      data "aws_route53_zone" "main" {
        zone_id = var.hosted_zone_id
      }
      ```
      ARNs are built from strings on purpose: the three policy documents are then fully known at plan time and the verify can simulate them (E00 §3.2). No `data "aws_vpc"`, no `data "aws_cognito_*"`, no `terraform_remote_state`.
   b. **IAM (identity-shaped, R1).** One `data "aws_iam_policy_document" "lambda_trust"` (`sts:AssumeRole` for service principal `lambda.amazonaws.com`); three roles — headers verbatim `resource "aws_iam_role" "core_vpc"`, `resource "aws_iam_role" "worker"`, `resource "aws_iam_role" "edge_public"` — (`name = local.*_role_name`, `assume_role_policy = data.aws_iam_policy_document.lambda_trust.json`, no managed-policy attachments, no `aws_iam_policy` / `aws_iam_role_policy_attachment` anywhere in the root); three inline policies — headers verbatim `resource "aws_iam_role_policy" "core_vpc"`, `resource "aws_iam_role_policy" "worker"`, `resource "aws_iam_role_policy" "edge_public"` — with E05's statement shapes (`policy = jsonencode({ Version = "2012-10-17", Statement = [...] })`, each statement `Sid = "<name>"`, Sids fixed):
      - `core_vpc` — `Sid = "S3Content"` (`s3:GetObject`, `s3:PutObject` on `${local.content_bucket_arn}/content/*` and `${local.content_bucket_arn}/analytics/*`), `Sid = "S3Premium"` (`s3:GetObject` on `${local.premium_bucket_arn}/*`), `Sid = "S3Head"` (`s3:ListBucket` on both bucket ARNs), `Sid = "SqsSend"` (`sqs:SendMessage`, `sqs:GetQueueAttributes` on `local.publish_queue_arn`), `Sid = "Logs"` (`logs:CreateLogStream`, `logs:PutLogEvents` on `local.core_vpc_log_group_arn`), `Sid = "Eni"` (`ec2:CreateNetworkInterface`, `ec2:DescribeNetworkInterfaces`, `ec2:DeleteNetworkInterface` on `"*"` — the only `Resource = "*"`).
      - `worker` — `Sid = "S3Builds"` (`s3:PutObject`, `s3:GetObject` on `${content}/content/*` and `${premium}/*`), `"S3Head"`, `Sid = "SqsConsume"` (`sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:GetQueueAttributes`, `sqs:ChangeMessageVisibility` on `local.publish_queue_arn`), `"Logs"` (on `local.worker_log_group_arn`), `"Eni"`.
      - `edge_public` — `"Logs"` only (on `local.edge_public_log_group_arn`); no `cognito-idp:*` (R5: placeholder function).
      No SSM permission on any role (E00 §6 #8). E13 does NOT touch this file (its scope excludes `infra/envs/staging/**`): staging has no analytics bucket, `staging.env.json` sets no `ANALYTICS_S3_BUCKET`, so the outbox falls back to `CONTENT_BUCKET` + `analytics/*` (`OutboxPublisher.cs:41-45`), which this policy allows; a staging analytics bucket is post-wave.
   c. **SSM placeholders (E06 shape).** `resource "aws_ssm_parameter" "secret" { for_each = toset(local.secret_parameter_names) name = "/developercards/staging/${each.key}" type = "SecureString" tier = "Standard" value = "PLACEHOLDER-set-by-supervisor" lifecycle { ignore_changes = [value] } }` (addresses `aws_ssm_parameter.secret["pg-password"]` … ×5; AWS-managed `alias/aws/ssm`, no `key_id`).
   d. **Buckets (data/edge-shaped).** For each of `content`, `premium`, `console`: `aws_s3_bucket.<x>` (`bucket = local.<x>_bucket_name`, no `force_destroy`, no `prevent_destroy`), `aws_s3_bucket_public_access_block.<x>` (all four `true`), `aws_s3_bucket_ownership_controls.<x>` (`BucketOwnerEnforced`), `aws_s3_bucket_server_side_encryption_configuration.<x>` (`AES256`, `bucket_key_enabled = true`). For `content` and `premium` additionally `aws_s3_bucket_versioning.<x>` (`status = "Enabled"`) and `aws_s3_bucket_lifecycle_configuration.<x>` with one rule `id = "noncurrent-90d"`, `status = "Enabled"`, `filter {}`, `noncurrent_version_expiration { noncurrent_days = 90 }`, `abort_incomplete_multipart_upload { days_after_initiation = 7 }` (E02 parity). No versioning resource on `console` (a new bucket has nothing to import as `Disabled`). Policies (headers verbatim `resource "aws_s3_bucket_policy" "content"`, `resource "aws_s3_bucket_policy" "console"`): `aws_s3_bucket_policy.content` — one statement `AllowCloudFrontOAC`: principal service `cloudfront.amazonaws.com`, `s3:GetObject` on `${local.content_bucket_arn}/content/*`, condition `StringEquals aws:SourceArn = aws_cloudfront_distribution.content.arn`; `aws_s3_bucket_policy.console` — the same for `${arn}/*` and the console distribution. No policy on `premium` (presigned URLs only, prod parity). Both policies `depends_on` their public-access block.
   e. **CloudFront (edge-shaped, no WAF).** `aws_cloudfront_origin_access_control.content` (`name = "developercards-content-staging-oac"`, `origin_access_control_origin_type = "s3"`, `signing_behavior = "always"`, `signing_protocol = "sigv4"`, `description = ""`) and `.console` (`name = "developercards-console-staging-oac"`). `resource "aws_cloudfront_distribution" "content"`: `enabled = true`, `is_ipv6_enabled = true`, `comment = "DeveloperCards content (staging)"`, `http_version = "http2"`, `price_class = "PriceClass_All"`, `aliases = [local.cdn_hostname]`, one `origin` (`domain_name = aws_s3_bucket.content.bucket_regional_domain_name`, `origin_id = "content-s3"`, `origin_access_control_id`), `default_cache_behavior` (`allowed_methods = ["GET", "HEAD"]`, `cached_methods = ["GET", "HEAD"]`, `target_origin_id = "content-s3"`, `viewer_protocol_policy = "redirect-to-https"`, `compress = true`, `cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"`), `restrictions { geo_restriction { restriction_type = "none" } }`, `viewer_certificate { acm_certificate_arn = var.cloudfront_cert_arn ssl_support_method = "sni-only" minimum_protocol_version = "TLSv1.2_2021" }`; **no** `web_acl_id`. `resource "aws_cloudfront_distribution" "console"`: same skeleton with `comment = "DeveloperCards console (staging)"`, `http_version = "http2and3"`, `aliases = [local.console_hostname]`, `origin_id = "console-s3"`, `default_root_object = "index.html"`, `response_headers_policy_id = "67f7725c-6f97-4210-82d7-5512b31e9d03"` on the default behaviour, two `custom_error_response` blocks (`error_code` 403 and 404 → `response_code = 200`, `response_page_path = "/index.html"`, `error_caching_min_ttl = 10`).
   f. **API access log group (R9).** `resource "aws_cloudwatch_log_group" "api_access" { name = "/aws/apigateway/developercards-api-staging" retention_in_days = 30 }`.
   g. **`module "api"`** — `source = "../../modules/api"`, `providers` only if the merged module declares `aws.use1`; arguments: `env = "staging"`, `api_name = local.api_name`, `core_vpc_function_name = local.core_vpc_function_name`, `core_vpc_alias_name = local.alias_name`, `core_vpc_role_arn = aws_iam_role.core_vpc.arn`, `edge_public_function_name = local.edge_public_function_name`, `edge_public_role_arn = aws_iam_role.edge_public.arn`, `subnet_ids = var.subnet_ids`, `security_group_ids = var.lambda_security_group_ids`, `console_pool_endpoint = "cognito-idp.${var.region}.amazonaws.com/${var.console_pool_id}"`, `console_client_id = var.console_staging_client_id`, the E08 pair `mobile_pool_endpoint = "cognito-idp.${var.region}.amazonaws.com/${var.mobile_pool_id}"` / `mobile_client_id = var.mobile_staging_client_id`, `cors_allowed_origins = var.cors_allowed_origins`, E04's access-log destination = `aws_cloudwatch_log_group.api_access.arn`, E09's `domain = var.domain` and `api_cert_arn = var.api_cert_arn`, `api_host_prefix = "api-staging"` (Changes 11), `core_vpc_environment = local.staging_env` (Changes 11), `tags = {}` if the module has it. Pass every other variable the merged module declares without a default with its staging value; never pass a prod id.
   h. **`module "worker"`** — `source = "../../modules/worker"`; `env = "staging"`, `queue_name = local.publish_queue_name`, `dlq_name = local.publish_dlq_name` (Changes 12; or the module's existing DLQ-name variable), `function_name = local.worker_function_name`, `alias_name = local.alias_name`, `role_arn = aws_iam_role.worker.arn`, `subnet_ids = var.subnet_ids`, `security_group_ids = var.worker_security_group_ids`, `worker_environment = local.staging_env` (Changes 12).
   i. **DNS in the prod-owned zone.** Three resources — headers verbatim `resource "aws_route53_record" "cdn"`, `resource "aws_route53_record" "console"`, `resource "aws_route53_record" "api"` — each `for_each = toset(["A", "AAAA"])`, `zone_id = data.aws_route53_zone.main.zone_id`, `type = each.key`, `alias { evaluate_target_health = false … }`: `aws_route53_record.cdn` (`name = local.cdn_hostname`, alias → `aws_cloudfront_distribution.content.domain_name` / `.hosted_zone_id`), `aws_route53_record.console` (`local.console_hostname` → the console distribution), `aws_route53_record.api` (`local.api_hostname` → `module.api.api_domain_target_domain_name` / `module.api.api_domain_hosted_zone_id`, Changes 11). Addresses: `aws_route53_record.cdn["A"]`, `aws_route53_record.cdn["AAAA"]`, and likewise `console`, `api`.
   j. **Forbidden in this file:** `resource "aws_db_instance"`, `resource "aws_route53_zone"`, `resource "aws_acm_certificate"`, `aws_wafv2`, `web_acl_id`, `aws_budgets_budget`, `aws_cloudwatch_metric_alarm`, `aws_sns_topic`, `aws_cloudtrail`, `aws_cognito_user_pool`, `aws_cognito_user_pool_client`, `aws_iam_openid_connect_provider`, `aws_iam_policy"` (customer-managed policies), `aws_iam_role_policy_attachment`, `PGPASSWORD`, `AUTH_ALLOW_UNVERIFIED`, `modules/identity`, `modules/data`, `modules/edge`, `modules/observability`, `moved {`, `removed {`, `import {`, `provisioner`, `null_resource`, `local-exec`, `archive_file`, `terraform_remote_state`, any prod id or name (`ktbq1sie2c`, `E28BKORJLV6UXG`, `E85FKUMZZWQWX`, `core-vpc-premium`, `recallsmith-publish-jobs`, `6lkofepp2llp6v4nueg52mcm5v`, `7agirr7f56r9k5p6v6o63al1on`, `/developercards/prod/`).

7. **`infra/envs/staging/outputs.tf` (new)** — exactly these fourteen outputs, no `sensitive`: `api_id` (`module.api.api_id`), `api_endpoint`, `api_hostname` (`local.api_hostname`), `cdn_hostname`, `console_hostname`, `content_distribution_id` (`aws_cloudfront_distribution.content.id`), `console_distribution_id`, `content_bucket_name`, `premium_bucket_name`, `console_bucket_name`, `publish_queue_url` (`module.worker.queue_url`), `core_vpc_alias_arn` (`module.api.core_vpc_alias_arn`), `worker_alias_arn` (`module.worker.alias_arn`), `core_vpc_role_arn` (`aws_iam_role.core_vpc.arn`).

8. **`infra/envs/staging/.terraform.lock.hcl` (new)** — `cp infra/envs/prod/.terraform.lock.hcl infra/envs/staging/` (the same single provider at the same version; `terraform init -backend=false` in the staging root must not rewrite it — if it does, the copy was wrong).

9. **`infra/modules/identity/cognito.tf` + `outputs.tf`** — two new clients created by the prod root (E00 §2.10.2), guarded exactly like the pools:
   ```hcl
   resource "aws_cognito_user_pool_client" "console_staging" {
     count                                = var.manage_cognito ? 1 : 0
     name                                 = "console-staging"
     user_pool_id                         = aws_cognito_user_pool.console[0].id
     generate_secret                      = false
     allowed_oauth_flows                  = ["code"]
     allowed_oauth_flows_user_pool_client = true
     allowed_oauth_scopes                 = ["email", "openid", "profile"]
     supported_identity_providers         = ["COGNITO"]
     callback_urls                        = ["https://console-staging.developercards.app/auth/callback"]
     logout_urls                          = ["https://console-staging.developercards.app/"]
     access_token_validity                = 1
     id_token_validity                    = 1
     refresh_token_validity               = 30
     auth_session_validity                = 3
     prevent_user_existence_errors        = "ENABLED"
     enable_token_revocation              = true
     token_validity_units {
       access_token  = "hours"
       id_token      = "hours"
       refresh_token = "days"
     }
   }

   resource "aws_cognito_user_pool_client" "mobile_staging" {
     count                                = var.manage_cognito ? 1 : 0
     name                                 = "MobileDeveloperCards-staging"
     user_pool_id                         = aws_cognito_user_pool.mobile[0].id
     generate_secret                      = false
     explicit_auth_flows                  = ["ALLOW_ADMIN_USER_PASSWORD_AUTH", "ALLOW_CUSTOM_AUTH", "ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_AUTH", "ALLOW_USER_PASSWORD_AUTH", "ALLOW_USER_SRP_AUTH"]
     allowed_oauth_flows                  = ["code"]
     allowed_oauth_flows_user_pool_client = true
     allowed_oauth_scopes                 = ["email", "openid", "phone"]
     supported_identity_providers         = ["COGNITO"]
     callback_urls                        = ["https://d84l1y8p4kdic.cloudfront.net"]
     access_token_validity                = 60
     id_token_validity                    = 60
     refresh_token_validity               = 5
     auth_session_validity                = 3
     prevent_user_existence_errors        = "ENABLED"
     enable_token_revocation              = true
     token_validity_units {
       access_token  = "minutes"
       id_token      = "minutes"
       refresh_token = "days"
     }
   }
   ```
   (`mobile_staging` mirrors the live `MobileDeveloperCards` client — same six explicit flows, same scopes, same hosted-UI callback, 60-minute access token; `console_staging` mirrors E08's `spa` validity with the single staging callback.) `outputs.tf` appends `output "console_staging_client_id" { value = one(aws_cognito_user_pool_client.console_staging[*].id) }` and `output "mobile_staging_client_id" { value = one(aws_cognito_user_pool_client.mobile_staging[*].id) }` (`one()` yields `null` under `manage_cognito = false`). Nothing else in `cognito.tf` moves; `variables.tf` needs no new variable.

10. **`infra/envs/prod/outputs.tf`** — append `output "console_staging_client_id" { value = module.identity.console_staging_client_id }` and `output "mobile_staging_client_id" { value = module.identity.mobile_staging_client_id }`. `infra/envs/prod/main.tf` changes only if a variable added in 11–12 has no default (it must have one, so normally no change).

11. **`infra/modules/api`** (rule R2):
    - `variables.tf` appends `variable "core_vpc_environment" { type = map(string), default = {} }` (description: create-time non-secret env; ignored after creation) and, if the E09 domain name is built as `"api.${var.domain}"`, `variable "api_host_prefix" { type = string, default = "api" }` with `domain_name = "${var.api_host_prefix}.${var.domain}"` in `gateway.tf` (if E09 already exposes a full-hostname variable, use it and skip this one).
    - `core_vpc.tf`: `aws_lambda_function.core_vpc` gains `environment { variables = var.core_vpc_environment }` (already inside `ignore_changes`, E00 §2.1.4); `aws_lambda_alias.core_vpc_prod.function_version` must be a creatable value — `"$LATEST"` (under `ignore_changes = [function_version]`, so prod stays no-op; a numeric literal would make the staging create fail). Any `source_arn`, log-group name or ARN that spells `ktbq1sie2c`, `core-vpc` or `edge-public` as a literal is rewritten to derive from `aws_apigatewayv2_api.http.execution_arn` / `var.core_vpc_function_name` / `var.edge_public_function_name` (same prod value, no plan change). Permission SIDs (`for_each` keys) stay as they are.
    - `outputs.tf` appends `output "api_domain_target_domain_name"` (`aws_apigatewayv2_domain_name.api.domain_name_configuration[0].target_domain_name`) and `output "api_domain_hosted_zone_id"` (`…[0].hosted_zone_id`) unless E09 already exports both under these names.
12. **`infra/modules/worker`** (rule R2): `variables.tf` appends `variable "worker_environment" { type = map(string), default = {} }` and, if E03 hard-coded the DLQ name, `variable "dlq_name" { type = string, default = "developercards-publish-jobs-dlq" }` used by `aws_sqs_queue.publish_jobs_dlq.name`; `function.tf`: `aws_lambda_function.worker` gains `environment { variables = var.worker_environment }`; `aws_lambda_alias.worker_prod.function_version = "$LATEST"` (same reasoning as 11); log-group name derived from `var.function_name`.

13. **`src_C/env/staging.env.json` (new)** — exactly E00 §2.10.3's 17 keys and values, pretty-printed one key per line, sorted as listed, trailing newline:
    ```json
    {
      "PGDATABASE": "developercards_staging",
      "PGUSER": "developercards_app_staging",
      "API_ENV": "staging",
      "LOG_LEVEL": "debug",
      "PG_MAX": "1",
      "PGSSLMODE": "require",
      "METRICS_NAMESPACE": "DeveloperCards/Staging",
      "CONTENT_BUCKET": "developercards-content-staging",
      "CONTENT_PREFIX": "content",
      "PREMIUM_BUCKET": "developercards-premium-staging",
      "PREMIUM_PREFIX": "premium",
      "PUBLISH_JOB_QUEUE_URL": "https://sqs.ap-southeast-2.amazonaws.com/622994489535/developercards-publish-jobs-staging",
      "CORS_ORIGIN": "https://console-staging.developercards.app,http://localhost:5173",
      "ALLOW_DEV_PREMIUM": "0",
      "DISALLOW_SANDBOX_PREMIUM": "0",
      "RC_WEBHOOK_EXPECT_ENV_DEVELOPMENT": "SANDBOX",
      "RC_WEBHOOK_EXPECT_ENV_PRODUCTION": "PRODUCTION"
    }
    ```
    No `PGHOST`/`PGPORT` (Terraform, R4), no secret names (`PGPASSWORD`, `MIGRATE_SECRET`, `INTERNAL_SHARED_SECRET`, `RC_WEBHOOK_AUTH`, `ANALYTICS_USER_SALT`), no `AUTH_ALLOW_UNVERIFIED`, no `MANIFEST_QUEUE_URL`.

14. **`mobile/eas.json`** — in the `staging-internal-release` profile only: `:54` `"channel": "production",` → `"channel": "staging",`; `:55` `"environment": "production",` → `"environment": "preview",`; `:62` `"EXPO_PUBLIC_ENV": "production"` → `"EXPO_PUBLIC_ENV": "staging"`. `git diff --numstat` is `3	3`; `production` (`:66-79`), `staging` (`:38-51`), both `development*` profiles, `cli` and `submit.production.ios.ascAppId = "6756044885"` are byte-identical. The EAS channel `staging` and the `preview` environment values (`EXPO_PUBLIC_API_BASE=https://api-staging.developercards.app`, `EXPO_PUBLIC_CONTENT_BASE_URL=https://cdn-staging.developercards.app`, `EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=<MobileDeveloperCards-staging id>`) are owner actions listed under "Supervisor / owner after merge".

15. **`infra/README.md`** — append one dated line to §6 (change log) naming `E10`, the staging root, the two client outputs to paste, the edge-public placeholder (R5) and the `dev` stage (R7); write "the supervisor applies" — the line must not contain the two-word apply command or an `aws … create|update|delete|put` phrase (Verify 5f greps every added line outside comments).

16. **Allow files (R8).** `docs/delivery/r16-issues/E10.plan-allow.json` (prod root): `"tags_only_updates": false`, `"outputs"` containing `"console_staging_client_id"` and `"mobile_staging_client_id"`, `"changes"` containing `"module.identity.aws_cognito_user_pool_client.console_staging[0]": "create"` and `"module.identity.aws_cognito_user_pool_client.mobile_staging[0]": "create"`, plus whatever `infra/scripts/check-plan.py` requires for the entries a worker's empty-state prod plan shows (start from `E09.plan-allow.json`; E00 §3.1 says the same file serves the supervisor's remote-state plan because listed addresses only have to be present). `docs/delivery/r16-issues/E10.staging.plan-allow.json` (staging root): every address the staging plan creates, each `"create"`, and `"outputs"` = the fourteen names of Changes 7 — nothing else. Both must pass `python3 infra/scripts/check-plan.py --plan … --allow …` in Verify 4.

**Supervisor / owner after merge (never the worker; recorded here so the verify's "plan only" is understood):** (1) prod root: `terraform init` with the real backend → `plan -out` → `check-plan.py --allow E10.plan-allow.json` → apply → `terraform output console_staging_client_id mobile_staging_client_id cloudfront_cert_arn api_cert_arn` (the certs must be `ISSUED`; E09 imports the registrar zone so validation completes without an owner step); (2) write `infra/envs/staging/staging.auto.tfvars` (gitignored) from those four values; (3) staging root: `init` (key `envs/staging/terraform.tfstate`) → `plan -out` → `check-plan.py --allow E10.staging.plan-allow.json` → apply; (4) `aws ssm put-parameter --overwrite` the five `/developercards/staging/*` values (`pg-password` is `developercards_app_staging`'s password from the E06 bootstrap; the other four are staging-specific new values); (5) `ENV=staging VPC_FN=core-vpc-staging WORKER_FN=worker-lambda-staging PUBLISH_ALIAS=staging ./src_C/deploy.sh`; (6) migrate staging: `MIGRATE_SECRET=… scripts/invoke-as-admin.sh core-vpc-staging:staging POST /api/v1/admin/db/migrate` (E12 later replaces this with the internal `db/migrate` action); (7) console: `CONSOLE_BUCKET=developercards-console-staging CONSOLE_DISTRIBUTION_ID=<staging output> CONSOLE_URL=https://console-staging.developercards.app VITE_API_BASE=https://api-staging.developercards.app VITE_COGNITO_CLIENT_ID=<console-staging id> VITE_COGNITO_REDIRECT_URI=https://console-staging.developercards.app/auth/callback VITE_COGNITO_LOGOUT_URI=https://console-staging.developercards.app/ frontend/deploy.sh`; (8) owner: `eas channel:create staging` and the `preview` environment values of Changes 14; (9) a second plan in **both** roots must be empty; (10) paste the two client ids into `infra/README.md` §6.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/E10.verify.sh` re-runs exactly these.

1. Scope files exist (exit 0): the seven staging root files + `.terraform.lock.hcl`, `src_C/env/staging.env.json`, `E10.plan-allow.json`, `E10.staging.plan-allow.json`; prerequisites on the integration branch: `infra/envs/prod/main.tf`, `infra/scripts/check-plan.py`, `infra/modules/edge/dns.tf` and `certs.tf` (E09), `src_C/env/prod.env.json` (E06), `src_C/deploy.sh` reading `env/${ENV}.env.json`, `cognito-jwt-mobile` in `infra/modules/api/gateway.tf` (E08).
2. Literal guards (exit 0): `backend.tf` holds the five backend lines of Changes 3; `versions.tf` the version pins; `providers.tf` the two regions, `alias  = "use1"`, `Env       = "staging"`, no `profile`; `variables.tf` the sixteen variable names (four without default, twelve with the defaults of Changes 4) (`Z0284954BSN00C8BF94Q`, `developercards.app`, the pool ids, the subnet/SG ids); the `.example` holds the four keys; `main.tf` holds every staging name and hostname of Changes 6a, `data "aws_db_instance" "developercards"`, `data "aws_route53_zone" "main"`, `zone_id = var.hosted_zone_id`, `src_C/env/staging.env.json`, `/developercards/staging/`, `PLACEHOLDER-set-by-supervisor`, `ignore_changes = [value]`, the eight Sids, `658327ea-f89d-4fab-a63d-7e88639e58f6`, `67f7725c-6f97-4210-82d7-5512b31e9d03`, `TLSv1.2_2021`, `sni-only`, `noncurrent-90d`, `evaluate_target_health = false`, `"../../modules/api"`, `"../../modules/worker"`, and none of the forbidden tokens of 6j; `outputs.tf` the fourteen outputs; the lock file equals prod's; `cognito.tf` the two resources with `name = "console-staging"`, `name = "MobileDeveloperCards-staging"`, the staging callback + logout URL, `access_token_validity = 60`; identity `outputs.tf` and prod `outputs.tf` the two output names; api `variables.tf` has `variable "core_vpc_environment"`, worker `variables.tf` has `variable "worker_environment"`; `staging.env.json` equals Changes 13 as JSON (key set and values) and never mentions `PGHOST`, `PGPORT`, `PGPASSWORD`, `AUTH_ALLOW_UNVERIFIED`; `eas.json` parses and only `build.staging-internal-release` differs from base, with the three new values; both allow files parse with the shapes of Changes 16; no suppression token in any new file or added line.
3. Gates (exit 0): `terraform fmt -check -recursive infra`; `cd infra/envs/prod && terraform init -backend=false -input=false && terraform validate && terraform fmt -check -recursive ..`; the same in `infra/envs/staging`; `cd src_C && dotnet build RecallSmith.Lambda.sln -c Release -nologo`; `bash -n src_C/deploy.sh`.
4. Plans (exit 0; `AWS_PROFILE=dev` read-only credentials; ≈ 8–12 min): (a) staging plan with `-var-file=staging.auto.tfvars.example`: every effective action is `create`, no `importing`, the required addresses of Changes 6/7 are present with the expected `after` names (`developercards-api-staging`, `core-vpc-staging`, `worker-lambda-staging`, `developercards-edge-public-staging`, alias `staging` ×2, both queues, three buckets, three roles, `api-staging.developercards.app`, `cdn-staging.`/`console-staging.` aliases, no `web_acl_id`, `/aws/apigateway/developercards-api-staging`, five SSM names), no forbidden resource type, no string leaf equal to a prod name or containing a prod id, `core_vpc` env carries `PGDATABASE=developercards_staging`, `PGUSER=developercards_app_staging`, `API_ENV=staging`, `PGHOST` ending in `.rds.amazonaws.com`, no `PGPASSWORD`, no `AUTH_ALLOW_UNVERIFIED`; the three inline policies have exactly the Sids of Changes 6b, `Resource = "*"` only on `Eni`, every other resource ARN contains `staging`; `aws iam simulate-custom-policy` says `allowed` for (`s3:PutObject`, `arn:aws:s3:::developercards-content-staging/content/x`) and (`sqs:SendMessage`, the staging queue ARN) on `core_vpc`, (`sqs:ReceiveMessage`, staging queue) and (`s3:PutObject`, `arn:aws:s3:::developercards-premium-staging/x`) on `worker`, and `implicitDeny` for the same actions on `arn:aws:s3:::core-vpc/content/x`, `arn:aws:sqs:ap-southeast-2:622994489535:recallsmith-publish-jobs`, `arn:aws:s3:::core-vpc-premium/x`; `check-plan.py --allow E10.staging.plan-allow.json` prints `PLAN OK` and the file's address set equals the plan's create set. (b) prod plan at HEAD passes `check-plan.py --allow E10.plan-allow.json`, and the two new clients show the names/URLs of Changes 9. (c) prod plan at the merge-base (`git archive` of `infra/`) vs HEAD: the set of (address, actions, changed keys) differs by exactly the two `create`s of Changes 9 and the `output_changes` set by exactly the two outputs of Changes 10 — nothing removed, nothing else added.
5. Scope + frozen + OTA guard (exit 0): every changed/untracked path matches the sixteen scope entries (+ `docs/delivery/r16-issues/`); the three frozen mobile files, `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `infra/envs/prod/{imports,backend,versions,providers,variables}.tf`, `prod.auto.tfvars.example`, prod's lock file, `infra/modules/{data,edge,observability}/**`, `infra/modules/identity/{main,policies,ssm}.tf`, `src_C/deploy.sh`, `src_C/env/prod.env.json`, every test directory and `frontend/` are zero-diff; `eas.json` numstat `3	3` with the exact three lines; added lines under `infra/modules` contain no `count =`/`for_each =`/`moved {`/`removed {`/`import {` except the two `count = var.manage_cognito ? 1 : 0` lines in `cognito.tf`; no `provisioner`/`null_resource`/`local-exec`/`archive_file`/`terraform_remote_state` in the diff; no secret value, no tracked `.tfplan`/`.plan.json`/`generated*.tf`/real `.auto.tfvars`, no `profile =` in `infra`; no added non-comment line of a worker file contains the two-word apply/import commands or an `aws … create|update|delete|put` phrase.

## Verify

```bash
export AWS_PROFILE=dev
BASE=delivery/r16-e-prod bash docs/delivery/r16-issues/E10.verify.sh
```
Steps 1–2 take seconds; step 3 ≈ 1–2 min (`dotnet build`, cached restore); step 4 ≈ 8–12 min — three `terraform plan` runs against an empty local state (prod at HEAD, prod at the merge-base from a `git archive`, staging), each root initialised with the gitignored `backend_override.tf` of E01 gap 13 (`init -backend=false` cannot serve `plan`), the plans in parallel after sequential `init`s (the plugin cache is not concurrency-safe). Plan files and JSON live in a `mktemp` directory removed by `trap`; the script prints only addresses, actions and changed keys. **The worker never applies:** the supervisor applies both plans after the merge in the order given above, and runs a second, empty plan in both roots before E12 starts. The driver additionally runs the `infra`, `src_C` (Docker) and `mobile` root gates, the diff-scoped banned-term grep and the suppression scan.

## Do NOT

- Do NOT instantiate `module.identity`, `module.data`, `module.edge` or `module.observability` from the staging root (R1), add `variable "manage_db"` / `variable "create_alarms"`, or put `count`/`for_each`/`moved` on any existing module resource — the only `count` lines you add are the two of Changes 9.
- Do NOT edit `infra/envs/prod/imports.tf` (never after E01), `infra/modules/{data,edge,observability}/**`, `infra/modules/identity/{main,policies,ssm}.tf`, `src_C/deploy.sh`, `src_C/env/prod.env.json`, any `.cs`, any test, `frontend/**`, `mobile/src/**`, `mobile/app.json`, `mobile/package*.json`, `.github/**`, `scripts/**`.
- Do NOT create a WAF, a zone, a certificate, a budget, an alarm, a dashboard, a CloudTrail, an OIDC provider, a Cognito pool or a Cognito client in the staging root; do NOT create the staging clients anywhere but `modules/identity/cognito.tf` under `manage_cognito`.
- Do NOT use `data "aws_route53_zone"` by `name`, hard-code `PGHOST`/`PGPORT`, put a secret or a real SSM value anywhere, commit `staging.auto.tfvars`, `*.tfplan`, `*.plan.json`, `generated*.tf`, or paste plan JSON into a comment, PR or issue.
- Do NOT rename anything that exists (`dev` stage, permission SIDs, prod names), change `mobile/eas.json` outside the three lines, add `EXPO_PUBLIC_*` values to any file, or touch the `production` EAS profile.
- Do NOT run `terraform apply`, `terraform import`, `terraform init` against the S3 backend, `aws … create/update/delete/put`, `aws lambda invoke`, `aws ssm get-parameter --with-decryption`, `eas …`, `./deploy.sh` (other than `DRY_RUN=1`), `frontend/deploy.sh`, `npm install`, `dotnet restore`, or git inside `/Users/qc/src/recallsmith`.
