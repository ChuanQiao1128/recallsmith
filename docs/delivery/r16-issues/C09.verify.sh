#!/usr/bin/env bash
# C09 — mcq-server-publish-worker verify. cwd = worktree root. Re-runs the
# brief's five acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - src_C/Tests/RecallSmith.Lambda.IntegrationTests/PublishMcqGateTests.cs and
#     src_C/Tests/RecallSmith.Lambda.IntegrationTests/PublishJobProcessorSchemaTests.cs
#     do not exist on base
#   (step 1 then also checks the C05/C08 prerequisites: 018_cards_topic.sql,
#   019_cards_mcq.sql, McqValidation.cs, Helpers.JsonbElement and the Topic
#   property on CardExportData — the gate and the Worker mapper build on them)
# Step 2 (literal guards) would also fail on base: no `c.mcq` in CardsPage.cs,
# no `internal const string CardsSql` / `FirstMcqGateFailure` in Publish.cs, no
# `Mcq` on CardExportData, no `LoadCardsAsync`, no `McqEquals`.
# Steps 3/4 are the dotnet build / targeted-xunit gates and step 5 is a purely
# negative scope guard; they pass on base by design and are never reached there.
#
# Network: none. `dotnet build` restores implicitly from the local NuGet cache
# (C09 adds no PackageReference; System.Text.Json.Nodes is in the net8.0 BCL).
# Step 4 needs a running Docker daemon (Testcontainers postgres:16-alpine, image
# cached): PublishMcqGateTests and PublishJobProcessorSchemaTests join the
# postgres collection, and the schema tests create two scratch databases
# (c09_pre018, c09_only018). Runtime: steps 1-2 seconds, step 3 ~1-2 min cold,
# step 4 ~2-4 min (one container start + two scratch databases; not measured).
# The driver's diff-scoped banned-term grep and suppression scan run separately
# (gates a/b) — this script deliberately does not spell those terms.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-c-economy}}"   # driver exports BASE
fail() { echo "C09 VERIFY FAIL: $*" >&2; exit 1; }

MIGDIR=src_C/Vpc/Db/Migrations
HELPERS=src_C/Vpc/Authoring/Helpers.cs
MCQV=src_C/Vpc/Authoring/McqValidation.cs
PAGE=src_C/Vpc/Authoring/CardsPage.cs
PUB=src_C/Vpc/Authoring/Publish.cs
UP=src_C/Worker/S3/IS3DeckUploader.cs
PROC=src_C/Worker/Services/PublishJobProcessor.cs
DIFF=src_C/Worker/Content/DeckDiff.cs
GEN=src_C/Worker/Services/ContentArtifactsGenerator.cs
TESTDIR=src_C/Tests/RecallSmith.Lambda.IntegrationTests
CST=$TESTDIR/ContentSerializationContractTests.cs
DDT=$TESTDIR/DeckDiffTests.cs
GATET=$TESTDIR/PublishMcqGateTests.cs
SCHEMAT=$TESTDIR/PublishJobProcessorSchemaTests.cs

count() { grep -Ec "$1" "$2" || true; }     # ERE count, 0 when no match
fcount() { grep -Fc "$1" "$2" || true; }    # fixed-string count, 0 when no match
lineof() { grep -Fn "$1" "$2" | head -1 | cut -d: -f1; }
# "line A strictly before line B" for two fixed-string anchors in one file
before() { local a b; a="$(lineof "$1" "$3")"; b="$(lineof "$2" "$3")"; [ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ]; }

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ C05/C08 prerequisites)"
[ -f "$GATET" ]   || fail "$GATET does not exist (base tree fails here)"
[ -f "$SCHEMAT" ] || fail "$SCHEMAT does not exist (base tree fails here)"
for f in "$PAGE" "$PUB" "$UP" "$PROC" "$DIFF" "$GEN" "$CST" "$DDT" "$HELPERS"; do
  [ -f "$f" ] || fail "$f is missing"
done
[ -f "$MIGDIR/018_cards_topic.sql" ] || fail "018_cards_topic.sql missing — C05 must be merged before C09"
[ -f "$MIGDIR/019_cards_mcq.sql" ]   || fail "019_cards_mcq.sql missing — C08 must be merged before C09"
[ ! -e "$MIGDIR/018_cards_mcq.sql" ] || fail "018_cards_mcq.sql exists — superseded name (C00 §6 #1)"
[ -f "$MCQV" ] || fail "$MCQV missing — C08 must be merged before C09"
grep -Fq 'public static JsonElement? JsonbElement(' "$HELPERS" || fail "Helpers.cs lacks JsonbElement (C08 incomplete)"
grep -Fq 'public static void JsonbCell(' "$HELPERS"           || fail "Helpers.cs lacks JsonbCell (C08 incomplete)"
grep -Fq 'public static string Canonicalize(JsonElement raw, string? question)' "$MCQV" || fail "McqValidation.cs lacks the pinned Canonicalize signature (C08 incomplete)"
grep -Fq 'public static bool IsMcqDifficulty(int difficulty)' "$MCQV" || fail "McqValidation.cs lacks IsMcqDifficulty(int) (C08 incomplete)"
grep -Fq 'public string? Topic { get; set; }' "$UP" || fail "IS3DeckUploader.cs lacks Topic (C05 incomplete)"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. CardsPage.cs — c.topic, then c.mcq as the last column; rows pass through JsonbCell
[ "$(count '^[[:space:]]+c\.topic,$' "$PAGE")" = "1" ] || fail "CardsPage.cs: select must contain one 'c.topic,' line (trailing comma — mcq follows)"
[ "$(count '^[[:space:]]+c\.mcq$' "$PAGE")" = "1" ]    || fail "CardsPage.cs: select must end with one bare c.mcq line"
grep -Eq '^[[:space:]]+c\.topic$' "$PAGE" && fail "CardsPage.cs: a bare c.topic line remains — mcq must follow topic"
tp_ln="$(grep -En '^[[:space:]]+c\.topic,$' "$PAGE" | head -1 | cut -d: -f1)"
[ "$(sed -n "$((tp_ln + 1))p" "$PAGE" | sed 's/[[:space:]]*$//' | sed 's/^[[:space:]]*//')" = "c.mcq" ] || fail "CardsPage.cs: c.mcq must be the line directly after c.topic,"
[ "$(sed -n "$((tp_ln + 2))p" "$PAGE" | sed 's/^[[:space:]]*//')" = "from cards c" ] || fail "CardsPage.cs: 'from cards c' must directly follow c.mcq"
grep -Fq 'foreach (var row in rows) Helpers.JsonbCell(row, "mcq");' "$PAGE" || fail "CardsPage.cs: rows must pass through Helpers.JsonbCell(row, \"mcq\")"
before 'var rows = await DbUtil.QueryAsync(conn, null, sql, parameters);' 'Helpers.JsonbCell(row, "mcq")' "$PAGE" || fail "CardsPage.cs: JsonbCell must run after the rows are read"
before 'Helpers.JsonbCell(row, "mcq")' 'var hasMore = rows.Count == limit;' "$PAGE" || fail "CardsPage.cs: JsonbCell must run before the cursor arithmetic"
# 2b. Publish.cs — lifted CardsSql (topic, mcq), JsonbElement in baseCards, the gate, its placement, CONFIG_ERROR untouched
grep -Fq 'internal const string CardsSql = """' "$PUB" || fail "Publish.cs: internal const string CardsSql missing"
grep -Fq 'const string cardsSql' "$PUB" && fail "Publish.cs: the local cardsSql const must be gone (lifted to CardsSql)"
sql_ln="$(lineof 'internal const string CardsSql = """' "$PUB")"
sql_block="$(sed -n "$((sql_ln + 1)),$((sql_ln + 17))p" "$PUB")"
printf '%s\n' "$sql_block" | grep -Eq '^[[:space:]]+topic,$' || fail "Publish.cs: CardsSql must contain a 'topic,' line"
printf '%s\n' "$sql_block" | grep -Eq '^[[:space:]]+mcq$'    || fail "Publish.cs: CardsSql must contain a bare 'mcq' line"
tp_ln="$(printf '%s\n' "$sql_block" | grep -En '^[[:space:]]+topic,$' | head -1 | cut -d: -f1)"
[ "$(printf '%s\n' "$sql_block" | sed -n "$((tp_ln + 1))p" | sed 's/^[[:space:]]*//')" = "mcq" ] || fail "Publish.cs: mcq must be the line directly after topic, in CardsSql"
printf '%s\n' "$sql_block" | grep -Fq 'where deck_id = $1 and is_deleted = 0' || fail "Publish.cs: CardsSql WHERE clause changed"
printf '%s\n' "$sql_block" | grep -Fq 'order by order_in_deck asc, id asc'     || fail "Publish.cs: CardsSql ORDER BY changed"
grep -Fq 'var cardRows = await DbUtil.QueryAsync(conn, null, CardsSql, [deckIdInt]);' "$PUB" || fail "Publish.cs: cardRows must be read with CardsSql"
grep -Fq 'topic = c.TryGetValue("topic", out var tp) ? tp as string : null,' "$PUB" || fail "Publish.cs: C05's baseCards topic line missing/changed"
grep -Fq 'mcq = Helpers.JsonbElement(c, "mcq"),' "$PUB" || fail "Publish.cs: baseCards must carry mcq = Helpers.JsonbElement(c, \"mcq\"),"
before 'topic = c.TryGetValue("topic", out var tp) ? tp as string : null,' 'mcq = Helpers.JsonbElement(c, "mcq"),' "$PUB" || fail "Publish.cs: mcq must follow topic in baseCards"
grep -Fq 'internal static (string StableUid, string Code)? FirstMcqGateFailure(IReadOnlyList<Dictionary<string, object?>> cardRows)' "$PUB" || fail "Publish.cs: FirstMcqGateFailure signature missing/changed (C00 §2.9.4)"
for sym in 'McqValidation.Canonicalize(' 'catch (McqValidationError' 'McqValidation.IsMcqDifficulty(' \
           '"MCQ_EXPLANATION_REQUIRED"' '"MCQ_DIFFICULTY_RANGE"' 'var gate = FirstMcqGateFailure(cardRows);' \
           'return res.BadRequest("MCQ_PUBLISH_GATE", $"{gate.Value.StableUid}: {gate.Value.Code}");'; do
  grep -Fq "$sym" "$PUB" || fail "Publish.cs lacks: $sym"
done
[ "$(fcount '"MCQ_PUBLISH_GATE"' "$PUB")" = "1" ] || fail "Publish.cs: exactly one \"MCQ_PUBLISH_GATE\" literal"
before 'if (mode == "preview")' 'FirstMcqGateFailure(cardRows)' "$PUB" || fail "Publish.cs: the gate must sit after the preview return (preview is never gated)"
before 'FirstMcqGateFailure(cardRows)' 'const string checkDuplicateSql = """' "$PUB" || fail "Publish.cs: the gate must sit before the duplicate-job check"
before 'private static string InferTier(long deckType, object? tierValue)' 'FirstMcqGateFailure(IReadOnlyList' "$PUB" || fail "Publish.cs: FirstMcqGateFailure goes after InferTier"
before 'FirstMcqGateFailure(IReadOnlyList' 'public static async Task<APIGatewayProxyResponse> HandleAuthoringPublish(' "$PUB" || fail "Publish.cs: FirstMcqGateFailure is declared before the handler"
grep -Fq 'if (mode == "publish" && string.IsNullOrEmpty(PublishJobQueueUrl)) return res.BadRequest("CONFIG_ERROR", "Missing env PUBLISH_JOB_QUEUE_URL");' "$PUB" || fail "Publish.cs: the CONFIG_ERROR check at :98 changed"
before 'Missing env PUBLISH_JOB_QUEUE_URL' 'await using var conn = await Pg.OpenConnectionOrNullAsync();' "$PUB" || fail "Publish.cs: CONFIG_ERROR must stay before the connection opens"
grep -Fq 'JsonDocument.Parse(' "$PUB" && fail "Publish.cs: JsonDocument.Parse(...).RootElement is forbidden (disposed document)"
grep -Fq 'catch (Exception ex) when (ex is ValidationError)' "$PUB" || fail "Publish.cs: the ValidationError catch arm changed"
# 2c. IS3DeckUploader.cs — usings at lines 1-2, attribute + Mcq as the LAST property, Topic before it
[ "$(sed -n 1p "$UP")" = "using System.Text.Json;" ]               || fail "IS3DeckUploader.cs: line 1 must be 'using System.Text.Json;'"
[ "$(sed -n 2p "$UP")" = "using System.Text.Json.Serialization;" ] || fail "IS3DeckUploader.cs: line 2 must be C05's Serialization using"
grep -Fq 'public JsonElement? Mcq { get; set; }' "$UP" || fail "IS3DeckUploader.cs: Mcq property missing or has an initializer"
[ "$(fcount '[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]' "$UP")" = "2" ] || fail "IS3DeckUploader.cs: exactly two WhenWritingNull attributes (Topic, Mcq)"
tail3="$(awk 'NF' "$UP" | sed 's/[[:space:]]*$//' | tail -n 3)"
[ "$(printf '%s\n' "$tail3" | sed -n 1p)" = "  [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]" ] || fail "IS3DeckUploader.cs: the attribute must sit directly above Mcq (third-last non-blank line)"
[ "$(printf '%s\n' "$tail3" | sed -n 2p)" = "  public JsonElement? Mcq { get; set; }" ] || fail "IS3DeckUploader.cs: Mcq must be the LAST property of CardExportData"
[ "$(printf '%s\n' "$tail3" | sed -n 3p)" = "}" ] || fail "IS3DeckUploader.cs: file must end with the CardExportData closing brace"
before 'public string? Topic { get; set; }' 'public JsonElement? Mcq { get; set; }' "$UP" || fail "IS3DeckUploader.cs: Topic must be declared before Mcq"
grep -Fq 'public int Revision { get; set; } = 1;' "$UP" || fail "IS3DeckUploader.cs: Revision line changed"
# 2d. PublishJobProcessor.cs — LoadCardsAsync, three selects, two 42703 arms, null-preserving mapper
for sym in 'using Npgsql;' 'using System.Text.Json;' \
           'public static async Task<List<CardExportData>> LoadCardsAsync(NpgsqlConnection conn, int deckId)' \
           'CardsSqlTopicOnly' 'CardsSqlLegacy' \
           'Topic = c.TryGetValue("topic", out var tp) ? tp as string : null,' \
           'Mcq = c.TryGetValue("mcq", out var m) && m is string s ? JsonSerializer.Deserialize<JsonElement>(s) : (JsonElement?)null,' \
           'var cards = await LoadCardsAsync(conn, deckId);'; do
  grep -Fq "$sym" "$PROC" || fail "PublishJobProcessor.cs lacks: $sym"
done
grep -Eq 'const string CardsSql = """' "$PROC" || fail "PublishJobProcessor.cs: CardsSql (11 columns) missing"
[ "$(fcount 'SqlState == "42703"' "$PROC")" -ge 2 ] || fail "PublishJobProcessor.cs: two 42703 arms required (11 -> 10 -> 9 columns)"
[ "$(count '^[[:space:]]+topic,$' "$PROC")" = "1" ] || fail "PublishJobProcessor.cs: CardsSql must have one 'topic,' line (mcq follows)"
[ "$(count '^[[:space:]]+mcq$' "$PROC")" = "1" ]    || fail "PublishJobProcessor.cs: CardsSql must end with one bare mcq line"
[ "$(count '^[[:space:]]+topic$' "$PROC")" = "1" ]  || fail "PublishJobProcessor.cs: CardsSqlTopicOnly must end with one bare topic line"
[ "$(fcount 'WHERE deck_id = $1 AND is_deleted = 0' "$PROC")" = "3" ] || fail "PublishJobProcessor.cs: the three selects share the same WHERE tail"
[ "$(fcount 'ORDER BY order_in_deck ASC, id ASC' "$PROC")" = "3" ]    || fail "PublishJobProcessor.cs: the three selects share the same ORDER BY tail"
before 'Topic = c.TryGetValue("topic"' 'Mcq = c.TryGetValue("mcq"' "$PROC" || fail "PublishJobProcessor.cs: Mcq initialiser must follow Topic"
grep -Fq 'const string cardsSql' "$PROC" && fail "PublishJobProcessor.cs: the local cardsSql in LoadDeckDataAsync must be replaced by LoadCardsAsync"
if grep -E '(Topic|Mcq) = .*(string\.Empty|\?\? "")' "$PROC" >/dev/null; then
  grep -En '(Topic|Mcq) = .*(string\.Empty|\?\? "")' "$PROC" >&2 || true
  fail "PublishJobProcessor.cs: Topic/Mcq must map DB NULL to null, never to an empty value"
fi
for bad in 'JsonDocument.Parse(' 'information_schema' 'BeginTransaction'; do
  grep -Fq "$bad" "$PROC" && fail "PublishJobProcessor.cs must not contain: $bad (catch-and-retry on 42703 only, no probe, no transaction)"
done
# 2e. DeckDiff.cs — structural McqEquals, appended compare, comment
for sym in 'using System.Text.Json;' 'using System.Text.Json.Nodes;' \
           'public static bool McqEquals(JsonElement? a, JsonElement? b)' 'JsonNode.DeepEquals(' \
           '|| !McqEquals(a.Mcq, b.Mcq)' '|| !string.Equals(a.Topic, b.Topic, StringComparison.Ordinal)' '11 个卡片字段'; do
  grep -Fq "$sym" "$DIFF" || fail "DeckDiff.cs lacks: $sym"
done
grep -Fq '10 个卡片字段' "$DIFF" && fail "DeckDiff.cs: stale 10 个卡片字段 comment"
before '|| !string.Equals(a.Topic, b.Topic, StringComparison.Ordinal)' '|| !McqEquals(a.Mcq, b.Mcq)' "$DIFF" || fail "DeckDiff.cs: the Mcq compare is appended after the Topic compare"
if grep -Eq 'GetRawText\(\)[[:space:]]*[=!]=|string\.Equals\(a\.Mcq' "$DIFF"; then
  grep -En 'GetRawText\(\)[[:space:]]*[=!]=|string\.Equals\(a\.Mcq' "$DIFF" >&2 || true
  fail "DeckDiff.cs: mcq must be compared structurally, never as text"
fi
# 2f. ContentArtifactsGenerator.cs — PreviousCardDocument.Mcq + MapPreviousCards copy, after C05's Topic pair
for sym in 'public string? Topic { get; set; }' 'Topic = c.Topic,' 'public JsonElement? Mcq { get; set; }' 'Mcq = c.Mcq,'; do
  grep -Fq "$sym" "$GEN" || fail "ContentArtifactsGenerator.cs lacks: $sym"
done
before 'public string? Topic { get; set; }' 'public JsonElement? Mcq { get; set; }' "$GEN" || fail "ContentArtifactsGenerator.cs: PreviousCardDocument.Mcq must follow Topic"
before 'Topic = c.Topic,' 'Mcq = c.Mcq,' "$GEN" || fail "ContentArtifactsGenerator.cs: MapPreviousCards Mcq must follow Topic"
[ "$(fcount 'SqlState is' "$GEN")" = "3" ] || fail "ContentArtifactsGenerator.cs: the three existing 42703/42P01 arms changed"
# 2g. ContentSerializationContractTests.cs — golden untouched, PG-text -> compact goldens, round trip
grep -Fq '"""{"stableUid":"u1","orderInDeck":1,"difficulty":2,"question":"q","explanation":"e","codeLanguage":"csharp","codeSnippet":"c","realWorldUsage":"r","revision":1}""";' "$CST" \
  || fail "ContentSerializationContractTests.cs: golden CardJson literal changed"
grep -Fq 'using System.Text.Json;' "$CST" || fail "ContentSerializationContractTests.cs: needs using System.Text.Json;"
for sym in 'McqPgText =' 'McqJson =' \
           '{"v": 1, "options": [{"key": "a", "why": null,' \
           '{"v":1,"options":[{"key":"a","why":null,"text":"queue","correct":true},{"key":"b","why":"no buffer","text":"resize","correct":false},{"key":"c","why":"one shard","text":"stream","correct":false}],"shuffle":true,"qualifier":null}' \
           ',"topic":"t","mcq":' ',"mcq":' 'JsonSerializer.Deserialize<CardExportData>(' 'JsonValueKind.Object' '"revision":1,"topic":"t"}'; do
  grep -Fq "$sym" "$CST" || fail "ContentSerializationContractTests.cs lacks: $sym"
done
for s in Card_SerializesExactCamelCaseFieldNames Card_NullCodeLanguage_SerializesAsNull DeckDelta_SerializesExactContractShape \
         DeckPackage_SerializesExactContractShape DeckChunk_SerializesExactContractShape DeckExportData_DeckJson_KeepsExistingCamelCaseShape \
         Card_WithTopic_AppendsTopicLast Card_NullTopic_KeepsGoldenBytes \
         Card_WithTopicAndMcq_AppendsMcqLast Card_WithMcqOnly_OmitsTopic Card_WithMcq_RoundTripsThroughContentJson; do
  grep -Fq "public void $s()" "$CST" || fail "ContentSerializationContractTests.cs: missing test $s"
done
# 2h. DeckDiffTests.cs — mcq row, comment, the three new facts, existing facts (base + C05)
for sym in 'using System.Text.Json;' 'JsonElement? mcq = null' 'Mcq = mcq,' '{ "mcq", MakeCard("a", mcq:' '{ "topic", MakeCard("a", topic: "changed") }' \
           '除 stableUid 之外的 10 个字段' 'McqCompact' 'McqPgSpaced' 'McqWhyChanged' '"why":"no queue"' 'DeckDiff.McqEquals(null, null)'; do
  grep -Fq "$sym" "$DDT" || fail "DeckDiffTests.cs lacks: $sym"
done
grep -Fq '9 个字段' "$DDT" && fail "DeckDiffTests.cs: stale 9 个字段 comment"
for s in Compute_IdenticalDecks_IsNoOp Compute_NewUid_IsAdded Compute_MissingUid_IsDeleted Compute_ChangedCard_IsUpdated_AndCarriesNextValues \
         Compute_MixedChanges_AllBucketsFilled_InNextOrder Compute_AnySingleFieldChange_TriggersUpdated Compute_CodeLanguageNullToValue_TriggersUpdated \
         Compute_EmptyPrev_AllAdded Compute_EmptyNext_AllDeleted Compute_TopicNullToValue_TriggersUpdated \
         Compute_SameMcqDifferentSpacing_IsUnchanged Compute_McqOptionWhyChange_TriggersUpdated McqEquals_BothNullEqual_OneNullDifferent; do
  grep -Fq "public void $s(" "$DDT" || fail "DeckDiffTests.cs: missing test $s"
done
# 2i. PublishMcqGateTests.cs — DB collection, production select, pure gate, preview + page handlers, six cases
grep -Fq '[Collection(PostgresCollection.Name)]' "$GATET" || fail "PublishMcqGateTests.cs must join the postgres collection"
grep -Fq 'public class PublishMcqGateTests' "$GATET"      || fail "PublishMcqGateTests.cs: class name"
for sym in 'Publish.CardsSql' 'Publish.FirstMcqGateFailure(' 'Publish.HandleAuthoringPublish(' 'CardsPage.HandleAuthoringCardsPage(' \
           '::jsonb' '"MCQ_BAD_VERSION"' '"MCQ_EXPLANATION_REQUIRED"' '"MCQ_DIFFICULTY_RANGE"' '"bad-version"' \
           'JsonValueKind.Object' 'JsonValueKind.Null' 'it-c09gate-' '"preview"' 'super_admin' 'Auth.GetAuthContext(req)'; do
  grep -Fq "$sym" "$GATET" || fail "PublishMcqGateTests.cs lacks: $sym"
done
for s in Gate_InvalidStoredMcq_ReportsUidAndCode Gate_MissingExplanation_IsMcqExplanationRequired Gate_DifficultyOutOfRange_IsMcqDifficultyRange \
         Gate_ValidMcqAndQaRows_Pass Preview_IsNotGated_AndEchoesMcqAsObject CardsPage_EchoesMcqAsObject; do
  grep -Fq "$s(" "$GATET" || fail "PublishMcqGateTests.cs: missing test $s"
done
[ "$(fcount '[Fact]' "$GATET")" -ge 6 ] || fail "PublishMcqGateTests.cs needs >= 6 [Fact]"
for bad in 'PUBLISH_JOB_QUEUE_URL' 'SetEnvironmentVariable'; do
  grep -Fq "$bad" "$GATET" && fail "PublishMcqGateTests.cs must not mention $bad (Warmup would make a real SQS call; the warmup tests early-return)"
done
# 2j. PublishJobProcessorSchemaTests.cs — two scratch databases at 17 / 18, the full-schema golden, three cases
grep -Fq '[Collection(PostgresCollection.Name)]' "$SCHEMAT" || fail "PublishJobProcessorSchemaTests.cs must join the postgres collection"
grep -Fq 'public class PublishJobProcessorSchemaTests' "$SCHEMAT" || fail "PublishJobProcessorSchemaTests.cs: class name"
for sym in 'CreateScratchDatabaseAsync("c09_pre018")' 'CreateScratchDatabaseAsync("c09_only018")' \
           'ApplyMigrationsAsync(conn, maxVersion: 17)' 'ApplyMigrationsAsync(conn, maxVersion: 18)' \
           'PublishJobProcessor.LoadCardsAsync(' 'ContentJson.Options' '::jsonb' 'JsonValueKind.Object' \
           '{"v":1,"qualifier":null,"shuffle":true,"options":[{"key":"a","text":"queue","why":null,"correct":true}'; do
  grep -Fq "$sym" "$SCHEMAT" || fail "PublishJobProcessorSchemaTests.cs lacks: $sym"
done
for s in LoadCards_PreTopicSchema_FallsBackToLegacyColumns LoadCards_TopicOnlySchema_KeepsTopicAndNullMcq LoadCards_FullSchema_ParsesMcqAsOwnedElement; do
  grep -Fq "$s(" "$SCHEMAT" || fail "PublishJobProcessorSchemaTests.cs: missing test $s"
done
[ "$(fcount '[Fact]' "$SCHEMAT")" -ge 3 ] || fail "PublishJobProcessorSchemaTests.cs needs >= 3 [Fact]"
for bad in 'PUBLISH_JOB_QUEUE_URL' 'SetEnvironmentVariable' 'information_schema'; do
  grep -Fq "$bad" "$SCHEMAT" && fail "PublishJobProcessorSchemaTests.cs must not mention $bad"
done
# 2k. suppression / gutting across every scope file
if grep -Eq 'Skip[[:space:]]*=|#pragma warning disable|\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable' \
     "$PAGE" "$PUB" "$UP" "$PROC" "$DIFF" "$GEN" "$CST" "$DDT" "$GATET" "$SCHEMAT"; then
  grep -En 'Skip[[:space:]]*=|#pragma warning disable|\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable' \
     "$PAGE" "$PUB" "$UP" "$PROC" "$DIFF" "$GEN" "$CST" "$DDT" "$GATET" "$SCHEMAT" >&2 || true
  fail "test gutting / suppression found"
fi

# ── 3. dotnet build (implicit cached restore; no network) ──────────────────
echo "[3/5] dotnet build Tests/RecallSmith.Lambda.IntegrationTests"
( cd src_C && dotnet build Tests/RecallSmith.Lambda.IntegrationTests -c Debug --nologo ) || fail "dotnet build failed"
[ -f "$TESTDIR/bin/Debug/net8.0/Db/Migrations/018_cards_topic.sql" ] || fail "018_cards_topic.sql did not reach the test bin (Vpc csproj None include)"
[ -f "$TESTDIR/bin/Debug/net8.0/Db/Migrations/019_cards_mcq.sql" ]   || fail "019_cards_mcq.sql did not reach the test bin (Vpc csproj None include)"

# ── 4. Targeted xunit (Docker required for the two DB classes) ─────────────
echo "[4/5] dotnet test --filter ContentSerializationContractTests|DeckDiffTests|PublishMcqGateTests|PublishJobProcessorSchemaTests"
docker info >/dev/null 2>&1 || fail "Docker daemon is not running — PublishMcqGateTests / PublishJobProcessorSchemaTests need Testcontainers postgres:16-alpine"
( cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests -c Debug --no-build --nologo \
    --filter "FullyQualifiedName~ContentSerializationContractTests|FullyQualifiedName~DeckDiffTests|FullyQualifiedName~PublishMcqGateTests|FullyQualifiedName~PublishJobProcessorSchemaTests" ) \
  || fail "targeted dotnet test failed"

# ── 5. Scope + frozen-file guard (purely negative; passes on base) ─────────
echo "[5/5] scope + frozen guard"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json mobile/src mobile/tests \
  frontend/src frontend/tests snowflake src_C/Shared src_C/Vpc/Runtime src_C/Vpc/Db \
  src_C/Vpc/Authoring/Cards.cs src_C/Vpc/Authoring/Helpers.cs src_C/Vpc/Authoring/McqValidation.cs src_C/Vpc/Authoring/ContentIntelligence.cs \
  src_C/Vpc/AssemblyInfo.cs src_C/Worker/Content/ContentModels.cs src_C/Worker/Content/ContentJson.cs src_C/Worker/S3/S3DeckUploader.cs \
  "$TESTDIR/IntegrationTestBase.cs" "$TESTDIR/CardsPageTests.cs" "$TESTDIR/CardsAuthoringMcqTests.cs" "$TESTDIR/McqValidationTests.cs" \
  "$TESTDIR/CardsAuthoringTopicTests.cs" "$TESTDIR/ProgressEventsSingleStatementTests.cs" "$TESTDIR/Migration015BackfillTests.cs" \
  ':(glob)src_C/**/*.csproj' ':(glob)docs/*.md')"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
# Add-only on the two existing test files: CST loses no line; DDT may lose only the
# MakeCard parameter line that gains `mcq` and the "9 个字段" comment.
cst_removed="$(git diff -U0 "$mb" -- "$CST" | grep '^-' | grep -v '^---' || true)"
[ -z "$cst_removed" ] || { echo "$cst_removed" >&2; fail "ContentSerializationContractTests.cs is add-only — a line was removed or rewritten"; }
ddt_removed="$(git diff -U0 "$mb" -- "$DDT" | grep '^-' | grep -v '^---' | grep -Ev 'topic = null\)|9 个字段' || true)"
[ -z "$ddt_removed" ] || { echo "$ddt_removed" >&2; fail "DeckDiffTests.cs is add-only beyond the MakeCard parameter line and the field-count comment"; }
# Untracked scan is pathspec-scoped, never bare: the driver symlinks mobile/node_modules and
# frontend/node_modules into the worktree and the `node_modules/` ignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- src_C/Vpc src_C/Worker src_C/Tests src_C/Shared mobile/src mobile/tests frontend/src frontend/tests snowflake docs; } | sort -u | grep -Ev '^(src_C/Vpc/Authoring/CardsPage\.cs|src_C/Vpc/Authoring/Publish\.cs|src_C/Worker/S3/IS3DeckUploader\.cs|src_C/Worker/Services/PublishJobProcessor\.cs|src_C/Worker/Content/DeckDiff\.cs|src_C/Worker/Services/ContentArtifactsGenerator\.cs|src_C/Tests/RecallSmith\.Lambda\.IntegrationTests/ContentSerializationContractTests\.cs|src_C/Tests/RecallSmith\.Lambda\.IntegrationTests/DeckDiffTests\.cs|src_C/Tests/RecallSmith\.Lambda\.IntegrationTests/PublishMcqGateTests\.cs|src_C/Tests/RecallSmith\.Lambda\.IntegrationTests/PublishJobProcessorSchemaTests\.cs|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside C09 scope"; }

echo "C09 VERIFY OK"
