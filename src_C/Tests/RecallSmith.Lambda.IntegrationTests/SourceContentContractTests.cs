using System.Text.Json;
using RecallSmith.Lambda.Worker.Content;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// cards.source in the Worker's build files (J01): omitted when null so every existing deck builds
/// byte-identically, appended as the last key after topic and mcq otherwise, compared structurally
/// by DeckDiff (PG text vs compact deck.json), and carried through the previous-build mapping so a
/// sourced card does not re-diff as updated on every publish. Pure: no database.
/// </summary>
public class SourceContentContractTests
{
  private const string CardJson =
    """{"stableUid":"u1","orderInDeck":1,"difficulty":2,"question":"q","explanation":"e","codeLanguage":"csharp","codeSnippet":"c","realWorldUsage":"r","revision":1}""";

  private const string McqPgText =
    """{"v": 1, "options": [{"key": "a", "why": null, "text": "queue", "correct": true}, {"key": "b", "why": "no buffer", "text": "resize", "correct": false}, {"key": "c", "why": "one shard", "text": "stream", "correct": false}], "shuffle": true, "qualifier": null}""";

  private const string McqJson =
    """{"v":1,"options":[{"key":"a","why":null,"text":"queue","correct":true},{"key":"b","why":"no buffer","text":"resize","correct":false},{"key":"c","why":"one shard","text":"stream","correct":false}],"shuffle":true,"qualifier":null}""";

  // What DbUtil hands back for a stored source (PG jsonb text) and what ContentJson emits for it.
  private const string SourcePgText = """{"url": "https://docs.aws.amazon.com/x", "quote": null}""";
  private const string SourceJson = """{"url":"https://docs.aws.amazon.com/x","quote":null}""";

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

  [Fact]
  public void Card_NullSource_KeepsGoldenBytes()
  {
    var card = MakeCard();
    Assert.Null(card.Topic);
    Assert.Null(card.Mcq);
    Assert.Null(card.Source);

    Assert.Equal(CardJson, ContentJson.Serialize(card));

    var chunk = new DeckChunkModel { SchemaVersion = 1, Slug = "s", Version = "to-2", Seq = 0, Cards = new List<CardExportData> { card } };
    Assert.DoesNotContain("\"source\"", ContentJson.Serialize(chunk), StringComparison.Ordinal);

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
    Assert.DoesNotContain("\"source\"", ContentJson.Serialize(delta), StringComparison.Ordinal);
  }

  [Fact]
  public void Card_WithTopicMcqAndSource_AppendsSourceLast()
  {
    var card = MakeCard();
    card.Topic = "t";
    card.Mcq = Json(McqPgText);
    card.Source = Json(SourcePgText);

    Assert.Equal(
      CardJson[..^1] + ",\"topic\":\"t\",\"mcq\":" + McqJson + ",\"source\":{\"url\":\"https://docs.aws.amazon.com/x\",\"quote\":null}}",
      ContentJson.Serialize(card));
  }

  [Fact]
  public void Card_WithSourceOnly_AppendsSourceLast()
  {
    var card = MakeCard();
    card.Source = Json("""{"url": "https://docs.aws.amazon.com/x", "quote": "line one\nline two"}""");

    Assert.Equal(
      CardJson[..^1] + ",\"source\":{\"url\":\"https://docs.aws.amazon.com/x\",\"quote\":\"line one\\nline two\"}}",
      ContentJson.Serialize(card));
  }

  [Fact]
  public void Card_WithSource_RoundTripsThroughContentJson()
  {
    var card = MakeCard();
    card.Topic = "t";
    card.Mcq = Json(McqPgText);
    card.Source = Json(SourcePgText);
    var expected = CardJson[..^1] + ",\"topic\":\"t\",\"mcq\":" + McqJson + ",\"source\":" + SourceJson + "}";

    var roundTripped = JsonSerializer.Deserialize<CardExportData>(expected, ContentJson.Options)!;

    Assert.Equal(expected, ContentJson.Serialize(roundTripped));
    Assert.Equal(JsonValueKind.Object, roundTripped.Source!.Value.ValueKind);
  }

  [Fact]
  public void DeckDiff_SourceOnlyChange_IsUpdated()
  {
    var prev = MakeCard();
    prev.Source = Json(SourceJson);
    var next = MakeCard();
    next.Source = Json("""{"url": "https://docs.aws.amazon.com/x", "quote": "new quote"}""");

    var diff = DeckDiff.Compute(new[] { prev }, new[] { next });
    Assert.Empty(diff.Added);
    Assert.Empty(diff.Deleted);
    Assert.Equal("u1", Assert.Single(diff.Updated).StableUid);

    // Adding or removing a source is a change too.
    Assert.Single(DeckDiff.Compute(new[] { MakeCard() }, new[] { next }).Updated);
    Assert.Single(DeckDiff.Compute(new[] { prev }, new[] { MakeCard() }).Updated);
  }

  [Fact]
  public void DeckDiff_SameSourceDifferentSpacing_IsUnchanged()
  {
    var prev = MakeCard();
    prev.Source = Json(SourceJson);
    var next = MakeCard();
    next.Source = Json(SourcePgText);

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

  [Fact]
  public async Task PreviousDeckMapping_KeepsSource()
  {
    const string slug = "j01-src";
    const string prevBuild = "b-prev";
    const string nextBuild = "b-next";

    // The previous build's deck.json as the Worker wrote it: compact source, via ContentJson.
    var prevCard = MakeCard();
    prevCard.Source = Json(SourceJson);
    var prevDeck = new DeckExportData { Slug = slug, Title = "T", DeckType = 1, TotalCards = 1, Cards = new List<CardExportData> { prevCard } };
    var prevDeckJson = ContentJson.Serialize(prevDeck);
    Assert.Contains("\"source\":" + SourceJson, prevDeckJson, StringComparison.Ordinal);

    // The current build reads the same card from PG: jsonb text spacing.
    var nextCard = MakeCard();
    nextCard.Source = Json(SourcePgText);
    var deckData = new DeckExportData { Slug = slug, Title = "T", DeckType = 1, TotalCards = 1, Cards = new List<CardExportData> { nextCard } };

    var uploader = new FakeUploader(prevDeckJson);
    var repository = new FakeRepository(new PreviousBuildInfo
    {
      BuildId = prevBuild,
      S3Key = $"content/decks/{slug}/builds/{prevBuild}/deck.json",
    });
    var job = new JobInfo
    {
      JobId = "job-j01",
      BuildId = nextBuild,
      S3Key = $"content/decks/{slug}/builds/{nextBuild}/deck.json",
      DeckId = 1,
      DeckSlug = slug,
      Status = "PROCESSING",
    };

    await new ContentArtifactsGenerator(uploader, repository).GenerateAsync(job, deckData, new S3UploadResult { Bytes = 1_000_000 });

    var patchKey = $"content/decks/{slug}/patches/{prevBuild}-{nextBuild}.json";
    Assert.True(uploader.Uploaded.ContainsKey(patchKey), $"no patch uploaded; keys: {string.Join(", ", uploader.Uploaded.Keys)}");

    using var patch = JsonDocument.Parse(uploader.Uploaded[patchKey]);
    Assert.Equal(0, patch.RootElement.GetProperty("updated").GetArrayLength());
    Assert.Equal(0, patch.RootElement.GetProperty("added").GetArrayLength());
    Assert.Equal(0, patch.RootElement.GetProperty("deleted").GetArrayLength());
  }
}
