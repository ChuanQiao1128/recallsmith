#!/usr/bin/env bash
# E13 — analytics-separation verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - infra/modules/data/analytics.tf, snowflake/002_snapshot_export.sql,
#     src_C/Tests/RecallSmith.Lambda.IntegrationTests/HashUserIdSaltTests.cs and
#     docs/delivery/r16-issues/E13.plan-allow.json do not exist on base
#   (step 1 then also checks the queue prerequisites: infra/scripts/check-plan.py (E01),
#   identity/policies.tf (E05), identity/ssm.tf + src_C/env/prod.env.json (E06),
#   infra/envs/staging (E10), src_C/Vpc/Internal/InternalEvents.cs (E12) and E04's
#   PublishBatchAsync / Log.Event — E00 §4 orders E13 after E11)
# Step 2 (literal guards) would also fail on base: no `S3Analytics`, no
# `DeleteSentOlderThanAsync`, no salted `HashUserId`, no `marts.card_snapshot_window`.
# Step 3 = fmt / validate (prod + staging) / dotnet build. Step 4 = the plan against the
# real S3 backend, read-only (`init` reads the state object, `plan -lock=false` writes
# nothing), an inline allow-list checker, IAM policy simulation, check-plan.py, then the
# two targeted xunit classes (Docker). Step 5 = scope + frozen + OTA guard.
#
# Never prints a plan value: only addresses, actions and changed-key names. Every plan
# artefact lives in a mktemp dir removed by the EXIT trap. The two live-sourced variables
# (snowflake_external_id from `iam get-role`, alert_email from `sns list-subscriptions-by-topic`)
# are exported as TF_VAR_* for the plan and never echoed. Read-only AWS only; the supervisor
# is the one who applies (E00 §0).
#
# The driver's diff-scoped term gate and suppression scan run separately; this script does
# not spell the six terms (E00 §0).
#
# Network: AWS reads (plan refresh, policy simulation), the pinned provider from
# TF_PLUGIN_CACHE_DIR. No npm, no expo, no dotnet restore beyond the implicit local cache.
# Runtime ≈ 5–8 min (plan refresh + one postgres container).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-e-prod}}"   # driver exports BASE
fail() { echo "E13 VERIFY FAIL: $*" >&2; exit 1; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/e13-verify.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
export TF_PLUGIN_CACHE_DIR="${TF_PLUGIN_CACHE_DIR:-$HOME/.terraform.d/plugin-cache}"
mkdir -p "$TF_PLUGIN_CACHE_DIR"
export TF_IN_AUTOMATION=1
export AWS_PROFILE="${AWS_PROFILE:-dev}"
export AWS_REGION=ap-southeast-2 AWS_DEFAULT_REGION=ap-southeast-2
BUCKET=developercards-analytics-622994489535
TFSTATE_BUCKET=recallsmith-tfstate-622994489535
TFSTATE_KEY=envs/prod/terraform.tfstate

ANALYTICS_TF=infra/modules/data/analytics.tf
DATA_VARS=infra/modules/data/variables.tf
DATA_OUTS=infra/modules/data/outputs.tf
ID_POLICIES=infra/modules/identity/policies.tf
ID_MAIN=infra/modules/identity/main.tf
ID_VARS=infra/modules/identity/variables.tf
PROD_MAIN=infra/envs/prod/main.tf
PROD_VARS=infra/envs/prod/variables.tf
PROD_EXAMPLE=infra/envs/prod/prod.auto.tfvars.example
INFRA_README=infra/README.md
CHECK_PLAN=infra/scripts/check-plan.py
PE=src_C/Vpc/Runtime/ProgressEvents.cs
OP=src_C/Vpc/Analytics/OutboxPublisher.cs
IE=src_C/Vpc/Internal/InternalEvents.cs
ENVJSON=src_C/env/prod.env.json
DEPLOY=src_C/deploy.sh
MERGE=src_C/scripts/merge-env.sh
CI=src_C/Vpc/Analytics/ContentIntelligenceSnapshotImport.cs
LOGCS=src_C/Shared/RecallSmith.Lambda.Common/Log.cs
TESTDIR=src_C/Tests/RecallSmith.Lambda.IntegrationTests
SALTT=$TESTDIR/HashUserIdSaltTests.cs
SQL1=snowflake/001_content_intelligence_setup.sql
SQL2=snowflake/002_snapshot_export.sql
SFREADME=snowflake/README.md
ALLOW=docs/delivery/r16-issues/E13.plan-allow.json

count() { grep -Ec "$1" "$2" || true; }     # ERE count, 0 when no match
fcount() { grep -Fc "$1" "$2" || true; }    # fixed-string count, 0 when no match
lineof() { grep -Fn "$1" "$2" | head -1 | cut -d: -f1; }

MB="$(git merge-base "$BASE_REF" HEAD 2>/dev/null || git merge-base "origin/$BASE_REF" HEAD 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"

# ── 1. Scope files exist (FAILS ON BASE) + queue prerequisites ─────────────
echo "[1/5] scope files exist (+ E01/E04/E05/E06/E10/E12 prerequisites)"
for f in "$ANALYTICS_TF" "$SQL2" "$SALTT" "$ALLOW"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
[ -f "$CHECK_PLAN" ]   || fail "$CHECK_PLAN missing — E01 must be merged before E13 (E00 §4)"
[ -f "$ID_POLICIES" ]  || fail "$ID_POLICIES missing — E05 must be merged before E13"
[ -f infra/modules/identity/ssm.tf ] || fail "identity/ssm.tf missing — E06 must be merged before E13"
[ -f "$ENVJSON" ]      || fail "$ENVJSON missing — E06 must be merged before E13"
[ -f infra/envs/staging/main.tf ] || fail "infra/envs/staging missing — E10 must be merged before E13"
[ -f "$IE" ]           || fail "$IE missing — E12 must be merged before E13"
grep -Fq "PublishBatchAsync" "$OP"       || fail "OutboxPublisher.cs lacks PublishBatchAsync (E04 incomplete)"
grep -Eq "static void Event\(" "$LOGCS"  || fail "Log.cs lacks Log.Event (E04 incomplete)"
for f in "$DATA_VARS" "$DATA_OUTS" "$ID_VARS" "$PROD_MAIN" "$PROD_VARS" "$PROD_EXAMPLE" "$INFRA_README" "$PE" "$OP" "$CI" "$SQL1" "$SFREADME" infra/envs/prod/imports.tf infra/envs/prod/backend.tf; do
  [ -f "$f" ] || fail "$f is missing from the tree"
done
MAPFILE=""
if grep -Fq "analytics-salt" "$DEPLOY" 2>/dev/null; then MAPFILE="$DEPLOY"; fi
if [ -f "$MERGE" ] && grep -Fq "analytics-salt" "$MERGE"; then MAPFILE="${MAPFILE:-$MERGE}"; fi
[ -n "$MAPFILE" ] || fail "neither $DEPLOY nor $MERGE carries the analytics-salt map row"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. analytics.tf — seven count-guarded resources, the pinned attributes, nothing forbidden
for r in aws_s3_bucket aws_s3_bucket_public_access_block aws_s3_bucket_ownership_controls \
         aws_s3_bucket_server_side_encryption_configuration aws_s3_bucket_versioning \
         aws_s3_bucket_lifecycle_configuration aws_s3_bucket_notification; do
  grep -Fq "resource \"$r\" \"analytics\"" "$ANALYTICS_TF" || fail "analytics.tf lacks resource \"$r\" \"analytics\""
done
[ "$(count 'count\s+=\s+var\.analytics_bucket_name == "" \? 0 : 1' "$ANALYTICS_TF")" = "6" ] \
  || fail "analytics.tf: six resources must carry count = var.analytics_bucket_name == \"\" ? 0 : 1"
grep -Eq 'count\s+=\s+var\.analytics_bucket_name != "" && var\.snowpipe_sqs_arn != "" \? 1 : 0' "$ANALYTICS_TF" \
  || fail "analytics.tf: the notification count must be var.analytics_bucket_name != \"\" && var.snowpipe_sqs_arn != \"\" ? 1 : 0"
grep -Eq 'bucket\s+=\s+var\.analytics_bucket_name' "$ANALYTICS_TF" || fail "analytics.tf: bucket = var.analytics_bucket_name"
grep -Eq 'prevent_destroy\s+=\s+true' "$ANALYTICS_TF" || fail "analytics.tf: prevent_destroy = true"
for flag in block_public_acls block_public_policy ignore_public_acls restrict_public_buckets; do
  grep -Eq "$flag\s+=\s+true" "$ANALYTICS_TF" || fail "analytics.tf: $flag = true"
done
grep -Eq 'object_ownership\s+=\s+"BucketOwnerEnforced"' "$ANALYTICS_TF" || fail "analytics.tf: object_ownership = \"BucketOwnerEnforced\""
grep -Eq 'sse_algorithm\s+=\s+"AES256"' "$ANALYTICS_TF" || fail "analytics.tf: sse_algorithm = \"AES256\""
[ "$(count 'status\s+=\s+"Enabled"' "$ANALYTICS_TF")" = "3" ] || fail "analytics.tf: status = \"Enabled\" must appear exactly 3 times (versioning + two rules)"
grep -Eq 'id\s+=\s+"raw-tiering"' "$ANALYTICS_TF"          || fail "analytics.tf: id = \"raw-tiering\""
grep -Eq 'prefix\s+=\s+"raw/"' "$ANALYTICS_TF"             || fail "analytics.tf: prefix = \"raw/\""
grep -Eq '^[[:space:]]+days[[:space:]]+=[[:space:]]+90$' "$ANALYTICS_TF"  || fail "analytics.tf: transition days = 90"
grep -Eq 'storage_class\s+=\s+"GLACIER_IR"' "$ANALYTICS_TF" || fail "analytics.tf: storage_class = \"GLACIER_IR\""
grep -Eq '^[[:space:]]+days[[:space:]]+=[[:space:]]+730$' "$ANALYTICS_TF" || fail "analytics.tf: expiration days = 730"
grep -Eq 'id\s+=\s+"noncurrent-90d"' "$ANALYTICS_TF"       || fail "analytics.tf: id = \"noncurrent-90d\""
grep -Eq 'noncurrent_days\s+=\s+90' "$ANALYTICS_TF"        || fail "analytics.tf: noncurrent_days = 90"
grep -Eq 'days_after_initiation\s+=\s+7' "$ANALYTICS_TF"   || fail "analytics.tf: days_after_initiation = 7"
grep -Eq 'depends_on\s+=\s+\[aws_s3_bucket_versioning\.analytics\]' "$ANALYTICS_TF" || fail "analytics.tf: lifecycle depends_on versioning"
grep -Eq 'queue_arn\s+=\s+var\.snowpipe_sqs_arn' "$ANALYTICS_TF" || fail "analytics.tf: queue_arn = var.snowpipe_sqs_arn"
grep -Eq 'events\s+=\s+\["s3:ObjectCreated:\*"\]' "$ANALYTICS_TF" || fail "analytics.tf: events = [\"s3:ObjectCreated:*\"]"
grep -Eq 'filter_prefix\s+=\s+"raw/review_events/"' "$ANALYTICS_TF" || fail "analytics.tf: filter_prefix = \"raw/review_events/\""
if grep -Eq 'provisioner|local-exec|null_resource|archive_file|kms_master_key_id|force_destroy|^\s*tags\s*=' "$ANALYTICS_TF"; then
  grep -En 'provisioner|local-exec|null_resource|archive_file|kms_master_key_id|force_destroy|^\s*tags\s*=' "$ANALYTICS_TF" >&2 || true
  fail "analytics.tf carries a forbidden construct (E00 §0 / Changes 2)"
fi
# 2b. module interfaces
for v in analytics_bucket_name snowpipe_sqs_arn; do
  grep -Fq "variable \"$v\"" "$DATA_VARS" || fail "data/variables.tf lacks variable \"$v\""
done
[ "$(count 'default[[:space:]]+=[[:space:]]+""' "$DATA_VARS")" -ge 2 ] || fail "data/variables.tf: both E13 variables default to \"\""
grep -Fq 'output "analytics_bucket_arn"'  "$DATA_OUTS" || fail "data/outputs.tf lacks output \"analytics_bucket_arn\""
grep -Fq 'output "analytics_bucket_name"' "$DATA_OUTS" || fail "data/outputs.tf lacks output \"analytics_bucket_name\""
grep -Fq 'variable "analytics_bucket_name"' "$ID_VARS" || fail "identity/variables.tf lacks variable \"analytics_bucket_name\""
# 2c. identity policies
for sym in S3Analytics 'var.analytics_bucket_name' snowflake_read ListAnalyticsPrefix BucketLocation ReadAnalyticsObjects WriteMarts \
           's3:GetBucketLocation' 's3:GetObjectVersion' 'marts/content_intelligence/*' 'raw/review_events/*'; do
  grep -Fq "$sym" "$ID_POLICIES" || fail "identity/policies.tf lacks: $sym"
done
grep -Fq 'resource "aws_iam_policy" "snowflake_read"' "$ID_POLICIES" || fail "identity/policies.tf must hold the aws_iam_policy.snowflake_read block (moved from main.tf if E01 put it there)"
! grep -Fq 'resource "aws_iam_policy" "snowflake_read"' "$ID_MAIN" || fail "identity/main.tf still holds the snowflake_read block"
if ! git diff --quiet "$MB" HEAD -- "$ID_MAIN"; then
  [ "$(git diff --numstat "$MB" HEAD -- "$ID_MAIN" | cut -f1)" = "0" ] || fail "identity/main.tf may only lose the moved snowflake_read block (zero added lines)"
fi
# 2d. prod root wiring
[ "$(count 'analytics_bucket_name[[:space:]]+=[[:space:]]+"developercards-analytics-622994489535"' "$PROD_MAIN")" = "1" ] || fail "envs/prod/main.tf: the bucket name local must appear exactly once"
[ "$(count 'analytics_bucket_name[[:space:]]+=[[:space:]]+local\.analytics_bucket_name' "$PROD_MAIN")" = "2" ] || fail "envs/prod/main.tf: analytics_bucket_name = local.analytics_bucket_name must be passed to identity and data (2)"
[ "$(count 'snowpipe_sqs_arn[[:space:]]+=[[:space:]]+var\.snowpipe_sqs_arn' "$PROD_MAIN")" = "1" ] || fail "envs/prod/main.tf: snowpipe_sqs_arn = var.snowpipe_sqs_arn once"
grep -Fq '"analytics-salt"' "$PROD_MAIN" "$PROD_VARS" "$PROD_EXAMPLE" || fail "\"analytics-salt\" must be appended to the prod secret_parameter_names list"
grep -Fq 'variable "snowpipe_sqs_arn"' "$PROD_VARS" || fail "envs/prod/variables.tf lacks variable \"snowpipe_sqs_arn\""
grep -Fq 'snowpipe_sqs_arn' "$PROD_EXAMPLE"          || fail "prod.auto.tfvars.example lacks snowpipe_sqs_arn"
grep -Eq '^- .*E13' "$INFRA_README"                   || fail "infra/README.md §6 lacks the E13 line"
# 2e. ProgressEvents — the salted hash, one hunk, old method removed verbatim, call site intact
grep -Fq 'internal static string HashUserId(string userSub, string? salt)' "$PE" || fail "ProgressEvents.cs lacks the internal HashUserId(sub, salt) overload"
grep -Fq 'private static string HashUserId(string userSub) => HashUserId(userSub, AnalyticsSalt.Value);' "$PE" || fail "ProgressEvents.cs lacks the delegating HashUserId(sub)"
grep -Fq '"ANALYTICS_USER_SALT"' "$PE"          || fail "ProgressEvents.cs does not read ANALYTICS_USER_SALT"
grep -Fq 'tag = "analytics-salt-missing"' "$PE"  || fail "ProgressEvents.cs lacks the analytics-salt-missing warn"
grep -Fq 'salt + userSub' "$PE"                 || fail "ProgressEvents.cs: the input must be salt + userSub"
grep -Fq 'var userIdHash = HashUserId(userSub);' "$PE" || fail "ProgressEvents.cs: the call site must stay HashUserId(userSub)"
git show "$MB:$PE" > "$TMP/pe.base.cs"
old_start="$(grep -Fn 'private static string HashUserId(string userSub)' "$TMP/pe.base.cs" | head -1 | cut -d: -f1)"
[ -n "$old_start" ] || fail "merge base lacks the old HashUserId (wrong BASE_REF?)"
sed "${old_start},$((old_start + 4))d" "$TMP/pe.base.cs" > "$TMP/pe.base.stripped"
lazy_line="$(grep -Fn 'private static readonly Lazy<string?> AnalyticsSalt' "$PE" | head -1 | cut -d: -f1)"
[ -n "$lazy_line" ] || fail "ProgressEvents.cs lacks the AnalyticsSalt Lazy"
region_start="$lazy_line"
while [ "$region_start" -gt 1 ] && sed -n "$((region_start - 1))p" "$PE" | grep -Eq '^[[:space:]]*///'; do region_start=$((region_start - 1)); done
region_end="$(grep -Fn 'private static string HashUserId(string userSub) => HashUserId(userSub, AnalyticsSalt.Value);' "$PE" | head -1 | cut -d: -f1)"
[ "$region_end" -gt "$region_start" ] || fail "ProgressEvents.cs: the delegating HashUserId must close the region"
sed "${region_start},${region_end}d" "$PE" > "$TMP/pe.head.stripped"
diff -q "$TMP/pe.base.stripped" "$TMP/pe.head.stripped" >/dev/null \
  || { diff "$TMP/pe.base.stripped" "$TMP/pe.head.stripped" | head -20 >&2; fail "ProgressEvents.cs: only the HashUserId region (old five lines → new region) may differ from the merge base"; }
# 2f. OutboxPublisher — add-only retention delete
grep -Fq 'public static async Task<int> DeleteSentOlderThanAsync(NpgsqlConnection conn, int days = 30)' "$OP" || fail "OutboxPublisher.cs lacks DeleteSentOlderThanAsync signature"
grep -Fq "where status = 'sent'" "$OP"                                   || fail "OutboxPublisher.cs: retention must filter status = 'sent'"
grep -Fq "sent_at < now() - make_interval(days => \$1::int)" "$OP"       || fail "OutboxPublisher.cs: retention predicate literal"
grep -Fq 'ArgumentOutOfRangeException' "$OP"                             || fail "OutboxPublisher.cs: days < 1 must throw ArgumentOutOfRangeException"
op_removed="$(git diff --numstat "$MB" HEAD -- "$OP" | cut -f2)"
[ "${op_removed:-0}" = "0" ] || fail "OutboxPublisher.cs must be add-only in E13 (removed=$op_removed)"
# 2g. InternalEvents — retention before the gauge
grep -Fq 'OutboxPublisher.DeleteSentOlderThanAsync(' "$IE" || fail "InternalEvents.cs does not call OutboxPublisher.DeleteSentOlderThanAsync"
grep -Fq 'days: 30' "$IE"                                  || fail "InternalEvents.cs: days: 30"
grep -Fq 'retentionDeleted' "$IE"                          || fail "InternalEvents.cs: the counts must carry retentionDeleted"
del_line="$(lineof 'DeleteSentOlderThanAsync(' "$IE")"; gauge_line="$(lineof 'EmitGauge("OutboxPending"' "$IE")"
[ -n "$gauge_line" ] || fail "InternalEvents.cs lacks EmitGauge(\"OutboxPending\" (E12 incomplete)"
[ "$del_line" -lt "$gauge_line" ] || fail "InternalEvents.cs: the retention delete must precede EmitGauge(\"OutboxPending\")"
[ "$(git diff -U0 "$MB" HEAD -- "$IE" | grep -c '^@@' || true)" -le 3 ] || fail "InternalEvents.cs: at most three hunks (the outbox/publish handler only)"
# 2h. prod.env.json — four keys, every base key kept, no secret
git show "$MB:$ENVJSON" > "$TMP/env.base.json"
python3 - "$ENVJSON" "$TMP/env.base.json" "$BUCKET" <<'PY' || fail "prod.env.json check failed"
import json, sys
cur = json.load(open(sys.argv[1])); base = json.load(open(sys.argv[2])); bucket = sys.argv[3]
want = {"ANALYTICS_S3_BUCKET": bucket, "ANALYTICS_S3_PREFIX": "raw/review_events",
        "CI_SNAPSHOT_BUCKET": bucket, "CI_SNAPSHOT_KEY": "marts/content_intelligence/card_snapshot_30d/latest.json.gz"}
bad = [k for k, v in want.items() if cur.get(k) != v]
if bad: print("prod.env.json wrong/missing: %s" % bad); sys.exit(1)
lost = [k for k in base if k not in cur]
if lost: print("prod.env.json dropped base keys: %s" % lost); sys.exit(1)
for k in cur:
    if "SECRET" in k or "PASSWORD" in k or "SALT" in k:
        print("prod.env.json must not carry a secret-looking key: " + k); sys.exit(1)
PY
# 2i. the env→SSM map row
grep -Eq 'analytics-salt.*ANALYTICS_USER_SALT|ANALYTICS_USER_SALT.*analytics-salt' "$MAPFILE" || fail "$MAPFILE: analytics-salt and ANALYTICS_USER_SALT must share one map line"
bash -n "$DEPLOY" || fail "deploy.sh does not parse"
[ ! -f "$MERGE" ] || bash -n "$MERGE" || fail "merge-env.sh does not parse"
map_added="$(git diff -U0 "$MB" HEAD -- "$DEPLOY" "$MERGE" | grep -E '^\+[^+]' | sed 's/^+//' || true)"
if printf '%s\n' "$map_added" | grep -Eq '(^|[^A-Za-z0-9_-])aws[[:space:]]|terraform'; then fail "the map file's added lines must not invoke aws/terraform"; fi
# 2j. tests — two classes, the eight method names, a generated theory
for sym in 'public class HashUserIdSaltTests' '[Collection(PostgresCollection.Name)]' 'public class OutboxRetentionTests' \
           '[Theory]' '[MemberData(nameof(GeneratedCases))]' 'analytics_event_outbox' \
           'NoSalt_MatchesLegacySha256Hex' 'EmptySalt_MatchesLegacySha256Hex' 'Salt_IsPrependedToSub' 'Salt_ChangesTheHash' \
           'Salted_IsDeterministicDistinctAndHex' 'DeleteSentOlderThan_RemovesOnlyOldSentRows' 'DeleteSentOlderThan_IsIdempotent' \
           'DeleteSentOlderThan_RejectsNonPositiveDays'; do
  grep -Fq "$sym" "$SALTT" || fail "HashUserIdSaltTests.cs lacks: $sym"
done
# 2k. snowflake 001 — line 1 only
[ "$(sed -n 1p "$SQL1")" = "-- DeveloperCards Content Intelligence Snowflake setup." ] || fail "001:1 must be the DeveloperCards header"
[ "$(git diff --numstat "$MB" HEAD -- "$SQL1" | cut -f1,2)" = "$(printf '1\t1')" ] || fail "001 numstat must be 1 1 (line 1 only)"
# 2l. snowflake 002 — literals, create-or-replace only, placeholders, the 31-column projection
for sym in 'create or replace view marts.card_snapshot_window' 'create or replace stage marts.snapshot_stage' \
           "s3://<ANALYTICS_BUCKET>/marts/content_intelligence/" 'storage_integration = <STORAGE_INTEGRATION_NAME>' \
           'create or replace task marts.snapshot_export_30d' 'create or replace task marts.snapshot_export_90d' \
           '@marts.snapshot_stage/card_snapshot_30d/latest.json.gz' '@marts.snapshot_stage/card_snapshot_90d/latest.json.gz' \
           'alter task marts.snapshot_export_30d resume' 'alter task marts.snapshot_export_90d resume' \
           'where window_days = 30' 'where window_days = 90' "answer_mode = 'qa'" 'use database <DATABASE_NAME>' \
           "convert_timezone('UTC'" '-- snapshot-columns:begin' '-- snapshot-columns:end'; do
  grep -Fq "$sym" "$SQL2" || fail "002_snapshot_export.sql lacks: $sym"
done
[ "$(fcount 'warehouse = <WAREHOUSE_NAME>' "$SQL2")" -ge 2 ]                       || fail "002: warehouse = <WAREHOUSE_NAME> on both tasks"
[ "$(fcount 'USING CRON 0 1 * * * UTC' "$SQL2")" = "2" ]                           || fail "002: USING CRON 0 1 * * * UTC exactly twice"
[ "$(fcount 'object_construct' "$SQL2")" = "2" ]                                   || fail "002: object_construct exactly twice"
[ "$(fcount 'file_format = (type = json compression = gzip)' "$SQL2")" = "2" ]     || fail "002: file_format = (type = json compression = gzip) twice"
[ "$(fcount 'single = true' "$SQL2")" = "2" ]                                      || fail "002: single = true twice"
[ "$(fcount 'overwrite = true' "$SQL2")" = "2" ]                                   || fail "002: overwrite = true twice"
[ "$(grep -Fc -- '-- snapshot-columns:begin' "$SQL2" || true)" = "1" ] || fail "002: -- snapshot-columns:begin exactly once"
[ "$(grep -Fc -- '-- snapshot-columns:end' "$SQL2" || true)" = "1" ]   || fail "002: -- snapshot-columns:end exactly once"
if grep -Ei '^\s*create ' "$SQL2" | grep -Eiv '^\s*create or replace '; then fail "002: every create must be create or replace"; fi
grep -Eiq 'if not exists' "$SQL2" && fail "002: no if not exists"
grep -oE '<[A-Z_]+>' "$SQL2" | sort -u > "$TMP/ph2.txt"
printf '%s\n' '<ANALYTICS_BUCKET>' '<ANALYTICS_PREFIX>' '<DATABASE_NAME>' '<STORAGE_INTEGRATION_NAME>' '<WAREHOUSE_NAME>' | sort > "$TMP/ph1.txt"
[ -z "$(comm -23 "$TMP/ph2.txt" "$TMP/ph1.txt")" ] || { comm -23 "$TMP/ph2.txt" "$TMP/ph1.txt" >&2; fail "002 uses a placeholder 001 does not define"; }
sed -n '/-- snapshot-columns:begin/,/-- snapshot-columns:end/p' "$SQL2" | grep -v 'snapshot-columns' > "$TMP/cols.txt"
[ "$(grep -c . "$TMP/cols.txt")" = "31" ] || fail "002: the projection must be exactly 31 non-blank lines, got $(grep -c . "$TMP/cols.txt")"
grep -Eiq 'cast\(' "$TMP/cols.txt" && fail "002: no cast( in the projection (use ::)"
[ "$(grep -Ecv '^[[:space:]]+.+ as [a-z_]+,?[[:space:]]*$' "$TMP/cols.txt" || true)" = "0" ] || fail "002: every projection line must be '<expr> as <name>'"
grep -oE ' as [a-z_]+,?[[:space:]]*$' "$TMP/cols.txt" | sed -E 's/^ as //; s/,?[[:space:]]*$//' | sort > "$TMP/view_cols.txt"
grep -oE 'JsonPropertyName\("[a-z_]+"\)' "$CI" | sed -E 's/JsonPropertyName\("//; s/"\)//' | sort > "$TMP/row_cols.txt"
[ "$(wc -l < "$TMP/row_cols.txt" | tr -d ' ')" = "31" ] || fail "CardSnapshotRow no longer has 31 JsonPropertyName columns"
diff "$TMP/view_cols.txt" "$TMP/row_cols.txt" >&2 || fail "002: the view's column set differs from CardSnapshotRow's JsonPropertyName set"
# 2m. snowflake README
for sym in '002_snapshot_export.sql' 'snowpipe_sqs_arn' 'auto_suspend = 60' "$BUCKET" 'raw/review_events' 'analytics-salt' \
           'marts.card_snapshot_window' 'notification_channel'; do
  grep -Fq "$sym" "$SFREADME" || fail "snowflake/README.md lacks: $sym"
done
[ "$(sed -n 1p "$SFREADME")" = "$(git show "$MB:$SFREADME" | sed -n 1p)" ] || fail "snowflake/README.md line 1 (title) must not change (E00 §2.14)"
# 2n. allow file shape (the plan step compares it to the real plan)
python3 - "$ALLOW" <<'PY' || fail "E13.plan-allow.json shape check failed"
import json, re, sys
a = json.load(open(sys.argv[1]))
if a.get("tags_only_updates", False) is not False: print("tags_only_updates must be false"); sys.exit(1)
for k in ("expect_imports", "outputs"):
    if k in a: print(k + " must be absent"); sys.exit(1)
ch = a.get("changes") or {}
creates = ["module.data.aws_s3_bucket.analytics[0]", "module.data.aws_s3_bucket_public_access_block.analytics[0]",
           "module.data.aws_s3_bucket_ownership_controls.analytics[0]",
           "module.data.aws_s3_bucket_server_side_encryption_configuration.analytics[0]",
           "module.data.aws_s3_bucket_versioning.analytics[0]", "module.data.aws_s3_bucket_lifecycle_configuration.analytics[0]",
           'module.identity.aws_ssm_parameter.secret["analytics-salt"]']
updates = [r"^module\.identity\.aws_iam_policy\.snowflake_read(\[0\])?$", r"^module\.identity\.aws_iam_role_policy\.core_vpc(\[0\])?$"]
for c in creates:
    if ch.get(c) != "create": print("missing/incorrect create: " + c); sys.exit(1)
rest = [k for k in ch if k not in creates]
if len(rest) != 2: print("expected exactly two update entries, got %s" % rest); sys.exit(1)
for pat in updates:
    hits = [k for k in rest if re.match(pat, k)]
    if len(hits) != 1: print("expected one entry matching %s" % pat); sys.exit(1)
    spec = ch[hits[0]]
    if not isinstance(spec, dict) or spec.get("action") != "update" or spec.get("keys") != ["policy"]:
        print("update entry must be {action: update, keys: [policy]}: " + hits[0]); sys.exit(1)
if any("aws_s3_bucket_notification" in k for k in ch): print("the notification must not be in the allow list"); sys.exit(1)
PY
# 2o. suppression / secret-leak / apply guards over the issue's added lines
grep -Eq "Skip *=|#pragma warning disable|\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$SALTT" "$PE" "$OP" "$IE" "$ANALYTICS_TF" "$ID_POLICIES" "$SQL2" \
  && fail "test gutting / suppression found"
added_all="$(git diff -U0 "$MB" HEAD -- . ':(exclude)docs/delivery/r16-issues' | grep -E '^\+[^+]' | sed 's/^+//' || true)"
if printf '%s\n' "$added_all" | grep -Eq '(PGPASSWORD|MIGRATE_SECRET|INTERNAL_SHARED_SECRET|RC_WEBHOOK_AUTH_(PRODUCTION|DEVELOPMENT)|ANALYTICS_USER_SALT)\s*[=:]\s*"[^"$P]'; then
  fail "a secret-looking literal value was added (E00 §5 secret-leak guard)"
fi
if printf '%s\n' "$added_all" | grep -vE '^\s*(#|//|--|\*|/\*|echo )' | grep -Eq 'terraform +(apply|import)|aws +[a-z0-9-]+ +(create|update|delete|put)-'; then
  printf '%s\n' "$added_all" | grep -vE '^\s*(#|//|--|\*|/\*|echo )' | grep -En 'terraform +(apply|import)|aws +[a-z0-9-]+ +(create|update|delete|put)-' >&2 || true
  fail "an added line outside comments invokes a state-changing command (WORKER SAFETY RULE)"
fi

# ── 3. Root gates: fmt, validate (prod + staging), dotnet build ────────────
echo "[3/5] terraform fmt/validate + dotnet build"
terraform fmt -check -recursive infra >/dev/null || { terraform fmt -check -recursive infra >&2 || true; fail "terraform fmt -check -recursive infra"; }
for root in infra/envs/prod infra/envs/staging; do
  ( cd "$root" && terraform init -backend=false -input=false -no-color >/dev/null && terraform validate -no-color >/dev/null ) \
    || fail "terraform init/validate failed in $root"
done
( cd src_C && dotnet build Tests/RecallSmith.Lambda.IntegrationTests -c Debug --nologo >/dev/null ) || fail "dotnet build failed"
python3 -m py_compile "$CHECK_PLAN" || fail "check-plan.py does not compile"

# ── 4. Plan against the real state (read-only) + policy simulation + targeted tests ──
echo "[4/5] terraform plan (real backend, -lock=false) → allow-list → IAM simulation → check-plan.py → xunit"
aws sts get-caller-identity --query Account --output text >/dev/null 2>&1 || fail "AWS credentials missing (export AWS_PROFILE=dev)"
aws s3api head-object --bucket "$TFSTATE_BUCKET" --key "$TFSTATE_KEY" >/dev/null 2>&1 \
  || fail "s3://$TFSTATE_BUCKET/$TFSTATE_KEY unreadable — E01 must be applied by the supervisor before E13's plan can be checked"
[ ! -e infra/envs/prod/backend_override.tf ] || fail "infra/envs/prod/backend_override.tf present — remove the E01-era local-state override before planning (E13 plans against the real state)"
rm -rf "$TMP/infra"; cp -R infra "$TMP/infra"; rm -rf "$TMP"/infra/envs/*/.terraform "$TMP"/infra/envs/*/terraform.tfstate*
PLANROOT="$TMP/infra/envs/prod"
VARARGS=()
if [ -n "${E13_TFVARS:-}" ]; then
  [ -f "$E13_TFVARS" ] || fail "E13_TFVARS=$E13_TFVARS does not exist"
  VARARGS=(-var-file="$E13_TFVARS")
elif [ ! -f "$PLANROOT/prod.auto.tfvars" ]; then
  # Derive a var file from the committed example, then let live read-only lookups supply the two
  # values whose placeholders would otherwise plan a spurious change. Values are never echoed.
  awk '!/^[[:space:]]*(alert_email|snowflake_external_id)[[:space:]]*=/' "$PROD_EXAMPLE" > "$TMP/e13.tfvars"
  VARARGS=(-var-file="$TMP/e13.tfvars")
  if grep -Fq 'variable "snowflake_external_id"' "$PROD_VARS"; then
    ext="$(aws iam get-role --role-name snowflake-recallsmith-s3-role \
            --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals."sts:ExternalId"' --output text 2>/dev/null || true)"
    [ -n "$ext" ] && [ "$ext" != "None" ] && export TF_VAR_snowflake_external_id="$ext"
  fi
  if grep -Fq 'variable "alert_email"' "$PROD_VARS"; then
    mail="$(aws sns list-subscriptions-by-topic --topic-arn arn:aws:sns:ap-southeast-2:622994489535:developercards-alerts \
             --query "Subscriptions[?Protocol=='email'].Endpoint | [0]" --output text 2>/dev/null || true)"
    [ -n "$mail" ] && [ "$mail" != "None" ] && export TF_VAR_alert_email="$mail"
  fi
fi
( cd "$PLANROOT" && terraform init -input=false -reconfigure -no-color >/dev/null 2>"$TMP/init.err" ) \
  || { tail -15 "$TMP/init.err" >&2; fail "terraform init (real backend) failed"; }
( cd "$PLANROOT" && terraform plan -input=false -lock=false -no-color ${VARARGS[@]+"${VARARGS[@]}"} -out="$TMP/e13.tfplan" >/dev/null 2>"$TMP/plan.err" ) \
  || { grep -E '^(Error|│ Error|Planning failed)' "$TMP/plan.err" | head -15 >&2; fail "terraform plan failed"; }
( cd "$PLANROOT" && terraform show -json "$TMP/e13.tfplan" > "$TMP/e13.plan.json" ) || fail "terraform show -json failed"
python3 - "$TMP/e13.plan.json" "$ALLOW" "$TMP/core.json" "$TMP/snow.json" "$MB" <<'PY' || fail "plan allow-list check failed"
import json, re, subprocess, sys
plan = json.load(open(sys.argv[1])); allow = json.load(open(sys.argv[2]))
rules = [
  (r'^module\.data\.aws_s3_bucket\.analytics\[0\]$', 'create', None),
  (r'^module\.data\.aws_s3_bucket_public_access_block\.analytics\[0\]$', 'create', None),
  (r'^module\.data\.aws_s3_bucket_ownership_controls\.analytics\[0\]$', 'create', None),
  (r'^module\.data\.aws_s3_bucket_server_side_encryption_configuration\.analytics\[0\]$', 'create', None),
  (r'^module\.data\.aws_s3_bucket_versioning\.analytics\[0\]$', 'create', None),
  (r'^module\.data\.aws_s3_bucket_lifecycle_configuration\.analytics\[0\]$', 'create', None),
  (r'^module\.identity\.aws_ssm_parameter\.secret\["analytics-salt"\]$', 'create', None),
  (r'^module\.identity\.aws_iam_policy\.snowflake_read(\[0\])?$', 'update', {'policy'}),
  (r'^module\.identity\.aws_iam_role_policy\.core_vpc(\[0\])?$', 'update', {'policy'}),
]
problems = []
effective = [rc for rc in plan.get('resource_changes', []) if rc['change']['actions'] not in (['no-op'], ['read'])]
matched = [None] * len(rules)
for rc in effective:
    addr, actions = rc['address'], rc['change']['actions']
    hit = next((i for i, (pat, _, _) in enumerate(rules) if re.match(pat, addr)), None)
    if hit is None:
        problems.append('unlisted change: %s %s' % (addr, actions)); continue
    if matched[hit] is not None:
        problems.append('two addresses match one rule: %s' % addr); continue
    matched[hit] = rc
    pat, act, keys = rules[hit]
    if actions != [act]:
        problems.append('%s: actions %s, expected [%s]' % (addr, actions, act)); continue
    if keys is not None:
        before = rc['change'].get('before') or {}; after = rc['change'].get('after') or {}
        diff = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
        extra = [k for k in diff if k not in keys]
        print('  %s update keys: %s' % (addr, diff))
        if extra: problems.append('%s: changed keys %s exceed %s' % (addr, extra, sorted(keys)))
for i, (pat, act, _) in enumerate(rules):
    if matched[i] is None: problems.append('missing expected change: %s (%s)' % (pat, act))
for rc in plan.get('resource_changes', []):
    if 'aws_s3_bucket_notification' in rc['address'] and rc['change']['actions'] != ['no-op']:
        problems.append('bucket notification must not be planned while snowpipe_sqs_arn is empty: ' + rc['address'])
for name, ch in (plan.get('output_changes') or {}).items():
    if ch.get('actions') != ['no-op']: problems.append('E13 must not change root output ' + name)
def doc(pat):
    for rc in effective:
        if re.match(pat, rc['address']):
            return json.loads(rc['change']['after']['policy'])
    return None
core = doc(r'^module\.identity\.aws_iam_role_policy\.core_vpc'); snow = doc(r'^module\.identity\.aws_iam_policy\.snowflake_read')
if core is None: problems.append('core_vpc inline policy not planned')
if snow is None: problems.append('snowflake_read policy not planned')
if core is not None:
    json.dump(core, open(sys.argv[3], 'w'))
    sids = [s.get('Sid') for s in core['Statement']]
    if 'S3Analytics' not in sids: problems.append('core_vpc policy lacks Sid S3Analytics')
    if 'arn:aws:s3:::core-vpc/analytics/' in json.dumps(core): problems.append('core_vpc policy still grants core-vpc/analytics/*')
    for s in core['Statement']:
        res = s.get('Resource'); res = res if isinstance(res, list) else [res]
        acts = s.get('Action'); acts = acts if isinstance(acts, list) else [acts]
        if '*' in res and s.get('Sid') != 'Eni': problems.append('Resource * outside Eni: %s' % s.get('Sid'))
        for a in acts:
            if a == '*' or a.endswith(':*'): problems.append('wildcard action %s on %s' % (a, s.get('Sid')))
if snow is not None:
    json.dump(snow, open(sys.argv[4], 'w'))
    if 'core-vpc' in json.dumps(snow): problems.append('snowflake_read still points at core-vpc')
    sids = [s.get('Sid') for s in snow['Statement']]
    for sid in ('ListAnalyticsPrefix', 'BucketLocation', 'ReadAnalyticsObjects', 'WriteMarts'):
        if sid not in sids: problems.append('snowflake_read lacks Sid ' + sid)
    if len(snow['Statement']) != 4: problems.append('snowflake_read must have exactly four statements')
ch = allow.get('changes') or {}
eff = {rc['address'] for rc in effective}
if set(ch) != eff:
    problems.append('E13.plan-allow.json keys differ from the plan: missing %s, extra %s' % (sorted(eff - set(ch)), sorted(set(ch) - eff)))
for addr, spec in ch.items():
    rc = next((r for r in effective if r['address'] == addr), None)
    if rc is None: continue
    act = spec if isinstance(spec, str) else spec.get('action')
    if [act] != rc['change']['actions']: problems.append('allow file action mismatch for ' + addr)
print('effective changes: %d' % len(effective))
for rc in effective: print('  %s %s' % (rc['address'], rc['change']['actions']))
for p in problems: print('PLAN CHECK: ' + p)
sys.exit(1 if problems else 0)
PY
# 4b. IAM simulation of the two planned documents (read-only)
sim() { aws iam simulate-custom-policy --policy-input-list "file://$1" --action-names "$2" --resource-arns "$3" \
          --query 'EvaluationResults[0].EvalDecision' --output text; }
simp() { aws iam simulate-custom-policy --policy-input-list "file://$1" --action-names "$2" --resource-arns "$3" \
          --context-entries "ContextKeyName=s3:prefix,ContextKeyValues=$4,ContextKeyType=string" \
          --query 'EvaluationResults[0].EvalDecision' --output text; }
CORE="$TMP/core.json"; SNOW="$TMP/snow.json"
[ "$(sim "$CORE" s3:PutObject "arn:aws:s3:::$BUCKET/raw/review_events/x")" = allowed ]      || fail "core_vpc: PutObject on the analytics raw prefix must be allowed"
[ "$(sim "$CORE" s3:GetObject "arn:aws:s3:::$BUCKET/marts/content_intelligence/card_snapshot_30d/latest.json.gz")" = allowed ] || fail "core_vpc: GetObject on the snapshot key must be allowed"
[ "$(sim "$CORE" s3:ListBucket "arn:aws:s3:::$BUCKET")" = allowed ]                          || fail "core_vpc: ListBucket on the analytics bucket must be allowed (S3Head)"
[ "$(sim "$CORE" s3:PutObject "arn:aws:s3:::core-vpc/content/x")" = allowed ]                 || fail "core_vpc: PutObject on core-vpc/content/* must stay allowed"
[ "$(sim "$CORE" s3:PutObject "arn:aws:s3:::core-vpc/analytics/x")" = implicitDeny ]          || fail "core_vpc: PutObject on core-vpc/analytics/* must be gone"
[ "$(sim "$SNOW" s3:GetObject "arn:aws:s3:::$BUCKET/raw/review_events/event_type=card_reviewed/dt=2026-01-01/x.jsonl")" = allowed ] || fail "snowflake_read: GetObject on raw/review_events/* must be allowed"
[ "$(sim "$SNOW" s3:PutObject "arn:aws:s3:::$BUCKET/marts/content_intelligence/card_snapshot_30d/latest.json.gz")" = allowed ] || fail "snowflake_read: PutObject on marts/content_intelligence/* must be allowed"
[ "$(sim "$SNOW" s3:GetBucketLocation "arn:aws:s3:::$BUCKET")" = allowed ]                   || fail "snowflake_read: GetBucketLocation must be allowed"
[ "$(simp "$SNOW" s3:ListBucket "arn:aws:s3:::$BUCKET" raw/review_events/x)" = allowed ]     || fail "snowflake_read: ListBucket with s3:prefix raw/review_events/x must be allowed"
[ "$(sim "$SNOW" s3:GetObject "arn:aws:s3:::core-vpc/analytics/raw/review_events/x")" = implicitDeny ] || fail "snowflake_read: core-vpc must be unreachable"
[ "$(sim "$SNOW" s3:PutObject "arn:aws:s3:::$BUCKET/raw/review_events/x")" = implicitDeny ]  || fail "snowflake_read: PutObject on raw/* must be denied"
[ "$(sim "$SNOW" s3:DeleteBucket "arn:aws:s3:::$BUCKET")" = implicitDeny ]                   || fail "snowflake_read: DeleteBucket must be denied"
# 4c. the supervisor's checker on the committed allow file
python3 "$CHECK_PLAN" --plan "$TMP/e13.plan.json" --allow "$ALLOW" > "$TMP/checkplan.out" 2>&1 \
  || { cat "$TMP/checkplan.out" >&2; fail "infra/scripts/check-plan.py rejected the plan against E13.plan-allow.json"; }
grep -q 'PLAN OK' "$TMP/checkplan.out" || { cat "$TMP/checkplan.out" >&2; fail "check-plan.py did not print PLAN OK"; }
rm -f "$TMP"/*.tfplan "$TMP"/*.plan.json "$TMP"/core.json "$TMP"/snow.json
# 4d. targeted xunit (Docker)
( cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests -c Debug --no-build --nologo \
    --filter "FullyQualifiedName~HashUserIdSaltTests|FullyQualifiedName~OutboxRetentionTests" ) || fail "targeted dotnet test failed"

# ── 5. Scope + frozen + OTA guard ──────────────────────────────────────────
echo "[5/5] scope + frozen + OTA guard"
outside="$( { git diff --name-only "$MB" HEAD; git ls-files --others --exclude-standard -- infra src_C/Vpc src_C/Tests src_C/env src_C/scripts src_C/deploy.sh snowflake docs; } \
  | sort -u | grep -Ev '^(infra/modules/data/analytics\.tf|infra/modules/data/variables\.tf|infra/modules/data/outputs\.tf|infra/modules/identity/policies\.tf|infra/modules/identity/main\.tf|infra/modules/identity/variables\.tf|infra/envs/prod/main\.tf|infra/envs/prod/variables\.tf|infra/envs/prod/prod\.auto\.tfvars\.example|infra/README\.md|src_C/Vpc/Runtime/ProgressEvents\.cs|src_C/Vpc/Analytics/OutboxPublisher\.cs|src_C/Vpc/Internal/InternalEvents\.cs|src_C/env/prod\.env\.json|src_C/deploy\.sh|src_C/scripts/merge-env\.sh|src_C/Tests/RecallSmith\.Lambda\.IntegrationTests/HashUserIdSaltTests\.cs|snowflake/002_snapshot_export\.sql|snowflake/README\.md|snowflake/001_content_intelligence_setup\.sql|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside E13 scope"; }
git diff --quiet "$MB" HEAD -- infra/envs/prod/imports.tf infra/envs/prod/backend.tf infra/envs/prod/outputs.tf infra/envs/staging \
  infra/modules/identity/ssm.tf infra/modules/data/buckets.tf infra/modules/api infra/modules/worker infra/modules/edge infra/modules/observability \
  "$CI" src_C/Vpc/VpcFunction.cs src_C/Vpc/Authoring/ContentIntelligence.cs mobile frontend .github scripts \
  || fail "a do-not-touch path changed (imports/backend/outputs, staging, ssm.tf, buckets.tf, other modules, importer, VpcFunction, mobile, frontend, .github, scripts)"
other_tests="$(git diff --name-only "$MB" HEAD -- "$TESTDIR" | grep -v "HashUserIdSaltTests.cs" || true)"
[ -z "$other_tests" ] || { echo "$other_tests" >&2; fail "an existing test file changed — E13 creates HashUserIdSaltTests.cs only (E00 §1.2)"; }
git diff --quiet "$MB" HEAD -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  || fail "frozen mobile file modified"
git diff --quiet "$MB" HEAD -- mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json \
  || fail "OTA manifest set modified"
grep -Fq '"version": "1.6.1"' mobile/app.json || fail "app.json version changed (OTA runtime 1.6.1)"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (next binary)"; fi
[ -z "$(git ls-files infra | grep -E '\.(tfplan|plan\.json)$|generated.*\.tf$|[^e]\.auto\.tfvars$' || true)" ] || fail "a plan / generated / tfvars file is tracked under infra"
[ -z "$(grep -rn 'profile *= *"' infra --include='*.tf' || true)" ] || fail "a provider carries profile = (E00 §0)"

echo "E13 VERIFY OK"
