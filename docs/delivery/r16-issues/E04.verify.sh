#!/usr/bin/env bash
# E04 — observability verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# FAILS ON BASE at step 1.
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - infra/modules/observability/alerts.tf, alarms.tf, dashboard.tf, api_logs.tf,
#     src_C/Tests/RecallSmith.Lambda.IntegrationTests/LogShapeTests.cs and
#     docs/delivery/r16-issues/E04.plan-allow.json do not exist on base
#   (step 1 then also checks the E01/E03 prerequisites that exist on the
#   integration branch but not on base: infra/envs/prod/main.tf,
#   infra/scripts/check-plan.py, the DLQ in infra/modules/worker/queue.tf and
#   the worker module's publish_dlq_name output — E00 §4 orders E01→E02→E03→E04).
# Step 2 (literal guards: alarm names, thresholds, the access-log format, the
# Log/RouteMetrics/OutboxPublisher signatures, the DeveloperCards namespace, the
# test titles, the allow-list content) would also fail on base. Step 3 is the
# fmt/validate/dotnet-build gate, step 4 the READ-ONLY plan check + targeted
# tests, step 5 the scope + frozen + OTA + apply guard.
#
# WORKER SAFETY RULE (E00 §0): this script runs terraform init/validate/plan
# and read-only AWS CLI only. It never runs terraform apply/import, any
# aws create/update/delete/put, eas, or a deploy script. The plan is the
# E01 gap-13 recipe every infra verify copies: a gitignored local backend
# override under $TMP (the S3 state bucket is never contacted), an EMPTY local
# state, so the plan re-imports the 93 adopted resources and also shows the
# worker-side noise E03's verify names (E02/E03 creates that imports.tf does
# not adopt, the provider-side RDS update, pre-existing root outputs as
# create). Step 4 drops exactly those three kinds, prints what it dropped
# (address + action only) and hands the rest to check-plan.py with the same
# E04.plan-allow.json the supervisor uses unfiltered. The plan file and its
# JSON embed Lambda environments, so they live in the mktemp dir the trap
# removes; nothing prints before/after values.
#
# Needs: AWS_PROFILE=dev (read), terraform >= 1.10 with the cached provider
# (TF_PLUGIN_CACHE_DIR), dotnet 8, Docker (Testcontainers postgres:16-alpine,
# image cached). Runtime: steps 1-2 seconds, step 3 ~1-2 min cold, step 4
# 2-4 min plan (93 imports) + single-digit minutes of tests. The driver's diff-scoped
# banned-term grep and suppression scan run separately; this script does not
# spell the six terms (E00 §0).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-e-prod}}"   # driver exports BASE
fail() { echo "E04 VERIFY FAIL: $*" >&2; exit 1; }
# Collapse blank runs so `terraform fmt` alignment cannot break a literal check.
kv() { sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//' "$1"; }
has_kv() { kv "$1" | grep -Fq -- "$2"; }

export AWS_PROFILE="${AWS_PROFILE:-dev}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-southeast-2}"
export AWS_PAGER=""
export TF_PLUGIN_CACHE_DIR="${TF_PLUGIN_CACHE_DIR:-$HOME/.terraform.d/plugin-cache}"
export TF_IN_AUTOMATION=1
mkdir -p "$TF_PLUGIN_CACHE_DIR"

TMP="$(mktemp -d)"
OVR="infra/envs/prod/backend_override.tf"      # E01 .gitignore line 8; local backend for the worker plan
cleanup() {
  rm -f "$OVR" infra/envs/prod/.terraform/terraform.tfstate 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

OBS=infra/modules/observability
ALERTS=$OBS/alerts.tf
ALARMS=$OBS/alarms.tf
DASH=$OBS/dashboard.tf
APILOGS=$OBS/api_logs.tf
OBSVARS=$OBS/variables.tf
OBSOUTS=$OBS/outputs.tf
GATEWAY=infra/modules/api/gateway.tf
APIVARS=infra/modules/api/variables.tf
ROOTDIR=infra/envs/prod
ROOTMAIN=$ROOTDIR/main.tf
ROOTVARS=$ROOTDIR/variables.tf
ROOTOUTS=$ROOTDIR/outputs.tf
ROOTEX=$ROOTDIR/prod.auto.tfvars.example
README=infra/README.md
CHECK=infra/scripts/check-plan.py
QUEUE=infra/modules/worker/queue.tf
WORKEROUTS=infra/modules/worker/outputs.tf
LOG=src_C/Shared/RecallSmith.Lambda.Common/Log.cs
RM=src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs
OUTBOX=src_C/Vpc/Analytics/OutboxPublisher.cs
VPCFN=src_C/Vpc/VpcFunction.cs
RCWH=src_C/Vpc/Webhooks/RevenuecatWebhook.cs
TESTDIR=src_C/Tests/RecallSmith.Lambda.IntegrationTests
RMT=$TESTDIR/RouteMetricsTests.cs
LST=$TESTDIR/LogShapeTests.cs
DBWT=$TESTDIR/DbWarmupTests.cs
ALLOW=docs/delivery/r16-issues/E04.plan-allow.json
BUDGET=$OBS/budget.tf

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ E01/E03 prerequisites)"
for f in "$ALERTS" "$ALARMS" "$DASH" "$APILOGS" "$LST" "$ALLOW"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
for f in "$ROOTMAIN" "$CHECK" "$QUEUE" "$WORKEROUTS" "$OBSVARS" "$OBSOUTS" "$BUDGET" "$GATEWAY" "$APIVARS" "$ROOTVARS" "$ROOTOUTS" "$ROOTEX" "$README"; do
  [ -f "$f" ] || fail "$f is missing — E01/E02/E03 must be merged before E04 (E00 §4)"
done
grep -Fq 'developercards-publish-jobs-dlq' "$QUEUE" || fail "queue.tf lacks the DLQ (E03 incomplete)"
grep -Fq 'output "publish_dlq_name"' "$WORKEROUTS" || fail "worker outputs lack publish_dlq_name (E03 incomplete)"
for f in "$LOG" "$RM" "$OUTBOX" "$VPCFN" "$RCWH" "$RMT" "$DBWT"; do
  [ -f "$f" ] || fail "$f is missing from the tree"
done

mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. alerts.tf — topic, email subscription, policy principals, RDS event subscription
for sym in 'resource "aws_sns_topic" "alerts"' \
           'name = "developercards-alerts"' \
           'resource "aws_sns_topic_subscription" "alerts_email"' \
           'protocol = "email"' \
           'endpoint = var.alert_email' \
           'resource "aws_sns_topic_policy" "alerts"' \
           '"cloudwatch.amazonaws.com"' \
           '"budgets.amazonaws.com"' \
           '"lambda.amazonaws.com"' \
           '"events.rds.amazonaws.com"' \
           '"scheduler.amazonaws.com"' \
           '"aws:SourceAccount" = var.account_id' \
           'resource "aws_db_event_subscription" "developercards"' \
           'name = "developercards-${var.env}-rds-events"' \
           'source_type = "db-instance"' \
           'source_ids = [var.db_identifier]' \
           '"availability", "backup", "deletion", "failover", "failure", "low storage", "maintenance", "recovery"'; do
  has_kv "$ALERTS" "$sym" || fail "alerts.tf lacks: $sym"
done
# 2b. alarms.tf — twelve alarms, names, metrics, thresholds
for name in api-5xx core-vpc-errors worker-errors core-vpc-throttles worker-throttles core-vpc-duration-p95 \
            sqs-oldest-age dlq-nonempty rds-cpu rds-free-storage rds-connections outbox-backlog; do
  has_kv "$ALARMS" "alarm_name = \"developercards-\${var.env}-$name\"" \
    || fail "alarms.tf lacks alarm_name developercards-\${var.env}-$name"
done
for addr in api_5xx core_vpc_errors worker_errors core_vpc_throttles worker_throttles core_vpc_duration_p95 \
            sqs_oldest_age dlq_nonempty rds_cpu rds_free_storage rds_connections outbox_backlog; do
  grep -Fq "resource \"aws_cloudwatch_metric_alarm\" \"$addr\"" "$ALARMS" || fail "alarms.tf lacks resource address $addr"
done
[ "$(grep -c 'resource "aws_cloudwatch_metric_alarm"' "$ALARMS")" = "12" ] || fail "alarms.tf must define exactly 12 aws_cloudwatch_metric_alarm resources (E12 adds the 13th)"
[ "$(grep -c 'treat_missing_data' "$ALARMS")" = "12" ] || fail "alarms.tf: treat_missing_data must appear exactly 12 times"
[ "$(grep -Ec 'treat_missing_data\s*=\s*"notBreaching"' "$ALARMS")" = "12" ] || fail "alarms.tf: every alarm is treat_missing_data = \"notBreaching\""
for sym in '"AWS/ApiGateway"' '"AWS/Lambda"' '"AWS/SQS"' '"AWS/RDS"' 'var.metrics_namespace' \
           '"5xx"' '"Count"' '"Errors"' '"Throttles"' '"Duration"' '"ApproximateAgeOfOldestMessage"' \
           '"ApproximateNumberOfMessagesVisible"' '"CPUUtilization"' '"FreeStorageSpace"' '"DatabaseConnections"' '"OutboxPending"' \
           'IF(count > 20, e5xx/count, 0)' 'extended_statistic' '"p95"' \
           'ApiId = var.api_id' 'Stage = var.api_stage_name' 'FunctionName = var.core_vpc_function_name' 'FunctionName = var.worker_function_name' \
           'QueueName = var.publish_queue_name' 'QueueName = var.publish_dlq_name' 'DBInstanceIdentifier = var.db_identifier' \
           'aws_sns_topic.alerts.arn'; do
  has_kv "$ALARMS" "$sym" || fail "alarms.tf lacks: $sym"
done
grep -Eq 'threshold\s*=\s*0\.01\b' "$ALARMS"        || fail "alarms.tf: api-5xx threshold 0.01"
grep -Eq 'threshold\s*=\s*3000\b' "$ALARMS"        || fail "alarms.tf: duration p95 threshold 3000"
grep -Eq 'threshold\s*=\s*900\b' "$ALARMS"         || fail "alarms.tf: sqs age threshold 900"
grep -Eq 'threshold\s*=\s*80\b' "$ALARMS"          || fail "alarms.tf: rds cpu threshold 80"
grep -Eq 'threshold\s*=\s*2147483648\b' "$ALARMS"  || fail "alarms.tf: free storage threshold 2147483648"
grep -Eq 'threshold\s*=\s*60\b' "$ALARMS"          || fail "alarms.tf: connections threshold 60"
grep -Eq 'threshold\s*=\s*50000\b' "$ALARMS"       || fail "alarms.tf: outbox threshold 50000"
grep -Eq 'period\s*=\s*3600\b' "$ALARMS"           || fail "alarms.tf: outbox period 3600"
grep -Eq 'period\s*=\s*60\b' "$ALARMS"             || fail "alarms.tf: dlq period 60"
[ "$(grep -Ec 'threshold\s*=\s*1\b' "$ALARMS")" -ge 5 ] || fail "alarms.tf: the four >= 1 Lambda alarms and the DLQ alarm need threshold 1"
[ "$(grep -c 'alarm_actions' "$ALARMS")" = "12" ] && [ "$(grep -c 'ok_actions' "$ALARMS")" = "12" ] || fail "alarms.tf: alarm_actions and ok_actions on all 12"
grep -Eq 'for_each|count\s*=' "$ALARMS" && fail "alarms.tf: twelve literal resources, no for_each/count"
# 2c. dashboard.tf, api_logs.tf
for sym in 'resource "aws_cloudwatch_dashboard" "prod"' 'dashboard_name = "developercards-${var.env}"' 'jsonencode(' \
           '"Invocations"' '"FreeableMemory"' '"ApproximateAgeOfOldestMessage"' '"OutboxPending"' \
           'SORT(SEARCH(' "'p95', 300), MAX, DESC, 10)" 'MetricName=\"Latency\"' 'region = var.region'; do
  has_kv "$DASH" "$sym" || fail "dashboard.tf lacks: $sym"
done
has_kv "$APILOGS" 'resource "aws_cloudwatch_log_group" "api_access"' || fail "api_logs.tf lacks aws_cloudwatch_log_group.api_access"
has_kv "$APILOGS" 'name = "/aws/apigateway/${var.api_name}"' || fail "api_logs.tf: log group name /aws/apigateway/\${var.api_name}"
has_kv "$APILOGS" 'retention_in_days = 30' || fail "api_logs.tf: retention 30"
# 2d. module variables / outputs (append-only; presence, not diff)
for v in alert_email region api_id api_name api_stage_name core_vpc_function_name worker_function_name publish_queue_name publish_dlq_name db_identifier metrics_namespace; do
  grep -Fq "variable \"$v\"" "$OBSVARS" || fail "observability/variables.tf lacks variable $v"
done
has_kv "$OBSVARS" 'default = "DeveloperCards"' || fail "metrics_namespace default DeveloperCards"
for o in alerts_topic_arn api_access_log_group_arn api_access_log_group_name; do
  grep -Fq "output \"$o\"" "$OBSOUTS" || fail "observability/outputs.tf lacks output $o"
done
grep -Fq 'variable "access_log_destination_arn"' "$APIVARS" || fail "api/variables.tf lacks access_log_destination_arn"
# 2e. gateway.tf — both stages log + detailed metrics; the format string verbatim
[ "$(grep -c 'access_log_settings' "$GATEWAY")" = "2" ] || fail "gateway.tf: access_log_settings on exactly the two stages"
[ "$(kv "$GATEWAY" | grep -c 'detailed_metrics_enabled = true')" = "2" ] || fail "gateway.tf: detailed_metrics_enabled = true exactly twice"
[ "$(kv "$GATEWAY" | grep -c 'destination_arn = var.access_log_destination_arn')" = "2" ] || fail "gateway.tf: destination_arn = var.access_log_destination_arn twice"
grep -Fq 'api_access_log_format' "$GATEWAY" || fail "gateway.tf lacks local.api_access_log_format"
FORMAT='{"requestId":"$context.requestId","ip":"$context.identity.sourceIp","requestTime":"$context.requestTime","method":"$context.httpMethod","routeKey":"$context.routeKey","path":"$context.path","status":"$context.status","protocol":"$context.protocol","responseLength":"$context.responseLength","integrationLatency":"$context.integrationLatency","responseLatency":"$context.responseLatency","integrationError":"$context.integrationErrorMessage","authorizerError":"$context.authorizer.error","userAgent":"$context.identity.userAgent"}'
grep -Fq "$FORMAT" "$GATEWAY" || fail "gateway.tf: the access-log JSON format must appear verbatim (E00 §2.4.4, one line)"
grep -Fq 'deployment_id' "$GATEWAY" && fail "gateway.tf: deployment_id must not be set on adopted stages (E00 §2.1.4)"
# 2f. root wiring, variable, output, example, README line
grep -Fq 'variable "alert_email"' "$ROOTVARS" || fail "envs/prod/variables.tf lacks alert_email"
grep -A3 -F 'variable "alert_email"' "$ROOTVARS" | grep -Eq 'sensitive\s*=\s*true' || fail "alert_email must be sensitive = true"
has_kv "$ROOTEX" 'alert_email = "alerts@example.invalid"' || fail "prod.auto.tfvars.example lacks the alert_email placeholder"
grep -Fq 'output "alerts_topic_arn"' "$ROOTOUTS" || fail "envs/prod/outputs.tf lacks alerts_topic_arn"
grep -Fq 'module.observability.alerts_topic_arn' "$ROOTOUTS" || fail "alerts_topic_arn must read module.observability.alerts_topic_arn"
for sym in 'alert_email = var.alert_email' 'api_id = module.api.api_id' 'publish_dlq_name = module.worker.publish_dlq_name' \
           'access_log_destination_arn = module.observability.api_access_log_group_arn' \
           'api_name = "developercards-api"' 'api_stage_name = "$default"' 'core_vpc_function_name = "core-vpc"' \
           'worker_function_name = "worker-lambda"' 'publish_queue_name = "recallsmith-publish-jobs"' 'db_identifier = "developercards"'; do
  has_kv "$ROOTMAIN" "$sym" || fail "envs/prod/main.tf lacks wiring: $sym"
done
grep -Fq 'E04' "$README" || fail "infra/README.md §6 lacks the E04 change-log line"
# budget.tf: the three notification subscribers read var.alert_email; the adopted literal is gone (E02 brief: "E04 swaps the subscriber")
[ "$(kv "$BUDGET" | grep -c 'subscriber_email_addresses = \[var.alert_email\]')" = "3" ] || fail "budget.tf: subscriber_email_addresses = [var.alert_email] on all three notifications"
grep -q '@' "$BUDGET" && fail "budget.tf still carries an e-mail literal"
[ "$(grep -c 'notification {' "$BUDGET")" = "3" ] || fail "budget.tf: exactly three notification blocks (E02 shape)"
grep -rn 'profile *= *"' infra --include='*.tf' 2>/dev/null | grep -q . && fail "provider profile in .tf (E00 §0)"
if git ls-files infra | grep -E '\.(tfplan|plan\.json)$|generated.*\.tf$|[^e]\.auto\.tfvars$' | grep -q .; then
  fail "a plan / generated / tfvars artefact is tracked"
fi
grep -rEn 'provisioner|local-exec|null_resource|"external"|archive_file' infra --include='*.tf' 2>/dev/null | grep -v '^\s*#' | grep -q . && fail "forbidden Terraform construct (E00 §0)"
# 2g. Log.cs
for sym in 'public static bool IsEnabled(string level)' \
           'public static void Debug(params object?[] args)' \
           'public static void Info(params object?[] args)' \
           'public static void Warn(params object?[] args)' \
           'public static void Error(params object?[] args)' \
           'public static void Event(string level, object fields)' \
           '"ts"' '"level"' '"msg"' 'Utf8JsonWriter' 'JsonValueKind.Object' 'LOG_LEVEL'; do
  grep -Fq "$sym" "$LOG" || fail "Log.cs lacks: $sym"
done
# 2h. RouteMetrics.cs
for sym in 'public const string DefaultNamespace = "DeveloperCards";' \
           'public const string InternalRoutePrefix = "internal:";' \
           'public static readonly IReadOnlyList<string> InternalActions' \
           '"outbox/publish"' '"content-intelligence/import"' '"publish/reap-orphans"' '"manifest/rebuild"' '"db/migrate"' '"health/deep"' \
           'p.StartsWith("/internal/", StringComparison.Ordinal)' \
           'public static void EmitGauge(string name, double value, string? unit = "Count")' \
           'public static string BuildGaugeLine(' \
           'public static IReadOnlyList<string> KnownRoutes { get; } = [.. StaticRoutes, .. TemplateRoutes];'; do
  grep -Fq "$sym" "$RM" || fail "RouteMetrics.cs lacks: $sym"
done
grep -Fq '"RecallSmith"' "$RM" && fail "RouteMetrics.cs still carries the RecallSmith namespace literal"
grep -Eq '^\s*"/internal/|^\s*"internal:' "$RM" && fail "RouteMetrics.cs: internal actions must not sit in StaticRoutes/TemplateRoutes"
# 2i. OutboxPublisher.cs
for sym in 'public sealed record OutboxPublishResult(int Claimed, int Published, int Retried, int PendingAfter);' \
           'public static async Task<OutboxPublishResult> PublishBatchAsync(NpgsqlConnection conn, IAmazonS3 s3, string bucket, string prefix, int limit)' \
           'private static async Task<int> CountPendingAsync(NpgsqlConnection conn)' \
           "where status = 'pending'" \
           'RouteMetrics.EmitGauge("OutboxPending", result.PendingAfter);' \
           'if (result.Retried > 0) return res.Error500(null);' \
           'pendingAfter = result.PendingAfter'; do
  grep -Fq "$sym" "$OUTBOX" || fail "OutboxPublisher.cs lacks: $sym"
done
[ "$(grep -c 'RouteMetrics.EmitGauge("OutboxPending"' "$OUTBOX")" = "1" ] || fail "OutboxPublisher.cs: the gauge is emitted exactly once, in the HTTP handler"
grep -Fq 'return res.Error500(ex);' "$OUTBOX" && fail "OutboxPublisher.cs: the old catch → Error500(ex) must be inside PublishBatchAsync's report, not the handler"
# 2j. VpcFunction.cs / RevenuecatWebhook.cs
[ "$(grep -c 'Log.Event("info", new' "$VPCFN")" = "2" ] || fail "VpcFunction.cs: exactly two Log.Event(\"info\", new …) blocks (boot + request)"
grep -Fq 'tag = "boot"' "$VPCFN" || fail "VpcFunction.cs lost the boot tag"
grep -Fq 'JsonSerializer.Serialize(new' "$VPCFN" && fail "VpcFunction.cs: no Log.Info(JsonSerializer.Serialize(...)) may remain"
grep -Fq 'Log.Event("info", new' "$RCWH" || fail "RevenuecatWebhook.cs: the rc-webhook line must go through Log.Event"
grep -Fq 'tag = "rc-webhook"' "$RCWH" || fail "RevenuecatWebhook.cs lost the rc-webhook tag"
grep -Fq 'Console.WriteLine(JsonSerializer.Serialize' "$RCWH" && fail "RevenuecatWebhook.cs: direct Console JSON line must be gone"
[ "$(grep -c 'Log.Warn("\[rc-webhook\]' "$RCWH")" = "4" ] || fail "RevenuecatWebhook.cs: the four [rc-webhook] Log.Warn lines are untouched"
# 2k. RouteMetricsTests.cs — three lines, DbWarmupTests byte-identical
numstat="$(git diff --numstat "$mb" -- "$RMT" | cut -f1,2)"
[ "$numstat" = "$(printf '3\t3')" ] || fail "RouteMetricsTests.cs numstat must be '3 3', got '${numstat:-<no diff>}'"
grep -Fq 'private const string Ns = "DeveloperCards";' "$RMT" || fail "RouteMetricsTests.cs:39 must read DeveloperCards"
[ "$(grep -c '"DeveloperCards/Staging"' "$RMT")" = "2" ] || fail "RouteMetricsTests.cs: DeveloperCards/Staging exactly twice (:389, :394)"
grep -Fq '"RecallSmith' "$RMT" && fail "RouteMetricsTests.cs still carries a RecallSmith literal"
grep -Fq 'public void RouteTable_AndTheDispatchers_NameTheSameRoutes()' "$RMT" || fail "RouteMetricsTests.cs lost the table-vs-router test"
git diff --quiet "$mb" -- "$DBWT" || fail "DbWarmupTests.cs changed — it is the regression oracle for the embedding rule and must stay byte-identical"
# 2l. LogShapeTests.cs — collection, capture, titles
grep -Fq '[Collection(PostgresCollection.Name)]' "$LST" || fail "LogShapeTests.cs must join PostgresCollection (Console redirection)"
grep -Fq 'public class LogShapeTests' "$LST" || fail "LogShapeTests.cs class name"
grep -Fq 'Console.SetOut(' "$LST" && grep -Fq 'Console.SetError(' "$LST" || fail "LogShapeTests.cs must capture both streams"
for t in Info_PlainArgs_IsOneJsonObject_TsLevelMsg \
         WarnAndError_WriteJsonToStderr \
         Info_SingleJsonObjectArg_IsEmbeddedAtTopLevel \
         Event_PrependsTsAndLevel_ThenFieldsInDeclaredOrder \
         Event_DropsFieldsNamedTsOrLevel \
         Debug_WritesOnlyWhenLogLevelIsDebug \
         EveryLineWritten_ParsesAsJsonWithTsAndLevel \
         EmitGauge_IsOneEmfLine_NoDimensions_DefaultNamespace \
         EmitGauge_HonoursNamespaceOverride_AndKillSwitch \
         RouteFor_InternalAction_IsLabelledInternalColonAction \
         RouteFor_UnknownInternalAction_IsUnmatched_AndMintsNothing \
         KnownRoutes_ExcludeInternalActions \
         DefaultNamespace_IsDeveloperCards; do
  grep -Fq "$t" "$LST" || fail "missing LogShapeTests case: $t"
done
grep -Fq '[Theory]' "$LST" || fail "LogShapeTests.cs needs the [Theory] for the six internal actions"
grep -Fq '"step":"db-warmup"' "$LST" || fail "LogShapeTests.cs must pin the DbWarmupTests selector text"
[ "$(grep -cE '^\s*\[(Fact|Theory)\]' "$LST")" -ge 13 ] || fail "LogShapeTests.cs needs >= 13 test attributes"
# 2m. allow-list equals the brief's Changes 18 (normalised JSON compare)
python3 - "$ALLOW" <<'PY' || fail "E04.plan-allow.json does not match the brief's allow-list"
import json, sys
got = json.load(open(sys.argv[1]))
alarms = ["api_5xx","core_vpc_errors","worker_errors","core_vpc_throttles","worker_throttles","core_vpc_duration_p95",
          "sqs_oldest_age","dlq_nonempty","rds_cpu","rds_free_storage","rds_connections","outbox_backlog"]
changes = {
  "module.observability.aws_sns_topic.alerts": "create",
  "module.observability.aws_sns_topic_subscription.alerts_email": "create",
  "module.observability.aws_sns_topic_policy.alerts": "create",
  "module.observability.aws_db_event_subscription.developercards": "create",
  "module.observability.aws_cloudwatch_log_group.api_access": "create",
  "module.observability.aws_cloudwatch_dashboard.prod": "create",
}
for a in alarms:
    changes[f"module.observability.aws_cloudwatch_metric_alarm.{a}"] = "create"
for s in ("default", "dev"):
    changes[f"module.api.aws_apigatewayv2_stage.{s}"] = {"action": "update", "keys": ["access_log_settings", "default_route_settings"]}
want = {"tags_only_updates": False, "outputs": ["alerts_topic_arn"], "changes": changes}
def norm(d):
    d = json.loads(json.dumps(d))
    for k, v in d.get("changes", {}).items():
        if isinstance(v, dict) and "keys" in v:
            v["keys"] = sorted(v["keys"])
    return d
if norm(got) != norm(want):
    print("allow-list drift:", file=sys.stderr)
    for k in sorted(set(want["changes"]) ^ set(got.get("changes", {}))):
        print("  address only on one side:", k, file=sys.stderr)
    for k in ("tags_only_updates", "outputs"):
        if got.get(k) != want[k]:
            print("  field differs:", k, file=sys.stderr)
    sys.exit(1)
print("allow-list OK (20 changes, 1 output)")
PY
# 2n. suppression tokens (C07.verify.sh:151 pattern) over the scope files and the + lines; secret-shaped literals in + lines
SCOPE_FILES=("$ALERTS" "$ALARMS" "$DASH" "$APILOGS" "$OBSVARS" "$OBSOUTS" "$GATEWAY" "$APIVARS" "$ROOTMAIN" "$ROOTVARS" "$ROOTOUTS" "$ROOTEX" "$LOG" "$RM" "$OUTBOX" "$VPCFN" "$RCWH" "$RMT" "$LST")
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "${SCOPE_FILES[@]}" \
  && fail "test gutting / suppression found"
grep -Eq 'Skip\s*=|#pragma warning disable' "$LST" "$RMT" "$LOG" "$RM" "$OUTBOX" && fail "xunit Skip / pragma disable found"
added="$(git diff -U0 "$mb" HEAD -- infra src_C docs | grep -E '^\+[^+]' || true)"
printf '%s\n' "$added" | grep -Eq '(PGPASSWORD|MIGRATE_SECRET|INTERNAL_SHARED_SECRET|RC_WEBHOOK_AUTH_(PRODUCTION|DEVELOPMENT)|ANALYTICS_USER_SALT)\s*[=:]\s*"[^"$P]' \
  && fail "a secret-shaped literal was added (E00 §5 secret-leak guard)"
printf '%s\n' "$added" | grep -Eiq '[a-z0-9._%+-]+@[a-z0-9.-]+\.(com|net|org|nz|io|dev|app)\b' \
  && fail "a real-looking email address was added; only alerts@example.invalid is allowed"

# ── 3. Gates: terraform fmt / init -backend=false / validate; dotnet build ─
echo "[3/5] terraform fmt + validate (backend=false); dotnet build"
terraform fmt -check -recursive infra || fail "terraform fmt -check -recursive infra"
( cd "$ROOTDIR" && terraform init -backend=false -input=false >/dev/null && terraform validate ) || fail "terraform validate (envs/prod)"
( cd src_C && dotnet build Tests/RecallSmith.Lambda.IntegrationTests -c Debug --nologo ) || fail "dotnet build failed"

# ── 4. Plan (local override, read-only) → noise filter → check-plan.py; targeted tests ─
echo "[4/5] terraform plan (local backend override, read-only) -> check-plan.py; dotnet test LogShapeTests|RouteMetricsTests|DbWarmupTests"
aws sts get-caller-identity --query Account --output text >"$TMP/acct.txt" 2>&1 || fail "AWS credentials are not usable (AWS_PROFILE=dev, describe/get/list only)"
[ "$(tr -d '[:space:]' <"$TMP/acct.txt")" = "622994489535" ] || fail "wrong AWS account for the plan"
# Variables: the real prod.auto.tfvars is gitignored. Feed the example minus the two sensitive lines,
# then read the live Snowflake ExternalId (iam get-role, read-only; E01 gap 2) and the alert e-mail
# that E01 adopted as the budget subscriber literal (the merge-base copy of budget.tf — E04 replaces
# it with var.alert_email, so the worker's plan must carry the same address or the budget shows an
# update the allow-list does not admit). Both go into TF_VAR_*; neither is ever printed.
VARS="$TMP/e04.tfvars"; : >"$VARS"
grep -Ev 'external_id|alert_email' "$ROOTEX" >"$VARS" || true
EXT_VAR="$(grep -Eo 'variable "[A-Za-z0-9_]*external_id[A-Za-z0-9_]*"' "$ROOTVARS" | head -1 | cut -d'"' -f2 || true)"
if [ -n "$EXT_VAR" ] && [ -z "$(printenv "TF_VAR_${EXT_VAR}" 2>/dev/null || true)" ]; then
  EXT_ID="$(aws iam get-role --role-name snowflake-recallsmith-s3-role \
            --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals."sts:ExternalId"' --output text 2>/dev/null || true)"
  [ -n "$EXT_ID" ] && [ "$EXT_ID" != "None" ] || fail "could not read the Snowflake ExternalId from iam get-role"
  export "TF_VAR_${EXT_VAR}=${EXT_ID}"
fi
if [ -z "${TF_VAR_alert_email:-}" ]; then
  TF_VAR_alert_email="$(git show "$mb:$BUDGET" 2>/dev/null | grep -Eo 'subscriber_email_addresses\s*=\s*\[[^]]*\]' | grep -Eo '"[^"]+"' | head -1 | tr -d '"' || true)"
  [ -n "$TF_VAR_alert_email" ] || fail "could not read the adopted budget subscriber from the merge-base budget.tf; export TF_VAR_alert_email"
  export TF_VAR_alert_email
fi
printf 'terraform {\n  backend "local" {\n    path = "%s/e04.tfstate"\n  }\n}\n' "$TMP" >"$OVR"
( cd "$ROOTDIR" && terraform init -input=false -reconfigure -no-color >"$TMP/init1.txt" 2>&1 ) \
  || { tail -30 "$TMP/init1.txt" >&2; fail "terraform init with the local backend override failed"; }
( cd "$ROOTDIR" && terraform plan -input=false -no-color -var-file="$VARS" -out="$TMP/e04.tfplan" >"$TMP/plan.txt" 2>&1 ) \
  || { grep -E '^(Error|│|╷|╵)' "$TMP/plan.txt" | head -40 >&2; fail "terraform plan failed"; }
grep -E '^Plan:' "$TMP/plan.txt" || fail "plan produced no Plan: line"
grep -Eq '0 to destroy' "$TMP/plan.txt" || fail "the plan destroys something"
( cd "$ROOTDIR" && terraform show -json "$TMP/e04.tfplan" >"$TMP/e04.plan.json" ) || fail "terraform show -json failed"
# Worker-side noise filter (E03 verify precedent): drop (a) `create` entries whose address an earlier
# issue's allow file lists as create (E02/E03 resources exist in the account but are not in imports.tf,
# E00 §6 #20), (b) the provider-side RDS update whose changed keys are only the three E01 documented,
# (c) `create` output_changes for outputs that already exist at the merge base. Prints address+action
# only. The scope guard (step 5) keeps the filter safe: E04 cannot touch those addresses.
python3 - "$TMP/e04.plan.json" "$TMP/e04.filtered.json" "$mb" <<'PYF' || fail "noise filter failed"
import json, re, subprocess, sys
plan_path, out_path, mb = sys.argv[1:4]
plan = json.load(open(plan_path))
noise = set()
for tag in ("E02", "E03"):
    try:
        allow = json.load(open(f"docs/delivery/r16-issues/{tag}.plan-allow.json"))
    except FileNotFoundError:
        continue
    for addr, v in allow.get("changes", {}).items():
        if (v if isinstance(v, str) else v.get("action")) == "create":
            noise.add(addr)
base = subprocess.run(["git", "show", f"{mb}:infra/envs/prod/outputs.tf"], capture_output=True, text=True).stdout
base_outputs = set(re.findall(r'output\s+"([^"]+)"', base))
RDS, RDS_KEYS = "module.data.aws_db_instance.developercards", {"apply_immediately", "skip_final_snapshot", "final_snapshot_identifier"}
# Same class of worker-side import artifact as the RDS update above: publish_jobs is adopted
# (in imports.tf), but its redrive_policy references E03's DLQ, which E00 §6 #20 keeps OUT of
# imports.tf, so the empty-state plan treats the DLQ as a `create` (dropped just above) and its
# ARN is unknown -> redrive_policy reads as an unknown-only diff. The supervisor's real backend
# has the DLQ in state, so this is a no-op there. Dropped only when it is exactly that artifact.
PJ, PJ_KEYS = "module.worker.aws_sqs_queue.publish_jobs", {"redrive_policy"}
kept, dropped = [], []
for rc in plan.get("resource_changes", []):
    ch, addr = rc.get("change", {}), rc.get("address", "")
    acts = ch.get("actions", [])
    if acts == ["create"] and addr in noise:
        dropped.append((addr, "create (earlier issue, not in imports.tf)")); continue
    if acts == ["update"] and addr == RDS:
        b, a = ch.get("before") or {}, ch.get("after") or {}
        if {k for k in set(b) | set(a) if b.get(k) != a.get(k)} <= RDS_KEYS:
            dropped.append((addr, "update (provider-side keys only)")); continue
    if acts == ["update"] and addr == PJ and ch.get("importing"):
        b, a = ch.get("before") or {}, ch.get("after") or {}
        unknown = ch.get("after_unknown") or {}
        diff = {k for k in set(b) | set(a) if b.get(k) != a.get(k)}
        if diff and diff <= PJ_KEYS and all(unknown.get(k) for k in diff):
            dropped.append((addr, "update (redrive to earlier-issue DLQ create; worker-side import artifact)")); continue
    kept.append(rc)
plan["resource_changes"] = kept
oc = plan.get("output_changes") or {}
for name in list(oc):
    if name in base_outputs and oc[name].get("actions") == ["create"]:
        dropped.append((f"output.{name}", "create (pre-existing root output)")); del oc[name]
plan["output_changes"] = oc
json.dump(plan, open(out_path, "w"))
for a, why in dropped:
    print(f"  dropped worker-side noise: {a}  {why}")
print(f"noise filter: dropped {len(dropped)}, kept {len(kept)} resource entries")
PYF
python3 "$CHECK" --plan "$TMP/e04.filtered.json" --allow "$ALLOW" || fail "plan contains changes outside the E04 allow-list"
rm -f "$OVR" "$TMP/e04.tfplan" "$TMP/e04.plan.json" "$TMP/e04.filtered.json" "$TMP/plan.txt" "$TMP/e04.tfstate"* "$VARS" infra/envs/prod/.terraform/terraform.tfstate
[ ! -e "$OVR" ] || fail "override file not removed"
unset TF_VAR_alert_email

docker info >/dev/null 2>&1 || fail "Docker daemon is not running — LogShapeTests/RouteMetricsTests/DbWarmupTests join the Postgres collection"
( cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests -c Debug --no-build --nologo \
    --filter "FullyQualifiedName~LogShapeTests|FullyQualifiedName~RouteMetricsTests|FullyQualifiedName~DbWarmupTests" ) \
  || fail "targeted dotnet test failed"

# ── 5. Scope + frozen + OTA + apply guard ──────────────────────────────────
echo "[5/5] scope + frozen + OTA + apply guard"
frozen="$(git diff --numstat "$mb" HEAD -- \
  mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json \
  infra/envs/prod/imports.tf infra/envs/prod/backend.tf infra/envs/prod/providers.tf infra/envs/prod/versions.tf infra/envs/prod/.terraform.lock.hcl \
  infra/modules/identity infra/modules/data infra/modules/edge infra/modules/worker \
  infra/modules/observability/retention.tf infra/modules/observability/main.tf \
  infra/modules/api/core_vpc.tf infra/modules/api/edge_public.tf infra/modules/api/main.tf infra/modules/api/outputs.tf \
  infra/scripts \
  src_C/Shared/RecallSmith.Lambda.Common/Res.cs src_C/Shared/RecallSmith.Lambda.Common/Auth.cs src_C/Vpc/Warmup.cs \
  src_C/Worker src_C/Vpc/Authoring src_C/Vpc/Runtime src_C/Vpc/Db src_C/deploy.sh \
  "$DBWT" \
  'src_C/*.csproj' 'src_C/**/*.csproj')"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
grep -Fq '"version": "1.6.1"' mobile/app.json || fail "app.json version changed (OTA runtime 1.6.1)"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (next binary, not this wave)"; fi
# Every changed or untracked path is one of the 21 scope files (+ the issue folder). Pathspec-scoped
# untracked scan: the driver symlinks node_modules into the worktree.
outside="$( { git diff --name-only "$mb" HEAD; git ls-files --others --exclude-standard -- infra src_C docs mobile/src mobile/tests frontend/src .github; } \
  | sort -u | grep -Ev '^(infra/modules/observability/(alerts|alarms|dashboard|api_logs|variables|outputs|budget)\.tf|infra/modules/api/(gateway|variables)\.tf|infra/envs/prod/(main|variables|outputs)\.tf|infra/envs/prod/prod\.auto\.tfvars\.example|infra/README\.md|src_C/Shared/RecallSmith\.Lambda\.Common/(Log|RouteMetrics)\.cs|src_C/Vpc/Analytics/OutboxPublisher\.cs|src_C/Vpc/VpcFunction\.cs|src_C/Vpc/Webhooks/RevenuecatWebhook\.cs|src_C/Tests/RecallSmith\.Lambda\.IntegrationTests/(RouteMetricsTests|LogShapeTests)\.cs|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside E04 scope"; }
# Apply guard (E00 §5): no worker artefact runs a state-changing terraform or a mutating aws call
# outside comments / echo / DRY_RUN lines or the supervisor-only scripts.
applyhits="$(grep -rEn 'terraform +(apply|import)\b|aws +[a-z0-9-]+ +(create|update|delete|put)-' infra/scripts src_C/scripts scripts docs/delivery/r16-issues/E04.verify.sh 2>/dev/null \
  | grep -Ev ':[0-9]+:\s*#' | grep -Ev 'echo|DRY_RUN|never|NEVER' \
  | grep -Ev '^(infra/scripts/rds-snapshot\.sh|src_C/deploy\.sh|scripts/invoke-as-admin\.sh|scripts/smoke\.sh|scripts/rollback\.sh|site/deploy\.sh):' || true)"
[ -z "$applyhits" ] || { echo "$applyhits" >&2; fail "a worker artefact carries a state-changing terraform command or a mutating aws call"; }
if grep -En 'terraform +(apply|import)\b' "$ALERTS" "$ALARMS" "$DASH" "$APILOGS" "$GATEWAY" "$ROOTMAIN" 2>/dev/null | grep -Ev ':[0-9]+:\s*#' | grep -q .; then
  fail "a state-changing terraform command is spelled in an infra file"
fi

echo "E04 VERIFY OK"
