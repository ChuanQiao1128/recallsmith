# Secrets rotation runbook

How the five `/developercards/prod/*` secrets and the RDS master password are held and
rotated. No value or example-that-looks-like-a-value appears here — always `<…>` placeholders.

Secrets live only as SSM `SecureString` parameters (values written by the supervisor, ignored
by Terraform state) and, at deploy time, as Lambda environment variables written by
`src_C/deploy.sh`. There is no runtime fetch from the function and no SSM VPC endpoint
(E00 §6 #8): the Lambda role has no `ssm:GetParameter*`.

## Inventory

| Env var | SSM leaf (`/developercards/prod/<leaf>`) | Consumer `file:line` | Who else holds it |
| --- | --- | --- | --- |
| `PGPASSWORD` | `pg-password` | `src_C/Shared/RecallSmith.Lambda.Db/Pg.cs:30` | RDS (the app-role login password) |
| `MIGRATE_SECRET` | `migrate-secret` | `src_C/Vpc/Db/Migrate.cs:138`, `src_C/Vpc/Db/AppRole.cs` (`x-migrate-secret` gate) | supervisor (invoke header) |
| `INTERNAL_SHARED_SECRET` | `internal-shared-secret` | `src_C/Shared/RecallSmith.Lambda.Common/Auth.cs:314` | edge-public (internal HMAC caller) |
| `RC_WEBHOOK_AUTH_PRODUCTION` | `rc-webhook-auth-production` | `src_C/Vpc/Webhooks/RevenuecatWebhook.cs` | RevenueCat dashboard (production Authorization header) |
| `RC_WEBHOOK_AUTH_DEVELOPMENT` | `rc-webhook-auth-development` | `src_C/Vpc/Webhooks/RevenuecatWebhook.cs` | RevenueCat dashboard (development Authorization header) |

The RDS master password is **not** in this table: nothing in the app uses it after E06, and it
is never in SSM (see below).

## Rules

- A secret value is **never** in Terraform, in git, or in Terraform state. `modules/identity/ssm.tf`
  creates the parameters as placeholders with `ignore_changes = [value]`; the real values are
  written outside Terraform.
- Rotation is always: `aws ssm put-parameter … --overwrite --value <new>` **then**
  `ENV=<env> ./src_C/deploy.sh` (which overlays the environment before `publish-version`). No
  runtime fetch happens, so a value only takes effect on the next deploy.
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

Rotates `INTERNAL_SHARED_SECRET` (the HMAC secret shared with edge-public).

1. `aws ssm put-parameter --name /developercards/prod/internal-shared-secret --type SecureString --overwrite --value <new>`
2. `ENV=prod ./src_C/deploy.sh` for core-vpc, and update edge-public's copy the same way, so both
   sides sign and verify with the same value (rotate both in the maintenance window).

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
