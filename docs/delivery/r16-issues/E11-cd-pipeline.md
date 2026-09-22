# E11 — CD with OIDC (`cd-pipeline`)

Give the repo a deploy path that a human never types: GitHub Actions assumes three new IAM roles through the GitHub OIDC provider (no long-lived keys), and `main` flows test → staging deploy → staging smoke → **approval** → prod deploy (RDS snapshot, migrations run on the freshly published Lambda version *before* the alias moves, console deploy) → prod smoke → automatic alias rollback when the smoke fails. A `v*` tag publishes the OTA; a PR touching `infra/**` posts a plan summary; a push to `main` touching `infra/**` applies behind a second approval. Terraform side: `modules/identity/oidc.tf` (provider + `developercards-gha-plan` / `-staging` / `-prod`), wired from both roots. Script side: `scripts/smoke.sh`, `scripts/rollback.sh`, one additive hook in `src_C/deploy.sh`. Nothing here is executed by the worker against AWS beyond `terraform plan` and read-only CLI; the supervisor applies the two plans and the owner configures the GitHub environments.

## Context

Base `delivery/r16-e-prod` (== `origin/main@4b07f19`, JWT verification merged). E11 is queued **after E12** (E00 §4: `… → E10 → E12 → E11 → E13 …`), so your worktree also holds E01–E10 and E12 when you start; every `file:line` below was read on `4b07f19` on 2026-09-22 and the merged files are named by their E00 contract. Every AWS fact: `AWS_PROFILE=dev`, account `622994489535`, `ap-southeast-2`, describe/get/list only.

What the tree and the account look like today:

- **CI exists, CD does not.** `.github/workflows/ci.yml` is the only workflow: `on: push: / pull_request:` (`:3-5`), four jobs `mobile` (`:8-36`), `frontend` (`:38-98`, `npm run build` with `VITE_BUILD_ID: ${{ github.sha }}` at `:88-98`), `e2e` (`:100-151`), `backend` (`:153-168`, `dotnet test Tests/RecallSmith.Lambda.IntegrationTests`). It has no `workflow_call:` trigger, so nothing can reuse it. GitHub: `gh api repos/ChuanQiao1128/recallsmith/environments --jq .total_count` → `0`; `gh secret list` → empty; the repo is public (`.private == false`), default branch `main`.
- **No OIDC provider, no CI roles.** `aws iam list-open-id-connect-providers` → `[]`; `aws iam list-roles --query "Roles[?starts_with(RoleName,'developercards-gha')]"` → `[]`. The Terraform state bucket `recallsmith-tfstate-622994489535` does not exist today (`head-bucket` → 404; the supervisor creates it before applying E01, E00 §0) — by E11 it exists and holds `envs/prod/terraform.tfstate` and `envs/staging/terraform.tfstate`.
- **`src_C/deploy.sh` today** (`:12-58`): `export AWS_PROFILE="${AWS_PROFILE:-dev}"` (`:14`), `PUBLISH_ALIAS` (`:44`), `deploy_one` does `update-function-code` → `wait function-updated` → CodeSha256 check → `publish-version` (`:47`) → `update-alias` (`:48`) → alias sha check (`:49-51`), `DRY_RUN=1` returns at `:27`. Its header says migrations are NOT run here (`:10-11`). E06 rewrites it (E00 §2.6.3: `ENV="${ENV:-prod}"`, `env/${ENV}.env.json`, the SSM overlay before `publish-version`, `merge_env()` in `src_C/scripts/merge-env.sh`) with the **same CLI contract** — `ENV`, `ONLY`, `DRY_RUN`, `PUBLISH_ALIAS`, `VPC_FN`, `WORKER_FN` all survive. Nothing in E06 or E12 invokes the just-published version to run migrations; that hook is this issue's (E00 §6 #17, see "Resolutions" below).
- **`frontend/deploy.sh`** (`:6-28`): `CONSOLE_BUCKET` (`:9`), `CONSOLE_DISTRIBUTION_ID` (`:10`), `DRY_RUN=1` (`:15-18`), hash check against the hard-coded CloudFront host at `:26`. E09 makes that `CONSOLE_URL="${CONSOLE_URL:-https://console.developercards.app}"` (E00 §2.9.5); every value the staging job needs is an env override. Vite gives process env priority over `.env.production`, so the staging build sets `VITE_API_BASE`, `VITE_COGNITO_CLIENT_ID`, `VITE_COGNITO_REDIRECT_URI`, `VITE_COGNITO_LOGOUT_URI` in the job and never edits `frontend/.env.production` (`:11-16` today).
- **Every AWS script defaults `AWS_PROFILE=dev`** (`src_C/deploy.sh:14`, `frontend/deploy.sh:8`; E02's `rds-snapshot.sh` and E06's `invoke-as-admin.sh` follow the same shape). The AWS CLI refuses to start when `AWS_PROFILE` names a profile that does not exist, even with credentials in the environment, so every CD job that calls a script first creates an empty `dev` profile (`aws configure set region ap-southeast-2 --profile dev`); credentials then come from the environment that `aws-actions/configure-aws-credentials` populates (env vars win over profile credentials).
- **API shapes the smoke relies on** (`src_C/Vpc/VpcFunction.cs`): `GET …/health` → `res.Ok(new { ok = true })` (`:105`); `POST /api/v1/authoring/decks` (`:169-172`; `Decks.cs:114-132` requires `slug`, `title`, `author`, super_admin, returns the row with `id`), `DELETE /api/v1/authoring/decks?id=<id>` soft-deletes (`Decks.cs:264-278`, `is_deleted = 1`); `POST /api/v1/authoring/cards` (`:183-186`; `Cards.cs:108-121` requires `deckId`, `stableUid`, `question`, `orderInDeck`); `POST /api/v1/authoring/publish` `{deckId}` → `{ mode: "async", jobId }` (`Publish.cs:348-352`); `GET /api/v1/authoring/publish/status?jobId=` → `{ jobId, status, buildId, s3Key, errorMessage }` (`PublishStatus.cs:18-44`); `POST /api/v1/admin/manifest/rebuild` (`:207-210`, super_admin); `GET /api/v1/authoring/dashboard` (`:212-215`). Every body is the envelope `{ success, data, error, traceId, version }` (`Res.cs:145-157`, `:204-211`, camelCase `:94-97`) — read `.data.*`. The manifest is `{ schemaVersion: 2, prefix, generatedAtMs, decks: [{ slug, …, version, buildId, … }] }` (`ManifestRebuild.cs:266-356`; E03's `ManifestBuilder` keeps the key set) and is served with `s-maxage=60` (`:66`), so a CDN read can lag a rebuild by up to 60 s. Manifest excludes `is_deleted` decks (`:146`).
- **E12's internal event** (E00 §2.11): `{ "source": "developercards.scheduler", "action": "<action>", "args": {…}, "traceId": "…" }` is the only non-HTTP shape `VpcFunction.Handler` accepts; actions include `db/migrate` (`args.dryRun`), `health/deep` (`{ ok, schemaVersion, required }`) — success returns an `APIGatewayProxyResponse` (`statusCode`, `body` = envelope), failure **throws** (→ `FunctionError` on `aws lambda invoke`). No migrate secret on this path: `lambda:InvokeFunction` is the trust boundary.
- **Names this issue wires (all from E00, none new):** functions `core-vpc` / `worker-lambda` (aliases `prod`, versions 48 / 4 today), `core-vpc-staging` / `worker-lambda-staging` (aliases `staging`, E10); console buckets `recallsmith-console-622994489535` / `developercards-console-staging` (E10) behind distributions tagged `Env = prod|staging` by E02's `default_tags`; SSM `/developercards/<env>/*` (E06); `infra/scripts/rds-snapshot.sh <label>` with `label ~ ^[a-z0-9-]{1,40}$` (E02); hostnames `api[-staging].developercards.app`, `cdn[-staging].`, `console[-staging].` (E09/E10); `scripts/invoke-as-admin.sh <function[:qualifier]> <METHOD> <path> [body-file]` printing the body only (E06).
- **Terraform module `identity`** (E01 + E05 + E06 + E08 + E10): takes only strings — never another module's output (E00 §2.1.1, §6 #13) — and already has `env`, `account_id`, `region`, `core_vpc_function_name`, `worker_function_name`, `content_bucket_name`, `premium_bucket_name`, `publish_queue_name`, `secret_parameter_names`. The staging console distribution id is an `edge` output of the *staging* root, so it can never be an `identity` input; the deploy role therefore scopes `cloudfront:CreateInvalidation` by `aws:ResourceTag/Env` (the tag every distribution carries after E02) instead of by id.

**Resolutions recorded for the supervisor (E00 wins where it speaks; these fill its gaps):**
1. **`src_C/deploy.sh` gains one hook** (`migrate_by_version`, ≈ 20 added lines, between `publish-version` and `update-alias`). E00 §1.2 lists `deploy.sh` under E06/E13 only, but §2.12 ("whose new version is invoked with `db/migrate` by version number before the alias moves") and §6 #17 require the behaviour and no earlier contract places it. Default on (`MIGRATE_ON_PUBLISH=1`) so the supervisor's manual `./deploy.sh` gets the same safe order; `0` opts out. E13's later edit is to `env/prod.env.json`, not to `deploy.sh`.
2. **Prod smoke and rollback are steps of the `deploy-prod` job, not separate jobs.** GitHub asks the required reviewer once per *job* that references a reviewer-protected environment; a separate `rollback` job in `environment: production` would sit waiting for a human while prod is broken. Step ids `smoke-prod` and `rollback` keep E00's vocabulary; `rollback` runs `if: failure()` after `steps.prev` succeeded.
3. **`developercards-gha-prod` also trusts `environment:infra-prod`** — E00 §2.12 puts `terraform.yml`'s apply in that environment and gives the apply rights to `gha-prod`; without the extra `sub` value the job cannot assume the role.
4. **CI plans need the real (non-secret) tfvars.** `prod.auto.tfvars` / `staging.auto.tfvars` are gitignored; `terraform.yml` writes them from the repository secrets `TFVARS_PROD` / `TFVARS_STAGING` (owner-set, file contents) before `init`. Values are masked in logs; the plan file is never uploaded.
5. **Worker plans follow the wave convention set by E06/E10/E12, not E00 §5's empty-state-only wording.** By E11 an empty-state plan of the prod root re-creates everything E02–E12 added, so "nothing else" cannot be judged there. Your verify plans prod **against the real backend, read-only** (`terraform init -reconfigure` in a copy of `infra/` reads the state object; `plan -lock=false` never writes the `.tflock`; the real `prod.auto.tfvars` is gitignored, so the verify derives one from the `.example` file plus two read-only lookups for `alert_email` and `snowflake_external_id`) and requires the effective set to be exactly the seven creates below, then runs `check-plan.py` with `E11.plan-allow.json` — the same check the supervisor runs. Staging (born in E10, no `imports.tf`) is planned against an empty local state — E01's gitignored `backend_override.tf` written into each scratch copy, `terraform init -input=false -reconfigure` (`init -backend=false` cannot serve `plan`, E00 §6 #25) — at HEAD and at the merge-base tree; every action must be `create` and the delta exactly the two root-level creates below (E00 §6 #34: the staging root has no `module "identity"`).
6. **`cd.yml` also has `workflow_dispatch:`** so the supervisor can run it from `delivery/r16-e-prod` before the wave lands on `main` (environment deployment-branch rules are the owner's).

## Read first

1. `docs/delivery/r16-issues/E00-contracts.md` §0 (`:9-37`), §1.1 rows for `identity` (`:55-59`) and the staging root (`:54`), §1.2 row `.github/workflows/…` (`:104`), §2.1.1 identity interface (`:118-138`), §2.1.3 names (`:205`), §2.6.3–2.6.4 (`deploy.sh`, `invoke-as-admin.sh`, `:294-295`), §2.10 (`:351-357`), §2.11 (`:359-379`), **§2.12 (`:381-385`)**, §3.1 (`:419-430`), §3.4 (`:440-442`), §4 (`:446-466`), §5 (`:470-482`), §6 #8, #12, #17, #18 (`:493`, `:497`, `:502`, `:503`).
2. `.github/workflows/ci.yml` whole file (168 lines) — the four jobs `cd.yml` reuses and the action pins (`actions/checkout@v5`, `setup-node@v5`, `setup-dotnet@v5`, `upload-artifact@v4`).
3. `src_C/deploy.sh` as merged by E06 (whole file) and `src_C/package_lambda_zip.sh:1-40`; `frontend/deploy.sh` as merged by E09 (whole file).
4. `infra/modules/identity/{main,variables,outputs}.tf`, `policies.tf` (E05 — copy its `jsonencode` policy style and Sid discipline), `ssm.tf` (E06); `infra/envs/prod/main.tf` and `infra/envs/staging/main.tf` (the two `module "identity"` blocks you extend); `infra/README.md` §2, §3, §6; `infra/scripts/check-plan.py`, `infra/scripts/rds-snapshot.sh`.
5. `scripts/invoke-as-admin.sh` (E06) — argument order and that it prints the body only.
6. `src_C/Vpc/Internal/InternalEvents.cs` (E12) — the `db/migrate` and `health/deep` handler keys and the throw-on-failure rule; `src_C/Vpc/VpcFunction.cs:100-216` (routes named above); `src_C/Shared/RecallSmith.Lambda.Common/Res.cs:94-97`, `:139-157`, `:204-211`.
7. `docs/delivery/r16-issues/C07-topic-mobile.md` + `C07.verify.sh` and `C05-topic-server.md` (format only).

## Constraints

- **Scope (the ONLY files that may change):**
  1. `.github/workflows/ci.yml` — exactly one added line, `  workflow_call:` (numstat `1	0`).
  2. `.github/workflows/cd.yml` (new)
  3. `.github/workflows/ota.yml` (new)
  4. `.github/workflows/terraform.yml` (new)
  5. `scripts/smoke.sh` (new, `chmod +x`)
  6. `scripts/rollback.sh` (new, `chmod +x`)
  7. `src_C/deploy.sh` — the `migrate_by_version` hook only (Changes 7)
  8. `infra/modules/identity/oidc.tf` (new)
  9. `infra/modules/identity/variables.tf`, `infra/modules/identity/outputs.tf` — append only
  10. `infra/envs/prod/main.tf` — lines added inside the existing `module "identity" { … }` block only; `infra/envs/staging/main.tf` — one appended section (Changes 3: the two inline root resources `aws_iam_role.gha_deploy` + `aws_iam_role_policy.gha_deploy`; the staging root has no `module "identity"`, E00 §6 #28/#34)
  11. `infra/README.md` — one dated line appended to §6
  12. `docs/delivery/r16-issues/E11.plan-allow.json`, `docs/delivery/r16-issues/E11.staging.plan-allow.json` (new)
  Nothing else: no `infra/envs/*/imports.tf`, `variables.tf`, `outputs.tf`, `*.auto.tfvars.example`; no other module; no `mobile/`, `frontend/`, `site/`, `snowflake/`; no `.cs`, `.csproj`, `.sql`; no `src_C/scripts/*`; no `README.md`; no `docs/runbooks/*` (E15).
- **WORKER SAFETY RULE (verbatim):** a worker may run read-only AWS CLI, `terraform init/validate/plan` (plan must be saved with -out and shown as JSON), but NEVER `terraform apply`, `terraform import` (state-changing), `aws ... create/update/delete/put`, `eas`, or any deploy script. The supervisor applies plans after each merge. Each infra brief's verify.sh therefore checks the PLAN (terraform show -json) against an explicit allow-list of resource addresses and actions — nothing else may appear as create/update/delete.
  Consequences here: you *write* `cd.yml`, `terraform.yml`, `smoke.sh`, `rollback.sh` and the `deploy.sh` hook — you never run them except `bash -n` and `DRY_RUN=1`; you never `gh workflow run`, `gh secret set`, `gh api -X PUT`, `aws configure`, `eas …`; `aws iam simulate-custom-policy` and `aws sts get-caller-identity` are the only AWS calls your verify makes besides `terraform plan`'s own reads. `terraform init -backend=false -input=false` serves `validate`; the prod plan reads the real backend (`init -input=false -reconfigure` + `plan -lock=false`, read-only, in a scratch copy) and the two staging plans use E01's gitignored `backend_override.tf` in scratch copies (E00 §6 #25). The state bucket is never written.
- **Frozen files — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. **OTA rule:** nothing under `mobile/` changes at all (`mobile/package.json`, `package-lock.json`, `app.json` (`"version": "1.6.1"`), `eas.json` included); no `@sentry/*`.
- **Terraform rules (E00 §0, §2.1):** `hashicorp/aws ~> 6.0`, lock files untouched; provider blocks carry no `profile`; no `provisioner`, `local-exec`, `null_resource`, `external`, `archive_file`; `jsonencode` for every policy document; identity takes only strings (no `module.*` output, no `data.aws_iam_openid_connect_provider` — the provider ARN is computed from `var.account_id`); no rename of any existing resource; new names carry the `developercards-` prefix; `terraform fmt` clean.
- **Secrets:** no secret value in any `.tf`, `.yml`, `.sh`, `.json`, `.md`, verify output or PR text. `EXPO_TOKEN`, `TFVARS_PROD`, `TFVARS_STAGING` are referenced as `${{ secrets.… }}` only. No `aws-access-key-id`, `AWS_SECRET_ACCESS_KEY`, `AWS_ACCESS_KEY_ID` anywhere in `.github/`. Plan JSON is never uploaded or echoed beyond address/action lines (`jq` projection, Changes 4).
- **Banned literals in any added line** (driver gate, case-insensitive): the six terms of B00 §0 — do not reproduce them, not even in a YAML comment; say "sidestep", "work around", "guard", "fallback", "probe". No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(`, `#pragma warning disable`, `[Fact(Skip` in any added line. Never spell the two core-vpc env-var names E00 §0 calls unspellable (the deploy overlay keeps them without naming them).
- **Tests:** no existing test file changes (`src_C/Tests/**`, `frontend/tests/**`, `mobile/tests/**` are byte-identical). No new test file (this issue's checks are `bash -n`, YAML parse, `actionlint`, `DRY_RUN=1` runs, the read-only plans of Verify step 4, `simulate-custom-policy`).
- Standing rules: no `git push`, no PR, never touch `main`, no `npm install`/`npm ci`/`dotnet restore` beyond the implicit local-cache restore of `DRY_RUN=1 ./deploy.sh`, no npm/git activity outside your worktree.

## Changes required

### 1. `infra/modules/identity/variables.tf` — append (defaults keep E01–E10 callers valid)

```hcl
variable "github_repo"             { type = string;       default = "ChuanQiao1128/recallsmith" }   # owner/name; never renamed in this wave
variable "manage_github_oidc"      { type = bool;         default = false }   # prod true: creates the OIDC provider + developercards-gha-plan
variable "gha_deploy_role_name"    { type = string;       default = null }    # prod: "developercards-gha-prod"; null = no deploy role (the staging role is inline in the staging root, E00 §6 #34)
variable "gha_deploy_environments" { type = list(string); default = [] }      # GitHub environment names admitted by the trust: prod ["production", "infra-prod"], staging ["staging"]
variable "gha_deploy_admin"        { type = bool;         default = false }   # prod true: AdministratorAccess on the deploy role (E00 §6 #12)
variable "console_bucket_name"     { type = string;       default = null }    # the console bucket the deploy role may sync
variable "tfstate_bucket_name"     { type = string;       default = "recallsmith-tfstate-622994489535" }
variable "db_identifier"           { type = string;       default = null }    # prod "developercards": rds:CreateDBSnapshot for the pre-deploy snapshot
```
(One attribute per line, `terraform fmt` style — the one-liners above are for reading.) `outputs.tf` — append:
```hcl
output "github_oidc_provider_arn" { value = local.github_oidc_provider_arn }
output "gha_plan_role_arn"        { value = var.manage_github_oidc ? aws_iam_role.gha_plan[0].arn : null }
output "gha_deploy_role_arn"      { value = var.gha_deploy_role_name == null ? null : aws_iam_role.gha_deploy[0].arn }
output "gha_deploy_role_name"     { value = var.gha_deploy_role_name }
```

### 2. `infra/modules/identity/oidc.tf` (new) — provider + roles, addresses pinned

```hcl
locals {
  github_oidc_provider_arn = "arn:aws:iam::${var.account_id}:oidc-provider/token.actions.githubusercontent.com"
  gha_plan_subs   = ["repo:${var.github_repo}:pull_request", "repo:${var.github_repo}:ref:refs/heads/main"]
  gha_deploy_subs = [for e in var.gha_deploy_environments : "repo:${var.github_repo}:environment:${e}"]
  gha_lambda_arns = flatten([for fn in [var.core_vpc_function_name, var.worker_function_name] :
    ["arn:aws:lambda:${var.region}:${var.account_id}:function:${fn}", "arn:aws:lambda:${var.region}:${var.account_id}:function:${fn}:*"]])
}

resource "aws_iam_openid_connect_provider" "github" {          # module.identity.aws_iam_openid_connect_provider.github[0]
  count           = var.manage_github_oidc ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1", "1c58a3a8518e8759bf075b76b750d4f2df264fcd"]
}
```
Trust document (one `local.gha_trust(subs)` is not expressible; write it twice with `jsonencode`):
```hcl
{ Version = "2012-10-17", Statement = [{ Sid = "GitHubActionsOidc", Effect = "Allow",
    Principal = { Federated = local.github_oidc_provider_arn }, Action = "sts:AssumeRoleWithWebIdentity",
    Condition = { StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com",
                                   "token.actions.githubusercontent.com:sub" = local.gha_plan_subs } } }] }   # gha_deploy: local.gha_deploy_subs
```
- `aws_iam_role.gha_plan[0]` (`count = var.manage_github_oidc ? 1 : 0`, `name = "developercards-gha-plan"`, `max_session_duration = 3600`, `depends_on = [aws_iam_openid_connect_provider.github]`);
  `aws_iam_role_policy_attachment.gha_plan_readonly[0]` → `arn:aws:iam::aws:policy/ReadOnlyAccess`;
  `aws_iam_role_policy.gha_plan_tfstate[0]` (`name = "tfstate"`), statements: `TfstateList` `s3:ListBucket` on `arn:aws:s3:::${var.tfstate_bucket_name}`; `TfstateRead` `s3:GetObject` on `arn:aws:s3:::${var.tfstate_bucket_name}/envs/*`; `TfstateLock` `s3:PutObject`, `s3:DeleteObject` on `arn:aws:s3:::${var.tfstate_bucket_name}/envs/*/terraform.tfstate.tflock` (the S3-native lock object — never the state object itself).
- `aws_iam_role.gha_deploy[0]` (`count = var.gha_deploy_role_name == null ? 0 : 1`, `name = var.gha_deploy_role_name`, same trust with `local.gha_deploy_subs`, `depends_on = [aws_iam_openid_connect_provider.github]`, `lifecycle { precondition { condition = var.console_bucket_name != null, error_message = "console_bucket_name is required with gha_deploy_role_name" } }`);
  `aws_iam_role_policy.gha_deploy[0]` (`name = "deploy"`), statements in this order, Sids fixed:
  | Sid | Action | Resource | Condition |
  |---|---|---|---|
  | `LambdaDeploy` | `lambda:GetFunction`, `lambda:GetFunctionConfiguration`, `lambda:GetAlias`, `lambda:ListVersionsByFunction`, `lambda:UpdateFunctionCode`, `lambda:UpdateFunctionConfiguration`, `lambda:PublishVersion`, `lambda:UpdateAlias`, `lambda:InvokeFunction` | `local.gha_lambda_arns` | — |
  | `ConsoleBucketObjects` | `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` | `arn:aws:s3:::${var.console_bucket_name}/*` | — |
  | `ConsoleBucketList` | `s3:ListBucket` | `arn:aws:s3:::${var.console_bucket_name}` | — |
  | `ConsoleInvalidate` | `cloudfront:CreateInvalidation`, `cloudfront:GetInvalidation` | `arn:aws:cloudfront::${var.account_id}:distribution/*` | `StringEquals { "aws:ResourceTag/Env" = var.env }` |
  | `ConsoleList` | `cloudfront:ListDistributions` | `*` | — (the only bare `*`) |
  | `SsmRead` | `ssm:GetParameter`, `ssm:GetParameters`, `ssm:GetParametersByPath` | `arn:aws:ssm:${var.region}:${var.account_id}:parameter/developercards/${var.env}`, `…/developercards/${var.env}/*` | — |
  | `SsmDecrypt` | `kms:Decrypt` | `arn:aws:kms:${var.region}:${var.account_id}:key/*` | `StringEquals { "kms:ViaService" = "ssm.${var.region}.amazonaws.com" }` |
  | `RdsSnapshot` (only when `var.db_identifier != null`, via `concat`) | `rds:CreateDBSnapshot`, `rds:DescribeDBSnapshots`, `rds:AddTagsToResource` | `arn:aws:rds:${var.region}:${var.account_id}:db:${var.db_identifier}`, `arn:aws:rds:${var.region}:${var.account_id}:snapshot:${var.db_identifier}-*` | — |
  `aws_iam_role_policy_attachment.gha_deploy_admin[0]` (`count = var.gha_deploy_admin ? 1 : 0`) → `arn:aws:iam::aws:policy/AdministratorAccess`.
- No statement anywhere has `Action = "*"` or `<service>:*`; no `ssm:PutParameter`, no `iam:*`, no `s3:*` on the content/premium buckets (the deploy roles never touch content; the worker/API roles of E05 do).

### 3. Root wiring (inside the existing `module "identity" { … }` blocks, additive)

`infra/envs/prod/main.tf`:
```hcl
  # E11 — GitHub Actions OIDC: the provider and the plan role are prod-owned; the prod deploy role is Admin (E00 §6 #12)
  manage_github_oidc      = true
  gha_deploy_role_name    = "developercards-gha-prod"
  gha_deploy_environments = ["production", "infra-prod"]
  gha_deploy_admin        = true
  console_bucket_name     = "recallsmith-console-622994489535"
  db_identifier           = "developercards"
```
`infra/envs/staging/main.tf` — the staging root instantiates only `api` and `worker` (E10 R1, E00 §6 #28), so the staging deploy role is **inline**, appended as section `k. GitHub Actions deploy role (E11)` after E10's `j.`, addresses `aws_iam_role.gha_deploy` and `aws_iam_role_policy.gha_deploy` (root-level, no `[0]`, no `count`; the two headers verbatim `resource "aws_iam_role" "gha_deploy"` / `resource "aws_iam_role_policy" "gha_deploy"`):
```hcl
  # E11 — GitHub Actions OIDC: the provider lives in the prod root (applied first); this root adds only the scoped staging deploy role
  locals {
    gha_deploy_role_name     = "developercards-gha-staging"
    github_repo              = "ChuanQiao1128/recallsmith"
    github_oidc_provider_arn = "arn:aws:iam::${var.account_id}:oidc-provider/token.actions.githubusercontent.com"
    gha_deploy_subs          = ["repo:${local.github_repo}:environment:staging"]
    gha_lambda_arns = flatten([for fn in [local.core_vpc_function_name, local.worker_function_name] :
      ["arn:aws:lambda:${var.region}:${var.account_id}:function:${fn}", "arn:aws:lambda:${var.region}:${var.account_id}:function:${fn}:*"]])
  }
```
`aws_iam_role.gha_deploy` (`name = local.gha_deploy_role_name`, `max_session_duration = 3600`, the Changes-2 trust document with `Federated = local.github_oidc_provider_arn` and `local.gha_deploy_subs`; **no** `depends_on` — the provider is a string here) and `aws_iam_role_policy.gha_deploy` (`name = "deploy"`, `role = aws_iam_role.gha_deploy.id`) with the same seven Sids as the module's policy (`LambdaDeploy` over `local.gha_lambda_arns`, `ConsoleBucketObjects`/`ConsoleBucketList` over `local.console_bucket_name`, `ConsoleInvalidate` with `"aws:ResourceTag/Env" = "staging"`, `ConsoleList`, `SsmRead` on `/developercards/staging`, `SsmDecrypt`) and **no** `RdsSnapshot` statement, no admin attachment, no `aws_iam_openid_connect_provider`, no `aws_iam_role_policy_attachment` (E10's forbidden list for this file still holds). The existing `locals {}` of E10 is not edited (a second `locals` block is legal HCL).
`infra/README.md` §6: one line, e.g. `- 2026-09-2x E11: GitHub OIDC provider + developercards-gha-plan/-prod (prod root), developercards-gha-staging (staging root); cd.yml / ota.yml / terraform.yml; scripts/smoke.sh + rollback.sh; deploy.sh MIGRATE_ON_PUBLISH hook.`

### 4. Plan allow files (E00 §3.1 format, valid JSON, no comments)

`docs/delivery/r16-issues/E11.plan-allow.json` — prod, seven creates:
`module.identity.aws_iam_openid_connect_provider.github[0]`, `module.identity.aws_iam_role.gha_plan[0]`, `module.identity.aws_iam_role_policy_attachment.gha_plan_readonly[0]`, `module.identity.aws_iam_role_policy.gha_plan_tfstate[0]`, `module.identity.aws_iam_role.gha_deploy[0]`, `module.identity.aws_iam_role_policy.gha_deploy[0]`, `module.identity.aws_iam_role_policy_attachment.gha_deploy_admin[0]`, each `"create"`; `"tags_only_updates": false`; no `outputs`.
`docs/delivery/r16-issues/E11.staging.plan-allow.json` — staging, two creates: `aws_iam_role.gha_deploy`, `aws_iam_role_policy.gha_deploy` (root-level addresses).
(Your verify runs `check-plan.py` with the prod file against a read-only real-backend plan and proves the staging file by the HEAD − merge-base delta — Verify step 4; the supervisor re-runs both against the real backends before applying.)

### 5. `.github/workflows/ci.yml` — one line

Under `on:` (`:3-5`), after `  pull_request:`, add `  workflow_call:`. Nothing else in the file changes (the four jobs then run once standalone and once inside `cd.yml` on a push to `main`; accepted, E00 pins the numstat).

### 6. `.github/workflows/cd.yml` (new)

```yaml
name: CD
on:
  push:
    branches: [main]
  workflow_dispatch:
concurrency:
  group: cd-main
  cancel-in-progress: false
permissions:
  contents: read
  id-token: write
env:
  AWS_REGION: ap-southeast-2
```
Jobs, in `needs` order:
- **`test`**: `uses: ./.github/workflows/ci.yml`.
- **`deploy-staging`** (`needs: test`, `runs-on: ubuntu-latest`, `environment: staging`): `actions/checkout@v5`; `actions/setup-dotnet@v5` (`dotnet-version: '8.0.x'`); `actions/setup-node@v5` (`node-version: '20'`, `cache: npm`, `cache-dependency-path: frontend/package-lock.json`); `aws-actions/configure-aws-credentials@v4` with `role-to-assume: arn:aws:iam::622994489535:role/developercards-gha-staging`, `aws-region: ap-southeast-2`; step `profile stub`: `aws configure set region ap-southeast-2 --profile dev` (see Context); step `id: prev` writes `vpc=` / `worker=` (`aws lambda get-alias --function-name core-vpc-staging --name staging --query FunctionVersion --output text`, same for `worker-lambda-staging`) to `$GITHUB_OUTPUT`; step `deploy lambdas` (`working-directory: src_C`): `ENV=staging PUBLISH_ALIAS=staging VPC_FN=core-vpc-staging WORKER_FN=worker-lambda-staging MIGRATE_ON_PUBLISH=1 ./deploy.sh`; step `console distribution id`: `aws cloudfront list-distributions --query "DistributionList.Items[?Aliases.Items && contains(Aliases.Items, 'console-staging.developercards.app')].Id | [0]" --output text` → `$GITHUB_OUTPUT` `dist=` (fail when empty or `None`); step `deploy console` (`working-directory: frontend`): `npm ci` then `./deploy.sh` with env `CONSOLE_BUCKET=developercards-console-staging`, `CONSOLE_DISTRIBUTION_ID=<that output>`, `CONSOLE_URL=https://console-staging.developercards.app`, `VITE_BUILD_ID=${{ github.sha }}`, `VITE_API_BASE=https://api-staging.developercards.app`, `VITE_COGNITO_CLIENT_ID=${{ vars.CONSOLE_STAGING_CLIENT_ID }}`, `VITE_COGNITO_REDIRECT_URI=https://console-staging.developercards.app/auth/callback`, `VITE_COGNITO_LOGOUT_URI=https://console-staging.developercards.app/`; step `console artifact`: `tar -czf "dist-${GITHUB_SHA::7}.tgz" -C frontend dist` + `actions/upload-artifact@v4` (`name: console-dist-staging-${{ github.sha }}`, `path: dist-*.tgz`, `retention-days: 30`).
- **`smoke-staging`** (`needs: deploy-staging`, `environment: staging`): checkout; creds (gha-staging); profile stub; `scripts/smoke.sh staging`.
- **`deploy-prod`** (`needs: smoke-staging`, `environment: production` — the owner's required reviewer is the approval gate): checkout; setup-dotnet; setup-node; creds with `role-to-assume: arn:aws:iam::622994489535:role/developercards-gha-prod`; profile stub; step `snapshot`: `infra/scripts/rds-snapshot.sh pre-deploy-${GITHUB_SHA::7}`; step `id: prev` (aliases `prod` of `core-vpc` / `worker-lambda` → outputs `vpc`, `worker`); step `deploy lambdas` (`working-directory: src_C`): `ENV=prod MIGRATE_ON_PUBLISH=1 ./deploy.sh`; step `deploy console` (`working-directory: frontend`): `npm ci && ./deploy.sh` with `VITE_BUILD_ID=${{ github.sha }}` only (prod values come from `.env.production`); console artifact upload (`console-dist-prod-${{ github.sha }}`, 30 days); step `id: smoke-prod`: `scripts/smoke.sh prod`; step `id: rollback`, `if: failure() && steps.prev.outcome == 'success'`: `scripts/rollback.sh api "${{ steps.prev.outputs.vpc }}" && scripts/rollback.sh worker "${{ steps.prev.outputs.worker }}"`. (Console rollback is manual: `gh run download` the artifact, then `scripts/rollback.sh console <sha7>`; E15 documents it.)

### 7. `src_C/deploy.sh` — the `migrate_by_version` hook (additive; keep E06's structure)

Define above `deploy_one` (comment explains E00 §6 #17):
```bash
migrate_by_version() {
  local fn="$1" ver="$2" out payload fe
  payload="$(jq -cn --arg t "deploy-$(date -u +%Y%m%dT%H%M%SZ)" \
    '{source:"developercards.scheduler",action:"db/migrate",args:{dryRun:false},traceId:$t}')"
  if [ "${DRY_RUN:-0}" = 1 ]; then echo "DRY: aws lambda invoke --function-name $fn:$ver db/migrate"; return 0; fi
  out="$(mktemp)"
  fe="$(aws lambda invoke --region "$REGION" --function-name "$fn:$ver" --cli-binary-format raw-in-base64-out \
        --payload "$payload" "$out" --query 'FunctionError' --output text)"
  [ "$fe" = None ] || { echo "db/migrate on $fn:$ver failed: FunctionError=$fe" >&2; cat "$out" >&2; rm -f "$out"; exit 1; }
  jq -e '.statusCode == 200' "$out" >/dev/null || { echo "db/migrate on $fn:$ver returned non-200" >&2; cat "$out" >&2; rm -f "$out"; exit 1; }
  echo "OK db/migrate on $fn:$ver: $(jq -r '.body | fromjson | .data | tojson' "$out")"
  rm -f "$out"
}
```
Call site inside `deploy_one`, on the line directly after `ver="$(aws lambda publish-version …)"` and before `update-alias`:
```bash
    if [ "$fn" = "$VPC_FN" ] && [ "${MIGRATE_ON_PUBLISH:-1}" = 1 ]; then migrate_by_version "$fn" "$ver"; fi
```
A failed migration exits 1 with the version published and **no alias moved** (traffic stays on the old version; the worker is never deployed). In `deploy_one`'s `DRY_RUN` branch (the early `return 0`), call the same guard with a placeholder version so a dry run shows the hook: `if [ "$fn" = "$VPC_FN" ] && [ "${MIGRATE_ON_PUBLISH:-1}" = 1 ]; then migrate_by_version "$fn" "new-version"; fi` — `DRY_RUN=1 ENV=staging VPC_FN=core-vpc-staging PUBLISH_ALIAS=staging ./deploy.sh` then prints `DRY: aws lambda invoke --function-name core-vpc-staging:new-version db/migrate`. Add one usage line to the header comment (first 30 lines), e.g. `#   MIGRATE_ON_PUBLISH=0 ./deploy.sh      # skip the db/migrate invoke of the new core-vpc version (default 1)`, and one sentence after E06's "migrations are not run here" note saying that the internal `db/migrate` event IS invoked on the freshly published version by this hook — do not delete or reword E06's header lines (its verify pins them). No other line of `deploy_one` moves.

### 8. `scripts/smoke.sh` (new)

Header `#!/usr/bin/env bash`, `set -euo pipefail`, `ROOT="$(cd "$(dirname "$0")/.." && pwd)"`, usage `scripts/smoke.sh <prod|staging>` (exit 2 otherwise). `case "$1"`: `prod` → `API=https://api.developercards.app`, `CDN=https://cdn.developercards.app`, `FN=core-vpc`, `ALIAS=prod`; `staging` → `api-staging.` / `cdn-staging.` / `core-vpc-staging` / `staging`. `REGION="${AWS_REGION:-ap-southeast-2}"`. Five checks, each preceded by `echo "[k/5] <name>"` with the names exactly `health`, `health/deep`, `manifest`, `publish-roundtrip`, `dashboard`; `DRY_RUN=1` prints the five lines (suffix ` (dry run)`) and exits 0 before any network call. Failures: `fail() { echo "SMOKE FAIL ($ENV_NAME): $*" >&2; exit 1; }`.
1. `curl -fsS --max-time 15 "$API/health"` → body contains `"ok":true`.
2. `aws lambda invoke --region "$REGION" --function-name "$FN:$ALIAS" --cli-binary-format raw-in-base64-out --payload '{"source":"developercards.scheduler","action":"health/deep","args":{},"traceId":"smoke-<utc>"}' "$out" --query FunctionError --output text` must print `None`; then `jq -e '(.body|fromjson).data | .ok == true and (.schemaVersion >= .required)' "$out"`.
3. `curl -fsS --max-time 15 "$CDN/content/manifest.json" | jq -e '.schemaVersion == 2'`.
4. `staging` only (prod prints `[4/5] publish-roundtrip (skipped on prod)`): `SLUG="smoke-${SHA7}-${GITHUB_RUN_ID:-local}"` with `SHA7="$(git -C "$ROOT" rev-parse --short=7 HEAD)"`; through `"$ROOT/scripts/invoke-as-admin.sh" "$FN:$ALIAS" <METHOD> <path> <body-file>`: `POST /api/v1/authoring/decks` `{"slug":"$SLUG","title":"Smoke $SLUG","author":"cd"}` → `DECK_ID=$(jq -r .data.id)`; `POST /api/v1/authoring/cards` `{"deckId":DECK_ID,"stableUid":"smoke-1","question":"q","answer":"a","orderInDeck":1}`; `POST /api/v1/authoring/publish` `{"deckId":DECK_ID}` → `JOB_ID=$(jq -r .data.jobId)`; poll `GET "/api/v1/authoring/publish/status?jobId=$JOB_ID"` every 10 s for ≤ 300 s until `.data.status == "SUCCESS"` (`FAILED` → fail immediately with `.data.errorMessage`), `BUILD_ID=$(jq -r .data.buildId)`; poll the CDN manifest every 10 s for ≤ 120 s until `.decks[] | select(.slug == $SLUG) | .buildId == $BUILD_ID` (`s-maxage=60`); cleanup always runs (trap): `DELETE "/api/v1/authoring/decks?id=$DECK_ID"` then `POST /api/v1/admin/manifest/rebuild` so the manifest drops the smoke deck.
5. `prod` only (staging prints skipped): `invoke-as-admin.sh "$FN:$ALIAS" GET /api/v1/authoring/dashboard | jq -e '.success == true'`.
Last line on success: `echo "SMOKE OK ($ENV_NAME)"`.

### 9. `scripts/rollback.sh` (new)

`scripts/rollback.sh {api|worker|console|deck} <ref> [<buildId>]`, `ENV="${ENV:-prod}"` selecting `VPC_FN`/`WORKER_FN`/`ALIAS`/`CONSOLE_BUCKET`/`CONSOLE_URL` (`prod`: `core-vpc`, `worker-lambda`, `prod`, `recallsmith-console-622994489535`, `https://console.developercards.app`, `CONSOLE_DISTRIBUTION_ID` default `E85FKUMZZWQWX`; `staging`: `core-vpc-staging`, `worker-lambda-staging`, `staging`, `developercards-console-staging`, `https://console-staging.developercards.app`, distribution id looked up by alias when unset — the same `list-distributions` query as `cd.yml`); every env is overridable. `DRY_RUN=1` prints the commands and exits 0 (for `console` without requiring the tarball). Usage error (unknown verb, missing `<ref>`) → exit 2.
- `api <version>` / `worker <version>`: `aws lambda update-alias --function-name "$FN" --name "$ALIAS" --function-version "$ref"`, then print `OK $FN:$ALIAS -> version $ref CodeSha256=$(aws lambda get-function-configuration --function-name "$FN:$ALIAS" --query CodeSha256 --output text)`.
- `console <sha7>`: needs `dist-<sha7>.tgz` in `$PWD` (or `$CONSOLE_DIST_TGZ`; downloaded by `gh run download`), extracts to a temp dir, then the three commands of `frontend/deploy.sh:20-22` (`s3 sync … --delete --exclude index.html --cache-control "public,max-age=31536000,immutable"`, `s3 cp dist/index.html … --cache-control no-cache --content-type text/html`, `cloudfront create-invalidation --paths '/*'`) + `wait invalidation-completed`, then the same 16-char sha256 comparison against `$CONSOLE_URL/index.html`.
- `deck <deckId> <buildId>`: `"$ROOT/scripts/invoke-as-admin.sh" "$VPC_FN:$ALIAS" POST "/api/v1/admin/decks/$deckId/rollback" <body-file with {"buildId":"<buildId>"}>` and `jq -e '.success == true'`.
No other verbs (OTA rollback is `eas update:republish --group <id>`, owner-only, documented by E15).

### 10. `.github/workflows/ota.yml` (new)

`name: OTA`; `on: push: tags: ['v*']`; `permissions: contents: read`; jobs: `test: uses: ./.github/workflows/ci.yml`; `ota` (`needs: test`, `environment: production`, `defaults.run.working-directory: mobile`): checkout; `setup-node@v5` (`20`, npm cache on `mobile/package-lock.json`); `npm ci`; step `tag matches the runtime`: `ver="$(jq -r .expo.version app.json)"; case "$GITHUB_REF_NAME" in "v$ver"|"v$ver-"*) ;; *) echo "tag $GITHUB_REF_NAME is not v$ver[-…]: an OTA must target the runtime of the tagged tree" >&2; exit 1;; esac`; `expo/expo-github-action@v8` with `eas-version: latest`, `token: ${{ secrets.EXPO_TOKEN }}`; `eas update --channel production --environment production --message "$GITHUB_REF_NAME" --non-interactive` with `env: EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}`. No `eas build`, no `eas submit` (binaries stay owner-driven, E00 §6 #18).

### 11. `.github/workflows/terraform.yml` (new)

`name: Terraform`; `on: pull_request: paths: ['infra/**']` and `push: branches: [main] paths: ['infra/**']`; `concurrency: group: terraform-${{ github.ref }}, cancel-in-progress: false`; `permissions: contents: read, id-token: write, pull-requests: write`; `env: TF_IN_AUTOMATION: "1", TF_INPUT: "0", AWS_REGION: ap-southeast-2`.
- **`plan`** (`strategy.matrix.root: [prod, staging]`, `fail-fast: false`): checkout; `hashicorp/setup-terraform@v3` (`terraform_version: 1.16.3`, `terraform_wrapper: false`); creds with `role-to-assume: arn:aws:iam::622994489535:role/developercards-gha-plan`; step `tfvars from secret`: writes `${{ secrets.TFVARS_PROD }}` / `${{ secrets.TFVARS_STAGING }}` (pick by `matrix.root`) to `infra/envs/${{ matrix.root }}/${{ matrix.root }}.auto.tfvars`, failing with `TFVARS_<ROOT> is not set` when empty; `terraform fmt -check -recursive infra`; `terraform -chdir=infra/envs/${{ matrix.root }} init -input=false`; `… validate`; `… plan -input=false -out=tfplan`; step `summary`: `terraform -chdir=… show -json tfplan | jq -r '.resource_changes[] | select(.change.actions != ["no-op"]) | "\(.address)  \(.change.actions | join(","))"' > summary.txt` (address + actions only — plan JSON holds Lambda env values, E00 §0) and, on `pull_request` only, `gh pr comment "${{ github.event.pull_request.number }}" --body-file` a markdown body headed `### terraform plan — ${{ matrix.root }}` (`GH_TOKEN: ${{ github.token }}`); `rm -f tfplan`. No `upload-artifact` in this workflow.
- **`apply-prod`** (`if: github.event_name == 'push'`, `needs: plan`, `environment: infra-prod`) and **`apply-staging`** (`needs: apply-prod`, `environment: infra-prod`): checkout; setup-terraform; creds with `role-to-assume: arn:aws:iam::622994489535:role/developercards-gha-prod`; tfvars from secret; `init -input=false`; `plan -input=false -out=tfplan`; `terraform -chdir=infra/envs/<root> apply -input=false tfplan` (a saved plan never prompts; the literal `apply -input=false tfplan` therefore appears exactly twice in the file); `rm -f tfplan`. CI always initialises the real backend — never `-backend=false` in this workflow (that is the worker's mode, not CI's).

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/E11.verify.sh` re-runs exactly these (`BASE=delivery/r16-e-prod`).

1. Scope files exist: `cd.yml`, `ota.yml`, `terraform.yml`, `scripts/smoke.sh`, `scripts/rollback.sh` (both executable), `infra/modules/identity/oidc.tf`, the two allow files; prerequisites from the queue are on the branch: `infra/scripts/check-plan.py` (E01), `infra/scripts/rds-snapshot.sh` (E02), `scripts/invoke-as-admin.sh` (E06), `ENV:-prod` in `src_C/deploy.sh` (E06), `CONSOLE_URL` in `frontend/deploy.sh` (E09), `infra/envs/staging/main.tf` + `staging.auto.tfvars.example` (E10), `src_C/Vpc/Internal/InternalEvents.cs` with `"db/migrate"` and `"health/deep"` (E12).
2. Literal guards (all exit 0): `ci.yml` numstat `1	0` and the added line is `workflow_call:`; every pinned string of Changes 2–11 (`grep -F`): the seven `oidc.tf` resource headers, both `ReadOnlyAccess` / `AdministratorAccess` ARNs, `sts:AssumeRoleWithWebIdentity`, `token.actions.githubusercontent.com:aud`, `sts.amazonaws.com`, the three `sub` templates, the nine Sids, `aws:ResourceTag/Env`, `kms:ViaService`, `terraform.tfstate.tflock`; the eight identity variables and four outputs; the prod wiring lines (regex, whitespace-agnostic); the staging file's two inline resource headers, `"developercards-gha-staging"`, `environment:staging`, `oidc-provider/token.actions.githubusercontent.com`, and NOT `module "identity"`, `manage_github_oidc`, `gha_deploy_admin`, `AdministratorAccess`, `RdsSnapshot`, `aws_iam_openid_connect_provider`, `aws_iam_role_policy_attachment`; both allow files parse and hold exactly the addresses of Changes 4, all `"create"`; `cd.yml` has `workflow_dispatch:`, `uses: ./.github/workflows/ci.yml`, `environment: staging`, `environment: production`, `id-token: write`, `cancel-in-progress: false`, both role ARNs, `aws configure set region ap-southeast-2 --profile dev`, `MIGRATE_ON_PUBLISH=1`, `PUBLISH_ALIAS=staging`, `VPC_FN=core-vpc-staging`, `WORKER_FN=worker-lambda-staging`, `rds-snapshot.sh pre-deploy-${GITHUB_SHA::7}`, `scripts/smoke.sh staging`, `scripts/smoke.sh prod`, `scripts/rollback.sh api`, `scripts/rollback.sh worker`, `if: failure()`, `retention-days: 30`, `vars.CONSOLE_STAGING_CLIENT_ID`, `console-staging.developercards.app`; `ota.yml` has `tags:`, `'v*'`, `environment: production`, `expo/expo-github-action@v8`, `secrets.EXPO_TOKEN`, `eas update --channel production --environment production --message "$GITHUB_REF_NAME" --non-interactive`, `jq -r .expo.version app.json`, and no `eas build`/`eas submit`; `terraform.yml` has `infra/**`, `hashicorp/setup-terraform@v3`, `terraform_version: 1.16.3`, `developercards-gha-plan`, `developercards-gha-prod`, `environment: infra-prod`, `secrets.TFVARS_PROD`, `secrets.TFVARS_STAGING`, `terraform fmt -check -recursive infra`, `validate`, `show -json`, `apply -input=false tfplan`, `pull-requests: write`, and no `upload-artifact`; no workflow mentions `aws-access-key-id`, `AWS_SECRET_ACCESS_KEY` or `AWS_ACCESS_KEY_ID`; `deploy.sh` has `migrate_by_version() {`, the call-site line, `"db/migrate"`, `developercards.scheduler`, `--function-name "$fn:$ver"`, `FunctionError`, `MIGRATE_ON_PUBLISH:-1`, and the call site sits strictly between the first `publish-version` and the first `update-alias` line; `smoke.sh` has the five check names, `health/deep`, `schemaVersion`, `manifest.json`, `smoke-`, the five API paths, `manifest/rebuild`, `DRY_RUN`; `rollback.sh` has `api|worker|console|deck`, `update-alias`, `CodeSha256`, `dist-`, `.tgz`, `/rollback`, `"buildId"`, `DRY_RUN`; suppression tokens absent from every new file and every `+` line; secret-leak grep empty.
3. Gates: `terraform fmt -check -recursive infra`; `terraform init -backend=false -input=false && terraform validate` in `infra/envs/prod` and `infra/envs/staging`; `bash -n` on `deploy.sh`, `smoke.sh`, `rollback.sh`; the four workflows parse as YAML and pass `actionlint` (when installed); `python3 -m json.tool` on both allow files; `DRY_RUN=1 scripts/smoke.sh staging|prod` print five `[k/5]` lines and exit 0; `DRY_RUN=1 scripts/rollback.sh` for `api 1`, `worker 1`, `console abc1234`, `deck 1 b` exit 0; `DRY_RUN=1 ENV=staging ./deploy.sh` (packages only) exits 0 and prints the `db/migrate` DRY line.
4. Plans (read-only): prod against the real backend in a copy of `infra/` (`init -reconfigure`, `plan -lock=false`, vars = `prod.auto.tfvars.example` minus `alert_email`/`snowflake_external_id`, which two read-only lookups supply) → the effective non-data set is exactly the seven creates of Changes 4, nothing `importing`, no `output_changes`, and `python3 infra/scripts/check-plan.py --plan … --allow docs/delivery/r16-issues/E11.plan-allow.json` exits 0; staging (E01's local `backend_override.tf` written into each scratch copy, `init -input=false -reconfigure`) with `staging.auto.tfvars.example` at HEAD and at the merge-base tree → every effective action is `create`, nothing `importing`, the HEAD − base delta is exactly the two creates of Changes 4 and nothing disappears, and the staging plan has no `aws_iam_openid_connect_provider` / `gha_plan`; trust documents carry the expected `sub`s and `aud`; `simulate-custom-policy` on the planned policy documents: staging deploy allows `lambda:UpdateAlias` on `core-vpc-staging:staging`, `lambda:UpdateFunctionCode` on `worker-lambda-staging`, `lambda:InvokeFunction` on `core-vpc-staging:12`, `s3:PutObject` on `developercards-console-staging/index.html`, `s3:ListBucket` on that bucket, `ssm:GetParametersByPath` on `/developercards/staging`, `ssm:GetParameter` on `/developercards/staging/pg-password`, `cloudfront:CreateInvalidation` with `aws:ResourceTag/Env=staging`, `cloudfront:ListDistributions` on `*`, `kms:Decrypt` via `ssm.ap-southeast-2.amazonaws.com`; implicitly denies `lambda:UpdateAlias` on `core-vpc:prod`, `lambda:DeleteFunction` on `core-vpc-staging`, `s3:PutObject` on the prod console bucket and on `core-vpc/content/manifest.json`, `ssm:GetParameter` on `/developercards/prod/pg-password`, `cloudfront:CreateInvalidation` with `Env=prod`, `kms:Decrypt` without the ViaService key, `rds:DeleteDBInstance`, `iam:PassRole`, `sqs:DeleteQueue`; prod deploy policy allows `rds:CreateDBSnapshot` on `db:developercards`, `lambda:InvokeFunction` on `core-vpc:48`, `s3:PutObject` on the prod console bucket and denies it on the staging console bucket; the plan role's tfstate policy allows `s3:PutObject`/`s3:DeleteObject` on `…/envs/<root>/terraform.tfstate.tflock`, `s3:GetObject` on `…/envs/prod/terraform.tfstate`, `s3:ListBucket` on the bucket, and denies `s3:PutObject`/`s3:DeleteObject` on `…/envs/prod/terraform.tfstate`; statically, bare `Resource "*"` only under Sid `ConsoleList` (deploy policies) and nowhere in the tfstate policy, no `Action` `*`/`<service>:*`, `RdsSnapshot` present in prod's document and absent from staging's.
5. Scope + frozen + OTA + apply guard: every changed or untracked path is in the scope list; the three frozen files and everything under `mobile/` are zero-diff; no tracked `*.tfplan`/`*.plan.json`/`generated*.tf`/`*.auto.tfvars`; no `profile =` in `infra/**/*.tf`; `E11.verify.sh` and `scripts/smoke.sh` contain no `terraform apply|import` and no `aws … create-|update-|delete-|put-` outside comments (`rollback.sh`, `deploy.sh` and the workflows are CI/supervisor-executed and are never run by the verify without `DRY_RUN=1`).

## Verify

```bash
BASE=delivery/r16-e-prod AWS_PROFILE=dev bash docs/delivery/r16-issues/E11.verify.sh
```
≈ 6–9 min: one real-backend prod plan (read-only), two empty-state staging plans, ≈ 30 `simulate-custom-policy` calls, `DRY_RUN` packaging. Needs `terraform` 1.16.3, `jq`, `python3` (+ `yaml`), `actionlint` (optional), `dotnet` for the DRY packaging, `AWS_PROFILE=dev` on account `622994489535` with E01…E12 applied and their second plans empty (otherwise the prod effective set is not the seven creates and the verify says so). The driver then runs the `infra` root gate, the diff-scoped banned-term grep and the suppression scan.

**Supervisor (after merge, never the worker):** `terraform init` (real backend) + `plan -out=E11.tfplan` in `infra/envs/prod` → `show -json | check-plan.py --allow docs/delivery/r16-issues/E11.plan-allow.json` (7 creates) → `apply` → the same in `infra/envs/staging` with `E11.staging.plan-allow.json` (2 creates) → `aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::622994489535:role/developercards-gha-staging …` with the step-4 matrix → second plan empty in both roots. (The verify already proved the prod plan with the same allow file.) Then the owner-side GitHub setup this issue cannot do: environments `staging` (no reviewer; deployment branches `main` + `delivery/*` during the wave; variable `CONSOLE_STAGING_CLIENT_ID` = the `console-staging` client id from `infra/README.md` §6), `production` (required reviewer = owner; secret `EXPO_TOKEN`), `infra-prod` (required reviewer = owner); repository secrets `TFVARS_PROD` / `TFVARS_STAGING` = the contents of the two real `*.auto.tfvars`; then `gh workflow run cd.yml --ref delivery/r16-e-prod` and watch `deploy-staging` → `smoke-staging`; approve `deploy-prod` only if a prod deploy of the integration branch is wanted at that point (it is the same deploy the supervisor otherwise runs by hand). If CloudFront rejects the tag-conditioned invalidation on the first staging run, the fallback is an `identity` string variable with the distribution id (post-wave, owner-pasted) — not a wildcard.

## Do NOT

- Do NOT run `terraform apply`/`import`, `gh workflow run`, `gh secret set`, `gh api -X PUT`, `aws configure`, `eas …`, or any of `deploy.sh`, `frontend/deploy.sh`, `rds-snapshot.sh`, `invoke-as-admin.sh`, `smoke.sh`, `rollback.sh` without `DRY_RUN=1`.
- Do NOT pass a module output into `identity`, add a `data "aws_iam_openid_connect_provider"`, or read `terraform_remote_state`; do NOT create the provider in the staging root; do NOT add a `module "identity"` block to the staging root (E00 §6 #28); do NOT scope the invalidation by a wildcard without the tag condition.
- Do NOT edit `infra/envs/*/imports.tf`, root `variables.tf`/`outputs.tf`/`*.example`, any other module, `src_C/scripts/*`, `frontend/.env.*`, `mobile/**`, `README.md`, `docs/runbooks/*`, any test.
- Do NOT restructure `deploy.sh` beyond the hook; do NOT make the migration run through the HTTP route or with a migrate secret; do NOT move the alias before the migration.
- Do NOT put `terraform apply` in `cd.yml`, upload a plan file, print plan JSON beyond `address  actions`, or add long-lived AWS keys anywhere.
- Do NOT add `eas build`/`eas submit` to `ota.yml`; do NOT change `mobile/eas.json` or `app.json`.
- Do NOT run npm, dotnet restore or git inside `/Users/qc/src/recallsmith` or under `/Users/qc/Desktop` — only inside your worktree.
