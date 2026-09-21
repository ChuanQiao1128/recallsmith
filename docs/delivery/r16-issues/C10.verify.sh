#!/usr/bin/env bash
# C10 — mcq-ingest-card-format verify. cwd = worktree root. Re-runs the brief's
# six acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - src_C/Tests/RecallSmith.Lambda.IntegrationTests/ProgressEventsCardFormatTests.cs
#     does not exist on base
#   (step 1 then also checks the C05/C08 prerequisites: 018_cards_topic.sql and
#   019_cards_mcq.sql must exist, because the joined statement reads cards.mcq
#   and the fallback test applies migrations up to 018 only)
# Step 2 (literal guards) would also fail on base: no BuildIngestSql, no
# card_format key, no 42703 arm, stable_uid still unqualified in the outbox CTE.
# Steps 3/4 are the dotnet build / targeted-xunit gates and step 5 is a purely
# negative scope guard; they pass on base by design and are never reached there.
#
# Network: none. `dotnet build` restores implicitly from the local NuGet cache
# (C10 adds no PackageReference). Step 4 needs a running Docker daemon
# (Testcontainers postgres:16-alpine, image cached). Runtime: steps 1-2 seconds,
# step 3 ~1-2 min cold, step 4 single-digit minutes (one container start; the
# single-statement class runs its log probe and a concurrency case; not
# measured). The driver's diff-scoped banned-term grep and suppression scan run
# separately (gates a/b) — this script deliberately does not spell those terms.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-c-economy}}"   # driver exports BASE
fail() { echo "C10 VERIFY FAIL: $*" >&2; exit 1; }

PE=src_C/Vpc/Runtime/ProgressEvents.cs
TESTDIR=src_C/Tests/RecallSmith.Lambda.IntegrationTests
CFT=$TESTDIR/ProgressEventsCardFormatTests.cs
SST=$TESTDIR/ProgressEventsSingleStatementTests.cs
MIGDIR=src_C/Vpc/Db/Migrations
MIG18=$MIGDIR/018_cards_topic.sql
MIG19=$MIGDIR/019_cards_mcq.sql

count() { grep -Ec "$1" "$2" || true; }     # ERE count, 0 when no match
fcount() { grep -Fc "$1" "$2" || true; }    # fixed-string count, 0 when no match
lineof() { grep -Fn "$1" "$2" | head -1 | cut -d: -f1; }

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ C05/C08 prerequisites)"
[ -f "$CFT" ] || fail "$CFT does not exist (base tree fails here)"
[ -f "$PE" ]  || fail "$PE is missing"
[ -f "$SST" ] || fail "$SST is missing"
[ -f "$MIG19" ] || fail "$MIG19 is missing — C08 must be merged before C10 (the joined statement reads cards.mcq)"
[ -f "$MIG18" ] || fail "$MIG18 is missing — C05 must be merged before C10 (the fallback test stops at maxVersion 18)"
grep -Fq 'mcq jsonb' "$MIG19" || fail "019_cards_mcq.sql does not add mcq jsonb (C08 incomplete)"
[ ! -e "$MIGDIR/018_cards_mcq.sql" ] || fail "018_cards_mcq.sql exists — superseded name (C00 §6 #1)"
[ "$(ls "$MIGDIR" | grep -c '^019_' || true)" = "1" ] || fail "exactly one 019_*.sql is allowed"
ls "$MIGDIR" | grep -q '^02[0-9]_' && fail "a 020+ migration exists — C10 adds no migration"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. ProgressEvents.cs — the C00 §2.10 builder, the 42703 arm, the three SQL fragments, the splice points
for sym in 'string BuildIngestSql(bool withCardFormat)' \
           'BuildIngestSql(withCardFormat: true)' \
           'BuildIngestSql(withCardFormat: false)' \
           'catch (PostgresException pg) when (pg.SqlState == "42703")' \
           "'card_format', case when c.mcq is not null then 'mcq' else 'qa' end" \
           'left join decks d on d.slug = ins.deck_slug and d.is_deleted = 0' \
           'left join cards c on c.deck_id = d.id and c.stable_uid = ins.stable_uid and c.is_deleted = 0' \
           "'deck_version', deck_version{cardFormatKey}" \
           'from ins{cardFormatJoin}' \
           "deck_slug || ':' || ins.stable_uid," \
           "'card_stable_uid', ins.stable_uid," \
           'ingest_card_format_fallback'; do
  grep -Fq "$sym" "$PE" || fail "ProgressEvents.cs lacks: $sym"
done
# 2b. ProgressEvents.cs — untouched anchors (the other CTEs and the payload builder did not move)
for sym in 'jsonb_strip_nulls(jsonb_build_object(' \
           "'app_version', client_version," \
           'on conflict (event_id) do nothing' \
           'static string P(ref int i)' \
           'with ensure_user as (' \
           'var swStatement = Stopwatch.StartNew();' \
           'var statementMs = swStatement.Elapsed.TotalMilliseconds;'; do
  grep -Fq "$sym" "$PE" || fail "ProgressEvents.cs lost an anchor that must not move: $sym"
done
[ "$(fcount "'deck_version', deck_version{cardFormatKey}" "$PE")" = "1" ] || fail "ProgressEvents.cs: the card_format splice must appear exactly once"
[ "$(fcount 'from ins{cardFormatJoin}' "$PE")" = "1" ]                    || fail "ProgressEvents.cs: the join splice must appear exactly once (outbox CTE only)"
[ "$(fcount 'catch (PostgresException' "$PE")" = "1" ]                    || fail "ProgressEvents.cs: exactly one catch (PostgresException …) arm"
[ "$(count '^        """;$' "$PE")" = "1" ]                               || fail "ProgressEvents.cs: the raw string must still close with \"\"\"; at its 8-space column"
# 2c. ProgressEvents.cs — negatives: no unqualified stable_uid in the outbox select, no schema probe,
#     no transaction, no C14 keys, no leftover single-text assignment, no 42P01 arm
for bad in "'card_stable_uid', stable_uid," \
           "|| ':' || stable_uid," \
           'information_schema' 'pg_attribute' 'to_regclass' 'BeginTransaction' \
           'client_features' 'update_id' 'select *' 'var sql = $"""' '42P01'; do
  if grep -Fq "$bad" "$PE"; then
    grep -Fn "$bad" "$PE" >&2 || true
    fail "ProgressEvents.cs must not contain: $bad"
  fi
done
# 2d. ProgressEvents.cs — the 22 existing payload keys keep their order (first occurrence of each
#     'key', must be monotonically increasing, all after jsonb_build_object( and before card_format's splice)
start="$(lineof 'jsonb_strip_nulls(jsonb_build_object(' "$PE")"
end="$(lineof "'deck_version', deck_version{cardFormatKey}" "$PE")"
[ -n "$start" ] && [ -n "$end" ] && [ "$start" -lt "$end" ] || fail "ProgressEvents.cs: cannot locate the outbox payload builder"
prev="$start"
for k in event_id schema_version event_type user_id_hash deck_slug card_stable_uid card_revision stated_difficulty \
         rating rating_value response_score session_id review_stage review_count_for_card dwell_time_ms \
         client_event_ts server_received_ts device_id platform app_version offline_queue_delay_ms deck_version; do
  ln="$(lineof "'$k'," "$PE")"
  [ -n "$ln" ] || fail "ProgressEvents.cs: payload key '$k' is gone"
  [ "$ln" -gt "$prev" ] || fail "ProgressEvents.cs: payload key '$k' moved (line $ln, previous key at $prev)"
  [ "$ln" -le "$end" ] || fail "ProgressEvents.cs: payload key '$k' sits after the card_format splice"
  prev="$ln"
done
# 2e. ProgressEventsCardFormatTests.cs — DB collection, the Theory table, the three methods, the fallback shape
grep -Fq '[Collection(PostgresCollection.Name)]' "$CFT" || fail "ProgressEventsCardFormatTests.cs must join the postgres collection"
grep -Fq 'public class ProgressEventsCardFormatTests' "$CFT" || fail "ProgressEventsCardFormatTests.cs: class name"
grep -Fq '[Theory]' "$CFT" || fail "ProgressEventsCardFormatTests.cs needs the [Theory] table (C00 §3.3)"
for row in '[InlineData("qa", "qa")]' '[InlineData("mcq", "mcq")]' '[InlineData("card-deleted", "qa")]' \
           '[InlineData("deck-deleted", "qa")]' '[InlineData("missing", "qa")]'; do
  grep -Fq "$row" "$CFT" || fail "ProgressEventsCardFormatTests.cs: missing theory row $row"
done
for s in OutboxPayload_CardFormat_FollowsTheCardsRow \
         MixedBatch_TagsEachEventByItsOwnDeckAndUid_OneOutboxRowPerEvent \
         WithoutTheMcqColumn_IngestFallsBackToTheLegacyStatement; do
  grep -Fq "public async Task $s(" "$CFT" || fail "ProgressEventsCardFormatTests.cs: missing test $s"
done
for sym in 'CreateScratchDatabaseAsync("c10_no_mcq")' 'maxVersion: 18' \
           'Environment.SetEnvironmentVariable("PGDATABASE"' 'Pg.Reset()' 'finally' \
           'information_schema.columns' '"card_format"' 'LambdaHost.PostProgressEventsAsync' \
           'analytics_event_outbox' '::jsonb' 'duplicateEventIds' 'acceptedCount'; do
  grep -Fq "$sym" "$CFT" || fail "ProgressEventsCardFormatTests.cs lacks: $sym"
done
[ "$(fcount '[Fact]' "$CFT")" -ge 2 ] || fail "ProgressEventsCardFormatTests.cs needs >= 2 [Fact] cases (mixed batch + fallback)"
[ "$(fcount 'Pg.Reset()' "$CFT")" -ge 2 ] || fail "ProgressEventsCardFormatTests.cs: Pg.Reset() must run on swap AND in the finally"
for bad in 'log_statement' 'alter system' 'ExamTopics' 'SAA-C03' 'drop column' '.Skip('; do
  if grep -Fq "$bad" "$CFT"; then
    grep -Fn "$bad" "$CFT" >&2 || true
    fail "ProgressEventsCardFormatTests.cs must not contain: $bad"
  fi
done
# 2f. suppression / gutting across both scope files
if grep -Eq 'Skip[[:space:]]*=|#pragma warning disable|\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable' "$PE" "$CFT"; then
  grep -En 'Skip[[:space:]]*=|#pragma warning disable|\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable' "$PE" "$CFT" >&2 || true
  fail "test gutting / suppression found"
fi

# ── 3. dotnet build (implicit cached restore; no network) ──────────────────
echo "[3/5] dotnet build Tests/RecallSmith.Lambda.IntegrationTests"
( cd src_C && dotnet build Tests/RecallSmith.Lambda.IntegrationTests -c Debug --nologo ) || fail "dotnet build failed"
[ -f "$TESTDIR/bin/Debug/net8.0/Db/Migrations/019_cards_mcq.sql" ] || fail "019_cards_mcq.sql did not reach the test bin (Vpc csproj None include) — the fallback test's maxVersion 18 cut would be meaningless"

# ── 4. Targeted xunit (Docker required; both ProgressEvents* classes) ──────
echo "[4/5] dotnet test --filter ProgressEventsCardFormatTests|ProgressEventsSingleStatementTests"
docker info >/dev/null 2>&1 || fail "Docker daemon is not running — both classes need Testcontainers postgres:16-alpine"
( cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests -c Debug --no-build --nologo \
    --filter "FullyQualifiedName~ProgressEventsCardFormatTests|FullyQualifiedName~ProgressEventsSingleStatementTests" ) \
  || fail "targeted dotnet test failed (the new class, or F1-F7 of the untouched single-statement class)"

# ── 5. Scope + frozen-file guard (purely negative; passes on base) ─────────
echo "[5/5] scope + frozen guard"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json mobile/src mobile/tests \
  frontend/src frontend/tests snowflake src_C/Shared src_C/Worker src_C/Vpc/Authoring src_C/Vpc/Analytics src_C/Vpc/Db \
  "$SST" "$TESTDIR/ProgressEventsIntegrationTests.cs" "$TESTDIR/IntegrationTestBase.cs" \
  ':(glob)src_C/**/*.csproj' ':(glob)docs/*.md')"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
# Untracked scan is pathspec-scoped, never bare: the driver symlinks mobile/node_modules and
# frontend/node_modules into the worktree and the `node_modules/` ignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- src_C/Vpc src_C/Worker src_C/Tests src_C/Shared mobile/src mobile/tests frontend/src frontend/tests snowflake docs; } | sort -u | grep -Ev '^(src_C/Vpc/Runtime/ProgressEvents\.cs|src_C/Tests/RecallSmith\.Lambda\.IntegrationTests/ProgressEventsCardFormatTests\.cs|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside C10 scope"; }

echo "C10 VERIFY OK"
