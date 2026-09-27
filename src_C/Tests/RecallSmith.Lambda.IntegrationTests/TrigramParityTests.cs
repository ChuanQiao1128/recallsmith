using System.Text;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Trigram.Similarity against the real pg_trgm similarity() of the shared test database (migration 029
/// installs the extension there, because the container user is a superuser). The in-process engine is only
/// worth having if switching engines changes speed and never results, so every case compares the two.
/// </summary>
[Collection(PostgresCollection.Name)]
public class TrigramParityTests
{
  private readonly PostgresFixture _db;

  public TrigramParityTests(PostgresFixture db) => _db = db;

  private async Task<float> PgSimilarityAsync(string a, string b)
  {
    var v = await _db.ScalarAsync("select similarity($1, $2)", a, b);
    return Assert.IsType<float>(v);
  }

  [Fact]
  public async Task Similarity_WordVsTwoWords_IsFourElevenths()
  {
    var local = Trigram.Similarity("word", "two words");
    Assert.Equal(4f / 11f, local);
    Assert.Equal(await PgSimilarityAsync("word", "two words"), local);
  }

  [Fact]
  public void Trigrams_PadEachWordAndDeduplicate()
  {
    Assert.True(Trigram.Trigrams("Cat cat").SetEquals(new[] { "  c", " ca", "cat", "at " }));

    var expected = new[]
    {
      "  a", "  c", "  r", "  s", " a ", " cr", " re", " s3", "cro", "egi", "gio", "ion", "on ", "oss", "reg", "ros", "s3 ", "ss ",
    };
    var actual = Trigram.Trigrams("Cross-Region_S3 a");
    Assert.Equal(18, actual.Count);
    Assert.True(actual.SetEquals(expected), string.Join(",", actual.OrderBy(t => t, StringComparer.Ordinal)));
  }

  [Fact]
  public async Task Similarity_NoWordCharacters_IsZero()
  {
    Assert.Equal(0f, Trigram.Similarity("", "abc"));
    Assert.Equal(0f, Trigram.Similarity("!!!", "abc"));
    Assert.Equal(0f, Trigram.Similarity(null, "abc"));
    Assert.Empty(Trigram.Trigrams(null));

    Assert.Equal(0f, await PgSimilarityAsync("", "abc"));
    Assert.Equal(0f, await PgSimilarityAsync("!!!", "abc"));
  }

  private static readonly string[] Vocabulary =
  [
    "glacier", "restore", "tier", "bucket", "lambda", "queue", "dead", "letter", "stream", "shard",
    "vpc", "subnet", "route", "table", "cache", "redis", "index", "partition", "key", "retry",
    "timeout", "async", "await", "task", "thread", "lock", "json", "schema", "deploy", "region",
    "zone", "replica", "snapshot", "cold", "start", "alpha", "beta", "gamma", "s3", "ec2",
  ];

  private const string Separators = " -_.,?/()";

  public static IEnumerable<object[]> GeneratedPairs()
  {
    for (var seed = 1; seed <= 64; seed++)
    {
      var rng = new Random(seed);
      var aWords = Words(rng, null);
      var a = Join(rng, aWords);
      // Roughly half the pairs share words, so the cases cover the whole 0..1 range rather than clustering near 0.
      var b = Join(rng, Words(rng, rng.Next(2) == 0 ? aWords : null));
      yield return new object[] { seed, a, b };
    }
  }

  private static List<string> Words(Random rng, List<string>? shareFrom)
  {
    var count = rng.Next(1, 9);
    var words = new List<string>(count);
    for (var i = 0; i < count; i++)
    {
      string word;
      if (shareFrom is not null && rng.Next(3) > 0) word = shareFrom[rng.Next(shareFrom.Count)];
      else word = Vocabulary[rng.Next(Vocabulary.Length)];

      if (rng.Next(4) == 0) word += rng.Next(0, 100).ToString(System.Globalization.CultureInfo.InvariantCulture);

      var cased = new StringBuilder(word.Length);
      foreach (var ch in word) cased.Append(rng.Next(3) == 0 ? char.ToUpperInvariant(ch) : ch);
      words.Add(cased.ToString());
    }
    return words;
  }

  private static string Join(Random rng, List<string> words)
  {
    var sb = new StringBuilder();
    for (var i = 0; i < words.Count; i++)
    {
      if (i > 0)
      {
        var n = rng.Next(1, 3);
        for (var k = 0; k < n; k++) sb.Append(Separators[rng.Next(Separators.Length)]);
      }
      sb.Append(words[i]);
    }
    if (rng.Next(4) == 0) sb.Append('?');
    return sb.ToString();
  }

  [Theory]
  [MemberData(nameof(GeneratedPairs))]
  public async Task Similarity_MatchesPgTrgm(int seed, string a, string b)
  {
    var pgValue = await PgSimilarityAsync(a, b);
    var local = Trigram.Similarity(a, b);
    Assert.True(pgValue == local, $"seed {seed}: pg {pgValue:R} vs local {local:R} for '{a}' / '{b}'");
    Assert.Equal((double)pgValue, (double)local, 6);
  }
}
