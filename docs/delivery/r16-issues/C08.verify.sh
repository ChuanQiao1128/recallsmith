#!/usr/bin/env bash
# C08 — mcq-server-api verify. cwd = worktree root. Re-runs the brief's
# acceptance bullets verbatim; never trusts the worker's report.
#
# ON THE UNTOUCHED BASE TREE THIS SCRIPT EXITS NON-ZERO at step 1:
#   - src_C/Vpc/Db/Migrations/019_cards_mcq.sql,
#     src_C/Vpc/Authoring/McqValidation.cs,
#     src_C/Tests/RecallSmith.Lambda.IntegrationTests/McqValidationTests.cs and
#     src_C/Tests/RecallSmith.Lambda.IntegrationTests/CardsAuthoringMcqTests.cs
#     do not exist on base (the first missing one stops the run).
#   (step 1 then also checks the C05 prerequisite: 018_cards_topic.sql must
#   exist and Cards.cs / Helpers.cs must already carry `c.topic` /
#   `ParseOptionalTopic`, because C08's `mcq` sits after `topic` everywhere and
#   the INSERT placeholder is `$13::jsonb` only once `topic` is `$12`.)
# Step 2 (literal guards) would also fail on base: no `Cast` slot on
# UpdateField, no `c.mcq`, no `$13::jsonb`, no `McqValidationError` arms.
# Steps 3/4 are the dotnet build / targeted-xunit gates and step 5 is a purely
# negative scope guard; they pass on base by design and are never reached there.
#
# Network: none. `dotnet build` restores implicitly from the local NuGet cache
# (C08 adds no PackageReference). Step 4a (McqValidationTests) is pure and needs
# no Docker; step 4b (CardsAuthoringMcqTests) needs a running Docker daemon
# (Testcontainers postgres:16-alpine, image cached). Runtime: steps 1-2 seconds,
# step 3 ~1-2 min cold, step 4 single-digit minutes (one container start; not
# measured). The driver's diff-scoped banned-term grep and suppression scan run
# separately (gates a/b) — this script deliberately does not spell those terms.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
BASE_REF="${BASE_REF:-${BASE:-delivery/r16-c-economy}}"   # driver exports BASE
fail() { echo "C08 VERIFY FAIL: $*" >&2; exit 1; }

MIGDIR=src_C/Vpc/Db/Migrations
MIG=$MIGDIR/019_cards_mcq.sql
MIG_TOPIC=$MIGDIR/018_cards_topic.sql
CARDS=src_C/Vpc/Authoring/Cards.cs
HELPERS=src_C/Vpc/Authoring/Helpers.cs
MCQV=src_C/Vpc/Authoring/McqValidation.cs
TESTDIR=src_C/Tests/RecallSmith.Lambda.IntegrationTests
MVT=$TESTDIR/McqValidationTests.cs
MAT=$TESTDIR/CardsAuthoringMcqTests.cs

count() { grep -Ec "$1" "$2" || true; }     # ERE count, 0 when no match
fcount() { grep -Fc "$1" "$2" || true; }    # fixed-string count, 0 when no match
lineof() { grep -Fn "$1" "$2" | head -1 | cut -d: -f1; }
elineof() { grep -En "$1" "$2" | head -1 | cut -d: -f1; }
# A golden literal may be spelled as a raw """…""" string or as a regular "…" string
# with \" escapes; both are accepted, but it must sit on ONE line (brief change 5).
has_literal_either() { grep -Fq "$1" "$3" || grep -Fq "$2" "$3"; }

# The two golden canonical strings (brief change 5; derived from the §4.3 cards of
# docs/mcq-card-type-plan-2026-09-18.md:177-253 with the change-2 algorithm).
SQS_GOLD=$(cat <<'G'
{"v":1,"options":[{"key":"a","why":"Vertical scaling raises the ceiling but does not buffer a burst; once the larger instance saturates, orders are lost again, and someone has to keep resizing it.","text":"Increase the instance size of the fulfilment service and enable detailed CloudWatch monitoring.","correct":false},{"key":"b","why":null,"text":"Publish each order to an Amazon SQS standard queue and run the fulfilment service in an Auto Scaling group that scales on ApproximateNumberOfMessagesVisible.","correct":true},{"key":"c","why":"A single shard caps ingest at 1 MB/s or 1,000 records/s; keeping the shard count right is exactly the operational work the question asks to avoid.","text":"Write each order to an Amazon Kinesis Data Streams stream with one shard and process it with AWS Lambda.","correct":false},{"key":"d","why":"Polling a relational table turns the database into a queue: extra load, locking logic, and the two services stay coupled.","text":"Insert each order into an Amazon RDS table and have the fulfilment service poll for unprocessed rows every second.","correct":false}],"shuffle":true,"qualifier":"LEAST operational overhead"}
G
)
S3_GOLD=$(cat <<'G'
{"v":1,"options":[{"key":"a","why":null,"text":"Enable versioning on both buckets and configure S3 Cross-Region Replication to the destination bucket.","correct":true},{"key":"b","why":"Transfer Acceleration speeds up uploads over long distances; it never copies an object to another Region.","text":"Enable S3 Transfer Acceleration on the source bucket.","correct":false},{"key":"c","why":null,"text":"Enable S3 Object Lock in compliance mode with a seven-year retention period on the destination bucket.","correct":true},{"key":"d","why":"A bucket policy can be edited or removed by an administrator, so it cannot prove that a copy is undeletable; compliance-mode Object Lock cannot be shortened or removed by anyone.","text":"Apply a bucket policy on the destination bucket that denies s3:DeleteObject to all principals.","correct":false},{"key":"e","why":"MFA Delete protects the source bucket's versions from casual deletion; it does not cover the second-Region copy and an administrator with the MFA device can still delete.","text":"Enable MFA Delete on the source bucket.","correct":false}],"shuffle":true,"qualifier":null}
G
)
SQS_ESC="${SQS_GOLD//\"/\\\"}"
S3_ESC="${S3_GOLD//\"/\\\"}"
SQS_STEM='An order API runs on Amazon EC2 instances behind an Application Load Balancer. During flash sales the downstream fulfilment service is overwhelmed and orders are lost. The company wants the API to keep accepting orders while fulfilment catches up, with the LEAST operational overhead. Which solution meets these requirements?'
S3_STEM='A company must keep a copy of every object written to an S3 bucket in a second Region and must be able to prove that no copy can be deleted for seven years, even by an account administrator. Which combination of actions meets these requirements? (Choose two.)'

CANON_CODES="MCQ_BAD_SHAPE MCQ_BAD_VERSION MCQ_TOO_FEW_OPTIONS MCQ_TOO_MANY_OPTIONS MCQ_KEY_SEQUENCE MCQ_DUPLICATE_OPTION_KEY \
MCQ_OPTION_EMPTY MCQ_OPTION_TOO_LONG MCQ_OPTION_TEXT_DUPLICATE MCQ_NO_CORRECT MCQ_TOO_MANY_CORRECT MCQ_ALL_CORRECT MCQ_WHY_MISSING \
MCQ_QUALIFIER_EMPTY MCQ_QUALIFIER_IS_CHOOSE_N MCQ_QUALIFIER_NOT_IN_STEM MCQ_CHOOSE_N_MISMATCH"

# ── 1. Scope files exist (FAILS ON BASE) ───────────────────────────────────
echo "[1/5] scope files exist (+ C05 prerequisite)"
for f in "$MIG" "$MCQV" "$MVT" "$MAT"; do
  [ -f "$f" ] || fail "$f does not exist (base tree fails here)"
done
for f in "$CARDS" "$HELPERS"; do
  [ -f "$f" ] || fail "$f is missing"
done
[ -f "$MIG_TOPIC" ] || fail "$MIG_TOPIC is missing — C05 must be merged before C08 (mcq sits after topic; \$13::jsonb needs topic at \$12)"
grep -Eq '^[[:space:]]+c\.topic,?$' "$CARDS"         || fail "Cards.cs has no c.topic select line — C05 incomplete"
grep -Fq 'Helpers.ParseOptionalTopic(body)' "$CARDS"  || fail "Cards.cs lacks Helpers.ParseOptionalTopic(body) — C05 incomplete"
grep -Fq 'public static string? ParseOptionalTopic(JsonElement body)' "$HELPERS" || fail "Helpers.cs lacks ParseOptionalTopic — C05 incomplete"
[ ! -e "$MIGDIR/018_cards_mcq.sql" ] || fail "018_cards_mcq.sql exists — superseded name (C00 §6 #1); docsPaths rule (b) goes red"
[ "$(ls "$MIGDIR" | grep -c '^018_' || true)" = "1" ] || fail "exactly one 018_*.sql is allowed"
[ "$(ls "$MIGDIR" | grep -c '^019_' || true)" = "1" ] || fail "exactly one 019_*.sql is allowed (019_cards_mcq.sql)"
ls "$MIGDIR" | grep -q '^0[2-9][0-9]_' && fail "a 020+ migration exists — Phase 5 is not Wave C (C00 §6 #1)"

# ── 2. Literal guards ──────────────────────────────────────────────────────
echo "[2/5] literal guards"
# 2a. migration — one statement, the pinned DDL, header names the file, no index/CHECK/NOT NULL/DEFAULT
grep -Fq 'alter table cards add column if not exists mcq jsonb null;' "$MIG" || fail "019: pinned DDL line missing"
grep -Fq '019_cards_mcq.sql' "$MIG" || fail "019: header comment must name the file"
[ "$(grep -v '^[[:space:]]*--' "$MIG" | grep -c ';' || true)" = "1" ] || fail "019: exactly one SQL statement"
if grep -v '^[[:space:]]*--' "$MIG" | grep -Eiq 'create index|check[[:space:]]*\(|not null|default'; then
  grep -v '^[[:space:]]*--' "$MIG" | grep -Ein 'create index|check[[:space:]]*\(|not null|default' >&2 || true
  fail "019: no index / CHECK / NOT NULL / DEFAULT (C00 §0, MCQ plan §3.1)"
fi

# 2b. McqValidation.cs — the pinned signatures, the deliberate `: Exception` base, the encoder, all 17 codes, purity
grep -Fq 'namespace RecallSmith.Lambda.Vpc.Authoring;' "$MCQV" || fail "McqValidation.cs: namespace must be RecallSmith.Lambda.Vpc.Authoring"
for sym in 'public sealed class McqValidationError : Exception' \
           'public string Code { get; }' \
           'public McqValidationError(string code, string message) : base(message)' \
           'public static class McqValidation' \
           'public static string Canonicalize(JsonElement raw, string? question)' \
           'public static bool IsMcqDifficulty(int difficulty)' \
           'public static bool IsMcqDifficulty(long difficulty)' \
           'JavaScriptEncoder.UnsafeRelaxedJsonEscaping' \
           'Utf8JsonWriter'; do
  grep -Fq "$sym" "$MCQV" || fail "McqValidation.cs lacks: $sym"
done
grep -Fq 'McqValidationError : ValidationError' "$MCQV" && fail "McqValidation.cs: McqValidationError must derive from Exception (ValidationError is sealed, brief Context)"
for code in $CANON_CODES; do
  grep -Fq "\"$code\"" "$MCQV" || fail "McqValidation.cs lacks the code literal \"$code\""
done
for bad in 'MCQ_EXPLANATION_REQUIRED' 'MCQ_DIFFICULTY_RANGE'; do
  grep -Fq "$bad" "$MCQV" && fail "McqValidation.cs must not contain $bad — those two are handler gates in Cards.cs"
done
if grep -Eq 'Npgsql|DbUtil|JsonDocument\.Parse\(|RecallSmith\.Lambda\.Db|RecallSmith\.Lambda\.Common' "$MCQV"; then
  grep -En 'Npgsql|DbUtil|JsonDocument\.Parse\(|RecallSmith\.Lambda\.Db|RecallSmith\.Lambda\.Common' "$MCQV" >&2 || true
  fail "McqValidation.cs must stay pure: no Npgsql / DbUtil / Res / JsonDocument.Parse("
fi
if grep -E '^using ' "$MCQV" | grep -Evq '^using System(\.[A-Za-z.]+)?;$'; then
  grep -En '^using ' "$MCQV" | grep -Ev '^[0-9]+:using System(\.[A-Za-z.]+)?;$' >&2 || true
  fail "McqValidation.cs may import System.* namespaces only"
fi

# 2c. Helpers.cs — the Cast slot (verbatim C00 §2.9.3), BuildUpdateSet intact, the two jsonb helpers, C05 untouched
grep -Fq 'public sealed record UpdateField(string BodyKey, string ColumnName, Func<JsonElement, object?> Transform, string Cast = "");' "$HELPERS" \
  || fail "Helpers.cs: UpdateField record line must be the verbatim C00 §2.9.3 line with string Cast = \"\""
grep -Fq 'fields.Add($"{f.ColumnName} = ${idx++}{f.Cast}");' "$HELPERS" || fail "Helpers.cs: BuildUpdateSet must emit {f.Cast} after the placeholder"
grep -Fq 'fields.Add($"{f.ColumnName} = ${idx++}");' "$HELPERS" && fail "Helpers.cs: the old cast-less fields.Add line is still there"
grep -Fq 'if (!body.TryGetProperty(f.BodyKey, out var el)) continue;' "$HELPERS" || fail "Helpers.cs: BuildUpdateSet must still skip absent body keys"
grep -Fq 'fields.Add("updated_at = now()");' "$HELPERS" || fail "Helpers.cs: BuildUpdateSet must still append updated_at = now()"
grep -Fq 'public static JsonElement? JsonbElement(IReadOnlyDictionary<string, object?> row, string key)' "$HELPERS" || fail "Helpers.cs lacks the JsonbElement signature"
grep -Fq 'public static void JsonbCell(Dictionary<string, object?> row, string key)' "$HELPERS" || fail "Helpers.cs lacks the JsonbCell signature"
grep -Fq 'JsonSerializer.Deserialize<JsonElement>' "$HELPERS" || fail "Helpers.cs: JsonbElement must use JsonSerializer.Deserialize<JsonElement> (own copy)"
grep -Fq 'JsonDocument.Parse(' "$HELPERS" && fail "Helpers.cs: JsonDocument.Parse(...).RootElement would dangle — forbidden"
for sym in 'public const int TopicMaxLength = 80;' 'public static string? NormalizeTopic(JsonElement el)' \
           'public static async Task<long?> GetDeckIdByCardId(NpgsqlConnection conn, long cardId)'; do
  grep -Fq "$sym" "$HELPERS" || fail "Helpers.cs: C05 / pre-existing member missing or changed: $sym"
done

# 2d. Cards.cs — mcq after topic in all three projections, $13::jsonb, PUT spec + pre-read, gates, arms, JsonbCell, no transaction
[ "$(count '^[[:space:]]+c\.mcq$' "$CARDS")" = "1" ]     || fail "Cards.cs: GET select must end with one bare c.mcq line"
[ "$(count '^[[:space:]]+c\.topic,$' "$CARDS")" = "1" ]  || fail "Cards.cs: GET select c.topic line must carry a trailing comma (c.mcq follows)"
grep -Eq '^[[:space:]]+c\.topic$' "$CARDS" && fail "Cards.cs: a bare c.topic line remains — c.mcq must follow it"
[ "$(count '^[[:space:]]+mcq;$' "$CARDS")" = "2" ]       || fail "Cards.cs: POST and PUT RETURNING must each end with a bare mcq; line"
[ "$(count '^[[:space:]]+topic,$' "$CARDS")" = "2" ]     || fail "Cards.cs: both RETURNING topic lines must carry a trailing comma"
grep -Eq '^[[:space:]]+topic;$' "$CARDS" && fail "Cards.cs: a RETURNING list still ends at topic;"
grep -Fq 'real_world_usage, difficulty, order_in_deck, revision, version, topic, mcq' "$CARDS" || fail "Cards.cs: INSERT column list must end with topic, mcq"
grep -Eq '^[[:space:]]+\$12,$' "$CARDS"          || fail "Cards.cs: INSERT values \$12 line must carry a trailing comma"
grep -Eq '^[[:space:]]+\$13::jsonb$' "$CARDS"    || fail "Cards.cs: INSERT values must end with a bare \$13::jsonb line"
grep -Eq '^[[:space:]]+\$12$' "$CARDS" && fail "Cards.cs: a bare \$12 line remains — \$13::jsonb must follow it"
grep -Fq 'McqValidation.Canonicalize(mcqEl, question)' "$CARDS" || fail "Cards.cs: POST must canonicalise with McqValidation.Canonicalize(mcqEl, question)"
grep -Fq 'new("mcq", "mcq", v => v.ValueKind == JsonValueKind.Null ? null : McqValidation.Canonicalize(v, effectiveQuestion), "::jsonb"),' "$CARDS" \
  || fail "Cards.cs: PUT spec mcq entry missing/changed (C00 §2.9.3 verbatim)"
top_ln="$(lineof 'new("topic", "topic"' "$CARDS")"; mcq_ln="$(lineof 'new("mcq", "mcq"' "$CARDS")"; del_ln="$(lineof 'new("isDeleted", "is_deleted"' "$CARDS")"
[ -n "$top_ln" ] && [ -n "$mcq_ln" ] && [ -n "$del_ln" ] && [ "$top_ln" -lt "$mcq_ln" ] && [ "$mcq_ln" -lt "$del_ln" ] \
  || fail "Cards.cs: PUT spec mcq entry must sit after topic and before isDeleted"
grep -Fq 'select question, explanation, difficulty, mcq from cards where id = $1' "$CARDS" || fail "Cards.cs: PUT pre-read literal missing (C00 §2.9.3 / §6 #14)"
pre_ln="$(lineof 'select question, explanation, difficulty, mcq from cards where id = $1' "$CARDS")"; spec_ln="$(lineof 'var spec = new List<Helpers.UpdateField>' "$CARDS")"
[ -n "$pre_ln" ] && [ -n "$spec_ln" ] && [ "$pre_ln" -lt "$spec_ln" ] || fail "Cards.cs: the pre-read must run before the PUT spec / BuildUpdateSet"
grep -Fq 'spec = spec.Where(f => f.BodyKey is not ("deckId" or "isDeleted" or "stableUid")).ToList();' "$CARDS" || fail "Cards.cs: editor filter line must be byte-identical (editors keep mcq)"
[ "$(fcount '"MCQ_EXPLANATION_REQUIRED"' "$CARDS")" -ge 2 ] || fail "Cards.cs: MCQ_EXPLANATION_REQUIRED must be raised in POST and PUT"
[ "$(fcount '"MCQ_DIFFICULTY_RANGE"' "$CARDS")" -ge 2 ]     || fail "Cards.cs: MCQ_DIFFICULTY_RANGE must be raised in POST and PUT"
[ "$(fcount 'McqValidation.IsMcqDifficulty(' "$CARDS")" -ge 2 ] || fail "Cards.cs: IsMcqDifficulty must gate POST and PUT"
[ "$(fcount 'McqValidation.Canonicalize(' "$CARDS")" -ge 3 ]  || fail "Cards.cs: Canonicalize must be called in POST, the PUT pre-check and the PUT spec"
[ "$(fcount 'catch (McqValidationError ex)' "$CARDS")" -ge 2 ] || fail "Cards.cs: catch (McqValidationError ex) needed in POST and PUT"
grep -Fq 'return res.BadRequest(ex.Code, ex.Message);' "$CARDS" || fail "Cards.cs: the McqValidationError arm must answer res.BadRequest(ex.Code, ex.Message)"
# each named arm must come within five lines BEFORE a generic ValidationError arm (C00 §2.9.2: "before the generic arm")
while read -r m_ln; do
  [ -n "$m_ln" ] || continue
  g_ln="$(grep -Fn 'catch (Exception ex) when (ex is ValidationError)' "$CARDS" | cut -d: -f1 | awk -v m="$m_ln" '$1 > m' | head -1)"
  [ -n "$g_ln" ] && [ $((g_ln - m_ln)) -le 5 ] || fail "Cards.cs: the McqValidationError arm at line $m_ln is not immediately before a generic ValidationError arm"
done < <(grep -Fn 'catch (McqValidationError ex)' "$CARDS" | cut -d: -f1)
[ "$(fcount 'catch (Exception ex) when (ex is ValidationError)' "$CARDS")" = "4" ] || fail "Cards.cs: the four generic ValidationError arms (GET/POST/PUT/DELETE) must all remain"
grep -Fq 'Helpers.JsonbCell(row, "mcq")' "$CARDS"     || fail "Cards.cs: GET rows must pass through Helpers.JsonbCell(row, \"mcq\")"
[ "$(fcount 'Helpers.JsonbCell(rows[0], "mcq")' "$CARDS")" -ge 2 ] || fail "Cards.cs: POST and PUT rows[0] must pass through Helpers.JsonbCell(rows[0], \"mcq\")"
[ "$(fcount 'Helpers.JsonbCell(' "$CARDS")" -ge 3 ]   || fail "Cards.cs: JsonbCell must be applied in GET, POST and PUT"
grep -Fq 'Helpers.JsonbElement(storedRow, "mcq")' "$CARDS" || fail "Cards.cs: the PUT pre-check must read the stored blob via Helpers.JsonbElement(storedRow, \"mcq\")"
if grep -Eq 'BeginTransaction|select \*' "$CARDS"; then
  grep -En 'BeginTransaction|select \*' "$CARDS" >&2 || true
  fail "Cards.cs: no transaction (C00 §6 #14) and no select *"
fi
grep -Fq 'JsonDocument.Parse(' "$CARDS" && fail "Cards.cs: JsonDocument.Parse( must not appear (use Helpers.JsonbElement / JsonbCell)"
[ "$(fcount 'as "updatedAt",' "$CARDS")" = "3" ] || fail "Cards.cs: the three updatedAt lines must keep their trailing comma"

# 2e. McqValidationTests.cs — pure, the two goldens on one line each, the two stems, the ten cases, a Theory table, every code
grep -Fq '[Collection' "$MVT" && fail "McqValidationTests.cs must not join a collection (pure, no DB)"
grep -Eq 'PostgresFixture|_db\.|Npgsql' "$MVT" && fail "McqValidationTests.cs must never touch the database"
grep -Fq 'public class McqValidationTests' "$MVT" || fail "McqValidationTests.cs: class name"
has_literal_either "$SQS_GOLD" "$SQS_ESC" "$MVT" || fail "McqValidationTests.cs: SqsCanonical golden bytes missing/changed (must sit on one line)"
has_literal_either "$S3_GOLD"  "$S3_ESC"  "$MVT" || fail "McqValidationTests.cs: S3Canonical golden bytes missing/changed (must sit on one line)"
grep -Fq "$SQS_STEM" "$MVT" || fail "McqValidationTests.cs: SqsQuestion stem missing/changed"
grep -Fq "$S3_STEM"  "$MVT" || fail "McqValidationTests.cs: S3Question stem missing/changed"
for sym in 'SqsCanonical' 'S3Canonical' 'SqsQuestion' 'S3Question' '[Theory]' '[MemberData(nameof(Rejections))]' '[InlineData(' \
           'Assert.Throws<McqValidationError>' "it's über" 'McqValidation.Canonicalize(' 'McqValidation.IsMcqDifficulty(' '4294967297'; do
  grep -Fq "$sym" "$MVT" || fail "McqValidationTests.cs lacks: $sym"
done
for s in Canonicalize_SqsCard_ProducesThePinnedBytes Canonicalize_S3ChooseTwoCard_ProducesThePinnedBytes \
         Canonicalize_IsStable_AfterPgSpacedRoundTrip Canonicalize_DefaultsShuffleTrue_AndNullQualifier \
         Canonicalize_SkipsStemChecks_WhenQuestionIsNull Canonicalize_DropsUnknownKeys \
         Canonicalize_LeavesApostrophesAndNonAsciiUnescaped Canonicalize_RejectsEveryCode \
         IsMcqDifficulty_AcceptsOneToThreeOnly McqValidationError_CarriesTheCode_AndIsNotAValidationError; do
  grep -Fq "$s(" "$MVT" || fail "McqValidationTests.cs: missing test $s"
done
for code in $CANON_CODES; do
  grep -Fq "\"$code\"" "$MVT" || fail "McqValidationTests.cs: no rejection row for \"$code\""
done
[ "$(fcount '"MCQ_CHOOSE_N_MISMATCH"' "$MVT")" -ge 2 ] || fail "McqValidationTests.cs: MCQ_CHOOSE_N_MISMATCH needs two rows (marker without two correct; two correct without marker)"

# 2f. CardsAuthoringMcqTests.cs — DB collection, direct handler calls, the thirteen cases, object-not-string assertions, the PG-spacing probe
grep -Fq '[Collection(PostgresCollection.Name)]' "$MAT" || fail "CardsAuthoringMcqTests.cs must join the postgres collection"
grep -Fq 'public class CardsAuthoringMcqTests' "$MAT" || fail "CardsAuthoringMcqTests.cs: class name"
for sym in 'PostgresFixture' 'Cards.HandleAuthoringCards(' 'Auth.GetAuthContext(req)' 'new Res(req.TraceId)' 'super_admin' \
           'JsonValueKind.Object' 'JsonValueKind.Null' 'mcq::text' 'DeepEquals(' 'Guid.NewGuid():N' \
           '"MCQ_EXPLANATION_REQUIRED"' '"MCQ_DIFFICULTY_RANGE"' '"MCQ_TOO_FEW_OPTIONS"' '"MCQ_QUALIFIER_NOT_IN_STEM"' \
           '"MCQ_CHOOSE_N_MISMATCH"' '"VERSION_CONFLICT"'; do
  grep -Fq "$sym" "$MAT" || fail "CardsAuthoringMcqTests.cs lacks: $sym"
done
has_literal_either '"v": 1' '\"v\": 1' "$MAT" || fail "CardsAuthoringMcqTests.cs: the raw-DB PG-spacing probe (\"v\": 1) is missing"
for s in Post_WithMcq_EchoesMcqAsObject_InPgKeyOrder Get_ReturnsMcqAsObject_ForEveryReader Post_QaCard_ReturnsMcqNull \
         Post_McqWithoutExplanation_IsRejected Post_McqDifficultyOutOfRange_IsRejected Post_InvalidBlob_ReturnsTheMcqCode \
         Put_McqNull_ClearsTheColumn Put_WithoutMcq_LeavesItIntact Put_ReplacesTheBlob_AndEchoesObject \
         Put_BlankExplanationOrBadDifficulty_OnMcqCard_IsRejected Put_QuestionChange_ReChecksTheStoredStem \
         Put_McqOntoQaCard_RequiresExplanation Put_StaleVersion_StillReportsVersionConflict; do
  grep -Fq "$s(" "$MAT" || fail "CardsAuthoringMcqTests.cs: missing test $s"
done
[ "$(count '^[[:space:]]*\[Fact\]' "$MAT")" -ge 13 ] || fail "CardsAuthoringMcqTests.cs needs >= 13 [Fact] cases"

# 2g. suppression / gutting / dump-content guard across every scope file
if grep -Eq 'Skip[[:space:]]*=|#pragma warning disable|\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable' \
     "$MIG" "$MCQV" "$CARDS" "$HELPERS" "$MVT" "$MAT"; then
  grep -En 'Skip[[:space:]]*=|#pragma warning disable|\.skip\(|\.only\(|@ts-ignore|@ts-expect-error|eslint-disable' \
     "$MIG" "$MCQV" "$CARDS" "$HELPERS" "$MVT" "$MAT" >&2 || true
  fail "test gutting / suppression found"
fi
if grep -Eiq 'examtopics|saa-c03 dump' "$MIG" "$MCQV" "$CARDS" "$HELPERS" "$MVT" "$MAT"; then
  grep -Ein 'examtopics|saa-c03 dump' "$MIG" "$MCQV" "$CARDS" "$HELPERS" "$MVT" "$MAT" >&2 || true
  fail "exam-dump reference found — the only MCQ prose allowed is the two §4.3 cards"
fi

# ── 3. dotnet build (implicit cached restore; no network) ──────────────────
echo "[3/5] dotnet build Tests/RecallSmith.Lambda.IntegrationTests"
( cd src_C && dotnet build Tests/RecallSmith.Lambda.IntegrationTests -c Debug --nologo ) || fail "dotnet build failed"
[ -f "$TESTDIR/bin/Debug/net8.0/Db/Migrations/019_cards_mcq.sql" ] || fail "019_cards_mcq.sql did not reach the test bin (Vpc csproj None include)"
[ -f "$TESTDIR/bin/Debug/net8.0/Db/Migrations/018_cards_topic.sql" ] || fail "018_cards_topic.sql did not reach the test bin"

# ── 4. Targeted xunit: 4a pure (no Docker), 4b DB (Docker required) ───────
passed_count() { printf '%s\n' "$1" | grep -Eo 'Passed: *[0-9]+' | head -1 | grep -Eo '[0-9]+' || echo 0; }
run_filter() {  # $1 = filter, $2 = min passed, $3 = label
  local out
  out="$( cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests -c Debug --no-build --nologo --filter "$1" 2>&1 )" \
    || { printf '%s\n' "$out" | tail -60 >&2; fail "$3 failed"; }
  printf '%s\n' "$out" | grep -q 'No test matches' && fail "$3: the filter matched no tests"
  printf '%s\n' "$out" | grep -Eq 'Skipped: *[1-9]' && fail "$3: skipped tests are not allowed"
  local n; n="$(passed_count "$out")"
  [ "$n" -ge "$2" ] || fail "$3: expected >= $2 passing tests, saw $n"
  echo "    $3: $n passed"
}
echo "[4/5] dotnet test --filter McqValidationTests (pure) then CardsAuthoringMcqTests (Docker)"
run_filter "FullyQualifiedName~McqValidationTests" 30 "McqValidationTests"
docker info >/dev/null 2>&1 || fail "Docker daemon is not running — CardsAuthoringMcqTests needs Testcontainers postgres:16-alpine"
run_filter "FullyQualifiedName~CardsAuthoringMcqTests" 13 "CardsAuthoringMcqTests"

# ── 5. Scope + frozen-file guard (purely negative; passes on base) ─────────
echo "[5/5] scope + frozen guard"
mb="$(git merge-base HEAD "$BASE_REF" 2>/dev/null || git merge-base HEAD "origin/$BASE_REF" 2>/dev/null)" \
  || fail "cannot resolve base ref $BASE_REF (set BASE_REF / BASE); refusing to diff the tree against itself"
frozen="$(git diff --numstat "$mb" -- mobile/src/content/deckRepository.ts mobile/src/sync/progressSync.ts mobile/src/review/model.ts \
  mobile/package.json mobile/package-lock.json mobile/app.json mobile/eas.json mobile/src mobile/tests \
  frontend/src frontend/tests snowflake src_C/Shared src_C/Common src_C/Public src_C/Worker src_C/Vpc/Runtime \
  src_C/Vpc/Db/Migrate.cs "$MIG_TOPIC" src_C/Vpc/Authoring/CardsPage.cs src_C/Vpc/Authoring/Publish.cs \
  src_C/Vpc/Authoring/Decks.cs src_C/Vpc/Authoring/ContentIntelligence.cs src_C/Vpc/VpcFunction.cs \
  "$TESTDIR/IntegrationTestBase.cs" "$TESTDIR/CardsPageTests.cs" "$TESTDIR/CardsAuthoringTopicTests.cs" \
  "$TESTDIR/ContentSerializationContractTests.cs" "$TESTDIR/DeckDiffTests.cs" "$TESTDIR/ProgressEventsSingleStatementTests.cs" \
  ':(glob)src_C/**/*.csproj' ':(glob)src_C/*.sln' ':(glob)docs/*.md')"
[ -z "$frozen" ] || { echo "$frozen" >&2; fail "frozen/out-of-scope file modified"; }
# Untracked scan is pathspec-scoped, never bare: the driver symlinks mobile/node_modules and
# frontend/node_modules into the worktree and the `node_modules/` ignore rule does not match a symlink.
outside="$( { git diff --name-only "$mb"; git ls-files --others --exclude-standard -- src_C/Vpc src_C/Worker src_C/Tests src_C/Shared src_C/Common src_C/Public mobile/src mobile/tests frontend/src frontend/tests snowflake docs; } | sort -u | grep -Ev '^(src_C/Vpc/Db/Migrations/019_cards_mcq\.sql|src_C/Vpc/Authoring/McqValidation\.cs|src_C/Vpc/Authoring/Cards\.cs|src_C/Vpc/Authoring/Helpers\.cs|src_C/Tests/RecallSmith\.Lambda\.IntegrationTests/McqValidationTests\.cs|src_C/Tests/RecallSmith\.Lambda\.IntegrationTests/CardsAuthoringMcqTests\.cs|docs/delivery/r16-issues/.*)$' || true )"
[ -z "$outside" ] || { echo "$outside" >&2; fail "files changed outside C08 scope"; }

echo "C08 VERIFY OK"
