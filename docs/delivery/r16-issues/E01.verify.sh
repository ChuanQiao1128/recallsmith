#!/usr/bin/env bash
# E01 — terraform-adopt verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - infra/envs/prod/main.tf does not exist on base (there is no infra/ at all,
#     no *.tf anywhere in the tree)
# Step 2 (literal guards: backend.tf bytes, the 93 import addresses/ids, the
# curation rules, check-plan.py, the two driver files) would also fail on base.
# Step 3 is the infra root gate, step 4 the read-only plan against the live
# account (AWS_PROFILE=dev; ~2-4 min) checked twice (an independent inline
# check + the worker's check-plan.py, plus negative fixtures for the checker),
# step 5 the scope / frozen / OTA / apply guard.
#
# Network: terraform init downloads hashicorp/aws 6.66.0 once into
# TF_PLUGIN_CACHE_DIR; the plan reads ~93 resources (describe/get only).
# NOTHING here writes to AWS: no state bucket, no S3 backend init, no apply.
# The plan runs against an empty local state through a temporary
# backend_override.tf (E01 brief, gap 13) that this script creates and removes.
# Plan files live in a temp dir and are deleted by the trap; the plan text is
# never printed (Lambda environment values are not sensitive in the provider).
#
# The driver's diff-scoped term gate and suppression scan run separately; this
# script does not spell the six terms (E00 §0).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-e-prod}}"   # driver exports BASE
fail() { echo "E01 VERIFY FAIL: $*" >&2; exit 1; }

PROD=infra/envs/prod
MODS=infra/modules
OVERRIDE="$PROD/backend_override.tf"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/e01-verify.XXXXXX")"
cleanup() {
  rm -f "$TMP"/*.tfplan "$TMP"/*.plan.json 2>/dev/null || true
  rm -rf "$TMP"
  rm -f "$OVERRIDE"
  rm -rf "$PROD/.terraform"          # the driver's root gate re-inits from the plugin cache
}
trap cleanup EXIT
export TF_PLUGIN_CACHE_DIR="${TF_PLUGIN_CACHE_DIR:-$HOME/.terraform.d/plugin-cache}"
mkdir -p "$TF_PLUGIN_CACHE_DIR"
export TF_INPUT=0 TF_IN_AUTOMATION=1
export AWS_PROFILE="${AWS_PROFILE:-dev}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-southeast-2}"

has()  { grep -Fq -- "$1" "$2" || fail "$2 lacks '$1'"; }
hasE() { grep -Eq -- "$1" "$2" || fail "$2 lacks /$1/"; }
none() { if grep -En -- "$1" "$2" >/dev/null; then grep -En -- "$1" "$2" >&2 || true; fail "$2 must not contain /$1/"; fi; }
fcount() { grep -Fc -- "$1" "$2" || true; }

SCOPE_FILES=(
  infra/README.md infra/RUNBOOK.md infra/.gitignore infra/bootstrap/placeholder.zip infra/scripts/check-plan.py
  $PROD/versions.tf $PROD/providers.tf $PROD/backend.tf $PROD/variables.tf $PROD/outputs.tf $PROD/main.tf
  $PROD/imports.tf $PROD/prod.auto.tfvars.example $PROD/.terraform.lock.hcl
  $MODS/identity/main.tf $MODS/identity/variables.tf $MODS/identity/outputs.tf $MODS/identity/cognito.tf
  $MODS/data/main.tf $MODS/data/variables.tf $MODS/data/outputs.tf $MODS/data/rds.tf $MODS/data/buckets.tf $MODS/data/network.tf
  $MODS/edge/main.tf $MODS/edge/variables.tf $MODS/edge/outputs.tf $MODS/edge/cdn.tf $MODS/edge/console_bucket.tf
  $MODS/api/main.tf $MODS/api/variables.tf $MODS/api/outputs.tf $MODS/api/gateway.tf $MODS/api/core_vpc.tf $MODS/api/edge_public.tf
  $MODS/worker/main.tf $MODS/worker/variables.tf $MODS/worker/outputs.tf $MODS/worker/queue.tf $MODS/worker/function.tf
  $MODS/observability/main.tf $MODS/observability/variables.tf $MODS/observability/outputs.tf $MODS/observability/budget.tf
  docs/delivery/r16-issues/E01.imports.txt docs/delivery/r16-issues/E01.plan-allow.json
)
TEXT_FILES=()
for f in "${SCOPE_FILES[@]}"; do case "$f" in *.zip) ;; *) TEXT_FILES+=("$f");; esac; done

# The 93 adopted addresses (E00 §2.1.2), LC_ALL=C sort -u order — E01.imports.txt must equal this.
cat > "$TMP/imports.expected" <<'ADDR'
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
ADDR
[ "$(wc -l < "$TMP/imports.expected" | tr -d ' ')" = "93" ] || fail "internal: expected list is not 93 lines"

# Import ids (E00 §2.1.2) that must each appear as `id = "<id>"` in imports.tf.
cat > "$TMP/ids.expected" <<'IDS'
core-vpc-role-joizyiwt
core-vpc-role-joizyiwt/arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole
core-vpc-role-joizyiwt/arn:aws:iam::aws:policy/AmazonEC2FullAccess
core-vpc-role-joizyiwt/arn:aws:iam::aws:policy/AmazonRDSFullAccess
core-vpc-role-joizyiwt/arn:aws:iam::aws:policy/AmazonSQSFullAccess
core-vpc-role-joizyiwt/arn:aws:iam::aws:policy/AmazonS3FullAccess
core-vpc-role-joizyiwt/arn:aws:iam::622994489535:policy/service-role/AWSLambdaBasicExecutionRole-033fad1a-ba7b-4152-ba28-7cf61f0c3423
core-vpc-role-joizyiwt/arn:aws:iam::622994489535:policy/service-role/AWSLambdaVPCAccessExecutionRole-0916ae0e-b0bc-43bf-9827-cf383da694db
arn:aws:iam::622994489535:policy/service-role/AWSLambdaBasicExecutionRole-033fad1a-ba7b-4152-ba28-7cf61f0c3423
arn:aws:iam::622994489535:policy/service-role/AWSLambdaVPCAccessExecutionRole-0916ae0e-b0bc-43bf-9827-cf383da694db
edge-public-role-zezx326f
edge-public-role-zezx326f:edge-public-cognito
arn:aws:iam::622994489535:policy/service-role/AWSLambdaBasicExecutionRole-4587d025-3600-45c8-9409-a1ead0afc685
edge-public-role-zezx326f/arn:aws:iam::622994489535:policy/service-role/AWSLambdaBasicExecutionRole-4587d025-3600-45c8-9409-a1ead0afc685
snowflake-recallsmith-s3-role
arn:aws:iam::622994489535:policy/snowflake-recallsmith-s3-read
snowflake-recallsmith-s3-role/arn:aws:iam::622994489535:policy/snowflake-recallsmith-s3-read
snowflake-recallsmith-s3-role/arn:aws:iam::aws:policy/AmazonS3FullAccess
rds-monitoring-role
rds-monitoring-role/arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole
ap-southeast-2_4Vf8uCXKt
ap-southeast-2_4Vf8uCXKt/6lkofepp2llp6v4nueg52mcm5v
ap-southeast-2_4Vf8uCXKt/super_admin
ap-southeast-2_4Vf8uCXKt/editor
ap-southeast-24vf8ucxkt
ap-southeast-2_04hd6iisb
ap-southeast-2_04hd6iisb/7agirr7f56r9k5p6v6o63al1on
ap-southeast-204hd6iisb
developercards
default-vpc-04af44dd8f5f48717
core-vpc
core-vpc-premium
E28BKORJLV6UXG
E85FKUMZZWQWX
E2O3Q2DB6GEBDD
E13T84KBR8KQT6
0ee57e07-7ee4-4953-8eac-e784c14e198c/CreatedByCloudFront-fbfe7e00/CLOUDFRONT
recallsmith-console-622994489535
ktbq1sie2c
ktbq1sie2c/ftkbtwn
ktbq1sie2c/a9dzpce
ktbq1sie2c/q8lfdrr
ktbq1sie2c/wf11obg
ktbq1sie2c/2zt7dan
ktbq1sie2c/xhcsm7a
ktbq1sie2c/3o410l1
ktbq1sie2c/cz7p5uo
ktbq1sie2c/ymw0s2h
ktbq1sie2c/daeaq4a
ktbq1sie2c/jsyx1bu
ktbq1sie2c/6lnq0za
ktbq1sie2c/w6hhydi
ktbq1sie2c/l803chb
ktbq1sie2c/828ehi
ktbq1sie2c/$default
ktbq1sie2c/dev
core-vpc/prod
/aws/lambda/core-vpc
core-vpc/ddf85795-8ac8-5e4f-b13e-1305b00a3ba7
core-vpc/03c93ce4-7246-50e0-8573-a01d7e580e55
core-vpc/apigw-httpapi-ktbq1sie2c
core-vpc/03895359-3cb1-5e36-9663-2926d577d284
core-vpc/8707b68d-997f-507d-8399-9bc17c4970d0
core-vpc/bf0bd0f4-d44d-5e2f-9852-8c2a30bbc9af
core-vpc/810b76d6-7b95-567b-ac2b-5ffc1e5be696
core-vpc/1e1ab4f0-3e8d-5448-b856-e0981ab47ffc
core-vpc/b22050a3-bad0-5ea2-a108-a21be6a9f3c0
edge-public
/aws/lambda/edge-public
edge-public/3249e15a-5957-5b6d-b271-1c7d73f1c800
edge-public/666d2528-5c6a-5fce-a7e9-4bbcaae132a9
edge-public/70ec633b-6621-5c8b-9278-9ba3d2987025
https://sqs.ap-southeast-2.amazonaws.com/622994489535/recallsmith-publish-jobs
worker-lambda
worker-lambda/prod
29e34447-aedd-45cf-8cab-c6ca9ad94f2f
/aws/lambda/worker-lambda
622994489535:My Monthly Cost Budget
IDS

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist"
[ -f "$PROD/main.tf" ] || fail "$PROD/main.tf does not exist (base tree fails here: no infra/ on base)"
for f in "${SCOPE_FILES[@]}"; do
  [ -f "$f" ] || fail "$f does not exist"
done
command -v terraform >/dev/null || fail "terraform not on PATH (1.16.x required)"
command -v python3   >/dev/null || fail "python3 not on PATH"
command -v aws       >/dev/null || fail "aws CLI not on PATH"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# Attribute assignments are compared on a normalised mirror of every .tf file (terraform fmt aligns
# `=` per block, so `name   = "x"` and `name = "x"` must read the same); byte-exact files stay raw.
NR="$TMP/norm"
while IFS= read -r f; do
  mkdir -p "$NR/$(dirname "$f")"
  sed -E 's/^([[:space:]]*)([A-Za-z_][A-Za-z0-9_.-]*|"[^"]*")[[:space:]]*=[[:space:]]*([^=[:space:]])/\1\2 = \3/' "$f" > "$NR/$f"
done < <(find infra -name '*.tf' -not -path '*/.terraform/*')
# 2a. backend.tf byte for byte (E00 §0)
cat > "$TMP/backend.expected" <<'HCL'
terraform {
  backend "s3" {
    bucket       = "recallsmith-tfstate-622994489535"
    key          = "envs/prod/terraform.tfstate"
    region       = "ap-southeast-2"
    encrypt      = true
    use_lockfile = true
  }
}
HCL
diff -u "$TMP/backend.expected" "$PROD/backend.tf" >&2 || fail "backend.tf is not byte-identical to E00 §0"
# 2b. versions / providers / lock
has 'required_version = ">= 1.10"' "$NR/$PROD/versions.tf"
has 'source = "hashicorp/aws"'     "$NR/$PROD/versions.tf"
has 'version = "~> 6.0"'           "$NR/$PROD/versions.tf"
has 'region = "ap-southeast-2"'    "$NR/$PROD/providers.tf"
has 'alias = "use1"'               "$NR/$PROD/providers.tf"
has 'region = "us-east-1"'         "$NR/$PROD/providers.tf"
[ "$(grep -Ec '^provider "aws"' "$NR/$PROD/providers.tf")" = "2" ] || fail "providers.tf must hold exactly two provider blocks"
none 'default_tags' "$NR/$PROD/providers.tf"
hasE '^\s*version\s*=\s*"6\.66\.0"'     "$PROD/.terraform.lock.hcl"
hasE '^\s*constraints\s*=\s*"~> 6\.0"' "$PROD/.terraform.lock.hcl"
[ "$(grep -c 'h1:' "$PROD/.terraform.lock.hcl" || true)" -ge 2 ] || fail ".terraform.lock.hcl needs h1: hashes for darwin_arm64 and linux_amd64"
if grep -rn 'profile *= *"' infra --include=*.tf >&2; then fail "a provider block carries a profile (E00 §0)"; fi
# 2c. .gitignore (nine lines) + placeholder.zip + tfvars example
for l in '.terraform/' '*.tfplan' '*.plan.json' 'generated*.tf' '*.auto.tfvars' '!*.auto.tfvars.example' 'crash.log' 'backend_override.tf' '__pycache__/'; do
  grep -Fxq -- "$l" infra/.gitignore || fail "infra/.gitignore lacks the line '$l'"
done
python3 - infra/bootstrap/placeholder.zip <<'PY' || fail "placeholder.zip must hold exactly one 0-byte entry named README"
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
names = z.namelist()
assert names == ["README"], names
assert z.getinfo("README").file_size == 0
PY
has 'snowflake_external_id = "REPLACE_ME"' "$PROD/prod.auto.tfvars.example"
has 'aws iam get-role --role-name snowflake-recallsmith-s3-role' "$PROD/prod.auto.tfvars.example"
# 2d. root variables / outputs / main wiring
for v in account_id region vpc_id subnet_ids core_vpc_security_group_ids worker_security_group_ids rds_security_group_ids console_pool_id mobile_pool_id cors_allowed_origins snowflake_external_id; do
  has "variable \"$v\"" "$NR/$PROD/variables.tf"
done
has 'sensitive = true' "$NR/$PROD/variables.tf"
for lit in '"622994489535"' '"ap-southeast-2"' '"vpc-04af44dd8f5f48717"' '"subnet-0cc7a99faf631cee2"' '"subnet-0dd0ac42e1bb9648a"' '"subnet-0a365ac32e28958ed"' \
           '"sg-00ad6c62d292a475e"' '"sg-04af3c6fa45f10113"' '"sg-0d2541aec08b1a215"' '"sg-0fbc6607e6473cbd3"' \
           '"ap-southeast-2_4Vf8uCXKt"' '"ap-southeast-2_04hd6iisb"' '"http://localhost:5173"' '"https://d12pfy1rhi3ekm.cloudfront.net"' \
           '"core-vpc-role-joizyiwt"' '"edge-public-role-zezx326f"' '"developercards"' '"default-vpc-04af44dd8f5f48717"' '"core-vpc"' '"core-vpc-premium"' \
           '"recallsmith-console-622994489535"' '"developercards-api"' '"prod"' '"edge-public"' '"recallsmith-publish-jobs"' '"worker-lambda"' '"My Monthly Cost Budget"' '"20"'; do
  grep -rFq -- "$lit" "$PROD"/variables.tf "$PROD"/main.tf || fail "$lit not found in $PROD/variables.tf or main.tf"
done
for o in api_id api_endpoint content_distribution_id content_domain_name console_distribution_id console_domain_name core_vpc_alias_arn worker_alias_arn queue_url db_address console_pool_endpoint mobile_pool_endpoint; do
  has "output \"$o\"" "$NR/$PROD/outputs.tf"
done
[ "$(grep -Ec '^output "' "$NR/$PROD/outputs.tf")" = "12" ] || fail "outputs.tf must declare exactly the twelve root outputs"
for m in identity data edge api worker observability; do has "module \"$m\"" "$NR/$PROD/main.tf"; done
[ "$(grep -Ec '^module "' "$NR/$PROD/main.tf")" = "6" ] || fail "main.tf must hold exactly six module blocks"
has 'aws.use1 = aws.use1'  "$NR/$PROD/main.tf"
has 'manage_cognito = true' "$NR/$PROD/main.tf"
[ "$(fcount 'env = "prod"' "$NR/$PROD/main.tf")" = "6" ] || fail "main.tf must pass env = \"prod\" to all six modules"
none '^\s*tags\s*=' "$NR/$PROD/main.tf"
# 2e. imports.tf: 93 blocks, every address, every id, no provider line
sed -E 's/[[:space:]]+/ /g' "$PROD/imports.tf" > "$TMP/imports.norm"
[ "$(grep -Ec '^\s*import\s*\{' "$PROD/imports.tf")" = "93" ] || fail "imports.tf must hold exactly 93 import blocks"
while IFS= read -r addr; do
  grep -Fq -- "to = $addr" "$TMP/imports.norm" || fail "imports.tf lacks 'to = $addr'"
done < "$TMP/imports.expected"
while IFS= read -r id; do
  grep -Fq -- "id = \"$id\"" "$TMP/imports.norm" || fail "imports.tf lacks id \"$id\""
done < "$TMP/ids.expected"
[ "$(fcount 'id = "core-vpc"' "$TMP/imports.norm")" = "7" ]                          || fail "imports.tf: id \"core-vpc\" must appear 7 times (5 bucket set + policy + function)"
[ "$(fcount 'id = "core-vpc-premium"' "$TMP/imports.norm")" = "5" ]                  || fail "imports.tf: id \"core-vpc-premium\" must appear 5 times"
[ "$(fcount 'id = "recallsmith-console-622994489535"' "$TMP/imports.norm")" = "6" ]  || fail "imports.tf: id \"recallsmith-console-622994489535\" must appear 6 times"
has '# E01 adoption set' "$NR/$PROD/imports.tf"
# 2f. module interfaces (E00 §2.1.1)
check_iface() {  # module vars outputs
  local m="$1" v o
  for v in $2; do has "variable \"$v\"" "$NR/$MODS/$m/variables.tf"; done
  for o in $3; do has "output \"$o\"" "$NR/$MODS/$m/outputs.tf"; done
  has 'source = "hashicorp/aws"' "$NR/$MODS/$m/main.tf"
}
check_iface identity "env account_id region core_vpc_role_name edge_public_role_name manage_cognito console_pool_id mobile_pool_id snowflake_external_id tags" \
  "core_vpc_role_arn core_vpc_role_name edge_public_role_arn snowflake_role_arn rds_monitoring_role_arn console_pool_endpoint console_client_id mobile_pool_endpoint mobile_client_id"
check_iface data "env db_identifier db_subnet_group_name content_bucket_name premium_bucket_name vpc_id subnet_ids lambda_security_group_ids rds_security_group_ids rds_monitoring_role_arn tags" \
  "db_instance_arn db_address content_bucket_arn content_bucket_regional_domain_name premium_bucket_arn subnet_ids lambda_security_group_ids"
check_iface edge "env content_bucket_name content_bucket_arn content_bucket_regional_domain_name console_bucket_name core_vpc_role_arn tags" \
  "content_distribution_id content_distribution_arn content_domain_name console_distribution_id console_domain_name"
check_iface api "env api_name core_vpc_function_name core_vpc_alias_name core_vpc_role_arn edge_public_function_name edge_public_role_arn subnet_ids security_group_ids console_pool_endpoint console_client_id cors_allowed_origins tags" \
  "api_id api_execution_arn api_endpoint stage_names core_vpc_function_arn core_vpc_alias_arn core_vpc_log_group_name edge_public_function_arn"
check_iface worker "env queue_name function_name alias_name role_arn subnet_ids security_group_ids tags" \
  "queue_arn queue_url function_arn alias_arn log_group_name"
check_iface observability "env account_id budget_name budget_limit tags" "budget_name"
has 'configuration_aliases = [aws.use1]' "$NR/$MODS/edge/main.tf"
# 2g. curation rules (E00 §2.1.4 + brief gaps 1, 11)
for f in "$NR/$MODS/api/core_vpc.tf" "$NR/$MODS/api/edge_public.tf" "$NR/$MODS/worker/function.tf"; do
  has 'filename = "${path.module}/../../bootstrap/placeholder.zip"' "$f"
  has 'ignore_changes = [filename, source_code_hash, s3_bucket, s3_key, s3_object_version, publish, environment, description]' "$f"
  none '^\s*(code_sha256|skip_destroy|publish|s3_bucket|s3_key|s3_object_version|image_uri|replace_security_groups_on_destroy|use_resource_timeout_for_propagation)\s*=' "$f"
done
for f in "$NR/$MODS/api/core_vpc.tf" "$NR/$MODS/worker/function.tf"; do has 'ignore_changes = [function_version, description]' "$f"; done
has 'ignore_changes = [metrics_config]' "$NR/$MODS/worker/function.tf"
none '^\s*(starting_position|parallelization_factor|maximum_record_age_in_seconds|maximum_retry_attempts|tumbling_window_in_seconds|queues|topics)\s*=' "$NR/$MODS/worker/function.tf"
none '^\s*metrics_config\s*\{' "$NR/$MODS/worker/function.tf"
has 'scaling_config' "$NR/$MODS/worker/function.tf"
has 'maximum_batching_window_in_seconds = 60' "$NR/$MODS/worker/function.tf"
has 'visibility_timeout_seconds = 300' "$NR/$MODS/worker/queue.tf"
none 'redrive_policy' "$NR/$MODS/worker/queue.tf"
has 'name = "cognito-jwt"' "$NR/$MODS/api/gateway.tf"
has 'authorization_type = "NONE"' "$NR/$MODS/api/gateway.tf"
has 'disable_execute_api_endpoint = false' "$NR/$MODS/api/gateway.tf"
has 'for_each = local.routes' "$NR/$MODS/api/gateway.tf"
has 'route_selection_expression = "$request.method $request.path"' "$NR/$MODS/api/gateway.tf"
none 'deployment_id' "$NR/$MODS/api/gateway.tf"
for k in default proxy publish_jobs premium_url premium_url_dev rc_production rc_development edge_ai edge_billing edge_admin_cognito; do
  grep -Eq "^\s*$k\s*=\s*\{" "$NR/$MODS/api/main.tf" "$NR/$MODS/api/gateway.tf" || fail "route key '$k' missing from local.routes"
done
for sid in ddf85795-8ac8-5e4f-b13e-1305b00a3ba7 03c93ce4-7246-50e0-8573-a01d7e580e55 apigw-httpapi-ktbq1sie2c 03895359-3cb1-5e36-9663-2926d577d284 8707b68d-997f-507d-8399-9bc17c4970d0 bf0bd0f4-d44d-5e2f-9852-8c2a30bbc9af 810b76d6-7b95-567b-ac2b-5ffc1e5be696 1e1ab4f0-3e8d-5448-b856-e0981ab47ffc b22050a3-bad0-5ea2-a108-a21be6a9f3c0 3249e15a-5957-5b6d-b271-1c7d73f1c800 666d2528-5c6a-5fce-a7e9-4bbcaae132a9 70ec633b-6621-5c8b-9278-9ba3d2987025; do
  grep -rFq -- "\"$sid\"" "$NR/$MODS/api/main.tf" "$NR/$MODS/api/core_vpc.tf" "$NR/$MODS/api/edge_public.tf" || fail "permission SID $sid missing from the api module"
done
has 'arn:aws:execute-api:ap-southeast-2:622994489535:ktbq1sie2c/*/*/*' "$NR/$MODS/api/main.tf"
hasE 'engine_version\s*=\s*"17\.9"'                                    "$NR/$MODS/data/rds.tf"
hasE 'skip_final_snapshot\s*=\s*false'                                  "$NR/$MODS/data/rds.tf"
hasE 'final_snapshot_identifier\s*=\s*"developercards-final-tf"'        "$NR/$MODS/data/rds.tf"
hasE 'apply_immediately\s*=\s*false'                                    "$NR/$MODS/data/rds.tf"
hasE 'deletion_protection\s*=\s*false'                                  "$NR/$MODS/data/rds.tf"
hasE 'backup_retention_period\s*=\s*7'                                  "$NR/$MODS/data/rds.tf"
has  'prevent_destroy = true'                                           "$NR/$MODS/data/rds.tf"
has  'data.aws_kms_alias.rds.target_key_arn'                            "$NR/$MODS/data/rds.tf"
none '^\s*(domain_dns_ips|password|password_wo|password_wo_version|manage_master_user_password|allow_major_version_upgrade|delete_automated_backups|snapshot_identifier|restore_to_point_in_time|replicate_source_db|username|db_name|timezone|character_set_name)\s*=' "$NR/$MODS/data/rds.tf"
[ "$(fcount 'status = "Disabled"' "$NR/$MODS/data/buckets.tf")" = "2" ]        || fail "buckets.tf: versioning status \"Disabled\" must appear exactly twice"
[ "$(fcount 'status = "Disabled"' "$NR/$MODS/edge/console_bucket.tf")" = "1" ] || fail "console_bucket.tf: versioning status \"Disabled\" must appear once"
[ "$(fcount 'prevent_destroy = true' "$NR/$MODS/data/buckets.tf")" = "2" ]     || fail "buckets.tf: prevent_destroy must appear exactly twice (content, premium)"
[ "$(fcount 'prevent_destroy = true' "$NR/$MODS/edge/console_bucket.tf")" = "0" ] || fail "console_bucket.tf: no prevent_destroy (E00 §2.1.1)"
none 'aws_s3_bucket_policy' "$NR/$MODS/data/buckets.tf"
has 'aws_s3_bucket_policy" "content"' "$NR/$MODS/edge/cdn.tf"
has 'AllowCloudFrontOACReadOnly' "$NR/$MODS/edge/cdn.tf"
has 'AllowCoreVpcLambdaWriteContent' "$NR/$MODS/edge/cdn.tf"
has 'AllowCloudFrontOAC' "$NR/$MODS/edge/console_bucket.tf"
has 'provider = aws.use1'        "$NR/$MODS/edge/cdn.tf"
has 'scope = "CLOUDFRONT"'       "$NR/$MODS/edge/cdn.tf"
has 'name = "CreatedByCloudFront-fbfe7e00"' "$NR/$MODS/edge/cdn.tf"
has 'description = ""'           "$NR/$MODS/edge/cdn.tf"
has 'description = "Created by CloudFront"' "$NR/$MODS/edge/cdn.tf"
has 'web_acl_id = aws_wafv2_web_acl.content.arn' "$NR/$MODS/edge/cdn.tf"
has 'default_root_object = "index.html"' "$NR/$MODS/edge/cdn.tf"
[ "$(grep -c 'path = "/service-role/"' "$NR/$MODS/identity/main.tf" || true)" -ge 2 ] || fail "identity/main.tf: core_vpc and edge_public roles need path \"/service-role/\""
has 'name = "rds-monitoring-role"' "$NR/$MODS/identity/main.tf"
has 'name = "edge-public-cognito"' "$NR/$MODS/identity/main.tf"
has 'for_each = local.core_vpc_attachments' "$NR/$MODS/identity/main.tf"
for k in sqs_exec ec2_full rds_full sqs_full s3_full logs vpc; do grep -Eq "^\s*$k\s*=" "$NR/$MODS/identity/main.tf" || fail "core_vpc_attachments lacks key $k"; done
has '"sts:ExternalId" = var.snowflake_external_id' "$NR/$MODS/identity/main.tf"
has 'var.snowflake_external_id == null ? null : aws_iam_role.snowflake.arn' "$NR/$MODS/identity/outputs.tf"
has 'cognito-idp.${var.region}.amazonaws.com/${var.console_pool_id}' "$NR/$MODS/identity/outputs.tf"
[ "$(fcount 'count = var.manage_cognito ? 1 : 0' "$NR/$MODS/identity/cognito.tf")" -ge 8 ] || fail "cognito.tf: all eight Cognito resources must be count-guarded on var.manage_cognito"
has 'domain = "ap-southeast-24vf8ucxkt"' "$NR/$MODS/identity/cognito.tf"
has 'domain = "ap-southeast-204hd6iisb"' "$NR/$MODS/identity/cognito.tf"
has 'developercards-api-role-l4jacdsb' "$NR/$MODS/identity/cognito.tf"
none 'user_pool_id\s*=\s*"ap-southeast' "$NR/$MODS/identity/cognito.tf"
has 'data "aws_vpc" "main"' "$NR/$MODS/data/network.tf"
has 'data "aws_kms_alias" "rds"' "$NR/$MODS/data/network.tf"
has 'limit_amount = var.budget_limit' "$NR/$MODS/observability/budget.tf"
[ "$(grep -c 'notification {' "$NR/$MODS/observability/budget.tf" || true)" = "3" ] || fail "budget.tf must keep the three notifications"
# 2h. forbidden constructs anywhere under infra (E00 §0, §2.1.4)
tf_all="$(find infra -name '*.tf' -not -path '*/.terraform/*' | sort)"
for pat in '^\s*tags(_all)?\s*=' 'default_tags' '^\s*environment\s*\{' 'provisioner' 'local-exec' 'null_resource' 'archive_file' 'terraform_remote_state' 'data "external"' 'terraform_data'; do
  # shellcheck disable=SC2086
  if grep -En -- "$pat" $tf_all >&2; then fail "forbidden construct /$pat/ under infra (E00 §0 / §2.1.4)"; fi
done
# 2i. check-plan.py: compiles, stdlib only, contract strings
python3 -c 'import py_compile, sys; py_compile.compile(sys.argv[1], cfile=sys.argv[2], doraise=True)' infra/scripts/check-plan.py "$TMP/check-plan.pyc" || fail "check-plan.py does not compile"
if grep -En '^\s*(import|from)\s+' infra/scripts/check-plan.py | grep -Ev '^\S+:\s*(import|from)\s+(argparse|json|sys|os|re|typing|collections|__future__)\b' >&2; then fail "check-plan.py must import stdlib only"; fi
for s in '--plan' '--allow' '--expect-imports' '--summary' 'tags_only_updates' 'expect_imports' 'resource_changes' 'output_changes' 'importing' 'PLAN OK' 'PLAN EMPTY' 'PLAN VIOLATION' '"data"'; do
  has "$s" infra/scripts/check-plan.py
done
# 2j. driver files pinned
diff -u "$TMP/imports.expected" docs/delivery/r16-issues/E01.imports.txt >&2 || fail "E01.imports.txt differs from the 93 addresses of E00 §2.1.2"
python3 - docs/delivery/r16-issues/E01.plan-allow.json <<'PY' || fail "E01.plan-allow.json is not the pinned object (brief change 10.2)"
import json, sys
a = json.load(open(sys.argv[1]))
assert a["tags_only_updates"] is False
assert a["expect_imports"] == "docs/delivery/r16-issues/E01.imports.txt"
assert sorted(a["outputs"]) == sorted(["api_id", "api_endpoint", "content_distribution_id", "content_domain_name", "console_distribution_id", "console_domain_name", "core_vpc_alias_arn", "worker_alias_arn", "queue_url", "db_address", "console_pool_endpoint", "mobile_pool_endpoint"])
assert list(a["changes"].keys()) == ["module.data.aws_db_instance.developercards"]
c = a["changes"]["module.data.aws_db_instance.developercards"]
assert c["action"] == "update"
assert sorted(c["keys"]) == ["apply_immediately", "final_snapshot_identifier", "skip_final_snapshot"]
assert set(a.keys()) == {"tags_only_updates", "expect_imports", "outputs", "changes"}
PY
# 2k. README / RUNBOOK
for h in '## 1. Layout' '## 2. WORKER SAFETY RULE' '## 3. Gates' '## 4. What is in state' '## 5. Supervisor procedure' '## 6. Change log'; do has "$h" infra/README.md; done
has 'a worker may run read-only AWS CLI' infra/README.md
has 'cd infra/envs/prod && terraform init -backend=false -input=false && terraform validate && terraform fmt -check -recursive ..' infra/README.md
has 'terraform fmt -check -recursive infra' infra/README.md
has 'backend_override.tf' infra/README.md
has 'E01' infra/README.md
for h in '## 1. Adopt (E01, once)' '## 2. Plan (every issue)' '## 3. Apply (supervisor only)' '## 4. Post-apply cleanups' '## 5. Second plan must be empty' '## 6. Drift you will see'; do has "$h" infra/RUNBOOK.md; done
has 'backend_override.tf' infra/RUNBOOK.md
has 'terraform init -reconfigure' infra/RUNBOOK.md
# 2l. suppression tokens (C07.verify.sh:151 verbatim, over the new files) + secret-value / unspellable-name guards
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "${TEXT_FILES[@]}" \
  && fail "test gutting / suppression found"
if grep -En '(PGPASSWORD|MIGRATE_SECRET|INTERNAL_SHARED_SECRET|RC_WEBHOOK_AUTH_(PRODUCTION|DEVELOPMENT)|ANALYTICS_USER_SALT)\s*[=:]\s*"[^"$P]' "${TEXT_FILES[@]}" >&2; then fail "a secret value pattern appears in a new file"; fi
if grep -Ein 'ALLOW_DEV_B[A-Z]PASS|DEV_B[A-Z]PASS_ALLOWLIST' "${TEXT_FILES[@]}" >&2; then fail "an unspellable env-var name appears in a new file (E00 §0)"; fi

# ── 3. Root gates (infra) ─────────────────────────────────────────────────
echo "[3/5] terraform fmt / init -backend=false / validate"
rm -f "$OVERRIDE"
terraform fmt -check -recursive infra || fail "terraform fmt -check -recursive infra"
( cd "$PROD" && terraform init -backend=false -input=false -no-color >"$TMP/init.log" 2>&1 ) || { tail -20 "$TMP/init.log" >&2; fail "terraform init -backend=false failed"; }
( cd "$PROD" && terraform validate -no-color ) || fail "terraform validate failed"
( cd "$PROD" && terraform fmt -check -recursive .. ) || fail "terraform fmt -check -recursive .. (from envs/prod)"
git diff --quiet -- "$PROD/.terraform.lock.hcl" || fail "terraform init changed .terraform.lock.hcl (lock must already carry this platform's hash)"

# ── 4. Plan against an empty local state + allow-list (read-only) ─────────
echo "[4/5] terraform plan (empty local state, ~93 imports) + check-plan"
acct="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)"
[ "$acct" = "622994489535" ] || fail "AWS_PROFILE=dev read-only credentials for account 622994489535 are required for the plan (got '${acct:-none}')"
ext_id="$(aws iam get-role --role-name snowflake-recallsmith-s3-role --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals."sts:ExternalId"' --output text 2>/dev/null || true)"
[ -n "$ext_id" ] && [ "$ext_id" != "None" ] || fail "could not read the Snowflake role's ExternalId condition (read-only aws iam get-role)"
export TF_VAR_snowflake_external_id="$ext_id"; unset ext_id
mkdir -p "$TMP/state"
cat > "$OVERRIDE" <<HCL
terraform {
  backend "local" {
    path = "$TMP/state/terraform.tfstate"
  }
}
HCL
( cd "$PROD" && terraform init -input=false -no-color >"$TMP/init2.log" 2>&1 ) || { tail -20 "$TMP/init2.log" >&2; fail "terraform init (local override) failed"; }
run_plan() { ( cd "$PROD" && terraform plan -input=false -no-color -out="$TMP/e01.tfplan" >"$TMP/plan.log" 2>&1 ); }
if ! run_plan; then
  # a freshly populated plugin cache has once produced "Required plugins are not installed"; one re-init + retry
  if grep -q 'Required plugins are not installed' "$TMP/plan.log"; then
    ( cd "$PROD" && terraform init -input=false -no-color >"$TMP/init3.log" 2>&1 ) || { tail -20 "$TMP/init3.log" >&2; fail "terraform init (retry) failed"; }
    run_plan || { grep -A4 -E 'Error' "$TMP/plan.log" | head -60 >&2 || true; fail "terraform plan failed (after re-init)"; }
  else
    grep -A4 -E 'Error' "$TMP/plan.log" | head -60 >&2 || true     # errors only; never the plan body
    fail "terraform plan failed"
  fi
fi
( cd "$PROD" && terraform show -json "$TMP/e01.tfplan" ) > "$TMP/e01.plan.json" 2>/dev/null || fail "terraform show -json failed"
rm -f "$OVERRIDE"
# 4a. independent check (does not trust check-plan.py): prints address / actions / keys only
python3 - "$TMP/e01.plan.json" "$TMP/imports.expected" <<'PY' || fail "plan is not the E01 state-only plan (see lines above)"
import json, sys
plan = json.load(open(sys.argv[1]))
expected = set(l.strip() for l in open(sys.argv[2]) if l.strip())
RDS = "module.data.aws_db_instance.developercards"
RDS_KEYS = {"apply_immediately", "final_snapshot_identifier", "skip_final_snapshot"}
OUTPUTS = {"api_id", "api_endpoint", "content_distribution_id", "content_domain_name", "console_distribution_id", "console_domain_name", "core_vpc_alias_arn", "worker_alias_arn", "queue_url", "db_address", "console_pool_endpoint", "mobile_pool_endpoint"}
ok = True
importing = set()
for rc in plan.get("resource_changes", []):
    if rc.get("mode") == "data":
        continue
    ch = rc["change"]; addr = rc["address"]; actions = ch["actions"]
    before = ch.get("before") or {}; after = ch.get("after") or {}
    keys = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
    if "importing" in ch:
        importing.add(addr)
    else:
        print("NOT-IMPORTING", addr, actions); ok = False
    if actions == ["no-op"]:
        continue
    print(addr, ",".join(actions), ",".join(keys) or "-")
    if addr == RDS and actions == ["update"] and set(keys) <= RDS_KEYS:
        continue
    print("UNEXPECTED-CHANGE", addr, actions); ok = False
missing = sorted(expected - importing); extra = sorted(importing - expected)
for a in missing: print("MISSING-IMPORT", a); ok = False
for a in extra:   print("EXTRA-IMPORT", a); ok = False
for name, oc in (plan.get("output_changes") or {}).items():
    if oc.get("actions") != ["no-op"] and name not in OUTPUTS:
        print("UNEXPECTED-OUTPUT", name, oc.get("actions")); ok = False
print("IMPORTS", len(importing), "EXPECTED", len(expected))
sys.exit(0 if ok else 1)
PY
# 4b. the worker's checker on the real plan (allow file resolves expect_imports from the repo root)
python3 infra/scripts/check-plan.py --plan "$TMP/e01.plan.json" --allow docs/delivery/r16-issues/E01.plan-allow.json --summary > "$TMP/check.out" 2>"$TMP/check.err" \
  || { cat "$TMP/check.err" >&2; fail "check-plan.py rejected the E01 plan"; }
grep -Fq 'PLAN OK 1' "$TMP/check.out" || { cat "$TMP/check.out" >&2; fail "check-plan.py must report exactly one effective change (PLAN OK 1)"; }
grep -Fq 'SUMMARY imports=93' "$TMP/check.out" || { cat "$TMP/check.out" >&2; fail "check-plan.py --summary must report imports=93"; }
python3 infra/scripts/check-plan.py --plan "$TMP/e01.plan.json" >/dev/null 2>&1 && fail "check-plan.py without --allow must reject a plan that imports (empty-plan mode)"
rm -f "$TMP/e01.tfplan" "$TMP/e01.plan.json"
# 4c. negative fixtures: the checker must reject what the allow-list does not name and never print values
python3 - infra/scripts/check-plan.py "$TMP" <<'PY' || fail "check-plan.py failed its fixture matrix (see lines above)"
import json, os, subprocess, sys
checker, tmp = sys.argv[1], sys.argv[2]
SENT = "E01-SENTINEL-VALUE-DO-NOT-PRINT"
def entry(addr, actions, before=None, after=None, importing=True, mode="managed"):
    ch = {"actions": actions, "before": before, "after": after}
    if importing: ch["importing"] = {"id": SENT}
    return {"address": addr, "mode": mode, "type": addr.split(".")[-2], "name": addr.split(".")[-1], "change": ch}
def plan(entries, outputs=None):
    return {"format_version": "1.2", "terraform_version": "1.16.3", "resource_changes": entries, "output_changes": outputs or {}}
def run(name, p, allow=None, extra=(), expect=0, expect_imports=None):
    pp = os.path.join(tmp, name + ".plan.json"); json.dump(p, open(pp, "w"))
    cmd = [sys.executable, checker, "--plan", pp]
    if allow is not None:
        ap = os.path.join(tmp, name + ".allow.json"); json.dump(allow, open(ap, "w")); cmd += ["--allow", ap]
    if expect_imports is not None:
        ip = os.path.join(tmp, name + ".imports.txt"); open(ip, "w").write("\n".join(expect_imports) + "\n"); cmd += ["--expect-imports", ip]
    cmd += list(extra)
    r = subprocess.run(cmd, capture_output=True, text=True)
    out = r.stdout + r.stderr
    if SENT in out:
        print("FIXTURE", name, "printed a before/after/import value"); return False
    if r.returncode != expect:
        print("FIXTURE", name, "exit", r.returncode, "expected", expect); print(out[-800:]); return False
    return True
A1 = "module.x.aws_sqs_queue.a"; A2 = "module.x.aws_db_instance.b"; A3 = "module.x.aws_sns_topic.c"; A4 = "module.x.aws_iam_role.d"
noop = entry(A1, ["no-op"], {"name": SENT}, {"name": SENT})
upd  = entry(A2, ["update"], {"a": SENT, "b": 1, "c": 2}, {"a": "other", "b": 1, "c": 2})
allow_ok = {"tags_only_updates": False, "outputs": [], "changes": {A2: {"action": "update", "keys": ["a", "b"]}}}
ok = True
ok &= run("pass", plan([noop, upd]), allow_ok, expect=0, expect_imports=[A1, A2])
ok &= run("unlisted_create", plan([noop, upd, entry(A3, ["create"], None, {"name": SENT}, importing=False)]), allow_ok, expect=1, expect_imports=[A1, A2])
ok &= run("keys_overflow", plan([noop, entry(A2, ["update"], {"a": 1, "c": 2}, {"a": 1, "c": 3})]), allow_ok, expect=1, expect_imports=[A1, A2])
ok &= run("unlisted_output", plan([noop, upd], {"o": {"actions": ["create"], "before": None, "after": SENT}}), allow_ok, expect=1, expect_imports=[A1, A2])
allow_out = dict(allow_ok); allow_out["outputs"] = ["o"]
ok &= run("listed_output", plan([noop, upd], {"o": {"actions": ["create"], "before": None, "after": SENT}}), allow_out, expect=0, expect_imports=[A1, A2])
rep = entry(A4, ["delete", "create"], {"name": SENT}, {"name": SENT}, importing=False)
allow_rep_as_update = {"tags_only_updates": False, "changes": {A2: {"action": "update", "keys": ["a"]}, A4: "update"}}
ok &= run("replace_as_update", plan([noop, upd, rep]), allow_rep_as_update, expect=1, expect_imports=[A1, A2])
allow_rep = {"tags_only_updates": False, "changes": {A2: {"action": "update", "keys": ["a"]}, A4: "replace"}}
ok &= run("replace_listed", plan([noop, upd, rep]), allow_rep, expect=0, expect_imports=[A1, A2])
ok &= run("imports_mismatch", plan([noop, upd]), allow_ok, expect=1, expect_imports=[A1])
allow_stale = {"tags_only_updates": False, "changes": {A2: {"action": "update", "keys": ["a"]}, A3: "create"}}
ok &= run("stale_entry", plan([noop, upd]), allow_stale, expect=1, expect_imports=[A1, A2])
tagupd = entry(A3, ["update"], {"tags": {}, "tags_all": {}, "name": "n"}, {"tags": {"k": SENT}, "tags_all": {"k": SENT}, "name": "n"}, importing=False)
allow_tags = {"tags_only_updates": True, "changes": {A2: {"action": "update", "keys": ["a"]}}}
ok &= run("tags_only_pass", plan([noop, upd, tagupd]), allow_tags, expect=0, expect_imports=[A1, A2])
tagupd2 = entry(A3, ["update"], {"tags": {}, "name": "n"}, {"tags": {"k": SENT}, "name": "m"}, importing=False)
ok &= run("tags_only_fail", plan([noop, upd, tagupd2]), allow_tags, expect=1, expect_imports=[A1, A2])
ok &= run("data_ignored", plan([noop, upd, entry("module.x.data.aws_vpc.v", ["read"], None, {"id": SENT}, importing=False, mode="data")]), allow_ok, expect=0, expect_imports=[A1, A2])
ok &= run("empty_ok", plan([entry(A1, ["no-op"], {"name": SENT}, {"name": SENT}, importing=False)]), None, expect=0)
ok &= run("empty_importing", plan([noop]), None, expect=1)
ok &= run("empty_create", plan([entry(A3, ["create"], None, {"name": SENT}, importing=False)]), None, expect=1)
ok &= run("empty_output", plan([], {"o": {"actions": ["create"], "before": None, "after": SENT}}), None, expect=1)
ok &= run("bad_json", plan([]), None, extra=["--allow", os.path.join(tmp, "missing.json")], expect=2)
sys.exit(0 if ok else 1)
PY

# ── 5. Scope + frozen + OTA + apply guard ─────────────────────────────────
echo "[5/5] scope + frozen + OTA + apply guard"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
# 5a. frozen files + OTA manifests
git diff --quiet "$mb" HEAD -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  || fail "a frozen mobile file changed (E00 §0)"
git diff --quiet "$mb" HEAD -- mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json \
  || fail "a mobile manifest changed (OTA rule)"
grep -Fq '"version": "1.6.1"' mobile/app.json || fail "app.json version changed (must stay 1.6.1)"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (out of this wave)"; fi
# 5b. every changed or untracked path under infra / docs is a scope file (pathspec-scoped untracked scan)
allow_re='^(infra/(README\.md|RUNBOOK\.md|\.gitignore|bootstrap/placeholder\.zip|scripts/check-plan\.py|envs/prod/(versions|providers|backend|variables|outputs|main|imports)\.tf|envs/prod/prod\.auto\.tfvars\.example|envs/prod/\.terraform\.lock\.hcl|modules/identity/(main|variables|outputs|cognito)\.tf|modules/data/(main|variables|outputs|rds|buckets|network)\.tf|modules/edge/(main|variables|outputs|cdn|console_bucket)\.tf|modules/api/(main|variables|outputs|gateway|core_vpc|edge_public)\.tf|modules/worker/(main|variables|outputs|queue|function)\.tf|modules/observability/(main|variables|outputs|budget)\.tf)|docs/delivery/r16-issues/.*)$'
outside="$( { git diff --name-only "$mb" HEAD; git ls-files --others --exclude-standard -- infra docs; } | sort -u | grep -Ev "$allow_re" || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside E01 scope"; }
extra_tf="$(find infra -name '*.tf' -not -path '*/.terraform/*' | sort | grep -Ev "$allow_re" || true)"
[ -z "$extra_tf" ] || { echo "$extra_tf" >&2; fail "unexpected .tf file(s) under infra (only the E01 file set may exist)"; }
[ ! -e infra/envs/staging ] || fail "infra/envs/staging belongs to E10"
# 5c. nothing generated / secret-bearing is tracked
tracked_bad="$(git ls-files infra | grep -E '\.(tfplan|plan\.json)$|generated.*\.tf$|[^e]\.auto\.tfvars$|(^|/)\.terraform/|backend_override\.tf$' || true)"
[ -z "$tracked_bad" ] || { echo "$tracked_bad" >&2; fail "a plan / generated / tfvars / override file is tracked under infra"; }
# 5d. apply guard: no non-comment line in infra scripts or this verify runs a state-changing command
apply_hits="$( { find infra -type f \( -name '*.py' -o -name '*.sh' \) -not -path '*/.terraform/*'; echo docs/delivery/r16-issues/E01.verify.sh; } \
  | xargs grep -HnE 'terraform +(apply|import)|aws +[a-z0-9-]+ +(create|update|delete|put)-' 2>/dev/null \
  | grep -vE '^[^:]+:[0-9]+:\s*#' || true )"
[ -z "$apply_hits" ] || { echo "$apply_hits" >&2; fail "state-changing command outside a comment (WORKER SAFETY RULE)"; }

echo "E01 VERIFY OK"
