#!/usr/bin/env bash
# C05 — topic-server verify. cwd = worktree root. Re-runs the brief's five
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - src_C/Vpc/Db/Migrations/018_cards_topic.sql and
#     src_C/Tests/RecallSmith.Lambda.IntegrationTests/CardsAuthoringTopicTests.cs
#     do not exist on base
# Step 2 (literal guards) would also fail on base: no `c.topic` in Cards.cs /
# CardsPage.cs, no `Topic` on CardExportData, no `Card_WithTopic_AppendsTopicLast`.
# Steps 3/4 are the dotnet build / targeted-xunit gates and step 5 is a purely
# negative scope guard; they pass on base by design and are never reached there.
#
# Network: none. `dotnet build` restores implicitly from the local NuGet cache
# (C05 adds no PackageReference). Step 4 needs a running Docker daemon
# (Testcontainers postgres:16-alpine, image cached). Runtime: steps 1-2 seconds,
# step 3 ~1-2 min cold, step 4 single-digit minutes (one container start; not
# measured). The driver's diff-scoped banned-term grep and suppression scan run
# separately (gates a/b) — this script deliberately does not spell those terms.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-c-economy}}"   # driver exports BASE
fail() { echo "C05 VERIFY FAIL: $*" >&2; exit 1; }

MIG=src_C/Vpc/Db/Migrations/018_cards_topic.sql
MIGDIR=src_C/Vpc/Db/Migrations
CARDS=src_C/Vpc/Authoring/Cards.cs
HELPERS=src_C/Vpc/Authoring/Helpers.cs
PAGE=src_C/Vpc/Authoring/CardsPage.cs
PUB=src_C/Vpc/Authoring/Publish.cs
UP=src_C/Worker/S3/IS3DeckUploader.cs
PROC=src_C/Worker/Services/PublishJobProcessor.cs
DIFF=src_C/Worker/Content/DeckDiff.cs
GEN=src_C/Worker/Services/ContentArtifactsGenerator.cs
TESTDIR=src_C/Tests/RecallSmith.Lambda.IntegrationTests
CST=$TESTDIR/ContentSerializationContractTests.cs
DDT=$TESTDIR/DeckDiffTests.cs
TOPICT=$TESTDIR/CardsAuthoringTopicTests.cs

count() { grep -Ec "$1" "$2" || true; }     # ERE count, 0 when no match
fcount() { grep -Fc "$1" "$2" || true; }    # fixed-string count, 0 when no match
lineof() { grep -Fn "$1" "$2" | head -1 | cut -d: -f1; }

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist"
[ -f "$MIG" ]    || fail "$MIG does not exist (base tree fails here)"
[ -f "$TOPICT" ] || fail "$TOPICT does not exist (base tree fails here)"
for f in "$CARDS" "$HELPERS" "$PAGE" "$PUB" "$UP" "$PROC" "$DIFF" "$GEN" "$CST" "$DDT"; do
  [ -f "$f" ] || fail "$f is missing"
done
[ ! -e "$MIGDIR/018_cards_mcq.sql" ] || fail "018_cards_mcq.sql exists — superseded name (C00 §6 #1), docsPaths rule (b) goes red"
[ "$(ls "$MIGDIR" | grep -c '^018_' || true)" = "1" ] || fail "exactly one 018_*.sql is allowed"
ls "$MIGDIR" | grep -q '^019_' && fail "019_*.sql belongs to C08, not C05"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. migration — one statement, the pinned DDL, no index/CHECK/NOT NULL/DEFAULT
grep -Fq 'alter table cards add column if not exists topic text null;' "$MIG" || fail "018: pinned DDL line missing"
grep -Fq '018_cards_topic.sql' "$MIG" || fail "018: header comment must name the file"
[ "$(grep -v '^[[:space:]]*--' "$MIG" | grep -c ';' || true)" = "1" ] || fail "018: exactly one SQL statement"
if grep -Eiq 'create index|check[[:space:]]*\(|not null|default' "$MIG"; then
  grep -Ein 'create index|check[[:space:]]*\(|not null|default' "$MIG" >&2 || true
  fail "018: no index / CHECK / NOT NULL / DEFAULT (C00 §2.8.1)"
fi
# 2b. Helpers.cs — the two normalisers, the constant, the two messages; no C08 Cast
for sym in 'public const int TopicMaxLength = 80;' \
           'public static string? ParseOptionalTopic(JsonElement body)' \
           'public static string? NormalizeTopic(JsonElement el)' \
           '"topic too long (max 80)"' \
           '"topic must be a string"'; do
  grep -Fq "$sym" "$HELPERS" || fail "Helpers.cs lacks: $sym"
done
grep -Eq 'record UpdateField\(.*Cast' "$HELPERS" && fail "Helpers.cs: UpdateField.Cast is C08's, not C05's"
# 2c. Cards.cs — topic last in all three projections, $12 in INSERT, PUT spec entry
[ "$(count '^[[:space:]]+c\.topic$' "$CARDS")" = "1" ]   || fail "Cards.cs: GET select must end with one bare c.topic line"
[ "$(count '^[[:space:]]+topic;$' "$CARDS")" = "2" ]     || fail "Cards.cs: POST and PUT RETURNING must each end with a bare topic; line"
[ "$(fcount 'as "updatedAt",' "$CARDS")" = "3" ]        || fail "Cards.cs: all three updatedAt lines need a trailing comma (topic follows)"
grep -Eq 'as "updatedAt"$' "$CARDS" && fail "Cards.cs: a projection still ends at updatedAt"
grep -Fq 'Helpers.ParseOptionalTopic(body)' "$CARDS" || fail "Cards.cs: POST must call Helpers.ParseOptionalTopic(body)"
grep -Fq 'real_world_usage, difficulty, order_in_deck, revision, version, topic' "$CARDS" || fail "Cards.cs: INSERT column list must end with topic"
grep -Eq '^[[:space:]]+\$12$' "$CARDS" || fail "Cards.cs: INSERT values must end with a bare \$12 line"
grep -Fq 'new("topic", "topic", v => v.ValueKind == JsonValueKind.Null ? null : Helpers.NormalizeTopic(v)),' "$CARDS" || fail "Cards.cs: PUT spec topic entry missing/changed"
rev_ln="$(lineof 'new("revision", "revision"' "$CARDS")"; top_ln="$(lineof 'new("topic", "topic"' "$CARDS")"; del_ln="$(lineof 'new("isDeleted", "is_deleted"' "$CARDS")"
[ -n "$rev_ln" ] && [ -n "$top_ln" ] && [ -n "$del_ln" ] && [ "$rev_ln" -lt "$top_ln" ] && [ "$top_ln" -lt "$del_ln" ] \
  || fail "Cards.cs: PUT spec topic entry must sit after revision and before isDeleted"
# 2d. CardsPage.cs
[ "$(count '^[[:space:]]+c\.topic$' "$PAGE")" = "1" ] || fail "CardsPage.cs: select must end with one bare c.topic line"
[ "$(fcount 'as "updatedAt",' "$PAGE")" = "1" ]      || fail "CardsPage.cs: updatedAt line needs a trailing comma"
# 2e. Publish.cs
[ "$(count '^[[:space:]]+topic$' "$PUB")" = "1" ] || fail "Publish.cs: cardsSql must end with one bare topic line"
grep -Fq 'topic = c.TryGetValue("topic", out var tp) ? tp as string : null,' "$PUB" || fail "Publish.cs: baseCards topic mapping missing/changed"
# 2f. PublishJobProcessor.cs — null-preserving mapper, no empty-string default, no fallback
[ "$(count '^[[:space:]]+topic$' "$PROC")" = "1" ] || fail "PublishJobProcessor.cs: cardsSql must end with one bare topic line"
grep -Fq 'Topic = c.TryGetValue("topic", out var tp) ? tp as string : null,' "$PROC" || fail "PublishJobProcessor.cs: Topic mapping missing/changed"
if grep -E 'Topic = .*(string\.Empty|\?\? "")' "$PROC" >/dev/null; then
  grep -En 'Topic = .*(string\.Empty|\?\? "")' "$PROC" >&2 || true
  fail "PublishJobProcessor.cs: Topic must map DB NULL to null, never to an empty string"
fi
grep -q '42703' "$PROC" && fail "PublishJobProcessor.cs: the 42703 fallback is C09's"
# 2g. IS3DeckUploader.cs — using at line 1, attribute + property as the last member
[ "$(sed -n 1p "$UP")" = "using System.Text.Json.Serialization;" ] || fail "IS3DeckUploader.cs: line 1 must be the JsonSerialization using"
grep -Fq '[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]' "$UP" || fail "IS3DeckUploader.cs: WhenWritingNull attribute missing"
grep -Fq 'public string? Topic { get; set; }' "$UP" || fail "IS3DeckUploader.cs: Topic property missing or has an initializer"
tail3="$(awk 'NF' "$UP" | sed 's/[[:space:]]*$//' | tail -n 3)"
[ "$(printf '%s\n' "$tail3" | sed -n 1p)" = "  [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]" ] || fail "IS3DeckUploader.cs: the attribute must be the third-last non-blank line"
[ "$(printf '%s\n' "$tail3" | sed -n 2p)" = "  public string? Topic { get; set; }" ] || fail "IS3DeckUploader.cs: Topic must be the LAST property of CardExportData"
[ "$(printf '%s\n' "$tail3" | sed -n 3p)" = "}" ] || fail "IS3DeckUploader.cs: file must end with the CardExportData closing brace"
grep -Fq 'public int Revision { get; set; } = 1;' "$UP" || fail "IS3DeckUploader.cs: Revision line changed"
# 2h. DeckDiff.cs
grep -Fq '|| !string.Equals(a.Topic, b.Topic, StringComparison.Ordinal)' "$DIFF" || fail "DeckDiff.cs: Topic comparison missing"
grep -Fq '10 个卡片字段' "$DIFF" || fail "DeckDiff.cs: :17 comment must say 10 个卡片字段"
grep -Fq '9 个卡片字段' "$DIFF" && fail "DeckDiff.cs: stale 9 个卡片字段 comment"
# 2i. ContentArtifactsGenerator.cs
grep -Fq 'public string? Topic { get; set; }' "$GEN" || fail "ContentArtifactsGenerator.cs: PreviousCardDocument.Topic missing"
grep -Fq 'Topic = c.Topic,' "$GEN" || fail "ContentArtifactsGenerator.cs: MapPreviousCards must copy Topic"
rv_ln="$(lineof 'Revision = c.Revision ?? 1,' "$GEN")"; tp_ln="$(lineof 'Topic = c.Topic,' "$GEN")"
[ -n "$rv_ln" ] && [ -n "$tp_ln" ] && [ "$rv_ln" -lt "$tp_ln" ] || fail "ContentArtifactsGenerator.cs: Topic = c.Topic must follow the Revision line"
# 2j. ContentSerializationContractTests.cs — golden untouched, two new facts
grep -Fq '"""{"stableUid":"u1","orderInDeck":1,"difficulty":2,"question":"q","explanation":"e","codeLanguage":"csharp","codeSnippet":"c","realWorldUsage":"r","revision":1}""";' "$CST" \
  || fail "ContentSerializationContractTests.cs: golden CardJson literal changed"
for s in Card_SerializesExactCamelCaseFieldNames Card_NullCodeLanguage_SerializesAsNull DeckDelta_SerializesExactContractShape \
         DeckPackage_SerializesExactContractShape DeckChunk_SerializesExactContractShape DeckExportData_DeckJson_KeepsExistingCamelCaseShape \
         Card_WithTopic_AppendsTopicLast Card_NullTopic_KeepsGoldenBytes; do
  grep -Fq "public void $s()" "$CST" || fail "ContentSerializationContractTests.cs: missing test $s"
done
grep -Fq '"revision":1,"topic":"t"}' "$CST" || fail "ContentSerializationContractTests.cs: topic-last golden literal missing"
# 2k. DeckDiffTests.cs — topic mutation row, comment, null→value fact, existing facts
grep -Fq '{ "topic", MakeCard("a", topic: "changed") }' "$DDT" || fail "DeckDiffTests.cs: topic mutation row missing"
grep -Fq '除 stableUid 之外的 9 个字段' "$DDT" || fail "DeckDiffTests.cs: :117 comment must say 9 个字段"
for s in Compute_IdenticalDecks_IsNoOp Compute_NewUid_IsAdded Compute_MissingUid_IsDeleted Compute_ChangedCard_IsUpdated_AndCarriesNextValues \
         Compute_MixedChanges_AllBucketsFilled_InNextOrder Compute_AnySingleFieldChange_TriggersUpdated Compute_CodeLanguageNullToValue_TriggersUpdated \
         Compute_EmptyPrev_AllAdded Compute_EmptyNext_AllDeleted Compute_TopicNullToValue_TriggersUpdated; do
  grep -Fq "public void $s(" "$DDT" || fail "DeckDiffTests.cs: missing test $s"
done
# 2l. CardsAuthoringTopicTests.cs — DB collection, a Theory table, the eleven cases
grep -Fq '[Collection(PostgresCollection.Name)]' "$TOPICT" || fail "CardsAuthoringTopicTests.cs must join the postgres collection"
grep -Fq 'public class CardsAuthoringTopicTests' "$TOPICT" || fail "CardsAuthoringTopicTests.cs: class name"
grep -Fq '[Theory]' "$TOPICT" || fail "CardsAuthoringTopicTests.cs needs at least one [Theory] table (C00 §3.3)"
for s in Post_WithTopic_ReturnsTrimmedTopic Post_BlankTopic_ReturnsNull Post_TopicOver80_IsValidationError Post_NonStringTopic_IsValidationError \
         Put_TopicNull_ClearsTopic Put_WithoutTopic_LeavesTopicIntact Put_TopicOver80_IsValidationError Get_Page_Preview_AllCarryTopicKey \
         NormalizeTopic_TrimsAndNullsBlank NormalizeTopic_RejectsNonStringAndOverlong NormalizeTopic_LengthBoundaryIs80; do
  grep -Fq "$s(" "$TOPICT" || fail "CardsAuthoringTopicTests.cs: missing test $s"
done
for s in 'topic too long (max 80)' 'topic must be a string' 'mode' 'HandleAuthoringCardsPage' 'HandleAuthoringPublish' 'HandleAuthoringCards('; do
  grep -Fq "$s" "$TOPICT" || fail "CardsAuthoringTopicTests.cs lacks: $s"
done
# 2m. suppression / gutting across every scope file
if grep -Eq 'Skip[[:space:]]*=|#pragma warning disable|\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable' \
     "$MIG" "$CARDS" "$HELPERS" "$PAGE" "$PUB" "$UP" "$PROC" "$DIFF" "$GEN" "$CST" "$DDT" "$TOPICT"; then
  grep -En 'Skip[[:space:]]*=|#pragma warning disable|\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable' \
     "$MIG" "$CARDS" "$HELPERS" "$PAGE" "$PUB" "$UP" "$PROC" "$DIFF" "$GEN" "$CST" "$DDT" "$TOPICT" >&2 || true
  fail "test gutting / suppression found"
fi

# ── 3. dotnet build (implicit cached restore; no network) ──────────────────
echo "[3/5] dotnet build Tests/RecallSmith.Lambda.IntegrationTests"
( cd src_C && dotnet build Tests/RecallSmith.Lambda.IntegrationTests -c Debug --nologo ) || fail "dotnet build failed"
[ -f "$TESTDIR/bin/Debug/net8.0/Db/Migrations/018_cards_topic.sql" ] || fail "018_cards_topic.sql did not reach the test bin (Vpc csproj None include)"

# ── 4. Targeted xunit (Docker required for CardsAuthoringTopicTests) ───────
echo "[4/5] dotnet test --filter ContentSerializationContractTests|DeckDiffTests|CardsAuthoringTopicTests"
docker info >/dev/null 2>&1 || fail "Docker daemon is not running — CardsAuthoringTopicTests needs Testcontainers postgres:16-alpine"
( cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests -c Debug --no-build --nologo \
    --filter "FullyQualifiedName~ContentSerializationContractTests|FullyQualifiedName~DeckDiffTests|FullyQualifiedName~CardsAuthoringTopicTests" ) \
  || fail "targeted dotnet test failed"

# ── 5. Scope + frozen-file guard (purely negative; passes on base) ─────────
echo "[5/5] scope + frozen guard"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json mobile/src mobile/tests \
  frontend/src frontend/tests snowflake src_C/Shared src_C/Vpc/Runtime src_C/Vpc/Db/Migrate.cs \
  src_C/Worker/Content/ContentModels.cs src_C/Worker/Content/ContentJson.cs \
  "$TESTDIR/IntegrationTestBase.cs" "$TESTDIR/CardsPageTests.cs" \
  ':(glob)src_C/**/*.csproj' ':(glob)docs/*.md')"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
# Untracked scan is pathspec-scoped, never bare: the driver symlinks mobile/node_modules and
# frontend/node_modules into the worktree and the `node_modules/` ignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- src_C/Vpc src_C/Worker src_C/Tests src_C/Shared mobile/src mobile/tests frontend/src frontend/tests snowflake docs; } | sort -u | grep -Ev '^(src_C/Vpc/Db/Migrations/018_cards_topic\.sql|src_C/Vpc/Authoring/Cards\.cs|src_C/Vpc/Authoring/Helpers\.cs|src_C/Vpc/Authoring/CardsPage\.cs|src_C/Vpc/Authoring/Publish\.cs|src_C/Worker/S3/IS3DeckUploader\.cs|src_C/Worker/Services/PublishJobProcessor\.cs|src_C/Worker/Content/DeckDiff\.cs|src_C/Worker/Services/ContentArtifactsGenerator\.cs|src_C/Tests/RecallSmith\.Lambda\.IntegrationTests/ContentSerializationContractTests\.cs|src_C/Tests/RecallSmith\.Lambda\.IntegrationTests/DeckDiffTests\.cs|src_C/Tests/RecallSmith\.Lambda\.IntegrationTests/CardsAuthoringTopicTests\.cs|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside C05 scope"; }

echo "C05 VERIFY OK"
