# Secrets rotation runbook

How the nine `/developercards/prod/*` secrets (`secret_parameter_names` in
`infra/envs/prod/main.tf`) and the RDS master password are held and rotated. No value or
example-that-looks-like-a-value appears here — always `<…>` placeholders.

Secrets live only as SSM `SecureString` parameters (values written by the supervisor, ignored
by Terraform state) and, at deploy time, as core-vpc / worker-lambda environment variables written
by `src_C/deploy.sh`. Those two functions do no runtime fetch and there is no SSM VPC endpoint
(E00 §6 #8): their roles have no `ssm:GetParameter*`. The two R18 Python Lambdas outside the VPC
(developercards-webhook-dispatcher, developercards-ai-qa) are the exception: each reads only its own
leaves, by exact name, at runtime (`ssm:GetParameter` in `infra/modules/identity/roles_r18.tf`) and
keeps a value for at most 5 minutes, so a new value reaches them without a deploy.

## Inventory

| Env var | SSM leaf (`/developercards/prod/<leaf>`) | Consumer `file:line` | Who else holds it |
| --- | --- | --- | --- |
| `PGPASSWORD` | `pg-password` | `src_C/Shared/RecallSmith.Lambda.Db/Pg.cs:30` | RDS (the app-role login password) |
| `MIGRATE_SECRET` | `migrate-secret` | `src_C/Vpc/Db/Migrate.cs:138`, `src_C/Vpc/Db/AppRole.cs` (`x-migrate-secret` gate) | supervisor (invoke header) |
| `INTERNAL_SHARED_SECRET` | `internal-shared-secret` | `src_C/Shared/RecallSmith.Lambda.Common/Auth.cs:509` (core-vpc verifies `/api/internal/entitlements/apply` and `/api/internal/subscriptions/upsert`) | edge-public (internal HMAC caller) only; neither Python Lambda since Z08 |
| `INTERNAL_SECRET_WEBHOOK_REPORT` | `webhook-report-secret` | `src_C/Vpc/Internal/WebhookDeliveryReport.cs:43` (core-vpc verifies the delivery report) | developercards-webhook-dispatcher (signs; reads the leaf at runtime) |
| `INTERNAL_SECRET_AI_QA_RESULTS` | `ai-qa-results-secret` | `src_C/Vpc/Internal/AiQaResults.cs:82` (core-vpc verifies the results report) | developercards-ai-qa (signs; reads the leaf at runtime) |
| — (never an env var; `SSM_NOT_ENV`, `SSM_NOT_ENV_PATTERN`) | `webhook-signing-secret`, per subscription `webhook-signing-secret-sub-<id>` | developercards-webhook-dispatcher, runtime (`services/webhook-dispatcher/src/webhook_dispatcher/handler.py:152`) | every webhook receiver (a `-sub-<id>` secret: that subscription's receiver only) |
| — (never an env var; `SSM_NOT_ENV`) | `anthropic-api-key` | developercards-ai-qa, runtime, only with `AI_PROVIDER=anthropic` (`services/ai-qa/src/ai_qa/handler.py:240`) | Anthropic (the issuer) |
| `RC_WEBHOOK_AUTH_PRODUCTION` | `rc-webhook-auth-production` | `src_C/Vpc/Webhooks/RevenuecatWebhook.cs` | RevenueCat dashboard (production Authorization header) |
| `RC_WEBHOOK_AUTH_DEVELOPMENT` | `rc-webhook-auth-development` | `src_C/Vpc/Webhooks/RevenuecatWebhook.cs` | RevenueCat dashboard (development Authorization header) |

While a rotation is in progress some leaves have a `<leaf>-previous` companion, read in these
cases only: `internal-shared-secret-previous`, `webhook-report-secret-previous` and
`ai-qa-results-secret-previous` become core-vpc's `<env var>_PREVIOUS` (`SSM_TO_ENV_INTERNAL` in
`src_C/scripts/merge-env.sh`), accepted next to the current value, and the last two are also the
callers' fallback on a 401/403; `webhook-signing-secret-previous` (and `…-sub-<id>-previous`) is read
by the dispatcher only and skipped by `deploy.sh`.

The RDS master password is **not** in this table: nothing in the app uses it after E06, and it
is never in SSM (see below).

## Rules

- A secret value is **never** in Terraform, in git, or in Terraform state. `modules/identity/ssm.tf`
  creates the parameters as placeholders with `ignore_changes = [value]`; the real values are
  written outside Terraform.
- A leaf with an env var: `aws ssm put-parameter … --overwrite --value <new>` **then**
  `ENV=<env> ./src_C/deploy.sh` (which overlays the environment before `publish-version`). core-vpc
  does no runtime fetch, so a value only takes effect on the next deploy, and a deleted optional leaf
  (`SSM_OPTIONAL_ENV` in `src_C/scripts/merge-env.sh`) only leaves the environment on the next deploy.
  The two route secrets change on both sides and use "Route secrets" below instead.
- A leaf only the Python Lambdas read (`webhook-signing-secret*`, `anthropic-api-key`):
  `put-parameter` alone, no deploy; it reaches every warm container within 5 minutes. `deploy.sh`
  skips these leaves (`SSM_NOT_ENV`, `SSM_NOT_ENV_PATTERN`).
- `deploy.sh` merges `$cur + env/<env>.env.json + <ssm values>` (later wins), so the two
  unspellable core-vpc keys and any stray keys survive untouched.

## App-role password rotation

Rotates `PGPASSWORD` (the `developercards_app` login password). The bootstrap endpoint is
idempotent: with `createDatabase: false` it only runs `alter role … password`.

1. Generate a 32–64 character `[A-Za-z0-9]` password `<new-pw>` (matches
   `^[A-Za-z0-9]{32,64}$`); keep it only in the owner's password manager.
2. `aws ssm put-parameter --name /developercards/prod/pg-password --type SecureString --overwrite --value <new-pw>`
3. Write a temporary `roles.json` with one object
   `{"name":"developercards_app","password":"<new-pw>","database":"developercards_db","createDatabase":false}`
   then
   `MIGRATE_SECRET=<migrate-secret> scripts/invoke-as-admin.sh core-vpc:prod POST /api/v1/admin/db/bootstrap-roles roles.json`
4. `ENV=prod ./src_C/deploy.sh` at once, so the new version freezes the new `PGPASSWORD`.
5. Smoke: `GET /api/v1/db/ping` as admin through `invoke-as-admin.sh`.

Expected window, stated honestly: between the `alter role … password` and the alias move, **new**
connections opened by the old published version fail; already-pooled connections keep working.
Do it in the maintenance window. Shred the temporary `roles.json` afterwards.

## Master password rotation

The RDS master password is a CLI action, **never in Terraform** (`password` is never set on
`aws_db_instance`), and it is not in SSM — it lives in the owner's password manager. Nothing in
the app uses it after E06.

- `aws rds modify-db-instance --db-instance-identifier developercards --master-user-password '<new-master-pw>' --apply-immediately`
- Watch `DBInstanceStatus` move through `resetting-master-credentials` back to `available`.

## Migrate secret

Rotates `MIGRATE_SECRET` (the `x-migrate-secret` gate on the admin DB routes).

1. `aws ssm put-parameter --name /developercards/prod/migrate-secret --type SecureString --overwrite --value <new>`
2. `ENV=prod ./src_C/deploy.sh`
3. The new value is what the supervisor now passes as `MIGRATE_SECRET=<new>` to `invoke-as-admin.sh`.

## Internal shared secret

Rotates `INTERNAL_SHARED_SECRET`, the HMAC secret shared by edge-public (the caller) and core-vpc
(which verifies `/api/internal/entitlements/apply` and `/api/internal/subscriptions/upsert` with it).
Since Z08 the webhook dispatcher and ai-qa sign with their own route secrets (below), and their roles
cannot read this leaf. core-vpc falls back to it on a route-secret route only when that route's own
env var is unset.

1. `aws ssm put-parameter --name /developercards/prod/internal-shared-secret --type SecureString --overwrite --value <new>`
2. `ENV=prod ./src_C/deploy.sh` for core-vpc, and update edge-public's copy the same way, so both
   sides sign and verify with the same value (rotate both in the maintenance window).

core-vpc also accepts `INTERNAL_SHARED_SECRET_PREVIOUS` (from `internal-shared-secret-previous`), so
the route-secret procedure below works for this leaf too and removes the flag day on core's side:
update edge-public's copy in its step 5 instead of waiting, and never skip its last deploy.

## Route secrets (webhook-report-secret, ai-qa-results-secret)

`webhook-report-secret` (dispatcher → core-vpc `INTERNAL_SECRET_WEBHOOK_REPORT`) and
`ai-qa-results-secret` (ai-qa → core-vpc `INTERNAL_SECRET_AI_QA_RESULTS`) rotate with one procedure:
services/ai-qa/README.md, "Route-secret rotation". In short: put `<leaf>-previous` = the current
value, deploy, put a new `<leaf>`, deploy, wait 10 minutes, delete `<leaf>-previous`, deploy. The
last deploy is the revocation: until it has run, core-vpc still accepts the old value.

## Webhook signing secret

`webhook-signing-secret` (and, with `WEBHOOK_SUBSCRIPTION_SECRETS` on, each
`webhook-signing-secret-sub-<id>`) is read only by the dispatcher; no deploy is involved. Receivers
must accept either signature header first. Procedure: services/webhook-dispatcher/README.md,
"Signing-secret rotation" and "Per-subscription secrets".

## Anthropic API key

Read by ai-qa only with `AI_PROVIDER=anthropic`; the committed `services/ai-qa/env/prod.env.json`
sets `bedrock`, so with that file the key is not read at all.

1. Issue a new key in the Anthropic Console.
2. `aws ssm put-parameter --name /developercards/prod/anthropic-api-key --type SecureString --overwrite --value <new>`
   (no deploy; every warm ai-qa container picks it up within 5 minutes).
3. Wait 5 minutes, then revoke the old key in the Anthropic Console.

## RevenueCat webhook auth

Production and development are **separate** parameters; rotate the one you mean.

1. `aws ssm put-parameter --name /developercards/prod/rc-webhook-auth-production --type SecureString --overwrite --value <new>`
   (or `…/rc-webhook-auth-development` for the development webhook).
2. `ENV=prod ./src_C/deploy.sh`
3. Update the matching Authorization header in the RevenueCat dashboard to `<new>`.

## First deploy (E06 cut-over)

The bootstrap endpoint ships in the new code, but the new `deploy.sh` switches `PGUSER` to
`developercards_app`, which does not exist until the endpoint has run — hence the `INJECT_ENV=0`
first pass. Supervisor order, after merge:

1. `terraform init` (real backend) → `terraform plan -out=E06.tfplan` →
   `terraform show -json E06.tfplan | python3 infra/scripts/check-plan.py --allow docs/delivery/r16-issues/E06.plan-allow.json`
   (5 creates) → `terraform apply E06.tfplan`.
2. `aws ssm put-parameter --overwrite` ×5 (`pg-password` = the new app-role password).
3. `INJECT_ENV=0 ENV=prod ./src_C/deploy.sh` — new code, still connecting as the master user, env untouched.
4. `MIGRATE_SECRET=<migrate-secret> scripts/invoke-as-admin.sh core-vpc:prod POST /api/v1/admin/db/bootstrap-roles roles.json`
   with both roles — `developercards_app` (`createDatabase: false`) and `developercards_app_staging`
   (`developercards_staging`, `createDatabase: true`).
5. `ENV=prod ./src_C/deploy.sh` — app role (`developercards_app`) from here on.
6. `aws rds modify-db-instance --db-instance-identifier developercards --master-user-password <new> --apply-immediately`.
7. Smoke: `GET /api/v1/db/ping` as admin through `invoke-as-admin.sh`, one console page.
8. Second `terraform plan` empty.

## Staging

Same procedure with the `/developercards/staging/*` parameters and `ENV=staging` (the staging env
file and its wiring arrive with E10). `developercards_app_staging` owns `developercards_staging`,
created during the E06 cut-over while master access still exists.
