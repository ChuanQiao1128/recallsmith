# E08 — API Gateway authorizers, route split, throttles, reserved concurrency, Cognito hardening (`gateway-and-cognito`)

Put the two Cognito pools in front of the API at the gateway: a second JWT authorizer `cognito-jwt-mobile` (issuer = the mobile pool `ap-southeast-2_04hd6iisb`, audience = client `7agirr7f56r9k5p6v6o63al1on`) next to the adopted console authorizer `828ehi`; split `ANY /{proxy+}` by prefix so console routes (`/api/v1/authoring/*`, `/api/v1/admin/*`, the three `edge-public` prefixes, `$default`, the catch-all) demand a console token and mobile routes (`/api/v1/sync/*`, `/api/v1/draw-state/*`, `/api/v1/user/*`, `/api/v1/premium/*`, `GET /api/v1/me`, `GET /api/v1/entitlements`, the two `premium-url` routes) demand a mobile token, while `GET /health` and the two RevenueCat webhooks stay `NONE`; collapse the three identical core-vpc integrations into one; throttle both stages (100 rps / 200 burst by default, lower on sync, draw-state and the webhooks); reserve 40 concurrent executions for `core-vpc` and 2 for `worker-lambda`; and harden the console pool: TOTP MFA `ON`, access/id tokens 1 h, refresh 30 d, localhost callbacks moved off the prod client into a new `console-dev` client. Pure Terraform in `infra/` — no code, no mobile, no frontend file changes; the worker plans, the supervisor applies.

## Context

Base: `delivery/r16-e-prod` (== `main@4b07f19`, JWT verification merged). Every `file:line` below was read on that tree on 2026-09-22; every AWS fact was re-read the same day with `AWS_PROFILE=dev` (account `622994489535`, `ap-southeast-2`), describe/get/list only. `docs/delivery/r16-issues/E00-contracts.md` (E00) is binding: §2.8 is this issue's contract, §0 the non-negotiables, §2.1 the Terraform conventions, §3.1 the plan allow-list, §5 the verify conventions, §6 #2/#3/#10/#14/#20/#24 the decisions that touch it.

What the account looks like today (the tree carries no `infra/` on base; E01–E07 create and extend it ahead of you in queue order — E00 §1.1, §4):

- **API `ktbq1sie2c` (`developercards-api`)**: 10 routes, all `AuthorizationType NONE`, no authorizer attached (`aws apigatewayv2 get-routes --api-id ktbq1sie2c`): `2zt7dan $default`→`ftkbtwn`, `xhcsm7a ANY /{proxy+}`→`ftkbtwn`, `3o410l1 GET /api/v1/authoring/publish/jobs`→`q8lfdrr`, `cz7p5uo GET /api/v1/content/premium-url`→`a9dzpce`, `ymw0s2h GET /api/v1/content/premium-url-dev`→`q8lfdrr`, `daeaq4a POST /webhooks/revenuecat/production`→`a9dzpce`, `jsyx1bu POST /webhooks/revenuecat/development`→`q8lfdrr`, `6lnq0za ANY /api/v1/ai/{proxy+}`→`wf11obg`, `w6hhydi ANY /api/v1/billing/{proxy+}`→`wf11obg`, `l803chb ANY /api/v1/admin/cognito/{proxy+}`→`wf11obg`. Integrations `a9dzpce`, `ftkbtwn`, `q8lfdrr` are byte-identical `AWS_PROXY` → `core-vpc:prod`, payload 2.0, 30 000 ms; `wf11obg` → `edge-public` (`get-integrations`). One authorizer `828ehi` `cognito-jwt` (JWT, `$request.header.Authorization`, issuer `https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_4Vf8uCXKt`, audience `6lkofepp2llp6v4nueg52mcm5v`) attached to nothing (`get-authorizers`). Stages `$default` and `dev`: `auto_deploy`, `DetailedMetricsEnabled false` on base (E04 turns it on and adds the access log), `RouteSettings {}`, no throttling (`get-stages`). CORS `AllowOrigins` `http://localhost:5173`, `https://d12pfy1rhi3ekm.cloudfront.net`; `AllowHeaders` includes `authorization`; `DisableExecuteApiEndpoint false` (`get-api`). Review §1 table `:62`, §2.1.1 `:88`, §2.2.6 `:110`.
- **Who calls what** (exhaustive greps of `mobile/src` and `frontend/src`): the phone calls only `/api/v1/content/premium-url`, `/api/v1/content/premium-url-dev`, `/api/v1/entitlements`, `/api/v1/user/bootstrap`, `/api/v1/sync/push`, `/api/v1/draw-state/sync`, `/api/v1/premium/sync` (`mobile/src/sync/progressSync.ts:1467`, `:1493`; `mobile/src/sync/drawStateSync.ts:355`; `mobile/src/features/gacha/home/homeRemote.ts:57`; `mobile/src/content/deckRepository.ts:208`; `mobile/src/premium/revenuecat.ts:440`) with a Cognito **access** token as `Authorization: Bearer` (`mobile/src/api/apiClient.ts:44-47`, `homeRemote.ts:38-40`) against the `$default` stage (`deckRepository.ts:31-33`, `homeRemote.ts:7-9`). The console calls only `/api/v1/authoring/*` and `/api/v1/admin/*` (`frontend/src/api/*.ts`; `/api/v1/admin/users` is served by core-vpc `src_C/Vpc/VpcFunction.cs:280-296`) with an access token (`frontend/src/api/http.ts:149`) against the `dev` stage (`frontend/.env.production:11`, `.env.development:1`). Nothing in either tree calls `/api/v1/ai`, `/billing`, `/admin/cognito` (E00 §6 #10) or `GET /api/v1/me` (`VpcFunction.cs:218`). The split in E00 §2.8's table therefore breaks no caller: a console token never reaches a mobile route and vice versa.
- **Route selection**: HTTP APIs pick the most specific route — a literal segment beats `{proxy+}`, so `ANY /api/v1/admin/cognito/{proxy+}` (edge-public) still wins over the new `ANY /api/v1/admin/{proxy+}`, `GET /api/v1/authoring/publish/jobs` over `ANY /api/v1/authoring/{proxy+}`, and everything else under `/api/v1/...` that has no prefix route (`/api/v1/db/ping` `VpcFunction.cs:119`, `/api/v1/runtime/premium-url*` `:242-244`, `/api/internal/*` `:306-313`) falls to `ANY /{proxy+}` → console JWT — accepted, none has a caller. `GET /health` (`:105`) needs its own `NONE` route because it falls under `ANY /{proxy+}` today; E11's smoke uses it. CORS preflight is answered by the gateway from `cors_configuration` before any route or authorizer runs, so `OPTIONS` from the console keeps working with JWT on `ANY /{proxy+}`.
- **Lambda side is ready**: `src_C/Shared/RecallSmith.Lambda.Common/Auth.cs:178-200` reads `requestContext.authorizer.jwt.claims` first and only falls back to in-process verification when the gateway sent none (review `:99`); `Build` (`:241-256`) parses `cognito:groups` in the bracketed string form the authorizer emits; `AuthBearerTests.AuthorizerClaims_StillWin_AndSkipTheVerifier` (`src_C/Tests/RecallSmith.Lambda.IntegrationTests/AuthBearerTests.cs:195-230`) pins it. No code changes in this issue. The only client-visible difference: a request to a JWT route with no/invalid token now gets the gateway's `401 {"message":"Unauthorized"}` instead of the Lambda envelope's 401/403 (`src_C/Vpc/Runtime/PremiumDeckUrl.cs:144-147`); no client branches on that body (`grep -n "401\|403" mobile/src/sync/progressSync.ts` → 0).
- **Invoke permission already covers every new route**: `aws lambda get-policy --function-name core-vpc` has Sid `apigw-httpapi-ktbq1sie2c` with `AWS:SourceArn arn:aws:execute-api:ap-southeast-2:622994489535:ktbq1sie2c/*/*/*` (any stage, method, path) besides the eight per-route Sids; `edge-public` keeps its three per-prefix Sids and its routes' keys do not change. No `aws_lambda_permission` is added or removed.
- **Concurrency**: `aws lambda get-function-concurrency` → `{}` for both functions; account `ConcurrentExecutions 1000`, `UnreservedConcurrentExecutions 999` (`get-account-settings`), so reserving 40 + 2 leaves 957 unreserved (the ≥ 100 floor is far). `core-vpc` is 128 MB / 90 s, `worker-lambda` 512 MB / 615 s; the ESM already caps the worker at `maximum_concurrency 2` (E03), so `reserved_concurrent_executions = 2` is the hard ceiling for the same number. Review §2.2.6 `:110`, interview row `:278`.
- **Console pool `ap-southeast-2_4Vf8uCXKt`** ("User pool - Console for DeveloperCards", 2 users, `DeletionProtection ACTIVE`, `MfaConfiguration OFF` via `get-user-pool-mfa-config`). Client `6lkofepp2llp6v4nueg52mcm5v` "My SPA app - mrj1i9": `CallbackURLs` `http://localhost:5173/auth/callback` + `https://d12pfy1rhi3ekm.cloudfront.net/auth/callback`, `LogoutURLs` `http://localhost:5173/` + `https://d12pfy1rhi3ekm.cloudfront.net/`, access/id validity `1` **days**, refresh `5` days, flows `code`, scopes `email openid profile`, `ExplicitAuthFlows null`, `PreventUserExistenceErrors ENABLED`, token revocation on, `AuthSessionValidity 3`, no secret (`describe-user-pool-client`). Groups `super_admin` (no role) and `editor` (dangling `RoleArn …/developercards-api-role-l4jacdsb`, `list-groups`). The console refreshes tokens 60 s before expiry (`frontend/src/api/http.ts:31-45`, `frontend/src/auth/cognito.ts:112-127`), so 1 h access tokens cost nothing but a refresh. Review §1 `:72`, §2.1.6 `:93`.
- **Mobile pool `ap-southeast-2_04hd6iisb`** ("User pool - cpspy", 5 users, MFA OFF): client `7agirr7f56r9k5p6v6o63al1on` `MobileDeveloperCards`, access/id 60 **minutes**, refresh 5 days, SRP/password/custom/refresh flows. It is the pool the phone signs in to (E00 §6 #2; `mobile/src/auth/amplify.ts:10-12` reads `EXPO_PUBLIC_COGNITO_USER_POOL_ID`). HTTP API JWT authorizers check `client_id` in place of `aud` for Cognito access tokens, so the client id is the audience. Untouched in this issue.
- **Local console login after apply**: `frontend/.env.development:4` still names the prod client; once its localhost callbacks are gone, `npm run dev` login fails until E09 switches that file to the `console-dev` id (E00 §2.8, §2.9.5). Interim: a developer puts `VITE_COGNITO_CLIENT_ID=<console-dev id>` in `frontend/.env.development.local` (untracked; Vite mode-local outranks mode file). Not this issue's concern beyond stating it.
- **Verified plan shape** (scratch probe on 2026-09-22 against the live account, local state, no apply): route auth change → keys `authorization_type`, `authorizer_id`; route integration change → `target`; stage throttles → `default_route_settings`, `route_settings`; pool → `mfa_configuration`, `software_token_mfa_configuration`; `spa` → `callback_urls`, `logout_urls`, `refresh_token_validity`, `token_validity_units` (access/id stay `1`, only the unit changes); function → `reserved_concurrent_executions`. `route_settings` for a route key the account does not have yet plans fine; at apply time the route must exist first, hence the `depends_on` in Changes 4.

What E00 decided (and two reconciliations this brief records):

- §2.8 route table and the `authorization_type`/`authorizer_id` per key; `core_vpc_dup["a9dzpce"|"q8lfdrr"]` destroyed; throttles per stage; `reserved_concurrent_executions` 40/2; pool MFA `ON` + TOTP; `spa` 1 h / 1 h / 30 d with CloudFront-only callbacks; new `console_dev[0]` client; output `console_dev_client_id`; mobile pool untouched. §2.1.3 names: `cognito-jwt-mobile`, `console-dev`. §2.1.2 addresses: routes are `module.api.aws_apigatewayv2_route.this["<key>"]`, count-guarded Cognito resources are `[0]`.
- **Route update count** — §2.8's total says "8 routes (auth)", its own table plus "every core-vpc route targets `core_vpc` (`ftkbtwn`)" implies **10**: eight get a new `authorization_type`/`authorizer_id` (`default`, `proxy`, `publish_jobs`, `premium_url`, `premium_url_dev`, `edge_ai`, `edge_billing`, `edge_admin_cognito`; three of them also move `target` off a duplicate integration) and two get a new `target` only (`rc_production` off `a9dzpce`, `rc_development` off `q8lfdrr`). The allow-list below carries all ten; the table wins over the tally.
- **`imports.tf` loses exactly two blocks** — E00 §1.1 says `envs/prod/imports.tf` is never edited after E01 and §6 #20 says it is never deleted, yet §2.8 destroys two adopted integrations, and `terraform plan` refuses to run when an `import {}` block targets an address that no longer exists in configuration (probe: `Error: Configuration for import target does not exist`). Resolution (the same one E05 records for its six attachment blocks): an issue that destroys an adopted resource removes that resource's `import {}` block(s) and nothing else from `imports.tf`; every other block stays for the whole wave (E00 §6 #20). Import blocks for resources already in the remote state are no-ops, so the supervisor's plan is unaffected.
- **The worker plans against the real backend, read-only** — E00 §0/§5 describe an empty-local-state plan; E01 (gap 13) found that `init -backend=false` cannot serve `plan` at all, and by E08 an empty state would show every resource E02–E07 created as a `create` (DLQ, SNS, alarms, CloudTrail, worker role, SSM parameters, …) on top of this issue's changes. E06 therefore plans against the committed S3 backend with `terraform init -input=false -reconfigure` + `terraform plan -lock=false` (state is read with `s3:GetObject`, never locked or written; the driver's task text for E08 says the same); E02–E05 still plan through E01's gitignored `backend_override.tf` with a worker-side noise filter (E00 §6 #25). E08 follows them: the worker's plan **is** the supervisor's plan — 29 effective changes (11 creates, 16 updates, 2 deletes), no `importing` entries — and the committed `E08.plan-allow.json` applies verbatim on both sides. Precondition: E01–E07 applied by the supervisor and their second plan empty (E00 §0).
- **`aws_cognito_user_group.editor[0].role_arn` stays dangling** — §6 #14 assigns nulling it to this issue as an in-place update, but hashicorp/aws 6.66 sends `RoleArn = ""` on that change (`internal/service/cognitoidp/user_group.go`, `if d.HasChange(role_arn) { input.RoleArn = aws.String(d.Get(...)) }`) and Cognito rejects an empty ARN (`UpdateGroup` takes a new ARN, it cannot clear one). The group is not in this issue's plan (no-op, like E01) and the dangling value is harmless (no identity pool maps it). Clearing it is a post-wave `delete-group`/`create-group` by the owner, if ever. §2.8's plan totals (which omit the group) are the ones honoured.
- E00 §0: the worker only plans (read-only, see the bullet above); the supervisor applies. §0 forbids `provisioner`, `local-exec`, `null_resource`, `external`, `archive_file`. §2.1.4 curation of the adopted functions (`filename` placeholder, `ignore_changes` list) is untouched — `reserved_concurrent_executions` is outside that list, so the update lands.

## Read first

1. `docs/delivery/r16-issues/E00-contracts.md` §0 (`:9-35`), §1.1 (`:43-69` — the E08 column), §2.1.1–2.1.4 (`:116-211`), §2.8 (`:305-332`), §3.1 (`:419-430`), §5 (`:470-482`), §6 #2, #3, #10, #14, #20, #24 (`:486-509`).
2. `docs/backend-architecture-review-2026-09-22.md` `:62` (API row), `:72` (Cognito row), `:88` (§2.1.1), `:93` (§2.1.6), `:99` (code-side JWT update), `:110` (§2.2.6).
3. On the integration branch (E01–E07 merged): `infra/README.md` (§2 WORKER SAFETY RULE, §5 supervisor procedure, §6 change log — you append one line), `infra/RUNBOOK.md`, `infra/scripts/check-plan.py` (the checker your plan must pass), `infra/envs/prod/main.tf` (module wiring you extend), `infra/envs/prod/imports.tf` (the two blocks you remove), `infra/modules/api/gateway.tf` whole file (api, integrations, `aws_apigatewayv2_route.this` for_each map, authorizer `console`, both stages with E04's `access_log_settings` + `default_route_settings`), `infra/modules/api/core_vpc.tf`, `infra/modules/api/variables.tf`, `infra/modules/worker/function.tf`, `infra/modules/identity/cognito.tf` whole file (pool `console[0]`, client `spa[0]`, groups, domains, pool `mobile[0]`, client `mobile[0]`), `infra/modules/identity/outputs.tf` (`mobile_pool_endpoint`, `mobile_client_id` already exist — E00 §2.1.1).
4. `src_C/Shared/RecallSmith.Lambda.Common/Auth.cs:174-200`, `:241-256`; `src_C/Tests/RecallSmith.Lambda.IntegrationTests/AuthBearerTests.cs:195-230` (why no code change is needed).
5. `src_C/Vpc/VpcFunction.cs:105-118`, `:218-226`, `:241-247`, `:259-273`, `:280-296` (the paths behind each route key).
6. `frontend/.env.production:11-16`, `frontend/.env.development:1-6`, `frontend/src/api/http.ts:31-45`, `:149`; `mobile/src/api/apiClient.ts:4`, `:44-47`; `mobile/src/content/deckRepository.ts:26-33` (frozen — read only).
7. `docs/delivery/r16-issues/C05-topic-server.md` and `C05.verify.sh:1-24` (format precedent), `docs/delivery/r16-issues/E08.verify.sh` (what will be run against your branch — read it before you start).

## Constraints

- **Scope (the ONLY files that may change):**
  1. `infra/modules/api/gateway.tf` (edit: authorizer `mobile`, route map, single core-vpc integration, stage throttles)
  2. `infra/modules/api/core_vpc.tf` (edit: one attribute)
  3. `infra/modules/api/variables.tf` (edit: append two variables)
  4. `infra/modules/worker/function.tf` (edit: one attribute)
  5. `infra/modules/identity/cognito.tf` (edit: pool MFA, `spa` validity + URLs, new `console_dev`)
  6. `infra/modules/identity/outputs.tf` (edit: append one output)
  7. `infra/envs/prod/main.tf` (edit: two wiring lines in `module "api"`)
  8. `infra/envs/prod/imports.tf` (edit: remove exactly the two `core_vpc_dup` import blocks — Changes 3d; no other line)
  9. `infra/README.md` (edit: append one dated line to §6)
  10. `docs/delivery/r16-issues/E08.plan-allow.json` (new, verbatim from Changes 9)
  Nothing else: no `src_C/`, `mobile/`, `frontend/`, `site/`, `.github/`, `snowflake/`, no `infra/envs/prod/{variables,outputs,backend,providers,versions}.tf`, no `prod.auto.tfvars.example`, no `infra/envs/staging/**` (E10), no `infra/modules/api/{main,outputs,scheduler}.tf`, no `infra/modules/identity/{main,variables,policies,ssm}.tf`, no `infra/modules/{data,edge,observability}/**`, no `infra/scripts/**`, no `infra/RUNBOOK.md`, no `.terraform.lock.hcl`, no `docs/*.md` outside `docs/delivery/r16-issues/`.
- **WORKER SAFETY RULE (E00 §0, verbatim):** a worker may run read-only AWS CLI, `terraform init/validate/plan` (plan must be saved with -out and shown as JSON), but NEVER `terraform apply`, `terraform import` (state-changing), `aws ... create/update/delete/put`, `eas`, or any deploy script. The supervisor applies plans after each merge. Each infra brief's verify.sh therefore checks the PLAN (terraform show -json) against an explicit allow-list of resource addresses and actions — nothing else may appear as create/update/delete.
  Clarifications: `import {}` blocks in `.tf` files are configuration and allowed; the `terraform import` command is not. For `validate` you run `terraform init -backend=false -input=false`; for the plan you run `terraform init -input=false -reconfigure` in `infra/envs/prod` with the committed `backend.tf` and then `terraform plan -lock=false -input=false -out=…` — the state is read, never locked, never written (E04/E06 precedent, Context); you never create or empty the bucket, never `terraform state …`, never `terraform apply`. `aws apigatewayv2 get-*`, `aws cognito-idp describe-*`/`get-user-pool-mfa-config`/`list-groups`, `aws lambda get-*` are the read-only calls you may use to re-check the facts above; never print a Lambda `Environment` (`--query` away from it) and never paste plan JSON anywhere — it contains the functions' environment values in clear (E00 §0 "Secrets").
- **Frozen files (E00 §0) — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`. Nothing under `mobile/`, `frontend/`, `src_C/` changes at all in this issue.
- **OTA rule (E00 §0):** no change to `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json` (`"version": "1.6.1"`), `mobile/eas.json`; no `@sentry/*`; no dependency or native module. Trivially true here — the verify still checks it.
- **No renames (E00 §0):** API `ktbq1sie2c`, authorizer `828ehi` keeps `name = "cognito-jwt"`, integration `ftkbtwn`, stages `$default` and `dev` (both kept; `dev` is the console's stage until E09 — §6 #3), pool ids, client `6lkofepp2llp6v4nueg52mcm5v` keeps `name = "My SPA app - mrj1i9"`, functions `core-vpc`/`worker-lambda`. Existing route keys keep their `for_each` key and therefore their address (in-place updates); a route whose `route_key` changes would be a replacement — none does. `disable_execute_api_endpoint` stays `false`. The mobile pool, its client and its domain are not touched (MFA stays OFF there — §6 #2).
- **Terraform conventions (E00 §2.1):** `hashicorp/aws ~> 6.0` at the locked 6.66.0 (never `terraform init -upgrade`; `.terraform.lock.hcl` byte-identical); no `profile` in any provider block; no `provisioner`, `local-exec`, `null_resource`, `external`, `archive_file`; no `tags` on anything E08 creates beyond what `default_tags` supplies (do not add `tags = {}` or a `tags` argument — E02's `default_tags` covers new resources); `terraform fmt` clean; no new root variable/output (E00 §1.1 — the root's `variables.tf`/`outputs.tf` are E04/E09/E13's). Address naming per §2.1.2: `module.api.aws_apigatewayv2_authorizer.mobile`, `module.api.aws_apigatewayv2_route.this["<key>"]`, `module.identity.aws_cognito_user_pool_client.console_dev[0]`.
- **Banned literals in any added line** (driver gate, case-insensitive): the six terms of B00 §0 — do not reproduce them, not even in a comment or the README line; say "skip", "sidestep", "guard", "fallback", "work around". Two live `core-vpc` environment-variable names contain one of them (E00 §0); never spell them, never copy a Lambda environment block anywhere. No `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(`, `#pragma warning disable` anywhere in the diff.
- **Secrets:** no value of `PGPASSWORD`, `MIGRATE_SECRET`, `INTERNAL_SHARED_SECRET`, `RC_WEBHOOK_AUTH_*`, `ANALYTICS_USER_SALT` in any file; no `*.tfplan`, `*.plan.json`, `generated*.tf`, `*.auto.tfvars` (other than `.example`) tracked; delete every plan file you create before you finish (`rm -f`).
- **Tests:** this issue owns no test file. No existing test, script or `.tf` outside the scope list changes. The `infra` root gate (`cd infra/envs/prod && terraform init -backend=false -input=false && terraform validate && terraform fmt -check -recursive ..`) and `terraform fmt -check -recursive infra` from the repo root must both pass; the driver also runs them.
- Standing rules: no `git push`, no PR, never touch `main`, no `eas`/`expo`/deploy command, no npm or git activity outside your worktree, nothing under `/Users/qc/src/recallsmith` or `/Users/qc/Desktop`.

## Changes required

All addresses are as the prod root sees them (`module.api.…`, `module.identity.…`, `module.worker.…`). Keep E01's file layout and resource names; where E01 shaped a map differently from the sketches below, keep E01's shape and extend it — the literal guards grep for names, route keys, values and addresses, not for formatting.

### 1. `infra/modules/api/variables.tf` — two appended variables (E08's only interface change on `api`)

```hcl
variable "mobile_pool_endpoint" {
  type        = string
  description = "cognito-idp.<region>.amazonaws.com/<mobile pool id>, no scheme (module.identity.mobile_pool_endpoint)"
}

variable "mobile_client_id" {
  type        = string
  description = "Mobile app client id; the JWT authorizer audience (module.identity.mobile_client_id)"
}
```
No defaults (the staging root of E10 passes its own). No other variable or output of `api` changes.

### 2. `infra/modules/api/gateway.tf` — the mobile authorizer

Directly after the adopted `resource "aws_apigatewayv2_authorizer" "console"` (which stays byte-identical: `name = "cognito-jwt"`, issuer/audience of the console pool):

```hcl
resource "aws_apigatewayv2_authorizer" "mobile" {
  api_id           = aws_apigatewayv2_api.http.id
  name             = "cognito-jwt-mobile"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = "https://${var.mobile_pool_endpoint}"
    audience = [var.mobile_client_id]
  }
}
```
Plan: 1 `create`; the resolved values must be issuer `https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_04hd6iisb`, audience `["7agirr7f56r9k5p6v6o63al1on"]` (the verify reads them from the plan JSON).

### 3. `infra/modules/api/gateway.tf` — one core-vpc integration, the route map, the auth split

3a. **Integration**: `resource "aws_apigatewayv2_integration" "core_vpc"` (`ftkbtwn`) stays as adopted. Delete the resource block `aws_apigatewayv2_integration.core_vpc_dup` entirely (both instances `["a9dzpce"]`, `["q8lfdrr"]`). `resource "aws_apigatewayv2_integration" "edge_public"` (`wf11obg`) stays.

3b. **Route map**: `aws_apigatewayv2_route.this` keeps its `for_each` over `local.routes` (E01: `{ <key> = { route_key = "...", integration = "core_vpc" | "dup_a9dzpce" | "dup_q8lfdrr" | "edge_public" } }` resolved through `local.integration_ids`). After E08 the map holds exactly these 19 keys with these `route_key` strings (double-quoted HCL, verbatim — the verify greps each one), integration slugs (only `core_vpc` and `edge_public` remain; drop the two `dup_*` entries from `local.integration_ids`) and a new `auth` field:

| key | `route_key` | integration | auth |
|---|---|---|---|
| `default` | `"$default"` | core_vpc | console |
| `proxy` | `"ANY /{proxy+}"` | core_vpc | console |
| `authoring` (new) | `"ANY /api/v1/authoring/{proxy+}"` | core_vpc | console |
| `admin` (new) | `"ANY /api/v1/admin/{proxy+}"` | core_vpc | console |
| `publish_jobs` | `"GET /api/v1/authoring/publish/jobs"` | core_vpc (was `q8lfdrr`) | console |
| `edge_ai` | `"ANY /api/v1/ai/{proxy+}"` | edge_public | console |
| `edge_billing` | `"ANY /api/v1/billing/{proxy+}"` | edge_public | console |
| `edge_admin_cognito` | `"ANY /api/v1/admin/cognito/{proxy+}"` | edge_public | console |
| `sync` (new) | `"ANY /api/v1/sync/{proxy+}"` | core_vpc | mobile |
| `draw_state` (new) | `"ANY /api/v1/draw-state/{proxy+}"` | core_vpc | mobile |
| `user` (new) | `"ANY /api/v1/user/{proxy+}"` | core_vpc | mobile |
| `premium` (new) | `"ANY /api/v1/premium/{proxy+}"` | core_vpc | mobile |
| `me` (new) | `"GET /api/v1/me"` | core_vpc | mobile |
| `entitlements` (new) | `"GET /api/v1/entitlements"` | core_vpc | mobile |
| `premium_url` | `"GET /api/v1/content/premium-url"` | core_vpc (was `a9dzpce`) | mobile |
| `premium_url_dev` | `"GET /api/v1/content/premium-url-dev"` | core_vpc (was `q8lfdrr`) | mobile |
| `health` (new) | `"GET /health"` | core_vpc | none |
| `rc_production` | `"POST /webhooks/revenuecat/production"` | core_vpc (was `a9dzpce`) | none |
| `rc_development` | `"POST /webhooks/revenuecat/development"` | core_vpc (was `q8lfdrr`) | none |

3c. **Resource** (E01's shape plus the two auth attributes):

```hcl
locals {
  integration_ids = {
    core_vpc    = aws_apigatewayv2_integration.core_vpc.id
    edge_public = aws_apigatewayv2_integration.edge_public.id
  }
  authorizer_ids = {
    console = aws_apigatewayv2_authorizer.console.id
    mobile  = aws_apigatewayv2_authorizer.mobile.id
  }
}

resource "aws_apigatewayv2_route" "this" {
  for_each  = local.routes
  api_id    = aws_apigatewayv2_api.http.id
  route_key = each.value.route_key
  target    = "integrations/${local.integration_ids[each.value.integration]}"

  authorization_type = each.value.auth == "none" ? "NONE" : "JWT"
  authorizer_id      = each.value.auth == "none" ? null : local.authorizer_ids[each.value.auth]
}
```
No `authorization_scopes` (Cognito access tokens carry none for these clients). Plan: 9 `create` (`authoring`, `admin`, `sync`, `draw_state`, `user`, `premium`, `me`, `entitlements`, `health`); 10 `update` — `default`, `proxy`, `edge_ai`, `edge_billing`, `edge_admin_cognito` with keys ⊆ `{authorization_type, authorizer_id}`; `publish_jobs`, `premium_url`, `premium_url_dev` with keys ⊆ `{authorization_type, authorizer_id, target}`; `rc_production`, `rc_development` with keys ⊆ `{target}`. Terraform orders the route updates before the two integration deletes (the recorded state dependency), so the apply never leaves a route pointing at a deleted integration.

3d. **`infra/envs/prod/imports.tf`**: remove the two `import {}` blocks whose `to` is `module.api.aws_apigatewayv2_integration.core_vpc_dup["a9dzpce"]` (`id = "ktbq1sie2c/a9dzpce"`) and `…["q8lfdrr"]` (`id = "ktbq1sie2c/q8lfdrr"`). Nothing else in the file changes: the diff is deletions only, `git diff --numstat` shows `0 <n>`, and `grep -c 'import {'` drops by exactly 2. Rationale in Context (a plan cannot run with an import block for an address that has no configuration).

### 4. `infra/modules/api/gateway.tf` — throttling on both stages

Add to **both** `aws_apigatewayv2_stage.default` and `aws_apigatewayv2_stage.dev`, keeping E04's `access_log_settings` and `detailed_metrics_enabled = true` exactly as they are:

```hcl
locals {
  route_throttles = {
    "ANY /api/v1/sync/{proxy+}"             = { burst = 40, rate = 20 }
    "ANY /api/v1/draw-state/{proxy+}"       = { burst = 40, rate = 20 }
    "POST /webhooks/revenuecat/production"  = { burst = 20, rate = 10 }
    "POST /webhooks/revenuecat/development" = { burst = 10, rate = 5 }
  }
}

# inside each of the two stage resources:
  default_route_settings {
    detailed_metrics_enabled = true   # E04
    throttling_burst_limit   = 200
    throttling_rate_limit    = 100
  }

  dynamic "route_settings" {
    for_each = local.route_throttles
    content {
      route_key              = route_settings.key
      throttling_burst_limit = route_settings.value.burst
      throttling_rate_limit  = route_settings.value.rate
    }
  }

  depends_on = [aws_apigatewayv2_route.this]
```
`depends_on` is mandatory: API Gateway validates `RouteSettings` keys against existing routes at `UpdateStage`, and the four keys above are two adopted routes plus two the same apply creates. Plan: 2 `update` with keys ⊆ `{default_route_settings, route_settings}`. No stage variables, no `deployment_id` (E00 §2.1.4).

### 5. Reserved concurrency

- `infra/modules/api/core_vpc.tf`, `resource "aws_lambda_function" "core_vpc"`: add `reserved_concurrent_executions = 40` (a literal; the `lifecycle.ignore_changes` list of §2.1.4 is unchanged and does not cover it).
- `infra/modules/worker/function.tf`, `resource "aws_lambda_function" "worker"`: add `reserved_concurrent_executions = 2`.
Plan: 2 `update`, keys ⊆ `{reserved_concurrent_executions}`. `edge_public` is untouched.

### 6. `infra/modules/identity/cognito.tf` — console pool MFA

In `resource "aws_cognito_user_pool" "console"` (count-guarded, address `module.identity.aws_cognito_user_pool.console[0]`): change `mfa_configuration = "OFF"` to `mfa_configuration = "ON"` and add

```hcl
  software_token_mfa_configuration {
    enabled = true
  }
```
No `sms_configuration`, no `sms_authentication_message`, no other attribute changes (name, tier, password policy, recovery settings, `deletion_protection = "ACTIVE"` stay as adopted). Plan: 1 `update`, keys ⊆ `{mfa_configuration, software_token_mfa_configuration}`. Owner action after apply (state it in the README line): both console users enrol TOTP at their next hosted-UI login (managed login v2 runs the `MFA_SETUP` challenge). The mobile pool block `resource "aws_cognito_user_pool" "mobile"` (`aws_cognito_user_pool.mobile[0]`) is not edited: MFA stays OFF there, no `software_token_mfa_configuration`, and it must plan as no-op.

### 7. `infra/modules/identity/cognito.tf` — `spa` client hardening and the `console-dev` client

7a. In `resource "aws_cognito_user_pool_client" "spa"` (`module.identity.aws_cognito_user_pool_client.spa[0]`, `name = "My SPA app - mrj1i9"` unchanged):

```hcl
  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30
  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
  callback_urls = ["https://d12pfy1rhi3ekm.cloudfront.net/auth/callback"]
  logout_urls   = ["https://d12pfy1rhi3ekm.cloudfront.net/"]
```
`allowed_oauth_flows = ["code"]`, `allowed_oauth_flows_user_pool_client = true`, `allowed_oauth_scopes = ["email", "openid", "profile"]`, `supported_identity_providers = ["COGNITO"]`, `prevent_user_existence_errors = "ENABLED"`, `enable_token_revocation = true`, `auth_session_validity = 3`, `explicit_auth_flows` exactly as E01 adopted them — unchanged. No `localhost` anywhere in the `spa` block after this change. Plan: 1 `update`, keys ⊆ `{access_token_validity, id_token_validity, refresh_token_validity, token_validity_units, callback_urls, logout_urls}`.

7b. New resource, directly after `spa`:

```hcl
resource "aws_cognito_user_pool_client" "console_dev" {
  count        = var.manage_cognito ? 1 : 0
  user_pool_id = aws_cognito_user_pool.console[0].id
  name         = "console-dev"

  # identical to spa except the URLs: same flows, scopes, providers, session and token settings
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  supported_identity_providers         = ["COGNITO"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  auth_session_validity                = 3
  explicit_auth_flows                  = <copy spa's value verbatim>

  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30
  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  callback_urls = ["http://localhost:5173/auth/callback"]
  logout_urls   = ["http://localhost:5173/"]
}
```
No `generate_secret` (public SPA client). Plan: 1 `create` at `module.identity.aws_cognito_user_pool_client.console_dev[0]`.

7c. `infra/modules/identity/outputs.tf`, appended:

```hcl
output "console_dev_client_id" {
  value = var.manage_cognito ? aws_cognito_user_pool_client.console_dev[0].id : null
}
```
Not surfaced as a root output (E00 §1.1 reserves the root's `outputs.tf`); the supervisor reads it after apply with `aws cognito-idp list-user-pool-clients --user-pool-id ap-southeast-2_4Vf8uCXKt --query "UserPoolClients[?ClientName=='console-dev'].ClientId" --output text` and pastes it into `infra/README.md` §6 (E09 reads it from there).

### 8. `infra/envs/prod/main.tf` — wiring

In `module "api" { … }` add exactly two arguments:

```hcl
  mobile_pool_endpoint = module.identity.mobile_pool_endpoint
  mobile_client_id     = module.identity.mobile_client_id
```
Nothing else in the root changes (no new variables, outputs, providers).

### 9. `docs/delivery/r16-issues/E08.plan-allow.json` — the canonical allow-list (verbatim; the verify diffs it as parsed JSON)

```json
{
  "tags_only_updates": false,
  "changes": {
    "module.api.aws_apigatewayv2_authorizer.mobile": "create",
    "module.api.aws_apigatewayv2_route.this[\"authoring\"]": "create",
    "module.api.aws_apigatewayv2_route.this[\"admin\"]": "create",
    "module.api.aws_apigatewayv2_route.this[\"sync\"]": "create",
    "module.api.aws_apigatewayv2_route.this[\"draw_state\"]": "create",
    "module.api.aws_apigatewayv2_route.this[\"user\"]": "create",
    "module.api.aws_apigatewayv2_route.this[\"premium\"]": "create",
    "module.api.aws_apigatewayv2_route.this[\"me\"]": "create",
    "module.api.aws_apigatewayv2_route.this[\"entitlements\"]": "create",
    "module.api.aws_apigatewayv2_route.this[\"health\"]": "create",
    "module.identity.aws_cognito_user_pool_client.console_dev[0]": "create",
    "module.api.aws_apigatewayv2_route.this[\"default\"]": { "action": "update", "keys": ["authorization_type", "authorizer_id"] },
    "module.api.aws_apigatewayv2_route.this[\"proxy\"]": { "action": "update", "keys": ["authorization_type", "authorizer_id"] },
    "module.api.aws_apigatewayv2_route.this[\"edge_ai\"]": { "action": "update", "keys": ["authorization_type", "authorizer_id"] },
    "module.api.aws_apigatewayv2_route.this[\"edge_billing\"]": { "action": "update", "keys": ["authorization_type", "authorizer_id"] },
    "module.api.aws_apigatewayv2_route.this[\"edge_admin_cognito\"]": { "action": "update", "keys": ["authorization_type", "authorizer_id"] },
    "module.api.aws_apigatewayv2_route.this[\"publish_jobs\"]": { "action": "update", "keys": ["authorization_type", "authorizer_id", "target"] },
    "module.api.aws_apigatewayv2_route.this[\"premium_url\"]": { "action": "update", "keys": ["authorization_type", "authorizer_id", "target"] },
    "module.api.aws_apigatewayv2_route.this[\"premium_url_dev\"]": { "action": "update", "keys": ["authorization_type", "authorizer_id", "target"] },
    "module.api.aws_apigatewayv2_route.this[\"rc_production\"]": { "action": "update", "keys": ["target"] },
    "module.api.aws_apigatewayv2_route.this[\"rc_development\"]": { "action": "update", "keys": ["target"] },
    "module.api.aws_apigatewayv2_stage.default": { "action": "update", "keys": ["default_route_settings", "route_settings"] },
    "module.api.aws_apigatewayv2_stage.dev": { "action": "update", "keys": ["default_route_settings", "route_settings"] },
    "module.api.aws_lambda_function.core_vpc": { "action": "update", "keys": ["reserved_concurrent_executions"] },
    "module.worker.aws_lambda_function.worker": { "action": "update", "keys": ["reserved_concurrent_executions"] },
    "module.identity.aws_cognito_user_pool.console[0]": { "action": "update", "keys": ["mfa_configuration", "software_token_mfa_configuration"] },
    "module.identity.aws_cognito_user_pool_client.spa[0]": { "action": "update", "keys": ["access_token_validity", "id_token_validity", "refresh_token_validity", "token_validity_units", "callback_urls", "logout_urls"] },
    "module.api.aws_apigatewayv2_integration.core_vpc_dup[\"a9dzpce\"]": "delete",
    "module.api.aws_apigatewayv2_integration.core_vpc_dup[\"q8lfdrr\"]": "delete"
  }
}
```
Totals: 11 creates, 16 updates, 2 deletes = 29 effective changes, identical in the worker's read-only plan and the supervisor's (Context). Everything else in the plan — including `module.identity.aws_cognito_user_group.editor[0]`, `module.api.aws_apigatewayv2_authorizer.console`, `module.api.aws_apigatewayv2_integration.core_vpc`, every `aws_lambda_permission`, the mobile pool/client/domain — must be `no-op`.

### 10. `infra/README.md` §6 — one appended line

Dated (`YYYY-MM-DD`), naming `E08`, the new authorizer `cognito-jwt-mobile`, the route split, throttles `100 rps / 200 burst`, reserved concurrency `40 / 2`, console pool `MFA ON (TOTP)`, tokens `1 h / 1 h / 30 d`, client `console-dev`, the two removed `imports.tf` blocks, and the two owner/supervisor follow-ups: "owner enrols TOTP at next login" and "supervisor pastes the console-dev client id here: `<pending>`". Prose only — no CLI command text on that line (the apply guard in the verify greps added lines).

### Supervisor post-apply (for the record; not run by the worker, not checked by the verify)

`terraform apply E08.tfplan` → `aws cognito-idp list-user-pool-clients` (client id → README §6) → read-only smoke: `curl -s -o /dev/null -w '%{http_code}' https://ktbq1sie2c.execute-api.ap-southeast-2.amazonaws.com/health` → `200`; the same for `/api/v1/authoring/decks` with no token → `401`; `OPTIONS /api/v1/authoring/decks` with `Origin: https://d12pfy1rhi3ekm.cloudfront.net` + `Access-Control-Request-Method: GET` → `204` with `access-control-allow-origin`; a console login through the hosted UI (TOTP enrolment) → `GET /api/v1/authoring/decks` `200`; `aws apigatewayv2 get-stages` shows the throttles; `aws lambda get-function-concurrency` shows 40 / 2; then the second `terraform plan` must be empty before E09 starts (E00 §0).

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/E08.verify.sh` re-runs exactly these.

1. Scope file exists: `docs/delivery/r16-issues/E08.plan-allow.json`; prerequisites are on the branch: `infra/envs/prod/{main,imports}.tf`, `infra/scripts/check-plan.py`, `infra/modules/api/{gateway,core_vpc,variables}.tf`, `infra/modules/worker/function.tf`, `infra/modules/identity/{cognito,outputs}.tf` (E01), `access_log_settings` in `gateway.tf` (E04), `infra/modules/identity/policies.tf` (E05), `infra/modules/identity/ssm.tf` (E06), `PayloadTooLarge` in `src_C/Shared/RecallSmith.Lambda.Common/Res.cs` (E07).
2. Literal guards (all exit 0): `gateway.tf` has `resource "aws_apigatewayv2_authorizer" "mobile"`, `"cognito-jwt-mobile"`, `"https://${var.mobile_pool_endpoint}"`, `[var.mobile_client_id]`, still `"cognito-jwt"` and `resource "aws_apigatewayv2_authorizer" "console"`, the nine new route keys `"ANY /api/v1/authoring/{proxy+}"`, `"ANY /api/v1/admin/{proxy+}"`, `"ANY /api/v1/sync/{proxy+}"`, `"ANY /api/v1/draw-state/{proxy+}"`, `"ANY /api/v1/user/{proxy+}"`, `"ANY /api/v1/premium/{proxy+}"`, `"GET /api/v1/me"`, `"GET /api/v1/entitlements"`, `"GET /health"`, the ten adopted keys, `throttling_burst_limit = 200`, `throttling_rate_limit = 100` (whitespace-tolerant), the four throttle pairs `40`/`20`, `40`/`20`, `20`/`10`, `10`/`5` next to their route keys, `depends_on = [aws_apigatewayv2_route.this]` twice, `authorization_type`, `authorizer_id`, and no `core_vpc_dup` anywhere under `infra/`; `core_vpc.tf` has `reserved_concurrent_executions = 40`; `worker/function.tf` has `reserved_concurrent_executions = 2`; `cognito.tf` has `mfa_configuration = "ON"`, `software_token_mfa_configuration`, `enabled = true`, `resource "aws_cognito_user_pool_client" "console_dev"`, `"console-dev"`, `"http://localhost:5173/auth/callback"`, `"http://localhost:5173/"`, `"https://d12pfy1rhi3ekm.cloudfront.net/auth/callback"`, `"https://d12pfy1rhi3ekm.cloudfront.net/"`, `refresh_token_validity = 30`, `access_token  = "hours"` / `id_token      = "hours"` / `refresh_token = "days"` (whitespace-tolerant), and the `spa` block contains no `localhost` while the `mobile` pool block still says `mfa_configuration = "OFF"`; `identity/outputs.tf` has `output "console_dev_client_id"`; `api/variables.tf` has `variable "mobile_pool_endpoint"` and `variable "mobile_client_id"`; `envs/prod/main.tf` has `mobile_pool_endpoint = module.identity.mobile_pool_endpoint` and `mobile_client_id = module.identity.mobile_client_id` (whitespace-tolerant); `imports.tf` no longer mentions `core_vpc_dup` and lost exactly 2 `import {` blocks against the merge-base with zero added lines; `infra/README.md` §6 has a line matching `E08.*cognito-jwt-mobile`; `E08.plan-allow.json` parses and equals Changes 9 as JSON; no `provisioner`/`local-exec`/`null_resource`/`archive_file`/`"external"` in `infra/**/*.tf`; no suppression token; no secret value; no `profile =` in a provider.
3. Gates: `terraform fmt -check -recursive infra` (repo root) and `cd infra/envs/prod && terraform init -backend=false -input=false && terraform validate && terraform fmt -check -recursive ..` — exit 0; `.terraform.lock.hcl` unchanged against the merge-base.
4. Plan (read-only, `AWS_PROFILE=dev`, account `622994489535`, `TF_PLUGIN_CACHE_DIR` set): root variables without defaults come from `prod.auto.tfvars.example` with `alert_email` / `snowflake_external_id` replaced by the live values (read-only CLI, written to a temp var file, never printed — E06's recipe); `cd infra/envs/prod && terraform init -input=false -reconfigure && terraform plan -lock=false -input=false -refresh=true -var-file=<tmp>/e08.auto.tfvars -out=<tmp>/e08.tfplan && terraform show -json <tmp>/e08.tfplan > <tmp>/e08.plan.json`; `python3 infra/scripts/check-plan.py --plan <tmp>/e08.plan.json --allow docs/delivery/r16-issues/E08.plan-allow.json` passes; additionally, from the plan JSON: 29 effective changes, no `importing` entry, exactly `module.api.aws_apigatewayv2_integration.core_vpc_dup["a9dzpce"]` and `["q8lfdrr"]` as `delete`, the mobile authorizer's issuer/audience are the mobile pool and client, each of the 19 routes has the `route_key`, `authorization_type`, authorizer (console id `828ehi` known, mobile id unknown-at-plan or a string, none for `NONE`) and `target` of Changes 3b, both stages carry `200/100` defaults and exactly the four `route_settings`, the functions carry `40`/`2`, the pool `ON` + TOTP enabled, `spa` and `console_dev` the URLs and validities of Changes 7, `output_changes` empty. Plan files are deleted afterwards. Nothing from `before`/`after` is printed except booleans and the addresses.
5. Scope + frozen + OTA + apply guard: every changed or untracked path is one of the ten scope files (or under `docs/delivery/r16-issues/`); `git diff --quiet <merge-base> HEAD -- mobile frontend src_C site .github snowflake scripts` (nothing outside `infra` and the brief's docs); frozen three untouched; `mobile/app.json` still `"version": "1.6.1"`; no `@sentry` under `mobile/src`; no tracked `*.tfplan`/`*.plan.json`/`generated*.tf`/`*.auto.tfvars`; no added line (comments excluded, this brief and its verify excluded) contains `terraform apply`/`terraform import` or an `aws … create-/update-/delete-/put-` command.

## Verify

```bash
BASE=delivery/r16-e-prod bash docs/delivery/r16-issues/E08.verify.sh
```

Runs steps 1–5 above (≈ 2–4 min; the refresh of ~85 managed resources dominates; needs `AWS_PROFILE=dev` read-only credentials, `s3:GetObject` on the state bucket and the cached provider). The driver then runs the `infra` root gate, the diff-scoped banned-term grep and the suppression scan; all must be green. **The supervisor applies** (E00 §0): after the merge it plans against the S3 backend, runs `check-plan.py` with the committed `E08.plan-allow.json` (29 effective changes), applies, performs the post-apply list above, and confirms an empty second plan. You never apply, never import by command, never write to the state bucket.

## Do NOT

- Do NOT attach the console authorizer to the mobile routes or the mobile authorizer to `$default`/`ANY /{proxy+}` — the split is the point (review §0.7: one authorizer on `{proxy+}` logs out every phone user).
- Do NOT rename `cognito-jwt`, the `spa` client, any route key of an adopted route, or replace a route (a changed `route_key` is a replacement — add a new key instead).
- Do NOT add `aws_lambda_permission` resources (the `*/*/*` Sid covers every route), `authorization_scopes`, `api_key_required`, stage variables, `deployment_id`, or a `disable_execute_api_endpoint` change.
- Do NOT touch `aws_cognito_user_pool.mobile[0]`, `aws_cognito_user_pool_client.mobile[0]`, the domains, the groups (the `editor` `role_arn` stays as adopted — Context), or add SMS MFA.
- Do NOT add `tags`, a root variable/output, a seventh module, a `provisioner`, or edit `.terraform.lock.hcl`, `backend.tf`, `providers.tf`, `versions.tf`.
- Do NOT edit `imports.tf` beyond removing the two `core_vpc_dup` blocks; do NOT delete or rewrite it.
- Do NOT run `terraform apply`, `terraform import`, `terraform state …`, `terraform plan` without `-lock=false`, any `aws … create-/update-/delete-/put-` command, `eas`, `frontend/deploy.sh`, `src_C/deploy.sh`; do NOT paste plan output (text or JSON) into the PR, the README line or a comment.
- Do NOT change `frontend/.env.development` (E09 owns the `console-dev` switch) or anything under `mobile/`, `frontend/`, `src_C/`.
- Do NOT run npm or git inside `/Users/qc/src/recallsmith` or anywhere under `/Users/qc/Desktop` — only inside your worktree.
