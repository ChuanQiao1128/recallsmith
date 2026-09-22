#!/usr/bin/env bash
# E14 — brand-and-dedupe verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# FAILS ON BASE at step 1:
#   - src_C/Shared/RecallSmith.Lambda.Common/RequestDeadline.cs and
#     src_C/Tests/RecallSmith.Lambda.IntegrationTests/DeadlineTokenTests.cs
#     do not exist on base; src_C/Common, src_C/RecallSmith.Lambda.csproj,
#     src_C/Vpc/Db/Pg.cs and src_C/Vpc/Db/DbUtil.cs still do.
#   (step 1 then also checks two prerequisites that E00 §4 orders before E14:
#   E07's Res.ServiceUnavailable(string code, …) and E04's
#   DefaultNamespace = "DeveloperCards" — present on the integration branch,
#   absent on base.)
# Step 2 (literal guards: the DeveloperCards strings, the using flips, the
# CommandTimeout / RequestDeadline / Handler signature literals, the numstat
# bounds) would also fail on base. Step 3 = dotnet build + console lint/build,
# step 4 = targeted xunit (Docker) + vitest, step 5 = scope + frozen + OTA +
# apply guard; they pass on base by design and are never reached there.
#
# No AWS CLI, no Terraform, no plan: E14 owns no .tf and has no plan-allow
# file. The supervisor deploys (src_C/deploy.sh, frontend/deploy.sh) after the
# merge — never this script, never the worker.
#
# Network: none. dotnet restores from the local NuGet cache (Npgsql 10.0.0 is
# already there); npm runs against the symlinked node_modules. Step 4 needs a
# running Docker daemon (Testcontainers postgres:16-alpine, image cached).
# Runtime: steps 1-2 seconds, step 3 ~3-4 min cold, step 4 single-digit
# minutes. The driver's diff-scoped banned-term grep and suppression scan run
# separately; this script does not spell the six terms (E00 §0).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-e-prod}}"   # driver exports BASE
fail() { echo "E14 VERIFY FAIL: $*" >&2; exit 1; }

# grep over source trees, never over build output
srcgrep() { grep -rn "$@" | grep -v '/obj/\|/bin/' || true; }

# ── paths ──────────────────────────────────────────────────────────────────
IDX=frontend/index.html
ADMIN=frontend/src/pages/AdminUsersPage.tsx
EDIT=frontend/src/pages/DeckEditPage.tsx
LOGIN=frontend/src/pages/LoginPage.tsx
NEWDECK=frontend/src/pages/NewDeckPage.tsx
T_UI=frontend/tests/uiLanguage.test.ts
T_DROP=frontend/tests/deckFormFieldDrop.test.tsx
T_NEW=frontend/tests/newDeckPage.test.tsx
README=README.md
REVIEW=docs/backend-architecture-review-2026-09-22.md

COMMON_DIR=src_C/Common
ROOT_CSPROJ=src_C/RecallSmith.Lambda.csproj
DUP_PG=src_C/Vpc/Db/Pg.cs
DUP_DBUTIL=src_C/Vpc/Db/DbUtil.cs
MIGRATE=src_C/Vpc/Db/Migrate.cs
QPS=src_C/Vpc/Db/QueryPremiumState.cs
QRC=src_C/Vpc/Db/QueryRcEvents.cs
CIDEMO=src_C/Vpc/Db/ContentIntelligenceDemo.cs
NETCHECK=src_C/Vpc/Db/Netcheck.cs
OUTBOX=src_C/Vpc/Analytics/OutboxPublisher.cs
CISNAP=src_C/Vpc/Analytics/ContentIntelligenceSnapshotImport.cs
HOOKS=src_C/Vpc/SnapStartHooks.cs
COMMON_CSPROJ=src_C/Shared/RecallSmith.Lambda.Common/RecallSmith.Lambda.Common.csproj
DB_CSPROJ=src_C/Shared/RecallSmith.Lambda.Db/RecallSmith.Lambda.Db.csproj
PG=src_C/Shared/RecallSmith.Lambda.Db/Pg.cs
DBUTIL=src_C/Shared/RecallSmith.Lambda.Db/DbUtil.cs
DEADLINE=src_C/Shared/RecallSmith.Lambda.Common/RequestDeadline.cs
RES=src_C/Shared/RecallSmith.Lambda.Common/Res.cs
VPCFN=src_C/Vpc/VpcFunction.cs
METRICS=src_C/Shared/RecallSmith.Lambda.Common/RouteMetrics.cs
TESTDIR=src_C/Tests/RecallSmith.Lambda.IntegrationTests
TBASE=$TESTDIR/IntegrationTestBase.cs
TWARM=$TESTDIR/DbWarmupTests.cs
TDEAD=$TESTDIR/DeadlineTokenTests.cs

HANDLER_SIG='public async Task<APIGatewayProxyResponse> Handler(JsonElement evt, ILambdaContext? ctx = null)'

# ── 1. Scope files exist / are gone (FAILS ON BASE) ────────────────────────
echo "[1/5] scope files exist / duplicates gone (+ E04/E07 prerequisites)"
for f in "$DEADLINE" "$TDEAD"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
for p in "$COMMON_DIR" "$ROOT_CSPROJ" "$DUP_PG" "$DUP_DBUTIL"; do
  [ ! -e "$p" ] || fail "$p still exists — E14 deletes it"
done
[ -z "$(git ls-files -- "$COMMON_DIR" "$ROOT_CSPROJ" "$DUP_PG" "$DUP_DBUTIL")" ] \
  || fail "a deleted duplicate is still tracked (use git rm)"
for f in "$IDX" "$ADMIN" "$EDIT" "$LOGIN" "$NEWDECK" "$T_UI" "$T_DROP" "$T_NEW" "$README" "$REVIEW" \
         "$MIGRATE" "$QPS" "$QRC" "$CIDEMO" "$NETCHECK" "$OUTBOX" "$CISNAP" "$HOOKS" \
         "$COMMON_CSPROJ" "$DB_CSPROJ" "$PG" "$DBUTIL" "$RES" "$VPCFN" "$METRICS" "$TBASE" "$TWARM"; do
  [ -f "$f" ] || fail "$f is missing from the tree"
done
grep -Fq 'ServiceUnavailable(string code' "$RES" \
  || fail "Res.cs lacks ServiceUnavailable(string code, …) — E07 must be merged before E14 (E00 §4)"
grep -Fq 'DefaultNamespace = "DeveloperCards"' "$METRICS" \
  || fail "RouteMetrics.cs still carries the old namespace — E04 must be merged before E14 (E00 §6 #4)"

mb="$(git merge-base "$BASE_REF" HEAD 2>/dev/null || git merge-base "origin/$BASE_REF" HEAD 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
numstat() { git diff --numstat "$mb" HEAD -- "$1" | cut -f1,2; }

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. Console + README brand strings
grep -Fq '<title>DeveloperCards Console</title>' "$IDX"        || fail "index.html title not renamed"
[ "$(grep -Fc 'title="DeveloperCards Console"' "$ADMIN")" = "2" ] || fail "AdminUsersPage.tsx needs title=\"DeveloperCards Console\" exactly twice"
[ "$(grep -Fc 'title="DeveloperCards Console"' "$EDIT")" = "1" ]  || fail "DeckEditPage.tsx needs title=\"DeveloperCards Console\" exactly once"
grep -Fq 'DeveloperCards Authoring Console' "$LOGIN"            || fail "LoginPage.tsx subtitle not renamed"
grep -Fq "author: 'DeveloperCards Team'," "$NEWDECK"            || fail "NewDeckPage.tsx default author not renamed"
grep -Fq 'placeholder="DeveloperCards Team"' "$NEWDECK"         || fail "NewDeckPage.tsx placeholder not renamed"
grep -Fq '/<title>DeveloperCards Console<\/title>/' "$T_UI"     || fail "uiLanguage.test.ts title regex not renamed"
grep -Fq "getByPlaceholderText('DeveloperCards Team')" "$T_DROP" || fail "deckFormFieldDrop.test.tsx placeholder not renamed"
[ "$(grep -Fc "'DeveloperCards Team'" "$T_NEW")" = "5" ]         || fail "newDeckPage.test.tsx needs 'DeveloperCards Team' exactly five times"
[ "$(grep -Fc "'  DeveloperCards Team  '" "$T_NEW")" = "1" ]     || fail "newDeckPage.test.tsx needs the padded '  DeveloperCards Team  ' once (the trim case)"
[ "$(sed -n '1p' "$README")" = "# DeveloperCards" ]              || fail "README.md line 1 must be '# DeveloperCards'"
left="$(grep -rn 'RecallSmith' "$IDX" frontend/src frontend/tests/*.ts frontend/tests/*.tsx | grep -v '^frontend/src/gacha/rarityConfig.ts:2:' || true)"
[ -z "$left" ] || { echo "$left" >&2; fail "user-visible RecallSmith string left in the console (only the rarityConfig.ts:2 comment may stay)"; }
for spec in "$IDX 1 1" "$LOGIN 1 1" "$EDIT 1 1" "$T_UI 1 1" "$T_DROP 1 1" "$README 1 1" "$ADMIN 2 2" "$NEWDECK 2 2" "$T_NEW 6 6"; do
  set -- $spec; f="$1"; want="$(printf '%s\t%s' "$2" "$3")"; got="$(numstat "$f")"
  [ "$got" = "$want" ] || fail "$f numstat must be '$2 $3' (added / removed), got '${got:-<no diff>}'"
done
# 2b. Server: no brand literal left (E04 flipped the EMF namespace; nothing else ever had one)
sb="$(srcgrep '"RecallSmith[" /]' src_C/Vpc src_C/Shared src_C/Worker src_C/Public --include='*.cs')"
[ -z "$sb" ] || { echo "$sb" >&2; fail "a brand literal survives in src_C"; }
# 2c. The review doc registers the three deleted paths, and nothing else changed there
block="$(awk '/<!--[[:space:]]*paths-not-on-disk/{p=1} p{print} /-->/{if(p){exit}}' "$REVIEW")"
for entry in '- src_C/Common/' '- src_C/Vpc/Db/Pg.cs' '- src_C/Vpc/Db/DbUtil.cs'; do
  printf '%s\n' "$block" | grep -Fxq "$entry" || fail "review doc paths-not-on-disk block lacks '$entry'"
done
[ "$(numstat "$REVIEW")" = "$(printf '3\t0')" ] || fail "review doc numstat must be '3 0' (three bullets appended, nothing else), got '$(numstat "$REVIEW")'"
# 2d. Duplicates gone from every consumer; the four namespace files and two Analytics files re-pointed
dup="$(srcgrep -E 'RecallSmith\.Lambda\.Vpc\.Db\.DbUtil|Vpc\.Db\.Pg\b|VpcDb' src_C --include='*.cs')"
[ -z "$dup" ] || { echo "$dup" >&2; fail "something still names the deleted Vpc.Db duplicates"; }
for f in "$MIGRATE" "$QPS" "$QRC" "$CIDEMO"; do
  grep -Fxq 'using RecallSmith.Lambda.Db;' "$f" || fail "$f lacks 'using RecallSmith.Lambda.Db;'"
done
for f in "$MIGRATE" "$CIDEMO" "$OUTBOX" "$CISNAP"; do
  grep -Fxq 'using static RecallSmith.Lambda.Db.DbUtil;' "$f" || fail "$f lacks 'using static RecallSmith.Lambda.Db.DbUtil;'"
done
git diff --quiet "$mb" HEAD -- "$NETCHECK" || fail "Netcheck.cs must stay byte-identical (it never used the duplicate)"
grep -Fq 'Pg.Reset()' "$HOOKS" || fail "SnapStartHooks.cs lost the canonical Pg.Reset()"
# 2e. Npgsql aligned to 10.0.0 in the two Shared projects, nowhere else touched
for f in "$COMMON_CSPROJ" "$DB_CSPROJ"; do
  grep -Fq '<PackageReference Include="Npgsql" Version="10.0.0" />' "$f" || fail "$f does not pin Npgsql 10.0.0"
  [ "$(numstat "$f")" = "$(printf '1\t1')" ] || fail "$f numstat must be '1 1' (the Npgsql line only), got '$(numstat "$f")'"
done
old="$(grep -rln 'Npgsql" Version="8' src_C --include='*.csproj' || true)"
[ -z "$old" ] || { echo "$old" >&2; fail "an Npgsql 8.x pin survives"; }
# 2f. Timeout chain: Pg.cs, DbUtil.cs, RequestDeadline.cs
grep -Fq 'PG_COMMAND_TIMEOUT' "$PG"                        || fail "Pg.cs lacks the PG_COMMAND_TIMEOUT knob"
grep -Fq '? ctm : 20;' "$PG"                               || fail "Pg.cs CommandTimeout default must be 20"
grep -A1 -F 'MaxAutoPrepare = autoPrepare,' "$PG" | grep -Fq 'CommandTimeout = commandTimeout,' \
  || fail "Pg.cs: 'CommandTimeout = commandTimeout,' must directly follow 'MaxAutoPrepare = autoPrepare,'"
[ "$(grep -Fc 'var ct = RequestDeadline.Token;' "$DBUTIL")" = "3" ] || fail "DbUtil.cs must capture RequestDeadline.Token once per public method (3×)"
for call in 'ExecuteReaderAsync(ct)' 'ReadAsync(ct)' 'IsDBNullAsync(i, ct)' 'ExecuteNonQueryAsync(ct)' 'ExecuteScalarAsync(ct)'; do
  grep -Fq "$call" "$DBUTIL" || fail "DbUtil.cs lacks $call"
done
if grep -Eq 'ExecuteReaderAsync\(\)|ExecuteNonQueryAsync\(\)|ExecuteScalarAsync\(\)|ReadAsync\(\)|IsDBNullAsync\(i\)' "$DBUTIL"; then
  fail "DbUtil.cs still has a token-less Npgsql call"
fi
for sym in 'namespace RecallSmith.Lambda.Common;' \
           'public static class RequestDeadline' \
           'AsyncLocal<CancellationToken>' \
           'public static CancellationToken Token' \
           'public static Scope Set(TimeSpan budget)' \
           'public sealed class Scope : IDisposable' \
           'cts.CancelAfter(budget)'; do
  grep -Fq -e "$sym" "$DEADLINE" || fail "RequestDeadline.cs lacks: $sym"
done
if grep -Eq 'GetEnvironmentVariable|Console\.' "$DEADLINE"; then fail "RequestDeadline.cs must not read env or write to the console"; fi
# 2g. VpcFunction: ONE method named Handler, the optional-context signature, the deadline line
grep -Fxq 'using Amazon.Lambda.Core;' "$VPCFN" || fail "VpcFunction.cs lacks 'using Amazon.Lambda.Core;'"
[ "$(grep -cE '^\s*public .*\bHandler\(' "$VPCFN")" = "1" ] \
  || fail "VpcFunction.cs must declare exactly ONE method named Handler (the .NET runtime rejects overloads at INIT)"
grep -Fq "$HANDLER_SIG" "$VPCFN" || fail "VpcFunction.cs Handler signature must be: $HANDLER_SIG"
grep -Fq 'RequestDeadline.Set(ctx.RemainingTime - TimeSpan.FromSeconds(2))' "$VPCFN" || fail "VpcFunction.cs lacks the RequestDeadline.Set(ctx.RemainingTime - 2 s) line"
grep -Fq 'res.Error500(ex)' "$VPCFN" || fail "VpcFunction.cs final catch must still call res.Error500(ex)"
# 2h. Res.Error500 maps a deadline cancellation to 503 DEADLINE, add-only
grep -Fq 'if (ex is OperationCanceledException && RequestDeadline.Token.IsCancellationRequested)' "$RES" \
  || fail "Res.cs Error500 lacks the OperationCanceledException + deadline guard"
grep -Fq 'return ServiceUnavailable("DEADLINE", null, 5);' "$RES" || fail "Res.cs lacks 'return ServiceUnavailable(\"DEADLINE\", null, 5);'"
grep -Fq '?? "v1"' "$RES" || fail "Res.cs: the API version default must stay ?? \"v1\""
res_ns="$(numstat "$RES")"
[ "$(printf '%s' "$res_ns" | cut -f2)" = "0" ] || fail "Res.cs must be add-only (removed = 0), got numstat '$res_ns'"
[ "$(printf '%s' "$res_ns" | cut -f1)" -le 8 ] || fail "Res.cs may gain at most 8 lines, got numstat '$res_ns'"
# 2i. Tests: TestLambdaContext + InvokeFunctionAsync (add-only), DbWarmupTests bounded, DeadlineTokenTests complete
grep -Fq 'public sealed class TestLambdaContext : ILambdaContext' "$TBASE" || fail "IntegrationTestBase.cs lacks TestLambdaContext"
grep -Fq 'InvokeFunctionAsync(JsonElement evt, TimeSpan remainingTime)' "$TBASE" || fail "IntegrationTestBase.cs lacks LambdaHost.InvokeFunctionAsync(JsonElement evt, TimeSpan remainingTime)"
grep -Fxq 'using Amazon.Lambda.Core;' "$TBASE" || fail "IntegrationTestBase.cs lacks 'using Amazon.Lambda.Core;'"
[ "$(numstat "$TBASE" | cut -f2)" = "0" ] || fail "IntegrationTestBase.cs must be add-only, got numstat '$(numstat "$TBASE")'"
[ "$(numstat "$TWARM")" = "$(printf '1\t5')" ] || fail "DbWarmupTests.cs numstat must be '1 5' (Changes 13), got '$(numstat "$TWARM")'"
[ "$(grep -Fc 'Assert.NotSame(poolBefore, Pg.DataSource());' "$TWARM")" = "2" ] || fail "DbWarmupTests.cs must keep both Assert.NotSame(poolBefore, Pg.DataSource())"
grep -Fq '[Collection(PostgresCollection.Name)]' "$TDEAD" || fail "DeadlineTokenTests.cs must join PostgresCollection"
for m in Token_WithoutScope_IsNone \
         Set_Token_CancelsAfterBudget \
         Set_NonPositiveBudget_IsCancelledImmediately \
         Scope_Dispose_RestoresPreviousToken \
         Set_FlowsToAwaitedCalls_NotToTheCaller \
         Handler_WithContext_AnswersHealth_AndLeavesNoTokenBehind \
         Handler_WithoutContext_StillAnswers \
         Handler_IsTheOnlyMethodNamedHandler \
         QueryAsync_UnderExpiredDeadline_ThrowsOperationCanceled_Fast \
         ExecuteScalarAsync_WithoutScope_Runs \
         DataSource_CommandTimeout_Is20 \
         Error500_OperationCanceled_UnderCancelledDeadline_Is503Deadline \
         Error500_OperationCanceled_WithoutDeadline_Stays500 \
         Error500_OperationCanceled_UnexpiredDeadline_Stays500; do
  grep -Fq "public async Task $m(" "$TDEAD" || grep -Fq "public void $m(" "$TDEAD" || fail "DeadlineTokenTests.cs lacks $m"
done
# 2j. Suppression / gutting scan: the two NEW files whole, plus every added line of the diff
#     (C07.verify.sh:151 shape). Whole-file scans of edited files would misfire on the
#     pre-existing eslint-disable-next-line at AdminUsersPage.tsx:187.
if grep -Eq "Skip *=|#pragma warning disable|\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$DEADLINE" "$TDEAD"; then
  fail "test gutting / suppression found in a new file"
fi
added="$(git diff -U0 "$mb" HEAD -- src_C frontend README.md docs ':(exclude)docs/delivery' | grep -E '^\+[^+]' | sed 's/^+//' || true)"
if printf '%s\n' "$added" | grep -Eq "Skip *=|#pragma warning disable|\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable"; then
  fail "suppression token in an added line"
fi
# secret-leak guard (E00 §5): a secret NAME may appear, a literal value may not
if printf '%s\n' "$added" | grep -Eq '(PGPASSWORD|MIGRATE_SECRET|INTERNAL_SHARED_SECRET|RC_WEBHOOK_AUTH_(PRODUCTION|DEVELOPMENT)|ANALYTICS_USER_SALT)\s*[=:]\s*"[^"$P]'; then
  fail "secret-shaped literal in an added line"
fi

# ── 3. Root gates: dotnet build (Release, the whole solution) + console lint/build ──
echo "[3/5] dotnet build RecallSmith.Lambda.sln + frontend lint/build"
( cd src_C && dotnet build RecallSmith.Lambda.sln -c Release -nologo ) || fail "dotnet build failed"
( cd frontend && npm run lint ) || fail "frontend lint failed"
( cd frontend && npm run build ) || fail "frontend build failed"

# ── 4. Targeted tests: six server classes (Docker) + five vitest files ─────
echo "[4/5] dotnet test (DeadlineToken / DbWarmup / RouteMetrics / AuthBearer / CorsAllowlist / CardsPage) + vitest"
docker info >/dev/null 2>&1 || fail "Docker daemon not running (Testcontainers needs it for step 4)"
( cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests -c Release --no-build --nologo \
    --filter "FullyQualifiedName~DeadlineTokenTests|FullyQualifiedName~DbWarmupTests|FullyQualifiedName~RouteMetricsTests|FullyQualifiedName~AuthBearerTests|FullyQualifiedName~CorsAllowlistTests|FullyQualifiedName~CardsPageTests" ) \
  || fail "targeted dotnet test failed"
( cd frontend && npx vitest run \
    tests/uiLanguage.test.ts \
    tests/deckFormFieldDrop.test.tsx \
    tests/newDeckPage.test.tsx \
    tests/docsPaths.test.ts \
    tests/rootReadmePaths.test.ts \
    --reporter=dot ) || fail "targeted vitest failed"

# ── 5. Scope + frozen + OTA + apply guard ──────────────────────────────────
echo "[5/5] scope + frozen + OTA + apply guard"
# 5a. Frozen mobile files and the OTA manifest set are zero-diff; no Sentry
git diff --quiet "$mb" HEAD -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  || fail "a frozen mobile file changed"
git diff --quiet "$mb" HEAD -- mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json \
  || fail "OTA manifest set changed (package.json / package-lock.json / app.json / eas.json)"
grep -Fq '"version": "1.6.1"' mobile/app.json || fail "mobile/app.json version changed"
if grep -rq "@sentry" mobile/src; then fail "@sentry reference under mobile/src (next binary, not this wave)"; fi
# 5b. Do-not-touch set inside src_C and elsewhere
untouched="$(git diff --numstat "$mb" HEAD -- \
  "$METRICS" "$TESTDIR/RouteMetricsTests.cs" src_C/Shared/RecallSmith.Lambda.Common/Log.cs "$NETCHECK" \
  src_C/RecallSmith.Lambda.sln src_C/Vpc/RecallSmith.Lambda.Vpc.csproj src_C/Worker src_C/Public \
  "$TESTDIR/RecallSmith.Lambda.IntegrationTests.csproj" "$TESTDIR/CardsPageTests.cs" "$TESTDIR/AuthBearerTests.cs" \
  "$TESTDIR/CorsAllowlistTests.cs" src_C/deploy.sh src_C/env src_C/package_lambda_zip.sh infra snowflake .github site scripts)"
[ -z "$untouched" ] || { echo "$untouched" >&2; fail "a do-not-touch file changed"; }
# 5c. Every changed or untracked path is one of the scope entries (pathspec-scoped untracked scan:
#     the driver symlinks node_modules, and a bare scan would list it)
outside="$( { git diff --name-only "$mb" HEAD; git ls-files --others --exclude-standard -- src_C frontend/src frontend/tests frontend/index.html README.md docs mobile/src mobile/tests snowflake infra .github site scripts; } \
  | sort -u | grep -Ev '^(frontend/index\.html|frontend/src/pages/(AdminUsersPage|DeckEditPage|LoginPage|NewDeckPage)\.tsx|frontend/tests/(uiLanguage\.test\.ts|deckFormFieldDrop\.test\.tsx|newDeckPage\.test\.tsx)|README\.md|docs/backend-architecture-review-2026-09-22\.md|src_C/Common/[^/]+\.cs|src_C/RecallSmith\.Lambda\.csproj|src_C/Vpc/Db/(Pg|DbUtil|Migrate|QueryPremiumState|QueryRcEvents|ContentIntelligenceDemo)\.cs|src_C/Vpc/Analytics/(OutboxPublisher|ContentIntelligenceSnapshotImport)\.cs|src_C/Vpc/SnapStartHooks\.cs|src_C/Shared/RecallSmith\.Lambda\.Common/(RecallSmith\.Lambda\.Common\.csproj|RequestDeadline\.cs|Res\.cs)|src_C/Shared/RecallSmith\.Lambda\.Db/(RecallSmith\.Lambda\.Db\.csproj|Pg\.cs|DbUtil\.cs)|src_C/Vpc/VpcFunction\.cs|src_C/Tests/RecallSmith\.Lambda\.IntegrationTests/(IntegrationTestBase|DbWarmupTests|DeadlineTokenTests)\.cs|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside E14 scope"; }
# 5d. Apply guard (E00 §5): no added non-comment line of a worker artefact runs a state-changing command
APPLY_RE='terraform +(apply|import)|aws +[a-z0-9-]+ +(create|update|delete|put)-'
code_added="$(git diff -U0 "$mb" HEAD -- src_C frontend README.md docs/backend-architecture-review-2026-09-22.md | grep -E '^\+[^+]' | sed 's/^+//' || true)"
if printf '%s\n' "$code_added" | grep -Ev '^\s*(//|#|--|/\*|\*)' | grep -Eq "$APPLY_RE"; then
  fail "an added line runs terraform apply/import or an aws create/update/delete/put command"
fi
for f in "$DEADLINE" "$TDEAD"; do
  if grep -Ev '^\s*(//|#|--|/\*|\*)' "$f" | grep -Eq "$APPLY_RE"; then fail "$f contains a state-changing command"; fi
done

echo "E14 VERIFY OK"
