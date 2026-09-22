#!/usr/bin/env bash
# E02 — safety-switches verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - infra/scripts/rds-snapshot.sh,
#     infra/modules/observability/retention.tf and
#     docs/delivery/r16-issues/E02.plan-allow.json do not exist on base
#   (step 1 then also checks the E01 prerequisite: infra/envs/prod/main.tf,
#   infra/scripts/check-plan.py and the module files this issue edits must be
#   on the integration branch, because E00 §4 orders E01 before E02)
# Step 2 (literal guards) would also fail on base: no `deletion_protection = true`,
# no `noncurrent-90d`, no `developercards-management`, no `budget_limit = "60"`.
# Step 3 is the infra root gate (fmt/init/validate), step 4 is the read-only
# plan checked against the allow-list, step 5 a purely negative scope + frozen +
# OTA + apply guard; 3–5 pass on a correct tree by design and are never reached
# on base.
#
# Network: step 3 may download the pinned provider once into TF_PLUGIN_CACHE_DIR;
# step 4 needs AWS_PROFILE=dev (describe/get/list only — the plan imports the 93
# adopted resources into an EMPTY LOCAL state through a temporary backend
# override and never opens the S3 backend). Nothing here changes AWS or any
# state: the only terraform verbs used are init / validate / fmt / plan / show.
# Runtime: steps 1-3 seconds to ~1 min, step 4 ~2–4 min. The driver's
# diff-scoped banned-term grep and suppression scan run separately; this script
# does not spell the six terms (E00 §0).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-e-prod}}"   # driver exports BASE
fail() { echo "E02 VERIFY FAIL: $*" >&2; exit 1; }

export TF_PLUGIN_CACHE_DIR="${TF_PLUGIN_CACHE_DIR:-$HOME/.terraform.d/plugin-cache}"
mkdir -p "$TF_PLUGIN_CACHE_DIR"
export TF_IN_AUTOMATION=1

PROD=infra/envs/prod
SNAP=infra/scripts/rds-snapshot.sh
RET=infra/modules/observability/retention.tf
ALLOW=docs/delivery/r16-issues/E02.plan-allow.json
RDS=infra/modules/data/rds.tf
BUCKETS=infra/modules/data/buckets.tf
CORE=infra/modules/api/core_vpc.tf
EDGE=infra/modules/api/edge_public.tf
WORKER=infra/modules/worker/function.tf
BUDGET=infra/modules/observability/budget.tf
OBSVARS=infra/modules/observability/variables.tf
ROOTVARS=$PROD/variables.tf
EXAMPLE=$PROD/prod.auto.tfvars.example   # read-only here (E04 appends alert_email)
PROVIDERS=$PROD/providers.tf
MAIN=$PROD/main.tf
README=infra/README.md
CHECK=infra/scripts/check-plan.py

TMP="$(mktemp -d)"
OVR="$PROD/backend_override.tf"   # gitignored by E01 (gap 13); created for step 4 only
cleanup() {
  rm -f "$OVR" "$PROD/.terraform/terraform.tfstate"
  rm -f "$TMP"/*.tfplan "$TMP"/*.plan.json "$TMP"/*.tfvars "$TMP"/*.txt "$TMP"/*.tfstate* 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

count()  { grep -Ec "$1" "$2" || true; }     # ERE count, 0 when no match
fcount() { grep -Fc "$1" "$2" || true; }     # fixed-string count, 0 when no match

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ E01 prerequisite)"
[ -f "$SNAP" ]  || fail "$SNAP does not exist (base tree fails here)"
[ -f "$RET" ]   || fail "$RET does not exist (base tree fails here)"
[ -f "$ALLOW" ] || fail "$ALLOW does not exist (base tree fails here)"
[ -x "$SNAP" ]  || fail "$SNAP is not executable (chmod +x)"
for f in "$MAIN" "$PROVIDERS" "$PROD/backend.tf" "$PROD/imports.tf" "$PROD/versions.tf" "$ROOTVARS" "$EXAMPLE" "$PROD/.terraform.lock.hcl" "$CHECK" \
         "$RDS" "$BUCKETS" "$CORE" "$EDGE" "$WORKER" "$BUDGET" "$OBSVARS" "$README"; do
  [ -f "$f" ] || fail "$f is missing — E01 must be merged before E02 (E00 §4)"
done

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. rds.tf — the two switches, the E01 invariants, nothing forbidden
grep -Eq '^\s*deletion_protection\s*=\s*true\s*$'      "$RDS" || fail "rds.tf: deletion_protection = true missing"
grep -Eq '^\s*backup_retention_period\s*=\s*14\s*$'    "$RDS" || fail "rds.tf: backup_retention_period = 14 missing"
grep -Eq 'deletion_protection\s*=\s*false'             "$RDS" && fail "rds.tf: deletion_protection = false still present"
grep -Eq 'backup_retention_period\s*=\s*7\b'           "$RDS" && fail "rds.tf: backup_retention_period = 7 still present"
grep -Eq 'prevent_destroy\s*=\s*true'                  "$RDS" || fail "rds.tf: prevent_destroy = true removed"
grep -Eq 'skip_final_snapshot\s*=\s*false'             "$RDS" || fail "rds.tf: skip_final_snapshot = false removed"
grep -Eq 'apply_immediately\s*=\s*false'               "$RDS" || fail "rds.tf: apply_immediately = false removed"
grep -Eq 'final_snapshot_identifier\s*=\s*"developercards-final-tf"' "$RDS" || fail "rds.tf: final_snapshot_identifier changed"
grep -Eq 'engine_version\s*=\s*"17\.9"'                "$RDS" || fail "rds.tf: engine_version must stay \"17.9\""
if grep -Eq '^\s*(password|password_wo|manage_master_user_password|multi_az\s*=\s*true|tags\s*=|enabled_cloudwatch_logs_exports|parameter_group_name\s*=\s*"developercards)' "$RDS"; then
  grep -En '^\s*(password|password_wo|manage_master_user_password|multi_az\s*=\s*true|tags\s*=|enabled_cloudwatch_logs_exports|parameter_group_name\s*=\s*"developercards)' "$RDS" >&2 || true
  fail "rds.tf: forbidden attribute (E00 §2.1.4 / brief Do NOT)"
fi
# 2b. buckets.tf — versioning Enabled ×2, two lifecycle resources, no expiration of current objects
[ "$(count '^\s*status\s*=\s*"Enabled"\s*$' "$BUCKETS")" = "4" ] || fail "buckets.tf: expected exactly four status = \"Enabled\" (2 versioning + 2 lifecycle rules)"
grep -Eq '^\s*status\s*=\s*"(Disabled|Suspended)"' "$BUCKETS" && fail "buckets.tf: a versioning status is still Disabled/Suspended"
grep -Eq '^resource "aws_s3_bucket_lifecycle_configuration" "content"' "$BUCKETS" || fail "buckets.tf: lifecycle resource \"content\" missing"
grep -Eq '^resource "aws_s3_bucket_lifecycle_configuration" "premium"' "$BUCKETS" || fail "buckets.tf: lifecycle resource \"premium\" missing"
[ "$(count '^\s*id\s*=\s*"noncurrent-90d"\s*$' "$BUCKETS")" = "2" ]           || fail "buckets.tf: need two id = \"noncurrent-90d\""
[ "$(count '^\s*noncurrent_days\s*=\s*90\s*$' "$BUCKETS")" = "2" ]            || fail "buckets.tf: need two noncurrent_days = 90"
[ "$(count '^\s*days_after_initiation\s*=\s*7\s*$' "$BUCKETS")" = "2" ]       || fail "buckets.tf: need two days_after_initiation = 7"
[ "$(count '^\s*filter\s*\{\}\s*$' "$BUCKETS")" = "2" ]                        || fail "buckets.tf: need two whole-bucket filter {} blocks"
[ "$(count '^\s*resource "aws_s3_bucket_lifecycle_configuration"' "$BUCKETS")" = "2" ] || fail "buckets.tf: exactly two lifecycle resources"
grep -Eq 'depends_on\s*=\s*\[aws_s3_bucket_versioning\.content\]' "$BUCKETS" || fail "buckets.tf: content lifecycle must depends_on its versioning"
grep -Eq 'depends_on\s*=\s*\[aws_s3_bucket_versioning\.premium\]' "$BUCKETS" || fail "buckets.tf: premium lifecycle must depends_on its versioning"
if grep -Eq '^\s*(expiration\s*\{|transition\s*\{|noncurrent_version_transition|prefix\s*=|force_destroy\s*=\s*true|expected_bucket_owner)' "$BUCKETS"; then
  grep -En '^\s*(expiration\s*\{|transition\s*\{|noncurrent_version_transition|prefix\s*=|force_destroy\s*=\s*true|expected_bucket_owner)' "$BUCKETS" >&2 || true
  fail "buckets.tf: expiration/transition/prefix/force_destroy are forbidden on the content buckets (E00 §2.2.3)"
fi
# 2c. log retention where the groups live
grep -Eq '^\s*retention_in_days\s*=\s*90\s*$' "$CORE"   || fail "core_vpc.tf: retention_in_days = 90 missing"
grep -Eq '^\s*retention_in_days\s*=\s*30\s*$' "$EDGE"   || fail "edge_public.tf: retention_in_days = 30 missing"
grep -Eq '^\s*retention_in_days\s*=\s*30\s*$' "$WORKER" || fail "worker/function.tf: retention_in_days = 30 missing"
if grep -rEn 'retention_in_days\s*=\s*0(\s|$)' infra/modules --include=*.tf; then fail "a log group still has retention_in_days = 0"; fi
[ "$(grep -rE '^resource "aws_cloudwatch_log_group"' infra/modules --include=*.tf | wc -l | tr -d ' ')" = "3" ] || fail "exactly three log groups are managed after E02 (E04 adds the API access-log group)"
# 2d. retention.tf — CloudTrail + bucket set, verbatim literals
for sym in 'data "aws_region" "current" {}' \
           'developercards-cloudtrail-${var.account_id}' \
           ':trail/developercards-management' \
           'resource "aws_s3_bucket" "cloudtrail"' \
           'resource "aws_s3_bucket_public_access_block" "cloudtrail"' \
           'resource "aws_s3_bucket_ownership_controls" "cloudtrail"' \
           'resource "aws_s3_bucket_server_side_encryption_configuration" "cloudtrail"' \
           'resource "aws_s3_bucket_lifecycle_configuration" "cloudtrail"' \
           'resource "aws_s3_bucket_policy" "cloudtrail"' \
           'resource "aws_cloudtrail" "management"' \
           'object_ownership = "BucketOwnerEnforced"' \
           'sse_algorithm = "AES256"' \
           'AWSCloudTrailAclCheck' 'AWSCloudTrailWrite' 'cloudtrail.amazonaws.com' \
           's3:GetBucketAcl' 's3:PutObject' 'bucket-owner-full-control' 'aws:SourceArn' \
           '/AWSLogs/${var.account_id}/*' \
           'depends_on = [aws_s3_bucket_policy.cloudtrail]'; do
  grep -Fq "$sym" "$RET" || fail "retention.tf lacks: $sym"
done
grep -Eq '^\s*name\s*=\s*"developercards-management"\s*$'      "$RET" || fail "retention.tf: trail name"
grep -Eq '^\s*is_multi_region_trail\s*=\s*true\s*$'            "$RET" || fail "retention.tf: is_multi_region_trail = true"
grep -Eq '^\s*include_global_service_events\s*=\s*true\s*$'    "$RET" || fail "retention.tf: include_global_service_events = true"
grep -Eq '^\s*enable_log_file_validation\s*=\s*true\s*$'       "$RET" || fail "retention.tf: enable_log_file_validation = true"
grep -Eq '^\s*id\s*=\s*"expire-400d"\s*$'                      "$RET" || fail "retention.tf: lifecycle id expire-400d"
grep -Eq '^\s*days\s*=\s*400\s*$'                              "$RET" || fail "retention.tf: expiration days = 400"
for k in block_public_acls block_public_policy ignore_public_acls restrict_public_buckets; do
  grep -Eq "^\s*$k\s*=\s*true\s*$" "$RET" || fail "retention.tf: $k = true"
done
if grep -Eq 'event_selector|advanced_event_selector|insight_selector|cloud_watch_logs|kms_key_id|sns_topic_name|aws_sns_topic|aws_cloudwatch_metric_alarm|aws_db_event_subscription|aws_cloudwatch_log_group|prevent_destroy|force_destroy' "$RET"; then
  grep -En 'event_selector|advanced_event_selector|insight_selector|cloud_watch_logs|kms_key_id|sns_topic_name|aws_sns_topic|aws_cloudwatch_metric_alarm|aws_db_event_subscription|aws_cloudwatch_log_group|prevent_destroy|force_destroy' "$RET" >&2 || true
  fail "retention.tf: holds something that is not the CloudTrail bucket+trail (E00 §1.1)"
fi
[ "$(count '^resource ' "$RET")" = "7" ] || fail "retention.tf: exactly seven resources (bucket, PAB, ownership, SSE, lifecycle, policy, trail)"
# 2e. budget $60, notifications byte-identical to E01 (alert_email is E04's), no SNS yet
grep -Eq '^\s*budget_limit\s*=\s*"60"\s*$'          "$MAIN"   || fail "main.tf: module observability must pass budget_limit = \"60\""
grep -Eq '^\s*limit_amount\s*=\s*var\.budget_limit\s*$' "$BUDGET" || fail "budget.tf: limit_amount must read var.budget_limit"
if grep -rEn 'budget_limit\s*=\s*"20|limit_amount\s*=\s*"20' infra --include=*.tf; then fail "a \"20\" budget literal survives"; fi
[ "$(count '^\s*notification\s*\{' "$BUDGET")" = "3" ] || fail "budget.tf: exactly three notification blocks"
for t in 50 85 100; do grep -Eq "^\s*threshold\s*=\s*$t\s*$" "$BUDGET" || fail "budget.tf: threshold $t missing"; done
grep -Eq 'subscriber_sns_topic_arns\s*=\s*\[[^]]' "$BUDGET" && fail "budget.tf: subscriber_sns_topic_arns must stay empty until E04"
if grep -rEn 'var\.alert_email|"alert_email"' infra --include=*.tf --include=*.example; then fail "alert_email is E04's (E00 §1.1, E04 brief) — E02 leaves the adopted subscriber literal in place"; fi
mb0="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE)"
if git cat-file -e "$mb0:$BUDGET" 2>/dev/null; then
  [ "$(git show "$mb0:$BUDGET" | grep -E '^\s*subscriber_email_addresses' | sort)" = "$(grep -E '^\s*subscriber_email_addresses' "$BUDGET" | sort)" ] \
    || fail "budget.tf: the three subscriber_email_addresses lines must be byte-identical to the merge-base copy"
  badplus="$(git diff "$mb0" HEAD -- "$BUDGET" | grep -E '^\+' | grep -Ev '^\+\+\+' | grep -Ev '^\+\s*limit_amount\s*=\s*var\.budget_limit\s*$' || true)"
  [ -z "$badplus" ] || { echo "$badplus" >&2; fail "budget.tf: the only line it may gain is limit_amount = var.budget_limit"; }
fi
grep -rEq 'aws_sns_topic|aws_cloudwatch_metric_alarm|aws_db_event_subscription' infra/modules/observability --include=*.tf && fail "observability: SNS/alarms/RDS events are E04, not E02"
# 2f. providers.tf — default_tags on both providers, no profile
[ "$(count '^\s*default_tags\s*\{' "$PROVIDERS")" = "2" ]              || fail "providers.tf: default_tags on both providers"
[ "$(count '^\s*Project\s*=\s*"DeveloperCards"\s*$' "$PROVIDERS")" = "2" ] || fail "providers.tf: Project = \"DeveloperCards\" twice"
[ "$(count '^\s*Env\s*=\s*var\.env\s*$' "$PROVIDERS")" = "2" ]         || fail "providers.tf: Env = var.env twice"
[ "$(count '^\s*ManagedBy\s*=\s*"terraform"\s*$' "$PROVIDERS")" = "2" ] || fail "providers.tf: ManagedBy = \"terraform\" twice"
[ "$(count '^provider "aws"' "$PROVIDERS")" = "2" ]                     || fail "providers.tf: exactly two provider blocks"
if grep -rn 'profile *= *"' infra --include=*.tf; then fail "a provider carries profile= (E00 §0)"; fi
if grep -rEn '^\s*tags\s*=\s*\{' infra/modules --include=*.tf; then fail "a resource-level tags map exists in a module — tags come from default_tags only"; fi
# 2g. rds-snapshot.sh — pinned literals, DRY_RUN gate first, behaviour in a credential-less sandbox
head -1 "$SNAP" | grep -Fq '#!/usr/bin/env bash' || fail "rds-snapshot.sh: shebang"
for sym in 'set -euo pipefail' '^[a-z0-9-]{1,40}$' 'DRY_RUN' \
           'developercards-${label}-$(date -u +%Y%m%d-%H%M)' \
           'aws rds wait db-snapshot-available'; do
  grep -Fq "$sym" "$SNAP" || fail "rds-snapshot.sh lacks: $sym"
done
grep -Eq '^aws +rds +creat[e]-db-snapshot +--db-instance-identifier +"\$DB_ID" +--db-snapshot-identifier +"\$SNAP"' "$SNAP" || fail "rds-snapshot.sh: the real snapshot line must be exactly the pinned one"
dry_line="$(grep -n 'DRY_RUN' "$SNAP" | grep -Ev '^[0-9]+:\s*#' | head -1 | cut -d: -f1)"
aws_line="$(grep -nE '^\s*aws ' "$SNAP" | head -1 | cut -d: -f1)"
[ -n "$dry_line" ] && [ -n "$aws_line" ] && [ "$dry_line" -lt "$aws_line" ] || fail "rds-snapshot.sh: the DRY_RUN gate must precede the first real aws call"
[ "$(grep -cE '^\s*aws ' "$SNAP" || true)" = "2" ] || fail "rds-snapshot.sh: exactly two real aws lines (create-db-snapshot, wait)"
grep -Eq 'aws +(s3|s3api|lambda|iam|logs|secretsmanager|configure)' "$SNAP" && fail "rds-snapshot.sh: only the two rds commands are allowed"
bash -n "$SNAP" || fail "rds-snapshot.sh: bash -n"
sandbox() { env -i PATH="$PATH" HOME="$TMP" AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null AWS_EC2_METADATA_DISABLED=true "$@"; }
out="$(sandbox DRY_RUN=1 bash "$SNAP" pre-e02-verify 2>&1)" || fail "rds-snapshot.sh: DRY_RUN=1 with a valid label must exit 0 (got: $out)"
echo "$out" | grep -Eq '^DRY_RUN: aws +rds +creat[e]-db-snapshot --db-instance-identifier developercards --db-snapshot-identifier developercards-pre-e02-verify-[0-9]{8}-[0-9]{4}$' || fail "rds-snapshot.sh: DRY_RUN create line missing/incorrect"
echo "$out" | grep -Eq '^DRY_RUN: aws rds wait db-snapshot-available --db-snapshot-identifier developercards-pre-e02-verify-[0-9]{8}-[0-9]{4}$' || fail "rds-snapshot.sh: DRY_RUN wait line missing/incorrect"
if sandbox DRY_RUN=1 bash "$SNAP" Pre_E02 >/dev/null 2>&1; then fail "rds-snapshot.sh: label Pre_E02 must be rejected"; fi
if sandbox DRY_RUN=1 bash "$SNAP" >/dev/null 2>&1; then fail "rds-snapshot.sh: a missing label must be rejected"; fi
if sandbox DRY_RUN=1 bash "$SNAP" "$(printf 'a%.0s' $(seq 1 41))" >/dev/null 2>&1; then fail "rds-snapshot.sh: a 41-char label must be rejected"; fi
# 2h. allow file == the brief's Changes 9 (parsed JSON equality)
cat > "$TMP/expected-allow.txt" <<'JSON'
{
  "tags_only_updates": true,
  "outputs": ["api_id", "api_endpoint", "content_distribution_id", "content_domain_name", "console_distribution_id", "console_domain_name", "core_vpc_alias_arn", "worker_alias_arn", "queue_url", "db_address", "console_pool_endpoint", "mobile_pool_endpoint"],
  "changes": {
    "module.data.aws_db_instance.developercards": { "action": "update", "keys": ["deletion_protection", "backup_retention_period", "tags", "tags_all", "apply_immediately", "skip_final_snapshot", "final_snapshot_identifier"] },
    "module.data.aws_s3_bucket_versioning.content": { "action": "update", "keys": ["versioning_configuration"] },
    "module.data.aws_s3_bucket_versioning.premium": { "action": "update", "keys": ["versioning_configuration"] },
    "module.data.aws_s3_bucket_lifecycle_configuration.content": "create",
    "module.data.aws_s3_bucket_lifecycle_configuration.premium": "create",
    "module.api.aws_cloudwatch_log_group.core_vpc": { "action": "update", "keys": ["retention_in_days", "tags", "tags_all"] },
    "module.api.aws_cloudwatch_log_group.edge_public": { "action": "update", "keys": ["retention_in_days", "tags", "tags_all"] },
    "module.worker.aws_cloudwatch_log_group.worker": { "action": "update", "keys": ["retention_in_days", "tags", "tags_all"] },
    "module.observability.aws_budgets_budget.monthly": { "action": "update", "keys": ["limit_amount", "tags", "tags_all"] },
    "module.observability.aws_s3_bucket.cloudtrail": "create",
    "module.observability.aws_s3_bucket_public_access_block.cloudtrail": "create",
    "module.observability.aws_s3_bucket_ownership_controls.cloudtrail": "create",
    "module.observability.aws_s3_bucket_server_side_encryption_configuration.cloudtrail": "create",
    "module.observability.aws_s3_bucket_lifecycle_configuration.cloudtrail": "create",
    "module.observability.aws_s3_bucket_policy.cloudtrail": "create",
    "module.observability.aws_cloudtrail.management": "create"
  }
}
JSON
python3 - "$ALLOW" "$TMP/expected-allow.txt" <<'PY' || fail "E02.plan-allow.json differs from the brief's Changes 9"
import json, sys
g = json.load(open(sys.argv[1])); e = json.load(open(sys.argv[2]))
def canon(d):
    out = {}
    for a, v in d["changes"].items():
        out[a] = v if isinstance(v, str) else {"action": v["action"], "keys": sorted(v["keys"])}
    return {"tags_only_updates": d.get("tags_only_updates"), "outputs": sorted(d.get("outputs", [])), "changes": out, "extra": sorted(set(d) - {"tags_only_updates", "outputs", "changes"})}
if canon(g) != canon(e):
    print("allow-list mismatch", file=sys.stderr); sys.exit(1)
PY
# 2i. README §6 line, suppression tokens, secret-name-with-value guard
grep -Eq '^- 20[0-9]{2}-[0-9]{2}-[0-9]{2} E02 — .*devcards-content-dev' "$README" || fail "infra/README.md §6 lacks the dated E02 line (- YYYY-MM-DD E02 — … devcards-content-dev …)"
SCOPE_FILES=("$SNAP" "$RET" "$ALLOW" "$RDS" "$BUCKETS" "$CORE" "$EDGE" "$WORKER" "$BUDGET" "$OBSVARS" "$PROVIDERS" "$MAIN" "$README")
if grep -Eq 'Skip[[:space:]]*=|#pragma warning disable|\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable' "${SCOPE_FILES[@]}"; then
  grep -En 'Skip[[:space:]]*=|#pragma warning disable|\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable' "${SCOPE_FILES[@]}" >&2 || true
  fail "test gutting / suppression found"
fi
if grep -Eq '(PGPASSWORD|MIGRATE_SECRET|INTERNAL_SHARED_SECRET|RC_WEBHOOK_AUTH_(PRODUCTION|DEVELOPMENT)|ANALYTICS_USER_SALT)\s*[=:]\s*"[^"$P]' "${SCOPE_FILES[@]}"; then
  fail "a secret name appears with a literal value in a scope file"
fi
if git ls-files infra | grep -E '\.(tfplan|plan\.json)$|generated.*\.tf$|_override\.tf$|[^e]\.auto\.tfvars$'; then fail "a plan / generated / override / tfvars file is tracked"; fi

# ── 3. Root gates: infra (verbatim E00 §0) + fmt from the root + script/JSON syntax ──
echo "[3/5] terraform fmt / init -backend=false / validate"
python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$ALLOW" || fail "E02.plan-allow.json is not valid JSON"
python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read(), sys.argv[1])' "$CHECK" || fail "check-plan.py does not parse"
terraform fmt -check -recursive infra >"$TMP/fmt.txt" 2>&1 || { cat "$TMP/fmt.txt" >&2; fail "terraform fmt -check -recursive infra"; }
( cd "$PROD" && terraform init -backend=false -input=false -no-color >"$TMP/init0.txt" 2>&1 && terraform validate -no-color && terraform fmt -check -recursive .. ) \
  || { tail -30 "$TMP/init0.txt" >&2; fail "infra root gate (init -backend=false / validate / fmt ..)"; }

# ── 4. Read-only plan against an EMPTY LOCAL state, checked against the allow-list ──
echo "[4/5] terraform plan (local override, read-only) + check-plan.py"
aws sts get-caller-identity --query Account --output text >"$TMP/acct.txt" 2>&1 || fail "AWS credentials are not usable (AWS_PROFILE=dev, describe/get/list only)"
[ "$(tr -d '[:space:]' <"$TMP/acct.txt")" = "622994489535" ] || fail "wrong AWS account for the plan"
# Variables: the real prod.auto.tfvars is gitignored; feed the example minus any ExternalId line,
# and read the live Snowflake ExternalId (not a secret per AWS, never printed) into TF_VAR_<name>.
VARS="$TMP/e02.tfvars"; : >"$VARS"
if [ -f "$PROD/prod.auto.tfvars.example" ]; then grep -Ev 'external_id' "$PROD/prod.auto.tfvars.example" >"$VARS" || true; fi
EXT_VAR="$(grep -Eo 'variable "[A-Za-z0-9_]*external_id[A-Za-z0-9_]*"' "$ROOTVARS" | head -1 | cut -d'"' -f2 || true)"
if [ -n "$EXT_VAR" ]; then
  EXT_ID="$(aws iam get-role --role-name snowflake-recallsmith-s3-role \
            --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals."sts:ExternalId"' --output text 2>/dev/null || true)"
  [ -n "$EXT_ID" ] && [ "$EXT_ID" != "None" ] || fail "could not read the Snowflake ExternalId from iam get-role"
  export "TF_VAR_${EXT_VAR}=${EXT_ID}"
fi
printf 'terraform {\n  backend "local" {\n    path = "%s/e02.tfstate"\n  }\n}\n' "$TMP" >"$OVR"
( cd "$PROD" && terraform init -input=false -reconfigure -no-color >"$TMP/init1.txt" 2>&1 ) \
  || { tail -30 "$TMP/init1.txt" >&2; fail "terraform init with the local backend override failed"; }
( cd "$PROD" && terraform plan -input=false -no-color -var-file="$VARS" -out="$TMP/e02.tfplan" >"$TMP/plan.txt" 2>&1 ) \
  || { grep -E '^(Error|│|╷|╵)' "$TMP/plan.txt" | head -40 >&2; fail "terraform plan failed"; }
grep -E '^Plan:' "$TMP/plan.txt" || fail "plan produced no Plan: line"
grep -Eq '0 to destroy' "$TMP/plan.txt" || fail "the plan destroys something"
( cd "$PROD" && terraform show -json "$TMP/e02.tfplan" >"$TMP/e02.plan.json" ) || fail "terraform show -json failed"
python3 "$CHECK" --plan "$TMP/e02.plan.json" --allow "$ALLOW" || fail "plan contains actions outside the E02 allow-list"
rm -f "$OVR" "$TMP/e02.tfplan" "$TMP/e02.plan.json" "$TMP/plan.txt" "$TMP/e02.tfstate"* "$PROD/.terraform/terraform.tfstate"
[ ! -e "$OVR" ] || fail "override file not removed"

# ── 5. Scope + frozen + OTA + apply guard (purely negative; passes on base) ──
echo "[5/5] scope + frozen + OTA + apply guard"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
frozen="$(git diff --numstat "$mb" HEAD -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json mobile frontend src_C site .github snowflake scripts \
  "$PROD/imports.tf" "$PROD/backend.tf" "$PROD/versions.tf" "$ROOTVARS" "$PROD/outputs.tf" "$EXAMPLE" "$PROD/.terraform.lock.hcl" \
  "$CHECK" infra/RUNBOOK.md infra/.gitignore infra/bootstrap \
  infra/modules/identity infra/modules/edge infra/modules/api/gateway.tf infra/modules/api/main.tf infra/modules/api/variables.tf infra/modules/api/outputs.tf \
  infra/modules/worker/queue.tf infra/modules/worker/main.tf infra/modules/worker/variables.tf infra/modules/worker/outputs.tf \
  infra/modules/data/network.tf infra/modules/data/main.tf infra/modules/data/variables.tf infra/modules/data/outputs.tf \
  infra/modules/observability/main.tf infra/modules/observability/outputs.tf ':(glob)docs/*.md')"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
grep -Fq '"version": "1.6.1"' mobile/app.json || fail "mobile/app.json version must stay 1.6.1"
if grep -rq '@sentry' mobile/src; then fail "@sentry under mobile/src"; fi
# Untracked scan is pathspec-scoped, never bare (the driver symlinks node_modules into the worktree).
outside="$( { git diff --name-only "$mb" HEAD; git ls-files --others --exclude-standard -- infra docs | grep -Ev '(^|/)(\.terraform|__pycache__)/'; } | sort -u | grep -Ev '^(infra/scripts/rds-snapshot\.sh|infra/modules/observability/retention\.tf|infra/modules/observability/budget\.tf|infra/modules/observability/variables\.tf|infra/modules/data/rds\.tf|infra/modules/data/buckets\.tf|infra/modules/api/core_vpc\.tf|infra/modules/api/edge_public\.tf|infra/modules/worker/function\.tf|infra/envs/prod/providers\.tf|infra/envs/prod/main\.tf|infra/README\.md|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside E02 scope"; }
# Apply guard (E00 §5): the issue's added lines (all scope files except the named supervisor-only
# script) must not carry an apply/import/mutating-CLI literal outside comment lines.
added="$(git diff "$mb" HEAD -- "$RET" "$ALLOW" "$RDS" "$BUCKETS" "$CORE" "$EDGE" "$WORKER" "$BUDGET" "$OBSVARS" "$PROVIDERS" "$MAIN" "$README" \
  | grep -E '^\+' | grep -Ev '^\+\+\+' | grep -Ev '^\+\s*(#|//)' || true)"
if printf '%s\n' "$added" | grep -Eq 'terraform +(apply|import)|aws +[a-z0-9-]+ +(create|update|delete|put)-'; then
  printf '%s\n' "$added" | grep -En 'terraform +(apply|import)|aws +[a-z0-9-]+ +(create|update|delete|put)-' >&2 || true
  fail "a worker artefact carries an apply/import/mutating CLI literal outside comments"
fi
if grep -Ev '^\s*#' "$SNAP" | grep -Eq 'terraform|aws +[a-z0-9-]+ +(update|delete|put)-'; then
  fail "rds-snapshot.sh may only call the pinned rds snapshot + wait commands"
fi

echo "E02 VERIFY OK"
