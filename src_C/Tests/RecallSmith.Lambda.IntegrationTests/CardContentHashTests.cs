using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Qa;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The AI QA content hash (R18 J13, contract §7.3): the two golden vectors, a generated stability/sensitivity
/// property over 64 seeds, jsonb spacing independence and the database round trip (rows read back with
/// <see cref="CardContentHash.CardColumnsSql"/>). Card text is from content/decks/aws-saa-c03.md or plainly synthetic.
/// </summary>
[Collection(PostgresCollection.Name)]
public class CardContentHashTests
{
  private readonly PostgresFixture _db;
  public CardContentHashTests(PostgresFixture db) => _db = db;

  private static readonly Regex Hex64 = new("^[0-9a-f]{64}$", RegexOptions.CultureInvariant);

  private static Dictionary<string, object?> Row(params (string Key, object? Value)[] cells)
  {
    var row = new Dictionary<string, object?>(StringComparer.Ordinal);
    foreach (var (key, value) in cells) row[key] = value;
    return row;
  }

  [Fact]
  public void Compute_GoldenVector_PlainCard()
  {
    var row = Row(("question", "  What is S3?  "), ("explanation", "Object storage"), ("difficulty", 2));
    Assert.Equal("5b3eb934a4850edb1b1c6f316764ca17b6611735532c162ec25657f2f685f3d7", CardContentHash.Compute(row));
  }

  [Fact]
  public void Compute_GoldenVector_WithTopicAndSource()
  {
    var row = Row(
      ("question", "What is S3?"),
      ("explanation", "Object storage"),
      ("difficulty", 2),
      ("topic", "Storage"),
      ("mcq", null),
      ("source", """{"url": "https://docs.aws.amazon.com/s3/", "quote": "Amazon S3 is an object storage service"}"""));
    Assert.Equal("1c95ca6baf95b825c4928265a7c816d136ac0aff6eba9652c407b82596609d58", CardContentHash.Compute(row));
  }

  public static IEnumerable<object[]> Seeds() => Enumerable.Range(1, 64).Select(s => new object[] { s });

  private static string? MaybeText(Random rng, string prefix) =>
    rng.Next(4) switch
    {
      0 => null,
      1 => string.Empty,
      _ => $"{prefix} {rng.Next(1_000_000).ToString(CultureInfo.InvariantCulture)}",
    };

  private static Dictionary<string, object?> RandomRow(int seed)
  {
    var rng = new Random(seed);
    return Row(
      ("question", $"Synthetic question {seed.ToString(CultureInfo.InvariantCulture)} about {rng.Next(10_000).ToString(CultureInfo.InvariantCulture)}?"),
      ("explanation", MaybeText(rng, "Synthetic explanation")),
      ("codeSnippet", MaybeText(rng, "aws s3 ls s3://bucket-")),
      ("codeLanguage", MaybeText(rng, "bash")),
      ("realWorldUsage", MaybeText(rng, "Synthetic usage")),
      ("difficulty", rng.Next(1, 4)),
      ("topic", MaybeText(rng, "Topic")),
      ("mcq", rng.Next(2) == 0 ? null
        : $$"""{"v": 1, "options": [{"key": "a", "why": null, "text": "opt {{rng.Next(1000).ToString(CultureInfo.InvariantCulture)}}", "correct": true}], "shuffle": true, "qualifier": null}"""),
      ("source", rng.Next(2) == 0 ? null
        : $$"""{"url": "https://docs.aws.amazon.com/synthetic/{{rng.Next(1000).ToString(CultureInfo.InvariantCulture)}}", "quote": null}"""));
  }

  [Theory]
  [MemberData(nameof(Seeds))]
  public void Compute_IsStable_AndSensitiveToEveryField(int seed)
  {
    var row = RandomRow(seed);
    var hash = CardContentHash.Compute(row);
    Assert.Matches(Hex64, hash);

    Assert.Equal(hash, CardContentHash.Compute(new Dictionary<string, object?>(row, StringComparer.Ordinal)));

    var padded = new Dictionary<string, object?>(row, StringComparer.Ordinal);
    foreach (var key in new[] { "question", "explanation", "codeLanguage", "realWorldUsage" })
    {
      if (padded[key] is string s) padded[key] = $"  \t{s}\n ";
    }
    Assert.Equal(hash, CardContentHash.Compute(padded));

    var changes = new (string Key, object? Value)[]
    {
      ("question", $"{row["question"]} changed"),
      ("explanation", $"{row["explanation"]} changed"),
      ("codeSnippet", $"{row["codeSnippet"]}changed"),
      ("codeLanguage", $"{row["codeLanguage"]}changed"),
      ("realWorldUsage", $"{row["realWorldUsage"]} changed"),
      ("difficulty", (Convert.ToInt32(row["difficulty"], CultureInfo.InvariantCulture) % 3) + 1),
      ("topic", $"{row["topic"]} changed"),
      ("mcq", row["mcq"] is null
        ? """{"v": 1, "options": [], "shuffle": false, "qualifier": null}"""
        : ((string)row["mcq"]!).Replace("\"shuffle\": true", "\"shuffle\": false", StringComparison.Ordinal)),
      ("source", row["source"] is null
        ? """{"url": "https://docs.aws.amazon.com/other/", "quote": null}"""
        : ((string)row["source"]!).Replace("\"quote\": null", "\"quote\": \"changed\"", StringComparison.Ordinal)),
    };

    foreach (var (key, value) in changes)
    {
      var changed = new Dictionary<string, object?>(row, StringComparer.Ordinal) { [key] = value };
      Assert.True(CardContentHash.Compute(changed) != hash, $"seed {seed}: changing {key} did not change the hash");
    }
  }

  [Fact]
  public void Compute_JsonbSpacing_DoesNotChangeHash()
  {
    var spaced = Row(("question", "What is S3?"), ("source", """{"url": "u", "quote": null}"""));
    var compact = Row(("question", "What is S3?"), ("source", """{"url":"u","quote":null}"""));
    Assert.Equal(CardContentHash.Compute(spaced), CardContentHash.Compute(compact));

    using var doc = JsonDocument.Parse("""{"url":"u","quote":null}""");
    var element = Row(("question", "What is S3?"), ("source", doc.RootElement.Clone()));
    Assert.Equal(CardContentHash.Compute(spaced), CardContentHash.Compute(element));
  }

  [Fact]
  public async Task Compute_MatchesAfterDatabaseRoundTrip()
  {
    await using var conn = await _db.OpenAsync();
    var deckId = Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null,
      "insert into decks (slug, title, author) values ($1, $2, $3) returning id",
      [$"it-j13-hash-{Guid.NewGuid():N}", "deck j13 hash", "tests"]), CultureInfo.InvariantCulture);
    var cardId = Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null,
      """
      insert into cards (deck_id, stable_uid, question, explanation, code_snippet, code_language, difficulty, topic, order_in_deck, mcq, source)
      values ($1, $2, $3, $4, $5, $6, 2, $7, 1, $8::jsonb, $9::jsonb)
      returning id
      """,
      [deckId, $"it-j13-hash-{Guid.NewGuid():N}", "Which service buffers a burst", "  A queue absorbs the burst.  ",
       "aws sqs send-message --queue-url $URL", "bash", "Messaging",
       """{"v":1,"options":[{"key":"a","why":null,"text":"queue","correct":true},{"key":"b","why":"no buffer","text":"resize","correct":false},{"key":"c","why":"one shard","text":"stream","correct":false}],"shuffle":true,"qualifier":null}""",
       """{"url":"https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html","quote":"Synthetic quote about buffering."}"""]),
      CultureInfo.InvariantCulture);

    var sql = $"select {CardContentHash.CardColumnsSql} from cards c where c.id = $1";
    var first = CardContentHash.Compute((await DbUtil.QueryAsync(conn, null, sql, [cardId]))[0]);
    var second = CardContentHash.Compute((await DbUtil.QueryAsync(conn, null, sql, [cardId]))[0]);
    await DbUtil.ExecuteAsync(conn, null, "update cards set question = question where id = $1", [cardId]);
    var third = CardContentHash.Compute((await DbUtil.QueryAsync(conn, null, sql, [cardId]))[0]);

    Assert.Matches(Hex64, first);
    Assert.Equal(first, second);
    Assert.Equal(first, third);
  }
}
