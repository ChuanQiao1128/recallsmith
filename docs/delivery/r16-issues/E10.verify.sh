#!/usr/bin/env bash
# E10 — staging-env verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - infra/envs/staging/main.tf (the whole infra/ tree is absent on base),
#     src_C/env/staging.env.json, docs/delivery/r16-issues/E10.plan-allow.json
#     and E10.staging.plan-allow.json do not exist on base
#   (step 1 then also checks the E06/E08/E09 prerequisites that only the
#   integration branch carries: infra/scripts/check-plan.py, modules/edge/dns.tf,
#   src_C/env/prod.env.json, deploy.sh reading env/${ENV}.env.json,
#   cognito-jwt-mobile in modules/api/gateway.tf)
# Step 2 (literal guards over the staging root, cognito.tf, the env JSON, the
# three eas.json lines, the two allow files) would also fail on base. Step 3 is
# the infra / src_C root gates, step 4 is the three plans (staging, prod at
# HEAD, prod at the merge-base) with allow-list, delta, name and policy checks,
# step 5 is scope + frozen + OTA + module-rule + apply-word guards.
#
# The driver's diff-scoped term gate and suppression scan run separately; this
# script does not spell the six terms (E00 §0).
#
# Network: AWS read-only (AWS_PROFILE=dev): terraform plan (describe/get/list),
# sts get-caller-identity, iam simulate-custom-policy. No init against the S3
# backend, nothing is applied, nothing is created. Plan files and plan JSON
# live in a mktemp dir removed by trap and are never printed (a prod plan holds
# prod env values in clear). Runtime ≈ 10–14 min (three plans; ~93 imports in
# each prod plan; the two prod plans run in parallel after sequential inits).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-e-prod}}"   # driver exports BASE
fail() { echo "E10 VERIFY FAIL: $*" >&2; exit 1; }

MB="$(git merge-base "$BASE_REF" HEAD 2>/dev/null || git merge-base "origin/$BASE_REF" HEAD 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"

export TF_PLUGIN_CACHE_DIR="${TF_PLUGIN_CACHE_DIR:-$HOME/.terraform.d/plugin-cache}"
mkdir -p "$TF_PLUGIN_CACHE_DIR"
export TF_IN_AUTOMATION=1 TF_INPUT=0
TMP="$(mktemp -d "${TMPDIR:-/tmp}/e10-verify.XXXXXX")"
cleanup() {   # *.tfplan, *.plan.json, the base archive, policy docs, and the local-backend overrides of E01 gap 13
  rm -f infra/envs/prod/backend_override.tf infra/envs/staging/backend_override.tf \
        infra/envs/prod/.terraform/terraform.tfstate infra/envs/staging/.terraform/terraform.tfstate
  rm -rf "$TMP"
}
trap cleanup EXIT

STG=infra/envs/staging
PROD=infra/envs/prod
S_MAIN=$STG/main.tf
S_VARS=$STG/variables.tf
S_OUT=$STG/outputs.tf
S_PROV=$STG/providers.tf
S_VERS=$STG/versions.tf
S_BACK=$STG/backend.tf
S_EX=$STG/staging.auto.tfvars.example
S_LOCK=$STG/.terraform.lock.hcl
P_OUT=$PROD/outputs.tf
COG=infra/modules/identity/cognito.tf
ID_OUT=infra/modules/identity/outputs.tf
API_VARS=infra/modules/api/variables.tf
API_OUT=infra/modules/api/outputs.tf
API_FN=infra/modules/api/core_vpc.tf
WK_VARS=infra/modules/worker/variables.tf
WK_FN=infra/modules/worker/function.tf
ENVJ=src_C/env/staging.env.json
EAS=mobile/eas.json
ALLOW_PROD=docs/delivery/r16-issues/E10.plan-allow.json
ALLOW_STG=docs/delivery/r16-issues/E10.staging.plan-allow.json
BRIEF=docs/delivery/r16-issues/E10-staging-env.md
SELF=docs/delivery/r16-issues/E10.verify.sh

need()  { grep -Fq -- "$2" "$1" || fail "$1 lacks: $2"; }
needE() { grep -Eq -- "$2" "$1" || fail "$1 lacks (regex): $2"; }
deny()  { if grep -Fq -- "$2" "$1"; then fail "$1 must not contain: $2"; fi; }
denyE() { if grep -Eq -- "$2" "$1"; then fail "$1 must not contain (regex): $2"; fi; }

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ E06/E08/E09 prerequisites)"
for f in "$S_MAIN" "$S_VARS" "$S_OUT" "$S_PROV" "$S_VERS" "$S_BACK" "$S_EX" "$S_LOCK" "$ENVJ" "$ALLOW_PROD" "$ALLOW_STG"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
for f in "$PROD/main.tf" "$PROD/imports.tf" "$PROD/.terraform.lock.hcl" "$PROD/prod.auto.tfvars.example" \
         infra/scripts/check-plan.py infra/README.md infra/.gitignore infra/bootstrap/placeholder.zip \
         "$COG" "$ID_OUT" "$P_OUT" "$API_VARS" "$API_OUT" "$API_FN" infra/modules/api/gateway.tf \
         "$WK_VARS" "$WK_FN" infra/modules/worker/queue.tf \
         infra/modules/edge/dns.tf infra/modules/edge/certs.tf \
         src_C/env/prod.env.json src_C/deploy.sh "$EAS"; do
  [ -f "$f" ] || fail "$f is missing — E01…E09 must be merged before E10 (E00 §4)"
done
grep -Eq 'env/\$\{?ENV\}?\.env\.json' src_C/deploy.sh || fail "src_C/deploy.sh does not read env/\${ENV}.env.json (E06 incomplete)"
grep -Fq 'cognito-jwt-mobile' infra/modules/api/gateway.tf || fail "modules/api/gateway.tf lacks the mobile authorizer (E08 incomplete)"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. backend / versions / providers
need "$S_BACK" 'backend "s3"'
need "$S_BACK" 'bucket       = "recallsmith-tfstate-622994489535"'
need "$S_BACK" 'key          = "envs/staging/terraform.tfstate"'
need "$S_BACK" 'region       = "ap-southeast-2"'
need "$S_BACK" 'encrypt      = true'
need "$S_BACK" 'use_lockfile = true'
deny "$S_BACK" 'envs/prod/'
deny "$S_BACK" 'dynamodb_table'
need "$S_VERS" 'required_version = ">= 1.10"'
need "$S_VERS" 'source  = "hashicorp/aws"'
need "$S_VERS" 'version = "~> 6.0"'
deny "$S_VERS" 'backend'
needE "$S_PROV" 'region\s*=\s*"ap-southeast-2"'
needE "$S_PROV" 'alias\s*=\s*"use1"'
needE "$S_PROV" 'region\s*=\s*"us-east-1"'
needE "$S_PROV" 'Project\s*=\s*"DeveloperCards"'
needE "$S_PROV" 'ManagedBy\s*=\s*"terraform"'
[ "$(grep -Ec 'Env\s*=\s*"staging"' "$S_PROV" || true)" -ge 2 ] || fail "providers.tf: both providers need default_tags Env = \"staging\""
deny "$S_PROV" 'profile'
denyE "$S_PROV" 'Env\s*=\s*"prod"'
# 2b. variables.tf — four without default, twelve with the defaults of Changes 4
for v in console_staging_client_id mobile_staging_client_id cloudfront_cert_arn api_cert_arn \
         region account_id domain hosted_zone_id db_identifier console_pool_id mobile_pool_id \
         vpc_id subnet_ids lambda_security_group_ids worker_security_group_ids cors_allowed_origins; do
  need "$S_VARS" "variable \"$v\""
done
for lit in '"Z0284954BSN00C8BF94Q"' '"developercards.app"' '"ap-southeast-2_4Vf8uCXKt"' '"ap-southeast-2_04hd6iisb"' \
           '"vpc-04af44dd8f5f48717"' '"subnet-0cc7a99faf631cee2"' '"subnet-0dd0ac42e1bb9648a"' '"subnet-0a365ac32e28958ed"' \
           '"sg-00ad6c62d292a475e"' '"sg-04af3c6fa45f10113"' '"sg-0d2541aec08b1a215"' '"sg-0fbc6607e6473cbd3"' \
           '"622994489535"' '"ap-southeast-2"' '"developercards"' \
           '"https://console-staging.developercards.app"' '"http://localhost:5173"'; do
  need "$S_VARS" "$lit"
done
for bad in 'sensitive' 'variable "env"' 'alert_email' 'snowflake_external_id' 'snowpipe_sqs_arn' 'ktbq1sie2c'; do
  deny "$S_VARS" "$bad"
done
# 2c. the example tfvars — exactly the four pasted keys
for k in console_staging_client_id mobile_staging_client_id cloudfront_cert_arn api_cert_arn; do
  needE "$S_EX" "^$k\s*="
done
[ "$(grep -Ec '^[a-z_]+\s*=' "$S_EX" || true)" = "4" ] || fail "$S_EX must carry exactly four assignments"
# 2d. main.tf — names, hostnames, data sources, SSM, Sids, CDN constants, module sources
for lit in '"developercards-api-staging"' '"core-vpc-staging"' '"worker-lambda-staging"' '"developercards-edge-public-staging"' \
           '"developercards-publish-jobs-staging"' '"developercards-publish-jobs-staging-dlq"' \
           '"developercards-content-staging"' '"developercards-premium-staging"' '"developercards-console-staging"' \
           '"developercards-core-vpc-staging-role"' '"developercards-worker-lambda-staging-role"' '"developercards-edge-public-staging-role"' \
           '"api-staging.${var.domain}"' '"cdn-staging.${var.domain}"' '"console-staging.${var.domain}"' \
           '"pg-password"' '"migrate-secret"' '"internal-shared-secret"' '"rc-webhook-auth-production"' '"rc-webhook-auth-development"' \
           'src_C/env/staging.env.json' 'data "aws_db_instance" "developercards"' 'data "aws_route53_zone" "main"' \
           '"/developercards/staging/${each.key}"' '"PLACEHOLDER-set-by-supervisor"' \
           '"S3Content"' '"S3Premium"' '"S3Head"' '"SqsSend"' '"Logs"' '"Eni"' '"S3Builds"' '"SqsConsume"' \
           '"658327ea-f89d-4fab-a63d-7e88639e58f6"' '"67f7725c-6f97-4210-82d7-5512b31e9d03"' '"TLSv1.2_2021"' '"sni-only"' '"noncurrent-90d"' \
           '"../../modules/api"' '"../../modules/worker"' '"/aws/apigateway/developercards-api-staging"' \
           '"developercards-content-staging-oac"' '"developercards-console-staging-oac"' 'toset(["A", "AAAA"])' \
           'resource "aws_route53_record" "cdn"' 'resource "aws_route53_record" "console"' 'resource "aws_route53_record" "api"' \
           'resource "aws_iam_role_policy" "core_vpc"' 'resource "aws_iam_role_policy" "worker"' 'resource "aws_iam_role_policy" "edge_public"' \
           'resource "aws_iam_role" "core_vpc"' 'resource "aws_iam_role" "worker"' 'resource "aws_iam_role" "edge_public"' \
           'resource "aws_cloudwatch_log_group" "api_access"' 'resource "aws_ssm_parameter" "secret"' \
           'resource "aws_cloudfront_distribution" "content"' 'resource "aws_cloudfront_distribution" "console"' \
           'resource "aws_s3_bucket_policy" "content"' 'resource "aws_s3_bucket_policy" "console"' \
           'module "api"' 'module "worker"' 'core_vpc_environment' 'worker_environment' 'PGHOST' 'PGPORT'; do
  need "$S_MAIN" "$lit"
done
needE "$S_MAIN" 'zone_id\s*=\s*var\.hosted_zone_id'
needE "$S_MAIN" 'ignore_changes\s*=\s*\[value\]'
needE "$S_MAIN" 'evaluate_target_health\s*=\s*false'
needE "$S_MAIN" 'retention_in_days\s*=\s*30'
needE "$S_MAIN" 'noncurrent_days\s*=\s*90'
needE "$S_MAIN" 'days_after_initiation\s*=\s*7'
needE "$S_MAIN" 'type\s*=\s*"SecureString"'
needE "$S_MAIN" 'jsondecode\(file\('
for bad in 'resource "aws_db_instance"' 'resource "aws_route53_zone"' 'resource "aws_acm_certificate"' 'aws_wafv2' 'web_acl_id' \
           'aws_budgets_budget' 'aws_cloudwatch_metric_alarm' 'aws_sns_topic' 'aws_cloudtrail' 'aws_cognito_user_pool' \
           'aws_iam_openid_connect_provider' 'aws_iam_policy"' 'aws_iam_role_policy_attachment' \
           'modules/identity' 'modules/data' 'modules/edge' 'modules/observability' \
           'moved {' 'removed {' 'import {' 'provisioner' 'null_resource' 'local-exec' 'archive_file' 'terraform_remote_state' \
           'ktbq1sie2c' 'E28BKORJLV6UXG' 'E85FKUMZZWQWX' 'core-vpc-premium' 'recallsmith-publish-jobs' \
           '6lkofepp2llp6v4nueg52mcm5v' '7agirr7f56r9k5p6v6o63al1on' '/developercards/prod/' 'AUTH_ALLOW_UNVERIFIED' 'PGPASSWORD'; do
  deny "$S_MAIN" "$bad"
done
# 2e. outputs.tf — the fourteen outputs
for o in api_id api_endpoint api_hostname cdn_hostname console_hostname content_distribution_id console_distribution_id \
         content_bucket_name premium_bucket_name console_bucket_name publish_queue_url core_vpc_alias_arn worker_alias_arn core_vpc_role_arn; do
  need "$S_OUT" "output \"$o\""
done
[ "$(grep -Ec '^output "' "$S_OUT" || true)" = "14" ] || fail "$S_OUT must declare exactly fourteen outputs"
deny "$S_OUT" 'sensitive'
# 2f. lock file is prod's, byte for byte
cmp -s "$PROD/.terraform.lock.hcl" "$S_LOCK" || fail "$S_LOCK must be a byte-identical copy of $PROD/.terraform.lock.hcl"
# 2g. identity: the two staging clients + outputs; prod root outputs; module variables/outputs
need "$COG" 'resource "aws_cognito_user_pool_client" "console_staging"'
need "$COG" 'resource "aws_cognito_user_pool_client" "mobile_staging"'
need "$COG" '"console-staging"'
need "$COG" '"MobileDeveloperCards-staging"'
need "$COG" '"https://console-staging.developercards.app/auth/callback"'
need "$COG" '"https://console-staging.developercards.app/"'
need "$COG" '"https://d84l1y8p4kdic.cloudfront.net"'
needE "$COG" 'access_token_validity\s*=\s*60'
need "$ID_OUT" 'output "console_staging_client_id"'
need "$ID_OUT" 'output "mobile_staging_client_id"'
need "$ID_OUT" 'one(aws_cognito_user_pool_client.console_staging[*].id)'
need "$ID_OUT" 'one(aws_cognito_user_pool_client.mobile_staging[*].id)'
need "$P_OUT" 'output "console_staging_client_id"'
need "$P_OUT" 'output "mobile_staging_client_id"'
need "$P_OUT" 'module.identity.console_staging_client_id'
need "$P_OUT" 'module.identity.mobile_staging_client_id'
need "$API_VARS" 'variable "core_vpc_environment"'
need "$API_FN" 'variables = var.core_vpc_environment'
need "$API_OUT" 'output "api_domain_target_domain_name"'
need "$API_OUT" 'output "api_domain_hosted_zone_id"'
need "$WK_VARS" 'variable "worker_environment"'
need "$WK_FN" 'variables = var.worker_environment'
# 2h. staging.env.json — exactly E00 §2.10.3
python3 - "$ENVJ" <<'PY' || fail "src_C/env/staging.env.json differs from E00 §2.10.3"
import json, sys
got = json.load(open(sys.argv[1]))
exp = {
  "PGDATABASE": "developercards_staging", "PGUSER": "developercards_app_staging", "API_ENV": "staging",
  "LOG_LEVEL": "debug", "PG_MAX": "1", "PGSSLMODE": "require", "METRICS_NAMESPACE": "DeveloperCards/Staging",
  "CONTENT_BUCKET": "developercards-content-staging", "CONTENT_PREFIX": "content",
  "PREMIUM_BUCKET": "developercards-premium-staging", "PREMIUM_PREFIX": "premium",
  "PUBLISH_JOB_QUEUE_URL": "https://sqs.ap-southeast-2.amazonaws.com/622994489535/developercards-publish-jobs-staging",
  "CORS_ORIGIN": "https://console-staging.developercards.app,http://localhost:5173",
  "ALLOW_DEV_PREMIUM": "0", "DISALLOW_SANDBOX_PREMIUM": "0",
  "RC_WEBHOOK_EXPECT_ENV_DEVELOPMENT": "SANDBOX", "RC_WEBHOOK_EXPECT_ENV_PRODUCTION": "PRODUCTION",
}
if got != exp:
    print("key/value mismatch:", sorted(set(got.items()) ^ set(exp.items())), file=sys.stderr); sys.exit(1)
PY
for bad in PGHOST PGPORT PGPASSWORD MIGRATE_SECRET INTERNAL_SHARED_SECRET RC_WEBHOOK_AUTH ANALYTICS_USER_SALT AUTH_ALLOW_UNVERIFIED MANIFEST_QUEUE_URL; do
  deny "$ENVJ" "$bad"
done
# 2i. eas.json — only build.staging-internal-release differs from base, with the three new values
git show "$MB:$EAS" > "$TMP/eas.base.json"
python3 - "$TMP/eas.base.json" "$EAS" <<'PY' || fail "mobile/eas.json: only the staging-internal-release profile may change (channel staging / environment preview / EXPO_PUBLIC_ENV staging)"
import json, sys
base, head = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
p = "staging-internal-release"
hp = head["build"][p]
ok = (hp["channel"] == "staging" and hp["environment"] == "preview"
      and hp["ios"]["env"]["EXPO_PUBLIC_ENV"] == "staging" and hp["distribution"] == "internal"
      and hp["ios"]["buildConfiguration"] == "Release")
if not ok: print("staging-internal-release values wrong", file=sys.stderr); sys.exit(1)
bb, hb = dict(base["build"]), dict(head["build"])
bb.pop(p); hb.pop(p)
if bb != hb or base.get("cli") != head.get("cli") or base.get("submit") != head.get("submit"):
    print("something outside build.staging-internal-release changed", file=sys.stderr); sys.exit(1)
if head["build"]["production"]["channel"] != "production": print("production profile changed", file=sys.stderr); sys.exit(1)
PY
# 2j. allow files — shapes of Changes 16 (contents are cross-checked against the plans in step 4)
python3 - "$ALLOW_PROD" "$ALLOW_STG" <<'PY' || fail "allow files do not have the shapes of Changes 16"
import json, sys
prod, stg = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
def act(v): return v if isinstance(v, str) else v.get("action")
c = prod.get("changes", {})
for a in ("module.identity.aws_cognito_user_pool_client.console_staging[0]", "module.identity.aws_cognito_user_pool_client.mobile_staging[0]"):
    if act(c.get(a)) != "create": print("prod allow lacks create for", a, file=sys.stderr); sys.exit(1)
if not {"console_staging_client_id", "mobile_staging_client_id"} <= set(prod.get("outputs", [])):
    print("prod allow lacks the two outputs", file=sys.stderr); sys.exit(1)
if "expect_imports" in prod: print("prod allow must not carry expect_imports (E01 only)", file=sys.stderr); sys.exit(1)
sc = stg.get("changes", {})
if not sc or any(act(v) != "create" for v in sc.values()):
    print("staging allow: every change must be create", file=sys.stderr); sys.exit(1)
outs = {"api_id","api_endpoint","api_hostname","cdn_hostname","console_hostname","content_distribution_id","console_distribution_id",
        "content_bucket_name","premium_bucket_name","console_bucket_name","publish_queue_url","core_vpc_alias_arn","worker_alias_arn","core_vpc_role_arn"}
if set(stg.get("outputs", [])) != outs: print("staging allow outputs must be the fourteen of Changes 7", file=sys.stderr); sys.exit(1)
if "expect_imports" in stg: print("staging allow must not carry expect_imports", file=sys.stderr); sys.exit(1)
PY
# 2k. suppression / secret-leak guards over the issue's new files and added lines
NEWFILES="$(git ls-files --others --exclude-standard -- infra src_C/env mobile/eas.json docs/delivery/r16-issues | grep -Ev "^($BRIEF|$SELF)$" || true)"
ADDED="$TMP/added.txt"
{ git diff -U0 "$MB" HEAD -- . ":(exclude)$BRIEF" ":(exclude)$SELF" | grep -E '^\+[^+]' | sed 's/^+//' || true
  if [ -n "$NEWFILES" ]; then printf '%s\n' "$NEWFILES" | while IFS= read -r f; do cat "$f"; done; fi
} > "$ADDED"
if grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable|#pragma warning disable|Skip =" "$ADDED"; then
  fail "test gutting / suppression token in an added line"
fi
if grep -Eq '(PGPASSWORD|MIGRATE_SECRET|INTERNAL_SHARED_SECRET|RC_WEBHOOK_AUTH_(PRODUCTION|DEVELOPMENT)|ANALYTICS_USER_SALT)\s*[=:]\s*"[^"$P]' "$ADDED"; then
  fail "a secret NAME appears with a literal value in an added line (E00 §5 secret-leak guard)"
fi

# ── 3. Root gates ──────────────────────────────────────────────────────────
echo "[3/5] root gates: terraform fmt/validate (prod + staging), dotnet build, bash -n"
command -v terraform >/dev/null || fail "terraform not installed"
terraform fmt -check -recursive infra >/dev/null || fail "terraform fmt -check -recursive infra"
( cd "$PROD" && terraform init -backend=false -input=false -no-color >/dev/null && terraform validate -no-color >/dev/null && terraform fmt -check -recursive .. >/dev/null ) \
  || fail "infra root gate (envs/prod) failed"
( cd "$STG" && terraform init -backend=false -input=false -no-color >/dev/null && terraform validate -no-color >/dev/null && terraform fmt -check -recursive .. >/dev/null ) \
  || fail "infra root gate (envs/staging) failed"
cmp -s "$PROD/.terraform.lock.hcl" "$S_LOCK" || fail "staging init rewrote .terraform.lock.hcl — the committed copy must already match the provider"
( cd src_C && dotnet build RecallSmith.Lambda.sln -c Release -nologo >/dev/null ) || fail "dotnet build failed"
bash -n src_C/deploy.sh || fail "bash -n src_C/deploy.sh"
python3 -m py_compile infra/scripts/check-plan.py || fail "check-plan.py does not compile"

# ── 4. Plans: staging (all creates), prod at HEAD, prod at the merge-base (delta) ──
echo "[4/5] plans (AWS read-only; ≈ 8–12 min)"
aws sts get-caller-identity --query Account --output text >/dev/null 2>&1 || fail "AWS_PROFILE=dev read-only credentials are required for step 4"
mkdir -p "$TMP/base"
git archive "$MB" infra | tar -x -C "$TMP/base" || fail "git archive of infra at the merge-base failed"
# Empty local state through E01's gitignored backend_override.tf (E00 §6 #25 mode a): `init -backend=false`
# serves validate only — a plan after it stops with "Backend initialization required". One override per
# root (state path under $TMP), sequential inits (the plugin cache is not concurrency-safe), parallel plans.
if [ -e "$PROD/backend_override.tf" ] || [ -e "$STG/backend_override.tf" ]; then fail "a backend_override.tf is already present in a worktree root — remove it before running the verify"; fi
init_local() {  # <root-dir> <state-name>
  printf 'terraform {\n  backend "local" {\n    path = "%s/%s.tfstate"\n  }\n}\n' "$TMP" "$2" > "$1/backend_override.tf"
  ( cd "$1" && terraform init -input=false -reconfigure -no-color >"$TMP/init-$2.log" 2>&1 ) \
    || { tail -20 "$TMP/init-$2.log" >&2; fail "terraform init (local override) failed in $1"; }
}
init_local "$ROOT/$PROD"     prod-head
init_local "$TMP/base/$PROD" prod-base
init_local "$ROOT/$STG"      staging
PV=(); [ -f "$PROD/prod.auto.tfvars.example" ] && PV=(-var-file=prod.auto.tfvars.example)
plan_one() {  # dir out-prefix [extra plan args…]  → <prefix>.tfplan / .plan.json / .log ; never prints the plan
  local dir="$1" pre="$2"; shift 2
  ( cd "$dir" && terraform plan -input=false -no-color -parallelism=20 "$@" -out="$pre.tfplan" >"$pre.log" 2>&1 \
      && terraform show -json "$pre.tfplan" >"$pre.plan.json" 2>>"$pre.log" )
}
show_err() { grep -n -A6 -E 'Error' "$1" | grep -Eiv 'PASSWORD|SECRET|_AUTH_|SALT' | head -40 >&2 || true; }
plan_one "$ROOT/$PROD"      "$TMP/prod-head" ${PV[@]+"${PV[@]}"} & P1=$!
plan_one "$TMP/base/$PROD"  "$TMP/prod-base" ${PV[@]+"${PV[@]}"} & P2=$!
plan_one "$ROOT/$STG"       "$TMP/staging"   -var-file=staging.auto.tfvars.example & P3=$!
wait $P1 || { show_err "$TMP/prod-head.log"; fail "prod plan at HEAD failed"; }
wait $P2 || { show_err "$TMP/prod-base.log"; fail "prod plan at the merge-base failed"; }
wait $P3 || { show_err "$TMP/staging.log";   fail "staging plan failed"; }
rm -f "$ROOT/$PROD/backend_override.tf" "$ROOT/$STG/backend_override.tf" "$ROOT/$PROD/.terraform/terraform.tfstate" "$ROOT/$STG/.terraform/terraform.tfstate"

# 4a. staging plan: every effective action is create; required addresses + names; forbidden types;
#     no prod name/id in any string leaf; env seed; policy shapes. Prints addresses/actions only.
python3 - "$TMP/staging.plan.json" "$ALLOW_STG" "$TMP" <<'PY' || fail "staging plan violates the E10 contract (see above)"
import json, re, sys
plan = json.load(open(sys.argv[1])); allow = json.load(open(sys.argv[2])); tmp = sys.argv[3]
rcs = plan.get("resource_changes") or []
errs = []
eff = {rc["address"]: rc for rc in rcs if rc.get("mode", "managed") == "managed" and rc["change"]["actions"] != ["no-op"]}
for a, rc in eff.items():
    if rc["change"]["actions"] != ["create"]: errs.append("%s: actions %s (staging must be all-create)" % (a, rc["change"]["actions"]))
    if rc["change"].get("importing"): errs.append("%s: importing in the staging plan" % a)
FORBID = ("aws_wafv2_web_acl","aws_db_instance","aws_db_subnet_group","aws_route53_zone","aws_acm_certificate","aws_acm_certificate_validation",
          "aws_budgets_budget","aws_cloudwatch_metric_alarm","aws_cloudwatch_dashboard","aws_sns_topic","aws_cloudtrail",
          "aws_cognito_user_pool","aws_cognito_user_pool_client","aws_iam_openid_connect_provider","aws_iam_policy","aws_iam_role_policy_attachment")
for rc in rcs:
    if rc.get("mode") == "managed" and rc["type"] in FORBID: errs.append("%s: forbidden type in staging" % rc["address"])
REQ = {
 "module.api.aws_apigatewayv2_api.http": {"name": "developercards-api-staging"},
 "module.api.aws_apigatewayv2_stage.default": {"name": "$default"},
 "module.api.aws_apigatewayv2_authorizer.console": {}, "module.api.aws_apigatewayv2_authorizer.mobile": {},
 "module.api.aws_apigatewayv2_domain_name.api": {"domain_name": "api-staging.developercards.app"},
 "module.api.aws_apigatewayv2_api_mapping.api": {},
 "module.api.aws_lambda_function.core_vpc": {"function_name": "core-vpc-staging"},
 "module.api.aws_lambda_alias.core_vpc_prod": {"name": "staging"},
 "module.api.aws_cloudwatch_log_group.core_vpc": {"name": "/aws/lambda/core-vpc-staging"},
 "module.api.aws_lambda_function.edge_public": {"function_name": "developercards-edge-public-staging"},
 "module.api.aws_cloudwatch_log_group.edge_public": {"name": "/aws/lambda/developercards-edge-public-staging"},
 "module.worker.aws_sqs_queue.publish_jobs": {"name": "developercards-publish-jobs-staging"},
 "module.worker.aws_sqs_queue.publish_jobs_dlq": {"name": "developercards-publish-jobs-staging-dlq"},
 "module.worker.aws_lambda_function.worker": {"function_name": "worker-lambda-staging"},
 "module.worker.aws_lambda_alias.worker_prod": {"name": "staging"},
 "module.worker.aws_lambda_event_source_mapping.worker_sqs": {},
 "module.worker.aws_cloudwatch_log_group.worker": {"name": "/aws/lambda/worker-lambda-staging"},
 "aws_iam_role.core_vpc": {"name": "developercards-core-vpc-staging-role"},
 "aws_iam_role.worker": {"name": "developercards-worker-lambda-staging-role"},
 "aws_iam_role.edge_public": {"name": "developercards-edge-public-staging-role"},
 "aws_iam_role_policy.core_vpc": {}, "aws_iam_role_policy.worker": {}, "aws_iam_role_policy.edge_public": {},
 "aws_s3_bucket.content": {"bucket": "developercards-content-staging"},
 "aws_s3_bucket.premium": {"bucket": "developercards-premium-staging"},
 "aws_s3_bucket.console": {"bucket": "developercards-console-staging"},
 "aws_s3_bucket_policy.content": {}, "aws_s3_bucket_policy.console": {},
 "aws_s3_bucket_versioning.content": {}, "aws_s3_bucket_versioning.premium": {},
 "aws_s3_bucket_lifecycle_configuration.content": {}, "aws_s3_bucket_lifecycle_configuration.premium": {},
 "aws_s3_bucket_public_access_block.content": {}, "aws_s3_bucket_public_access_block.premium": {}, "aws_s3_bucket_public_access_block.console": {},
 "aws_s3_bucket_ownership_controls.content": {}, "aws_s3_bucket_ownership_controls.premium": {}, "aws_s3_bucket_ownership_controls.console": {},
 "aws_s3_bucket_server_side_encryption_configuration.content": {}, "aws_s3_bucket_server_side_encryption_configuration.premium": {}, "aws_s3_bucket_server_side_encryption_configuration.console": {},
 "aws_cloudfront_origin_access_control.content": {"name": "developercards-content-staging-oac"},
 "aws_cloudfront_origin_access_control.console": {"name": "developercards-console-staging-oac"},
 "aws_cloudfront_distribution.content": {"aliases": ["cdn-staging.developercards.app"]},
 "aws_cloudfront_distribution.console": {"aliases": ["console-staging.developercards.app"]},
 "aws_cloudwatch_log_group.api_access": {"name": "/aws/apigateway/developercards-api-staging", "retention_in_days": 30},
}
for host, key in (("cdn-staging.developercards.app", "cdn"), ("console-staging.developercards.app", "console"), ("api-staging.developercards.app", "api")):
    for t in ("A", "AAAA"):
        REQ['aws_route53_record.%s["%s"]' % (key, t)] = {"type": t, "name": host}
for k in ("pg-password", "migrate-secret", "internal-shared-secret", "rc-webhook-auth-production", "rc-webhook-auth-development"):
    REQ['aws_ssm_parameter.secret["%s"]' % k] = {"name": "/developercards/staging/" + k, "type": "SecureString"}
for a, want in REQ.items():
    rc = eff.get(a)
    if rc is None: errs.append("%s: missing (must be created)" % a); continue
    after = rc["change"].get("after") or {}
    for k, v in want.items():
        got = after.get(k)
        if isinstance(v, list): got = sorted(got or [])
        if got != (sorted(v) if isinstance(v, list) else v): errs.append("%s.%s = %r, want %r" % (a, k, got, v))
for a in ("aws_cloudfront_distribution.content", "aws_cloudfront_distribution.console"):
    if eff.get(a) and (eff[a]["change"].get("after") or {}).get("web_acl_id"): errs.append("%s: web_acl_id set (no WAF on staging)" % a)
for a in ("aws_s3_bucket_versioning.content", "aws_s3_bucket_versioning.premium"):
    if eff.get(a):
        vc = ((eff[a]["change"].get("after") or {}).get("versioning_configuration") or [{}])[0]
        if vc.get("status") != "Enabled": errs.append("%s: status must be Enabled" % a)
# env seed on both functions
for a in ("module.api.aws_lambda_function.core_vpc", "module.worker.aws_lambda_function.worker"):
    if not eff.get(a): continue
    env = (((eff[a]["change"].get("after") or {}).get("environment") or [{}])[0].get("variables") or {})
    for k, v in (("PGDATABASE", "developercards_staging"), ("PGUSER", "developercards_app_staging"), ("API_ENV", "staging"),
                 ("CONTENT_BUCKET", "developercards-content-staging"), ("PREMIUM_BUCKET", "developercards-premium-staging"),
                 ("PGSSLMODE", "require"), ("PGPORT", "5432")):
        if env.get(k) != v: errs.append("%s env %s = %r, want %r" % (a, k, env.get(k), v))
    if not str(env.get("PGHOST", "")).endswith(".rds.amazonaws.com"): errs.append("%s env PGHOST must come from data.aws_db_instance" % a)
    for k in ("PGPASSWORD", "MIGRATE_SECRET", "INTERNAL_SHARED_SECRET", "AUTH_ALLOW_UNVERIFIED"):
        if k in env: errs.append("%s env must not seed %s" % (a, k))
# prod names/ids must not appear in any string leaf of any create
EXACT = {"core-vpc","worker-lambda","edge-public","core-vpc-premium","recallsmith-console-622994489535","recallsmith-publish-jobs",
         "developercards-publish-jobs-dlq","developercards-api","core-vpc-role-joizyiwt","edge-public-role-zezx326f","developercards-worker-lambda-role",
         "rds-monitoring-role","snowflake-recallsmith-s3-role","My Monthly Cost Budget","developercards-management","developercards-alerts",
         "developercards-prod","developercards-site-622994489535","developercards-analytics-622994489535","developercards-cloudtrail-622994489535",
         "6lkofepp2llp6v4nueg52mcm5v","7agirr7f56r9k5p6v6o63al1on","api.developercards.app","cdn.developercards.app","console.developercards.app",
         "www.developercards.app","/aws/lambda/core-vpc","/aws/lambda/worker-lambda","/aws/lambda/edge-public","/aws/apigateway/developercards-api",
         "developercards_db","developercards_app","prod"}
SUB = ("ktbq1sie2c","E28BKORJLV6UXG","E85FKUMZZWQWX","E2O3Q2DB6GEBDD","E13T84KBR8KQT6","d1ditdi9jqpy6n","d12pfy1rhi3ekm","/developercards/prod/")
RX = [re.compile(p) for p in (r":function:(core-vpc|worker-lambda|edge-public)(:|$)", r"arn:aws:s3:::(core-vpc|core-vpc-premium|recallsmith-console-622994489535)(/|$|\")",
                              r"[:/](recallsmith-publish-jobs|developercards-publish-jobs-dlq)($|\")", r"log-group:/aws/lambda/(core-vpc|worker-lambda|edge-public):")]
def leaves(x):
    if isinstance(x, dict):
        for v in x.values(): yield from leaves(v)
    elif isinstance(x, list):
        for v in x: yield from leaves(v)
    elif isinstance(x, str): yield x
for a, rc in eff.items():
    for s in leaves(rc["change"].get("after") or {}):
        if s in EXACT or any(t in s for t in SUB) or any(r.search(s) for r in RX):
            errs.append("%s: a prod name/id appears in a planned value (%s)" % (a, s[:60])); break
# inline policies: Sids, no wildcard actions, Resource "*" only on Eni, staging-only ARNs; documents must be known at plan time
SIDS = {"aws_iam_role_policy.core_vpc": {"S3Content","S3Premium","S3Head","SqsSend","Logs","Eni"},
        "aws_iam_role_policy.worker": {"S3Builds","S3Head","SqsConsume","Logs","Eni"},
        "aws_iam_role_policy.edge_public": {"Logs"}}
for a, sids in SIDS.items():
    rc = eff.get(a)
    if not rc: continue
    pol = (rc["change"].get("after") or {}).get("policy")
    if not isinstance(pol, str): errs.append("%s: policy must be fully known at plan time (build ARNs from strings, Changes 6a)" % a); continue
    doc = json.loads(pol); open("%s/%s.json" % (tmp, a.split(".")[-1]), "w").write(pol)
    stmts = doc.get("Statement", [])
    if {s.get("Sid") for s in stmts} != sids: errs.append("%s: Sids %s, want %s" % (a, sorted(str(s.get('Sid')) for s in stmts), sorted(sids)))
    for s in stmts:
        acts = s.get("Action"); acts = [acts] if isinstance(acts, str) else acts
        res = s.get("Resource"); res = [res] if isinstance(res, str) else res
        if any(x == "*" or x.endswith(":*") for x in acts): errs.append("%s/%s: wildcard action" % (a, s.get("Sid")))
        if "*" in res and s.get("Sid") != "Eni": errs.append("%s/%s: Resource * outside Eni" % (a, s.get("Sid")))
        if any(x != "*" and "staging" not in x for x in res): errs.append("%s/%s: a resource ARN without 'staging'" % (a, s.get("Sid")))
# allow file mirrors the plan exactly
creates = {a for a, rc in eff.items() if rc["change"]["actions"] == ["create"]}
if set(allow.get("changes", {})) != creates:
    errs.append("E10.staging.plan-allow.json address set != planned creates (missing: %s; stale: %s)" % (sorted(creates - set(allow["changes"]))[:5], sorted(set(allow["changes"]) - creates)[:5]))
outs = {k for k, v in (plan.get("output_changes") or {}).items() if v["actions"] != ["no-op"]}
if outs != set(allow.get("outputs", [])): errs.append("staging output_changes %s != allow outputs" % sorted(outs))
for e in errs: print("  - " + e, file=sys.stderr)
print("staging plan: %d creates, %d outputs" % (len(creates), len(outs)))
sys.exit(1 if errs else 0)
PY
# 4b. simulate the planned staging policies (read-only): allowed on staging ARNs, implicit deny on prod ARNs
sim() {  # doc action arn expected
  local d; d="$(aws iam simulate-custom-policy --policy-input-list "$(cat "$TMP/$1.json")" --action-names "$2" --resource-arns "$3" \
        --query 'EvaluationResults[0].EvalDecision' --output text 2>/dev/null || echo ERROR)"
  [ "$d" = "$4" ] || fail "simulate-custom-policy $1 $2 $3 → $d (want $4)"
}
Q_STG=arn:aws:sqs:ap-southeast-2:622994489535:developercards-publish-jobs-staging
Q_PROD=arn:aws:sqs:ap-southeast-2:622994489535:recallsmith-publish-jobs
sim core_vpc s3:PutObject     arn:aws:s3:::developercards-content-staging/content/x allowed
sim core_vpc sqs:SendMessage  "$Q_STG"                                              allowed
sim core_vpc s3:PutObject     arn:aws:s3:::core-vpc/content/x                       implicitDeny
sim core_vpc sqs:SendMessage  "$Q_PROD"                                             implicitDeny
sim core_vpc sqs:ReceiveMessage "$Q_STG"                                            implicitDeny
sim worker   sqs:ReceiveMessage "$Q_STG"                                            allowed
sim worker   s3:PutObject     arn:aws:s3:::developercards-premium-staging/x         allowed
sim worker   sqs:ReceiveMessage "$Q_PROD"                                           implicitDeny
sim worker   s3:PutObject     arn:aws:s3:::core-vpc-premium/x                       implicitDeny
sim worker   sqs:SendMessage  "$Q_STG"                                              implicitDeny
# 4c. the E00 checker on both plans with the worker's allow files (prints address/actions/keys only)
python3 infra/scripts/check-plan.py --plan "$TMP/staging.plan.json"   --allow "$ALLOW_STG"  || fail "check-plan.py rejects the staging plan"
python3 infra/scripts/check-plan.py --plan "$TMP/prod-head.plan.json" --allow "$ALLOW_PROD" || fail "check-plan.py rejects the prod plan"
# 4d. prod delta: HEAD vs merge-base = exactly the two client creates + the two outputs
python3 - "$TMP/prod-base.plan.json" "$TMP/prod-head.plan.json" <<'PY' || fail "prod plan delta is not exactly the two staging clients + two outputs"
import json, sys
def eff(p):
    d = {}
    for rc in p.get("resource_changes") or []:
        a = rc["change"]["actions"]
        if a == ["no-op"] or rc.get("mode", "managed") != "managed": continue
        keys = ()
        if a == ["update"]:
            b, af = rc["change"].get("before") or {}, rc["change"].get("after") or {}
            keys = tuple(sorted(k for k in set(b) | set(af) if b.get(k) != af.get(k)))
        d[rc["address"]] = (tuple(a), keys)
    return d
def outs(p): return {k: tuple(v["actions"]) for k, v in (p.get("output_changes") or {}).items() if v["actions"] != ["no-op"]}
base, head = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
eb, eh = eff(base), eff(head)
added = {a: v for a, v in eh.items() if eb.get(a) != v}
removed = {a: v for a, v in eb.items() if a not in eh}
EXP = {"module.identity.aws_cognito_user_pool_client.console_staging[0]": (("create",), ()),
       "module.identity.aws_cognito_user_pool_client.mobile_staging[0]": (("create",), ())}
errs = []
if added != EXP: errs.append("resource delta: added/changed %s" % {a: v[0] for a, v in added.items()})
if removed: errs.append("resource delta: removed %s" % {a: v[0] for a, v in removed.items()})
ob, oh = outs(base), outs(head)
oadd = {k for k, v in oh.items() if ob.get(k) != v}; orem = set(ob) - set(oh)
if oadd != {"console_staging_client_id", "mobile_staging_client_id"} or orem: errs.append("output delta: added %s removed %s" % (sorted(oadd), sorted(orem)))
for a, want in (("module.identity.aws_cognito_user_pool_client.console_staging[0]",
                 {"name": "console-staging", "user_pool_id": "ap-southeast-2_4Vf8uCXKt",
                  "callback_urls": ["https://console-staging.developercards.app/auth/callback"], "logout_urls": ["https://console-staging.developercards.app/"]}),
                ("module.identity.aws_cognito_user_pool_client.mobile_staging[0]",
                 {"name": "MobileDeveloperCards-staging", "user_pool_id": "ap-southeast-2_04hd6iisb", "access_token_validity": 60})):
    rc = next((r for r in head.get("resource_changes") or [] if r["address"] == a), None)
    after = (rc or {}).get("change", {}).get("after") or {}
    for k, v in want.items():
        if after.get(k) != v: errs.append("%s.%s = %r, want %r" % (a, k, after.get(k), v))
for e in errs: print("  - " + e, file=sys.stderr)
print("prod delta: +%d resources, +%d outputs" % (len(added), len(oadd)))
sys.exit(1 if errs else 0)
PY
rm -f "$TMP"/*.tfplan "$TMP"/*.plan.json

# ── 5. Scope + frozen + OTA + module-rule + apply-word guards ─────────────
echo "[5/5] scope + frozen + OTA guard"
# 5a. frozen mobile files, OTA manifest set, prod root files E10 may not touch, untouched modules, deploy.sh, tests, frontend
git diff --quiet "$MB" HEAD -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  || fail "frozen mobile file modified"
git diff --quiet "$MB" HEAD -- mobile/package.json mobile/package-lock.json mobile/app.json || fail "OTA manifest set modified"
grep -Fq '"version": "1.6.1"' mobile/app.json || fail "app.json version changed (OTA runtime 1.6.1)"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (next binary)"; fi
git diff --quiet "$MB" HEAD -- "$PROD/imports.tf" "$PROD/backend.tf" "$PROD/versions.tf" "$PROD/providers.tf" "$PROD/variables.tf" \
  "$PROD/prod.auto.tfvars.example" "$PROD/.terraform.lock.hcl" \
  infra/modules/data infra/modules/edge infra/modules/observability \
  infra/modules/identity/main.tf infra/modules/identity/policies.tf infra/modules/identity/ssm.tf \
  infra/scripts infra/bootstrap infra/RUNBOOK.md infra/.gitignore \
  src_C/deploy.sh src_C/env/prod.env.json src_C/scripts src_C/Vpc src_C/Worker src_C/Shared src_C/Tests \
  frontend mobile/src mobile/tests scripts .github site snowflake README.md \
  || fail "a file outside E10's write set changed (prod root files, untouched modules, deploy.sh, code, tests, frontend, mobile/src)"
# 5b. eas.json numstat 3/3 and the exact three lines each way
numstat="$(git diff --numstat "$MB" HEAD -- "$EAS" | cut -f1,2)"
[ "$numstat" = "$(printf '3\t3')" ] || fail "mobile/eas.json numstat must be '3 3', got '${numstat:-<no diff>}'"
added_eas="$(git diff -U0 "$MB" HEAD -- "$EAS" | grep -E '^\+[^+]' | sed 's/^+//' | sed 's/^[[:space:]]*//' | sort)"
[ "$added_eas" = "$(printf '%s\n' '"EXPO_PUBLIC_ENV": "staging"' '"channel": "staging",' '"environment": "preview",' | sort)" ] \
  || { printf '%s\n' "$added_eas" >&2; fail "eas.json: the three added lines must be exactly channel staging / environment preview / EXPO_PUBLIC_ENV staging"; }
removed_eas="$(git diff -U0 "$MB" HEAD -- "$EAS" | grep -E '^-[^-]' | sed 's/^-//' | sed 's/^[[:space:]]*//' | sort)"
[ "$removed_eas" = "$(printf '%s\n' '"EXPO_PUBLIC_ENV": "production"' '"channel": "production",' '"environment": "production",' | sort)" ] \
  || { printf '%s\n' "$removed_eas" >&2; fail "eas.json: the three removed lines must be the production values of the staging-internal-release profile"; }
# 5c. module-edit rules (R2): no count/for_each/moved/removed/import added under infra/modules except the two manage_cognito guards
MODADD="$(git diff -U0 "$MB" HEAD -- infra/modules | grep -E '^\+[^+]' | sed 's/^+//' || true)"
cnt="$(printf '%s\n' "$MODADD" | grep -Ec '^\s*(count|for_each)\s*=' || true)"
[ "$cnt" = "2" ] || fail "added count/for_each lines under infra/modules: $cnt (exactly the two manage_cognito guards of Changes 9)"
cog_cnt="$(git diff -U0 "$MB" HEAD -- "$COG" | grep -E '^\+\s*count\s*=\s*var\.manage_cognito \? 1 : 0\s*$' | wc -l | tr -d ' ')"
[ "$cog_cnt" = "2" ] || fail "cognito.tf must add exactly two 'count = var.manage_cognito ? 1 : 0' lines (got $cog_cnt)"
if printf '%s\n' "$MODADD" | grep -Eq '^\s*(moved|removed|import)\s*\{|provisioner|null_resource|local-exec|archive_file|terraform_remote_state|"external"'; then
  fail "forbidden construct added under infra/modules (moved/removed/import/provisioner/null_resource/local-exec/archive_file/remote_state)"
fi
if cat "$STG"/*.tf | grep -Eq '^\s*(moved|removed|import)\s*\{|provisioner|null_resource|local-exec|archive_file|terraform_remote_state|"external"'; then
  fail "forbidden construct in the staging root"
fi
# 5d. tracked artefacts that must never exist; no provider profile
tracked_bad="$(git ls-files infra | grep -E '\.(tfplan|plan\.json)$|generated.*\.tf$|[^e]\.auto\.tfvars$' || true)"
[ -z "$tracked_bad" ] || { echo "$tracked_bad" >&2; fail "plan / generated / real tfvars file tracked under infra"; }
if grep -rn 'profile *= *"' infra --include='*.tf' >/dev/null; then fail "provider profile set in infra"; fi
# 5e. every changed or untracked path is in E10's write set (pathspec-scoped untracked scan; node_modules is a symlink in driver worktrees)
outside="$( { git diff --name-only "$MB" HEAD; git ls-files --others --exclude-standard -- infra src_C/env src_C/scripts scripts mobile/eas.json mobile/src mobile/tests docs .github frontend/src frontend/tests site snowflake; } \
  | sort -u | grep -Ev '^(infra/envs/staging/(versions|providers|backend|variables|outputs|main)\.tf|infra/envs/staging/staging\.auto\.tfvars\.example|infra/envs/staging/\.terraform\.lock\.hcl|infra/envs/prod/(main|outputs)\.tf|infra/modules/identity/(cognito|outputs)\.tf|infra/modules/api/(variables|outputs|core_vpc|gateway|edge_public)\.tf|infra/modules/worker/(variables|queue|function)\.tf|infra/README\.md|src_C/env/staging\.env\.json|mobile/eas\.json|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside E10 scope"; }
grep -Eq '2026-[0-9]{2}-[0-9]{2}.*E10' infra/README.md || fail "infra/README.md §6 lacks E10's dated change-log line"
# 5f. no worker artefact carries the two-word apply/import commands or an aws create/update/delete/put phrase outside comments
if grep -Ev '^\s*(#|//)' "$ADDED" | grep -Eq 'terraform +(apply|import)([^a-z_-]|$)|aws +[a-z0-9-]+ +(create|update|delete|put)[a-z-]*'; then
  grep -Ev '^\s*(#|//)' "$ADDED" | grep -En 'terraform +(apply|import)([^a-z_-]|$)|aws +[a-z0-9-]+ +(create|update|delete|put)[a-z-]*' | head -5 >&2 || true
  fail "an added non-comment line spells a state-changing command (WORKER SAFETY RULE)"
fi

echo "E10 VERIFY OK"
