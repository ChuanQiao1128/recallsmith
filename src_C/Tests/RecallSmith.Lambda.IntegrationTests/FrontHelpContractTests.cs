using System.Text.Json;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Qa;
using RecallSmith.Lambda.Worker.Content;
using RecallSmith.Lambda.Worker.Repositories;
using RecallSmith.Lambda.Worker.S3;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

public class FrontHelpContractTests
{
  internal const string Help = """[{"term":"VPC","definition":"An isolated virtual network"}]""";
  private static JsonElement Json(string value) => JsonSerializer.Deserialize<JsonElement>(value);
  private static TranslationValidation.EnglishCard English(string? help = null) => new("What is a VPC?", "A virtual network", null, null, help);

  [Theory]
  [InlineData("null")]
  [InlineData("[]")]
  public void EmptyHelp_PreservesLegacyBasisHashAndSnapshot(string empty)
  {
    Assert.Null(FrontHelpValidation.Canonicalize(Json(empty)));
    Assert.Equal(TranslationValidation.Basis(English()), TranslationValidation.Basis(English(empty)));
    var row = new Dictionary<string, object?> { ["question"] = "  What is S3?  ", ["explanation"] = "Object storage", ["difficulty"] = 2, ["frontHelp"] = empty };
    Assert.Equal("legacy-v1", CardContentHash.Schema(row));
    Assert.Equal("5b3eb934a4850edb1b1c6f316764ca17b6611735532c162ec25657f2f685f3d7", CardContentHash.Compute(row));
    var card = new PublishSnapshotCard("u", 1, 2, "q", "e", null, null, null, 1, null, null, null);
    Assert.Equal(PublishSnapshot.Digest([card]), PublishSnapshot.Digest([card with { FrontHelpJson = empty }]));
  }

  [Theory]
  [InlineData("null")]
  [InlineData("[]")]
  public void ShapeRow_EmptyHelpPreservesSourceOrderAndTranslationStatus(string empty)
  {
    const string translated = """{"zh-CN":{"v":1,"question":"什么是 VPC？","explanation":"虚拟网络"}}""";
    var english = English();
    var canonical = TranslationValidation.Canonicalize(Json(translated), english, "en-US")!;
    var basis = TranslationValidation.BasisJson(canonical, english);
    var row = new Dictionary<string, object?>
    {
      ["question"] = english.Question,
      ["explanation"] = english.Explanation,
      ["source"] = null,
      ["frontHelp"] = empty,
      ["translations"] = canonical,
      ["translationBasis"] = basis,
    };

    TranslationValidation.ShapeRow(row);

    Assert.Equal(["source", "translations", "translationStatus"], row.Keys.TakeLast(3).ToArray());
    Assert.False(row.ContainsKey("frontHelp"));
    Assert.False(row.ContainsKey("translationBasis"));
    Assert.Equal(english.Explanation, row["explanation"]);
    Assert.Equal("虚拟网络", Assert.IsType<JsonElement>(row["translations"]).GetProperty("zh-CN").GetProperty("explanation").GetString());
    Assert.Equal("ok", Assert.IsType<Dictionary<string, string>>(row["translationStatus"])["zh-CN"]);
    row["explanation"] = "An edited explanation";
    row["translationBasis"] = basis;
    TranslationValidation.ShapeRow(row);
    Assert.Equal("stale", Assert.IsType<Dictionary<string, string>>(row["translationStatus"])["zh-CN"]);
  }

  [Theory]
  [InlineData("null", false)]
  [InlineData("[]", false)]
  [InlineData(Help, true)]
  public void ShapeRow_LegacyRowWithoutTranslationsStillShapesHelp(string help, bool present)
  {
    var row = new Dictionary<string, object?> { ["question"] = "What is a VPC?", ["explanation"] = "A virtual network", ["frontHelp"] = help };

    TranslationValidation.ShapeRow(row);

    Assert.Equal(present, row.ContainsKey("frontHelp"));
    if (present) Assert.Equal("VPC", Assert.IsType<JsonElement>(row["frontHelp"])[0].GetProperty("term").GetString());
    Assert.Equal("A virtual network", row["explanation"]);
    Assert.False(row.ContainsKey("translations"));
    Assert.False(row.ContainsKey("translationStatus"));
  }

  [Theory]
  [InlineData("{}")]
  [InlineData("[null]")]
  [InlineData("[{\"term\":\"x\"}]")]
  [InlineData("[{\"term\":1,\"definition\":\"x\"}]")]
  [InlineData("[{\"term\":\" \",\"definition\":\"x\"}]")]
  [InlineData("[{\"term\":\"x\",\"definition\":null}]")]
  [InlineData("[{\"term\":\"x\",\"definition\":\"x\",\"extra\":1}]")]
  [InlineData("[{\"term\":\"x\",\"term\":\"y\",\"definition\":\"x\"}]")]
  [InlineData("[{\"term\":\"x\",\"definition\":\"x\"},{\"term\":\" X \",\"definition\":\"y\"}]")]
  [InlineData("[{\"term\":\"x\",\"definition\":\"x\"},{\"term\":\"y\",\"definition\":\"y\"},{\"term\":\"z\",\"definition\":\"z\"}]")]
  public void MalformedHelp_IsRejected(string value) =>
    Assert.Equal("FRONT_HELP_BAD_SHAPE", Assert.Throws<TranslationValidationError>(() => FrontHelpValidation.Canonicalize(Json(value))).Code);

  [Fact]
  public void Help_IsTrimmedAndLengthBounded()
  {
    Assert.Equal(Help, FrontHelpValidation.Canonicalize(Json("""[{"definition":" An isolated virtual network ","term":" VPC "}]""")));
    string Value(int termLength, int definitionLength) => JsonSerializer.Serialize(new[] { new { term = new string('x', termLength), definition = new string('y', definitionLength) } });
    Assert.Throws<TranslationValidationError>(() => FrontHelpValidation.Read(Json("""{"frontHelp":null,"frontHelp":[]}"""), out _));
    Assert.NotNull(FrontHelpValidation.Canonicalize(Json(Value(80, 240))));
    Assert.Throws<TranslationValidationError>(() => FrontHelpValidation.Canonicalize(Json(Value(81, 240))));
    Assert.Throws<TranslationValidationError>(() => FrontHelpValidation.Canonicalize(Json(Value(80, 241))));
  }

  [Fact]
  public void Translation_MirrorsHelpCountAndPreservesUnknownKeyGuard()
  {
    const string translated = """{"zh-CN":{"v":1,"question":"什么是 VPC？","frontHelp":[{"term":"VPC","definition":"隔离的虚拟网络"}],"explanation":"虚拟网络"}}""";
    var canonical = TranslationValidation.Canonicalize(Json(translated), English(Help), "en-US")!;
    Assert.Contains("frontHelp", canonical);
    Assert.Equal(canonical, TranslationValidation.Canonicalize(Json(canonical), English(Help), "en-US"));
    Assert.NotEqual(TranslationValidation.Basis(English()), TranslationValidation.Basis(English(Help)));
    Assert.Equal("63162e5aa72ddec7", TranslationValidation.Basis(English(Help)));
    Assert.Equal(TranslationValidation.Basis(English(Help)), TranslationValidation.Basis(English("""[{"definition":"An isolated virtual network","term":"VPC"}]""")));
    Assert.Equal("TRANSLATION_FRONT_HELP_MISMATCH", Assert.Throws<TranslationValidationError>(() => TranslationValidation.Canonicalize(Json(translated), English(), "en-US")).Code);
    Assert.Equal("TRANSLATION_FRONT_HELP_MISMATCH", Assert.Throws<TranslationValidationError>(() => TranslationValidation.Canonicalize(Json("""{"zh-CN":{"v":1,"question":"什么是 VPC？","explanation":"虚拟网络"}}"""), English(Help), "en-US")).Code);
    Assert.Equal("TRANSLATION_BAD_SHAPE", Assert.Throws<TranslationValidationError>(() => TranslationValidation.Canonicalize(Json(translated.Replace("\"v\":1", "\"v\":1,\"unknown\":true")), English(Help), "en-US")).Code);
  }

  [Fact]
  public void Help_HashSnapshotAndDiffBindContentButIgnoreObjectOrder()
  {
    var row = new Dictionary<string, object?> { ["stableUid"] = "u", ["orderInDeck"] = 1, ["question"] = "q", ["frontHelp"] = Help };
    var hash = CardContentHash.Compute(row);
    Assert.Equal("0aa690aa1459f6bef8675b61aabc84da6cfc81fd52cb3777603716a4f1b7a0c8", hash);
    Assert.Equal("front-help-v1", CardContentHash.Schema(row));
    var snapshot = PublishSnapshot.Digest([PublishSnapshot.FromRow(row)]);
    Assert.Equal("cc169736676a9e9aab80691de322f96dff8f86546884f1012191a1f1f9ee0fac", snapshot);
    var previous = new CardExportData { StableUid = "u", OrderInDeck = 1, Question = "q", FrontHelp = Json(Help) };
    Assert.Equal(snapshot, PublishJobProcessor.SnapshotDigest([previous]));
    row["frontHelp"] = """[ { "definition": "An isolated virtual network", "term": "VPC" } ]""";
    Assert.Equal(hash, CardContentHash.Compute(row));
    Assert.Equal(snapshot, PublishSnapshot.Digest([PublishSnapshot.FromRow(row)]));
    var next = JsonSerializer.Deserialize<CardExportData>(ContentJson.Serialize(previous), ContentJson.Options)!;
    next.FrontHelp = Json((string)row["frontHelp"]!);
    Assert.Empty(DeckDiff.Compute([previous], [next]).Updated);
    next.FrontHelp = Json(Help.Replace("isolated", "logically isolated"));
    Assert.Single(DeckDiff.Compute([previous], [next]).Updated);
    row["frontHelp"] = next.FrontHelp;
    Assert.NotEqual(hash, CardContentHash.Compute(row));
    Assert.NotEqual(snapshot, PublishSnapshot.Digest([PublishSnapshot.FromRow(row)]));
  }

  [Fact]
  public void TranslatedHelpOnlyChanges_BindHashAndSnapshot()
  {
    var row = new Dictionary<string, object?> { ["question"] = "q", ["translations"] = """{"zh-CN":{"frontHelp":[{"term":"VPC","definition":"网络"}]}}""" };
    var hash = CardContentHash.Compute(row);
    var snapshot = PublishSnapshot.Digest([PublishSnapshot.FromRow(row)]);
    Assert.Equal("front-help-v1", CardContentHash.Schema(row));
    row["translations"] = """{"zh-CN":{"frontHelp":[{"definition":"网络","term":"VPC"}]}}""";
    Assert.Equal(hash, CardContentHash.Compute(row));
    Assert.Equal(snapshot, PublishSnapshot.Digest([PublishSnapshot.FromRow(row)]));
    row["translations"] = """{"zh-CN":{"frontHelp":[{"term":"VPC","definition":"隔离网络"}]}}""";
    Assert.NotEqual(hash, CardContentHash.Compute(row));
    Assert.NotEqual(snapshot, PublishSnapshot.Digest([PublishSnapshot.FromRow(row)]));
  }

  private sealed class Uploader(string previous) : IS3DeckUploader
  {
    public Dictionary<string, string> Uploaded { get; } = new();
    public Task<S3UploadResult> UploadAsync(string key, DeckExportData data) => Task.FromResult(new S3UploadResult());
    public Task<S3UploadResult> UploadJsonAsync(string key, string json, string cacheControl)
    {
      Uploaded[key] = json;
      return Task.FromResult(new S3UploadResult { Bytes = json.Length, Sha256 = "sha" });
    }
    public Task<string> DownloadJsonAsync(string key) => Task.FromResult(previous);
  }
  private sealed class Repository : IContentArtifactsRepository
  {
    public Task<PreviousBuildInfo?> GetLatestSuccessBuildAsync(long deckId) => Task.FromResult<PreviousBuildInfo?>(new PreviousBuildInfo { BuildId = "b1", S3Key = "content/decks/s/builds/b1/deck.json" });
    public Task UpdateContentMetadataAsync(string jobId, string sha, long bytes, string? packageKey) => Task.CompletedTask;
    public Task InsertBuildPatchAsync(string slug, string from, string to, string path, string key, string sha, long bytes) => Task.CompletedTask;
  }

  [Fact]
  public async Task Artifacts_PreserveHelpInChunksAndDeltaAndPreviousMapping()
  {
    var card = new CardExportData { StableUid = "u", FrontHelp = Json(Help) };
    var deck = new DeckExportData { Slug = "s", Title = "T", TotalCards = 1, Cards = [card] };
    var uploader = new Uploader(ContentJson.Serialize(deck));
    var generator = new ContentArtifactsGenerator(uploader, new Repository());
    var job = new JobInfo { DeckId = 1, JobId = "j", BuildId = "b2", DeckSlug = "s", S3Key = "content/decks/s/builds/b2/deck.json" };
    await generator.GenerateAsync(job, deck, new S3UploadResult { Bytes = 1_000_000 });
    var patchKey = "content/decks/s/patches/b1-b2.json";
    using (var patch = JsonDocument.Parse(uploader.Uploaded[patchKey])) Assert.Empty(patch.RootElement.GetProperty("updated").EnumerateArray());
    var chunk = Assert.Single(uploader.Uploaded.Where(p => p.Key.Contains("/chunks/"))).Value;
    Assert.Contains("frontHelp", chunk);
    card.FrontHelp = Json(Help.Replace("isolated", "logically isolated"));
    await generator.GenerateAsync(job, deck, new S3UploadResult { Bytes = 1_000_000 });
    using var changed = JsonDocument.Parse(uploader.Uploaded[patchKey]);
    Assert.Equal("An logically isolated virtual network", changed.RootElement.GetProperty("updated")[0].GetProperty("frontHelp")[0].GetProperty("definition").GetString());
  }
}
