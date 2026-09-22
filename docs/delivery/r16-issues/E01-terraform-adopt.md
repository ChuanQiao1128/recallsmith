# E01 — IaC bootstrap: Terraform project + adoption of every prod resource (`terraform-adopt`)

Create `infra/` (Terraform ≥ 1.10, `hashicorp/aws ~> 6.0` locked at 6.66.0): one prod root (`infra/envs/prod`) calling six modules (`identity`, `data`, `edge`, `api`, `worker`, `observability`), an `imports.tf` with **93** `import {}` blocks that adopt every existing production resource under its current name/id, a stdlib plan checker (`infra/scripts/check-plan.py`), the `infra/README.md` + `infra/RUNBOOK.md`, and the two driver files `docs/delivery/r16-issues/E01.imports.txt` / `E01.plan-allow.json`. The only acceptable plan is *state-only*: 93 `importing` entries that are all `no-op` except one provider-side `update` on the RDS instance (`apply_immediately`, `skip_final_snapshot`, `final_snapshot_identifier` — attributes that never reach `ModifyDBInstance`), plus the root outputs appearing as `create` because the worker plans against an empty local state. Nothing in AWS changes in this issue; the supervisor performs the state-only apply after merge. E01 is the canary of Wave E: every later infra issue extends these modules and is gated by this checker.

## Context

What the tree looks like today (`delivery/r16-e-prod` == `main@4b07f19`; every line read on 2026-09-22):

- **No IaC exists.** `infra/` does not exist; `find . -name '*.tf'` outside `node_modules` finds nothing. Code reaches AWS only through `src_C/deploy.sh:29-51` (`update-function-code` → `publish-version` → `update-alias prod`, `DRY_RUN=1` at `:27` prints and returns) and `frontend/deploy.sh:20-24` (`s3 sync` + `create-invalidation`; `:26` hard-codes `https://d12pfy1rhi3ekm.cloudfront.net`). Terraform never carries code: the code path stays `deploy.sh` (E00 §0 "Every infra change is a plan first").
- **Names that shipped binaries pin** (never renamed, E00 §0 "No renames"): `mobile/src/content/deckRepository.ts:28` → `https://d1ditdi9jqpy6n.cloudfront.net` (distribution `E28BKORJLV6UXG`), `:33` → `https://ktbq1sie2c.execute-api.ap-southeast-2.amazonaws.com` (API `ktbq1sie2c`, stage `$default`); `frontend/.env.production:11` → the same API's `dev` stage (so `dev` is adopted and kept, E00 §6 #3). `mobile/app.json:7` is `"version": "1.6.1"` (untouched here).
- **Account facts** (re-read 2026-09-22 with `AWS_PROFILE=dev`, account `622994489535`, `ap-southeast-2`; describe/get/list only):
  - `aws apigatewayv2 get-routes --api-id ktbq1sie2c` → 10 routes, all `AuthorizationType NONE`: `2zt7dan $default`→`ftkbtwn`, `xhcsm7a ANY /{proxy+}`→`ftkbtwn`, `3o410l1 GET /api/v1/authoring/publish/jobs`→`q8lfdrr`, `cz7p5uo GET /api/v1/content/premium-url`→`a9dzpce`, `ymw0s2h GET /api/v1/content/premium-url-dev`→`q8lfdrr`, `daeaq4a POST /webhooks/revenuecat/production`→`a9dzpce`, `jsyx1bu POST /webhooks/revenuecat/development`→`q8lfdrr`, `6lnq0za ANY /api/v1/ai/{proxy+}`→`wf11obg`, `w6hhydi ANY /api/v1/billing/{proxy+}`→`wf11obg`, `l803chb ANY /api/v1/admin/cognito/{proxy+}`→`wf11obg`. `get-integrations`: `a9dzpce`, `ftkbtwn`, `q8lfdrr` are three identical AWS_PROXY integrations to `…:function:core-vpc:prod`; `wf11obg` → `…:function:edge-public` (no alias). `get-authorizers`: `828ehi cognito-jwt` (JWT, issuer pool `ap-southeast-2_4Vf8uCXKt`, audience `6lkofepp2llp6v4nueg52mcm5v`, attached to no route). `get-stages`: `$default`, `dev`, both `auto_deploy`.
  - `aws lambda get-policy --function-name core-vpc` → 9 statements, all `apigateway.amazonaws.com` / `lambda:InvokeFunction` on the **unqualified** function ARN (the integrations call `:prod`; API Gateway accepts that today — do not "fix"): `ddf85795-8ac8-5e4f-b13e-1305b00a3ba7` → `…:ktbq1sie2c/*/*/`, `03c93ce4-7246-50e0-8573-a01d7e580e55` → `…/*/*/{proxy+}`, `apigw-httpapi-ktbq1sie2c` → `…/*/*/*`, `03895359-3cb1-5e36-9663-2926d577d284` → `…/*/*/webhooks/revenuecat/development`, `8707b68d-997f-507d-8399-9bc17c4970d0` → `…/*/$default`, `bf0bd0f4-d44d-5e2f-9852-8c2a30bbc9af` → `…/*/*/api/v1/content/premium-url`, `810b76d6-7b95-567b-ac2b-5ffc1e5be696` → `…/*/*/webhooks/revenuecat/production`, `1e1ab4f0-3e8d-5448-b856-e0981ab47ffc` → `…/*/*/api/v1/content/premium-url-dev`, `b22050a3-bad0-5ea2-a108-a21be6a9f3c0` → `…/*/*/api/v1/authoring/publish/jobs` (every source ARN starts `arn:aws:execute-api:ap-southeast-2:622994489535:ktbq1sie2c`). `edge-public` → 3 statements: `3249e15a-5957-5b6d-b271-1c7d73f1c800` → `…/*/*/api/v1/billing/{proxy+}`, `666d2528-5c6a-5fce-a7e9-4bbcaae132a9` → `…/*/*/api/v1/ai/{proxy+}`, `70ec633b-6621-5c8b-9278-9ba3d2987025` → `…/*/*/api/v1/admin/cognito/{proxy+}`.
  - `aws lambda list-aliases`: `core-vpc` `prod`→48 (E00 §6 #24: was 47 in the survey; alias versions drift with every deploy and are never hard-coded), `dev`→43 and `developercards_api_rds`→`$LATEST` (stray, not adopted); `worker-lambda` `prod`→4. `list-event-source-mappings`: `29e34447-aedd-45cf-8cab-c6ca9ad94f2f` → unqualified `…:function:worker-lambda`, batch 1, window 60 s, `MaximumConcurrency 2`.
  - `aws iam`: `core-vpc-role-joizyiwt` (path `/service-role/`, shared by core-vpc **and** worker-lambda) has 7 attachments — `arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole`, `arn:aws:iam::aws:policy/AmazonEC2FullAccess`, `…/AmazonRDSFullAccess`, `…/AmazonSQSFullAccess`, `…/AmazonS3FullAccess`, `arn:aws:iam::622994489535:policy/service-role/AWSLambdaBasicExecutionRole-033fad1a-ba7b-4152-ba28-7cf61f0c3423`, `arn:aws:iam::622994489535:policy/service-role/AWSLambdaVPCAccessExecutionRole-0916ae0e-b0bc-43bf-9827-cf383da694db`; `edge-public-role-zezx326f` (path `/service-role/`) has the attachment `arn:aws:iam::622994489535:policy/service-role/AWSLambdaBasicExecutionRole-4587d025-3600-45c8-9409-a1ead0afc685` and the inline policy `edge-public-cognito`; `snowflake-recallsmith-s3-role` (path `/`, trust = one IAM user in account `665557889528` with an `sts:ExternalId` condition) has `arn:aws:iam::aws:policy/AmazonS3FullAccess` + `arn:aws:iam::622994489535:policy/snowflake-recallsmith-s3-read`; `rds-monitoring-role` (path `/`) has `arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole`.
  - `aws cognito-idp`: console pool `ap-southeast-2_4Vf8uCXKt` ("User pool - Console for DeveloperCards", domain prefix `ap-southeast-24vf8ucxkt`), client `6lkofepp2llp6v4nueg52mcm5v` ("My SPA app - mrj1i9"), groups `super_admin` (no role) and `editor` (`role_arn` = `arn:aws:iam::622994489535:role/service-role/developercards-api-role-l4jacdsb`, a role that does not exist — kept verbatim, E00 §6 #14); mobile pool `ap-southeast-2_04hd6iisb` ("User pool - cpspy", domain prefix `ap-southeast-204hd6iisb`), client `7agirr7f56r9k5p6v6o63al1on` ("MobileDeveloperCards") — in scope per E00 §6 #2.
  - `aws cloudfront list-origin-access-controls`: `E2O3Q2DB6GEBDD` (`oac-core-vpc.s3.ap-southeast-2.amazonaws.com-mj5m0j18dh4`, description `Created by CloudFront`), `E13T84KBR8KQT6` (`recallsmith-console-oac`, description **empty**). `wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1`: `0ee57e07-7ee4-4953-8eac-e784c14e198c` / `CreatedByCloudFront-fbfe7e00` (attached to `E28BKORJLV6UXG` via `web_acl_id`; the newsapp ACL `…-1e89dc86` is out of scope). Distributions `E28BKORJLV6UXG` (`d1ditdi9jqpy6n.cloudfront.net`, origin `core-vpc`) and `E85FKUMZZWQWX` (`d12pfy1rhi3ekm.cloudfront.net`, origin `recallsmith-console-622994489535`).
  - `aws s3api get-bucket-policy --bucket core-vpc`: `AllowCloudFrontOACReadOnly` (`cloudfront.amazonaws.com` `s3:GetObject` on `arn:aws:s3:::core-vpc/content/*`, `AWS:SourceArn` = distribution `E28BKORJLV6UXG`) + `AllowCoreVpcLambdaWriteContent` (`core-vpc-role-joizyiwt` `s3:PutObject`,`s3:GetObject` on `content/*`). `recallsmith-console-622994489535`: `AllowCloudFrontOAC` (`s3:GetObject` on `/*`, source `E85FKUMZZWQWX`). `core-vpc-premium` has no policy. All three buckets: PAB ×4 on, SSE-S3, BucketOwnerEnforced, versioning **never enabled** (import reads `status = "Disabled"`).
  - `aws rds describe-db-instances --db-instance-identifier developercards`: postgres `17.9`, subnet group `default-vpc-04af44dd8f5f48717`, `DeletionProtection false`, monitoring role `arn:aws:iam::622994489535:role/rds-monitoring-role`, KMS `alias/aws/rds`. `aws sqs get-queue-attributes` (`recallsmith-publish-jobs`): only the default `__owner_statement` policy. `aws budgets describe-budgets`: `My Monthly Cost Budget` = `20.0`, notifications ACTUAL>50, FORECASTED>85, ACTUAL>100, one email subscriber. `aws logs describe-log-groups --log-group-name-prefix /aws/lambda/`: `/aws/lambda/core-vpc`, `/aws/lambda/edge-public`, `/aws/lambda/worker-lambda` (retention never); `/aws/lambda/developercards-api` is stray (E02's supervisor cleanup, not adopted). `aws s3api head-bucket --bucket recallsmith-tfstate-622994489535` → 404: the backend bucket does not exist; the supervisor creates it (E00 §0 "Backend").
- **Probe verdict** (E00 §6 #1, 2026-09-22, Terraform 1.16.3 + hashicorp/aws 6.66.0, `-backend=false`, never applied): `import {}` + `plan -generate-config-out` over 47 root-level blocks covering every type above reached `Plan: 47 to import, 0 to add, 1 to change, 0 to destroy` after the curation rules of E00 §2.1.4 — the one change is the RDS provider-side update. Generated config for `aws_lambda_function` and `aws_lambda_event_source_mapping` and `aws_db_instance` does **not** pass `validate` until curated. `aws_apigatewayv2_stage` generates a hard-coded `deployment_id` (remove it). `region = "ap-southeast-2"`, `tags = {}` and `tags_all = {}` lines can be stripped from every resource with the plan still `no-op` (re-probed on the subnet group and the RDS instance). The plan JSON's `resource_changes[].change` carries `importing`, `before`, `after`; for the RDS update the keys whose `before`/`after` values differ are exactly `apply_immediately`, `final_snapshot_identifier`, `skip_final_snapshot` and `after_unknown` is empty. **`aws_lambda_function.environment.variables` is not sensitive in this provider**: plan text and `show -json` print the five secret values in clear, so no plan JSON is ever committed, pasted or printed beyond address/actions/changed-keys.
- **Interpreter**: `python3` on this machine is 3.8.10 — `check-plan.py` uses 3.8 syntax only (no `match`, no `str.removeprefix`, no builtin generics in annotations).

What E00 decided (binding; `docs/delivery/r16-issues/E00-contracts.md`): §0 (`:9-37`) — WORKER SAFETY RULE, the `backend.tf` bytes, no renames, no `profile` in providers, `use1` alias, secrets policy, the unspellable env-var names, the `infra` root gate; §1.1 (`:43-69`) — the exact file set E01 creates; §2.1.1 (`:116-168`) — module interfaces verbatim; §2.1.2 (`:170-203`) — the 93 addresses and import ids; §2.1.3 (`:205-207`) — no new resources in E01; §2.1.4 (`:209-211`) — curation rules; §3.1 (`:419-430`) — `check-plan.py` and the allow file; §4 (`:446-468`) — E01 has no dependency and is the canary; §5 (`:470-482`) — verify conventions and why the empty-state plan is valid; §6 #1, #2, #3, #13, #14, #20, #21 (`:486-488`, `:498-499`, `:505-506`).

Gaps E00 leaves open — resolved here and binding for this issue:

1. **OAC descriptions follow the live value.** E00 §2.1.4 says `description = ""`; that is the rule for an OAC whose live description is empty (`E13T84KBR8KQT6`, console) — the empty string stops the provider default `Managed by Terraform` from planning an update. `E2O3Q2DB6GEBDD` (content) keeps `description = "Created by CloudFront"`. Both are `no-op` (probe).
2. **The Snowflake role is unconditional.** Its address is `module.identity.aws_iam_role.snowflake` (no `[0]`, E00 §2.1.2). `variable "snowflake_external_id"` (`sensitive = true`, `default = null`) feeds the trust policy's `sts:ExternalId`; `output "snowflake_role_arn" = var.snowflake_external_id == null ? null : aws_iam_role.snowflake.arn`. The worker obtains the value read-only (`aws iam get-role --role-name snowflake-recallsmith-s3-role --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals."sts:ExternalId"' --output text`) and passes it as `TF_VAR_snowflake_external_id` or in the gitignored `infra/envs/prod/prod.auto.tfvars`; it is never printed, never committed, never in a brief. How the staging root treats this role is E10's.
3. **Root outputs are part of E01's plan.** With an empty state every root output is an `output_changes` entry with `actions: ["create"]`; the allow file therefore carries `"outputs": [...]` naming exactly the twelve root outputs of change 2.5. The supervisor's second plan (after apply) has none.
4. **`check-plan.py` gains an empty-plan mode.** With no `--allow`, the checker requires a plan with every entry `no-op`, no `importing`, no effective output change, prints `PLAN EMPTY` and exits 0 — the supervisor's second-plan gate (E00 §0). `--expect-imports FILE` on the CLI overrides the allow file's `expect_imports`. Exit codes: 0 pass, 1 violation, 2 usage / unreadable input. Entries with `"mode": "data"` are never effective.
5. **Provider lock is written first.** `infra/envs/prod/.terraform.lock.hcl` selects **6.66.0** (E00 §0). Write the lock's provider block (`version = "6.66.0"`, `constraints = "~> 6.0"`, no hashes) before the first `init`, then `terraform providers lock -platform=darwin_arm64 -platform=linux_amd64` adds both platforms' hashes without changing the selection; never `init -upgrade`.
6. **Non-secret ids are root variable defaults.** `infra/envs/prod/variables.tf` declares every id/name with its prod default (change 2.4); `main.tf` passes `var.*`; the modules take strings only. `prod.auto.tfvars.example` holds only the ExternalId placeholder.
7. **Lambda permission `source_arn`s are a pinned map** (the SIDs and ARNs above), `for_each` keyed by SID, so E08's pruning is a visible `delete`.
8. **The driver files are the worker's.** `E01.imports.txt` (93 lines, `LC_ALL=C sort -u`, content pinned in change 10) and `E01.plan-allow.json` (pinned) are created here; `E01.verify.sh` diffs them against an embedded copy, so they cannot drift.
9. **Config generation happens outside the worktree.** `plan -generate-config-out` is unsupported for `module.*` addresses (E00 §5): run it once in a scratch root (`${TMPDIR:-/tmp}/e01-gen-$$`) with root-level addresses, curate into the modules, delete the scratch root. `generated*.tf` is gitignored and never committed.
10. **Import blocks name no provider.** `module.edge.aws_wafv2_web_acl.content` carries `provider = aws.use1` inside the module; Terraform resolves the import through the resource's provider. Only if `plan` fails on that one import (wrong region) add `provider = aws.use1` to its `import {}` block — nothing else.
11. **`region`, `tags`, `tags_all` lines are stripped** from every curated resource (provider default region applies; tags are E02's planned change, E00 §2.1.4). Module `variable "tags"` exists (interface) but is referenced by nothing in E01, and no `default_tags` block exists.
12. **Data sources validate the network ids** (`modules/data/network.tf`): `data "aws_vpc" "main"`, `data "aws_subnet" "this"` (`for_each`), `data "aws_security_group" "lambda"` / `"rds"` (`for_each`), `data "aws_kms_alias" "rds"` (`alias/aws/rds`, referenced by the RDS `kms_key_id` and `performance_insights_kms_key_id`). They are never imported and appear in no allow list.
13. **The worker's plan needs a local backend override** (correction to E00 §0/§5, re-probed 2026-09-22 on this machine): once `backend.tf` declares the S3 backend, `terraform init -backend=false` still serves `validate` (the root gate), but `terraform plan` then stops with `Error: Backend initialization required`. The empty-local-state plan E00 §5 relies on is obtained with a gitignored override file — `infra/envs/prod/backend_override.tf` containing `terraform { backend "local" { path = "<absolute path under $TMPDIR>/terraform.tfstate" } }` — followed by `terraform init -input=false` (Terraform's `_override.tf` merge replaces the `backend` block; the S3 bucket is never contacted) and `terraform plan -out`. The override is deleted afterwards (`E01.verify.sh` creates and removes its own). `backend_override.tf` is a `.gitignore` line (change 1.1). The supervisor's real-backend init is `terraform init -reconfigure`. E02–E05 and every staging-root plan (E10–E12) copy this mechanism; from E06 on the prod plan reads the real backend read-only (`init -reconfigure` + `plan -lock=false`), because an empty state cannot show deletes and re-plans every earlier issue's creates (E00 §6 #25). `infra/README.md` §3 documents both modes.

## Read first

1. `docs/delivery/r16-issues/E00-contracts.md` §0 (`:9-37`), §1.1 (`:43-69`), §2.1 (`:114-211`), §3.1 (`:419-430`), §5 (`:470-482`), §6 #1–#3, #13, #14, #20, #21.
2. `docs/backend-architecture-review-2026-09-22.md` §1 table (`:60-76`) and §2.4.4 (`:135`) — the IaC finding; §3 (`:179-197`) — why every later issue needs a plan gate.
3. `src_C/deploy.sh:20-52` (the code path Terraform must not take over) and `frontend/deploy.sh:18-28`.
4. `docs/delivery/r16-issues/C05-topic-server.md` §Changes required and `C05.verify.sh:1-60` (brief/verify format), `C07.verify.sh:151` (the suppression grep, copied verbatim).
5. Terraform docs you will need offline-safe: `import` blocks (`to`, `id`, optional `provider`), `plan -generate-config-out`, `terraform providers lock`, `lifecycle { ignore_changes, prevent_destroy }`, module `configuration_aliases`.

## Constraints

- **Scope (the ONLY files that may change; all new):**
  `infra/README.md`, `infra/RUNBOOK.md`, `infra/.gitignore`, `infra/bootstrap/placeholder.zip`, `infra/scripts/check-plan.py`;
  `infra/envs/prod/versions.tf`, `providers.tf`, `backend.tf`, `variables.tf`, `outputs.tf`, `main.tf`, `imports.tf`, `prod.auto.tfvars.example`, `.terraform.lock.hcl`;
  `infra/modules/identity/main.tf`, `variables.tf`, `outputs.tf`, `cognito.tf`;
  `infra/modules/data/main.tf`, `variables.tf`, `outputs.tf`, `rds.tf`, `buckets.tf`, `network.tf`;
  `infra/modules/edge/main.tf`, `variables.tf`, `outputs.tf`, `cdn.tf`, `console_bucket.tf`;
  `infra/modules/api/main.tf`, `variables.tf`, `outputs.tf`, `gateway.tf`, `core_vpc.tf`, `edge_public.tf`;
  `infra/modules/worker/main.tf`, `variables.tf`, `outputs.tf`, `queue.tf`, `function.tf`;
  `infra/modules/observability/main.tf`, `variables.tf`, `outputs.tf`, `budget.tf`;
  `docs/delivery/r16-issues/E01.imports.txt`, `docs/delivery/r16-issues/E01.plan-allow.json`. Nothing else — no `src_C`, `frontend`, `mobile`, `.github`, `scripts`, no `infra/envs/staging`, no seventh module, no `cdk.json`.
- **WORKER SAFETY RULE:** a worker may run read-only AWS CLI, `terraform init/validate/plan` (plan must be saved with -out and shown as JSON), but NEVER `terraform apply`, `terraform import` (state-changing), `aws ... create/update/delete/put`, `eas`, or any deploy script. The supervisor applies plans after each merge. Each infra brief's verify.sh therefore checks the PLAN (terraform show -json) against an explicit allow-list of resource addresses and actions — nothing else may appear as create/update/delete.
  Clarifications (E00 §0): `import {}` blocks in `.tf` files are configuration and allowed; the `terraform import` command is not. `aws sts get-caller-identity`, `aws iam get-role`, `aws lambda get-policy`, `aws s3api get-bucket-policy`, `aws budgets describe-*` are read-only and allowed. For `validate` you run `terraform init -backend=false -input=false`; for `plan` you run `terraform init -input=false` only with the local `backend_override.tf` of gap 13 in place (state path under `$TMPDIR`); you never create the state bucket, never initialise the S3 backend, never run `DRY_RUN`-less `deploy.sh`.
- **Frozen files** (zero diff): `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`.
- **OTA rule:** `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json` untouched (`"version": "1.6.1"` stays); nothing under `mobile/` changes at all in this issue; no `@sentry`.
- **No renames, no new AWS resources, no tags, no `default_tags`, no `provisioner`, `local-exec`, `null_resource`, `terraform_data`, `data "external"`, `archive_file`, `terraform_remote_state`, no `profile` in any provider block, no `region` on module providers beyond the root's two blocks.** `DisableExecuteApiEndpoint` stays false (the API's `disable_execute_api_endpoint = false`).
- **Secrets:** no `.tf`, `.tfvars`, `.json`, `.md`, verify output or PR text carries a secret value; the Lambda `environment` block is in `ignore_changes` and is **never written into any `.tf`** (the generated `environment {}` block is deleted during curation, so the five secret names never appear with a value under `infra/`). The two core-vpc env-var names E00 §0 calls unspellable are not written anywhere. No `*.tfplan`, `*.plan.json`, `generated*.tf`, `*.auto.tfvars` (except `.example`) is tracked.
- **Banned literals in any new/changed line:** the six terms of B00 §0 (driver gate) — use "sidestep", "work around", "guard", "fallback". No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(` anywhere in the new files.
- **Tests:** no existing test file changes (E01 touches no code root). New checks are `E01.verify.sh`'s own: `python3 -m py_compile` of the checker, its negative fixtures, `json.load` of the allow file.
- Standing rules: no `git push`, no PR, never touch `main`, no `npm install`, no `dotnet`, no EAS / expo / deploy command, no git or terraform activity outside your worktree except the scratch generation root of gap 9 (deleted before you finish).

## Changes required

Every module `main.tf` (changes 3–8) starts with `terraform { required_providers { aws = { source = "hashicorp/aws" } } }` (`edge` adds `configuration_aliases = [aws.use1]`, change 5.1) followed by that module's `locals`; module files hold nothing but resources, data sources, locals, variables and outputs. Attribute values below are written in `terraform fmt` form; the verify compares them on an `=`-normalised copy.

### 1. Skeleton (`infra/`)

1.1 `infra/.gitignore` — these nine lines (order free; `*.tfstate*` may be added):
```
.terraform/
*.tfplan
*.plan.json
generated*.tf
*.auto.tfvars
!*.auto.tfvars.example
crash.log
backend_override.tf
__pycache__/
```
(`__pycache__/` because `python3 -m py_compile` on the checker leaves bytecode that would otherwise trip the scope guard; the verify compiles to a temp file.)
1.2 `infra/bootstrap/placeholder.zip` — a zip holding exactly one 0-byte entry named `README`: `python3 -c "import zipfile; zipfile.ZipFile('infra/bootstrap/placeholder.zip','w').writestr('README','')"`. Every managed function points at it (`filename = "${path.module}/../../bootstrap/placeholder.zip"`); code keeps flowing through `src_C/deploy.sh`.

1.3 `infra/README.md` with exactly these six H2 headings, in order: `## 1. Layout`, `## 2. WORKER SAFETY RULE`, `## 3. Gates`, `## 4. What is in state`, `## 5. Supervisor procedure`, `## 6. Change log`. §1: the tree of change 2–8 and the module dependency direction `identity → data → edge → api, worker → observability` (E00 §6 #13). §2: the rule of Constraints verbatim (starts `a worker may run read-only AWS CLI`). §3: the driver's root gate verbatim — `cd infra/envs/prod && terraform init -backend=false -input=false && terraform validate && terraform fmt -check -recursive ..` — plus `terraform fmt -check -recursive infra` from the repo root (E00 §6 #21), `TF_PLUGIN_CACHE_DIR="$HOME/.terraform.d/plugin-cache"`, and the two worker plan recipes of E00 §6 #25: (a) gap 13 (`backend_override.tf` → `terraform init -input=false -reconfigure` → `terraform plan -out` → `terraform show -json` → `check-plan.py`; E01–E05 and staging roots) and (b) read-only real backend (`terraform init -input=false -reconfigure` with the committed `backend.tf` → `terraform plan -lock=false -input=false -out` → `show -json` → `check-plan.py`; E06 onward, prod), each with `AWS_PROFILE=dev`, never `apply`. §4: what lands in state and is accepted — the Lambda `environment` variables of the three adopted functions (names may be listed; values never), the Snowflake ExternalId (a variable, no default), the SSM placeholders from E06 on; what is never in state — the RDS master password (`password` is never set), real SSM values, `EXPO_TOKEN`; state is SSE-S3 encrypted and admin-only. §5: bucket creation (E00 §0 "Backend"), `terraform init -reconfigure` with the real backend (no override file present), `terraform plan -out=e01.tfplan`, `terraform show -json e01.tfplan | python3 infra/scripts/check-plan.py --plan - --allow docs/delivery/r16-issues/E01.plan-allow.json`, `terraform apply e01.tfplan`, then a second `plan` checked with no `--allow` (must print `PLAN EMPTY`). §6: one line `- 2026-09-22 E01 — adopted 93 resources (imports only); plan = 93 imports + 1 provider-side RDS update; no AWS change.` (`--plan -` reads stdin.)

1.4 `infra/RUNBOOK.md` with H2 headings `## 1. Adopt (E01, once)`, `## 2. Plan (every issue)`, `## 3. Apply (supervisor only)`, `## 4. Post-apply cleanups`, `## 5. Second plan must be empty`, `## 6. Drift you will see`. §2 spells the worker recipe of gap 13 including the `backend_override.tf` text and its removal; §3 starts with `terraform init -reconfigure`. §6 documents: alias versions move with `deploy.sh` (ignored via `ignore_changes`), `engine_version = "17.9"` must be reconciled by hand after an RDS auto-minor upgrade, provisioned concurrency / versions / SnapStart are not state, the `editor` group's dangling `role_arn` (E00 §6 #14), and that `imports.tf` stays until the wave ends (E00 §6 #20).

### 2. Root `infra/envs/prod`

2.1 `versions.tf`:
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
2.2 `providers.tf` — exactly two blocks, no `profile`, no `default_tags`:
```hcl
provider "aws" {
  region = "ap-southeast-2"
}

provider "aws" {
  alias  = "use1"
  region = "us-east-1"
}
```
2.3 `backend.tf` — byte for byte E00 §0:
```hcl
terraform {
  backend "s3" {
    bucket       = "recallsmith-tfstate-622994489535"
    key          = "envs/prod/terraform.tfstate"
    region       = "ap-southeast-2"
    encrypt      = true
    use_lockfile = true
  }
}
```
2.4 `variables.tf` — these names, with these prod defaults (all `type = string` unless noted): `account_id` = `"622994489535"`, `region` = `"ap-southeast-2"`, `vpc_id` = `"vpc-04af44dd8f5f48717"`, `subnet_ids` (list) = `["subnet-0cc7a99faf631cee2", "subnet-0dd0ac42e1bb9648a", "subnet-0a365ac32e28958ed"]`, `core_vpc_security_group_ids` (list) = `["sg-00ad6c62d292a475e", "sg-04af3c6fa45f10113"]`, `worker_security_group_ids` (list) = `["sg-00ad6c62d292a475e", "sg-04af3c6fa45f10113", "sg-0d2541aec08b1a215", "sg-0fbc6607e6473cbd3"]`, `rds_security_group_ids` (list) = `["sg-0d2541aec08b1a215", "sg-0fbc6607e6473cbd3"]`, `console_pool_id` = `"ap-southeast-2_4Vf8uCXKt"`, `mobile_pool_id` = `"ap-southeast-2_04hd6iisb"`, `cors_allowed_origins` (list) = `["http://localhost:5173", "https://d12pfy1rhi3ekm.cloudfront.net"]`, `snowflake_external_id` (`sensitive = true`, `default = null`). The remaining names are literals in `main.tf`: `"core-vpc-role-joizyiwt"`, `"edge-public-role-zezx326f"`, `"developercards"`, `"default-vpc-04af44dd8f5f48717"`, `"core-vpc"`, `"core-vpc-premium"`, `"recallsmith-console-622994489535"`, `"developercards-api"`, `"prod"`, `"edge-public"`, `"recallsmith-publish-jobs"`, `"worker-lambda"`, `"My Monthly Cost Budget"`, `"20"`.

2.5 `outputs.tf` — exactly these twelve: `api_id`, `api_endpoint`, `content_distribution_id`, `content_domain_name`, `console_distribution_id`, `console_domain_name`, `core_vpc_alias_arn`, `worker_alias_arn`, `queue_url`, `db_address`, `console_pool_endpoint`, `mobile_pool_endpoint` (each `value = module.<m>.<output>`; none `sensitive`).

2.6 `main.tf` — six module blocks in this order, `env = "prod"` in every call, wired exactly as E00 §2.1.1: `module "identity"` (strings only: `account_id`, `region`, `core_vpc_role_name`, `edge_public_role_name`, `manage_cognito = true`, `console_pool_id`, `mobile_pool_id`, `snowflake_external_id = var.snowflake_external_id`); `module "data"` (`db_identifier`, `db_subnet_group_name`, `content_bucket_name`, `premium_bucket_name`, `vpc_id`, `subnet_ids`, `lambda_security_group_ids = var.worker_security_group_ids`, `rds_security_group_ids`, `rds_monitoring_role_arn = module.identity.rds_monitoring_role_arn`); `module "edge"` with `providers = { aws = aws, aws.use1 = aws.use1 }` (`content_bucket_name`, `content_bucket_arn`, `content_bucket_regional_domain_name` from `module.data`, `console_bucket_name`, `core_vpc_role_arn = module.identity.core_vpc_role_arn`); `module "api"` (`api_name`, `core_vpc_function_name`, `core_vpc_alias_name`, `core_vpc_role_arn`, `edge_public_function_name`, `edge_public_role_arn`, `subnet_ids = module.data.subnet_ids`, `security_group_ids = var.core_vpc_security_group_ids`, `console_pool_endpoint`, `console_client_id` from `module.identity`, `cors_allowed_origins`); `module "worker"` (`queue_name`, `function_name`, `alias_name`, `role_arn = module.identity.core_vpc_role_arn`, `subnet_ids = module.data.subnet_ids`, `security_group_ids = var.worker_security_group_ids`); `module "observability"` (`account_id`, `budget_name`, `budget_limit = "20"`). No `tags = …` argument anywhere.

2.7 `imports.tf` — header comment `# E01 adoption set — never edited after E01 (E00 §1.1, §5, §6 #20)`, then **93** `import {}` blocks, one per row of E00 §2.1.2, `to = <module address>` / `id = "<import id>"`, grouped by module in the order identity, data, edge, api, worker, observability. Ids verbatim from E00 §2.1.2 (e.g. `id = "https://sqs.ap-southeast-2.amazonaws.com/622994489535/recallsmith-publish-jobs"`, `id = "ktbq1sie2c/$default"`, `id = "622994489535:My Monthly Cost Budget"`, `id = "0ee57e07-7ee4-4953-8eac-e784c14e198c/CreatedByCloudFront-fbfe7e00/CLOUDFRONT"`, `id = "edge-public-role-zezx326f:edge-public-cognito"`, `id = "core-vpc-role-joizyiwt/arn:aws:iam::aws:policy/AmazonS3FullAccess"`); the repeated ids appear exactly `id = "core-vpc"` ×7 (five bucket-set resources, the bucket policy, the function), `id = "core-vpc-premium"` ×5, `id = "recallsmith-console-622994489535"` ×6. No `provider =` line (gap 10).

2.8 `prod.auto.tfvars.example` — three lines: a comment `# Copy to prod.auto.tfvars (gitignored) or export TF_VAR_snowflake_external_id; value from: aws iam get-role --role-name snowflake-recallsmith-s3-role`, a comment naming the JMESPath of gap 2, and `snowflake_external_id = "REPLACE_ME"`.

2.9 `.terraform.lock.hcl` — provider `registry.terraform.io/hashicorp/aws`, `version     = "6.66.0"`, `constraints = "~> 6.0"`, `h1:` hashes for `darwin_arm64` and `linux_amd64` (gap 5).

### 3. Module `identity` (`infra/modules/identity`)

3.1 `variables.tf`: `env`, `account_id`, `region`, `core_vpc_role_name`, `edge_public_role_name`, `manage_cognito` (bool), `console_pool_id`, `mobile_pool_id`, `snowflake_external_id` (`sensitive = true`, `default = null`), `tags` (`map(string)`, `default = {}`). `outputs.tf`: `core_vpc_role_arn`, `core_vpc_role_name`, `edge_public_role_arn`, `snowflake_role_arn` = `var.snowflake_external_id == null ? null : aws_iam_role.snowflake.arn` (gap 2), `rds_monitoring_role_arn`, `console_pool_endpoint` = `"cognito-idp.${var.region}.amazonaws.com/${var.console_pool_id}"`, `console_client_id` = `var.manage_cognito ? aws_cognito_user_pool_client.spa[0].id : null`, `mobile_pool_endpoint`, `mobile_client_id` (same pattern). `main.tf`: the `terraform { required_providers { aws = { source = "hashicorp/aws" } } }` block, `locals`, and the IAM resources: `aws_iam_role.core_vpc` (`name = var.core_vpc_role_name`, `path = "/service-role/"`, trust `lambda.amazonaws.com`), `aws_iam_policy.core_vpc_logs`, `aws_iam_policy.core_vpc_vpc` (names/paths/documents from the generated config), `aws_iam_role_policy_attachment.core_vpc` with `for_each = local.core_vpc_attachments` = `{ sqs_exec = "arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole", ec2_full = "arn:aws:iam::aws:policy/AmazonEC2FullAccess", rds_full = "arn:aws:iam::aws:policy/AmazonRDSFullAccess", sqs_full = "arn:aws:iam::aws:policy/AmazonSQSFullAccess", s3_full = "arn:aws:iam::aws:policy/AmazonS3FullAccess", logs = aws_iam_policy.core_vpc_logs.arn, vpc = aws_iam_policy.core_vpc_vpc.arn }`; `aws_iam_role.edge_public` (`path = "/service-role/"`), `aws_iam_role_policy.edge_public_cognito` (`name = "edge-public-cognito"`), `aws_iam_policy.edge_public_logs`, `aws_iam_role_policy_attachment.edge_public_logs`; `aws_iam_role.snowflake` (`path = "/"`, trust with `"sts:ExternalId" = var.snowflake_external_id`), `aws_iam_policy.snowflake_read`, `aws_iam_role_policy_attachment.snowflake` `for_each = { read = aws_iam_policy.snowflake_read.arn, s3_full = "arn:aws:iam::aws:policy/AmazonS3FullAccess" }`; `aws_iam_role.rds_monitoring` (`name = "rds-monitoring-role"`, `path = "/"`), `aws_iam_role_policy_attachment.rds_monitoring` (`arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole`).

3.2 `cognito.tf` — every resource `count = var.manage_cognito ? 1 : 0`: `aws_cognito_user_pool.console`, `aws_cognito_user_pool_client.spa`, `aws_cognito_user_group.super_admin`, `aws_cognito_user_group.editor` (with the dangling `role_arn = "arn:aws:iam::622994489535:role/service-role/developercards-api-role-l4jacdsb"` verbatim), `aws_cognito_user_pool_domain.console` (`domain = "ap-southeast-24vf8ucxkt"`), `aws_cognito_user_pool.mobile`, `aws_cognito_user_pool_client.mobile`, `aws_cognito_user_pool_domain.mobile` (`domain = "ap-southeast-204hd6iisb"`). Bodies from the generated config; `user_pool_id` references the pool resource (`aws_cognito_user_pool.console[0].id`), never the literal.

### 4. Module `data` (`infra/modules/data`)

4.1 `variables.tf`: `env`, `db_identifier`, `db_subnet_group_name`, `content_bucket_name`, `premium_bucket_name`, `vpc_id`, `subnet_ids` (list), `lambda_security_group_ids` (list), `rds_security_group_ids` (list), `rds_monitoring_role_arn`, `tags`. `outputs.tf`: `db_instance_arn`, `db_address`, `content_bucket_arn`, `content_bucket_regional_domain_name`, `premium_bucket_arn`, `subnet_ids`, `lambda_security_group_ids`. `main.tf`: `terraform {}` block + `locals`. `network.tf`: the data sources of gap 12 — `data "aws_vpc" "main"`, `data "aws_subnet" "this"`, `data "aws_security_group" "lambda"`, `data "aws_security_group" "rds"`, `data "aws_kms_alias" "rds"`.

4.2 `rds.tf`: `aws_db_subnet_group.default_vpc` (`name = var.db_subnet_group_name`, `subnet_ids = var.subnet_ids`, description from generated) and `aws_db_instance.developercards` curated per E00 §2.1.4: **absent** `domain_dns_ips`, `password`, `password_wo`, `password_wo_version`, `manage_master_user_password`, `allow_major_version_upgrade`, `delete_automated_backups`, `snapshot_identifier`, `restore_to_point_in_time`, `replicate_source_db`, `username`, `db_name`, `timezone`, `character_set_name`; **present** `identifier = var.db_identifier`, `engine_version = "17.9"`, `skip_final_snapshot = false`, `final_snapshot_identifier = "developercards-final-tf"`, `apply_immediately = false`, `deletion_protection = false` (E02 flips it), `backup_retention_period = 7`, `db_subnet_group_name = aws_db_subnet_group.default_vpc.name`, `vpc_security_group_ids = var.rds_security_group_ids`, `monitoring_role_arn = var.rds_monitoring_role_arn`, `kms_key_id` and `performance_insights_kms_key_id` = `data.aws_kms_alias.rds.target_key_arn`, and `lifecycle { prevent_destroy = true }`. Everything else (instance class, storage, windows, CA, PI, option/parameter groups) verbatim from generated.

4.3 `buckets.tf`: for `content` (`bucket = var.content_bucket_name`) and `premium`: `aws_s3_bucket` with `lifecycle { prevent_destroy = true }`, `aws_s3_bucket_versioning` with `versioning_configuration { status = "Disabled" }`, `aws_s3_bucket_public_access_block` (four `true`), `aws_s3_bucket_server_side_encryption_configuration` (AES256, `bucket_key_enabled` as generated), `aws_s3_bucket_ownership_controls` (`BucketOwnerEnforced`). No bucket policy here (it lives in `edge`, E00 §6 #13).

### 5. Module `edge` (`infra/modules/edge`)

5.1 `main.tf`:
```hcl
terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws.use1]
    }
  }
}
```
`variables.tf`: `env`, `content_bucket_name`, `content_bucket_arn`, `content_bucket_regional_domain_name`, `console_bucket_name`, `core_vpc_role_arn`, `tags`. `outputs.tf`: `content_distribution_id`, `content_distribution_arn`, `content_domain_name`, `console_distribution_id`, `console_domain_name`.

5.2 `cdn.tf`: `aws_cloudfront_origin_access_control.content` (`description = "Created by CloudFront"`) and `.console` (`description = ""`), gap 1; `aws_wafv2_web_acl.content` with `provider = aws.use1`, `scope = "CLOUDFRONT"`, `name = "CreatedByCloudFront-fbfe7e00"`, rules verbatim from generated; `aws_cloudfront_distribution.content` (origin `domain_name = var.content_bucket_regional_domain_name`, `origin_access_control_id = aws_cloudfront_origin_access_control.content.id`, `web_acl_id = aws_wafv2_web_acl.content.arn`, everything else verbatim: origin id `core-vpc.s3.ap-southeast-2.amazonaws.com-mj5ly8krcla`, cache policy `658327ea-f89d-4fab-a63d-7e88639e58f6`, `PriceClass_All`, default certificate); `aws_cloudfront_distribution.console` (origin `console-s3` → `aws_s3_bucket.console.bucket_regional_domain_name`, OAC `.console`, `default_root_object = "index.html"`, the two custom error responses, response headers policy `67f7725c-6f97-4210-82d7-5512b31e9d03`); `aws_s3_bucket_policy.content` (`bucket = var.content_bucket_name`, `jsonencode` of the two live statements `AllowCloudFrontOACReadOnly` and `AllowCoreVpcLambdaWriteContent` with `aws_cloudfront_distribution.content.arn`, `var.core_vpc_role_arn`, `"${var.content_bucket_arn}/content/*"` substituted).

5.3 `console_bucket.tf`: `aws_s3_bucket.console` (`bucket = var.console_bucket_name`; no `prevent_destroy` — the console bucket is re-creatable by `frontend/deploy.sh`, E00 §2.1.1 reserves `prevent_destroy` for RDS and the two content buckets), `aws_s3_bucket_policy.console` (`AllowCloudFrontOAC`, source `aws_cloudfront_distribution.console.arn`), `aws_s3_bucket_public_access_block.console`, `aws_s3_bucket_server_side_encryption_configuration.console` (no bucket key — as live), `aws_s3_bucket_ownership_controls.console`, `aws_s3_bucket_versioning.console` (`status = "Disabled"`).

### 6. Module `api` (`infra/modules/api`)

6.1 `variables.tf`: `env`, `api_name`, `core_vpc_function_name`, `core_vpc_alias_name`, `core_vpc_role_arn`, `edge_public_function_name`, `edge_public_role_arn`, `subnet_ids` (list), `security_group_ids` (list), `console_pool_endpoint`, `console_client_id`, `cors_allowed_origins` (list), `tags`. `outputs.tf`: `api_id`, `api_execution_arn`, `api_endpoint`, `stage_names` (list of the two stage names), `core_vpc_function_arn`, `core_vpc_alias_arn`, `core_vpc_log_group_name`, `edge_public_function_arn`. `main.tf`: `terraform {}` + `locals` (the route map and the permission maps below).

6.2 `gateway.tf`: `aws_apigatewayv2_api.http` (`name = var.api_name`, `protocol_type = "HTTP"`, `route_selection_expression = "$request.method $request.path"`, `disable_execute_api_endpoint = false`, `cors_configuration { allow_origins = var.cors_allowed_origins … }` with the live headers/methods/max_age); `aws_apigatewayv2_integration.core_vpc` (`ftkbtwn`), `aws_apigatewayv2_integration.core_vpc_dup` `for_each = toset(["a9dzpce", "q8lfdrr"])` (identical bodies: `AWS_PROXY`, `integration_uri = aws_lambda_alias.core_vpc_prod.invoke_arn`, `payload_format_version = "2.0"`, `timeout_milliseconds = 30000`, `integration_method = "POST"`), `aws_apigatewayv2_integration.edge_public` (`integration_uri = aws_lambda_function.edge_public.invoke_arn`); `aws_apigatewayv2_route.this` `for_each = local.routes` where `local.routes = { default = { route_key = "$default", integration = "core_vpc" }, proxy = { route_key = "ANY /{proxy+}", integration = "core_vpc" }, publish_jobs = { route_key = "GET /api/v1/authoring/publish/jobs", integration = "dup_q8lfdrr" }, premium_url = { route_key = "GET /api/v1/content/premium-url", integration = "dup_a9dzpce" }, premium_url_dev = { route_key = "GET /api/v1/content/premium-url-dev", integration = "dup_q8lfdrr" }, rc_production = { route_key = "POST /webhooks/revenuecat/production", integration = "dup_a9dzpce" }, rc_development = { route_key = "POST /webhooks/revenuecat/development", integration = "dup_q8lfdrr" }, edge_ai = { route_key = "ANY /api/v1/ai/{proxy+}", integration = "edge_public" }, edge_billing = { route_key = "ANY /api/v1/billing/{proxy+}", integration = "edge_public" }, edge_admin_cognito = { route_key = "ANY /api/v1/admin/cognito/{proxy+}", integration = "edge_public" } }`, `target = "integrations/${local.integration_ids[each.value.integration]}"`, `authorization_type = "NONE"`; `aws_apigatewayv2_authorizer.console` (`name = "cognito-jwt"`, `authorizer_type = "JWT"`, `identity_sources = ["$request.header.Authorization"]`, `jwt_configuration { audience = [var.console_client_id]; issuer = "https://${var.console_pool_endpoint}" }`); `aws_apigatewayv2_stage.default` (`name = "$default"`) and `.dev` (`name = "dev"`), `auto_deploy = true`, `default_route_settings` as generated, **no `deployment_id`**.

6.3 `core_vpc.tf`: `aws_cloudwatch_log_group.core_vpc` (`name = "/aws/lambda/${var.core_vpc_function_name}"`, `retention_in_days = 0`); `aws_lambda_function.core_vpc` (`function_name = var.core_vpc_function_name`, `role = var.core_vpc_role_arn`, `runtime = "dotnet8"`, `architectures = ["arm64"]`, `handler = "RecallSmith.Lambda::RecallSmith.Lambda.VpcFunction::Handler"`, `memory_size = 128`, `timeout = 90`, `vpc_config { subnet_ids = var.subnet_ids; security_group_ids = var.security_group_ids }`, `logging_config`, `tracing_config`, `ephemeral_storage` as generated, `filename = "${path.module}/../../bootstrap/placeholder.zip"`, `lifecycle { ignore_changes = [filename, source_code_hash, s3_bucket, s3_key, s3_object_version, publish, environment, description] }`, **no** `environment {}`, `code_sha256`, `skip_destroy`, `publish`, `s3_*`, `image_uri`, `replace_security_groups_on_destroy`, `use_resource_timeout_for_propagation`); `aws_lambda_alias.core_vpc_prod` (`name = var.core_vpc_alias_name`, `function_name = aws_lambda_function.core_vpc.function_name`, `function_version` as read, `lifecycle { ignore_changes = [function_version, description] }`); `aws_lambda_permission.core_vpc` `for_each = local.core_vpc_permissions` (SID → source ARN, the nine pairs of Context, e.g. `"apigw-httpapi-ktbq1sie2c" = "arn:aws:execute-api:ap-southeast-2:622994489535:ktbq1sie2c/*/*/*"`; the map lives in `main.tf`'s `locals`), `statement_id = each.key`, `action = "lambda:InvokeFunction"`, `principal = "apigateway.amazonaws.com"`, `function_name = aws_lambda_function.core_vpc.function_name` (unqualified), `source_arn = each.value`.

6.4 `edge_public.tf`: `aws_cloudwatch_log_group.edge_public`, `aws_lambda_function.edge_public` (`runtime = "nodejs24.x"`, `handler = "src/public/handler.handler"`, `memory_size = 128`, `timeout = 15`, no `vpc_config`, same `filename` + `ignore_changes`, no `environment {}`), `aws_lambda_permission.edge_public` `for_each = local.edge_public_permissions` (the three pairs).

### 7. Module `worker` (`infra/modules/worker`)

7.1 `variables.tf`: `env`, `queue_name`, `function_name`, `alias_name`, `role_arn`, `subnet_ids` (list), `security_group_ids` (list), `tags`. `outputs.tf`: `queue_arn`, `queue_url`, `function_arn`, `alias_arn`, `log_group_name`. `main.tf`: `terraform {}` + `locals`.

7.2 `queue.tf`: `aws_sqs_queue.publish_jobs` (`name = var.queue_name`, `visibility_timeout_seconds = 300`, `message_retention_seconds = 345600`, `max_message_size = 1048576`, `sqs_managed_sse_enabled = true`, the default owner `policy` as generated; no `redrive_policy` — E03).

7.3 `function.tf`: `aws_cloudwatch_log_group.worker` (`/aws/lambda/${var.function_name}`), `aws_lambda_function.worker` (`runtime = "dotnet8"`, `handler = "RecallSmith.Lambda.Worker::RecallSmith.Lambda.Worker.WorkerFunction::FunctionHandler"`, `memory_size = 512`, `timeout = 615`, `role = var.role_arn`, `vpc_config` from vars, same `filename` + `ignore_changes`, no `environment {}`), `aws_lambda_alias.worker_prod` (`ignore_changes = [function_version, description]`), `aws_lambda_event_source_mapping.worker_sqs` with only `batch_size = 1`, `enabled = true`, `event_source_arn = aws_sqs_queue.publish_jobs.arn`, `function_name = aws_lambda_function.worker.arn` (unqualified today; E03 moves it to the alias), `function_response_types = []`, `maximum_batching_window_in_seconds = 60`, `scaling_config { maximum_concurrency = 2 }`, `lifecycle { ignore_changes = [metrics_config] }` — **none** of `starting_position`, `parallelization_factor`, `maximum_record_age_in_seconds`, `maximum_retry_attempts`, `tumbling_window_in_seconds`, `queues`, `topics`, `metrics_config`.

### 8. Module `observability` (`infra/modules/observability`)

`variables.tf`: `env`, `account_id`, `budget_name`, `budget_limit`, `tags`. `outputs.tf`: `budget_name`. `main.tf`: `terraform {}`. `budget.tf`: `aws_budgets_budget.monthly` (`name = var.budget_name`, `budget_type = "COST"`, `time_unit = "MONTHLY"`, `limit_amount = var.budget_limit`, `limit_unit = "USD"`, the three `notification` blocks — ACTUAL > 50, FORECASTED > 85, ACTUAL > 100, `notification_type`/`comparison_operator`/`threshold_type` as generated — each with the live subscriber e-mail as generated; E02 replaces the literal by `var.alert_email`).

### 9. `infra/scripts/check-plan.py` (python3 ≥ 3.8, stdlib only: `argparse`, `json`, `sys`)

Usage line (in the module docstring and `--help`): `check-plan.py --plan PLAN_JSON [--allow ALLOW_JSON] [--expect-imports FILE] [--summary]`; `--plan -` reads stdin. Semantics (E00 §3.1 + gap 4):
- Load the plan; `resource_changes` defaults to `[]`, `output_changes` to `{}`. Skip entries whose `mode` is `"data"`. An entry is *effective* when `change.actions != ["no-op"]`. Action label: `["create"]` → `create`, `["update"]` → `update`, `["delete"]` → `delete`, `["delete","create"]` / `["create","delete"]` → `replace`; anything else → exit 2. Changed keys = `sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))` with `before`/`after` read as `{}` when null.
- With `--allow`: every effective entry must be listed in `changes` with the same action (a string value is the action; an object is `{"action": …, "keys": […]}` and then changed keys ⊆ `keys`); when `tags_only_updates` is true an unlisted `update` whose changed keys ⊆ `{tags, tags_all}` passes; every listed address must be effective in the plan with that action (a stale entry is a violation); with `expect_imports` (allow key, or `--expect-imports` which wins) the set of addresses carrying `change.importing` must equal the file's non-blank stripped lines as a set; every `output_changes` name whose `actions != ["no-op"]` must be in `outputs` (default `[]`).
- Without `--allow` (empty-plan mode): every entry `no-op`, no `importing`, no effective output change → print `PLAN EMPTY`, exit 0.
- Output on success: one line per effective entry `address  actions  keys` (keys comma-joined, `-` when none), then `PLAN OK <n effective>`. `--summary` adds `SUMMARY imports=<n> no-op=<n> create=<n> update=<n> delete=<n> replace=<n> outputs=<n>`. Violations go to stderr as `PLAN VIOLATION: <reason> <address>` and the exit code is 1. **Never print `before`/`after`/`after_unknown` values or import ids.** Exit 2 on unreadable files or bad JSON.
- The file's text (docstring included) never contains `terraform apply`, `terraform import` or an `aws … create-/update-/delete-/put-` command outside `#` comments (apply guard).
- `E01.verify.sh` runs the checker against synthetic fixtures (pass, unlisted `create`, keys overflow, unlisted output, `replace` listed as `update`, `expect_imports` mismatch, stale allow entry, `tags_only_updates`, `mode: "data"`, empty mode) and asserts a sentinel value placed in `before`/`after` never appears in its output.

### 10. Driver files (`docs/delivery/r16-issues/`)

10.1 `E01.imports.txt` — exactly these 93 lines (this is `LC_ALL=C sort -u` order; a trailing newline, nothing else):
```
module.api.aws_apigatewayv2_api.http
module.api.aws_apigatewayv2_authorizer.console
module.api.aws_apigatewayv2_integration.core_vpc
module.api.aws_apigatewayv2_integration.core_vpc_dup["a9dzpce"]
module.api.aws_apigatewayv2_integration.core_vpc_dup["q8lfdrr"]
module.api.aws_apigatewayv2_integration.edge_public
module.api.aws_apigatewayv2_route.this["default"]
module.api.aws_apigatewayv2_route.this["edge_admin_cognito"]
module.api.aws_apigatewayv2_route.this["edge_ai"]
module.api.aws_apigatewayv2_route.this["edge_billing"]
module.api.aws_apigatewayv2_route.this["premium_url"]
module.api.aws_apigatewayv2_route.this["premium_url_dev"]
module.api.aws_apigatewayv2_route.this["proxy"]
module.api.aws_apigatewayv2_route.this["publish_jobs"]
module.api.aws_apigatewayv2_route.this["rc_development"]
module.api.aws_apigatewayv2_route.this["rc_production"]
module.api.aws_apigatewayv2_stage.default
module.api.aws_apigatewayv2_stage.dev
module.api.aws_cloudwatch_log_group.core_vpc
module.api.aws_cloudwatch_log_group.edge_public
module.api.aws_lambda_alias.core_vpc_prod
module.api.aws_lambda_function.core_vpc
module.api.aws_lambda_function.edge_public
module.api.aws_lambda_permission.core_vpc["03895359-3cb1-5e36-9663-2926d577d284"]
module.api.aws_lambda_permission.core_vpc["03c93ce4-7246-50e0-8573-a01d7e580e55"]
module.api.aws_lambda_permission.core_vpc["1e1ab4f0-3e8d-5448-b856-e0981ab47ffc"]
module.api.aws_lambda_permission.core_vpc["810b76d6-7b95-567b-ac2b-5ffc1e5be696"]
module.api.aws_lambda_permission.core_vpc["8707b68d-997f-507d-8399-9bc17c4970d0"]
module.api.aws_lambda_permission.core_vpc["apigw-httpapi-ktbq1sie2c"]
module.api.aws_lambda_permission.core_vpc["b22050a3-bad0-5ea2-a108-a21be6a9f3c0"]
module.api.aws_lambda_permission.core_vpc["bf0bd0f4-d44d-5e2f-9852-8c2a30bbc9af"]
module.api.aws_lambda_permission.core_vpc["ddf85795-8ac8-5e4f-b13e-1305b00a3ba7"]
module.api.aws_lambda_permission.edge_public["3249e15a-5957-5b6d-b271-1c7d73f1c800"]
module.api.aws_lambda_permission.edge_public["666d2528-5c6a-5fce-a7e9-4bbcaae132a9"]
module.api.aws_lambda_permission.edge_public["70ec633b-6621-5c8b-9278-9ba3d2987025"]
module.data.aws_db_instance.developercards
module.data.aws_db_subnet_group.default_vpc
module.data.aws_s3_bucket.content
module.data.aws_s3_bucket.premium
module.data.aws_s3_bucket_ownership_controls.content
module.data.aws_s3_bucket_ownership_controls.premium
module.data.aws_s3_bucket_public_access_block.content
module.data.aws_s3_bucket_public_access_block.premium
module.data.aws_s3_bucket_server_side_encryption_configuration.content
module.data.aws_s3_bucket_server_side_encryption_configuration.premium
module.data.aws_s3_bucket_versioning.content
module.data.aws_s3_bucket_versioning.premium
module.edge.aws_cloudfront_distribution.console
module.edge.aws_cloudfront_distribution.content
module.edge.aws_cloudfront_origin_access_control.console
module.edge.aws_cloudfront_origin_access_control.content
module.edge.aws_s3_bucket.console
module.edge.aws_s3_bucket_ownership_controls.console
module.edge.aws_s3_bucket_policy.console
module.edge.aws_s3_bucket_policy.content
module.edge.aws_s3_bucket_public_access_block.console
module.edge.aws_s3_bucket_server_side_encryption_configuration.console
module.edge.aws_s3_bucket_versioning.console
module.edge.aws_wafv2_web_acl.content
module.identity.aws_cognito_user_group.editor[0]
module.identity.aws_cognito_user_group.super_admin[0]
module.identity.aws_cognito_user_pool.console[0]
module.identity.aws_cognito_user_pool.mobile[0]
module.identity.aws_cognito_user_pool_client.mobile[0]
module.identity.aws_cognito_user_pool_client.spa[0]
module.identity.aws_cognito_user_pool_domain.console[0]
module.identity.aws_cognito_user_pool_domain.mobile[0]
module.identity.aws_iam_policy.core_vpc_logs
module.identity.aws_iam_policy.core_vpc_vpc
module.identity.aws_iam_policy.edge_public_logs
module.identity.aws_iam_policy.snowflake_read
module.identity.aws_iam_role.core_vpc
module.identity.aws_iam_role.edge_public
module.identity.aws_iam_role.rds_monitoring
module.identity.aws_iam_role.snowflake
module.identity.aws_iam_role_policy.edge_public_cognito
module.identity.aws_iam_role_policy_attachment.core_vpc["ec2_full"]
module.identity.aws_iam_role_policy_attachment.core_vpc["logs"]
module.identity.aws_iam_role_policy_attachment.core_vpc["rds_full"]
module.identity.aws_iam_role_policy_attachment.core_vpc["s3_full"]
module.identity.aws_iam_role_policy_attachment.core_vpc["sqs_exec"]
module.identity.aws_iam_role_policy_attachment.core_vpc["sqs_full"]
module.identity.aws_iam_role_policy_attachment.core_vpc["vpc"]
module.identity.aws_iam_role_policy_attachment.edge_public_logs
module.identity.aws_iam_role_policy_attachment.rds_monitoring
module.identity.aws_iam_role_policy_attachment.snowflake["read"]
module.identity.aws_iam_role_policy_attachment.snowflake["s3_full"]
module.observability.aws_budgets_budget.monthly
module.worker.aws_cloudwatch_log_group.worker
module.worker.aws_lambda_alias.worker_prod
module.worker.aws_lambda_event_source_mapping.worker_sqs
module.worker.aws_lambda_function.worker
module.worker.aws_sqs_queue.publish_jobs
```
10.2 `E01.plan-allow.json` — this object (key order free, no comments, `json.load`-able):
```json
{
  "tags_only_updates": false,
  "expect_imports": "docs/delivery/r16-issues/E01.imports.txt",
  "outputs": ["api_id", "api_endpoint", "content_distribution_id", "content_domain_name", "console_distribution_id", "console_domain_name", "core_vpc_alias_arn", "worker_alias_arn", "queue_url", "db_address", "console_pool_endpoint", "mobile_pool_endpoint"],
  "changes": {
    "module.data.aws_db_instance.developercards": { "action": "update", "keys": ["apply_immediately", "final_snapshot_identifier", "skip_final_snapshot"] }
  }
}
```

### 11. Procedure (what to actually do, in order; budget ≈ 2 h)

1. `export AWS_PROFILE=dev TF_PLUGIN_CACHE_DIR="$HOME/.terraform.d/plugin-cache"; mkdir -p "$TF_PLUGIN_CACHE_DIR"`; confirm `aws sts get-caller-identity` prints account `622994489535`.
2. Write changes 1, 2.1–2.4, 2.8, the lock stub (gap 5) and the six module skeletons (`main.tf`/`variables.tf`/`outputs.tf`).
3. Scratch generation (gap 9): `G="${TMPDIR:-/tmp}/e01-gen-$$"; mkdir -p "$G"`; copy `versions.tf` + `providers.tf` (no `backend.tf`, so no override is needed there); write 93 root-level `import {}` blocks with flat names (`aws_iam_role_policy_attachment.core_vpc_sqs_exec`, `aws_apigatewayv2_route.premium_url`, `aws_lambda_permission.core_vpc_apigw_all` …; the WAF block needs `provider = aws.use1` here because there is no module); `terraform init -backend=false -input=false`, `terraform plan -generate-config-out=generated.tf -input=false` (≈ 3 min; validation errors on the three Lambda/ESM/RDS types are expected and do not stop generation); read `generated.tf`, curate into the module files per changes 3–8 and E00 §2.1.4 (delete every `environment {}` block, `region`, `tags`, `tags_all`, `deployment_id`, the forbidden Lambda/ESM/RDS attributes; replace literals by references); `rm -rf "$G"`.
4. Write `imports.tf` (2.7), `main.tf` (2.6), `outputs.tf` (2.5), `check-plan.py` (9), the driver files (10), `README.md`, `RUNBOOK.md`.
5. Loop until green (each plan ≈ 2–4 min), from the worktree root: `terraform fmt -recursive infra` → write `infra/envs/prod/backend_override.tf` (gap 13, `path = "${TMPDIR:-/tmp}/e01-state/terraform.tfstate"`) → `terraform -chdir=infra/envs/prod init -input=false && terraform -chdir=infra/envs/prod validate` → `TF_VAR_snowflake_external_id="$(aws iam get-role … --output text)" terraform -chdir=infra/envs/prod plan -input=false -out=/tmp/e01.tfplan` → `terraform -chdir=infra/envs/prod show -json /tmp/e01.tfplan > /tmp/e01.plan.json` → `python3 infra/scripts/check-plan.py --plan /tmp/e01.plan.json --allow docs/delivery/r16-issues/E01.plan-allow.json --summary` (paths in the allow file are cwd-relative: always run the checker from the repo root) → fix whatever is not `no-op` (an unexpected `update` means an attribute you set differs from live: read the changed key, look at `generated.tf`'s value, never at the plan's `after`) → `rm -f /tmp/e01.tfplan /tmp/e01.plan.json`. When green: `rm -f infra/envs/prod/backend_override.tf && rm -rf infra/envs/prod/.terraform` and confirm the root gate (`terraform init -backend=false -input=false && terraform validate`) still passes.
6. `terraform providers lock -platform=darwin_arm64 -platform=linux_amd64` in `infra/envs/prod`; `rm -rf infra/envs/prod/.terraform`.
7. `BASE=delivery/r16-e-prod bash docs/delivery/r16-issues/E01.verify.sh`.

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/E01.verify.sh` re-runs exactly these.

1. Scope files exist: all 46 files of Constraints §Scope, in particular `infra/envs/prod/main.tf` (absent on base) and `infra/scripts/check-plan.py`.
2. Literal guards (all exit 0): `backend.tf` is byte-identical to change 2.3; `versions.tf` has `required_version = ">= 1.10"`, `source = "hashicorp/aws"`, `version = "~> 6.0"`; `providers.tf` has `alias = "use1"`, `region = "us-east-1"`, `region = "ap-southeast-2"` and no `profile` (attribute checks run on an `=`-normalised copy, so `terraform fmt` alignment never matters); the lock selects `6.66.0` with `constraints = "~> 6.0"` and at least two `h1:` hashes; `.gitignore` has the nine lines; `placeholder.zip` lists exactly `README` at 0 bytes; every module's `variables.tf`/`outputs.tf` declares every name of changes 3–8; `edge/main.tf` has `configuration_aliases = [aws.use1]`; `cdn.tf` has `provider = aws.use1`, `scope = "CLOUDFRONT"`, `description = ""` and `description = "Created by CloudFront"`; root `main.tf` has the six `module "…"` blocks, `aws.use1 = aws.use1`, `manage_cognito = true`, six `env = "prod"`; every id/name of change 2.4 appears under `infra/envs/prod`; `imports.tf` has 93 `import {` blocks, a `to =` line for every address of 10.1 and an `id =` line for every import id of E00 §2.1.2; the three function files carry the placeholder `filename` and the eight-item `ignore_changes`; both alias files carry `ignore_changes = [function_version, description]`; `function.tf` has `ignore_changes = [metrics_config]` and none of the seven Kinesis-only attributes; `gateway.tf` has `name = "cognito-jwt"`, `authorization_type = "NONE"`, `disable_execute_api_endpoint = false` and no `deployment_id`; `rds.tf` has `engine_version = "17.9"`, `skip_final_snapshot = false`, `final_snapshot_identifier = "developercards-final-tf"`, `apply_immediately = false`, `prevent_destroy = true` and none of the fourteen forbidden attributes; `status = "Disabled"` ×2 in `buckets.tf` and ×1 in `console_bucket.tf`; `prevent_destroy = true` ×2 in `buckets.tf` and ×1 in `rds.tf`, ×0 in `console_bucket.tf`; `path = "/service-role/"` ≥ 2 in `identity/main.tf`; `count = var.manage_cognito ? 1 : 0` ≥ 8 in `cognito.tf`; no `tags =`/`tags_all =`/`default_tags`/`environment {`/`provisioner`/`local-exec`/`null_resource`/`archive_file`/`terraform_remote_state`/`data "external"` line under `infra/`; `check-plan.py` compiles, imports only stdlib, and contains `--plan`, `--allow`, `--expect-imports`, `--summary`, `tags_only_updates`, `expect_imports`, `resource_changes`, `output_changes`, `importing`, `PLAN OK`, `PLAN EMPTY`, `PLAN VIOLATION`; `E01.imports.txt` is byte-identical to 10.1; `E01.plan-allow.json` parses to 10.2; `README.md` has the six headings, the safety-rule sentence and the root gate; `RUNBOOK.md` has its six headings; no suppression token, no secret-value pattern, no unspellable env-var name in any new file.
3. Gates: `terraform fmt -check -recursive infra` (repo root); `cd infra/envs/prod && terraform init -backend=false -input=false && terraform validate && terraform fmt -check -recursive ..`.
4. Plan (read-only, `AWS_PROFILE=dev`, ≈ 2–4 min): the verify writes its own `backend_override.tf` (local state under its temp dir), `terraform init -input=false`, `terraform plan -input=false -out=$TMP/e01.tfplan` → `terraform show -json` → (a) an independent check inside the verify: every managed entry is `importing`, the importing set equals 10.1, every entry is `no-op` except `module.data.aws_db_instance.developercards` = `update` with changed keys ⊆ `{apply_immediately, final_snapshot_identifier, skip_final_snapshot}`, no `create`/`delete`/`replace`, every effective output name ∈ the twelve of 10.2; (b) `python3 infra/scripts/check-plan.py --plan … --allow docs/delivery/r16-issues/E01.plan-allow.json` exits 0 and prints `PLAN OK 1`; (c) the checker passes the negative fixtures of change 9 and never prints the sentinel; (d) the plan files are deleted.
5. Scope + frozen + OTA + apply guard: every changed or untracked path under `infra` / `docs` is in the scope list; the three frozen files and the four mobile manifests are zero-diff; `"version": "1.6.1"` in `mobile/app.json`; no `@sentry` under `mobile/src`; no tracked `.tfplan`/`.plan.json`/`generated*.tf`/`*.auto.tfvars`; no non-comment line in `infra/scripts/*`, `infra/**/*.sh`, `infra/**/*.py` or `E01.verify.sh` runs `terraform apply`/`terraform import`/`aws … create-|update-|delete-|put-`.

## Verify

```bash
AWS_PROFILE=dev BASE=delivery/r16-e-prod bash docs/delivery/r16-issues/E01.verify.sh
```

Runs steps 1–5 (≈ 5–7 min; the plan dominates; `terraform init` downloads hashicorp/aws 6.66.0 once into `TF_PLUGIN_CACHE_DIR`). The driver then runs the `infra` root gate, the diff-scoped banned-term grep and the suppression scan. **The supervisor applies**: after merge it creates `recallsmith-tfstate-622994489535`, runs `terraform init` with the real backend, `terraform plan -out`, the same allow-list check, `terraform apply` (state-only), and a second plan that must print `PLAN EMPTY` — none of that is the worker's, and the worker's plan must already be exactly what the supervisor will see.

## Do NOT

- Do NOT run `terraform apply`, `terraform import`, `terraform state …`, `terraform init` with the S3 backend, or any `aws … create-/update-/delete-/put-` command; do NOT create the state bucket.
- Do NOT rename, retag, or "tidy" any adopted resource (duplicate integrations, the nine permission statements, the `dev` stage and alias targets stay as they are); do NOT set `password`, `username`, `db_name` or `tags` anywhere; do NOT add `default_tags`, `provisioner`, `null_resource`, `archive_file`, `terraform_remote_state`, a seventh module or `infra/envs/staging`.
- Do NOT write an `environment {}` block, a Lambda env-var value, the Snowflake ExternalId or any plan JSON into a file under git; do NOT paste plan output beyond `check-plan.py`'s lines into the PR/issue text.
- Do NOT commit `generated*.tf`, `.terraform/`, `*.tfplan`, `*.plan.json` or a real `prod.auto.tfvars`; do NOT run `-generate-config-out` inside the worktree.
- Do NOT edit any file outside `infra/` and the two `docs/delivery/r16-issues/E01.*` driver files; do NOT touch `mobile/`, `frontend/`, `src_C/`, `.github/`, `scripts/`.
- Do NOT run npm or git inside `/Users/qc/src/recallsmith` or anywhere under `/Users/qc/Desktop` — only inside your worktree.
