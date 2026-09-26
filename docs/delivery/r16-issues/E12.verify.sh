#!/usr/bin/env bash
# E12 — scheduler-and-migrations verify. cwd = worktree root. Re-runs the brief's
# five acceptance bullets verbatim; never trusts the worker's report.
#
# FAILS ON BASE at step 1 (src_C/Vpc/Internal/InternalEvents.cs absent).
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - src_C/Vpc/Internal/InternalEvents.cs,
#     src_C/Shared/RecallSmith.Lambda.Db/SchemaVersion.cs,
#     infra/modules/api/scheduler.tf and the three new test classes do not exist
#     on base
#   (step 1 then also checks the E01/E03/E04/E07/E10 prerequisites that are on
#   the integration branch but not on base: infra/envs/prod/main.tf,
#   infra/scripts/check-plan.py, PublishReaper.cs, ManifestBuilder.cs,
#   RouteMetrics.EmitGauge, Log.Event, OutboxPublisher.PublishBatchAsync,
#   Res.ServiceUnavailable, infra/envs/staging/main.tf — E00 §4 orders
#   E01→…→E10→E12).
# Step 2 (literal guards) would also fail on base. Step 3 = root gates
# (terraform fmt/init/validate, dotnet build). Step 4 = the Terraform plan
# (read-only, saved with -out, shown as JSON, checked against the allow-lists)
# plus the targeted xunit classes (Docker). Step 5 = scope + frozen + OTA +
# secret/apply guards; passes on base by design and is never reached there.
#
# WORKER SAFETY RULE: this script only ever runs `terraform init/validate/plan/show`
# and read-only AWS CLI (sts get-caller-identity, s3api head-object, iam get-role,
# sns list-subscriptions-by-topic, iam simulate-custom-policy). The supervisor
# applies plans after the merge. The prod plan reads the real S3 state
# (`init -reconfigure` in a copy of infra/, `plan -lock=false`: no .tflock is
# ever written); the staging plan uses an empty local state through backend_override.tf in the scratch copy (E00 §6 #25). Every *.tfplan /
# *.plan.json lives under a mktemp dir that the EXIT trap deletes: the plan
# JSON carries every adopted Lambda's environment block in clear (E00 §0).
#
# Network: Terraform provider from TF_PLUGIN_CACHE_DIR (6.66.0 cached), AWS
# describe/get/list with AWS_PROFILE=dev, Docker for Testcontainers.
# Runtime ≈ 6–9 min (two plans + one container start).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-e-prod}}"   # driver exports BASE
fail() { echo "E12 VERIFY FAIL: $*" >&2; exit 1; }

export TF_PLUGIN_CACHE_DIR="${TF_PLUGIN_CACHE_DIR:-$HOME/.terraform.d/plugin-cache}"
export TF_IN_AUTOMATION=1
export AWS_PROFILE="${AWS_PROFILE:-dev}"
export AWS_REGION=ap-southeast-2
export AWS_PAGER=""
TMP="$(mktemp -d "${TMPDIR:-/tmp}/e12-verify.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"

# ── files this issue owns ───────────────────────────────────────────────────
IE=src_C/Vpc/Internal/InternalEvents.cs
SV=src_C/Shared/RecallSmith.Lambda.Db/SchemaVersion.cs
VF=src_C/Vpc/VpcFunction.cs
MIG=src_C/Vpc/Db/Migrate.cs
PE=src_C/Vpc/Runtime/ProgressEvents.cs
PJP=src_C/Worker/Services/PublishJobProcessor.cs
CI=src_C/Vpc/Analytics/ContentIntelligenceSnapshotImport.cs
OB=src_C/Vpc/Analytics/OutboxPublisher.cs
WU=src_C/Vpc/Warmup.cs
RES=src_C/Shared/RecallSmith.Lambda.Common/Res.cs
HELPERS=src_C/Vpc/Authoring/Helpers.cs
TESTDIR=src_C/Tests/RecallSmith.Lambda.IntegrationTests
IET=$TESTDIR/InternalEventsTests.cs
SGT=$TESTDIR/SchemaGateTests.cs
MLT=$TESTDIR/MigrateLockTimeoutTests.cs
PJT=$TESTDIR/PublishJobProcessorSchemaTests.cs
CFT=$TESTDIR/ProgressEventsCardFormatTests.cs
ITB=$TESTDIR/IntegrationTestBase.cs
SCHED=infra/modules/api/scheduler.tf
CORE=infra/modules/api/core_vpc.tf
APIVARS=infra/modules/api/variables.tf
APIOUT=infra/modules/api/outputs.tf
ALARMS=infra/modules/observability/alarms.tf
OBSVARS=infra/modules/observability/variables.tf
POLICIES=infra/modules/identity/policies.tf
IDVARS=infra/modules/identity/variables.tf
PRODMAIN=infra/envs/prod/main.tf
STGMAIN=infra/envs/staging/main.tf
README=infra/README.md
ALLOW=docs/delivery/r16-issues/E12.plan-allow.json
ALLOWSTG=docs/delivery/r16-issues/E12.staging.plan-allow.json
MIGDIR=src_C/Vpc/Db/Migrations

# prerequisites from earlier issues (present on the integration branch, absent on base)
REAPER=src_C/Vpc/Authoring/PublishReaper.cs
MB_=src_C/Shared/RecallSmith.Lambda.Db/ManifestBuilder.cs
RM=src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs
LOG=src_C/Shared/RecallSmith.Lambda.Common/Log.cs
CHECK=infra/scripts/check-plan.py

count() { grep -Ec "$1" "$2" || true; }
has() { grep -Fq "$1" "$2"; }
need() { has "$1" "$2" || fail "$2 lacks: $1"; }
absent() { if grep -Fq "$1" "$2"; then grep -Fn "$1" "$2" >&2 || true; fail "$2 must not contain: $1"; fi; }

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ E01/E03/E04/E07/E10 prerequisites)"
for f in "$IE" "$SV" "$SCHED" "$IET" "$SGT" "$MLT" "$ALLOW" "$ALLOWSTG"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
for f in "$VF" "$MIG" "$PE" "$PJP" "$CI" "$OB" "$WU" "$RES" "$HELPERS" "$PJT" "$CFT" "$ITB" \
         "$CORE" "$APIVARS" "$APIOUT" "$ALARMS" "$OBSVARS" "$POLICIES" "$IDVARS" "$PRODMAIN" "$STGMAIN" "$README"; do
  [ -f "$f" ] || fail "$f is missing from the tree"
done
[ -f "$CHECK" ]  || fail "$CHECK missing — E01 must be merged before E12 (E00 §4)"
[ -f "$REAPER" ] || fail "$REAPER missing — E03 must be merged before E12 (E00 §4)"
[ -f "$MB_" ]    || fail "$MB_ missing — E03 must be merged before E12 (E00 §4)"
has "ReapOrphansAsync" "$REAPER"        || fail "PublishReaper.ReapOrphansAsync missing (E03 incomplete)"
has "EmitGauge" "$RM"                   || fail "RouteMetrics.EmitGauge missing (E04 incomplete)"
has "public static void Event(" "$LOG"  || fail "Log.Event missing (E04 incomplete)"
has "PublishBatchAsync" "$OB"           || fail "OutboxPublisher.PublishBatchAsync missing (E04 incomplete)"
has "ServiceUnavailable(" "$RES"        || fail "Res.ServiceUnavailable missing (E07 incomplete)"
has "ErrorEnvelope(" "$HELPERS"          || fail "Helpers.ErrorEnvelope missing (E03 incomplete)"
[ -f "$MIGDIR/021_decks_live_build_id.sql" ] || fail "021_decks_live_build_id.sql missing (E03 incomplete; SchemaVersion.Required = 21 counts it)"
python3 -c 'import json,sys; json.load(open(sys.argv[1])); json.load(open(sys.argv[2]))' "$ALLOW" "$ALLOWSTG" \
  || fail "plan allow files are not valid JSON"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. SchemaVersion.cs — the gate, its constant equals the highest migration file
for sym in 'public static class SchemaVersion' \
           'public const int Required = 21;' \
           'Task<int> ReadAsync(NpgsqlConnection conn)' \
           'Task EnsureAsync(NpgsqlConnection conn)' \
           'Task<int?> ProbeAsync(NpgsqlConnection conn)' \
           'public static bool GatesRoute(string method, string path)' \
           'public static void Reset()' \
           'public sealed class SchemaBehindException : Exception' \
           'select coalesce(max(version), 0) from schema_migrations' \
           '"SchemaBehind"' \
           '"/api/v1/admin/db/"'; do need "$sym" "$SV"; done
highest="$(ls "$MIGDIR" | grep -oE '^[0-9]+' | sed 's/^0*//' | sort -n | tail -1)"
[ "$highest" = "21" ] || fail "highest migration file is $highest, SchemaVersion.Required is pinned to 21 (E00 §2.11)"
# 2b. InternalEvents.cs — E00 §2.11 signatures, the six actions, failure = throw
for sym in 'public static class InternalEvents' \
           'public static bool TryParse(JsonElement evt, out InternalEvent ie)' \
           'public static readonly IReadOnlyDictionary<string, Func<InternalEvent, Task<object>>> Handlers' \
           'Task<APIGatewayProxyResponse> DispatchAsync(InternalEvent ie)' \
           'public sealed record InternalEvent(string Action, JsonElement Args, string? ScheduledTime, string? ScheduleArn, string TraceId)' \
           '"developercards.scheduler"' \
           '"outbox/publish"' '"content-intelligence/import"' '"publish/reap-orphans"' '"manifest/rebuild"' '"db/migrate"' '"health/deep"' \
           '"/internal/"' '"OutboxPending"' 'RouteMetrics.MeasureAsync(' 'InvalidOperationException' \
           'ReapOrphansAsync(' 'ManifestBuilder.RebuildAsync(' 'Migrate.RunAsync(' 'SchemaVersion.Required' \
           '"manifest_current"' '"no_success"' '"object_missing"' '"also"' 'ManifestIsStale('; do need "$sym" "$IE"; done
absent 'VerifyInternalSignature' "$IE"
absent 'requestContext' "$SV"
# 2c. VpcFunction.cs — the internal branch at the top of Handler, the route gate, nothing reordered
need 'InternalEvents.TryParse(evt, out var ie)' "$VF"
need 'SchemaVersion.GatesRoute(' "$VF"
need '"SERVER_NOT_READY_SCHEMA"' "$VF"
need 'using RecallSmith.Lambda.Db;' "$VF"
h="$(grep -n 'public async Task<APIGatewayProxyResponse> Handler(' "$VF" | head -1 | cut -d: -f1)"
t="$(grep -n 'InternalEvents.TryParse(evt, out var ie)' "$VF" | head -1 | cut -d: -f1)"
l="$(grep -n 'var req = new LambdaRequest(evt);' "$VF" | head -1 | cut -d: -f1)"
[ -n "$h" ] && [ -n "$t" ] && [ -n "$l" ] && [ "$t" -gt "$h" ] && [ "$t" -lt "$l" ] \
  || fail "VpcFunction.cs: the TryParse branch must sit inside Handler BEFORE 'var req = new LambdaRequest(evt);' (E00 §2.16)"
for r in '/api/v1/admin/db/migrate' '/api/v1/admin/manifest/rebuild' '/api/v1/sync/progress/events' '/api/v1/admin/analytics/outbox/publish' \
         '/api/v1/admin/analytics/content-intelligence/import' '/api/internal/entitlements/apply'; do need "$r" "$VF"; done
absent '/health/deep' "$VF"
# 2d. Migrate.cs — lock_timeout, 55P03 → MigrationInProgressException → 409, RunAsync core
for sym in 'public const int MigrationLockId = 77889911;' \
           "set lock_timeout = '5s'" \
           'reset lock_timeout' \
           '"55P03"' \
           'MigrationInProgressException' \
           '"MIGRATION_IN_PROGRESS"' \
           'public static async Task<object> RunAsync(NpgsqlConnection conn, bool dryRun)' \
           'pg_advisory_lock($1)' 'pg_advisory_unlock($1)'; do need "$sym" "$MIG"; done
need 'ErrorEnvelope(res, 409, "MIGRATION_IN_PROGRESS"' "$MIG"
# 2e. the two 42703 fallbacks are gone; the gate sits where they were
absent '42703' "$PE"; absent 'withCardFormat' "$PE"; absent 'ingest_card_format_fallback' "$PE"
need 'SchemaVersion.EnsureAsync(conn)' "$PE"; need '"SERVER_NOT_READY_SCHEMA"' "$PE"; need 'BuildIngestSql()' "$PE"
absent '42703' "$PJP"; absent 'CardsSqlLegacy' "$PJP"; absent 'CardsSqlTopicOnly' "$PJP"
need 'SchemaVersion.EnsureAsync(' "$PJP"
[ "$(count 'SchemaVersion\.EnsureAsync\(' "$PJP")" -ge 2 ] || fail "PublishJobProcessor.cs: the gate must run both in ProcessAsync (before acquiring) and in LoadCardsAsync"
# 2f. snapshot import — etag skip + missing-object skip, extracted core
for sym in 'public sealed record SnapshotImportResult(' \
           'Task<SnapshotImportResult> RunAsync(' \
           '"etag_unchanged"' '"object_missing"' \
           "and s3_etag = \$3 and status = 'SUCCEEDED'"; do need "$sym" "$CI"; done
# 2g. warmup probe + outbox loop
need 'SchemaVersion.ProbeAsync(' "$WU"
need 'PublishLoopAsync(' "$OB"
need 'public sealed record OutboxLoopResult(' "$OB"
# 2h. tests — titles, property test, bounded edits of the two existing classes and the fixture
for s in \
  'TryParse_RejectsAnyHttpShapedEvent' \
  'TryParse_RejectsWrongSource' \
  'TryParse_AcceptsSchedulerEvent_WithContextAndAlso' \
  'Dispatch_UnknownAction_Throws' \
  'Dispatch_HealthDeep_ReportsSchemaVersion' \
  'Dispatch_ReapOrphans_WithAlso_ReturnsBothResults' \
  'Dispatch_DbMigrate_DryRun_ListsPending' \
  'ManifestIsStale_Table'; do need "$s" "$IET"; done
need '[MemberData(' "$IET"; need '[Theory]' "$IET"
for s in \
  'Required_EqualsHighestMigrationFile' \
  'ReadAsync_ReportsMaxAppliedVersion' \
  'EnsureAsync_Throws_WhenBehind' \
  'GatesRoute_Table' \
  'Http_WriteRoute_Answers503_WhileBehind' \
  'Http_Health_And_DbRoutes_StayOpen_WhileBehind' \
  'HealthDeep_ReportsBehind'; do need "$s" "$SGT"; done
need '"retry-after"' "$SGT"; need 'SERVER_NOT_READY_SCHEMA' "$SGT"; need 'new VpcFunction().Handler(' "$SGT"
for s in \
  'RunAsync_Throws_MigrationInProgress_Within_LockTimeout' \
  'RunAsync_Resets_LockTimeout_On_The_Session' \
  'HandleDbMigrate_Answers409_WhileLocked' \
  'RunAsync_Succeeds_After_Release'; do need "$s" "$MLT"; done
need 'Migrate.MigrationLockId' "$MLT"; need 'MIGRATION_IN_PROGRESS' "$MLT"
need 'LoadCards_PreTopicSchema_ThrowsSchemaBehind' "$PJT"; need 'LoadCards_TopicOnlySchema_ThrowsSchemaBehind' "$PJT"
need 'LoadCards_FullSchema_ParsesMcqAsOwnedElement' "$PJT"
[ "$(count 'Assert\.ThrowsAsync<SchemaBehindException>' "$PJT")" = "2" ] || fail "PublishJobProcessorSchemaTests: exactly two SchemaBehindException assertions"
absent 'FallsBackToLegacyColumns' "$PJT"; absent 'KeepsTopicAndNullMcq' "$PJT"
absent 'IngestFallsBackToTheLegacyStatement' "$CFT"
need 'WithoutTheMcqColumn_IngestAnswers503SchemaBehind' "$CFT"; need 'SERVER_NOT_READY_SCHEMA' "$CFT"
need 'insert into schema_migrations' "$ITB"
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable|Skip *=|#pragma warning disable" \
  "$IE" "$SV" "$VF" "$MIG" "$PE" "$PJP" "$CI" "$OB" "$WU" "$IET" "$SGT" "$MLT" "$PJT" "$CFT" "$ITB" \
  && fail "test gutting / suppression found"
git diff --quiet "$mb" -- "$RES" "$HELPERS" || fail "Res.cs / Helpers.cs are not E12 files (the 409 goes through E03's Helpers.ErrorEnvelope)"
# 2i. infra literals — E00 §2.11 addresses, names, expressions, placeholders
for sym in 'resource "aws_scheduler_schedule_group" "this"' \
           'name = "developercards-${var.env}"' \
           'resource "aws_iam_role" "scheduler"' \
           '"developercards-${var.env}-scheduler-role"' \
           '"scheduler.amazonaws.com"' \
           '"aws:SourceAccount"' \
           'resource "aws_iam_role_policy" "scheduler_invoke"' \
           '"lambda:InvokeFunction"' \
           'aws_lambda_alias.core_vpc_prod.arn' \
           'resource "aws_scheduler_schedule" "this"' \
           'for_each' \
           '"rate(15 minutes)"' '"cron(0 2 * * ? *)"' '"rate(5 minutes)"' \
           'outbox-publish' 'snapshot-import' 'reap-orphans' \
           'mode = "OFF"' \
           'maximum_event_age_in_seconds = 600' \
           '"<aws.scheduler.scheduled-time>"' '"<aws.scheduler.schedule-arn>"' '"<aws.scheduler.execution-id>"' \
           '"\\u003c"' '"\\u003e"' \
           '"developercards.scheduler"' '"outbox/publish"' '"content-intelligence/import"' '"publish/reap-orphans"' '"manifest/rebuild"' \
           'limit = 5000'; do need "$sym" "$SCHED"; done
grep -Eq 'maximum_retry_attempts +=+ 1' "$SCHED" || fail "scheduler.tf: retry_policy maximum_retry_attempts = 1"
for sym in 'resource "aws_lambda_function_event_invoke_config" "core_vpc_prod"' 'destination_config' 'on_failure' 'async_failure_destination_arn'; do need "$sym" "$CORE"; done
grep -Eq 'maximum_retry_attempts +=+ 1' "$CORE" || fail "core_vpc.tf: event_invoke_config maximum_retry_attempts = 1"
need 'variable "async_failure_destination_arn"' "$APIVARS"
need 'output "schedule_group_name"' "$APIOUT"; need 'output "scheduler_role_arn"' "$APIOUT"
for sym in 'scheduler-errors"' '"AWS/Scheduler"' '"TargetErrorCount"' 'ScheduleGroup' 'var.schedule_group_name'; do need "$sym" "$ALARMS"; done
grep -Eq 'period +=+ 900' "$ALARMS" || fail "alarms.tf: alarm 13 period = 900"
need 'variable "schedule_group_name"' "$OBSVARS"
need '"SnsAlerts"' "$POLICIES"; need '"sns:Publish"' "$POLICIES"; need 'var.alerts_topic_arn' "$POLICIES"
need 'variable "alerts_topic_arn"' "$IDVARS"
grep -Eq 'async_failure_destination_arn += module\.observability\.alerts_topic_arn' "$PRODMAIN" || fail "prod main.tf: api must receive async_failure_destination_arn = module.observability.alerts_topic_arn"
need 'schedule_group_name' "$PRODMAIN"
need 'alerts_topic_arn' "$PRODMAIN"
need 'developercards-alerts' "$PRODMAIN"
grep -Eq '^\| *2026-09-[0-9]{2} *\| *E12 ' "$README" || grep -Eq '2026-09-[0-9]{2}.*E12' "$README" || fail "infra/README.md §6 lacks the dated E12 line"
grep -rn 'profile *= *"' infra --include='*.tf' | grep -v '^Binary' && fail "no provider profile in .tf (E00 §0)"
grep -rEn 'provisioner|local-exec|null_resource|"external"|archive_file' infra --include='*.tf' && fail "forbidden Terraform constructs (E00 §0)"
# 2j. the allow files carry exactly the E12 address set (the alarm's address follows E04's naming)
python3 - "$ALLOW" "$ALLOWSTG" <<'PY' || fail "plan allow files do not match the E12 address set"
import json, re, sys
prod = json.load(open(sys.argv[1])); stg = json.load(open(sys.argv[2]))
base = {
  'module.api.aws_scheduler_schedule_group.this': 'create',
  'module.api.aws_iam_role.scheduler': 'create',
  'module.api.aws_iam_role_policy.scheduler_invoke': 'create',
  'module.api.aws_scheduler_schedule.this["outbox-publish"]': 'create',
  'module.api.aws_scheduler_schedule.this["snapshot-import"]': 'create',
  'module.api.aws_scheduler_schedule.this["reap-orphans"]': 'create',
  'module.api.aws_lambda_function_event_invoke_config.core_vpc_prod': 'create',
}
alarm_re = re.compile(r'^module\.observability\.aws_cloudwatch_metric_alarm\.(scheduler_errors(\[0\])?|[a-z_]+\["scheduler-errors"\])$')
def check(allow, want_alarm, want_policy):
    ch = allow.get('changes', {})
    if allow.get('tags_only_updates') is not False: return 'tags_only_updates must be false'
    if 'expect_imports' in allow or 'outputs' in allow: return 'no expect_imports / outputs for E12'
    seen_alarm = False; seen_policy = False
    for addr, act in ch.items():
        if addr in base:
            if act != base[addr]: return f'{addr}: expected create'
        elif alarm_re.match(addr):
            if act != 'create' or not want_alarm: return f'{addr}: unexpected'
            seen_alarm = True
        elif addr == 'module.identity.aws_iam_role_policy.core_vpc':
            if not want_policy: return f'{addr}: staging never updates the identity policy'
            if not (isinstance(act, dict) and act.get('action') == 'update' and set(act.get('keys', [])) <= {'policy'}): return f'{addr}: must be update with keys ⊆ [policy]'
            seen_policy = True
        else:
            return f'{addr}: not an E12 address'
    if set(base) - set(ch): return 'missing: ' + ', '.join(sorted(set(base) - set(ch)))
    if want_alarm and not seen_alarm: return 'prod allow file lacks alarm 13'
    if want_policy and not seen_policy: return 'prod allow file lacks the identity policy update'
    return None
for name, allow, a, p in (('prod', prod, True, True), ('staging', stg, False, False)):
    err = check(allow, a, p)
    if err: print(name + ': ' + err); sys.exit(1)
print('allow files ok')
PY
# 2k. the fixture's bounded edit (E00 §1.2 names only E14 for this file; E12's four lines are recorded in the brief)
itb_ns="$(git diff --numstat "$mb" -- "$ITB" | cut -f1,2)"
if [ -n "$itb_ns" ]; then
  [ "$(printf '%s' "$itb_ns" | cut -f2)" = "0" ] || fail "IntegrationTestBase.cs: E12 adds lines only (numstat '$itb_ns'); E14 owns LambdaHost"
  [ "$(printf '%s' "$itb_ns" | cut -f1)" -le 8 ] || fail "IntegrationTestBase.cs: at most 8 added lines (numstat '$itb_ns')"
  git diff -U0 "$mb" -- "$ITB" | grep -E '^\+[^+]' | grep -Fq 'insert into schema_migrations' || fail "IntegrationTestBase.cs: the added lines must record versions in schema_migrations"
fi

# ── 3. Root gates (infra + src_C) ───────────────────────────────────────────
echo "[3/5] terraform fmt/init/validate (prod + staging) and dotnet build"
terraform fmt -check -recursive infra || fail "terraform fmt -check -recursive infra (E00 §6 #21)"
for envdir in infra/envs/prod infra/envs/staging; do
  ( cd "$envdir" && terraform init -backend=false -input=false >/dev/null && terraform validate && terraform fmt -check -recursive .. ) \
    || fail "terraform init -backend=false / validate / fmt failed in $envdir"
done
( cd src_C && dotnet build RecallSmith.Lambda.sln -c Release -nologo ) || fail "dotnet build failed"

# ── 4. The plan (read-only) + targeted tests ───────────────────────────────
echo "[4/5] terraform plan (saved, shown as JSON, checked) and targeted dotnet test"
aws sts get-caller-identity --query Account --output text >"$TMP/acct" 2>/dev/null || fail "AWS_PROFILE=$AWS_PROFILE has no credentials (read-only plan needs them)"
[ "$(tr -d '[:space:]' <"$TMP/acct")" = "622994489535" ] || fail "wrong AWS account for the plan"
STATE_BUCKET=recallsmith-tfstate-622994489535
aws s3api head-object --bucket "$STATE_BUCKET" --key envs/prod/terraform.tfstate >/dev/null 2>&1 \
  || fail "s3://$STATE_BUCKET/envs/prod/terraform.tfstate unreadable — E01–E10 must be applied by the supervisor before E12's plan can be checked"
# Plans run in a COPY of infra/ so the worktree's .terraform (root gate, -backend=false) is untouched.
rm -rf "$TMP/infra"; mkdir -p "$TMP/infra"
( cd infra && tar cf - --exclude=.terraform --exclude='*.tfplan' --exclude='*.plan.json' . ) | ( cd "$TMP/infra" && tar xf - )
PRODROOT="$TMP/infra/envs/prod"; STGROOT="$TMP/infra/envs/staging"
# prod variables: the real prod.auto.tfvars is gitignored. Derive one from the committed example and let two
# read-only lookups supply the values whose placeholders would plan a spurious change. Never echoed.
PRODVARS=()
if [ ! -f "$PRODROOT/prod.auto.tfvars" ]; then   # (the supervisor's real file, if present, is auto-loaded)
  awk '!/^[[:space:]]*(alert_email|snowflake_external_id)[[:space:]]*=/' "$PRODROOT/prod.auto.tfvars.example" >"$TMP/e12.tfvars"
  PRODVARS=(-var-file="$TMP/e12.tfvars")
  if grep -Fq 'variable "snowflake_external_id"' "$PRODROOT/variables.tf" && [ -z "${TF_VAR_snowflake_external_id:-}" ]; then
    ext="$(aws iam get-role --role-name snowflake-recallsmith-s3-role \
            --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals."sts:ExternalId"' --output text 2>/dev/null || true)"
    [ -n "$ext" ] && [ "$ext" != "None" ] && export TF_VAR_snowflake_external_id="$ext"
  fi
  if grep -Fq 'variable "alert_email"' "$PRODROOT/variables.tf" && [ -z "${TF_VAR_alert_email:-}" ]; then
    mail="$(aws sns list-subscriptions-by-topic --topic-arn arn:aws:sns:ap-southeast-2:622994489535:developercards-alerts \
             --query "Subscriptions[?Protocol=='email'].Endpoint | [0]" --output text 2>/dev/null || true)"
    [ -n "$mail" ] && [ "$mail" != "None" ] && export TF_VAR_alert_email="$mail"
  fi
fi
# 4a-prod. real backend, read-only: init reads the state object, `plan -lock=false` never writes the .tflock;
#          the same allow file the supervisor uses (E00 §3.1) — strict.
( cd "$PRODROOT" && terraform init -input=false -reconfigure -no-color >/dev/null 2>"$TMP/init-prod.err" ) \
  || { tail -15 "$TMP/init-prod.err" >&2; fail "prod: terraform init (real backend, read-only) failed"; }
( cd "$PRODROOT" && terraform plan -input=false -lock=false -no-color ${PRODVARS[@]+"${PRODVARS[@]}"} -out="$TMP/E12.prod.tfplan" >/dev/null 2>"$TMP/plan-prod.err" ) \
  || { grep -E '^(Error|│ Error|Planning failed)' "$TMP/plan-prod.err" | head -15 >&2; fail "prod: terraform plan failed"; }
( cd "$PRODROOT" && terraform show -json "$TMP/E12.prod.tfplan" >"$TMP/E12.prod.plan.json" ) || fail "prod: terraform show -json failed"
python3 "$CHECK" --plan "$TMP/E12.prod.plan.json" --allow "$ALLOW" || fail "prod: plan does not match $ALLOW"
# 4a-staging. empty local state through E01's gitignored backend_override.tf written into the SCRATCH copy
#             (E00 §6 #25 mode a; `init -backend=false` cannot serve `plan`), with the committed example vars:
#             every effective action must be `create` (the root was born in E10 and has no imports.tf),
#             nothing may be updated/replaced/destroyed, and the seven E12 addresses must be present.
printf 'terraform {\n  backend "local" {\n    path = "%s/e12-staging.tfstate"\n  }\n}\n' "$TMP" > "$STGROOT/backend_override.tf"
( cd "$STGROOT" && terraform init -input=false -reconfigure -no-color >/dev/null 2>"$TMP/init-stg.err" ) \
  || { tail -15 "$TMP/init-stg.err" >&2; fail "staging: terraform init (local override) failed"; }
( cd "$STGROOT" && terraform plan -input=false -lock=false -no-color -var-file=staging.auto.tfvars.example -out="$TMP/E12.staging.tfplan" >/dev/null 2>"$TMP/plan-stg.err" ) \
  || { grep -E '^(Error|│ Error|Planning failed)' "$TMP/plan-stg.err" | head -15 >&2; fail "staging: terraform plan failed"; }
( cd "$STGROOT" && terraform show -json "$TMP/E12.staging.tfplan" >"$TMP/E12.staging.plan.json" ) || fail "staging: terraform show -json failed"
python3 - "$TMP/E12.staging.plan.json" "$ALLOWSTG" <<'PY' || fail "staging: plan check failed"
import json, sys
plan = json.load(open(sys.argv[1])); allow = json.load(open(sys.argv[2]))['changes']
eff = {rc['address']: rc['change']['actions'] for rc in plan.get('resource_changes', []) if rc['change']['actions'] != ['no-op']}
bad = {a: acts for a, acts in eff.items() if acts != ['create']}
if bad: print('staging: non-create actions:', bad); sys.exit(1)
if any(rc['change'].get('importing') for rc in plan.get('resource_changes', [])): print('staging: importing present'); sys.exit(1)
missing = [a for a in allow if a not in eff]
if missing: print('staging: E12 addresses missing from the plan:', missing); sys.exit(1)
print('staging plan ok:', len(eff), 'creates (empty local state),', len(allow), 'E12 addresses present')
PY
# 4b. content checks on the plan JSON — schedules, role, policy, invoke config, alarm; never prints before/after blobs
python3 - "$TMP/E12.prod.plan.json" "$TMP/E12.staging.plan.json" "$TMP" <<'PY' || fail "plan content checks failed"
import json, sys, os
def load(p): return json.load(open(p))
expect = {
  'outbox-publish':   ('rate(15 minutes)', 'outbox/publish'),
  'snapshot-import':  ('cron(0 2 * * ? *)', 'content-intelligence/import'),
  'reap-orphans':     ('rate(5 minutes)', 'publish/reap-orphans'),
}
def policy_doc(s): return json.loads(s) if isinstance(s, str) else s
def aslist(v): return v if isinstance(v, list) else [v]
for env, path, alias_suffix, want_dest in (('prod', sys.argv[1], ':function:core-vpc:prod', True), ('staging', sys.argv[2], ':function:core-vpc-staging:staging', False)):
    plan = load(path); after = {rc['address']: rc['change'].get('after') for rc in plan['resource_changes'] if rc['change']['actions'] != ['no-op']}
    seen = set()
    for addr, a in after.items():
        if a is None: continue
        if '.aws_scheduler_schedule.this[' in addr:
            key = addr.split('["')[1].rstrip('"]'); seen.add(key)
            expr, action = expect[key]
            assert a['schedule_expression'] == expr, (env, key, 'expression')
            assert a['flexible_time_window'][0]['mode'] == 'OFF', (env, key, 'window')
            assert a['group_name'] == f'developercards-{env}', (env, key, 'group')
            tgt = a['target'][0]
            assert tgt['arn'].endswith(alias_suffix), (env, key, 'target arn')
            assert tgt['retry_policy'][0]['maximum_retry_attempts'] == 1 and tgt['retry_policy'][0]['maximum_event_age_in_seconds'] == 600, (env, key, 'retry')
            inp = json.loads(tgt['input'])
            assert inp['source'] == 'developercards.scheduler' and inp['action'] == action, (env, key, 'input')
            for ph in ('<aws.scheduler.scheduled-time>', '<aws.scheduler.schedule-arn>', '<aws.scheduler.execution-id>'):
                assert ph in tgt['input'], (env, key, 'placeholder', ph)
            assert '\\u003c' not in tgt['input'], (env, key, 'escaped placeholder')
            if key == 'outbox-publish': assert inp['args']['limit'] == 5000
            if key == 'reap-orphans': assert inp.get('also') == ['manifest/rebuild']
        elif addr.endswith('.aws_iam_role_policy.scheduler_invoke'):
            doc = policy_doc(a['policy']); st = doc['Statement']; assert len(st) == 1
            assert aslist(st[0]['Action']) == ['lambda:InvokeFunction'] and all(r.endswith(alias_suffix) for r in aslist(st[0]['Resource'])), (env, 'invoke policy')
            open(os.path.join(sys.argv[3], f'sched-policy-{env}.json'), 'w').write(json.dumps(doc))
        elif addr.endswith('.aws_iam_role.scheduler'):
            trust = a['assume_role_policy']; assert 'scheduler.amazonaws.com' in trust and 'aws:SourceAccount' in trust, (env, 'trust')
            assert a['name'] == f'developercards-{env}-scheduler-role'
        elif addr.endswith('.aws_lambda_function_event_invoke_config.core_vpc_prod'):
            assert a['maximum_retry_attempts'] == 1, (env, 'invoke retries')
            dc = a.get('destination_config') or []
            if want_dest: assert dc and dc[0]['on_failure'][0]['destination'].endswith(':developercards-alerts'), (env, 'destination')
            else: assert not dc, (env, 'staging has no destination')
        elif '.aws_cloudwatch_metric_alarm.' in addr and 'scheduler' in addr:
            assert a['namespace'] == 'AWS/Scheduler' and a['metric_name'] == 'TargetErrorCount' and a['statistic'] == 'Sum'
            assert a['period'] == 900 and float(a['threshold']) == 1 and a['dimensions'] == {'ScheduleGroup': f'developercards-{env}'}, (env, 'alarm 13')
            assert a['alarm_name'] == f'developercards-{env}-scheduler-errors'
        elif addr == 'module.identity.aws_iam_role_policy.core_vpc':
            doc = policy_doc(a['policy']); sids = [s.get('Sid') for s in doc['Statement']]
            assert 'SnsAlerts' in sids, (env, 'SnsAlerts sid')
            s = [s for s in doc['Statement'] if s.get('Sid') == 'SnsAlerts'][0]
            assert aslist(s['Action']) == ['sns:Publish'] and all(r.endswith(':developercards-alerts') for r in aslist(s['Resource']))
            open(os.path.join(sys.argv[3], f'core-policy-{env}.json'), 'w').write(json.dumps(doc))
    assert seen == set(expect), (env, 'schedules present', seen)
print('plan content ok (prod + staging)')
PY
# 4c. read-only IAM simulation of the PLANNED documents (E00 §3.2 pattern)
sim() {  # $1 doc file  $2 action  $3 arn  $4 expected decision   (the document travels as a string argument; file:// would be read as the list itself)
  local d; d="$(aws iam simulate-custom-policy --policy-input-list "$(cat "$1")" --action-names "$2" --resource-arns "$3" --query 'EvaluationResults[0].EvalDecision' --output text)"
  [ "$d" = "$4" ] || fail "simulate-custom-policy $2 on $3 → $d, expected $4"
}
ALIAS=arn:aws:lambda:ap-southeast-2:622994489535:function:core-vpc:prod
sim "$TMP/sched-policy-prod.json" lambda:InvokeFunction "$ALIAS" allowed
sim "$TMP/sched-policy-prod.json" lambda:InvokeFunction arn:aws:lambda:ap-southeast-2:622994489535:function:core-vpc implicitDeny
sim "$TMP/sched-policy-prod.json" lambda:InvokeFunction arn:aws:lambda:ap-southeast-2:622994489535:function:worker-lambda:prod implicitDeny
sim "$TMP/core-policy-prod.json" sns:Publish arn:aws:sns:ap-southeast-2:622994489535:developercards-alerts allowed
sim "$TMP/core-policy-prod.json" sns:Publish arn:aws:sns:ap-southeast-2:622994489535:other-topic implicitDeny
rm -f "$TMP"/*.tfplan "$TMP"/*.plan.json "$TMP"/*.json "$TMP"/*.tfvars; rm -rf "$TMP/infra"
unset TF_VAR_alert_email TF_VAR_snowflake_external_id
# 4d. targeted xunit (Docker)
docker info >/dev/null 2>&1 || fail "Docker daemon is not running — the targeted classes need Testcontainers postgres:16-alpine"
( cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests -c Release --no-build --nologo \
    --filter "FullyQualifiedName~InternalEventsTests|FullyQualifiedName~SchemaGateTests|FullyQualifiedName~MigrateLockTimeoutTests|FullyQualifiedName~PublishJobProcessorSchemaTests|FullyQualifiedName~ProgressEventsCardFormatTests|FullyQualifiedName~ProgressEventsSingleStatementTests|FullyQualifiedName~ProgressEventsIntegrationTests|FullyQualifiedName~DbWarmupTests|FullyQualifiedName~WarmupDecisionTests|FullyQualifiedName~Migration015BackfillTests|FullyQualifiedName~ContentIntelligenceMcqTests" ) \
  || fail "targeted dotnet test failed"

# ── 5. Scope + frozen + OTA + secret/apply guards ──────────────────────────
echo "[5/5] scope + frozen + OTA + secret/apply guards"
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json \
  infra/envs/prod/imports.tf infra/envs/prod/backend.tf infra/envs/prod/versions.tf infra/envs/prod/providers.tf infra/envs/prod/outputs.tf infra/envs/prod/variables.tf \
  src_C/deploy.sh src_C/env src_C/Vpc/SnapStartHooks.cs src_C/Worker/WorkerFunction.cs src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs src_C/Shared/RecallSmith.Lambda.Common/Log.cs \
  "$MIGDIR" .github)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
grep -Fq '"version": "1.6.1"' mobile/app.json || fail "app.json version changed (OTA rule)"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (next binary)"; fi
# the other existing test classes are byte-identical (E00 §1.2)
for f in $(git ls-tree --name-only "$mb" -- "$TESTDIR" | grep -E '\.cs$'); do
  case "$f" in "$PJT"|"$CFT"|"$ITB") ;; *) git diff --quiet "$mb" -- "$f" || fail "existing test file changed: $f (E12 may edit only the three bounded classes)";; esac
done
# scope: every changed or untracked path is one of the E12 files (pathspec-scoped; the driver symlinks node_modules)
outside="$( { git diff --name-only "$mb" HEAD; git ls-files --others --exclude-standard -- src_C infra docs scripts; } | sort -u | grep -Ev '^(src_C/Vpc/Internal/InternalEvents\.cs|src_C/Shared/RecallSmith\.Lambda\.Db/SchemaVersion\.cs|src_C/Vpc/VpcFunction\.cs|src_C/Vpc/Db/Migrate\.cs|src_C/Vpc/Runtime/ProgressEvents\.cs|src_C/Worker/Services/PublishJobProcessor\.cs|src_C/Vpc/Analytics/ContentIntelligenceSnapshotImport\.cs|src_C/Vpc/Analytics/OutboxPublisher\.cs|src_C/Vpc/Warmup\.cs|src_C/Tests/RecallSmith\.Lambda\.IntegrationTests/(InternalEventsTests|SchemaGateTests|MigrateLockTimeoutTests|PublishJobProcessorSchemaTests|ProgressEventsCardFormatTests|IntegrationTestBase)\.cs|infra/modules/api/(scheduler|core_vpc|variables|outputs)\.tf|infra/modules/observability/(alarms|variables)\.tf|infra/modules/identity/(policies|variables)\.tf|infra/envs/prod/main\.tf|infra/envs/staging/main\.tf|infra/README\.md|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside E12 scope"; }
# secret-leak guard over the + lines and the new files
added="$( { git diff -U0 "$mb" -- src_C infra docs scripts | grep -E '^\+[^+]' | sed 's/^+//'; for f in "$IE" "$SV" "$SCHED" "$IET" "$SGT" "$MLT" "$ALLOW" "$ALLOWSTG"; do [ -f "$f" ] && cat "$f"; done; } || true )"
printf '%s\n' "$added" | grep -Eq '(PGPASSWORD|MIGRATE_SECRET|INTERNAL_SHARED_SECRET|RC_WEBHOOK_AUTH_(PRODUCTION|DEVELOPMENT)|ANALYTICS_USER_SALT)\s*[=:]\s*"[^"$P]' \
  && fail "a secret-looking literal value is in the diff"
git ls-files infra | grep -E '\.(tfplan|plan\.json)$|generated.*\.tf$|[^e]\.auto\.tfvars$' && fail "plan / generated / tfvars file tracked"
# apply guard: no worker artefact carries a state-changing command outside comments
printf '%s\n' "$added" | grep -Ev '^\s*(#|//|--|\*|/\*)' | grep -En 'terraform +(apply|import)\b|aws +[a-z0-9-]+ +(create|update|delete|put)-|\beas +(update|build|submit|channel)\b' \
  && fail "worker artefact carries a state-changing command (WORKER SAFETY RULE)"

echo "E12 VERIFY OK"
