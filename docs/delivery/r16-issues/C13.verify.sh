#!/usr/bin/env bash
# C13 — analytics-partition verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - src_C/Tests/RecallSmith.Lambda.IntegrationTests/ContentIntelligenceMcqTests.cs
#     and frontend/tests/contentIntelligenceMcqBanner.test.tsx do not exist on base
#   (step 1 also checks the C10/C08 prerequisite: src_C/Vpc/Db/Migrations/019_cards_mcq.sql
#   must exist, because the live query's `c.mcq` predicate and the count query read it)
# Step 2 (literal guards) would also fail on base (no mcqCardCount, no answer_mode).
# Step 3 is the frontend lint+build gate, step 4 the targeted tests (frontend vitest,
# then `dotnet test --filter` which needs Docker), step 5 a purely negative scope guard.
#
# Snowflake: nothing in this repo can execute snowflake/001_*.sql; its checks are
# non-empty + literal greps only, and the owner applies the file by hand after the wave.
# The driver's diff-scoped banned-term grep and suppression scan run separately.
#
# Network: none. No npm install, no dotnet restore (implicit restore hits the local
# NuGet cache only). Runtime ~3-5 min, dominated by dotnet build + one Testcontainers
# Postgres start.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-c-economy}}"   # driver exports BASE
fail() { echo "C13 VERIFY FAIL: $*" >&2; exit 1; }

CI=src_C/Vpc/Authoring/ContentIntelligence.cs
CT=src_C/Tests/RecallSmith.Lambda.IntegrationTests/ContentIntelligenceMcqTests.cs
AU=frontend/src/api/authoring.ts
PG=frontend/src/pages/ContentIntelligencePage.tsx
BT=frontend/tests/contentIntelligenceMcqBanner.test.tsx
SQL=snowflake/001_content_intelligence_setup.sql
RM=snowflake/README.md
MIG19=src_C/Vpc/Db/Migrations/019_cards_mcq.sql
OLDTEST=frontend/tests/contentIntelligencePage.test.tsx

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ C08/C10 prerequisite)"
for f in "$CT" "$BT"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
for f in "$CI" "$AU" "$PG" "$SQL" "$RM"; do
  [ -f "$f" ] || fail "$f is missing"
done
[ -f "$MIG19" ] || fail "$MIG19 is missing — C08 (and C10) must be merged before C13"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. ContentIntelligence.cs — helpers, predicates, fallback, summary key order
for sym in "using Npgsql;" \
           "private static string BuildLiveSql(bool withMcqFilter)" \
           "and c.mcq is null" \
           "internal static async Task<List<Dictionary<string, object?>>> QueryLiveCardsAsync(" \
           "internal static async Task<int> CountMcqCardsAsync(" \
           "c.mcq is not null" \
           'admin_deck_permissions p on p.deck_id = d.id and p.admin_sub = $2 and p.can_read = 1' \
           'pg.SqlState == "42703"' \
           "mcqCardCount" \
           "BuildResponse(cards, days, deckSlug, mcqCardCount)"; do
  grep -Fq -- "$sym" "$CI" || fail "ContentIntelligence.cs lacks: $sym"
done
[ "$(grep -Fc 'pg.SqlState == "42703"' "$CI")" -ge 2 ] || fail "ContentIntelligence.cs needs the 42703 fallback on both the live query and the count"
[ "$(grep -Fc 'BuildResponse(cards, days, deckSlug, mcqCardCount)' "$CI")" -eq 2 ] || fail "both branches must pass mcqCardCount to BuildResponse"
[ "$(grep -Fc 'const string snapshotSql' "$CI")" -eq 1 ] || fail "snapshotSql must remain a single untouched constant"
a="$(grep -n 'difficultyOverstated = CountStatus(' "$CI" | head -1 | cut -d: -f1)"
b="$(grep -nE '^\s*mcqCardCount,\s*$' "$CI" | head -1 | cut -d: -f1)"
[ -n "$a" ] && [ -n "$b" ] && [ "$((a + 1))" -eq "$b" ] || fail "summary.mcqCardCount must be the LAST key, directly after difficultyOverstated"
grep -q "information_schema" "$CI" && fail "ContentIntelligence.cs must not probe information_schema (C00 §6 #11: fallback on 42703, never probe-then-query)"
# 2b. test class — collection, names, scratch-schema fallback case, live-path forcing
for sym in "[Collection(PostgresCollection.Name)]" \
           "public class ContentIntelligenceMcqTests" \
           "McqCardCount_IsScopedByDeckSlug_AndSkipsDeletedCards" \
           "McqCardCount_FollowsReadPermission_ForEditors" \
           "LiveCards_ExcludeMcqCards_ButKeepQaCards" \
           "LiveQueries_FallBack_WhenCardsMcqColumnIsAbsent" \
           "CreateScratchDatabaseAsync(" \
           "ApplyMigrationsAsync(conn, 18)" \
           "information_schema.columns" \
           "QueryLiveCardsAsync(" \
           "CountMcqCardsAsync(" \
           "LambdaHost.PostProgressEventsAsync(" \
           '["days"] = "7"'; do
  grep -Fq -- "$sym" "$CT" || fail "ContentIntelligenceMcqTests.cs lacks: $sym"
done
[ "$(grep -c '\[Fact\]' "$CT" || true)" -ge 4 ] || fail "ContentIntelligenceMcqTests.cs needs >= 4 [Fact] cases"
if grep -Eq "Skip *=|Thread\.Sleep" "$CT"; then
  grep -En "Skip *=|Thread\.Sleep" "$CT" >&2 || true
  fail "ContentIntelligenceMcqTests.cs: no skipped facts, no sleeps"
fi
# 2c. authoring.ts — optional key only
grep -Fq "mcqCardCount?: number;" "$AU" || fail "authoring.ts: summary must gain optional mcqCardCount?: number;"
grep -Fq "mcqCardCount: number;" "$AU" && fail "authoring.ts: mcqCardCount must be optional (older Lambdas omit it; the page test fixtures have no such key)"
# 2d. page — banner literals, derived at render time, no new effect
for sym in 'data-testid="content-intelligence-mcq-banner"' \
           "rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800" \
           "in scope are not assessed by the Q/A model." \
           "const mcqCardCount = summary?.mcqCardCount ?? 0;"; do
  grep -Fq -- "$sym" "$PG" || fail "ContentIntelligencePage.tsx lacks: $sym"
done
# count call lines only: the lint note at :133 mentions `useEffect(` inside a comment
[ "$(grep -cE '^\s*useEffect\(' "$PG" || true)" -eq 2 ] || fail "ContentIntelligencePage.tsx must keep exactly two useEffect call lines (banner is derived at render time)"
# 2e. banner test — jsdom, the five cases, the grid pin, the two rendered strings
grep -Fq "// @vitest-environment jsdom" "$BT" || fail "banner test must opt into jsdom"
for s in \
  'shows the MCQ banner with the count from the server summary' \
  'uses the singular form for exactly one MCQ card' \
  'renders no banner when mcqCardCount is zero' \
  'renders no banner when the summary has no mcqCardCount' \
  'keeps the six summary tiles outside the banner'; do
  grep -Fq "it('$s'" "$BT" || fail "missing banner test case: $s"
done
for sym in "section.grid > div" \
           "2 MCQ cards in scope are not assessed by the Q/A model." \
           "1 MCQ card in scope are not assessed by the Q/A model."; do
  grep -Fq -- "$sym" "$BT" || fail "banner test lacks: $sym"
done
[ "$(grep -cE "^\s*it\(" "$BT" || true)" -ge 5 ] || fail "banner test needs >= 5 it() blocks"
# 2f. Snowflake — non-empty + literal greps (no local runner exists)
[ -s "$SQL" ] || fail "$SQL is empty"
[ "$(wc -l < "$SQL")" -ge 325 ] || fail "$SQL is shorter than expected (>= 325 lines after the edit: 314 on base + the 15 lines change 6 adds)"
for sym in \
  "coalesce(src:payload:card_format::string, src:card_format::string, 'qa') as card_format," \
  "coalesce(src:payload:client_features, src:client_features) as client_features," \
  "coalesce(src:payload:update_id::string, src:update_id::string) as update_id," \
  "iff(coalesce(src:payload:card_format::string, src:card_format::string, 'qa') = 'mcq' and coalesce(array_contains('mcq'::variant, coalesce(src:payload:client_features, src:client_features)), false), 'mcq', 'qa') as answer_mode," \
  "group by user_id_hash, answer_mode" \
  "group by event_date, deck_slug, stated_difficulty, answer_mode" \
  "and ub.answer_mode = e.answer_mode" \
  "group by e.event_date, e.deck_slug, e.card_stable_uid, e.card_revision, e.stated_difficulty, e.answer_mode" \
  "and b.answer_mode = cs.answer_mode" \
  "when answer_mode = 'mcq' then 'MCQ · Not Assessed'" \
  "where answer_mode = 'qa'" \
  "count_if(content_quality_status = 'MCQ · Not Assessed') as mcq_not_assessed_count"; do
  grep -Fq -- "$sym" "$SQL" || fail "001_content_intelligence_setup.sql lacks: $sym"
done
# stg_review_events: the four new lines sit between app_version and offline_queue_delay_ms, in order
lav="$(grep -Fn "as app_version," "$SQL" | head -1 | cut -d: -f1)"
lcf="$(grep -Fn "as card_format," "$SQL" | head -1 | cut -d: -f1)"
lcl="$(grep -Fn "as client_features," "$SQL" | head -1 | cut -d: -f1)"
lup="$(grep -Fn "as update_id," "$SQL" | head -1 | cut -d: -f1)"
lam="$(grep -Fn "as answer_mode," "$SQL" | head -1 | cut -d: -f1)"
lod="$(grep -Fn "as offline_queue_delay_ms," "$SQL" | head -1 | cut -d: -f1)"
[ "$lav" -lt "$lcf" ] && [ "$lcf" -lt "$lcl" ] && [ "$lcl" -lt "$lup" ] && [ "$lup" -lt "$lam" ] && [ "$lam" -lt "$lod" ] \
  || fail "stg_review_events: card_format, client_features, update_id, answer_mode must follow app_version in that order and precede offline_queue_delay_ms"
# card_observations: the hop carries all four columns
obs="$(sed -n '/create or replace view staging.card_observations/,/from staging.stg_review_events/p' "$SQL")"
for col in "card_format," "answer_mode," "client_features," "update_id"; do
  printf '%s\n' "$obs" | grep -Eq "^\s*${col}\s*$" || fail "staging.card_observations must project ${col%,} (C00 §6 #10)"
done
# the MCQ arm is the FIRST arm of the content_quality_status CASE (before the second 'Needs More Data')
lmcq="$(grep -Fn "when answer_mode = 'mcq' then 'MCQ · Not Assessed'" "$SQL" | head -1 | cut -d: -f1)"
lnmd="$(grep -Fn "when review_count < 30 then 'Needs More Data'" "$SQL" | sed -n '2p' | cut -d: -f1)"
[ -n "$lmcq" ] && [ -n "$lnmd" ] && [ "$((lmcq + 1))" -eq "$lnmd" ] \
  || fail "content_quality_status: the 'MCQ · Not Assessed' arm must be the first arm, directly before 'Needs More Data'"
if grep -Eq "app_version *(>=|>) *'" "$SQL"; then
  grep -En "app_version *(>=|>) *'" "$SQL" >&2 || true
  fail "answer_mode must never be keyed on app_version (C00 §6 #9)"
fi
[ ! -e snowflake/002_mcq_marts.sql ] || fail "snowflake/002_mcq_marts.sql is registered as not-on-disk in the MCQ plan; creating it turns docsPaths red"
for sym in "create or replace" "answer_mode" "client_features" "mcq_not_assessed_count"; do
  grep -Fq -- "$sym" "$RM" || fail "snowflake/README.md lacks: $sym"
done
# 2g. suppression / gutting across every scope file
grep -Eq "\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable" "$CI" "$CT" "$AU" "$PG" "$BT" "$SQL" "$RM" && fail "test gutting / suppression found"

# ── 3. Frontend gate: lint + build (tsc -b covers src/ and tests/) ─────────
echo "[3/5] frontend lint + build"
( cd frontend && npm run lint ) || fail "frontend lint failed"
( cd frontend && npm run build ) || fail "frontend build (tsc -b && vite build) failed"

# ── 4. Targeted tests ──────────────────────────────────────────────────────
echo "[4/5] vitest banner + page characterisation + census; dotnet test ContentIntelligenceMcqTests (Docker)"
( cd frontend && npx vitest run \
    tests/contentIntelligenceMcqBanner.test.tsx \
    tests/contentIntelligencePage.test.tsx \
    tests/apiSurfaceCensus.test.ts \
    tests/consoleDirectoryLayout.test.ts \
    tests/docsPaths.test.ts \
    --reporter=dot ) || fail "targeted frontend vitest failed"
docker info >/dev/null 2>&1 || fail "Docker is not running — ContentIntelligenceMcqTests needs a Testcontainers Postgres (start Docker Desktop, then rerun)"
( cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests --nologo \
    --filter "FullyQualifiedName~ContentIntelligenceMcqTests" ) || fail "dotnet test ContentIntelligenceMcqTests failed"

# ── 5. Scope + frozen-file guard (purely negative; passes on base) ─────────
echo "[5/5] scope + frozen guard"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
frozen="$(git diff --numstat "$mb" -- \
  mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json \
  src_C/Vpc/Runtime/ProgressEvents.cs src_C/Vpc/Db/Migrations src_C/Vpc/Analytics src_C/Worker \
  frontend/src/lib/cardRules.ts frontend/package.json frontend/package-lock.json \
  "$OLDTEST" \
  src_C/Tests/RecallSmith.Lambda.IntegrationTests/ProgressEventsSingleStatementTests.cs)"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
# Untracked scan is pathspec-scoped: the driver symlinks mobile/node_modules and
# frontend/node_modules into the worktree and the `node_modules/` gitignore rule
# does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- src_C/Vpc src_C/Worker src_C/Tests src_C/Shared frontend/src frontend/tests docs snowflake mobile/src mobile/tests; } | sort -u | grep -Ev '^(src_C/Vpc/Authoring/ContentIntelligence\.cs|src_C/Tests/RecallSmith\.Lambda\.IntegrationTests/ContentIntelligenceMcqTests\.cs|frontend/src/api/authoring\.ts|frontend/src/pages/ContentIntelligencePage\.tsx|frontend/tests/contentIntelligenceMcqBanner\.test\.tsx|snowflake/001_content_intelligence_setup\.sql|snowflake/README\.md|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside C13 scope"; }

echo "C13 VERIFY OK"
