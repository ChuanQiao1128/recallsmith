#!/usr/bin/env bash
# E06 — secrets-and-db-role verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - src_C/Shared/RecallSmith.Lambda.Common/Secrets.cs, src_C/Vpc/Db/AppRole.cs,
#     infra/modules/identity/ssm.tf, src_C/env/prod.env.json,
#     src_C/scripts/merge-env.sh, src_C/scripts/merge-env.test.sh,
#     scripts/invoke-as-admin.sh, the two test classes, the runbook and
#     docs/delivery/r16-issues/E06.plan-allow.json do not exist on base
#   (step 1 then also checks the E01/E05 prerequisites: infra/scripts/check-plan.py,
#   infra/envs/prod/imports.tf and infra/modules/identity/policies.tf must be on
#   the integration branch, because E00 §4 orders E01 → … → E05 → E06)
# Step 2 (literal guards) would also fail on base. Step 3 = root gates (terraform
# fmt/init/validate, dotnet build, bash -n, the jq fixture tests, two DRY_RUN runs
# behind a failing `aws` shim). Step 4 = one READ-ONLY plan against the real backend
# (-lock=false, state read only) checked against the committed allow file by
# check-plan.py and by an inline shape check, then the targeted dotnet tests.
# Step 5 = scope + frozen + OTA + apply guard + secret-leak guard.
#
# WORKER SAFETY RULE: this script runs `terraform init` (backend=false for the gate,
# real backend for the plan — state is read, never locked or written), `validate`,
# `plan -lock=false -out` + `show -json` and read-only AWS reads only. It never runs
# `terraform apply`/`import`, never `aws … create/update/delete/put`, never
# `./deploy.sh` or `scripts/invoke-as-admin.sh` without DRY_RUN=1. The supervisor
# applies after merge (brief §Verify). Plan files are deleted by the trap; the
# script prints resource addresses + actions only, never before/after values.
#
# The driver's diff-scoped term gate and suppression scan run separately; this
# script does not spell the six terms (E00 §0).
#
# Needs: AWS_PROFILE=dev (read-only), Docker (AppRoleTests), terraform 1.16, jq,
# python3 (3.8+), dotnet 8. Runtime ≈ 6–9 min (the plan and dotnet publish dominate).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-e-prod}}"   # driver exports BASE
export TF_PLUGIN_CACHE_DIR="${TF_PLUGIN_CACHE_DIR:-$HOME/.terraform.d/plugin-cache}"
export AWS_PROFILE="${AWS_PROFILE:-dev}"
export AWS_REGION="${AWS_REGION:-ap-southeast-2}"
mkdir -p "$TF_PLUGIN_CACHE_DIR"
fail() { echo "E06 VERIFY FAIL: $*" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT      # removes every *.tfplan / *.plan.json this script wrote

SECRETS_CS=src_C/Shared/RecallSmith.Lambda.Common/Secrets.cs
MIGRATE=src_C/Vpc/Db/Migrate.cs
APPROLE=src_C/Vpc/Db/AppRole.cs
VPCFN=src_C/Vpc/VpcFunction.cs
DEPLOY=src_C/deploy.sh
ENVJSON=src_C/env/prod.env.json
MERGE=src_C/scripts/merge-env.sh
MERGE_T=src_C/scripts/merge-env.test.sh
INVOKE=scripts/invoke-as-admin.sh
APPROLE_T=src_C/Tests/RecallSmith.Lambda.IntegrationTests/AppRoleTests.cs
SECRETS_T=src_C/Tests/RecallSmith.Lambda.IntegrationTests/SecretsCompareTests.cs
RUNBOOK=docs/runbooks/secrets-rotation.md
ALLOW=docs/delivery/r16-issues/E06.plan-allow.json
SSM_TF=infra/modules/identity/ssm.tf
ID_VARS=infra/modules/identity/variables.tf
ID_OUTS=infra/modules/identity/outputs.tf
PROD_MAIN=infra/envs/prod/main.tf
README=infra/README.md

NEW_FILES=("$SECRETS_CS" "$APPROLE" "$SSM_TF" "$ENVJSON" "$MERGE" "$MERGE_T" "$INVOKE" "$APPROLE_T" "$SECRETS_T" "$RUNBOOK" "$ALLOW")
EDITED_FILES=("$MIGRATE" "$VPCFN" "$DEPLOY" "$ID_VARS" "$ID_OUTS" "$PROD_MAIN" "$README")

# The supervisor's allow list (brief Changes 5), canonical form.
cat > "$TMP/allow.canonical.json" <<'JSON'
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
JSON
# The committed non-secret env seed (brief Changes 11).
cat > "$TMP/env.canonical.json" <<'JSON'
{"PGUSER":"developercards_app","API_ENV":"production","LOG_LEVEL":"info","PG_MAX":"1","PGSSLMODE":"require","METRICS_NAMESPACE":"DeveloperCards"}
JSON

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ E01/E05 prerequisites)"
for f in "${NEW_FILES[@]}"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
[ -x "$INVOKE" ] || fail "$INVOKE must be executable (chmod +x)"
for f in infra/scripts/check-plan.py infra/envs/prod/imports.tf infra/modules/identity/policies.tf "$ID_VARS" "$ID_OUTS" "$PROD_MAIN" "$README"; do
  [ -f "$f" ] || fail "$f is missing — E01…E05 must be merged before E06 (E00 §4)"
done
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. Secrets.cs
for sym in 'namespace RecallSmith.Lambda.Common;' \
           'public static class Secrets' \
           'public static bool FixedTimeEquals(string? got, string? expected)' \
           'CryptographicOperations.FixedTimeEquals(' \
           'Encoding.UTF8.GetBytes(' \
           'a.Length != b.Length'; do
  grep -Fq "$sym" "$SECRETS_CS" || fail "Secrets.cs lacks: $sym"
done
# 2b. Migrate.cs — the three compares, nothing else
[ "$(grep -Fc 'Secrets.FixedTimeEquals(got, required)' "$MIGRATE" || true)" = "3" ] || fail "Migrate.cs must contain Secrets.FixedTimeEquals(got, required) exactly three times"
[ "$(grep -Fc 'string.Equals(got, required, StringComparison.Ordinal)' "$MIGRATE" || true)" = "0" ] || fail "Migrate.cs still has an ordinal secret compare"
ns="$(git diff --numstat "$mb" HEAD -- "$MIGRATE" | cut -f1,2)"
[ "$ns" = "$(printf '3\t3')" ] || fail "Migrate.cs numstat must be '3 3', got '${ns:-<no diff>}'"
# 2c. AppRole.cs
for sym in 'namespace RecallSmith.Lambda.Vpc.Db;' \
           'public static class AppRole' \
           'HandleBootstrapRoles(' \
           'BootstrapAsync(' \
           'class NotMasterException' \
           'class DatabaseMissingException' \
           '"NOT_MASTER"' \
           '^developercards_app(_staging)?$' \
           '^developercards_(db|staging)$' \
           '^[A-Za-z0-9]{32,64}$' \
           "set_config('app.pw'" \
           "current_setting('app.pw')" \
           'connection limit 50' \
           'rolcreaterole' \
           'RecallSmith.Lambda.Db.Pg.OpenConnectionOrNullAsync(' \
           'using static RecallSmith.Lambda.Db.DbUtil;' \
           'Secrets.FixedTimeEquals(' \
           'Auth.RequireSuperAdmin(' \
           '"Bad migrate secret"' \
           'res.Raw(409' \
           'alter default privileges in schema public'; do
  grep -Fq "$sym" "$APPROLE" || fail "AppRole.cs lacks: $sym"
done
if grep -q 'Console.Write' "$APPROLE"; then fail "AppRole.cs must not Console.Write (body/password could leak)"; fi
if grep -En 'Log\.(Debug|Info|Warn|Error)\(.*(assword|RawBody|Body)' "$APPROLE"; then fail "AppRole.cs logs a body or password"; fi
if grep -En '\{[A-Za-z_][A-Za-z0-9_.]*[Pp]assword[A-Za-z0-9_.]*(:[^}]*)?\}|"\s*\+\s*[A-Za-z_.]*[Pp]assword|[Pp]assword[A-Za-z_.]*\s*\+\s*"|[Ss]tring\.Format\([^)]*[Pp]assword|\$\$"""' "$APPROLE"; then
  fail "AppRole.cs puts a password identifier into a string (interpolation hole, concatenation or Format): set_config + current_setting only"
fi
# 2d. VpcFunction.cs — route present, placed after db/migrate and before content-intelligence-demo, 4 added lines
ROUTE_IF='if (p.EndsWith("/api/v1/admin/db/bootstrap-roles", StringComparison.OrdinalIgnoreCase) && req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase))'
ROUTE_CALL='return await Vpc.Db.AppRole.HandleBootstrapRoles(req, res, auth);'
grep -Fq "$ROUTE_IF" "$VPCFN"   || fail "VpcFunction.cs lacks the bootstrap-roles route condition"
grep -Fq "$ROUTE_CALL" "$VPCFN" || fail "VpcFunction.cs lacks the bootstrap-roles dispatch line"
l_mig="$(grep -nF '"/api/v1/admin/db/migrate"' "$VPCFN" | head -1 | cut -d: -f1)"
l_boot="$(grep -nF '"/api/v1/admin/db/bootstrap-roles"' "$VPCFN" | head -1 | cut -d: -f1)"
l_cid="$(grep -nF '"/api/v1/admin/db/content-intelligence-demo"' "$VPCFN" | head -1 | cut -d: -f1)"
[ -n "$l_mig" ] && [ -n "$l_boot" ] && [ -n "$l_cid" ] || fail "VpcFunction.cs route anchors missing"
[ "$l_mig" -lt "$l_boot" ] && [ "$l_boot" -lt "$l_cid" ] || fail "bootstrap-roles must sit between db/migrate and content-intelligence-demo (E00 §2.16)"
ns="$(git diff --numstat "$mb" HEAD -- "$VPCFN" | cut -f1,2)"
[ "$ns" = "$(printf '4\t0')" ] || fail "VpcFunction.cs numstat must be '4 0', got '${ns:-<no diff>}'"
# 2e. deploy.sh
for sym in 'ENV="${ENV:-prod}"' \
           'INJECT_ENV="${INJECT_ENV:-1}"' \
           'set +x' \
           'source "$HERE/scripts/merge-env.sh"' \
           'ENV_FILE="$HERE/env/$ENV.env.json"' \
           'SSM_PATH="/developercards/$ENV"' \
           'get-parameters-by-path' \
           '--with-decryption' \
           'update-function-configuration' \
           'wait function-updated' \
           'merge_env ' \
           'ssm_to_env ' \
           'pick_keys ' \
           'publish-version' \
           'update-function-code'; do
  grep -Fq "$sym" "$DEPLOY" || fail "deploy.sh lacks: $sym"
done
l_cfg="$(grep -nF 'update-function-configuration' "$DEPLOY" | grep -Ev '^[0-9]+:\s*#' | head -1 | cut -d: -f1)"
l_pub="$(grep -nF 'publish-version' "$DEPLOY" | grep -Ev '^[0-9]+:\s*#' | head -1 | cut -d: -f1)"
[ -n "$l_cfg" ] && [ -n "$l_pub" ] || fail "deploy.sh: update-function-configuration / publish-version not found outside comments"
[ "$l_cfg" -lt "$l_pub" ] || fail "deploy.sh: update-function-configuration must precede publish-version (env is frozen into the version)"
if grep -n 'Environment' "$DEPLOY" | grep -q -- '--output text'; then fail "deploy.sh prints Environment with --output text"; fi
if grep -Eq '^\s*set -x|echo "\$merged"|echo \$merged' "$DEPLOY"; then fail "deploy.sh echoes the merged environment"; fi
# 2f. merge-env.sh / merge-env.test.sh
for sym in "SSM_TO_ENV='{\"pg-password\":\"PGPASSWORD\",\"migrate-secret\":\"MIGRATE_SECRET\",\"internal-shared-secret\":\"INTERNAL_SHARED_SECRET\",\"rc-webhook-auth-production\":\"RC_WEBHOOK_AUTH_PRODUCTION\",\"rc-webhook-auth-development\":\"RC_WEBHOOK_AUTH_DEVELOPMENT\",\"analytics-salt\":\"ANALYTICS_USER_SALT\"}'" \
           "WORKER_FILE_KEYS='[\"PGUSER\",\"PGSSLMODE\",\"PG_MAX\",\"LOG_LEVEL\"]'" \
           "WORKER_SECRET_KEYS='[\"PGPASSWORD\"]'" \
           'merge_env()' 'ssm_to_env()' 'pick_keys()' 'unmapped SSM parameter'; do
  grep -Fq "$sym" "$MERGE" || fail "merge-env.sh lacks: $sym"
done
if grep -q 'aws ' "$MERGE"; then fail "merge-env.sh must be pure jq (no aws call)"; fi
for sym in 'FOO_KEEP' 'unmapped SSM parameter' 'stray-name' 'merge-env tests OK'; do
  grep -Fq "$sym" "$MERGE_T" || fail "merge-env.test.sh lacks: $sym"
done
# 2g. prod.env.json == seed
python3 - "$ENVJSON" "$TMP/env.canonical.json" <<'PY' || fail "prod.env.json is not JSON-equal to the E00 seed"
import json, sys
a = json.load(open(sys.argv[1])); b = json.load(open(sys.argv[2]))
assert a == b, (sorted(a.keys()), sorted(b.keys()))
PY
# 2h. invoke-as-admin.sh
for sym in '"supervisor"' '"[super_admin]"' 'token_use' 'x-migrate-secret' '"${MIGRATE_SECRET:-}"' \
           '--cli-binary-format raw-in-base64-out' 'aws lambda invoke' 'DRY_RUN'; do
  grep -Fq "$sym" "$INVOKE" || fail "invoke-as-admin.sh lacks: $sym"
done
if grep -Eq 'MIGRATE_SECRET=\$[0-9]' "$INVOKE"; then fail "invoke-as-admin.sh takes the migrate secret from argv"; fi
# 2i. Terraform
for sym in 'resource "aws_ssm_parameter" "secret"' \
           'for_each = toset(var.secret_parameter_names)' \
           '"/developercards/${var.env}/${each.key}"' \
           '"SecureString"' '"Standard"' '"PLACEHOLDER-set-by-supervisor"' \
           'ignore_changes = [value]'; do
  grep -Fq "$sym" "$SSM_TF" || fail "ssm.tf lacks: $sym"
done
if grep -Eq 'key_id|insecure_value|overwrite|environment|provisioner|null_resource|local-exec|archive_file' "$SSM_TF"; then
  fail "ssm.tf carries a forbidden attribute/block (key_id/insecure_value/overwrite/environment/provisioner/null_resource/local-exec/archive_file)"
fi
grep -A3 -F 'variable "secret_parameter_names"' "$ID_VARS" | grep -Fq 'list(string)' || fail "identity/variables.tf lacks variable \"secret_parameter_names\" of type list(string)"
for sym in 'output "secret_parameter_path"' 'output "secret_parameter_arns"' '"/developercards/${var.env}"'; do
  grep -Fq "$sym" "$ID_OUTS" || fail "identity/outputs.tf lacks: $sym"
done
for sym in 'secret_parameter_names' '"pg-password"' '"migrate-secret"' '"internal-shared-secret"' '"rc-webhook-auth-production"' '"rc-webhook-auth-development"'; do
  grep -Fq "$sym" "$PROD_MAIN" || fail "envs/prod/main.tf lacks: $sym"
done
if grep -q 'analytics-salt' "$PROD_MAIN"; then fail "analytics-salt is E13's, not E06's"; fi
python3 - "$ALLOW" "$TMP/allow.canonical.json" <<'PY' || fail "E06.plan-allow.json is not JSON-equal to the brief's Changes 5"
import json, sys
a = json.load(open(sys.argv[1])); b = json.load(open(sys.argv[2]))
assert a == b, (a, b)
PY
ns="$(git diff --numstat "$mb" HEAD -- "$README" | cut -f1,2)"
[ "$ns" = "$(printf '1\t0')" ] || fail "infra/README.md numstat must be '1 0' (one dated §6 line), got '${ns:-<no diff>}'"
git diff -U0 "$mb" HEAD -- "$README" | grep '^+[^+]' | grep -q 'E06' || fail "the added infra/README.md line must mention E06"
# 2j. Runbook
for sym in '## Inventory' '## Rules' '## App-role password rotation' '## Master password rotation' '## Migrate secret' \
           '## Internal shared secret' '## RevenueCat webhook auth' '## First deploy (E06 cut-over)' '## Staging' \
           'modify-db-instance' '--master-user-password' 'put-parameter' 'bootstrap-roles' 'createDatabase' 'INJECT_ENV=0'; do
  grep -Fq "$sym" "$RUNBOOK" || fail "secrets-rotation.md lacks: $sym"
done
# 2k. Tests — titles, harnesses, generated-case count
grep -Fq 'private const int GeneratedCases = 64;' "$SECRETS_T" || fail "SecretsCompareTests.cs lacks GeneratedCases = 64"
grep -Fq '[MemberData(' "$SECRETS_T" || fail "SecretsCompareTests.cs lacks a [MemberData] property test"
for s in FixedTimeEquals_NullOrEmpty_False FixedTimeEquals_Equal_True FixedTimeEquals_Different_False \
         FixedTimeEquals_GeneratedPairs_NeverTrueAndSymmetric FixedTimeEquals_GeneratedSelf_True; do
  grep -Fq "$s" "$SECRETS_T" || fail "missing SecretsCompareTests method: $s"
done
grep -Fq '[Collection(PostgresCollection.Name)]' "$APPROLE_T" || fail "AppRoleTests.cs must join the postgres collection"
for sym in 'CreateScratchDatabaseAsync(' 'ApplyMigrationsAsync(' 'new VpcFunction().Handler('; do
  grep -Fq "$sym" "$APPROLE_T" || fail "AppRoleTests.cs lacks: $sym"
done
for s in BootstrapRoles_Editor_Returns403 BootstrapRoles_BadMigrateSecret_Returns403 BootstrapRoles_BadRoleName_Returns400 \
         BootstrapRoles_BadDatabaseName_Returns400 BootstrapRoles_BadPassword_Returns400 \
         BootstrapRoles_MissingDatabaseWithoutCreate_Returns400 BootstrapRoles_NotMaster_Returns409 \
         BootstrapRoles_CreatesRoleAndDatabase_ThenIdempotent Bootstrap_ReassignsOwnershipOnConnectedDatabase \
         BootstrapRoles_RouteIsWired; do
  grep -Fq "$s" "$APPROLE_T" || fail "missing AppRoleTests method: $s"
done
# 2l. Suppression + secret-leak guards over the new files and the + lines of the edited files
added="$TMP/added.txt"; : > "$added"
cat "${NEW_FILES[@]}" >> "$added"
git diff -U0 "$mb" HEAD -- "${EDITED_FILES[@]}" | grep '^+[^+]' | sed 's/^+//' >> "$added" || true
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$added" \
  && fail "test gutting / suppression found"
if grep -Eq 'Skip *=|#pragma warning disable' "$added"; then fail "xunit Skip / pragma suppression found"; fi
if grep -En '(PGPASSWORD|MIGRATE_SECRET|INTERNAL_SHARED_SECRET|RC_WEBHOOK_AUTH_(PRODUCTION|DEVELOPMENT)|ANALYTICS_USER_SALT)\s*[=:]\s*"[^"$P]' "$added"; then
  fail "a secret-named key carries a literal value (E00 §5 secret-leak guard)"
fi

# ── 3. Root gates ──────────────────────────────────────────────────────────
echo "[3/5] gates: terraform fmt/init/validate, dotnet build, bash -n, jq fixtures, DRY_RUN runs"
command -v terraform >/dev/null || fail "terraform not installed"
command -v jq >/dev/null        || fail "jq not installed"
terraform fmt -check -recursive infra || fail "terraform fmt -check failed under infra/"
( cd infra/envs/prod && terraform init -backend=false -input=false >/dev/null && terraform validate ) || fail "terraform validate failed in infra/envs/prod"
( cd src_C && dotnet build RecallSmith.Lambda.sln -c Release -nologo ) || fail "dotnet build failed"
for f in "$DEPLOY" "$MERGE" "$MERGE_T" "$INVOKE"; do bash -n "$f" || fail "bash -n failed: $f"; done
python3 -c 'import json,sys; [json.load(open(p)) for p in sys.argv[1:]]' "$ENVJSON" "$ALLOW" || fail "JSON parse failed"
bash "$MERGE_T" | tail -1 | grep -Fq 'merge-env tests OK' || fail "merge-env.test.sh did not pass"
# A failing `aws` shim proves the two DRY_RUN paths make no AWS call at all.
mkdir -p "$TMP/bin"; printf '#!/bin/sh\necho "aws was called during DRY_RUN: $*" >&2\nexit 97\n' > "$TMP/bin/aws"; chmod +x "$TMP/bin/aws"
dry="$TMP/deploy.dry.txt"
( cd src_C && PATH="$TMP/bin:$PATH" DRY_RUN=1 ENV=prod ./deploy.sh ) > "$dry" 2>&1 || { tail -20 "$dry" >&2; fail "DRY_RUN=1 ./deploy.sh failed (or called aws)"; }
grep -Fq 'secret keys from /developercards/prod' "$dry" || fail "deploy.sh DRY_RUN must print the secret key names per function"
grep -Fq 'PGPASSWORD' "$dry" || fail "deploy.sh DRY_RUN must list PGPASSWORD among the secret keys"
if grep -q 'PLACEHOLDER' "$dry"; then fail "deploy.sh DRY_RUN printed a value"; fi
inv="$TMP/invoke.dry.txt"
( PATH="$TMP/bin:$PATH" DRY_RUN=1 MIGRATE_SECRET=PLACEHOLDER-verify "$INVOKE" core-vpc:prod POST /api/v1/admin/db/bootstrap-roles ) > "$inv" 2>&1 || { cat "$inv" >&2; fail "DRY_RUN=1 invoke-as-admin.sh failed (or called aws)"; }
grep -Fq 'x-migrate-secret' "$inv" || fail "invoke-as-admin.sh DRY_RUN must list the x-migrate-secret header name"
if grep -q 'PLACEHOLDER-verify' "$inv"; then fail "invoke-as-admin.sh DRY_RUN printed the secret"; fi

# ── 4. Read-only plan (real backend, -lock=false) → allow-list; targeted tests ──
# Same approach as E04.verify.sh: the remote state is READ (s3:GetObject), never locked or
# written (-lock=false), so the plan is the supervisor's plan and the committed allow file
# applies verbatim (5 creates). E01–E05 must be applied and their second plan empty.
echo "[4/5] terraform plan (read-only, real backend, -lock=false) -> check-plan.py; dotnet test SecretsCompareTests|AppRoleTests|AuthBearerTests"
aws sts get-caller-identity --query Account --output text >"$TMP/acct.txt" 2>&1 || fail "AWS credentials unavailable (export AWS_PROFILE=dev, read-only)"
[ "$(tr -d '[:space:]' <"$TMP/acct.txt")" = "622994489535" ] || fail "wrong AWS account for the plan"
docker info >/dev/null 2>&1 || fail "Docker daemon not running (AppRoleTests need postgres:16-alpine)"
ROOTDIR=infra/envs/prod
CHECK=infra/scripts/check-plan.py
python3 -m py_compile "$CHECK" || fail "check-plan.py does not compile"
# Root variables without defaults are answered from the .example file; the two live-dependent
# ones (alert_email from the budget subscriber, snowflake_external_id from iam get-role) are
# replaced with the live values so no unlisted update appears. Written to $TMP only, never printed.
VARFILE="$TMP/e06.auto.tfvars"
if [ -f "$ROOTDIR/prod.auto.tfvars.example" ]; then cp "$ROOTDIR/prod.auto.tfvars.example" "$VARFILE"; else : > "$VARFILE"; fi
if grep -Fq 'variable "alert_email"' "$ROOTDIR/variables.tf" && [ -z "${TF_VAR_alert_email:-}" ]; then
  notif="$(aws budgets describe-notifications-for-budget --account-id 622994489535 --budget-name "My Monthly Cost Budget" --query 'Notifications[0]' --output json 2>/dev/null || true)"
  if [ -n "$notif" ] && [ "$notif" != "null" ]; then
    TF_VAR_alert_email="$(aws budgets describe-subscribers-for-notification --account-id 622994489535 --budget-name "My Monthly Cost Budget" --notification "$notif" --query 'Subscribers[?SubscriptionType==`EMAIL`]|[0].Address' --output text 2>/dev/null || true)"
  fi
  [ -n "${TF_VAR_alert_email:-}" ] && [ "$TF_VAR_alert_email" != "None" ] || unset TF_VAR_alert_email
fi
if [ -n "${TF_VAR_alert_email:-}" ]; then
  grep -v '^\s*alert_email\s*=' "$VARFILE" > "$VARFILE.tmp" && mv "$VARFILE.tmp" "$VARFILE"
  printf 'alert_email = "%s"\n' "$TF_VAR_alert_email" >> "$VARFILE"
fi
if grep -Fq 'variable "snowflake_external_id"' "$ROOTDIR/variables.tf" && [ -z "${TF_VAR_snowflake_external_id:-}" ]; then
  TF_VAR_snowflake_external_id="$(aws iam get-role --role-name snowflake-recallsmith-s3-role --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals."sts:ExternalId"' --output text 2>/dev/null || true)"
  [ -n "$TF_VAR_snowflake_external_id" ] && [ "$TF_VAR_snowflake_external_id" != "None" ] || unset TF_VAR_snowflake_external_id
fi
if [ -n "${TF_VAR_snowflake_external_id:-}" ]; then
  grep -v '^\s*snowflake_external_id\s*=' "$VARFILE" > "$VARFILE.tmp" && mv "$VARFILE.tmp" "$VARFILE"
  printf 'snowflake_external_id = "%s"\n' "$TF_VAR_snowflake_external_id" >> "$VARFILE"
fi
unset TF_VAR_alert_email TF_VAR_snowflake_external_id
( cd "$ROOTDIR" \
  && terraform init -input=false -reconfigure >/dev/null \
  && terraform plan -lock=false -input=false -refresh=true -var-file="$VARFILE" -out="$TMP/E06.tfplan" >/dev/null \
  && terraform show -json "$TMP/E06.tfplan" > "$TMP/E06.plan.json" ) \
  || fail "terraform init/plan/show failed (real backend, read-only; E01–E05 must be applied and their second plan empty)"
# Independent of check-plan.py: the effective set is exactly the five creates; nothing imported,
# updated, deleted or replaced; no output change. Prints addresses + actions only.
python3 - "$TMP/E06.plan.json" "$TMP/allow.canonical.json" <<'PYCHK' || fail "plan is not exactly the five SSM SecureString creates"
import json, sys
plan = json.load(open(sys.argv[1])); expected = json.load(open(sys.argv[2]))["changes"]
eff = {}
for rc in plan.get("resource_changes") or []:
    if rc.get("mode") == "data":
        continue
    actions = rc["change"]["actions"]
    if actions == ["no-op"]:
        continue
    eff[rc["address"]] = "+".join(actions)
    if rc["change"].get("importing"):
        print("unexpected import in a real-backend plan:", rc["address"]); sys.exit(1)
for a in sorted(eff):
    print("  %s  %s" % (a, eff[a]))
outs = sorted((plan.get("output_changes") or {}).keys())
ok = eff == expected and not outs
if not ok:
    print("expected exactly:", sorted(expected)); print("outputs changed:", outs)
print("PLAN SHAPE %s: %d effective" % ("OK" if ok else "FAIL", len(eff)))
sys.exit(0 if ok else 1)
PYCHK
python3 "$CHECK" --plan "$TMP/E06.plan.json" --allow "$ALLOW" | tee "$TMP/check.txt" || fail "check-plan.py rejected the plan"
grep -q 'PLAN OK' "$TMP/check.txt" || fail "check-plan.py did not print PLAN OK"
rm -f "$TMP/E06.tfplan" "$TMP/E06.plan.json" "$VARFILE" "$ROOTDIR/.terraform/terraform.tfstate"
( cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests -c Release --no-build --nologo \
    --filter "FullyQualifiedName~SecretsCompareTests|FullyQualifiedName~AppRoleTests|FullyQualifiedName~AuthBearerTests" ) \
  || fail "targeted dotnet tests failed"

# ── 5. Scope + frozen + OTA + apply guard ──────────────────────────────────
echo "[5/5] scope + frozen + OTA + apply guard"
frozen="$(git diff --numstat "$mb" HEAD -- \
  mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json \
  src_C/Shared/RecallSmith.Lambda.Common/Res.cs src_C/Vpc/Webhooks/RevenuecatWebhook.cs \
  src_C/Shared/RecallSmith.Lambda.Db/Pg.cs src_C/Vpc/Db/Pg.cs src_C/Shared/RecallSmith.Lambda.Db/DbUtil.cs src_C/Vpc/Db/DbUtil.cs \
  src_C/package_lambda_zip.sh \
  infra/envs/prod/variables.tf infra/envs/prod/outputs.tf infra/envs/prod/imports.tf infra/envs/prod/backend.tf \
  infra/envs/prod/providers.tf infra/envs/prod/versions.tf infra/envs/prod/.terraform.lock.hcl infra/scripts \
  infra/modules/identity/policies.tf infra/modules/identity/cognito.tf infra/modules/identity/main.tf \
  infra/modules/data infra/modules/edge infra/modules/api infra/modules/worker infra/modules/observability \
  src_C/Tests/RecallSmith.Lambda.IntegrationTests/IntegrationTestBase.cs \
  src_C/Tests/RecallSmith.Lambda.IntegrationTests/AuthBearerTests.cs)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
if git diff --name-only "$mb" HEAD | grep -E '\.csproj$|src_C/Tests/.*Tests\.cs$' | grep -Ev 'AppRoleTests\.cs$|SecretsCompareTests\.cs$'; then
  fail "a .csproj or an existing test file changed"
fi
grep -Fq '"version": "1.6.1"' mobile/app.json || fail "app.json version changed (OTA runtime 1.6.1)"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (next binary)"; fi
if git ls-files infra | grep -E '\.(tfplan|plan\.json)$|generated.*\.tf$|[^e]\.auto\.tfvars$'; then fail "a plan/generated/tfvars file is tracked under infra/"; fi
if grep -rn 'profile *= *"' infra --include='*.tf'; then fail "provider profile in .tf (CI uses OIDC; humans export AWS_PROFILE)"; fi
# 5a. Apply guard: no worker artefact carries a state-changing command outside comments;
#     deploy.sh may only carry them inside deploy_one after the DRY_RUN return.
apply_re='terraform +(apply|import)|aws +[a-z0-9-]+ +(create|update|delete|put)-'
tf_changed="$(git diff --name-only "$mb" HEAD -- infra | grep -E '\.tf$' || true)"
for f in "$MERGE" "$MERGE_T" "$SECRETS_CS" "$APPROLE" "$APPROLE_T" "$SECRETS_T" "$ALLOW" "$ENVJSON" "$SSM_TF" $tf_changed docs/delivery/r16-issues/E06.verify.sh; do
  [ -f "$f" ] || continue
  if grep -Ev '^\s*(#|//|\*|/\*)' "$f" | grep -Eq "$apply_re"; then
    grep -En "$apply_re" "$f" >&2 || true
    fail "state-changing command outside a comment in $f"
  fi
done
if grep -Ev '^\s*#' "$INVOKE" | grep -Eq "$apply_re"; then fail "invoke-as-admin.sh must only invoke (no create/update/delete/put)"; fi
l_fn="$(grep -n '^deploy_one()' "$DEPLOY" | head -1 | cut -d: -f1)"
[ -n "$l_fn" ] || fail "deploy.sh: deploy_one() not found"
l_dry="$(awk -v s="$l_fn" 'NR > s && /DRY_RUN/ { seen = 1 } seen && /return 0/ { print NR; exit }' "$DEPLOY")"
[ -n "$l_dry" ] || fail "deploy.sh: the DRY_RUN return inside deploy_one() not found"
# Every state-changing aws call (outside comments and DRY:/echo lines) must sit after that return.
bad="$(grep -En "$apply_re" "$DEPLOY" | grep -Ev '^[0-9]+:\s*(#|echo )|DRY:' | cut -d: -f1 | awk -v d="$l_dry" '$1 <= d' || true)"
[ -z "$bad" ] || fail "deploy.sh has a state-changing aws call before the DRY_RUN return (lines: $(echo $bad))"
# 5b. Every changed or untracked path is one of the eighteen scope files. Untracked scan is
# pathspec-scoped: the driver symlinks node_modules into the worktree.
outside="$( { git diff --name-only "$mb" HEAD; git ls-files --others --exclude-standard -- infra src_C scripts docs mobile/src mobile/tests frontend/src; } | sort -u | grep -Ev '^(infra/modules/identity/ssm\.tf|infra/modules/identity/variables\.tf|infra/modules/identity/outputs\.tf|infra/envs/prod/main\.tf|infra/README\.md|src_C/Shared/RecallSmith\.Lambda\.Common/Secrets\.cs|src_C/Vpc/Db/Migrate\.cs|src_C/Vpc/Db/AppRole\.cs|src_C/Vpc/VpcFunction\.cs|src_C/deploy\.sh|src_C/env/prod\.env\.json|src_C/scripts/merge-env\.sh|src_C/scripts/merge-env\.test\.sh|scripts/invoke-as-admin\.sh|src_C/Tests/RecallSmith\.Lambda\.IntegrationTests/AppRoleTests\.cs|src_C/Tests/RecallSmith\.Lambda\.IntegrationTests/SecretsCompareTests\.cs|docs/runbooks/secrets-rotation\.md|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside E06 scope"; }

echo "E06 VERIFY OK"
