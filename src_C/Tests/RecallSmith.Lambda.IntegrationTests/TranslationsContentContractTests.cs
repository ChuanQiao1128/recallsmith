using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Qa;
using RecallSmith.Lambda.Worker.Content;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// cards.translations in the Worker's build files and the publish bindings (card translations contract §4): omitted when
/// null so every existing deck builds byte-identically, appended as the last key after topic, mcq and source otherwise,
/// compared structurally by DeckDiff (PG text vs compact deck.json) and carried through the previous-build mapping so a
/// translated card does not re-diff as updated on every publish. The publish snapshot digest and the AI QA content hash
/// take translations only when a card has some, so an untranslated card digests and hashes exactly as before. Pure: no
/// database.
/// </summary>
public class TranslationsContentContractTests
{
  private const string CardJson =
    """{"stableUid":"u1","orderInDeck":1,"difficulty":2,"question":"q","explanation":"e","codeLanguage":"csharp","codeSnippet":"c","realWorldUsage":"r","revision":1}""";

  private const string McqPgText =
    """{"v": 1, "options": [{"key": "a", "why": null, "text": "queue", "correct": true}, {"key": "b", "why": "no buffer", "text": "resize", "correct": false}, {"key": "c", "why": "one shard", "text": "stream", "correct": false}], "shuffle": true, "qualifier": null}""";

  private const string McqJson =
    """{"v":1,"options":[{"key":"a","why":null,"text":"queue","correct":true},{"key":"b","why":"no buffer","text":"resize","correct":false},{"key":"c","why":"one shard","text":"stream","correct":false}],"shuffle":true,"qualifier":null}""";

  private const string SourceJson = """{"url":"https://docs.aws.amazon.com/x","quote":null}""";

  // What DbUtil hands back for stored translations (PG jsonb text) and the compact form deck.json carries. deck.json
  // keeps the default encoder, so Chinese is \u-escaped there exactly as in the existing zh-CN deck.
  private const string TranslationsPgText =
    """{"zh-CN": {"v": 1, "mcq": {"options": {"a": {"why": null, "text": "队列"}, "b": {"why": "没有缓冲", "text": "扩容"}, "c": {"why": "单分片", "text": "流"}}, "qualifier": null}, "question": "哪种服务能缓冲突发流量？", "explanation": "放进队列。"}}""";

  private const string TranslationsJson =
    """{"zh-CN":{"v":1,"mcq":{"options":{"a":{"why":null,"text":"\u961F\u5217"},"b":{"why":"\u6CA1\u6709\u7F13\u51B2","text":"\u6269\u5BB9"},"c":{"why":"\u5355\u5206\u7247","text":"\u6D41"}},"qualifier":null},"question":"\u54EA\u79CD\u670D\u52A1\u80FD\u7F13\u51B2\u7A81\u53D1\u6D41\u91CF\uFF1F","explanation":"\u653E\u8FDB\u961F\u5217\u3002"}}""";

  private const string TranslationsWhyChanged =
    """{"zh-CN": {"v": 1, "mcq": {"options": {"a": {"why": null, "text": "队列"}, "b": {"why": "无法缓冲突发", "text": "扩容"}, "c": {"why": "单分片", "text": "流"}}, "qualifier": null}, "question": "哪种服务能缓冲突发流量？", "explanation": "放进队列。"}}""";

  private static CardExportData MakeCard(string uid = "u1") => new()
  {
    StableUid = uid,
    OrderInDeck = 1,
    Difficulty = 2,
    Question = "q",
    Explanation = "e",
    CodeLanguage = "csharp",
    CodeSnippet = "c",
    RealWorldUsage = "r",
    Revision = 1,
  };

  private static JsonElement Json(string json) => JsonSerializer.Deserialize<JsonElement>(json);

  // ---------------------------------------------------------------- deck.json bytes

  [Fact]
  public void Card_NullTranslations_KeepsGoldenBytes()
  {
    var card = MakeCard();
    Assert.Null(card.Translations);

    Assert.Equal(CardJson, ContentJson.Serialize(card));

    var deck = new DeckExportData { Slug = "s", Title = "T", DeckType = 1, Version = "b1", TotalCards = 1, Cards = new List<CardExportData> { card } };
    Assert.Equal("""{"slug":"s","title":"T","locale":"en-US","deckType":1,"version":"b1","totalCards":1,"cards":[""" + CardJson + "]}",
      ContentJson.Serialize(deck));

    var chunk = new DeckChunkModel { SchemaVersion = 1, Slug = "s", Version = "to-2", Seq = 0, Cards = new List<CardExportData> { card } };
    Assert.DoesNotContain("\"translations\"", ContentJson.Serialize(chunk), StringComparison.Ordinal);

    var delta = new DeckDeltaModel
    {
      SchemaVersion = 2,
      Slug = "s",
      FromVersion = "from-1",
      ToVersion = "to-2",
      GeneratedAtMs = 1,
      Added = new List<CardExportData> { card },
      Updated = new List<CardExportData> { card },
    };
    Assert.DoesNotContain("\"translations\"", ContentJson.Serialize(delta), StringComparison.Ordinal);
  }

  [Fact]
  public void Card_WithTopicMcqSourceAndTranslations_AppendsTranslationsLast()
  {
    var card = MakeCard();
    card.Topic = "t";
    card.Mcq = Json(McqPgText);
    card.Source = Json(SourceJson);
    card.Translations = Json(TranslationsPgText);

    Assert.Equal(
      CardJson[..^1] + ",\"topic\":\"t\",\"mcq\":" + McqJson + ",\"source\":" + SourceJson + ",\"translations\":" + TranslationsJson + "}",
      ContentJson.Serialize(card));
  }

  [Fact]
  public void Card_WithTranslationsOnly_AppendsTranslationsLast_AndRoundTrips()
  {
    var card = MakeCard();
    card.Translations = Json(TranslationsPgText);
    var expected = CardJson[..^1] + ",\"translations\":" + TranslationsJson + "}";

    Assert.Equal(expected, ContentJson.Serialize(card));

    // The previous-build read path: deck.json bytes -> JsonElement -> DeckDiff.
    var roundTripped = JsonSerializer.Deserialize<CardExportData>(expected, ContentJson.Options)!;
    Assert.Equal(expected, ContentJson.Serialize(roundTripped));
    Assert.Equal("哪种服务能缓冲突发流量？", roundTripped.Translations!.Value.GetProperty("zh-CN").GetProperty("question").GetString());
  }

  // ---------------------------------------------------------------- DeckDiff

  [Fact]
  public void DeckDiff_TranslationOnlyChange_IsUpdated()
  {
    var prev = MakeCard();
    prev.Translations = Json(TranslationsJson);
    var next = MakeCard();
    next.Translations = Json(TranslationsWhyChanged);

    var diff = DeckDiff.Compute(new[] { prev }, new[] { next });
    Assert.Empty(diff.Added);
    Assert.Empty(diff.Deleted);
    var updated = Assert.Single(diff.Updated);
    Assert.Equal("u1", updated.StableUid);
    // Same revision: a translation-only change is shipped in the patch without re-pushing the card as "updated".
    Assert.Equal(prev.Revision, updated.Revision);

    // Adding or removing translations is a change too.
    Assert.Single(DeckDiff.Compute(new[] { MakeCard() }, new[] { next }).Updated);
    Assert.Single(DeckDiff.Compute(new[] { prev }, new[] { MakeCard() }).Updated);
  }

  [Fact]
  public void DeckDiff_SameTranslationsDifferentSpacing_IsUnchanged()
  {
    var prev = MakeCard();
    prev.Translations = Json(TranslationsJson);
    var next = MakeCard();
    next.Translations = Json(TranslationsPgText);

    var diff = DeckDiff.Compute(new[] { prev }, new[] { next });
    Assert.Empty(diff.Added);
    Assert.Empty(diff.Updated);
    Assert.Empty(diff.Deleted);
  }

  private sealed class FakeUploader : IS3DeckUploader
  {
    private readonly string _previousDeckJson;
    public readonly Dictionary<string, string> Uploaded = new(StringComparer.Ordinal);

    public FakeUploader(string previousDeckJson) => _previousDeckJson = previousDeckJson;

    public Task<S3UploadResult> UploadAsync(string s3Key, DeckExportData data) => Task.FromResult(new S3UploadResult());

    public Task<S3UploadResult> UploadJsonAsync(string s3Key, string json, string cacheControl)
    {
      Uploaded[s3Key] = json;
      return Task.FromResult(new S3UploadResult { Sha256 = "sha", Bytes = json.Length });
    }

    public Task<string> DownloadJsonAsync(string s3Key) => Task.FromResult(_previousDeckJson);
  }

  private sealed class FakeRepository : IContentArtifactsRepository
  {
    private readonly PreviousBuildInfo _previous;
    public FakeRepository(PreviousBuildInfo previous) => _previous = previous;

    public Task<PreviousBuildInfo?> GetLatestSuccessBuildAsync(long deckId) => Task.FromResult<PreviousBuildInfo?>(_previous);
    public Task UpdateContentMetadataAsync(string jobId, string contentSha256, long contentBytes, string? packageKey) => Task.CompletedTask;
    public Task InsertBuildPatchAsync(string deckSlug, string fromBuildId, string toBuildId, string relPath, string s3Key, string sha256, long bytes) =>
      Task.CompletedTask;
  }

  /// <summary>Generates the patch from a previous deck.json holding <paramref name="previous"/> to <paramref name="next"/> read from PG.</summary>
  private static async Task<JsonDocument> PatchAsync(string slug, CardExportData previous, CardExportData next)
  {
    const string prevBuild = "b-prev";
    const string nextBuild = "b-next";

    // The previous build's deck.json as the Worker wrote it: compact, via ContentJson.
    var prevDeck = new DeckExportData { Slug = slug, Title = "T", DeckType = 1, TotalCards = 1, Cards = new List<CardExportData> { previous } };
    var uploader = new FakeUploader(ContentJson.Serialize(prevDeck));
    var repository = new FakeRepository(new PreviousBuildInfo
    {
      BuildId = prevBuild,
      S3Key = $"content/decks/{slug}/builds/{prevBuild}/deck.json",
    });
    var job = new JobInfo
    {
      JobId = $"job-{slug}",
      BuildId = nextBuild,
      S3Key = $"content/decks/{slug}/builds/{nextBuild}/deck.json",
      DeckId = 1,
      DeckSlug = slug,
      Status = "PROCESSING",
    };
    var deckData = new DeckExportData { Slug = slug, Title = "T", DeckType = 1, TotalCards = 1, Cards = new List<CardExportData> { next } };

    await new ContentArtifactsGenerator(uploader, repository).GenerateAsync(job, deckData, new S3UploadResult { Bytes = 1_000_000 });

    var patchKey = $"content/decks/{slug}/patches/{prevBuild}-{nextBuild}.json";
    Assert.True(uploader.Uploaded.ContainsKey(patchKey), $"no patch uploaded; keys: {string.Join(", ", uploader.Uploaded.Keys)}");
    return JsonDocument.Parse(uploader.Uploaded[patchKey]);
  }

  [Fact]
  public async Task PreviousDeckMapping_KeepsTranslations()
  {
    var prevCard = MakeCard();
    prevCard.Translations = Json(TranslationsJson);
    var nextCard = MakeCard();
    nextCard.Translations = Json(TranslationsPgText);

    using var patch = await PatchAsync("tr-same", prevCard, nextCard);
    Assert.Equal(0, patch.RootElement.GetProperty("updated").GetArrayLength());
    Assert.Equal(0, patch.RootElement.GetProperty("added").GetArrayLength());
    Assert.Equal(0, patch.RootElement.GetProperty("deleted").GetArrayLength());
  }

  [Fact]
  public async Task Patch_CarriesAChangedTranslation_InTheUpdatedCard()
  {
    var prevCard = MakeCard();
    prevCard.Translations = Json(TranslationsJson);
    var nextCard = MakeCard();
    nextCard.Translations = Json(TranslationsWhyChanged);

    using var patch = await PatchAsync("tr-changed", prevCard, nextCard);
    var updated = Assert.Single(patch.RootElement.GetProperty("updated").EnumerateArray());
    Assert.Equal("无法缓冲突发",
      updated.GetProperty("translations").GetProperty("zh-CN").GetProperty("mcq").GetProperty("options").GetProperty("b").GetProperty("why").GetString());
  }

  // ---------------------------------------------------------------- publish snapshot digest

  /// <summary>The digest formula from before migration 047: twelve fields per card, nothing else.</summary>
  private static string LegacyDigest(IEnumerable<PublishSnapshotCard> cards)
  {
    var payload = cards.Select(c => new object[]
    {
      c.StableUid ?? string.Empty, c.OrderInDeck, c.Difficulty ?? 2, c.Question ?? string.Empty, c.Explanation ?? string.Empty,
      c.CodeLanguage ?? string.Empty, c.CodeSnippet ?? string.Empty, c.RealWorldUsage ?? string.Empty, c.Revision ?? 1,
      c.Topic ?? string.Empty, c.McqJson ?? string.Empty, c.SourceJson ?? string.Empty,
    }).ToList();
    return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload)))).ToLowerInvariant();
  }

  private static PublishSnapshotCard SnapshotCard(string uid, string? translations = null) =>
    new(uid, 1, 2, "q", "e", "csharp", "c", "r", 1, "t", McqPgText, SourceJson, translations);

  [Fact]
  public void Digest_UntranslatedCards_DigestAsBeforeMigration047()
  {
    var cards = new[] { SnapshotCard("a"), SnapshotCard("b") };
    Assert.Equal(LegacyDigest(cards), PublishSnapshot.Digest(cards));

    // The positional constructor without the new argument is the same card.
    var legacyShape = new PublishSnapshotCard("a", 1, 2, "q", "e", "csharp", "c", "r", 1, "t", McqPgText, SourceJson);
    Assert.Equal(PublishSnapshot.Digest([SnapshotCard("a")]), PublishSnapshot.Digest([legacyShape]));
  }

  [Fact]
  public void Digest_TranslatedCard_BindsTheTranslations()
  {
    var plain = PublishSnapshot.Digest([SnapshotCard("a")]);
    var translated = PublishSnapshot.Digest([SnapshotCard("a", TranslationsPgText)]);

    Assert.NotEqual(plain, translated);
    Assert.NotEqual(translated, PublishSnapshot.Digest([SnapshotCard("a", TranslationsWhyChanged)]));
  }

  [Fact]
  public void FromRow_KeepsNullTranslationsNull()
  {
    var row = new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["stableUid"] = "a", ["orderInDeck"] = 1, ["question"] = "q", ["translations"] = null,
    };
    Assert.Null(PublishSnapshot.FromRow(row).TranslationsJson);

    row.Remove("translations");
    Assert.Null(PublishSnapshot.FromRow(row).TranslationsJson);

    row["translations"] = TranslationsPgText;
    Assert.Equal(TranslationsPgText, PublishSnapshot.FromRow(row).TranslationsJson);
  }

  [Fact]
  public void WorkerDigest_EqualsTheCoreDigest_WithAndWithoutTranslations()
  {
    // core-vpc digests the PG text rows; the Worker digests the cards it parsed from the same PG text.
    Dictionary<string, object?> Row(string uid, string? translations) => new(StringComparer.Ordinal)
    {
      ["stableUid"] = uid, ["orderInDeck"] = 1, ["difficulty"] = 2, ["question"] = "q", ["explanation"] = "e",
      ["codeLanguage"] = "csharp", ["codeSnippet"] = "c", ["realWorldUsage"] = "r", ["revision"] = 1, ["topic"] = null,
      ["mcq"] = McqPgText, ["source"] = null, ["translations"] = translations,
    };
    CardExportData Card(string uid, string? translations)
    {
      var card = MakeCard(uid);
      card.Mcq = Json(McqPgText);
      card.Translations = translations is null ? null : Json(translations);
      return card;
    }

    var rows = new[] { Row("a", null), Row("b", TranslationsPgText) };
    var cards = new[] { Card("a", null), Card("b", TranslationsPgText) };
    Assert.Equal(PublishSnapshot.Digest(rows.Select(PublishSnapshot.FromRow)), PublishJobProcessor.SnapshotDigest(cards));
  }

  // ---------------------------------------------------------------- AI QA content hash

  [Fact]
  public void ContentHash_UntranslatedCard_KeepsTheGoldenVector()
  {
    // CardContentHashTests' golden plain-card vector, now with the column read back as null.
    var row = new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["question"] = "  What is S3?  ", ["explanation"] = "Object storage", ["difficulty"] = 2, ["translations"] = null,
    };
    Assert.Equal("5b3eb934a4850edb1b1c6f316764ca17b6611735532c162ec25657f2f685f3d7", CardContentHash.Compute(row));
  }

  [Fact]
  public void ContentHash_TranslatedCard_BindsTheTranslations_IndependentOfSpacing()
  {
    Dictionary<string, object?> Row(string? translations) => new(StringComparer.Ordinal)
    {
      ["question"] = "What is S3?", ["explanation"] = "Object storage", ["difficulty"] = 2, ["translations"] = translations,
    };

    var plain = CardContentHash.Compute(Row(null));
    var translated = CardContentHash.Compute(Row(TranslationsPgText));
    Assert.NotEqual(plain, translated);
    Assert.Equal(translated, CardContentHash.Compute(Row(JsonSerializer.Serialize(Json(TranslationsPgText)))));
    Assert.NotEqual(translated, CardContentHash.Compute(Row(TranslationsWhyChanged)));
  }
}
