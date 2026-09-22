#!/usr/bin/env bash
# E03 — queue-reliability verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# FAILS ON BASE at step 1.
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - src_C/Vpc/Db/Migrations/021_decks_live_build_id.sql does not exist on base
#     (nor do ManifestBuilder.cs, DeckRollback.cs, PublishReaper.cs, the four
#     test classes or E03.plan-allow.json)
#   (step 1 then also checks the E01/E02 prerequisites: infra/scripts/check-plan.py,
#   infra/envs/prod/imports.tf, infra/modules/worker/{queue,function,outputs}.tf,
#   the worker log-group retention line and observability/retention.tf must be on
#   the integration branch — E00 §4 orders E01 → E02 → E03)
# Step 2 (literal guards: DLQ/redrive/visibility/ESM attributes, the acquire
# statement, the ManifestBuilder signatures, the routes, the test titles) would
# also fail on base. Step 3 = root gates (terraform init/validate/fmt, dotnet
# build), step 4 = the read-only plan against the allow-list + targeted xunit,
# step 5 = scope + frozen + OTA + apply guard.
#
# WORKER SAFETY RULE: this script runs `terraform init -backend=false` +
# `terraform validate` (root gate), then — for the plan only — drops the
# gitignored local-backend override of the E01 brief (gap 13:
# infra/envs/prod/backend_override.tf, state under $TMP), `terraform init
# -input=false -reconfigure`, `terraform plan -out` + `terraform show -json`,
# and read-only AWS CLI only. It never runs `terraform apply`, `terraform import`,
# any `aws … create/update/delete/put`, `eas` or a deploy script; the
# supervisor applies the plan after the merge (E00 §0). Plan files carry Lambda
# environment values in clear, so they live in a private temp dir, are never
# printed, and are removed by the EXIT trap.
#
# The driver's diff-scoped term gate and suppression scan run separately; this
# script does not spell the six terms (E00 §0).
#
# Network: the plan reads the live account (AWS_PROFILE=dev, describe/get only,
# ~2–4 min for the 93 import blocks); `terraform init` reuses TF_PLUGIN_CACHE_DIR;
# dotnet restores from the local NuGet cache (awssdk.s3/4.0.0 is cached). Step 4
# needs a running Docker daemon (Testcontainers postgres:16-alpine).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-e-prod}}"   # driver exports BASE
fail() { echo "E03 VERIFY FAIL: $*" >&2; exit 1; }
need()   { grep -Fq -- "$2" "$1" || fail "$1 lacks: $2"; }
needE()  { grep -Eq -- "$2" "$1" || fail "$1 lacks (regex): $2"; }
absent() { if grep -Fq -- "$2" "$1"; then fail "$1 must not contain: $2"; fi; }

export TF_PLUGIN_CACHE_DIR="${TF_PLUGIN_CACHE_DIR:-$HOME/.terraform.d/plugin-cache}"
mkdir -p "$TF_PLUGIN_CACHE_DIR"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/e03verify.XXXXXX")"
PROD=infra/envs/prod
OVR="$PROD/backend_override.tf"            # E01 brief gap 13: local backend for the worker plan; gitignored; removed below
cleanup() {
  rm -f "$OVR" "$PROD/.terraform/terraform.tfstate"
  rm -rf "$TMP"
}
trap cleanup EXIT

# ── files ──────────────────────────────────────────────────────────────────
QUEUE_TF=infra/modules/worker/queue.tf
FN_TF=infra/modules/worker/function.tf
OUT_TF=infra/modules/worker/outputs.tf
README=infra/README.md
IMPORTS=infra/envs/prod/imports.tf
CHECK=infra/scripts/check-plan.py
ALLOW=docs/delivery/r16-issues/E03.plan-allow.json
MIG=src_C/Vpc/Db/Migrations/021_decks_live_build_id.sql
MIGDIR=src_C/Vpc/Db/Migrations
BUILDER=src_C/Shared/RecallSmith.Lambda.Db/ManifestBuilder.cs
DBCSPROJ=src_C/Shared/RecallSmith.Lambda.Db/RecallSmith.Lambda.Db.csproj
REBUILD=src_C/Vpc/Authoring/ManifestRebuild.cs
PUBLISH=src_C/Vpc/Authoring/Publish.cs
HELPERS=src_C/Vpc/Authoring/Helpers.cs
ROLLBACK=src_C/Vpc/Authoring/DeckRollback.cs
REAPER=src_C/Vpc/Authoring/PublishReaper.cs
VPCFN=src_C/Vpc/VpcFunction.cs
VPCHOOKS=src_C/Vpc/SnapStartHooks.cs
WORKER=src_C/Worker/WorkerFunction.cs
IPROC=src_C/Worker/Services/IPublishJobProcessor.cs
PROC=src_C/Worker/Services/PublishJobProcessor.cs
JOBREPO=src_C/Worker/Repositories/JobRepository.cs
IJOBREPO=src_C/Worker/Repositories/IJobRepository.cs
WHOOKS=src_C/Worker/SnapStartHooks.cs
TESTDIR=src_C/Tests/RecallSmith.Lambda.IntegrationTests
T_WORKER=$TESTDIR/WorkerReceiveCountTests.cs
T_BUILDER=$TESTDIR/ManifestBuilderTests.cs
T_ROLLBACK=$TESTDIR/DeckRollbackTests.cs
T_REAPER=$TESTDIR/PublishReaperTests.cs

# The acquire line (E00 §2.3), byte for byte.
ACQUIRE_LINE="OR (status = 'PROCESSING' AND ((\$2 > 1 AND updated_at < now() - interval '11 minutes') OR updated_at < now() - interval '15 minutes'))"

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ E01/E02 prerequisites)"
[ -f "$MIG" ] || fail "$MIG does not exist (base tree fails here)"
for f in "$BUILDER" "$ROLLBACK" "$REAPER" "$T_WORKER" "$T_BUILDER" "$T_ROLLBACK" "$T_REAPER" "$ALLOW"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
[ "$(ls "$MIGDIR"/021_*.sql 2>/dev/null | wc -l | tr -d ' ')" = "1" ] || fail "exactly one 021_*.sql expected under $MIGDIR"
ls "$MIGDIR"/022_*.sql >/dev/null 2>&1 && fail "022_*.sql must not exist (E03 is the wave's only migration)"
[ ! -e src_C/Worker/Manifest ] || fail "src_C/Worker/Manifest/ must be deleted (ManifestService + IManifestService)"
for f in "$CHECK" "$IMPORTS" "$QUEUE_TF" "$FN_TF" "$OUT_TF" "$README" infra/envs/prod/main.tf infra/envs/prod/.terraform.lock.hcl; do
  [ -f "$f" ] || fail "$f is missing — E01 must be merged before E03 (E00 §4)"
done
grep -q "retention_in_days" infra/modules/worker/*.tf || fail "worker log-group retention is missing — E02 must be merged before E03 (E00 §4)"
[ -f infra/modules/observability/retention.tf ] || fail "infra/modules/observability/retention.tf is missing — E02 must be merged before E03 (E00 §4)"
for f in "$REBUILD" "$PUBLISH" "$HELPERS" "$VPCFN" "$VPCHOOKS" "$WORKER" "$IPROC" "$PROC" "$JOBREPO" "$IJOBREPO" "$WHOOKS" "$DBCSPROJ"; do
  [ -f "$f" ] || fail "$f is missing from the tree"
done

mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. queue.tf — DLQ, redrive, visibility, redrive-allow
need  "$QUEUE_TF" 'resource "aws_sqs_queue" "publish_jobs_dlq"'
need  "$QUEUE_TF" '"developercards-publish-jobs-dlq"'
needE "$QUEUE_TF" 'message_retention_seconds[[:space:]]*=[[:space:]]*1209600[[:space:]]*$'
needE "$QUEUE_TF" 'visibility_timeout_seconds[[:space:]]*=[[:space:]]*3700[[:space:]]*$'
needE "$QUEUE_TF" 'deadLetterTargetArn[[:space:]]*=[[:space:]]*aws_sqs_queue\.publish_jobs_dlq\.arn'
needE "$QUEUE_TF" 'maxReceiveCount[[:space:]]*=[[:space:]]*3[[:space:]]*$'
need  "$QUEUE_TF" 'resource "aws_sqs_queue_redrive_allow_policy" "publish_jobs_dlq"'
needE "$QUEUE_TF" 'redrivePermission[[:space:]]*=[[:space:]]*"byQueue"'
need  "$QUEUE_TF" 'sourceQueueArns'
need  "$QUEUE_TF" 'aws_sqs_queue.publish_jobs.arn'
[ "$(grep -Ec 'sqs_managed_sse_enabled[[:space:]]*=[[:space:]]*true' "$QUEUE_TF" || true)" -ge 2 ] || fail "queue.tf: both queues need sqs_managed_sse_enabled = true"
[ "$(grep -Ec 'redrive_allow_policy[[:space:]]*=' "$QUEUE_TF" || true)" = "1" ] || fail "queue.tf: redrive_allow_policy is set exactly once, on the standalone resource"
if grep -Eq '^[[:space:]]*tags[[:space:]]*=' "$QUEUE_TF" "$FN_TF" "$OUT_TF"; then fail "no explicit tags in infra/modules/worker (E02 default_tags)"; fi
# 2b. function.tf — the ESM
needE "$FN_TF" 'function_name[[:space:]]*=[[:space:]]*aws_lambda_alias\.worker_prod\.arn'
needE "$FN_TF" 'maximum_batching_window_in_seconds[[:space:]]*=[[:space:]]*0[[:space:]]*$'
needE "$FN_TF" 'function_response_types[[:space:]]*=[[:space:]]*\["ReportBatchItemFailures"\]'
needE "$FN_TF" 'batch_size[[:space:]]*=[[:space:]]*1[[:space:]]*$'
needE "$FN_TF" 'maximum_concurrency[[:space:]]*=[[:space:]]*2[[:space:]]*$'
needE "$FN_TF" 'ignore_changes[[:space:]]*=[[:space:]]*\[metrics_config\]'
if grep -Eq 'function_name[[:space:]]*=[[:space:]]*aws_lambda_function\.worker' "$FN_TF"; then fail "function.tf: the ESM must target the prod alias, not the function"; fi
# 2c. outputs.tf, README, imports.tf, hygiene
need "$OUT_TF" 'output "publish_dlq_arn"'
need "$OUT_TF" 'output "publish_dlq_name"'
grep -q 'E03' "$README" || fail "infra/README.md §6 lacks the E03 line"
git diff --quiet "$mb" HEAD -- "$IMPORTS" || fail "infra/envs/prod/imports.tf must be byte-identical (E00 §6 #20)"
if grep -rEn 'provisioner|null_resource|local-exec|archive_file|profile[[:space:]]*=' infra/modules/worker; then fail "forbidden Terraform construct under infra/modules/worker (E00 §0)"; fi
# 2d. the allow file, pinned after JSON normalisation
python3 - "$ALLOW" <<'PY' || fail "E03.plan-allow.json differs from the brief (Changes 4)"
import json, sys
exp = {
  "tags_only_updates": False,
  "changes": {
    "module.worker.aws_sqs_queue.publish_jobs_dlq": "create",
    "module.worker.aws_sqs_queue_redrive_allow_policy.publish_jobs_dlq": "create",
    "module.worker.aws_sqs_queue.publish_jobs": {"action": "update", "keys": ["visibility_timeout_seconds", "redrive_policy"]},
    "module.worker.aws_lambda_event_source_mapping.worker_sqs": {"action": "update", "keys": ["function_name", "maximum_batching_window_in_seconds", "function_response_types"]},
  },
}
got = json.load(open(sys.argv[1]))
sys.exit(0 if json.dumps(got, sort_keys=True) == json.dumps(exp, sort_keys=True) else 1)
PY
# 2e. migration 021
need "$MIG" 'alter table decks add column if not exists live_build_id text null;'
need "$MIG" 'distinct on (deck_slug)'
need "$MIG" 'and d.live_build_id is null;'
need "$MIG" "'orphaned: pre-021 stale active row'"
need "$MIG" "interval '30 minutes'"
need "$MIG" 'create unique index if not exists uq_deck_publishes_active'
need "$MIG" "where status in ('PENDING', 'PROCESSING');"
if grep -v '^[[:space:]]*--' "$MIG" | grep -Ei 'live_build_id.*not null|^[[:space:]]*drop |default |check \(|\$\$'; then fail "021: no NOT NULL / DROP / DEFAULT / CHECK / \$\$ block allowed"; fi
# 2f. ManifestBuilder + Db csproj
need "$BUILDER" 'namespace RecallSmith.Lambda.Db;'
need "$BUILDER" 'public static class ManifestBuilder'
need "$BUILDER" 'public static Task<ManifestBuildResult> RebuildAsync(NpgsqlConnection conn, IAmazonS3 s3, string bucket, string contentPrefix, string premiumPrefix, long? nowMs = null)'
need "$BUILDER" 'public static void Reset()'
need "$BUILDER" 'public static Task<ManifestBody> BuildAsync(NpgsqlConnection conn, string contentPrefix, long generatedAtMs)'
need "$BUILDER" 'public static IAmazonS3 S3()'
need "$BUILDER" 'public static string NormalizePrefix(string? raw, string fallback)'
need "$BUILDER" 'public const string GeneratedAtMetadataKey = "generated-at-ms";'
need "$BUILDER" 'public sealed record ManifestBuildResult(int DeckCount, int PatchEdgeCount, string Key, string ETag, long GeneratedAtMs);'
need "$BUILDER" 'public sealed record ManifestBody(string Json, int DeckCount, int PatchEdgeCount);'
need "$BUILDER" 'schemaVersion = 2'
need "$BUILDER" '"public, max-age=60, s-maxage=60"'
need "$BUILDER" 'd.live_build_id = p.build_id'
need "$BUILDER" 'IfMatch'
need "$BUILDER" 'IfNoneMatch = "*"'
need "$BUILDER" 'HttpStatusCode.PreconditionFailed'
need "$BUILDER" '"42703"'
need "$BUILDER" '"42P01"'
need "$BUILDER" 'select distinct on (deck_slug)'
need "$BUILDER" 'previewPatches = (object?)null'
need "$DBCSPROJ" '<PackageReference Include="AWSSDK.S3" Version="4.0.0" />'
need "$DBCSPROJ" '<PackageReference Include="Npgsql" Version="8.0.5" />'
[ "$(grep -c '<PackageReference' "$DBCSPROJ" || true)" = "2" ] || fail "Db csproj: exactly two PackageReference lines (Npgsql 8.0.5 + AWSSDK.S3 4.0.0)"
# 2g. ManifestRebuild shrinks; both SnapStart hooks
need   "$REBUILD" 'ManifestBuilder.RebuildAsync('
need   "$REBUILD" 'ManifestBuilder.S3()'
need   "$REBUILD" 'Auth.RequireSuperAdmin'
need   "$REBUILD" 'manifestKey = r.Key'
need   "$REBUILD" 'deckCount = r.DeckCount'
absent "$REBUILD" 'schemaVersion'
absent "$REBUILD" 'distinct on'
absent "$REBUILD" 'AmazonS3Client'
absent "$REBUILD" 'public static void Reset'
[ "$(wc -l < "$REBUILD" | tr -d ' ')" -le 80 ] || fail "ManifestRebuild.cs must be <= 80 lines (the document logic moved to ManifestBuilder)"
need   "$VPCHOOKS" 'ManifestBuilder.Reset()'
absent "$VPCHOOKS" 'ManifestRebuild.Reset()'
need   "$WHOOKS" 'ManifestBuilder.Reset()'
absent "$WHOOKS" 'ManifestService'
# 2h. worker: interface, processor, repository, handler
need   "$IPROC" 'Task ProcessAsync(string jobId, int receiveCount = 1);'
need   "$IPROC" 'public sealed class JobNotAcquiredException : Exception'
need   "$PROC" 'public async Task ProcessAsync(string jobId, int receiveCount = 1)'
need   "$PROC" 'TryAcquireJobAsync(jobId, receiveCount)'
need   "$PROC" 'throw new JobNotAcquiredException(jobId)'
need   "$PROC" 'public static async Task<List<CardExportData>> LoadCardsAsync(NpgsqlConnection conn, int deckId)'
need   "$JOBREPO" "$ACQUIRE_LINE"
need   "$JOBREPO" 'with done as ('
need   "$JOBREPO" 'set live_build_id = done.build_id'
need   "$JOBREPO" '"42703"'
git diff --quiet "$mb" HEAD -- "$IJOBREPO" || fail "IJobRepository.cs must be byte-identical (build_id comes from the row)"
need   "$WORKER" 'public async Task<SQSBatchResponse> FunctionHandler(SQSEvent sqsEvent, ILambdaContext context)'
need   "$WORKER" '"ApproximateReceiveCount"'
need   "$WORKER" 'ItemIdentifier = record.MessageId'
need   "$WORKER" 'public static bool ManifestCoversJob(DateTime? lastModifiedUtc, string? generatedAtMsMeta, long completedAtMs, DateTime utcNow)'
need   "$WORKER" 'ManifestBuilder.RebuildAsync('
need   "$WORKER" 'TimeSpan.FromSeconds(10)'
need   "$WORKER" 'completedAtMs + 1000'
need   "$WORKER" 'catch (JobNotAcquiredException'
need   "$WORKER" 'catch (BusinessException'
absent "$WORKER" 'IManifestService'
absent "$WORKER" 'RecallSmith.Lambda.Worker.Manifest'
if grep -Eq '^[[:space:]]*throw;[[:space:]]*$' "$WORKER"; then fail "WorkerFunction.cs must never rethrow (ReportBatchItemFailures)"; fi
# 2i. Vpc: Helpers, Publish, DeckRollback, PublishReaper, routes
need "$HELPERS" 'public static APIGatewayProxyResponse ErrorEnvelope(Res res, int statusCode, string code, string message)'
need "$HELPERS" 'public static APIGatewayProxyResponse? MapUniqueViolation409(Exception ex, Res res)'
need "$HELPERS" '"uq_deck_publishes_active"'
need "$HELPERS" '"PUBLISH_IN_PROGRESS"'
need "$HELPERS" 'POST /api/v1/admin/publish/reap'
need "$PUBLISH" 'catch (PostgresException pg) when (pg.SqlState == "23505")'
need "$PUBLISH" 'Helpers.MapUniqueViolation409(pg, res)'
[ "$(git diff --numstat "$mb" HEAD -- "$PUBLISH" | cut -f2)" = "0" ] || fail "Publish.cs: add-only (one catch clause), no deletions"
need   "$ROLLBACK" 'public static class DeckRollback'
need   "$ROLLBACK" 'public delegate Task<ManifestBuildResult> ManifestRebuildFn(NpgsqlConnection conn);'
need   "$ROLLBACK" 'public static long? ParseDeckId(string path)'
need   "$ROLLBACK" 'HandleDeckRollback(LambdaRequest req, Res res, AuthContext auth)'
need   "$ROLLBACK" 'HandleDeckRollback(LambdaRequest req, Res res, AuthContext auth, ManifestRebuildFn rebuild)'
need   "$ROLLBACK" 'Auth.RequireSuperAdmin'
need   "$ROLLBACK" '"DECK_NOT_FOUND"'
need   "$ROLLBACK" '"VALIDATION_ERROR"'
need   "$ROLLBACK" "status = 'SUCCESS'"
need   "$ROLLBACK" 'set live_build_id = $2'
need   "$ROLLBACK" 'manifestRebuilt = true'
need   "$ROLLBACK" 'previousBuildId'
need   "$ROLLBACK" 'liveBuildId = buildId'
absent "$ROLLBACK" 'updated_at'
need "$REAPER" 'public sealed record ReapResult(int Pending, int Processing, string[] JobIds);'
need "$REAPER" 'Task<ReapResult> ReapOrphansAsync(NpgsqlConnection conn)'
need "$REAPER" 'HandlePublishReap(LambdaRequest req, Res res, AuthContext auth)'
need "$REAPER" "'orphaned: no worker pickup'"
need "$REAPER" "interval '10 minutes'"
need "$REAPER" "interval '30 minutes'"
need "$REAPER" 'Auth.RequireSuperAdmin'
need "$VPCFN" 'p.EndsWith("/rollback", StringComparison.OrdinalIgnoreCase) && p.Contains("/api/v1/admin/decks/", StringComparison.OrdinalIgnoreCase)'
need "$VPCFN" 'Vpc.Authoring.DeckRollback.HandleDeckRollback(req, res, auth)'
need "$VPCFN" 'p.EndsWith("/api/v1/admin/publish/reap", StringComparison.OrdinalIgnoreCase)'
need "$VPCFN" 'Vpc.Authoring.PublishReaper.HandlePublishReap(req, res, auth)'
l_rebuild="$(grep -n 'manifest/rebuild' "$VPCFN" | head -1 | cut -d: -f1)"
l_rollback="$(grep -n 'p.EndsWith("/rollback"' "$VPCFN" | head -1 | cut -d: -f1)"
l_reap="$(grep -n 'admin/publish/reap' "$VPCFN" | head -1 | cut -d: -f1)"
l_dash="$(grep -n '// Dashboard' "$VPCFN" | head -1 | cut -d: -f1)"
[ -n "$l_rebuild" ] && [ -n "$l_rollback" ] && [ -n "$l_reap" ] && [ -n "$l_dash" ] || fail "VpcFunction.cs: anchor lines not found"
[ "$l_rebuild" -lt "$l_rollback" ] && [ "$l_rollback" -lt "$l_reap" ] && [ "$l_reap" -lt "$l_dash" ] \
  || fail "VpcFunction.cs: the two E03 blocks must sit between the manifest/rebuild block and // Dashboard (E00 §2.16)"
vpc_ns="$(git diff --numstat "$mb" HEAD -- "$VPCFN" | cut -f1,2)"
[ "$vpc_ns" = "$(printf '8\t0')" ] || fail "VpcFunction.cs numstat must be '8 0' (two 4-line blocks, add-only), got '${vpc_ns:-<no diff>}'"
# 2j. tests — titles, harnesses, tables
for s in FunctionHandler_PassesApproximateReceiveCount FunctionHandler_MissingAttribute_DefaultsToOne \
         FunctionHandler_MalformedBody_ReportsItemFailure FunctionHandler_JobNotAcquired_ReportsItemFailureWithoutFailing \
         FunctionHandler_BusinessException_MarksFailedAndAcks FunctionHandler_SystemException_ReportsItemFailureWithoutFailing \
         FunctionHandler_Success_RunsManifestHookOnce FunctionHandler_ManifestHookThrows_ReportsItemFailure \
         FunctionHandler_MixedBatch_ReportsOnlyFailedMessageIds ManifestCoversJob_Table \
         ProcessAsync_NotAcquiredWhileProcessing_Throws ProcessAsync_NotAcquiredAfterSuccess_ReturnsQuietly \
         ProcessAsync_NotAcquiredAndAbsent_ReturnsQuietly; do
  need "$T_WORKER" "$s"
done
need   "$T_WORKER" 'Assert.ThrowsAsync<JobNotAcquiredException>'
absent "$T_WORKER" '[Collection('
for s in Build_GoldenShape_PinsKeyOrder Build_LivePointer_WinsOverNewestSuccess Build_NullPointer_FallsBackToNewestSuccess \
         Build_LiveDeckWithoutSuccess_IsOmitted Build_PremiumDeck_CarriesPreviewFieldsOnly Build_PatchEdges_NewestFourPerSlug \
         Migration021_BackfillsPointerAndAddsPartialIndex Migration021_ReapsStaleActiveRowsBeforeIndex \
         CompleteJob_SetsSuccessAndMovesPointer TryAcquire_RedeliveryTakesOverOnlyStaleProcessing NormalizePrefix_Table; do
  need "$T_BUILDER" "$s"
done
need "$T_BUILDER" '[Collection(PostgresCollection.Name)]'
need "$T_BUILDER" 'EnumerateObject()'
need "$T_BUILDER" '"uq_deck_publishes_active"'
need "$T_BUILDER" 'ManifestBuilder.BuildAsync('
for s in Rollback_UnknownDeck_404DeckNotFound Rollback_NonNumericId_400 Rollback_MissingBuildId_400 Rollback_BuildNotSuccess_400 \
         Rollback_MovesPointerAndRebuildsManifest Rollback_RequiresSuperAdmin_403 Rollback_Get_405 ParseDeckId_Table; do
  need "$T_ROLLBACK" "$s"
done
need "$T_ROLLBACK" '[Collection(PostgresCollection.Name)]'
need "$T_ROLLBACK" '"super_admin"'
need "$T_ROLLBACK" 'ManifestRebuildFn'
for s in Reap_MarksStalePendingAndProcessingOnly Reap_IsIdempotent Reap_ReapedRowIsReacquirable HandlePublishReap_ReturnsCounts \
         HandlePublishReap_RequiresSuperAdmin_403 HandlePublishReap_Get_405 Publish_SecondActiveRow_23505MapsTo409; do
  need "$T_REAPER" "$s"
done
need "$T_REAPER" '[Collection(PostgresCollection.Name)]'
need "$T_REAPER" '"super_admin"'
need "$T_REAPER" 'Helpers.MapUniqueViolation409('
[ "$(cat "$T_WORKER" "$T_BUILDER" "$T_ROLLBACK" "$T_REAPER" | grep -c '\[Theory\]' || true)" -ge 4 ] || fail "at least four [Theory] tables across the four test files"
# 2k. suppression / test-gutting scan over every new file and every added line
NEWFILES="$MIG $BUILDER $ROLLBACK $REAPER $T_WORKER $T_BUILDER $T_ROLLBACK $T_REAPER"
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable|Skip *=|#pragma warning disable" $NEWFILES \
  && fail "test gutting / suppression found in a new file"
added_all="$(git diff -U0 "$mb" HEAD -- infra src_C scripts docs/delivery/r16-issues/E03.plan-allow.json | grep '^+' | grep -v '^+++' || true)"
if printf '%s\n' "$added_all" | grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable|Skip *=|#pragma warning disable"; then
  fail "test gutting / suppression found in an added line"
fi
# 2l. secret-leak guard (E00 §5): a name may appear, a literal value may not
if printf '%s\n' "$added_all" | grep -Eq '(PGPASSWORD|MIGRATE_SECRET|INTERNAL_SHARED_SECRET|RC_WEBHOOK_AUTH_(PRODUCTION|DEVELOPMENT)|ANALYTICS_USER_SALT)\s*[=:]\s*"[^"$P]'; then
  fail "a secret-looking literal appears in an added line"
fi
if git ls-files infra | grep -Eq '\.(tfplan|plan\.json)$|generated.*\.tf$|[^e]\.auto\.tfvars$|(^|/)\.terraform/|backend_override\.tf$'; then fail "a plan/generated/tfvars/override file is tracked under infra/"; fi
if grep -rn 'profile *= *"' infra --include=*.tf 2>/dev/null | grep -q .; then fail "a provider profile is hard-coded under infra/"; fi

# ── 3. Root gates ──────────────────────────────────────────────────────────
echo "[3/5] terraform fmt/init/validate + dotnet build"
terraform fmt -check -recursive infra || fail "terraform fmt -check -recursive infra"
( cd infra/envs/prod && terraform init -backend=false -input=false >/dev/null && terraform validate && terraform fmt -check -recursive .. ) \
  || fail "infra root gate (init -backend=false / validate / fmt) failed"
( cd src_C && dotnet build RecallSmith.Lambda.sln -c Release -nologo ) || fail "dotnet build RecallSmith.Lambda.sln failed"
if git diff --name-only "$mb" HEAD | grep -q '^frontend/'; then
  ( cd frontend && npm run lint && npm run build ) || fail "frontend gate failed"
fi

# ── 4. Plan against the allow-list (read-only) + targeted xunit ────────────
echo "[4/5] terraform plan (local override, read-only, AWS_PROFILE=dev) -> noise filter -> check-plan.py; dotnet test"
export AWS_PROFILE="${AWS_PROFILE:-dev}"
acct="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)"
[ "$acct" = "622994489535" ] || fail "AWS_PROFILE=$AWS_PROFILE does not resolve to account 622994489535 (got '${acct:-none}')"
# Variables (the E02 recipe): prod.auto.tfvars is gitignored and absent in a worktree; feed the
# example minus any external_id line, and read the live Snowflake ExternalId (not a secret per
# AWS, never printed) into TF_VAR_<name> so the adopted trust policy stays a no-op.
VARS="$TMP/e03.tfvars"; : >"$VARS"
if [ -f "$PROD/prod.auto.tfvars.example" ]; then grep -Ev 'external_id' "$PROD/prod.auto.tfvars.example" >"$VARS" || true; fi
EXT_VAR="$(grep -Eo 'variable "[A-Za-z0-9_]*external_id[A-Za-z0-9_]*"' "$PROD/variables.tf" | head -1 | cut -d'"' -f2 || true)"
if [ -n "$EXT_VAR" ]; then
  EXT_ID="$(aws iam get-role --role-name snowflake-recallsmith-s3-role \
            --query 'Role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals."sts:ExternalId"' --output text 2>/dev/null || true)"
  [ -n "$EXT_ID" ] && [ "$EXT_ID" != "None" ] || fail "could not read the Snowflake ExternalId from iam get-role"
  export "TF_VAR_${EXT_VAR}=${EXT_ID}"
fi
# Local backend override (E01 gap 13): the S3 state bucket is never contacted by a worker.
printf 'terraform {\n  backend "local" {\n    path = "%s/e03.tfstate"\n  }\n}\n' "$TMP" >"$OVR"
( cd "$PROD" && terraform init -input=false -reconfigure -no-color >"$TMP/init1.txt" 2>&1 ) \
  || { tail -30 "$TMP/init1.txt" >&2; fail "terraform init with the local backend override failed"; }
( cd "$PROD" && terraform plan -input=false -no-color -var-file="$VARS" -out="$TMP/E03.tfplan" >"$TMP/plan.txt" 2>&1 ) \
  || { grep -E '^(Error|│|╷|╵)' "$TMP/plan.txt" | head -40 >&2; fail "terraform plan failed"; }
grep -E '^Plan:' "$TMP/plan.txt" || fail "plan produced no Plan: line"
grep -Eq '0 to destroy' "$TMP/plan.txt" || fail "the plan destroys something (a replace of the ESM or the queue is not allowed)"
( cd "$PROD" && terraform show -json "$TMP/E03.tfplan" >"$TMP/E03.plan.json" ) || fail "terraform show -json failed"
# Worker-side noise filter (brief, Context): an empty local state also plans (a) earlier
# issues' resources as `create` (they exist but are not in imports.tf), (b) the provider-side
# RDS update (E00 §2.1.4; plus E02's backup_retention_period until its maintenance window),
# (c) root output_changes of kind `create`. Drop exactly those, print what was dropped
# (address + actions only, never values), and require exactly 4 effective entries left.
python3 - "$TMP/E03.plan.json" "$TMP/E03.filtered.plan.json" <<'PY' || fail "plan noise filter rejected the plan"
import json, sys
src, dst = sys.argv[1], sys.argv[2]
plan = json.load(open(src))
RDS = "module.data.aws_db_instance.developercards"
RDS_KEYS = {"apply_immediately", "skip_final_snapshot", "final_snapshot_identifier", "backup_retention_period"}
keep, dropped = [], []
for rc in plan.get("resource_changes", []) or []:
    ch = rc.get("change", {}) or {}
    actions = ch.get("actions", []) or []
    addr = rc.get("address", "")
    if actions == ["no-op"]:
        keep.append(rc); continue
    if actions == ["create"] and not addr.startswith("module.worker."):
        dropped.append((addr, actions)); continue
    if actions == ["update"] and addr == RDS:
        before = ch.get("before") or {}
        after = ch.get("after") or {}
        unknown = ch.get("after_unknown") or {}
        diff = set()
        for k in set(before) | set(after):
            if unknown.get(k) is True:
                continue
            if before.get(k) != after.get(k):
                diff.add(k)
        if diff <= RDS_KEYS:
            dropped.append((addr, actions)); continue
    keep.append(rc)
outs = plan.get("output_changes", {}) or {}
kept_outs = {}
for name, ch in outs.items():
    if (ch.get("actions") or []) == ["create"]:
        dropped.append(("output." + name, ["create"])); continue
    kept_outs[name] = ch
plan["resource_changes"] = keep
plan["output_changes"] = kept_outs
json.dump(plan, open(dst, "w"))
for addr, actions in dropped:
    print("filtered (worker-side noise): %s %s" % (addr, actions))
effective = [rc["address"] for rc in keep if (rc.get("change", {}).get("actions") or []) != ["no-op"]]
print("effective after filter: %d" % len(effective))
for a in effective:
    print("  " + a)
sys.exit(0 if len(effective) == 4 else 1)
PY
python3 "$CHECK" --plan "$TMP/E03.filtered.plan.json" --allow "$ALLOW" | tee "$TMP/check.log" || fail "check-plan.py rejected the plan"
grep -q '^PLAN OK' "$TMP/check.log" || fail "check-plan.py did not print PLAN OK"
rm -f "$OVR" "$TMP/E03.tfplan" "$TMP/E03.plan.json" "$TMP/E03.filtered.plan.json" "$TMP/plan.txt" "$TMP/e03.tfstate"* "$PROD/.terraform/terraform.tfstate"
[ ! -e "$OVR" ] || fail "override file not removed"
docker info >/dev/null 2>&1 || fail "Docker daemon is not running — the three DB test classes need Testcontainers postgres:16-alpine"
( cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests -c Debug --nologo \
    --filter "FullyQualifiedName~WorkerReceiveCountTests|FullyQualifiedName~ManifestBuilderTests|FullyQualifiedName~DeckRollbackTests|FullyQualifiedName~PublishReaperTests|FullyQualifiedName~PublishJobProcessorSchemaTests" ) \
  || fail "targeted dotnet test failed"

# ── 5. Scope + frozen + OTA + apply guard ──────────────────────────────────
echo "[5/5] scope + frozen + OTA + apply guard"
SCOPE_RE='^(infra/modules/worker/queue\.tf|infra/modules/worker/function\.tf|infra/modules/worker/outputs\.tf|infra/README\.md|docs/delivery/r16-issues/.*|src_C/Vpc/Db/Migrations/021_decks_live_build_id\.sql|src_C/Shared/RecallSmith\.Lambda\.Db/ManifestBuilder\.cs|src_C/Shared/RecallSmith\.Lambda\.Db/RecallSmith\.Lambda\.Db\.csproj|src_C/Vpc/Authoring/ManifestRebuild\.cs|src_C/Vpc/Authoring/Publish\.cs|src_C/Vpc/Authoring/Helpers\.cs|src_C/Vpc/Authoring/DeckRollback\.cs|src_C/Vpc/Authoring/PublishReaper\.cs|src_C/Vpc/VpcFunction\.cs|src_C/Vpc/SnapStartHooks\.cs|src_C/Worker/WorkerFunction\.cs|src_C/Worker/Services/IPublishJobProcessor\.cs|src_C/Worker/Services/PublishJobProcessor\.cs|src_C/Worker/Repositories/JobRepository\.cs|src_C/Worker/SnapStartHooks\.cs|src_C/Worker/Manifest/ManifestService\.cs|src_C/Worker/Manifest/IManifestService\.cs|src_C/Tests/RecallSmith\.Lambda\.IntegrationTests/(WorkerReceiveCountTests|ManifestBuilderTests|DeckRollbackTests|PublishReaperTests)\.cs|src_C/Shared/RecallSmith\.Lambda\.Common/RouteMetrics\.cs)$'
# 5a. every changed or untracked path is in scope (pathspec-scoped untracked scan, never bare)
outside="$( { git diff --name-only "$mb" HEAD; git ls-files --others --exclude-standard -- infra src_C scripts docs; } | sort -u | grep -Ev "$SCOPE_RE" || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside E03 scope"; }
# 2026-09-22 widening: E03's two new routes must be registered in RouteMetrics.KnownRoutes or the
# RouteMetricsTests set-equality test fails the src_C gate; E04 (which owns the rest of the file)
# depends on E03, so the only allowed change here is additive registration lines.
rm_ns="$(git diff --numstat "$mb" HEAD -- src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs | awk '{print $1"\t"$2}')"
if [ -n "$rm_ns" ]; then
  del="${rm_ns#*	}"; add="${rm_ns%	*}"
  [ "$del" = 0 ] || fail "RouteMetrics.cs: only additive route registration is allowed (numstat $rm_ns)"
  [ "$add" -le 4 ] || fail "RouteMetrics.cs: at most 4 added lines (numstat $rm_ns)"
  git diff -U0 "$mb" HEAD -- src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs | grep -E '^\+[^+]' | grep -vqE 'rollback|publish/reap' && fail "RouteMetrics.cs: added lines must be the two E03 route registrations"
fi
# 5b. the two ManifestService files appear only as deletions
for f in src_C/Worker/Manifest/ManifestService.cs src_C/Worker/Manifest/IManifestService.cs; do
  git diff --diff-filter=D --name-only "$mb" HEAD -- "$f" | grep -q . || fail "$f must be deleted in this issue"
done
# 5c. frozen / do-not-touch files and the OTA manifest set
frozen="$(git diff --numstat "$mb" HEAD -- \
  mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json mobile \
  infra/envs infra/modules/identity infra/modules/data infra/modules/edge infra/modules/api infra/modules/observability infra/scripts \
  infra/modules/worker/main.tf infra/modules/worker/variables.tf \
  src_C/deploy.sh src_C/package_lambda_zip.sh src_C/Worker/Repositories/IJobRepository.cs \
  src_C/Shared/RecallSmith.Lambda.Common src_C/Shared/RecallSmith.Lambda.Db/Pg.cs src_C/Shared/RecallSmith.Lambda.Db/DbUtil.cs \
  src_C/Vpc/RecallSmith.Lambda.Vpc.csproj src_C/Worker/RecallSmith.Lambda.Worker.csproj src_C/RecallSmith.Lambda.csproj src_C/RecallSmith.Lambda.sln \
  src_C/Tests/RecallSmith.Lambda.IntegrationTests/RecallSmith.Lambda.IntegrationTests.csproj \
  src_C/Vpc/Db/Migrate.cs src_C/Vpc/Runtime src_C/Vpc/Analytics src_C/Vpc/Webhooks src_C/Vpc/Db/Migrations/0[0-2][0-9]_*.sql \
  src_C/Common frontend .github README.md)"
frozen="$(printf '%s\n' "$frozen" | grep -v 'src_C/Vpc/Db/Migrations/021_decks_live_build_id.sql' || true)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
git diff --quiet "$mb" HEAD -- src_C/Tests ":(exclude)$T_WORKER" ":(exclude)$T_BUILDER" ":(exclude)$T_ROLLBACK" ":(exclude)$T_REAPER" \
  || fail "an existing test file changed — E03 is add-only on tests (E00 §1.2)"
grep -Fq '"version": "1.6.1"' mobile/app.json || fail "app.json version changed (OTA runtime 1.6.1)"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (next binary, out of this wave)"; fi
# 5d. apply guard (E00 §5): no worker artefact runs a state-changing command outside comments / echo / DRY_RUN text
APPLY_RE='terraform +(apply|import)|aws +[a-z0-9-]+ +(create|update|delete|put)-'
hits="$( { git diff -U0 "$mb" HEAD -- infra src_C scripts docs/delivery/r16-issues/E03.plan-allow.json | grep '^+' | grep -v '^+++' | sed 's/^+//'; \
           grep -v 'APPLY_RE=' docs/delivery/r16-issues/E03.verify.sh; } \
         | grep -Ev '^[[:space:]]*(#|//|--|\*|/\*)' | grep -Ev 'echo|DRY_RUN|fail "' | grep -E "$APPLY_RE" || true )"
[ -z "$hits" ] || { echo "$hits" >&2; fail "a worker artefact contains a state-changing command (WORKER SAFETY RULE)"; }

echo "E03 VERIFY OK"
