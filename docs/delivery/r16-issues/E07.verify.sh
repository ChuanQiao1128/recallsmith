#!/usr/bin/env bash
# E07 — webhook-input-hardening verify. cwd = worktree root. Re-runs the brief's
# five acceptance bullets verbatim; never trusts the worker's report.
#
# FAILS ON BASE at step 1.
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - src_C/Tests/RecallSmith.Lambda.IntegrationTests/RevenuecatWebhookTests.cs,
#     ProgressEventsPerEventTests.cs, SlugRulesTests.cs and BodyCapTests.cs do
#     not exist on base
#   (step 1 then also checks the E06/E04 prerequisites: Secrets.FixedTimeEquals
#   and Log.Event must be on the integration branch — E00 §4 orders E04 → E06 → E07)
# Step 2 (literal guards: the v14 ImplVersion, the constant-time compare, the
# four-key 401 line, `$9::jsonb … returning 1`, the RejectedEvent record, the
# SlugRegex, the body-cap line) would also fail on base. Steps 3/4 are the
# dotnet build / targeted-xunit gates and step 5 is a purely negative scope +
# frozen + OTA + apply guard; they pass on base by design and are never reached.
#
# Network: none. No AWS CLI, no Terraform (E07 is a code issue — nothing for the
# supervisor to apply; check-plan.py is not involved). `dotnet build` restores
# implicitly from the local NuGet cache (E07 adds no PackageReference). Step 4
# needs a running Docker daemon (Testcontainers postgres:16-alpine, image
# cached). Runtime: steps 1-2 seconds, step 3 ~1-2 min cold, step 4 single-digit
# minutes. The driver's diff-scoped banned-term grep and suppression scan run
# separately (gates a/b) — this script deliberately does not spell those terms.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-e-prod}}"   # driver exports BASE
fail() { echo "E07 VERIFY FAIL: $*" >&2; exit 1; }

RES=src_C/Shared/RecallSmith.Lambda.Common/Res.cs
VAL=src_C/Shared/RecallSmith.Lambda.Common/Validation.cs
SECRETS=src_C/Shared/RecallSmith.Lambda.Common/Secrets.cs
LOGCS=src_C/Shared/RecallSmith.Lambda.Common/Log.cs
DECKS=src_C/Vpc/Authoring/Decks.cs
PUB=src_C/Vpc/Authoring/Publish.cs
PREMIUM=src_C/Vpc/Runtime/PremiumDeckUrl.cs
VPC=src_C/Vpc/VpcFunction.cs
HOOK=src_C/Vpc/Webhooks/RevenuecatWebhook.cs
PROG=src_C/Vpc/Runtime/ProgressEvents.cs
TESTDIR=src_C/Tests/RecallSmith.Lambda.IntegrationTests
RCT=$TESTDIR/RevenuecatWebhookTests.cs
PET=$TESTDIR/ProgressEventsPerEventTests.cs
SLT=$TESTDIR/SlugRulesTests.cs
BCT=$TESTDIR/BodyCapTests.cs
SCOPE=("$RES" "$VAL" "$DECKS" "$PUB" "$PREMIUM" "$VPC" "$HOOK" "$PROG" "$RCT" "$PET" "$SLT" "$BCT")

count() { grep -Ec "$1" "$2" || true; }     # ERE count, 0 when no match
fcount() { grep -Fc "$1" "$2" || true; }    # fixed-string count, 0 when no match
lineof() { grep -Fn "$1" "$2" | head -1 | cut -d: -f1; }
stripped() { sed -n "${1}p" "$2" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'; }

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ E04/E06 prerequisites)"
for f in "$RCT" "$PET" "$SLT" "$BCT"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
for f in "$RES" "$VAL" "$DECKS" "$PUB" "$PREMIUM" "$VPC" "$HOOK" "$PROG"; do
  [ -f "$f" ] || fail "$f is missing from the tree"
done
[ -f "$SECRETS" ] || fail "$SECRETS is missing — E06 must be merged before E07 (E00 §4)"
grep -Fq 'public static bool FixedTimeEquals(string? got, string? expected)' "$SECRETS" || fail "Secrets.FixedTimeEquals signature missing (E06 incomplete)"
grep -Fq 'public static void Event(string level, object fields)' "$LOGCS" || fail "Log.Event signature missing (E04 incomplete)"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. Res.cs — using at line 1, Wrap with extraHeaders, the 413 and 503 helpers
[ "$(sed -n 1p "$RES")" = "using System.Globalization;" ] || fail "Res.cs: line 1 must be 'using System.Globalization;'"
for sym in 'private APIGatewayProxyResponse Wrap(int statusCode, bool success, object? data, ApiError? error, IDictionary<string, string>? extraHeaders = null)' \
           'public APIGatewayProxyResponse PayloadTooLarge() =>' \
           'Code = "PAYLOAD_TOO_LARGE"' \
           'public APIGatewayProxyResponse ServiceUnavailable(string code, string? message, int retryAfterSec)' \
           '["retry-after"] = retryAfterSec.ToString(CultureInfo.InvariantCulture)'; do
  grep -Fq -e "$sym" "$RES" || fail "Res.cs lacks: $sym"
done
# 2b. Validation.cs — the one slug grammar
for sym in 'public const string SlugPattern = "^[a-z0-9][a-z0-9-]{0,63}$";' \
           'public static readonly Regex SlugRegex = new(SlugPattern, RegexOptions.Compiled);' \
           'public const string SlugRuleMessage = "slug must match ^[a-z0-9][a-z0-9-]{0,63}$";' \
           'public static bool IsValidSlug(string? slug)' \
           'public static string RequireSlug(string? slug, string field = "slug")'; do
  grep -Fq -e "$sym" "$VAL" || fail "Validation.cs lacks: $sym"
done
# 2c. Decks.cs — POST + PUT go through RequireSlug
[ "$(fcount 'Validation.RequireSlug(' "$DECKS")" = "2" ] || fail "Decks.cs: exactly two Validation.RequireSlug( call sites (POST + PUT)"
grep -Fq 'slug = Validation.RequireSlug(slug);' "$DECKS" || fail "Decks.cs: POST must assign slug = Validation.RequireSlug(slug);"
grep -Fq 'new("slug", "slug", v => v.ValueKind == JsonValueKind.Null ? null : Validation.RequireSlug(v.ToString())),' "$DECKS" || fail "Decks.cs: PUT spec slug entry missing/changed"
# 2d. Publish.cs — the '/'/'..' check is replaced
grep -Fq 'Validation.RequireSlug(Convert.ToString(deck["slug"], CultureInfo.InvariantCulture), "deckSlug")' "$PUB" || fail "Publish.cs: deckSlug must go through Validation.RequireSlug(…, \"deckSlug\")"
grep -Fq "deckSlug.Contains('/')" "$PUB" && fail "Publish.cs: the old '/' check is still there"
grep -Fq 'contains invalid characters' "$PUB" && fail "Publish.cs: the old message is still there"
# 2e. PremiumDeckUrl.cs — SafeSlug uses the shared grammar, the 400 has a real code
grep -Fq 'return Validation.IsValidSlug(v) ? v : null;' "$PREMIUM" || fail "PremiumDeckUrl.cs: SafeSlug must return Validation.IsValidSlug(v) ? v : null"
grep -Fq 'res.BadRequest("VALIDATION_ERROR", Validation.SlugRuleMessage)' "$PREMIUM" || fail "PremiumDeckUrl.cs: :138 must answer VALIDATION_ERROR with SlugRuleMessage"
grep -Fq '"^[a-z0-9-]+$"' "$PREMIUM" && fail "PremiumDeckUrl.cs: the old private regex is still there"
grep -Fq 'Missing/invalid slug' "$PREMIUM" && fail "PremiumDeckUrl.cs: the old message-as-code call is still there"
# 2f. VpcFunction.cs — one cap line, first statement inside DispatchAsync's try
CAP='if ((req.RawBody?.Length ?? 0) > 1_048_576) return res.PayloadTooLarge();'
[ "$(fcount "$CAP" "$VPC")" = "1" ] || fail "VpcFunction.cs: exactly one body-cap line expected"
cap_ln="$(lineof "$CAP" "$VPC")"
[ "$(stripped "$((cap_ln - 1))" "$VPC")" = "{" ] && [ "$(stripped "$((cap_ln - 2))" "$VPC")" = "try" ] \
  || fail "VpcFunction.cs: the cap must be the first statement inside the try (lines $((cap_ln - 2))-$((cap_ln - 1)) are not 'try' + '{')"
p_ln="$(lineof "var p = req.Path.TrimEnd('/');" "$VPC")"
[ -n "$p_ln" ] && [ "$cap_ln" -lt "$p_ln" ] || fail "VpcFunction.cs: the cap must precede var p = req.Path.TrimEnd('/')"
# 2g. RevenuecatWebhook.cs — v14, constant-time compare, four-key 401, jsonb + returning 1, 503 helper, Log.Event everywhere
for sym in 'private const string ImplVersion = "2026-09-22T00:00Z-v14";' \
           'if (!Secrets.FixedTimeEquals(gotToken, expectedToken))' \
           'return res.Raw(401, new { ok = false, error = "Unauthorized", mode, impl = ImplVersion });' \
           'private static async Task<bool> InsertRcEventOnce(' \
           '$9::jsonb' \
           'on conflict (event_id) do nothing returning 1;' \
           'private static APIGatewayProxyResponse DbUnavailable(Res res, string mode) =>' \
           'error = "DB_UNAVAILABLE"' \
           '["retry-after"] = "60"' \
           'replayed' \
           'reason = "unauthorized"' 'reason = "db_unavailable"' 'reason = "db_insert_failed"' \
           'reason = "env_mismatch"' 'reason = "product_mismatch"' 'reason = "db_upsert_failed"' 'reason = "accepted"'; do
  grep -Fq -e "$sym" "$HOOK" || fail "RevenuecatWebhook.cs lacks: $sym"
done
for bad in 'gotToken != expectedToken' 'host.Contains("dev"' 'Console.WriteLine(' 'Log.Warn(' 'conn is not null'; do
  grep -Fq "$bad" "$HOOK" && fail "RevenuecatWebhook.cs still contains: $bad"
done
[ "$(count 'Log\.Event\(' "$HOOK")" -ge 7 ] || fail "RevenuecatWebhook.cs: expected >= 7 Log.Event( lines (one per reason)"
# 2h. ProgressEvents.cs — v2, caps, RejectedEvent, five codes, rating rule, response keys
for sym in 'private const string ProgressEventsImpl = "progressEvents-v2";' \
           'private const int MaxIdentifierLength = 128;' \
           'private const int MaxShortStringLength = 64;' \
           'private sealed record RejectedEvent(int Index, string? EventId, string Code);' \
           '"NOT_OBJECT"' '"BAD_EVENT_ID"' '"MISSING_FIELD"' '"BAD_EVENT_TIME"' '"TOO_LONG"' \
           'if (rating is < 1 or > 4) rating = null;' \
           'step = "ingest_rejected"'; do
  grep -Fq -e "$sym" "$PROG" || fail "ProgressEvents.cs lacks: $sym"
done
[ "$(fcount 'receivedCount = events.Count,' "$PROG")" -ge 2 ] || fail "ProgressEvents.cs: receivedCount = events.Count, expected in both responses"
[ "$(count '^[[:space:]]+rejectedEventIds,$' "$PROG")" -ge 2 ] || fail "ProgressEvents.cs: rejectedEventIds, expected in both responses"
[ "$(count '^[[:space:]]+rejected,$' "$PROG")" -ge 2 ] || fail "ProgressEvents.cs: rejected, expected in both responses"
for bad in 'throw new ValidationError($"events[' 'RequireString(' 'receivedCount = allEventIds.Count'; do
  grep -Fq "$bad" "$PROG" && fail "ProgressEvents.cs still contains: $bad"
done
# 2i. Tests — collections, method names, the pinned literals
for f in "$RCT" "$PET" "$SLT" "$BCT"; do
  grep -Fq '[Collection(PostgresCollection.Name)]' "$f" || fail "$f must join the postgres collection"
done
for s in Post_WrongTokenSameLength_Is401WithFourKeysOnly Post_MissingAuthorization_Is401 Get_Is405 Post_BadJson_Is400 \
         Post_TestEvent_Is200_AndRowIsRecorded Post_Purchase_Is200_UpsertsPremium_ReplayKeepsOneRow \
         Post_EnvMismatch_Is200NotAccepted Post_ProductMismatch_Is200NotAccepted Post_NoPgEnv_Is503WithRetryAfter \
         Post_DbOpenFails_Is503WithRetryAfter Post_UpsertFails_Is503_ThenRetrySucceeds; do
  grep -Fq "$s(" "$RCT" || fail "RevenuecatWebhookTests.cs: missing test $s"
done
for s in 'test-secret-dev' 'retry-after' 'DB_UNAVAILABLE' 'e07_rc_partial' 'maxVersion: 2' 'Pg.Reset()'; do
  grep -Fq -e "$s" "$RCT" || fail "RevenuecatWebhookTests.cs lacks: $s"
done
for s in OneBadEventAmongTwentyFive_Is200_AndOthersAreStored AllRejected_Is200_WithZeroRows \
         RejectedIds_AreAlsoDuplicateIds_ForTheFrozenClient TooLongPerEventField_IsRejectedWithTooLong \
         RatingOutOfRange_IsStoredAsNull_NotRejected BatchLevelStrings_AreClampedTo64 StructuralErrors_Still400 \
         Invariants_HoldForGeneratedBatches; do
  grep -Fq "$s(" "$PET" || fail "ProgressEventsPerEventTests.cs: missing test $s"
done
grep -Fq '[MemberData(' "$PET" || fail "ProgressEventsPerEventTests.cs needs a [MemberData( property table (E00 §3.3)"
grep -Fq 'GeneratedCaseCount = 60' "$PET" || fail "ProgressEventsPerEventTests.cs: GeneratedCaseCount = 60 missing"
for s in IsValidSlug_AcceptTable IsValidSlug_RejectTable IsValidSlug_GeneratedCases RequireSlug_TrimsOrThrowsWithTheRuleMessage \
         PostDeck_BadSlug_Is400_AndNothingInserted PostDeck_GoodSlug_Is200 PutDeck_BadSlug_Is400_AndRowUnchanged \
         PublishPreview_BadSlugRow_Is400 PremiumUrl_BadSlug_Is400 PremiumUrl_UpperCaseSlug_PassesTheSlugGate; do
  grep -Fq "$s(" "$SLT" || fail "SlugRulesTests.cs: missing test $s"
done
grep -Fq '[MemberData(' "$SLT" || fail "SlugRulesTests.cs needs a [MemberData( property table (E00 §3.3)"
grep -Fq 'GeneratedCaseCount = 60' "$SLT" || fail "SlugRulesTests.cs: GeneratedCaseCount = 60 missing"
grep -Fq 'slug must match ^[a-z0-9][a-z0-9-]{0,63}$' "$SLT" || fail "SlugRulesTests.cs must pin the rule message"
for s in OverCap_Is413_BeforeRouting AtCap_IsNot413 OverCap_Base64Decoded_Is413 OverCap_OnWebhookPath_Is413_BeforeAuth Options_IsNeverCapped; do
  grep -Fq "$s(" "$BCT" || fail "BodyCapTests.cs: missing test $s"
done
for s in '1_048_576' 'PAYLOAD_TOO_LARGE' 'new VpcFunction().Handler('; do
  grep -Fq -e "$s" "$BCT" || fail "BodyCapTests.cs lacks: $s"
done
# 2j. suppression / gutting across every scope file (C07.verify.sh:151 + the C# spellings)
if grep -Eq 'Skip[[:space:]]*=|#pragma warning disable|\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable' "${SCOPE[@]}"; then
  grep -En 'Skip[[:space:]]*=|#pragma warning disable|\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable' "${SCOPE[@]}" >&2 || true
  fail "test gutting / suppression found"
fi
# 2k. secret-leak guard (E00 §5) over the + lines of the diff and the new files: a name may appear, a literal value may not
mb="$(git merge-base "$BASE_REF" HEAD 2>/dev/null || git merge-base "origin/$BASE_REF" HEAD 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
added="$( { git diff -U0 "$mb" -- src_C | grep -E '^\+[^+]' || true; cat "$RCT" "$PET" "$SLT" "$BCT"; } )"
if printf '%s\n' "$added" | grep -Eq '(PGPASSWORD|MIGRATE_SECRET|INTERNAL_SHARED_SECRET|RC_WEBHOOK_AUTH_(PRODUCTION|DEVELOPMENT)|ANALYTICS_USER_SALT)\s*[=:]\s*"[^"$P]'; then
  fail "a secret-looking literal follows a secret env-var name in the diff"
fi

# ── 3. dotnet build (implicit cached restore; no network) ──────────────────
echo "[3/5] dotnet build RecallSmith.Lambda.sln -c Release"
( cd src_C && dotnet build RecallSmith.Lambda.sln -c Release -nologo ) || fail "dotnet build failed"

# ── 4. Targeted xunit (Docker required) ────────────────────────────────────
echo "[4/5] dotnet test --filter (E07 classes + the ingest / authoring / bearer suites they sit beside)"
docker info >/dev/null 2>&1 || fail "Docker daemon is not running — the E07 classes need Testcontainers postgres:16-alpine"
( cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests -c Release --no-build --nologo \
    --filter "FullyQualifiedName~RevenuecatWebhookTests|FullyQualifiedName~ProgressEventsPerEventTests|FullyQualifiedName~SlugRulesTests|FullyQualifiedName~BodyCapTests|FullyQualifiedName~ProgressEventsIntegrationTests|FullyQualifiedName~ProgressEventsSingleStatementTests|FullyQualifiedName~ProgressEventsClientFeaturesTests|FullyQualifiedName~ProgressEventsCardFormatTests|FullyQualifiedName~CardsAuthoringTopicTests|FullyQualifiedName~AuthBearerTests" ) \
  || fail "targeted dotnet test failed"

# ── 5. Scope + frozen + OTA + apply guard (purely negative; passes on base) ─
echo "[5/5] scope + frozen + OTA + apply guard"
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json mobile frontend infra .github snowflake \
  src_C/Vpc/Db src_C/deploy.sh src_C/env src_C/package_lambda_zip.sh \
  "$SECRETS" "$LOGCS" src_C/Shared/RecallSmith.Lambda.Common/Auth.cs src_C/Shared/RecallSmith.Lambda.Common/LambdaRequest.cs \
  src_C/Shared/RecallSmith.Lambda.Db/Pg.cs src_C/Shared/RecallSmith.Lambda.Db/DbUtil.cs \
  "$TESTDIR/IntegrationTestBase.cs" \
  ':(glob)src_C/**/*.csproj' ':(glob)docs/*.md')"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
# every pre-existing test file is byte-identical: the only diff under Tests/ is the four new classes
tests_changed="$(git diff --name-only "$mb" -- "$TESTDIR" | grep -Ev "^$TESTDIR/(RevenuecatWebhookTests|ProgressEventsPerEventTests|SlugRulesTests|BodyCapTests)\.cs$" || true)"
[ -z "$tests_changed" ] || { echo "$tests_changed" >&2; fail "an existing test file changed — E07 is add-only on tests (E00 §1.2)"; }
grep -Fq '"version": "1.6.1"' mobile/app.json || fail "app.json version changed (OTA runtime 1.6.1)"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (next binary, out of this wave)"; fi
# Untracked scan is pathspec-scoped, never bare: the driver symlinks mobile/node_modules and
# frontend/node_modules into the worktree and the `node_modules/` ignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb" HEAD; git ls-files --others --exclude-standard -- src_C scripts docs infra mobile/src mobile/tests frontend/src frontend/tests .github snowflake; } | sort -u | grep -Ev '^(src_C/Shared/RecallSmith\.Lambda\.Common/Res\.cs|src_C/Shared/RecallSmith\.Lambda\.Common/Validation\.cs|src_C/Vpc/Authoring/Decks\.cs|src_C/Vpc/Authoring/Publish\.cs|src_C/Vpc/Runtime/PremiumDeckUrl\.cs|src_C/Vpc/VpcFunction\.cs|src_C/Vpc/Webhooks/RevenuecatWebhook\.cs|src_C/Vpc/Runtime/ProgressEvents\.cs|src_C/Tests/RecallSmith\.Lambda\.IntegrationTests/(RevenuecatWebhookTests|ProgressEventsPerEventTests|SlugRulesTests|BodyCapTests)\.cs|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside E07 scope"; }
# Apply guard (E00 §5): no worker artefact runs terraform apply/import or a state-changing aws call outside a comment.
applyish="$(printf '%s\n' "$added" | sed 's/^+//' | grep -Ev '^[[:space:]]*(//|#|--|\*)' | grep -En 'terraform +(apply|import)|aws +[a-z0-9-]+ +(create|update|delete|put)-' || true)"
[ -z "$applyish" ] || { echo "$applyish" >&2; fail "a worker artefact contains an apply / state-changing aws command"; }

echo "E07 VERIFY OK"
