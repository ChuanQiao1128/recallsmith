#!/usr/bin/env bash
# E08 — gateway-and-cognito verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - docs/delivery/r16-issues/E08.plan-allow.json does not exist on base
#   (step 1 then also checks the E01..E07 prerequisites that live only on the
#   integration branch: infra/envs/prod/{main,imports}.tf, infra/scripts/check-plan.py,
#   the api/worker/identity module files, E04's access_log_settings, E05's
#   policies.tf, E06's ssm.tf, E07's Res.PayloadTooLarge — E00 §4 orders them first)
# Step 2 (literal guards: the mobile authorizer, the 19 route keys, the throttle
# values, reserved concurrency, MFA, token validity, the console-dev client, the
# wiring lines, the two removed import blocks, the canonical allow-list) would
# also fail on base. Step 3 is the infra root gate, step 4 the read-only
# read-only plan checked against the allow-list, step 5 a scope + frozen +
# OTA + apply guard; they pass on base by design and are never reached there.
#
# Network: step 4 needs AWS_PROFILE=dev credentials for a READ-ONLY plan against
# the committed S3 backend (`terraform init -reconfigure`, `plan -lock=false`:
# the state is read with s3:GetObject, never locked or written — the E04/E06
# recipe) plus the cached hashicorp/aws 6.66.0 provider in TF_PLUGIN_CACHE_DIR.
# Nothing is applied, nothing is imported by command, no state is written.
# Plan files live in a mktemp dir and are removed by the trap — they contain
# the functions' environment values in clear (E00 §0); only addresses, actions
# and booleans are ever printed. Runtime ≈ 2–4 min (the refresh dominates).
#
# The driver's diff-scoped term gate and suppression scan run separately; this
# script does not spell the six terms (E00 §0).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-e-prod}}"   # driver exports BASE
fail() { echo "E08 VERIFY FAIL: $*" >&2; exit 1; }

export TF_PLUGIN_CACHE_DIR="${TF_PLUGIN_CACHE_DIR:-$HOME/.terraform.d/plugin-cache}"
export AWS_PROFILE="${AWS_PROFILE:-dev}"
export TF_IN_AUTOMATION=1

ALLOW=docs/delivery/r16-issues/E08.plan-allow.json
BRIEF=docs/delivery/r16-issues/E08-gateway-and-cognito.md
SELF=docs/delivery/r16-issues/E08.verify.sh
GATEWAY=infra/modules/api/gateway.tf
CORE=infra/modules/api/core_vpc.tf
APIVARS=infra/modules/api/variables.tf
WORKERFN=infra/modules/worker/function.tf
COGNITO=infra/modules/identity/cognito.tf
IDOUT=infra/modules/identity/outputs.tf
MAIN=infra/envs/prod/main.tf
IMPORTS=infra/envs/prod/imports.tf
README=infra/README.md
CHECKER=infra/scripts/check-plan.py

MOBILE_ISSUER='https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_04hd6iisb'
MOBILE_CLIENT='7agirr7f56r9k5p6v6o63al1on'
CONSOLE_AUTHZ='828ehi'
CF_CALLBACK='https://d12pfy1rhi3ekm.cloudfront.net/auth/callback'
CF_LOGOUT='https://d12pfy1rhi3ekm.cloudfront.net/'
DEV_CALLBACK='http://localhost:5173/auth/callback'
DEV_LOGOUT='http://localhost:5173/'

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

MB="$(git merge-base "$BASE_REF" HEAD 2>/dev/null || git merge-base "origin/$BASE_REF" HEAD 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"

# Extract one top-level HCL block: from `resource "<type>" "<name>"` to the next line that is exactly `}`.
hcl_block() { awk -v hdr="$2" '$0 ~ hdr {p=1} p {print} p && /^}/ {exit}' "$1"; }

# ── 1. Scope file exists + prerequisites (FAILS ON BASE) ───────────────────
echo "[1/5] scope file exists (+ E01..E07 prerequisites)"
[ -f "$ALLOW" ] || fail "$ALLOW does not exist (base tree fails here)"
for f in "$MAIN" "$IMPORTS" "$CHECKER" "$GATEWAY" "$CORE" "$APIVARS" "$WORKERFN" "$COGNITO" "$IDOUT" "$README" \
         infra/envs/prod/.terraform.lock.hcl infra/modules/identity/policies.tf infra/modules/identity/ssm.tf; do
  [ -f "$f" ] || fail "$f is missing — E01..E07 must be merged before E08 (E00 §4)"
done
grep -Fq "access_log_settings" "$GATEWAY" || fail "gateway.tf lacks access_log_settings (E04 incomplete)"
grep -Fq "PayloadTooLarge" src_C/Shared/RecallSmith.Lambda.Common/Res.cs || fail "Res.cs lacks PayloadTooLarge (E07 incomplete)"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. gateway.tf — authorizers
for sym in 'resource "aws_apigatewayv2_authorizer" "console"' \
           '"cognito-jwt"' \
           'resource "aws_apigatewayv2_authorizer" "mobile"' \
           '"cognito-jwt-mobile"' \
           '"JWT"' \
           '"$request.header.Authorization"' \
           '"https://${var.mobile_pool_endpoint}"' \
           '[var.mobile_client_id]' \
           'authorization_type' \
           'authorizer_id' \
           'resource "aws_apigatewayv2_route" "this"' \
           'resource "aws_apigatewayv2_integration" "core_vpc"' \
           'resource "aws_apigatewayv2_integration" "edge_public"'; do
  grep -Fq -- "$sym" "$GATEWAY" || fail "gateway.tf lacks: $sym"
done
# 2b. gateway.tf — the 19 route keys (9 new + 10 adopted)
for rk in '"ANY /api/v1/authoring/{proxy+}"' '"ANY /api/v1/admin/{proxy+}"' '"ANY /api/v1/sync/{proxy+}"' \
          '"ANY /api/v1/draw-state/{proxy+}"' '"ANY /api/v1/user/{proxy+}"' '"ANY /api/v1/premium/{proxy+}"' \
          '"GET /api/v1/me"' '"GET /api/v1/entitlements"' '"GET /health"' \
          '"$default"' '"ANY /{proxy+}"' '"GET /api/v1/authoring/publish/jobs"' \
          '"GET /api/v1/content/premium-url"' '"GET /api/v1/content/premium-url-dev"' \
          '"POST /webhooks/revenuecat/production"' '"POST /webhooks/revenuecat/development"' \
          '"ANY /api/v1/ai/{proxy+}"' '"ANY /api/v1/billing/{proxy+}"' '"ANY /api/v1/admin/cognito/{proxy+}"'; do
  grep -Fq -- "$rk" "$GATEWAY" || fail "gateway.tf lacks route key $rk"
done
# 2c. gateway.tf — throttles (whitespace-tolerant), route_settings, depends_on on both stages
[ "$(grep -cE 'throttling_burst_limit[[:space:]]*=[[:space:]]*var\.(dev_)?throttling_burst_limit' "$GATEWAY")" -ge 2 ] || fail "both stages must keep throttling_burst_limit = var.* (no literal; 2026-09-23 incident)"
[ "$(grep -cE 'throttling_rate_limit[[:space:]]*=[[:space:]]*var\.(dev_)?throttling_rate_limit' "$GATEWAY")" -ge 2 ] || fail "both stages must keep throttling_rate_limit = var.* (no literal; 2026-09-23 incident)"
grep -Eq 'throttling_(burst|rate)_limit[[:space:]]*=[[:space:]]*[0-9]' "$GATEWAY" && fail "gateway.tf: numeric literal stage throttle (use the validated variables)"
[ "$(grep -c 'condition' "${GATEWAY%/*}/variables.tf")" -ge 4 ] || fail "api/variables.tf lost a throttle validation block"
throttle_pair() {  # $1 route key (fixed string), $2 burst, $3 rate — one entry per line (Changes 4)
  grep -F -- "\"$1\"" "$GATEWAY" | grep -Eq "burst[[:space:]]*=[[:space:]]*$2,[[:space:]]*rate[[:space:]]*=[[:space:]]*$3([^0-9]|$)" \
    || fail "gateway.tf lacks throttle entry: \"$1\" = { burst = $2, rate = $3 }"
}
throttle_pair 'ANY /api/v1/sync/{proxy+}' 40 20
throttle_pair 'ANY /api/v1/draw-state/{proxy+}' 40 20
throttle_pair 'POST /webhooks/revenuecat/production' 20 10
throttle_pair 'POST /webhooks/revenuecat/development' 10 5
grep -Fq 'route_throttles' "$GATEWAY" || fail "gateway.tf lacks local.route_throttles"
grep -Fq 'dynamic "route_settings"' "$GATEWAY" || fail "gateway.tf lacks the dynamic route_settings block"
[ "$(grep -cE 'depends_on[[:space:]]*=[[:space:]]*\[aws_apigatewayv2_route\.this\]' "$GATEWAY")" -ge 2 ] \
  || fail "both stages need depends_on = [aws_apigatewayv2_route.this] (routes must exist before RouteSettings)"
grep -Eq 'detailed_metrics_enabled[[:space:]]*=[[:space:]]*true' "$GATEWAY" || fail "E04's detailed_metrics_enabled = true went missing"
# 2d. the duplicate integrations are gone from config AND from imports.tf
if grep -rn 'core_vpc_dup' infra >/dev/null; then
  grep -rn 'core_vpc_dup' infra >&2 || true
  fail "core_vpc_dup must not appear anywhere under infra/ (resource block and its two import blocks are removed)"
fi
imp_ns="$(git diff --numstat "$MB" HEAD -- "$IMPORTS" | cut -f1,2)"
[ -n "$imp_ns" ] || fail "imports.tf must lose the two core_vpc_dup import blocks (no diff against the merge-base)"
[ "$(printf '%s' "$imp_ns" | cut -f1)" = "0" ] || fail "imports.tf must have zero added lines (numstat: $imp_ns)"
removed_ids="$(git diff -U0 "$MB" HEAD -- "$IMPORTS" | grep -E '^-[^-]' | grep -E '^\-[[:space:]]*id[[:space:]]*=' | sed -E 's/.*=[[:space:]]*"([^"]*)".*/\1/' | sort)"
[ "$removed_ids" = "$(printf 'ktbq1sie2c/a9dzpce\nktbq1sie2c/q8lfdrr')" ] \
  || { printf '%s\n' "$removed_ids" >&2; fail "imports.tf: the removed import ids must be exactly ktbq1sie2c/a9dzpce and ktbq1sie2c/q8lfdrr"; }
removed_to="$(git diff -U0 "$MB" HEAD -- "$IMPORTS" | grep -E '^-[^-]' | grep -E '^\-[[:space:]]*to[[:space:]]*=' | grep -c 'aws_apigatewayv2_integration.core_vpc_dup' || true)"
[ "$removed_to" = "2" ] || fail "imports.tf: exactly two 'to = …core_vpc_dup[…]' lines must be removed (got $removed_to)"
n_before="$(git show "$MB:$IMPORTS" | grep -c 'import {' || true)"
n_after="$(grep -c 'import {' "$IMPORTS" || true)"
[ "$n_after" = "$((n_before - 2))" ] || fail "imports.tf import-block count must drop by exactly 2 ($n_before -> $n_after)"
# 2e. reserved concurrency
grep -Eq 'reserved_concurrent_executions[[:space:]]*=[[:space:]]*40([^0-9]|$)' "$CORE"     || fail "core_vpc.tf lacks reserved_concurrent_executions = 40"
grep -Eq 'reserved_concurrent_executions[[:space:]]*=[[:space:]]*2([^0-9]|$)'  "$WORKERFN" || fail "worker/function.tf lacks reserved_concurrent_executions = 2"
grep -q 'reserved_concurrent_executions' infra/modules/api/edge_public.tf && fail "edge_public must not get reserved concurrency"
# 2f. cognito.tf — pool MFA, spa hardening, console-dev client, mobile pool untouched
for sym in 'resource "aws_cognito_user_pool" "console"' \
           'software_token_mfa_configuration' \
           'resource "aws_cognito_user_pool_client" "spa"' \
           'resource "aws_cognito_user_pool_client" "console_dev"' \
           '"console-dev"' \
           "\"$DEV_CALLBACK\"" \
           "\"$DEV_LOGOUT\"" \
           "\"$CF_CALLBACK\"" \
           "\"$CF_LOGOUT\"" \
           '"My SPA app - mrj1i9"' \
           'token_validity_units'; do
  grep -Fq -- "$sym" "$COGNITO" || fail "cognito.tf lacks: $sym"
done
pool_blk="$(hcl_block "$COGNITO" '^resource "aws_cognito_user_pool" "console"')"
printf '%s\n' "$pool_blk" | grep -Eq 'mfa_configuration[[:space:]]*=[[:space:]]*"ON"' || fail "console pool must set mfa_configuration = \"ON\""
printf '%s\n' "$pool_blk" | grep -Eq 'enabled[[:space:]]*=[[:space:]]*true'             || fail "console pool needs software_token_mfa_configuration { enabled = true }"
printf '%s\n' "$pool_blk" | grep -q 'sms_configuration' && fail "no SMS MFA on the console pool"
mobile_blk="$(hcl_block "$COGNITO" '^resource "aws_cognito_user_pool" "mobile"')"
[ -n "$mobile_blk" ] || fail "cognito.tf: mobile pool block not found (E00 §2.1.2 names it aws_cognito_user_pool.mobile[0])"
printf '%s\n' "$mobile_blk" | grep -Eq 'mfa_configuration[[:space:]]*=[[:space:]]*"(ON|OPTIONAL)"' && fail "mobile pool must keep MFA OFF (E00 §6 #2)"
printf '%s\n' "$mobile_blk" | grep -q 'software_token_mfa_configuration' && fail "mobile pool must not gain TOTP configuration (E00 §6 #2)"
for blk in spa console_dev; do
  b="$(hcl_block "$COGNITO" "^resource \"aws_cognito_user_pool_client\" \"$blk\"")"
  [ -n "$b" ] || fail "cognito.tf: client block $blk not found"
  printf '%s\n' "$b" | grep -Eq 'access_token_validity[[:space:]]*=[[:space:]]*1([^0-9]|$)'   || fail "$blk: access_token_validity = 1"
  printf '%s\n' "$b" | grep -Eq 'id_token_validity[[:space:]]*=[[:space:]]*1([^0-9]|$)'       || fail "$blk: id_token_validity = 1"
  printf '%s\n' "$b" | grep -Eq 'refresh_token_validity[[:space:]]*=[[:space:]]*30([^0-9]|$)' || fail "$blk: refresh_token_validity = 30"
  printf '%s\n' "$b" | grep -Eq 'access_token[[:space:]]*=[[:space:]]*"hours"'        || fail "$blk: token_validity_units.access_token = \"hours\""
  printf '%s\n' "$b" | grep -Eq 'id_token[[:space:]]*=[[:space:]]*"hours"'            || fail "$blk: token_validity_units.id_token = \"hours\""
  printf '%s\n' "$b" | grep -Eq 'refresh_token[[:space:]]*=[[:space:]]*"days"'        || fail "$blk: token_validity_units.refresh_token = \"days\""
  printf '%s\n' "$b" | grep -Eq 'allowed_oauth_flows[[:space:]]*=[[:space:]]*\["code"\]' || fail "$blk: allowed_oauth_flows = [\"code\"]"
  printf '%s\n' "$b" | grep -Eq 'generate_secret[[:space:]]*=[[:space:]]*true' && fail "$blk: public client, no secret"
done
spa_blk="$(hcl_block "$COGNITO" '^resource "aws_cognito_user_pool_client" "spa"')"
printf '%s\n' "$spa_blk" | grep -q 'localhost' && fail "spa client must carry no localhost URL after E08"
printf '%s\n' "$spa_blk" | grep -Fq "\"$CF_CALLBACK\"" || fail "spa callback_urls must keep the CloudFront callback"
dev_blk="$(hcl_block "$COGNITO" '^resource "aws_cognito_user_pool_client" "console_dev"')"
printf '%s\n' "$dev_blk" | grep -Fq "\"$DEV_CALLBACK\"" || fail "console_dev callback_urls must be the localhost callback"
printf '%s\n' "$dev_blk" | grep -q 'cloudfront' && fail "console_dev must not carry a CloudFront URL"
printf '%s\n' "$dev_blk" | grep -Eq 'count[[:space:]]*=[[:space:]]*var\.manage_cognito' || fail "console_dev must be count-guarded by var.manage_cognito"
grep -Fq 'output "console_dev_client_id"' "$IDOUT" || fail "identity/outputs.tf lacks output \"console_dev_client_id\""
# 2g. api variables + root wiring
grep -Fq 'variable "mobile_pool_endpoint"' "$APIVARS" || fail "api/variables.tf lacks variable \"mobile_pool_endpoint\""
grep -Fq 'variable "mobile_client_id"'     "$APIVARS" || fail "api/variables.tf lacks variable \"mobile_client_id\""
grep -Eq 'mobile_pool_endpoint[[:space:]]*=[[:space:]]*module\.identity\.mobile_pool_endpoint' "$MAIN" || fail "envs/prod/main.tf lacks mobile_pool_endpoint = module.identity.mobile_pool_endpoint"
grep -Eq 'mobile_client_id[[:space:]]*=[[:space:]]*module\.identity\.mobile_client_id'         "$MAIN" || fail "envs/prod/main.tf lacks mobile_client_id = module.identity.mobile_client_id"
# 2h. README §6 line
grep -Eq 'E08.*cognito-jwt-mobile' "$README" || fail "infra/README.md §6 needs a dated E08 line naming cognito-jwt-mobile"
# 2i. the committed allow-list equals the canonical one (parsed JSON, order-insensitive)
cat > "$TMP/allow.canonical.json" <<'JSON'
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
JSON
python3 - "$ALLOW" "$TMP/allow.canonical.json" <<'PY' || fail "E08.plan-allow.json is not byte-equivalent (as JSON) to the canonical allow-list in Changes 9"
import json, sys
got = json.load(open(sys.argv[1])); want = json.load(open(sys.argv[2]))
sys.exit(0 if got == want else 1)
PY
# 2j. Terraform hygiene, suppression, secret-leak
if grep -rEn 'provisioner[[:space:]]*"|local-exec|null_resource|archive_file|data[[:space:]]+"external"' infra --include='*.tf' >/dev/null; then
  grep -rEn 'provisioner[[:space:]]*"|local-exec|null_resource|archive_file|data[[:space:]]+"external"' infra --include='*.tf' >&2 || true
  fail "forbidden Terraform construct under infra/ (E00 §0)"
fi
grep -rn 'profile *= *"' infra --include='*.tf' && fail "no profile in any provider block (E00 §2.1)"
added_all="$(git diff -U0 "$MB" HEAD -- . ":(exclude)$BRIEF" ":(exclude)$SELF" | grep -E '^\+[^+]' | sed 's/^+//' || true)"
{ printf '%s\n' "$added_all"; cat "$ALLOW"; } | grep -Eq '\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable|#pragma warning disable' \
  && fail "test gutting / suppression found"
{ printf '%s\n' "$added_all"; cat "$ALLOW"; } | grep -Eq '(PGPASSWORD|MIGRATE_SECRET|INTERNAL_SHARED_SECRET|RC_WEBHOOK_AUTH_(PRODUCTION|DEVELOPMENT)|ANALYTICS_USER_SALT)[[:space:]]*[=:][[:space:]]*"[^"$P]' \
  && fail "secret-looking literal in an added line"
tracked_bad="$(git ls-files infra | grep -E '\.(tfplan|plan\.json)$|generated.*\.tf$|[^e]\.auto\.tfvars$' || true)"
[ -z "$tracked_bad" ] || { echo "$tracked_bad" >&2; fail "plan / generated / tfvars file tracked under infra/"; }
git diff --quiet "$MB" HEAD -- infra/envs/prod/.terraform.lock.hcl || fail ".terraform.lock.hcl changed (never upgraded inside the wave)"

# ── 3. Root gates ──────────────────────────────────────────────────────────
echo "[3/5] terraform fmt / init -backend=false / validate"
terraform fmt -check -recursive infra || fail "terraform fmt -check -recursive infra failed"
( cd infra/envs/prod && terraform init -backend=false -input=false >/dev/null && terraform validate && terraform fmt -check -recursive .. ) \
  || fail "infra root gate failed (init -backend=false / validate / fmt)"
python3 -m py_compile "$CHECKER" || fail "check-plan.py does not compile"
python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$ALLOW" || fail "$ALLOW is not valid JSON"

# ── 4. Read-only plan (real backend, -lock=false) → allow-list + shape assertions ──
# Same approach as E04.verify.sh / E06.verify.sh: the remote state is READ (s3:GetObject),
# never locked or written (-lock=false), so the plan is the supervisor's plan and the
# committed allow file applies verbatim. E01–E07 must be applied and their second plan empty.
echo "[4/5] terraform plan (read-only, real backend, -lock=false) -> check-plan.py + shape assertions"
aws sts get-caller-identity --query Account --output text >"$TMP/acct.txt" 2>&1 || fail "AWS credentials unavailable (export AWS_PROFILE=dev, read-only)"
[ "$(tr -d '[:space:]' <"$TMP/acct.txt")" = "622994489535" ] || fail "wrong AWS account for the plan"
ROOTDIR=infra/envs/prod
# Root variables without defaults are answered from the .example file; the two live-dependent
# ones (alert_email from the budget subscriber, snowflake_external_id from iam get-role) are
# replaced with the live values so no unlisted update appears. Written to $TMP only, never printed.
VARFILE="$TMP/e08.auto.tfvars"
if [ -f "$ROOTDIR/prod.auto.tfvars.example" ]; then cp "$ROOTDIR/prod.auto.tfvars.example" "$VARFILE"; else : > "$VARFILE"; fi
if grep -Fq 'variable "alert_email"' "$ROOTDIR/variables.tf" && [ -z "${TF_VAR_alert_email:-}" ]; then
  notif="$(aws budgets describe-notifications-for-budget --account-id 622994489535 --budget-name "My Monthly Cost Budget" --query 'Notifications[0]' --output json 2>/dev/null || true)"
  if [ -n "$notif" ] && [ "$notif" != "null" ]; then
    TF_VAR_alert_email="$(aws budgets describe-subscribers-for-notification --account-id 622994489535 --budget-name "My Monthly Cost Budget" --notification "$notif" --query 'Subscribers[?SubscriptionType==`EMAIL`]|[0].Address' --output text 2>/dev/null || true)"
  fi
  [ -n "${TF_VAR_alert_email:-}" ] && [ "$TF_VAR_alert_email" != "None" ] || unset TF_VAR_alert_email
fi
if [ -n "${TF_VAR_alert_email:-}" ]; then
  grep -v '^[[:space:]]*alert_email[[:space:]]*=' "$VARFILE" > "$VARFILE.tmp" || true; mv "$VARFILE.tmp" "$VARFILE"
  printf 'alert_email = "%s"\n' "$TF_VAR_alert_email" >> "$VARFILE"
fi
if grep -Fq 'variable "snowflake_external_id"' "$ROOTDIR/variables.tf" && [ -z "${TF_VAR_snowflake_external_id:-}" ]; then
  TF_VAR_snowflake_external_id="$(aws iam get-role --role-name snowflake-recallsmith-s3-role --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals."sts:ExternalId"' --output text 2>/dev/null || true)"
  [ -n "$TF_VAR_snowflake_external_id" ] && [ "$TF_VAR_snowflake_external_id" != "None" ] || unset TF_VAR_snowflake_external_id
fi
if [ -n "${TF_VAR_snowflake_external_id:-}" ]; then
  grep -v '^[[:space:]]*snowflake_external_id[[:space:]]*=' "$VARFILE" > "$VARFILE.tmp" || true; mv "$VARFILE.tmp" "$VARFILE"
  printf 'snowflake_external_id = "%s"\n' "$TF_VAR_snowflake_external_id" >> "$VARFILE"
fi
unset TF_VAR_alert_email TF_VAR_snowflake_external_id
( cd "$ROOTDIR" \
  && terraform init -input=false -reconfigure >/dev/null \
  && terraform plan -lock=false -input=false -refresh=true -var-file="$VARFILE" -out="$TMP/e08.tfplan" >"$TMP/plan.log" 2>&1 \
  && terraform show -json "$TMP/e08.tfplan" > "$TMP/e08.plan.json" ) \
  || { grep -E '^(Error|│ Error|Plan:)' "$TMP/plan.log" >&2 || true; fail "terraform init/plan/show failed (real backend, read-only; E01–E07 must be applied and their second plan empty)"; }
grep -E '^Plan:' "$TMP/plan.log" >&2 || true
python3 "$CHECKER" --plan "$TMP/e08.plan.json" --allow "$ALLOW" || fail "check-plan.py rejected the plan against the committed E08.plan-allow.json"
python3 - "$TMP/e08.plan.json" "$MOBILE_ISSUER" "$MOBILE_CLIENT" "$CONSOLE_AUTHZ" "$CF_CALLBACK" "$CF_LOGOUT" "$DEV_CALLBACK" "$DEV_LOGOUT" <<'PY' || fail "plan shape assertions failed (see the ASSERT lines above)"
import json, sys
plan = json.load(open(sys.argv[1]))
issuer, client, console_authz, cf_cb, cf_lo, dev_cb, dev_lo = sys.argv[2:9]
ok = True
def check(cond, msg):
    global ok
    if not cond:
        ok = False
        print("ASSERT FAIL:", msg)
rcs = {rc["address"]: rc["change"] for rc in plan.get("resource_changes", []) if rc.get("mode") != "data"}
eff = [a for a, c in rcs.items() if c["actions"] != ["no-op"]]
check(len(eff) == 29, f"expected 29 effective changes (11 create, 16 update, 2 delete), got {len(eff)}")
check(not any(c.get("importing") for c in rcs.values()), "a real-backend plan carries no importing entries (E01–E07 applied? backend initialised?)")
for dup in ("a9dzpce", "q8lfdrr"):
    addr = f'module.api.aws_apigatewayv2_integration.core_vpc_dup["{dup}"]'
    check(rcs.get(addr, {}).get("actions") == ["delete"], f"{addr} must be a delete (the duplicate integration goes)")
check(sum(1 for a in eff if rcs[a]["actions"] == ["create"]) == 11, "11 creates")
check(sum(1 for a in eff if rcs[a]["actions"] == ["update"]) == 16, "16 updates")
check(sum(1 for a in eff if rcs[a]["actions"] == ["delete"]) == 2, "2 deletes")
check(plan.get("output_changes", {}) == {} or all(v.get("actions") == ["no-op"] for v in plan.get("output_changes", {}).values()), "output_changes must be empty")
def after(addr):
    c = rcs.get(addr)
    check(c is not None, f"{addr} missing from plan")
    return (c or {}).get("after") or {}, (c or {}).get("after_unknown") or {}
# authorizer
a, _ = after("module.api.aws_apigatewayv2_authorizer.mobile")
check(a.get("name") == "cognito-jwt-mobile", "mobile authorizer name")
check(a.get("authorizer_type") == "JWT", "mobile authorizer type")
check(a.get("identity_sources") == ["$request.header.Authorization"], "mobile authorizer identity source")
jc = (a.get("jwt_configuration") or [{}])[0]
check(jc.get("issuer") == issuer, "mobile authorizer issuer must be the mobile pool")
check(jc.get("audience") == [client], "mobile authorizer audience must be the mobile client id")
a, _ = after("module.api.aws_apigatewayv2_authorizer.console")
check(a.get("name") == "cognito-jwt" and rcs["module.api.aws_apigatewayv2_authorizer.console"]["actions"] == ["no-op"], "console authorizer must stay no-op and named cognito-jwt")
# routes
core, edge = "integrations/ftkbtwn", "integrations/wf11obg"
table = {
  "default":            ("$default",                              core, "console"),
  "proxy":              ("ANY /{proxy+}",                         core, "console"),
  "authoring":          ("ANY /api/v1/authoring/{proxy+}",        core, "console"),
  "admin":              ("ANY /api/v1/admin/{proxy+}",            core, "console"),
  "publish_jobs":       ("GET /api/v1/authoring/publish/jobs",    core, "console"),
  "edge_ai":            ("ANY /api/v1/ai/{proxy+}",               edge, "console"),
  "edge_billing":       ("ANY /api/v1/billing/{proxy+}",          edge, "console"),
  "edge_admin_cognito": ("ANY /api/v1/admin/cognito/{proxy+}",    edge, "console"),
  "sync":               ("ANY /api/v1/sync/{proxy+}",             core, "mobile"),
  "draw_state":         ("ANY /api/v1/draw-state/{proxy+}",       core, "mobile"),
  "user":               ("ANY /api/v1/user/{proxy+}",             core, "mobile"),
  "premium":            ("ANY /api/v1/premium/{proxy+}",          core, "mobile"),
  "me":                 ("GET /api/v1/me",                        core, "mobile"),
  "entitlements":       ("GET /api/v1/entitlements",              core, "mobile"),
  "premium_url":        ("GET /api/v1/content/premium-url",       core, "mobile"),
  "premium_url_dev":    ("GET /api/v1/content/premium-url-dev",   core, "mobile"),
  "health":             ("GET /health",                           core, "none"),
  "rc_production":      ("POST /webhooks/revenuecat/production",  core, "none"),
  "rc_development":     ("POST /webhooks/revenuecat/development", core, "none"),
}
for key, (rk, target, auth) in table.items():
    addr = f'module.api.aws_apigatewayv2_route.this["{key}"]'
    a, u = after(addr)
    check(a.get("route_key") == rk, f"{key}: route_key")
    check(a.get("target") == target or u.get("target") is True, f"{key}: target must be {target}")
    if auth == "none":
        check(a.get("authorization_type") == "NONE" and not a.get("authorizer_id"), f"{key}: must be NONE with no authorizer")
    else:
        check(a.get("authorization_type") == "JWT", f"{key}: must be JWT")
        if auth == "console":
            check(a.get("authorizer_id") == console_authz, f"{key}: must use the console authorizer {console_authz}")
        else:
            check(u.get("authorizer_id") is True or (isinstance(a.get("authorizer_id"), str) and a.get("authorizer_id") not in ("", console_authz)),
                  f"{key}: must use the mobile authorizer (unknown at plan time or a new id)")
    check(not a.get("authorization_scopes"), f"{key}: no authorization_scopes")
# stages
want_rs = {("ANY /api/v1/sync/{proxy+}", 40, 20), ("ANY /api/v1/draw-state/{proxy+}", 40, 20),
           ("POST /webhooks/revenuecat/production", 20, 10), ("POST /webhooks/revenuecat/development", 10, 5)}
for st in ("default", "dev"):
    a, _ = after(f"module.api.aws_apigatewayv2_stage.{st}")
    d = (a.get("default_route_settings") or [{}])[0]
    want_d = {"default": (400, 200), "dev": (100, 50)}[st]
    check((d.get("throttling_burst_limit"), d.get("throttling_rate_limit")) == want_d, f"stage {st}: default throttle unchanged {want_d} (burst, rate) — validated variables, never 0")
    check(d.get("detailed_metrics_enabled") is True, f"stage {st}: detailed_metrics_enabled stays true (E04)")
    got_rs = {(r.get("route_key"), r.get("throttling_burst_limit"), int(r.get("throttling_rate_limit") or 0)) for r in (a.get("route_settings") or [])}
    check(got_rs == want_rs, f"stage {st}: route_settings must be exactly the four throttle entries")
    check(a.get("auto_deploy") is True and a.get("access_log_settings"), f"stage {st}: auto_deploy + access log kept")
# functions (only one scalar is read; nothing else from these entries is touched or printed)
a, _ = after("module.api.aws_lambda_function.core_vpc")
check(a.get("reserved_concurrent_executions") == 40, "core-vpc reserved concurrency 40")
a, _ = after("module.worker.aws_lambda_function.worker")
check(a.get("reserved_concurrent_executions") == 2, "worker reserved concurrency 2")
check(rcs.get("module.api.aws_lambda_function.edge_public", {}).get("actions") == ["no-op"], "edge-public must be no-op")
# cognito
a, _ = after("module.identity.aws_cognito_user_pool.console[0]")
check(a.get("mfa_configuration") == "ON", "console pool MFA ON")
check((a.get("software_token_mfa_configuration") or [{}])[0].get("enabled") is True, "console pool TOTP enabled")
check(not a.get("sms_configuration"), "console pool: no SMS configuration")
check(rcs.get("module.identity.aws_cognito_user_pool.mobile[0]", {}).get("actions") == ["no-op"], "mobile pool must be no-op")
check(rcs.get("module.identity.aws_cognito_user_pool_client.mobile[0]", {}).get("actions") == ["no-op"], "mobile client must be no-op")
check(rcs.get("module.identity.aws_cognito_user_group.editor[0]", {}).get("actions") == ["no-op"], "editor group must be no-op (role_arn stays as adopted)")
units = {"access_token": "hours", "id_token": "hours", "refresh_token": "days"}
for addr, cbs, los, name in (("module.identity.aws_cognito_user_pool_client.spa[0]", [cf_cb], [cf_lo], "My SPA app - mrj1i9"),
                             ("module.identity.aws_cognito_user_pool_client.console_dev[0]", [dev_cb], [dev_lo], "console-dev")):
    a, _ = after(addr)
    check(a.get("name") == name, f"{addr}: name")
    check(sorted(a.get("callback_urls") or []) == cbs, f"{addr}: callback_urls")
    check(sorted(a.get("logout_urls") or []) == los, f"{addr}: logout_urls")
    check(a.get("access_token_validity") == 1 and a.get("id_token_validity") == 1 and a.get("refresh_token_validity") == 30, f"{addr}: validity 1/1/30")
    check((a.get("token_validity_units") or [{}])[0] == units, f"{addr}: token_validity_units hours/hours/days")
    check(a.get("allowed_oauth_flows") == ["code"] and sorted(a.get("allowed_oauth_scopes") or []) == ["email", "openid", "profile"], f"{addr}: flows/scopes")
    check(not a.get("generate_secret"), f"{addr}: no client secret")
print("PLAN SHAPE OK", len(eff), "effective changes")
sys.exit(0 if ok else 1)
PY
rm -f "$TMP/e08.tfplan" "$TMP/e08.plan.json" "$TMP/plan.log" "$VARFILE" "$ROOTDIR/.terraform/terraform.tfstate"

# ── 5. Scope + frozen + OTA + apply guard ──────────────────────────────────
echo "[5/5] scope + frozen + OTA + apply guard"
git diff --quiet "$MB" HEAD -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  || fail "frozen mobile file modified"
git diff --quiet "$MB" HEAD -- mobile frontend src_C site .github snowflake scripts README.md \
  || fail "a code root changed — E08 is infra-only"
git diff --quiet "$MB" HEAD -- mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json || fail "OTA manifest set changed"
grep -Fq '"version": "1.6.1"' mobile/app.json || fail "app.json version changed (OTA runtime stays 1.6.1)"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (next binary, out of this wave)"; fi
outside="$( { git diff --name-only "$MB" HEAD; git ls-files --others --exclude-standard -- infra docs; } | sort -u \
  | grep -Ev '^(infra/modules/api/gateway\.tf|infra/modules/api/core_vpc\.tf|infra/modules/api/variables\.tf|infra/modules/api/main\.tf|infra/modules/worker/function\.tf|infra/modules/identity/cognito\.tf|infra/modules/identity/outputs\.tf|infra/envs/prod/main\.tf|infra/envs/prod/imports\.tf|infra/README\.md|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside E08 scope"; }
# 2026-09-26: E01 put the routes/integration_ids locals in api/main.tf; moving them into gateway.tf is allowed,
# but main.tf may only LOSE lines (no additions).
main_add="$(git diff --numstat "$MB" HEAD -- infra/modules/api/main.tf | awk '{print $1}')"
[ -z "$main_add" ] || [ "$main_add" = 0 ] || fail "infra/modules/api/main.tf may only lose lines (moved locals), got +$main_add"
# No worker artefact may carry an apply/import/mutating-CLI command outside a comment
# (the brief and this script are excluded: they quote the rule itself).
apply_hits="$(printf '%s\n' "$added_all" | grep -Ev '^[[:space:]]*(#|//)' | grep -En 'terraform +(apply|import)([^a-z]|$)|aws +[a-z0-9-]+ +(create|update|delete|put)-' || true)"
[ -z "$apply_hits" ] || { echo "$apply_hits" >&2; fail "an added line contains an apply / import / mutating AWS CLI command (supervisor-only)"; }

echo "E08 VERIFY OK"
