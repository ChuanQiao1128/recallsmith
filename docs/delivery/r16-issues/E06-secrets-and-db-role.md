# E06 — application DB role, SSM SecureString, deploy-time injection, constant-time compares (`secrets-and-db-role`)

Stop running the API as the RDS master user and stop treating five secrets as hand-typed Lambda env vars. This issue (1) adds a super_admin-only bootstrap endpoint that creates two least-privilege Postgres login roles (`developercards_app` owning everything in `developercards_db`, `developercards_app_staging` owning a new `developercards_staging` database) with 32–64-char passwords that are never interpolated into SQL; (2) creates five SSM `SecureString` placeholders under `/developercards/prod/*` in Terraform (`modules/identity/ssm.tf`, values ignored by state and written by the supervisor); (3) rewrites `src_C/deploy.sh` so every deploy overlays the function's environment with a committed non-secret file plus the SSM values **before** `publish-version` — no runtime fetch, no VPC endpoint, no egress; (4) adds `Secrets.FixedTimeEquals` and uses it for the three `x-migrate-secret` compares in `Migrate.cs`; (5) adds the supervisor's `scripts/invoke-as-admin.sh` and the secrets-rotation runbook (including RDS master rotation, which is a CLI action, never Terraform). Roots: `src_C` + `infra` (+ `scripts/`, `docs/runbooks/`). Worker timeout 90 min.

## Context

Base: `delivery/r16-e-prod` (== `main@4b07f19`, JWT verification merged) **plus E01–E05 merged and applied** (E00 §4: E06 depends on E05). Every `file:line` below was read on the base tree on 2026-09-22; every AWS fact was read the same day with `AWS_PROFILE=dev` (account `622994489535`, `ap-southeast-2`), describe/get/list only, no secret value printed. `docs/delivery/r16-issues/E00-contracts.md` (E00) is binding; §2.6 (`:290-296`) is this issue's contract, §0 (`:9-37`) the non-negotiables, §1.1/§1.2 (`:43-110`) the file map, §3.1/§3.3 (`:419-438`) the plan/test contracts, §5 (`:470-482`) the verify conventions, §6 #8 and #9 (`:491-492`) the two decisions that shape it.

What the tree and the account look like today:

- **The app is the master user.** `core-vpc` carries 32 env vars and `worker-lambda` 9 (`aws lambda get-function-configuration`, names only); on both, `PGUSER=postgres`, `PGDATABASE=developercards_db`; on core-vpc also `PGSSLMODE=require`, `API_ENV=production`, `PG_MAX=1`, `LOG_LEVEL=info`. RDS `developercards`: `MasterUsername=postgres`, `EngineVersion=17.9`, `DBName=null` (the `developercards_db` database was created by hand). `aws ssm describe-parameters` → 0 parameters; the only Secrets Manager entry is the stale Aurora one E02 deletes. Five env keys are secrets: `PGPASSWORD`, `MIGRATE_SECRET`, `INTERNAL_SHARED_SECRET`, `RC_WEBHOOK_AUTH_PRODUCTION`, `RC_WEBHOOK_AUTH_DEVELOPMENT` (review §2.1.3, `docs/backend-architecture-review-2026-09-22.md:88`). Two further core-vpc keys have names no file in this repo may spell (E00 §0 "Two env-var names are unspellable"); the deploy-time merge is an overlay precisely so they survive untouched.
- **Env reads.** `src_C/Shared/RecallSmith.Lambda.Db/Pg.cs:27-30` reads `PGHOST/PGDATABASE/PGUSER/PGPASSWORD` once into a static `NpgsqlDataSource` (`:22`, `Reset()` `:12`); `OpenConnectionOrNullAsync()` `:122-123` returns null when any is missing. `src_C/Vpc/Db/Pg.cs` is a byte-near duplicate in namespace `RecallSmith.Lambda.Vpc.Db` (second pool; E14 deletes it). C# resolves an unqualified `Pg` inside namespace `RecallSmith.Lambda.Vpc.Db` to that duplicate, so the new `AppRole.cs` (same namespace, E00 §1.2) must write `RecallSmith.Lambda.Db.Pg.OpenConnectionOrNullAsync()` fully qualified and `using static RecallSmith.Lambda.Db.DbUtil;` — it then keeps compiling after E14 and its tests share the fixture's pool.
- **The three secret compares.** `src_C/Vpc/Db/Migrate.cs:138-142` (`HandleDbMigrate`), `:260-264` (`HandleDbCreateDatabase`), `:297-301` (`HandleDbDropAndRecreate`): `var required = Environment.GetEnvironmentVariable("MIGRATE_SECRET") ?? string.Empty; if (!string.IsNullOrEmpty(required)) { var got = Validation.GetHeader(req, "x-migrate-secret") ?? string.Empty; if (!string.Equals(got, required, StringComparison.Ordinal)) return res.Forbidden("Bad migrate secret"); }`. The ordinal compare short-circuits on the first differing byte. The constant-time idiom already in the tree is `Auth.VerifyInternalSignature` (`src_C/Shared/RecallSmith.Lambda.Common/Auth.cs:312-346`): UTF-8 bytes, equal-length check, `CryptographicOperations.FixedTimeEquals` (`:336-339`). `RevenuecatWebhook.cs:265` has the same defect and is **E07's** (it calls this issue's helper). `Migrate.cs` already has `using RecallSmith.Lambda.Common;` (`:3`), so `Secrets.FixedTimeEquals` resolves without a new `using`.
- **Routes.** `src_C/Vpc/VpcFunction.cs:118-158` is the DB block of `DispatchAsync`: `db/ping` `:119-122`, `admin/db/migrate` `:123-126`, `admin/db/content-intelligence-demo` `:127-130`, … `admin/db/rc-events` `:155-158`. Every entry is `if (p.EndsWith("<path>", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) { return await Vpc.Db.X.HandleY(req, res, auth); }`. E00 §2.16: E06 inserts `bootstrap-roles` directly after the `db/migrate` block and nobody reorders existing blocks.
- **Response helpers.** `src_C/Shared/RecallSmith.Lambda.Common/Res.cs:159-177` has `Ok/BadRequest/Unauthorized/Forbidden/NotFound/MethodNotAllowed/NotImplemented`; there is **no 409 helper** and `Wrap` is private; `Raw(int statusCode, object body, …)` (`:139`) is the public escape hatch the webhook uses. `Res.cs` belongs to E07 (E00 §1.2), so the 409 of this issue goes through `res.Raw(409, …)`. `Validation.GetHeader` (`Validation.cs:22-26`), `ParseJsonBody` (`:30-41`, null on empty/invalid), `Auth.RequireSuperAdmin(auth, res)` (`Auth.cs:304-310`).
- **deploy.sh today** (`src_C/deploy.sh`, 58 lines): header `:1-11` (migrations are not run here), `DRY_RUN` returns before any AWS call `:27`, `update-function-code` `:29`, `wait function-updated` `:30`, CodeSha256 check `:31-35`, `publish-version` `:47`, `update-alias` `:48`, alias sha check `:49-51`. It never calls `update-function-configuration`: all 32/9 keys were set by hand and persist. Lambda environment is frozen into each published version, so the injection has to happen inside `deploy_one` **before** `publish-version`. `./package_lambda_zip.sh` (`:20`) runs `dotnet publish` and `zip`; it never calls `aws`, so a `DRY_RUN=1` run is network-free.
- **Tests.** `src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs`: one Testcontainers `postgres:16-alpine` (`:31`), user/password `recallsmith`/`recallsmith` (`:33-34`, the image's `POSTGRES_USER` is a superuser, so `rolcreaterole` is true), env set before `Pg.Reset()` (`:58-72`), `CreateScratchDatabaseAsync(name)` (`:118-128`, same container, `drop … with (force)` then `create database`), `ApplyMigrationsAsync(conn, int.MaxValue)` (`:136-155`), `[Collection(PostgresCollection.Name)]` runs serially (`:159-165`). `DbWarmupTests.cs:180-200` is the precedent for swapping a PG env var + `Pg.Reset()` inside `try/finally` that restores it. `CardsPageTests.cs:66-91` builds a gateway event with `requestContext.authorizer.jwt.claims` (`sub`, `cognito:groups` as an array); `AuthBearerTests.cs:68` drives `new VpcFunction().Handler(evt)` end to end and `:214` shows the gateway's stringified `"cognito:groups": "[super_admin]"` form, which `invoke-as-admin.sh` reproduces. xunit 2.5.3, no fast-check: property tests are `[Theory]` + `[MemberData]` (E00 §3.3).
- **Infra after E05** (what the worktree contains when this issue starts): `infra/envs/prod/{versions,providers,backend,variables,outputs,main,imports}.tf`, `infra/modules/identity/{main,variables,outputs,cognito,policies}.tf`, `infra/scripts/check-plan.py`, `infra/README.md` §6 change log. `modules/identity` takes only strings (E00 §2.1.1) and E05 gave the Lambda roles **no** SSM permission (E00 §6 #8: only the GHA roles of E11 and the admin profile read `/developercards/*`). `hashicorp/aws ~> 6.0` (6.66.0 locked) does not mark `environment.variables` sensitive, which is why every managed function has `ignore_changes = [environment]` (E00 §2.1.4) and why this issue never writes a Lambda `environment` block: the env is owned by `deploy.sh`.
- **Tools.** Terraform 1.16.3, `jq` 1.7.1, python3 3.8 (the inline checker in the verify is 3.8-compatible), dotnet 8.0.413, Docker for the DB test class.

What E00 decided (and why):

- §2.6.1 / §6 #9: **one app role owns the schema**; migrations keep running through the same pool as requests (`Migrate.cs` → `Pg`), so a DML-only role would break `db/migrate`; the separate `migrator` role is post-wave. `developercards_staging` (database + role) is created **now**, while master access still exists; after this issue nothing connects as master.
- §2.6.2 / §6 #8: **inject at deploy, never fetch at runtime**: the Lambda is in a VPC with no egress; SSM values reach the function only as environment variables written by `deploy.sh` (E06) or CD (E11). Rotation = `put-parameter` + redeploy (runbook).
- §2.6.3: the env merge is `$cur + $file + $sec` — an **overlay**. It preserves the two unspellable keys and the stray ones (`ENI_BUMP`, `VERSION_BUMP`, `ADMIN_DEBUG`), which the supervisor removes by CLI after the wave, never by a file in git. E00 names one committed file per environment (`src_C/env/prod.env.json`, flat object, seed given verbatim) and says "the worker file gets `PGUSER`, `PGSSLMODE`, `PG_MAX`, `LOG_LEVEL`": resolved here as a **projection**, not a second file — `deploy.sh` derives the worker overlay from the same file through a fixed key list (`WORKER_FILE_KEYS`), and the worker's secret overlay is `PGPASSWORD` only (`WORKER_SECRET_KEYS`). E13 later appends `ANALYTICS_S3_BUCKET`/`CI_SNAPSHOT_BUCKET` to the flat file and they reach core-vpc only, which is where they are read.
- §2.6.5 / §0: the RDS master password is **never** in Terraform (`password` is never set on `aws_db_instance`); rotation is `aws rds modify-db-instance` by the supervisor. Real SSM values never enter state (`ignore_changes = [value]`); the placeholder does, accepted.
- **First-deploy ordering (resolved here, recorded for E00 §2.6.5).** The bootstrap endpoint ships in the *new* code, but the new `deploy.sh` switches `PGUSER` to `developercards_app` — a role that does not exist until the endpoint has run. `deploy.sh` therefore accepts `INJECT_ENV=0` (code-only deploy, today's behaviour, env untouched). Supervisor order: apply → `put-parameter` ×5 → `INJECT_ENV=0 ENV=prod ./deploy.sh` (new code, still master) → `invoke-as-admin.sh … bootstrap-roles` → `ENV=prod ./deploy.sh` (app role from here on) → `modify-db-instance` master rotation → smoke → second plan empty.
- **Worker plan = supervisor plan (E06 is the first issue in E00 §6 #25's mode (b); `E02.verify.sh`–`E05.verify.sh` still use E01's local `backend_override.tf` + a noise filter).** A plan against an *empty* local state would show every resource E02–E05 created as `create`, so from E06 on the committed allow file can only be applied to a real-state plan. The verify therefore plans against the **real** S3 backend read-only: `terraform init -reconfigure` + `plan -lock=false -input=false` reads the state (`s3:GetObject`) and never locks or writes it (`use_lockfile` is skipped by `-lock=false`; nothing is applied). Root variables come from `prod.auto.tfvars.example` with `alert_email` (budget subscriber) and `snowflake_external_id` (`iam get-role`) replaced by the live values inside `$TMP`, never printed, so no placeholder surfaces an unlisted update. The plan must be **exactly** the five `create`s of `E06.plan-allow.json` (no import, update, delete, replace or output change) — checked by `check-plan.py` and independently by an inline shape check that prints addresses and actions only. The `-backend=false` init remains the root gate (`validate`). Precondition: E01–E05 applied and their second plan empty (E00 §0).
- `grant <role> to current_user` before ownership transfer: on RDS the master is `rds_superuser` + `CREATEROLE`, not a real superuser; PG 16+ `ALTER … OWNER TO` requires the ability to `SET ROLE` to the new owner, and the implicit self-grant that `CREATE ROLE` produces has `SET FALSE` by default. The explicit grant (default `SET TRUE`, `INHERIT` per the grantee) is what makes `create database … owner` and `alter table … owner to` succeed, and it also keeps the master able to read every table afterwards (membership ⇒ owner rights).
- Secret-leak grammar (E00 §5): a secret's **name** may appear in a diff; a name followed by `=`/`:` and a quoted literal that does not start with `"`, `$` or `P` fails the gate. Every fixture value for a secret-named key in this issue therefore starts with `PLACEHOLDER-` (the same convention as the SSM placeholder `PLACEHOLDER-set-by-supervisor`).

## Read first

1. `docs/delivery/r16-issues/E00-contracts.md` §0 (`:9-37`), §1.1 `identity` rows + `main.tf` row (`:47-53`, `:55`), §1.2 rows `Secrets.cs`, `Migrate.cs`, `AppRole.cs`, `deploy.sh`, `invoke-as-admin.sh`, `secrets-rotation.md` and the test-file paragraph (`:71-110`), §2.1.1 identity interface (`:118-139`), §2.5 (`:281-288`, what E05 left in `identity`), §2.6 (`:290-296`), §2.7 first bullet (`:300`, E07's use of the helper), §2.16 (`:411-413`), §3.1 (`:419-430`), §3.3 (`:436-438`), §5 (`:470-482`), §6 #8, #9, #17, #20, #24 (`:491-492`, `:500`, `:503`, `:509`).
2. `src_C/Vpc/Db/Migrate.cs:1-8`, `:110-150`, `:252-320`.
3. `src_C/Vpc/VpcFunction.cs:1-60`, `:96-160`.
4. `src_C/Shared/RecallSmith.Lambda.Common/Auth.cs:296-346`; `Res.cs:120-176`; `Validation.cs:18-45`, `:170-178`.
5. `src_C/Shared/RecallSmith.Lambda.Db/Pg.cs` whole file (≈150 lines) and `DbUtil.cs:1-60`; `src_C/Vpc/Db/Pg.cs:1-25` (only to see the namespace clash).
6. `src_C/deploy.sh` whole file (58 lines); `src_C/package_lambda_zip.sh:1-60`.
7. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs` whole file; `DbWarmupTests.cs:170-240`; `CardsPageTests.cs:60-100`; `AuthBearerTests.cs:40-70`, `:200-225`; `JwtVerifierTests.cs` (any `[Theory]` + `[MemberData]` shape).
8. `infra/modules/identity/variables.tf`, `outputs.tf`, `policies.tf`; `infra/envs/prod/main.tf`, `variables.tf`, `prod.auto.tfvars.example`; `infra/scripts/check-plan.py --help`; `infra/README.md` §2, §5, §6.
9. `docs/delivery/r16-issues/C05-topic-server.md` and `C05.verify.sh` (format precedent), `A02.verify.sh:1-24` (skeleton).

## Constraints

- **Scope (the ONLY files that may change):**
  1. `infra/modules/identity/ssm.tf` (new)
  2. `infra/modules/identity/variables.tf` (append one `variable` block)
  3. `infra/modules/identity/outputs.tf` (append two `output` blocks)
  4. `infra/envs/prod/main.tf` (add one argument to `module "identity"`)
  5. `infra/README.md` (append exactly one dated line to §6)
  6. `src_C/Shared/RecallSmith.Lambda.Common/Secrets.cs` (new)
  7. `src_C/Vpc/Db/Migrate.cs` (three lines, `:142`, `:264`, `:301`)
  8. `src_C/Vpc/Db/AppRole.cs` (new)
  9. `src_C/Vpc/VpcFunction.cs` (four added lines after `:126`)
  10. `src_C/deploy.sh` (rewritten)
  11. `src_C/env/prod.env.json` (new)
  12. `src_C/scripts/merge-env.sh` (new)
  13. `src_C/scripts/merge-env.test.sh` (new)
  14. `scripts/invoke-as-admin.sh` (new, `chmod +x`)
  15. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/AppRoleTests.cs` (new)
  16. `src_C/Tests/RecallSmith.Lambda.IntegrationTests/SecretsCompareTests.cs` (new)
  17. `docs/runbooks/secrets-rotation.md` (new)
  18. `docs/delivery/r16-issues/E06.plan-allow.json` (new)
  Nothing else: no `infra/envs/prod/{variables,outputs,imports,backend,providers,versions}.tf`, no other module, no `infra/scripts/*`, no `Res.cs`, no `RevenuecatWebhook.cs`, no `Pg.cs`/`DbUtil.cs` (either copy), no `.csproj`, no migration file, no `mobile/`, `frontend/`, `snowflake/`, `.github/`, no `src_C/env/staging.env.json` (E10), no `src_C/package_lambda_zip.sh`, no existing test file.
- **WORKER SAFETY RULE:** a worker may run read-only AWS CLI, `terraform init/validate/plan` (plan must be saved with -out and shown as JSON), but NEVER `terraform apply`, `terraform import` (state-changing), `aws ... create/update/delete/put`, `eas`, or any deploy script. The supervisor applies plans after each merge. Each infra brief's verify.sh therefore checks the PLAN (terraform show -json) against an explicit allow-list of resource addresses and actions — nothing else may appear as create/update/delete.
  In this issue that means: `./deploy.sh` only with `DRY_RUN=1`; `scripts/invoke-as-admin.sh` only with `DRY_RUN=1`; `aws ssm get-parameter --with-decryption` / `get-parameters-by-path --with-decryption`, `aws lambda invoke`, `aws lambda update-function-configuration`, `aws ssm put-parameter`, `aws rds modify-db-instance` are supervisor/owner only and appear in your files only as code paths behind the `DRY_RUN` return or as runbook text. `terraform init` is always `-backend=false -input=false`. `import {}` blocks already in `imports.tf` are configuration; do not add, edit or remove any.
- **Frozen files — zero diff:** `mobile/src/content/deckRepository.ts`, `mobile/src/sync/progressSync.ts`, `mobile/src/review/model.ts`.
- **OTA rule:** nothing under `mobile/` changes; `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json` (`"version": "1.6.1"`), `mobile/eas.json` byte-identical; no `@sentry` anywhere. No `PackageReference` is added or changed in any `.csproj`.
- **No renames, no Lambda env in Terraform:** existing resource names/ids stay; no `.tf` gains an `environment` block, a `provisioner`, `local-exec`, `null_resource`, `external` data source or `archive_file`; no `profile` in any provider; no `key_id` override on the SSM parameters (AWS-managed `alias/aws/ssm`); no `insecure_value`.
- **Secrets:** never a real value anywhere — not in `.tf`, `.json`, `.md`, `.sh`, test fixtures, verify output, commit messages or the PR. Fixture values for `PGPASSWORD`, `MIGRATE_SECRET`, `INTERNAL_SHARED_SECRET`, `RC_WEBHOOK_AUTH_*`, `ANALYTICS_USER_SALT` start with `PLACEHOLDER-`. Never print an `Environment.Variables` object, a plan JSON or `before/after` values (the verify prints address + actions only and deletes its plan files in a `trap`). The two unspellable core-vpc env names are never written.
- **Banned literals in any added line** (driver gate, case-insensitive): the six terms of B00 §0 — say "work around", "sidestep", "guard", "fallback", "probe". No `[Fact(Skip = …)]` / `[Theory(Skip = …)]`, `#pragma warning disable`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.skip(`, `.only(` anywhere in the diff.
- **Existing tests:** every existing test file is byte-identical; the two new classes are the only test files. The full suite (`cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests`, Docker) must stay green.
- **dotnet / Docker / terraform:** dotnet 8.0.413, implicit cached restore only (no `dotnet restore` by hand). `AppRoleTests` needs a running Docker daemon (`postgres:16-alpine` cached locally); `SecretsCompareTests` is pure. `export TF_PLUGIN_CACHE_DIR="$HOME/.terraform.d/plugin-cache"` before any `terraform init` so the locked 6.66.0 provider is reused; never edit `.terraform.lock.hcl`.
- Standing rules: no `git push`, no PR, never touch `main`, no `npm`, no `expo`, no `eas`; never run git inside `/Users/qc/src/recallsmith` (the shared checkout) — only inside your worktree.

## Changes required

1. **`infra/modules/identity/variables.tf`** — append (nothing else in the file changes):
   ```hcl
   variable "secret_parameter_names" {
     description = "Kebab-case leaf names under /developercards/<env>/; values are written by the supervisor with put-parameter, never by Terraform."
     type        = list(string)
     default     = []
   }
   ```

2. **`infra/modules/identity/ssm.tf` (new)** — exactly one resource:
   ```hcl
   # Placeholders only. The real values are written by the supervisor
   # (aws ssm put-parameter --overwrite) after apply and are ignored by state;
   # deploy.sh copies them into the Lambda environment at deploy time (E00 §2.6.3).
   # No Lambda role reads SSM (E00 §6 #8): there is no runtime fetch and no VPC endpoint.
   resource "aws_ssm_parameter" "secret" {
     for_each = toset(var.secret_parameter_names)

     name        = "/developercards/${var.env}/${each.key}"
     description = "developercards ${var.env} secret ${each.key} (value managed outside Terraform)"
     type        = "SecureString"
     tier        = "Standard"
     value       = "PLACEHOLDER-set-by-supervisor"

     lifecycle {
       ignore_changes = [value]
     }
   }
   ```
   No `key_id` (AWS-managed `alias/aws/ssm`), no `tags` (E02's `default_tags` apply), no `overwrite`, no `insecure_value`, no `data_type`.

3. **`infra/modules/identity/outputs.tf`** — append:
   ```hcl
   output "secret_parameter_path" {
     description = "SSM path prefix deploy.sh reads with get-parameters-by-path."
     value       = "/developercards/${var.env}"
   }

   output "secret_parameter_arns" {
     description = "Leaf name → parameter ARN, for the CD role policy (E11)."
     value       = { for k, p in aws_ssm_parameter.secret : k => p.arn }
   }
   ```

4. **`infra/envs/prod/main.tf`** — inside the existing `module "identity" { … }` block add one argument (keep E01/E05's arguments untouched; `terraform fmt` alignment):
   ```hcl
     secret_parameter_names = ["pg-password", "migrate-secret", "internal-shared-secret", "rc-webhook-auth-production", "rc-webhook-auth-development"]
   ```
   Not `"analytics-salt"` (E13 appends it here). No new root variable or output.

5. **`docs/delivery/r16-issues/E06.plan-allow.json` (new)** — the supervisor's allow list, JSON-equal to:
   ```json
   {
     "tags_only_updates": false,
     "changes": {
       "module.identity.aws_ssm_parameter.secret[\"pg-password\"]": "create",
       "module.identity.aws_ssm_parameter.secret[\"migrate-secret\"]": "create",
       "module.identity.aws_ssm_parameter.secret[\"internal-shared-secret\"]": "create",
       "module.identity.aws_ssm_parameter.secret[\"rc-webhook-auth-production\"]": "create",
       "module.identity.aws_ssm_parameter.secret[\"rc-webhook-auth-development\"]": "create"
     }
   }
   ```
   Plan (supervisor, remote state): **5 creates, nothing else** — no update, no delete, no output change.

6. **`infra/README.md`** — append exactly one line to §6 (the change log), e.g. `- 2026-09-2x E06: identity/ssm.tf — five SecureString placeholders /developercards/prod/{pg-password,migrate-secret,internal-shared-secret,rc-webhook-auth-production,rc-webhook-auth-development}; values by supervisor put-parameter (ignored by state); deploy.sh injects them at deploy time.` Numstat of the file must be `1 0`.

7. **`src_C/Shared/RecallSmith.Lambda.Common/Secrets.cs` (new)**:
   ```csharp
   using System.Security.Cryptography;
   using System.Text;

   namespace RecallSmith.Lambda.Common;

   /// Constant-time secret comparison. Shared by the x-migrate-secret gates (Migrate.cs,
   /// AppRole.cs) and, from E07, the RevenueCat webhook bearer. Same idiom as
   /// Auth.VerifyInternalSignature: UTF-8 bytes, equal-length check, FixedTimeEquals.
   public static class Secrets
   {
     public static bool FixedTimeEquals(string? got, string? expected)
     {
       if (string.IsNullOrEmpty(got) || string.IsNullOrEmpty(expected)) return false;
       var a = Encoding.UTF8.GetBytes(got);
       var b = Encoding.UTF8.GetBytes(expected);
       if (a.Length != b.Length) return false;
       return CryptographicOperations.FixedTimeEquals(a, b);
     }
   }
   ```
   Exactly this signature: `public static bool FixedTimeEquals(string? got, string? expected)`. No other member.

8. **`src_C/Vpc/Db/Migrate.cs`** — the three lines `:142`, `:264`, `:301` become, byte for byte:
   ```csharp
         if (!Secrets.FixedTimeEquals(got, required)) return res.Forbidden("Bad migrate secret");
   ```
   Nothing else changes (numstat `3 3`); `string.Equals(got, required, StringComparison.Ordinal)` no longer occurs in the file; the `PGDATABASE == 'postgres'` gates, messages and `using`s are untouched.

9. **`src_C/Vpc/Db/AppRole.cs` (new)** — `namespace RecallSmith.Lambda.Vpc.Db;`, `public static class AppRole`, `using RecallSmith.Lambda.Common;`, `using static RecallSmith.Lambda.Db.DbUtil;`, `using Npgsql;`. Public surface:
   ```csharp
   public sealed record AppRoleSpec(string Name, string Password, string Database, bool CreateDatabase);
   public sealed record AppRoleResult(string Name, bool Created, bool DatabaseCreated, int TablesReassigned, int SequencesReassigned);
   public sealed class NotMasterException : Exception { … }   // current_user lacks rolcreaterole
   public sealed class DatabaseMissingException : Exception { public string Database { get; } … }

   public static async Task<Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse> HandleBootstrapRoles(LambdaRequest req, Res res, AuthContext auth)
   public static async Task<IReadOnlyList<AppRoleResult>> BootstrapAsync(NpgsqlConnection conn, IReadOnlyList<AppRoleSpec> specs, CancellationToken ct = default)
   ```
   Constants (verbatim, they are grepped): `RoleNameRegex = "^developercards_app(_staging)?$"`, `DatabaseNameRegex = "^developercards_(db|staging)$"`, `PasswordRegex = "^[A-Za-z0-9]{32,64}$"` (compiled `Regex` fields are fine; the pattern strings must appear verbatim).

   **`HandleBootstrapRoles`** — `POST /api/v1/admin/db/bootstrap-roles`, in this order:
   1. `var deny = Auth.RequireSuperAdmin(auth, res); if (deny is not null) return deny;` (401/403 as today's admin routes).
   2. `MIGRATE_SECRET` gate exactly like `Migrate.cs:138-142` but through the helper: `if (!string.IsNullOrEmpty(required)) { var got = Validation.GetHeader(req, "x-migrate-secret") ?? string.Empty; if (!Secrets.FixedTimeEquals(got, required)) return res.Forbidden("Bad migrate secret"); }`.
   3. Body: `using var doc = Validation.ParseJsonBody(req); if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");` then `roles` must be a JSON array of 1–2 objects; each object: `name` (string matching `RoleNameRegex`), `password` (string matching `PasswordRegex`), `database` (string matching `DatabaseNameRegex`), `createDatabase` (optional bool, default `false`); duplicate `name` → error. Any violation → `res.BadRequest("VALIDATION_ERROR", "<what>")` where the message names the field (`"roles[0].password must match ^[A-Za-z0-9]{32,64}$"`) and **never** echoes the password value.
   4. `await using var conn = await RecallSmith.Lambda.Db.Pg.OpenConnectionOrNullAsync(); if (conn is null) return res.BadRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");`
   5. `try { var results = await BootstrapAsync(conn, specs); return res.Ok(new { roles = results }); }` `catch (NotMasterException) { return res.Raw(409, new { ok = false, error = "NOT_MASTER", message = "current_user lacks CREATEROLE; run bootstrap-roles while PGUSER is still the master user" }); }` `catch (DatabaseMissingException ex) { return res.BadRequest("VALIDATION_ERROR", $"database {ex.Database} does not exist and createDatabase is false"); }`.
   6. Logging: at most one `Log.Info(JsonSerializer.Serialize(new { tag = "bootstrap-roles", roles = <names only>, created = …, databaseCreated = … }))` **after** success; no `Log.*`/`Console.Write*` line may reference the body, `RawBody`, a password or the spec objects. (Verify: no `Console.Write` in the file; no `Log.` line containing `assword`, `RawBody` or `Body`.)

   **`BootstrapAsync(conn, specs)`** — the SQL, in this order; role and database identifiers are interpolated only after the regexes above have accepted them; the password is **never** part of any SQL text:
   1. `select rolcreaterole from pg_roles where rolname = current_user` → `false`/no row ⇒ `throw new NotMasterException()`.
   2. Pre-flight for every spec with `CreateDatabase == false`: `select 1 from pg_database where datname = $1` → no row ⇒ `throw new DatabaseMissingException(spec.Database)` (before any mutation).
   3. Per spec:
      - `created = (select 1 from pg_roles where rolname = $1)` has no row; if so `create role <name> with login nosuperuser nocreatedb nocreaterole noinherit connection limit 50` (this literal, lower case, in the file: `connection limit 50`).
      - `grant <name> to current_user` (idempotent; see Context for why it must precede ownership transfer).
      - Password, inside one transaction (`BeginTransactionAsync`): `select set_config('app.role', $1, true), set_config('app.pw', $2, true)` with `[spec.Name, spec.Password]` as parameters, then the fixed statement
        ```sql
        do $$ begin execute format('alter role %I password %L', current_setting('app.role'), current_setting('app.pw')); end $$;
        ```
        then commit (`is_local = true` scopes both settings to the transaction). The literals `set_config('app.pw'` and `current_setting('app.pw')` must appear in the file; no interpolation hole (`{spec.Password}`), string concatenation (`+ password`) or `string.Format(…password…)` may exist anywhere in the file — passing `spec.Password` as a query **parameter** is the only allowed use.
      - `databaseCreated`: only when `spec.CreateDatabase` and `select 1 from pg_database where datname = $1` has no row: `create database <db> owner <name>` (no transaction — `CREATE DATABASE` cannot run inside one; use `ExecuteAsync(conn, null, …)`).
      - `grant connect on database <db> to <name>`.
      - Only when `spec.Database == current_database()` (`select current_database()`), inside one transaction: `grant usage, create on schema public to <name>`; reassign ownership of every `public` table and sequence not already owned by `<name>` (one `DO` block each, looping `pg_tables where schemaname = 'public' and tableowner <> '<name>'` / `pg_sequences where schemaname = 'public' and sequenceowner <> '<name>'`, `execute format('alter table %I.%I owner to %I', …)` / `alter sequence`), counting the rows changed into `TablesReassigned` / `SequencesReassigned` (read the counts with the same predicates **before** the block; a second run therefore reports `0`); then `alter default privileges in schema public grant all on tables to <name>` and `alter default privileges in schema public grant all on sequences to <name>` (no `for role` clause: applies to objects the current — master — role creates later). When `spec.Database != current_database()`, both counts are `0`.
   4. Return one `AppRoleResult` per spec, in input order.

10. **`src_C/Vpc/VpcFunction.cs`** — insert directly after line 126 (the closing `}` of the `admin/db/migrate` block) and before the `content-intelligence-demo` block, four lines, same shape as their neighbours:
    ```csharp
          if (p.EndsWith("/api/v1/admin/db/bootstrap-roles", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))
          {
            return await Vpc.Db.AppRole.HandleBootstrapRoles(req, res, auth);
          }
    ```
    Numstat `4 0`; no other line of the file moves.

11. **`src_C/env/prod.env.json` (new)** — JSON-equal to the E00 seed (key order free, no other keys, all values strings):
    ```json
    {"PGUSER":"developercards_app","API_ENV":"production","LOG_LEVEL":"info","PG_MAX":"1","PGSSLMODE":"require","METRICS_NAMESPACE":"DeveloperCards"}
    ```
    Non-secret only; `PGPASSWORD`, `PGHOST`, `PGDATABASE`, `PGPORT` and every other existing key stay on the function through the overlay.

12. **`src_C/scripts/merge-env.sh` (new)** — a sourced library, pure `jq`, no `aws` call, no side effects. Contains verbatim:
    ```bash
    # The only place the SSM leaf name → env var name map is written (E00 §2.6.2).
    SSM_TO_ENV='{"pg-password":"PGPASSWORD","migrate-secret":"MIGRATE_SECRET","internal-shared-secret":"INTERNAL_SHARED_SECRET","rc-webhook-auth-production":"RC_WEBHOOK_AUTH_PRODUCTION","rc-webhook-auth-development":"RC_WEBHOOK_AUTH_DEVELOPMENT","analytics-salt":"ANALYTICS_USER_SALT"}'
    WORKER_FILE_KEYS='["PGUSER","PGSSLMODE","PG_MAX","LOG_LEVEL"]'
    WORKER_SECRET_KEYS='["PGPASSWORD"]'
    ```
    and three functions with these exact names and contracts (stdout = compact JSON, exit ≠ 0 on error):
    - `merge_env CURRENT_JSON FILE_JSON SECRETS_JSON` → `($cur // {}) + ($file // {}) + ($sec // {})` — later wins; every key of `CURRENT_JSON` that neither overlay names survives.
    - `ssm_to_env GET_PARAMETERS_BY_PATH_JSON` → `{ENV_NAME: value}` using `SSM_TO_ENV` on the last path segment of each `.Parameters[].Name`; a leaf name absent from the map → `error("unmapped SSM parameter: <leaf>")` and non-zero exit (the literal `unmapped SSM parameter` appears in the file).
    - `pick_keys JSON KEYS_JSON` → the entries of `JSON` whose key is in `KEYS_JSON` (missing keys simply absent).

13. **`src_C/scripts/merge-env.test.sh` (new, `bash`)** — `set -euo pipefail`, sources `merge-env.sh` from its own directory, asserts with `jq -e`/`[ … ]`, ends with `echo "merge-env tests OK"`. Cases (each a named function or labelled block; fixture values for secret-named keys start with `PLACEHOLDER-`): (a) `merge_env '{"FOO_KEEP":"x","LOG_LEVEL":"debug"}' '{"LOG_LEVEL":"info"}' '{}'` keeps `FOO_KEEP` and yields `LOG_LEVEL == "info"` (file overrides current); (b) `merge_env '{}' '{"PGPASSWORD":"PLACEHOLDER-file"}' '{"PGPASSWORD":"PLACEHOLDER-secret"}'` yields `PLACEHOLDER-secret` (secret overrides file); (c) `ssm_to_env` on a fixture with all six leaf names maps to the six env names and nothing else; (d) `ssm_to_env` on a fixture with leaf `stray-name` exits non-zero and prints `unmapped SSM parameter`; (e) `pick_keys '{"PGUSER":"a","PGHOST":"h","PG_MAX":"1"}' "$WORKER_FILE_KEYS"` yields exactly `{"PGUSER":"a","PG_MAX":"1"}`; (f) `merge_env` with a `null` current (a function that has no variables yet) works.

14. **`src_C/deploy.sh` (rewritten)** — same CLI contract as today (`AWS_PROFILE`, `AWS_REGION`, `LAMBDA_ARCH`, `VPC_FN`, `WORKER_FN`, `ONLY`, `DRY_RUN`, `PUBLISH_ALIAS`) plus `ENV="${ENV:-prod}"` and `INJECT_ENV="${INJECT_ENV:-1}"`. Keep the header's two facts (migrations are not run here; the alias-move history from 2026-09-21) and the existing code path (`update-function-code` → `wait` → sha check → `publish-version` → `update-alias` → alias sha check) unchanged in behaviour. Add, verbatim lines the verify greps: `set +x` (first line after `set -euo pipefail`), `source "$HERE/scripts/merge-env.sh"`, `ENV_FILE="$HERE/env/$ENV.env.json"`, `SSM_PATH="/developercards/$ENV"`. Structure of `deploy_one <fn> <zip> <file_overlay_json> <secret_keys_json>`:
    1. `DRY_RUN=1`: print `DRY: aws lambda update-function-code --function-name $fn …` (as today) plus `DRY: $fn env overlay keys: <sorted key names of the file overlay>` and `DRY: $fn secret keys from $SSM_PATH: <the env names the secret overlay would carry>` — **names only**, computed from `SSM_TO_ENV` and `$4` without calling AWS — then `return 0`. A `DRY_RUN=1` run must make **no** AWS call at all (the verify puts a failing `aws` shim first in `PATH`).
    2. When `INJECT_ENV=1` (default), **before** `update-function-code`: `current="$(aws lambda get-function-configuration --region "$REGION" --function-name "$fn" --query 'Environment.Variables' --output json)"`; `secrets_all="$(ssm_to_env "$(aws ssm get-parameters-by-path --region "$REGION" --path "$SSM_PATH" --with-decryption --output json)")"` (fetched once per run, not per function); `secrets="$(pick_keys "$secrets_all" "$4")"`; `merged="$(merge_env "$current" "$3" "$secrets")"`; `aws lambda update-function-configuration --region "$REGION" --function-name "$fn" --environment "$(jq -cn --argjson v "$merged" '{Variables: $v}')" --query 'LastUpdateStatus' --output text`; `aws lambda wait function-updated --region "$REGION" --function-name "$fn"`; then `echo "OK $fn environment: $(jq -r 'keys | length' <<<"$merged") keys"` — never the values (no `--output text` of `Environment`, no `echo "$merged"`, no `set -x`).
    3. `INJECT_ENV=0`: skip step 2 and print `note: INJECT_ENV=0 — environment left as is`.
    4. Then the existing code path; `publish-version` therefore captures the merged environment.
    Call sites: `deploy_one "$VPC_FN" "$HERE/dist/vpc.zip" "$file_env" "$(jq -c 'to_entries | map(.value)' <<<"$SSM_TO_ENV")"` (core-vpc gets every mapped secret present under the path) and `deploy_one "$WORKER_FN" "$HERE/dist/worker.zip" "$(pick_keys "$file_env" "$WORKER_FILE_KEYS")" "$WORKER_SECRET_KEYS"`, where `file_env="$(jq -c . "$ENV_FILE")"` (a missing or invalid `ENV_FILE` is a hard error). `jq` presence is checked up front (`command -v jq`).

15. **`scripts/invoke-as-admin.sh` (new, `chmod +x`)** — `scripts/invoke-as-admin.sh <function[:qualifier]> <METHOD> <path> [body-file]`; `set -euo pipefail`; usage on fewer than 3 args (exit 2). Builds an HTTP API v2 event with `jq -n` (`version "2.0"`, `routeKey "$default"`, `rawPath`, `rawQueryString ""`, `headers`, `requestContext.http.{method,path}`, `requestContext.authorizer.jwt.claims = { "sub": "supervisor", "cognito:groups": "[super_admin]", "token_use": "access" }`, `body` from the file or `null`, `isBase64Encoded false`). Headers: `content-type: application/json` always; `x-migrate-secret` **only** when `${MIGRATE_SECRET:-}` is non-empty — the secret comes from the environment, never from argv (the file contains `"${MIGRATE_SECRET:-}"` and no `MIGRATE_SECRET=$<n>`). `DRY_RUN=1` prints `DRY: aws lambda invoke --function-name <fn> <METHOD> <path> headers: <header names>` and exits 0 without calling AWS or printing the secret. Otherwise `aws lambda invoke --region "${AWS_REGION:-ap-southeast-2}" --function-name "$FN" --cli-binary-format raw-in-base64-out --payload "$event" "$out" >/dev/null` into a `mktemp` file removed by a `trap`, prints `statusCode` to stderr and the response `body` (decoded; `.body // .`) to stdout — nothing else. Header comment: "supervisor tool; trust boundary = IAM lambda:InvokeFunction; Auth.cs trusts gateway-shaped claims by design (review §2.1.1)".

16. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/SecretsCompareTests.cs` (new, pure, no collection)** — `private const int GeneratedCases = 64;` and a deterministic `new Random(20260922)`; methods (names verbatim): `FixedTimeEquals_NullOrEmpty_False` (`[Theory]` over `(null,null)`, `("","")`, `(null,"a")`, `("a",null)`, `("","a")`, `("a","")`), `FixedTimeEquals_Equal_True` (`[Theory]`: `"a"`, a 64-char alphanumeric, a string with `é` and an emoji), `FixedTimeEquals_Different_False` (`[Theory]`: `("a","b")`, `("a","ab")`, `("ab","a")`, `("Secret","secret")`, `("a","a ")`), `FixedTimeEquals_GeneratedPairs_NeverTrueAndSymmetric` (`[Theory]` + `[MemberData(nameof(GeneratedPairs))]`, 64 random pairs of distinct strings of length 1–80 from `[A-Za-z0-9]`: `False` both ways), `FixedTimeEquals_GeneratedSelf_True` (`[MemberData(nameof(GeneratedSelf))]`, 64 strings: `True` against a fresh copy). `GeneratedPairs`/`GeneratedSelf` are `public static IEnumerable<object[]>`.

17. **`src_C/Tests/RecallSmith.Lambda.IntegrationTests/AppRoleTests.cs` (new)** — `[Collection(PostgresCollection.Name)]`, takes `PostgresFixture` in the ctor. Event helper like `CardsPageTests.cs:66-91` (method `POST`, `authorizer.jwt.claims` with `sub` + `cognito:groups`, optional `x-migrate-secret` header, JSON body), invoking `AppRole.HandleBootstrapRoles(req, res, await Auth.GetAuthContextAsync(req))`. A 32-char fixture password constant built at runtime (`new string('a', 32)` style — no literal that reads like a credential). Methods (names verbatim):
    - `BootstrapRoles_Editor_Returns403` — groups `["editor"]` → 403.
    - `BootstrapRoles_BadMigrateSecret_Returns403` — set `MIGRATE_SECRET` to a fixture value for the test (save/restore in `try/finally`), send a wrong header → 403 `FORBIDDEN`, message `Bad migrate secret`; then the right header + an invalid body → 400 (proves the gate passed).
    - `BootstrapRoles_BadRoleName_Returns400` — `name: "postgres"` → 400 `VALIDATION_ERROR`.
    - `BootstrapRoles_BadDatabaseName_Returns400` — `database: "postgres"` → 400.
    - `BootstrapRoles_BadPassword_Returns400` — `[Theory]`: 31 chars, 65 chars, 32 chars containing `'` → 400; the response body does not contain the submitted password.
    - `BootstrapRoles_MissingDatabaseWithoutCreate_Returns400` — `database: "developercards_db"`, `createDatabase: false`, with no such database in the container → 400 and the role is **not** created (`pg_roles` check).
    - `BootstrapRoles_NotMaster_Returns409` — create a `login nocreaterole` role in the container with the superuser connection, swap `PGUSER`/`PGPASSWORD` to it + `Pg.Reset()` (pattern `DbWarmupTests.cs:180-200`), call the handler → 409 with body `error == "NOT_MASTER"`; restore + `Pg.Reset()` in `finally`.
    - `BootstrapRoles_CreatesRoleAndDatabase_ThenIdempotent` — spec `developercards_app_staging` / `developercards_staging` / `createDatabase: true` → 200 with `created: true, databaseCreated: true, tablesReassigned: 0, sequencesReassigned: 0`; `pg_roles` shows `rolsuper=false, rolcreatedb=false, rolcreaterole=false, rolinherit=false, rolconnlimit=50`; a fresh `NpgsqlConnection` as that role with the fixture password to `developercards_staging` opens and `select 1` works (proves the `set_config` password path); a second identical call → 200 with `created: false, databaseCreated: false`.
    - `Bootstrap_ReassignsOwnershipOnConnectedDatabase` — `CreateScratchDatabaseAsync("developercards_db")`, open a connection to it, `ApplyMigrationsAsync(conn, int.MaxValue)`, call `AppRole.BootstrapAsync(conn, [new("developercards_app", pw, "developercards_db", false)])` → `TablesReassigned > 0`; `pg_tables`/`pg_sequences` in `public` all owned by `developercards_app`; connecting as `developercards_app` to that database, `select count(*) from decks` and `create table e06_probe (id int); drop table e06_probe;` both succeed; a second `BootstrapAsync` reports `TablesReassigned == 0`.
    - `BootstrapRoles_RouteIsWired` — `new VpcFunction().Handler(evt)` with `rawPath = "/api/v1/admin/db/bootstrap-roles"`, `POST`, editor claims → 403 (an unrouted path would be 404).
    Clean-up is by name (`drop role if exists …` / `drop database if exists … with (force)`) in each test's `finally` where a later test would otherwise see stale state; the suite must be rerunnable against a dirty container.

18. **`docs/runbooks/secrets-rotation.md` (new)** — sections (H2, verbatim): `## Inventory` (table: env var ↔ SSM leaf ↔ consumer `file:line` ↔ who else holds it), `## Rules` (never in Terraform/git/state; rotation = put-parameter + `ENV=<env> ./deploy.sh`; no runtime fetch), `## App-role password rotation` (generate 32–64 `[A-Za-z0-9]` → `aws ssm put-parameter --name /developercards/prod/pg-password --type SecureString --overwrite --value …` → `MIGRATE_SECRET=… scripts/invoke-as-admin.sh core-vpc:prod POST /api/v1/admin/db/bootstrap-roles roles.json` with `createDatabase: false` (the endpoint is idempotent: `alter role … password` only) → `ENV=prod ./deploy.sh` at once → smoke; state the expected window honestly: between the `alter role` and the alias move, **new** connections from the old version fail, pooled ones keep working; do it in the maintenance window; the temp `roles.json` is shredded), `## Master password rotation` (`aws rds modify-db-instance --db-instance-identifier developercards --master-user-password '<32+ chars>' --apply-immediately` — supervisor CLI, **never in Terraform** (`password` is never set on `aws_db_instance`); stored in the owner's password manager, not in SSM; nothing in the app uses it after E06; watch `DBInstanceStatus` through `resetting-master-credentials` back to `available`), `## Migrate secret`, `## Internal shared secret`, `## RevenueCat webhook auth` (put-parameter → deploy → update the RevenueCat dashboard Authorization header; production and development are separate parameters), `## First deploy (E06 cut-over)` (the supervisor order from Context), `## Staging` (same with `/developercards/staging/*`, E10). No value, no example that looks like a value (use `<…>` placeholders).

## Acceptance

Run from the worktree root. `docs/delivery/r16-issues/E06.verify.sh` re-runs exactly these.

1. Scope files exist (exit 0) — the eleven new files of the Scope list (1, 6, 8, 11–18) exist, `scripts/invoke-as-admin.sh` is executable; prerequisites from earlier issues are present on the integration branch: `infra/scripts/check-plan.py`, `infra/envs/prod/imports.tf`, `infra/modules/identity/policies.tf` (E05).
2. Literal guards (exit 0):
   - `Secrets.cs`: `namespace RecallSmith.Lambda.Common;`, `public static class Secrets`, `public static bool FixedTimeEquals(string? got, string? expected)`, `CryptographicOperations.FixedTimeEquals(`, `Encoding.UTF8.GetBytes(`, `a.Length != b.Length`.
   - `Migrate.cs`: exactly three lines contain `Secrets.FixedTimeEquals(got, required)`; zero contain `string.Equals(got, required, StringComparison.Ordinal)`; numstat `3 3`.
   - `AppRole.cs`: `namespace RecallSmith.Lambda.Vpc.Db;`, `public static class AppRole`, `HandleBootstrapRoles(`, `BootstrapAsync(`, `class NotMasterException`, `class DatabaseMissingException`, `"NOT_MASTER"`, `^developercards_app(_staging)?$`, `^developercards_(db|staging)$`, `^[A-Za-z0-9]{32,64}$`, `set_config('app.pw'`, `current_setting('app.pw')`, `connection limit 50`, `rolcreaterole`, `RecallSmith.Lambda.Db.Pg.OpenConnectionOrNullAsync(`, `using static RecallSmith.Lambda.Db.DbUtil;`, `Secrets.FixedTimeEquals(`, `Auth.RequireSuperAdmin(`, `"Bad migrate secret"`, `res.Raw(409`, `alter default privileges in schema public`; **no** `Console.Write`, no `Log.` line containing `assword`/`RawBody`/`Body`, no interpolation hole / concatenation / `string.Format` with a password identifier, no `$$"""` raw interpolated string.
   - `VpcFunction.cs`: the two route lines of Changes 10 verbatim; the `bootstrap-roles` line number is greater than the `admin/db/migrate` line and smaller than the `content-intelligence-demo` line; numstat `4 0`.
   - `deploy.sh`: `ENV="${ENV:-prod}"`, `INJECT_ENV="${INJECT_ENV:-1}"`, `set +x`, `source "$HERE/scripts/merge-env.sh"`, `ENV_FILE="$HERE/env/$ENV.env.json"`, `SSM_PATH="/developercards/$ENV"`, `get-parameters-by-path`, `--with-decryption`, `update-function-configuration`, `wait function-updated`, `merge_env `, `ssm_to_env `, `pick_keys `, `publish-version`, `update-function-code`; the first `update-function-configuration` line outside comments precedes the first `publish-version` line outside comments; no line contains both `Environment` and `--output text`; no `set -x`; no `echo "$merged"`.
   - `merge-env.sh`: the three assignment lines of Changes 12 verbatim, `merge_env()`, `ssm_to_env()`, `pick_keys()`, `unmapped SSM parameter`; no `aws ` token.
   - `merge-env.test.sh`: `FOO_KEEP`, `unmapped SSM parameter`, `stray-name`, `merge-env tests OK`.
   - `prod.env.json`: JSON-equal to the seed of Changes 11.
   - `invoke-as-admin.sh`: `"supervisor"`, `"[super_admin]"`, `token_use`, `x-migrate-secret`, `"${MIGRATE_SECRET:-}"`, `--cli-binary-format raw-in-base64-out`, `aws lambda invoke`, `DRY_RUN`; no `MIGRATE_SECRET=$<digit>`.
   - `ssm.tf`: `resource "aws_ssm_parameter" "secret"`, `for_each = toset(var.secret_parameter_names)`, `"/developercards/${var.env}/${each.key}"`, `"SecureString"`, `"Standard"`, `"PLACEHOLDER-set-by-supervisor"`, `ignore_changes = [value]`; no `key_id`, `insecure_value`, `overwrite`, `environment`, `provisioner`, `null_resource`, `local-exec`, `archive_file`.
   - identity `variables.tf`: `variable "secret_parameter_names"` followed within three lines by `list(string)`; identity `outputs.tf`: `output "secret_parameter_path"`, `output "secret_parameter_arns"`, `"/developercards/${var.env}"`.
   - `envs/prod/main.tf`: `secret_parameter_names` and each of `"pg-password"`, `"migrate-secret"`, `"internal-shared-secret"`, `"rc-webhook-auth-production"`, `"rc-webhook-auth-development"`; no `analytics-salt`.
   - `E06.plan-allow.json`: JSON-equal to Changes 5. `infra/README.md`: numstat `1 0`, the added line contains `E06`.
   - `secrets-rotation.md`: the eight H2 headings of Changes 18, `modify-db-instance`, `--master-user-password`, `put-parameter`, `bootstrap-roles`, `createDatabase`, `INJECT_ENV=0`.
   - `SecretsCompareTests.cs`: `private const int GeneratedCases = 64;`, `[MemberData(`, the five method names; `AppRoleTests.cs`: `[Collection(PostgresCollection.Name)]`, `CreateScratchDatabaseAsync(`, `ApplyMigrationsAsync(`, `new VpcFunction().Handler(`, the ten method names.
   - Suppression grep (`C07.verify.sh:151` verbatim) over the eleven new files and the `+` lines of the seven edited files is empty; the secret-leak grep of E00 §5 over the same set is empty.
3. Gates (exit 0): `terraform fmt -check -recursive infra`; `cd infra/envs/prod && terraform init -backend=false -input=false && terraform validate`; `cd src_C && dotnet build RecallSmith.Lambda.sln -c Release -nologo`; `bash -n` on `deploy.sh`, `merge-env.sh`, `merge-env.test.sh`, `invoke-as-admin.sh`; `python3` JSON-loads `prod.env.json` and `E06.plan-allow.json`; `bash src_C/scripts/merge-env.test.sh` prints `merge-env tests OK`; with a failing `aws` shim first in `PATH`: `DRY_RUN=1 ENV=prod ./deploy.sh` exits 0 and its output contains `secret keys from /developercards/prod` and `PGPASSWORD` but no `PLACEHOLDER`; `DRY_RUN=1 MIGRATE_SECRET=PLACEHOLDER-verify scripts/invoke-as-admin.sh core-vpc:prod POST /api/v1/admin/db/bootstrap-roles` exits 0, prints `x-migrate-secret` and not `PLACEHOLDER-verify`.
4. Plan and tests (exit 0, `AWS_PROFILE=dev` on account `622994489535`, Docker running): `python3 -m py_compile infra/scripts/check-plan.py`; in `infra/envs/prod`: `terraform init -input=false -reconfigure` (real backend, read-only) → `terraform plan -lock=false -input=false -refresh=true -var-file=<$TMP tfvars> -out=$TMP/E06.tfplan` → `terraform show -json` → the effective managed set (`actions ≠ ["no-op"]`) is exactly the five `create`s of Changes 5, no entry carries `importing`, `output_changes` is empty; `python3 infra/scripts/check-plan.py --plan … --allow docs/delivery/r16-issues/E06.plan-allow.json` prints `PLAN OK`; the plan files are deleted. Then `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests -c Release --no-build --nologo --filter "FullyQualifiedName~SecretsCompareTests|FullyQualifiedName~AppRoleTests|FullyQualifiedName~AuthBearerTests"`.
5. Scope + frozen + OTA + apply guard (exit 0): `git diff --name-only <merge-base>` ∪ the pathspec-scoped untracked scan of `infra src_C scripts docs mobile/src mobile/tests frontend/src` contains nothing outside the eighteen scope files (+ `docs/delivery/r16-issues/`); the three frozen mobile files, `mobile/package.json`, `mobile/package-lock.json`, `mobile/app.json`, `mobile/eas.json`, every `.csproj`, `Res.cs`, `RevenuecatWebhook.cs`, both `Pg.cs`, `infra/envs/prod/{variables,outputs,imports,backend,providers,versions}.tf`, `infra/scripts` and every existing test file are zero-diff; `grep -Fq '"version": "1.6.1"' mobile/app.json`; no `@sentry` under `mobile/src`; `git ls-files infra` has no `.tfplan`/`.plan.json`/`generated*.tf`/non-example `.auto.tfvars`; `grep -rn 'profile *= *"' infra --include=*.tf` empty; over `src_C/scripts/*.sh`, every new `.cs`, every changed/new `.tf`, `E06.plan-allow.json`, `prod.env.json` and `E06.verify.sh`, no non-comment line matches `terraform +(apply|import)|aws +[a-z0-9-]+ +(create|update|delete|put)-`; in `src_C/deploy.sh` every such line (comments, `echo` and `DRY:` lines exempt) sits after the first `return 0` that follows `DRY_RUN` inside `deploy_one()`, and in `scripts/invoke-as-admin.sh` there is none.

## Verify

```bash
export AWS_PROFILE=dev TF_PLUGIN_CACHE_DIR="$HOME/.terraform.d/plugin-cache"
BASE=delivery/r16-e-prod bash docs/delivery/r16-issues/E06.verify.sh
```
Steps 1–2 are file/literal checks (seconds). Step 3: `terraform init -backend=false` + `validate` (seconds with the cached provider), `dotnet build` (1–2 min cold), the two `DRY_RUN` runs (`deploy.sh` packages both zips: ≈ 1–2 min of `dotnet publish`, no network). Step 4: one read-only `terraform plan` against the real backend (≈ 1–3 min), the checker, then the three test classes (one `postgres:16-alpine` container, single-digit minutes). Total ≈ 6–9 min. The driver additionally runs its diff-scoped banned-term grep, the suppression scan, the `src_C` root gate (`dotnet test Tests/RecallSmith.Lambda.IntegrationTests`, Docker) and the `infra` root gate (`cd infra/envs/prod && terraform init -backend=false -input=false && terraform validate && terraform fmt -check -recursive ..`).

**The supervisor applies** (never a worker), after merge, in this order: `terraform init` (real backend) → `terraform plan -out=E06.tfplan` → `terraform show -json E06.tfplan | python3 infra/scripts/check-plan.py --allow docs/delivery/r16-issues/E06.plan-allow.json` (5 creates) → `terraform apply E06.tfplan` → `aws ssm put-parameter --overwrite` ×5 (`pg-password` = the new app-role password) → `INJECT_ENV=0 ENV=prod ./src_C/deploy.sh` → `MIGRATE_SECRET=… scripts/invoke-as-admin.sh core-vpc:prod POST /api/v1/admin/db/bootstrap-roles roles.json` (both roles; staging with `createDatabase: true`) → `ENV=prod ./src_C/deploy.sh` → `aws rds modify-db-instance --db-instance-identifier developercards --master-user-password … --apply-immediately` → smoke (`GET /api/v1/db/ping` as admin through `invoke-as-admin.sh`, one console page) → second `terraform plan` empty. The runbook's "First deploy" section is this list.

## Do NOT

- Do NOT add `ssm:GetParameter*` to any Lambda role, a VPC interface endpoint for SSM, or any runtime read of SSM from C# (E00 §6 #8): secrets reach the function only as environment variables written by `deploy.sh`.
- Do NOT put a Lambda `environment` block, `password`, `manage_master_user_password` or `password_wo*` in any `.tf`; do NOT edit `imports.tf`, `variables.tf`/`outputs.tf` of `envs/prod`, `policies.tf`, `check-plan.py`, `.terraform.lock.hcl`.
- Do NOT create a `migrator` role, a `developercards_app_rw`/`_ro` split, `pg_hba`/IAM DB auth, or touch `Migrate.cs` beyond the three compare lines (the `lock_timeout` change is E12).
- Do NOT interpolate a password into SQL (not with `%L` in C#, not with `$"…"`, not with `NpgsqlCommand.CommandText` concatenation): `set_config` + `current_setting` only. Do NOT log the request body or any password.
- Do NOT add a 409 helper to `Res.cs` (E07 owns that file); use `res.Raw(409, …)`.
- Do NOT replace the overlay with a full rewrite of the Lambda environment, drop keys you do not know, or write the two unspellable env names anywhere.
- Do NOT run `./deploy.sh`, `scripts/invoke-as-admin.sh`, `aws ssm get-parameter --with-decryption`, `aws lambda invoke`, `terraform apply`/`import`, `eas`, `npm`, `dotnet restore` by hand; do NOT run git in `/Users/qc/src/recallsmith`.
- Do NOT create `src_C/env/staging.env.json` (E10), `analytics-salt` (E13), `scripts/smoke.sh`/`rollback.sh` (E11), `docs/runbooks/*` other than `secrets-rotation.md` (E15).
- Do NOT edit any existing test file or `IntegrationTestBase.cs`; do NOT weaken `AuthBearerTests`.
