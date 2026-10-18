using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.SQS.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Reports;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Card translations (migration 047, contract §4) end to end against a real Postgres: the authoring API's POST/PUT/GET/
/// page/import with the effective-English re-validation and the translation_basis stamp, the publish gate
/// (TRANSLATION_MISSING / TRANSLATION_STALE / structural) and the preview echo, the super_admin-only deck setting,
/// the manifest's optional translationLocales, the Worker's export and its 42703 fallback, the routes on a pre-047
/// schema, the migration itself and the card reports' displayLocale.
/// </summary>
[Collection(PostgresCollection.Name)]
public class TranslationFieldTests
{
  private readonly PostgresFixture _db;
  public TranslationFieldTests(PostgresFixture db) => _db = db;

  private const string CardsPath = "/api/v1/authoring/cards";
  private const string ImportPath = "/api/v1/authoring/cards/import";
  private const string PublishPath = "/api/v1/authoring/publish";
  private const string DecksPath = "/api/v1/authoring/decks";
  private const string SeamQueueUrl = "https://sqs.test/000000000000/it-tr-publish";
  private const string SeamBucket = "it-tr-bucket";

  // ---------------------------------------------------------------- fixtures

  private const string Question = "Which AWS service buffers a burst of orders so the consumers can catch up?";
  private const string Explanation = "A queue absorbs the burst.";

  private static readonly object Mcq = new
  {
    v = 1,
    options = new object[]
    {
      new { key = "a", text = "Amazon SQS", correct = true },
      new { key = "b", text = "A larger EC2 instance", why = "Resizing does not buffer anything.", correct = false },
      new { key = "c", text = "A single-shard stream", why = "One shard caps the ingest rate.", correct = false },
    },
  };

  private static JsonObject Zh() => new()
  {
    ["zh-CN"] = new JsonObject
    {
      ["v"] = 1,
      ["question"] = "哪种 AWS 服务能缓冲突发订单，让消费者慢慢处理？",
      ["explanation"] = "队列可以吸收突发流量。",
      ["mcq"] = new JsonObject
      {
        ["qualifier"] = null,
        ["options"] = new JsonObject
        {
          ["a"] = new JsonObject { ["text"] = "Amazon SQS" },
          ["b"] = new JsonObject { ["text"] = "更大的 EC2 实例", ["why"] = "扩容不会缓冲任何东西。" },
          ["c"] = new JsonObject { ["text"] = "单分片的流", ["why"] = "一个分片会限制写入速率。" },
        },
      },
    },
  };

  private static string McqCanonical() => McqValidation.Canonicalize(JsonSerializer.SerializeToElement(Mcq), Question);

  private static TranslationValidation.EnglishCard English(string explanation = Explanation) => new(Question, explanation, null, McqCanonical());

  private static Dictionary<string, object?> CardBody(long deckId, string uid, int order, JsonNode? translations, bool includeTranslations = true)
  {
    var body = new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["deckId"] = deckId,
      ["stableUid"] = uid,
      ["question"] = Question,
      ["explanation"] = Explanation,
      ["difficulty"] = 2,
      ["orderInDeck"] = order,
      ["mcq"] = Mcq,
    };
    if (includeTranslations) body["translations"] = translations;
    return body;
  }

  // ---------------------------------------------------------------- kit

  private static string NewSub() => $"it-tr-{Guid.NewGuid():N}";

  private async Task<long> NewDeckAsync(string tag, string locale = "en-US", string? translationLocales = null)
  {
    var id = await _db.ScalarAsync(
      "insert into decks (slug, title, author, locale, translation_locales) values ($1, $2, 'tests', $3, coalesce($4::text[], '{}')) returning id",
      $"it-tr-{tag}-{Guid.NewGuid():N}", $"deck tr {tag}", locale, translationLocales);
    return Convert.ToInt64(id, CultureInfo.InvariantCulture);
  }

  private static AuthContext SuperAdmin() => AutomationTestKit.Ctx(NewSub(), agent: false);

  private static AuthContext Editor(string sub) => new(
    Claims: new Dictionary<string, JsonElement>(), UserSub: sub, Username: null, Groups: ["editor"], IsSuperAdmin: false, IsEditor: true,
    IsAdmin: true);

  private static Task<APIGatewayProxyResponse> CardsAsync(string method, object? body, IDictionary<string, string>? query = null) =>
    AutomationTestKit.CallAsync(Cards.HandleAuthoringCards, method, CardsPath, body, SuperAdmin(), query);

  private static Task<APIGatewayProxyResponse> ImportAsync(long deckId, params object[] cards) =>
    AutomationTestKit.CallAsync(CardsImport.HandleCardsImport, "POST", ImportPath, new { deckId, cards }, SuperAdmin());

  private static Task<APIGatewayProxyResponse> PublishAsync(long deckId, string? mode = null) =>
    AutomationTestKit.CallAsync(Publish.HandleAuthoringPublish, "POST", PublishPath, new { deckId }, SuperAdmin(),
      mode is null ? null : new Dictionary<string, string> { ["mode"] = mode });

  private static Task<APIGatewayProxyResponse> DecksPutAsync(object body, AuthContext auth, List<long>? rebuilds = null) =>
    AutomationTestKit.CallAsync((q, r, a) => Decks.HandleAuthoringDecks(q, r, a, _ =>
    {
      rebuilds?.Add(1);
      return Task.FromResult(new ManifestBuildResult(0, 0, "content/manifest.json", "etag", 0));
    }), "PUT", DecksPath, body, auth);

  private static JsonElement Data(APIGatewayProxyResponse response) => AutomationTestKit.Data(response);

  private static (string Code, string Message) Error(APIGatewayProxyResponse response, int status)
  {
    Assert.True(response.StatusCode == status, $"expected {status}, got {response.StatusCode}: {response.Body}");
    using var doc = JsonDocument.Parse(response.Body!);
    var error = doc.RootElement.GetProperty("error");
    return (error.GetProperty("code").GetString()!, error.GetProperty("message").GetString()!);
  }

  private async Task<(string? Translations, string? Basis, long Revision)> StoredAsync(long cardId)
  {
    var row = (await _db.QueryAsync("select translations::text as t, translation_basis::text as b, revision from cards where id = $1", cardId))[0];
    return (row["t"] as string, row["b"] as string, Convert.ToInt64(row["revision"], CultureInfo.InvariantCulture));
  }

  /// <summary>PG jsonb text in compact form (PG key order kept, PG spacing removed, Chinese unescaped).</summary>
  private static string Compact(string pgText) =>
    JsonNode.Parse(pgText)!.ToJsonString(new JsonSerializerOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping });

  /// <summary>Runs <paramref name="body"/> against a scratch database migrated to <paramref name="maxVersion"/>.</summary>
  private async Task InScratchAsync(string name, int maxVersion, Func<NpgsqlConnection, Task> body)
  {
    var connectionString = await _db.CreateScratchDatabaseAsync(name);
    await using var conn = new NpgsqlConnection(connectionString);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, maxVersion);

    var prevDb = Environment.GetEnvironmentVariable("PGDATABASE");
    Environment.SetEnvironmentVariable("PGDATABASE", name);
    Pg.Reset();
    try
    {
      await body(conn);
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", prevDb);
      Pg.Reset();
    }
  }

  // ---------------------------------------------------------------- POST / GET / page

  [Fact]
  public async Task PostCard_WithTranslations_StoresCanonicalJsonb_StampsTheBasis_AndAnswersOk()
  {
    var deckId = await NewDeckAsync("post");
    var data = Data(await CardsAsync("POST", CardBody(deckId, "tr-post", 1, Zh())));

    Assert.Equal("哪种 AWS 服务能缓冲突发订单，让消费者慢慢处理？", data.GetProperty("translations").GetProperty("zh-CN").GetProperty("question").GetString());
    Assert.Equal("ok", data.GetProperty("translationStatus").GetProperty("zh-CN").GetString());
    Assert.False(data.TryGetProperty("translationBasis", out _));

    var (translations, basis, _) = await StoredAsync(data.GetProperty("id").GetInt64());
    // A real jsonb round trip changes only PG's spacing: the canonicaliser writes PG's key order.
    var canonical = TranslationValidation.Canonicalize(JsonSerializer.SerializeToElement(Zh()), English(), "en-US");
    Assert.Equal(canonical, Compact(translations!));
    Assert.Equal($$"""{"zh-CN":"{{TranslationValidation.Basis(English())}}"}""", Compact(basis!));
  }

  [Fact]
  public async Task PostCard_WithoutTranslations_AnswersNulls()
  {
    var deckId = await NewDeckAsync("post-none");
    var data = Data(await CardsAsync("POST", CardBody(deckId, "tr-none", 1, null, includeTranslations: false)));

    Assert.Equal(JsonValueKind.Null, data.GetProperty("translations").ValueKind);
    Assert.Equal(JsonValueKind.Null, data.GetProperty("translationStatus").ValueKind);
    var (translations, basis, _) = await StoredAsync(data.GetProperty("id").GetInt64());
    Assert.Null(translations);
    Assert.Null(basis);
  }

  [Fact]
  public async Task PostCard_InvalidTranslation_IsRefusedWithItsCode_AndWritesNothing()
  {
    var deckId = await NewDeckAsync("post-bad");
    var zh = Zh();
    zh["zh-CN"]!["mcq"]!["options"]!.AsObject().Remove("c");

    var (code, _) = Error(await CardsAsync("POST", CardBody(deckId, "tr-bad", 1, zh)), 400);
    Assert.Equal("TRANSLATION_OPTION_KEYS_MISMATCH", code);
    Assert.Equal(0L, Convert.ToInt64(await _db.ScalarAsync("select count(*) from cards where deck_id = $1", deckId), CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task PostCard_TranslationIntoTheDecksOwnLocale_IsBadLocale()
  {
    var deckId = await NewDeckAsync("post-zh", locale: "zh-CN");
    Assert.Equal("TRANSLATION_BAD_LOCALE", Error(await CardsAsync("POST", CardBody(deckId, "tr-zh", 1, Zh())), 400).Code);
  }

  [Fact]
  public async Task GetAndPage_ReturnTranslationsAndStatus_NeverTheBasis()
  {
    var deckId = await NewDeckAsync("get");
    Data(await CardsAsync("POST", CardBody(deckId, "tr-get-1", 1, Zh())));
    Data(await CardsAsync("POST", CardBody(deckId, "tr-get-2", 2, null, includeTranslations: false)));
    var query = new Dictionary<string, string> { ["deckId"] = deckId.ToString(CultureInfo.InvariantCulture) };

    var all = Data(await CardsAsync("GET", null, query)).EnumerateArray().ToList();
    var page = Data(await AutomationTestKit.CallAsync(CardsPage.HandleAuthoringCardsPage, "GET", "/api/v1/authoring/cards/page", null, SuperAdmin(), query))
      .GetProperty("items").EnumerateArray().ToList();

    foreach (var cards in new[] { all, page })
    {
      Assert.Equal(2, cards.Count);
      Assert.Equal("ok", cards[0].GetProperty("translationStatus").GetProperty("zh-CN").GetString());
      Assert.Equal(JsonValueKind.Object, cards[0].GetProperty("translations").ValueKind);
      Assert.Equal(JsonValueKind.Null, cards[1].GetProperty("translations").ValueKind);
      Assert.Equal(JsonValueKind.Null, cards[1].GetProperty("translationStatus").ValueKind);
      Assert.All(cards, c => Assert.False(c.TryGetProperty("translationBasis", out _)));
    }
  }

  // ---------------------------------------------------------------- PUT

  private async Task<(long Id, long Version)> PostTranslatedAsync(long deckId, string uid, int order = 1)
  {
    var data = Data(await CardsAsync("POST", CardBody(deckId, uid, order, Zh())));
    return (data.GetProperty("id").GetInt64(), data.GetProperty("version").GetInt64());
  }

  [Fact]
  public async Task PutCard_EnglishTextEdit_MakesTheTranslationStale_RestampingMakesItOk_RevisionNeverMoves()
  {
    var deckId = await NewDeckAsync("put-stale");
    var (id, version) = await PostTranslatedAsync(deckId, "tr-stale");
    var (storedBefore, basisBefore, revision) = await StoredAsync(id);

    var edited = Data(await CardsAsync("PUT", new { id, expectedVersion = version, explanation = "A queue absorbs the burst until consumers catch up." }));
    Assert.Equal("stale", edited.GetProperty("translationStatus").GetProperty("zh-CN").GetString());
    Assert.Equal((storedBefore, basisBefore, revision), await StoredAsync(id));

    // "Mark zh current": the same translations sent again restamp the basis against the new English.
    var restamped = Data(await CardsAsync("PUT", new { id, expectedVersion = edited.GetProperty("version").GetInt64(), translations = Zh() }));
    Assert.Equal("ok", restamped.GetProperty("translationStatus").GetProperty("zh-CN").GetString());
    var (storedAfter, basisAfter, revisionAfter) = await StoredAsync(id);
    Assert.Equal(storedBefore, storedAfter);
    Assert.NotEqual(basisBefore, basisAfter);
    Assert.Equal(revision, revisionAfter);
  }

  [Fact]
  public async Task PutCard_EnglishEditThatBreaksTheMirror_IsRefused_AndWritesNothing()
  {
    var deckId = await NewDeckAsync("put-break");
    var (id, version) = await PostTranslatedAsync(deckId, "tr-break");

    // The English card gains a real-world usage the stored zh-CN translation does not have.
    var (code, _) = Error(await CardsAsync("PUT", new { id, expectedVersion = version, realWorldUsage = "Order pipelines put a queue in front of fulfilment." }), 400);
    Assert.Equal("TRANSLATION_FIELD_MISSING", code);
    Assert.Null(await _db.ScalarAsync("select real_world_usage from cards where id = $1", id));

    // An MCQ removed from the English card leaves a translated mcq behind: also refused.
    Assert.Equal("TRANSLATION_FIELD_EXTRA", Error(await CardsAsync("PUT", new { id, expectedVersion = version, mcq = (object?)null }), 400).Code);
  }

  [Fact]
  public async Task PutCard_NullTranslations_ClearsTranslationsAndBasis()
  {
    var deckId = await NewDeckAsync("put-clear");
    var (id, version) = await PostTranslatedAsync(deckId, "tr-clear");

    var data = Data(await CardsAsync("PUT", new { id, expectedVersion = version, translations = (object?)null }));
    Assert.Equal(JsonValueKind.Null, data.GetProperty("translations").ValueKind);
    var (translations, basis, _) = await StoredAsync(id);
    Assert.Null(translations);
    Assert.Null(basis);
  }

  [Fact]
  public async Task PutCard_InvalidTranslation_IsRefusedWithItsCode()
  {
    var deckId = await NewDeckAsync("put-bad");
    var (id, version) = await PostTranslatedAsync(deckId, "tr-put-bad");
    var zh = Zh();
    zh["zh-CN"]!["mcq"]!["options"]!["a"]!["correct"] = true;

    Assert.Equal("TRANSLATION_CORRECT_MARK", Error(await CardsAsync("PUT", new { id, expectedVersion = version, translations = zh }), 400).Code);
  }

  // ---------------------------------------------------------------- import

  private static Dictionary<string, object?> ImportCard(string uid, int order, JsonNode? translations, string explanation = Explanation,
    bool includeTranslations = true, object? mcq = null)
  {
    var card = new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["stableUid"] = uid,
      ["question"] = Question,
      ["explanation"] = explanation,
      ["difficulty"] = 2,
      ["orderInDeck"] = order,
      ["mcq"] = mcq ?? Mcq,
    };
    if (includeTranslations) card["translations"] = translations;
    return card;
  }

  private async Task<long> CardIdAsync(long deckId, string uid) =>
    Convert.ToInt64(await _db.ScalarAsync("select id from cards where deck_id = $1 and stable_uid = $2", deckId, uid), CultureInfo.InvariantCulture);

  [Fact]
  public async Task Import_Translations_AreCreatedSkippedRestampedAndClearedLikeTheFile()
  {
    var deckId = await NewDeckAsync("import");

    Assert.Equal(1, Data(await ImportAsync(deckId, ImportCard("tr-imp", 1, Zh()))).GetProperty("created").GetInt32());
    var id = Convert.ToInt64(await _db.ScalarAsync("select id from cards where deck_id = $1", deckId), CultureInfo.InvariantCulture);
    var (translations, basis, revision) = await StoredAsync(id);
    Assert.NotNull(translations);
    Assert.Equal($$"""{"zh-CN":"{{TranslationValidation.Basis(English())}}"}""", Compact(basis!));

    // The same file again changes nothing.
    Assert.Equal(1, Data(await ImportAsync(deckId, ImportCard("tr-imp", 1, Zh()))).GetProperty("unchanged").GetInt32());

    // New English with the same translations: the file is the new basis.
    const string newExplanation = "A queue absorbs the burst; consumers read at their own pace.";
    Assert.Equal(1, Data(await ImportAsync(deckId, ImportCard("tr-imp", 1, Zh(), newExplanation))).GetProperty("updated").GetInt32());
    var (_, basisAfter, revisionAfter) = await StoredAsync(id);
    Assert.Equal($$"""{"zh-CN":"{{TranslationValidation.Basis(English(newExplanation))}}"}""", Compact(basisAfter!));
    Assert.Equal(revision, revisionAfter);

    // A file that says "translations": null clears them, basis included.
    Assert.Equal(1, Data(await ImportAsync(deckId, ImportCard("tr-imp", 1, null, newExplanation))).GetProperty("updated").GetInt32());
    Assert.Equal((null, null, revision), await StoredAsync(id));
  }

  [Fact]
  public async Task Import_CardWithoutTheTranslationsKey_KeepsTheStoredTranslationsAndBasis()
  {
    var deckId = await NewDeckAsync("import-absent");
    Data(await ImportAsync(deckId, ImportCard("tr-abs", 1, Zh())));
    var id = await CardIdAsync(deckId, "tr-abs");
    var before = await StoredAsync(id);
    Assert.NotNull(before.Translations);

    // The same English without the key: nothing to write, so nothing bumps.
    var version = await _db.ScalarAsync("select version from cards where id = $1", id);
    Assert.Equal(1, Data(await ImportAsync(deckId, ImportCard("tr-abs", 1, null, includeTranslations: false))).GetProperty("unchanged").GetInt32());
    Assert.Equal(before, await StoredAsync(id));
    Assert.Equal(version, await _db.ScalarAsync("select version from cards where id = $1", id));

    // New English without the key: the English is written, the translations and their old basis are kept, so the
    // translation reads as stale until it is restamped.
    const string newExplanation = "A queue absorbs the burst; consumers read at their own pace.";
    var data = Data(await ImportAsync(deckId, ImportCard("tr-abs", 1, null, newExplanation, includeTranslations: false)));
    Assert.Equal(1, data.GetProperty("updated").GetInt32());
    Assert.Equal(before, await StoredAsync(id));
    Assert.Equal(newExplanation, await _db.ScalarAsync("select explanation from cards where id = $1", id));
    var row = Data(await CardsAsync("GET", null, new Dictionary<string, string> { ["id"] = id.ToString(CultureInfo.InvariantCulture) }))[0];
    Assert.Equal("stale", row.GetProperty("translationStatus").GetProperty("zh-CN").GetString());

    // A new card without the key has no translations.
    Assert.Equal(1, Data(await ImportAsync(deckId,
      ImportCard("tr-abs", 1, null, newExplanation, includeTranslations: false),
      ImportCard("tr-abs-new", 2, null, includeTranslations: false))).GetProperty("created").GetInt32());
    var (newTranslations, newBasis, _) = await StoredAsync(await CardIdAsync(deckId, "tr-abs-new"));
    Assert.Null(newTranslations);
    Assert.Null(newBasis);
  }

  [Fact]
  public async Task Import_ExplicitNullTranslations_ClearTheStoredTranslationsAndBasis()
  {
    var deckId = await NewDeckAsync("import-null");
    Data(await ImportAsync(deckId, ImportCard("tr-null", 1, Zh())));
    var id = await CardIdAsync(deckId, "tr-null");
    var (_, _, revision) = await StoredAsync(id);

    // English unchanged: the explicit null alone is a change.
    Assert.Equal(1, Data(await ImportAsync(deckId, ImportCard("tr-null", 1, null))).GetProperty("updated").GetInt32());
    Assert.Equal((null, null, revision), await StoredAsync(id));

    // Cleared stays cleared: an absent key keeps the null, an explicit null again changes nothing.
    Assert.Equal(1, Data(await ImportAsync(deckId, ImportCard("tr-null", 1, null, includeTranslations: false))).GetProperty("unchanged").GetInt32());
    Assert.Equal(1, Data(await ImportAsync(deckId, ImportCard("tr-null", 1, null))).GetProperty("unchanged").GetInt32());
    Assert.Equal((null, null, revision), await StoredAsync(id));
  }

  [Fact]
  public async Task Import_PresentTranslations_RestampTheBasisAgainstTheFilesEnglish()
  {
    var deckId = await NewDeckAsync("import-restamp");
    Data(await ImportAsync(deckId, ImportCard("tr-rst", 1, Zh())));
    var id = await CardIdAsync(deckId, "tr-rst");
    var (storedBefore, basisBefore, revision) = await StoredAsync(id);

    // An English edit without the key leaves the old basis (stale) ...
    const string newExplanation = "A queue absorbs the burst; consumers read at their own pace.";
    Data(await ImportAsync(deckId, ImportCard("tr-rst", 1, null, newExplanation, includeTranslations: false)));
    Assert.Equal((storedBefore, basisBefore, revision), await StoredAsync(id));

    // ... and the same translations sent with that English restamp it: only the basis moves, never the revision.
    Assert.Equal(1, Data(await ImportAsync(deckId, ImportCard("tr-rst", 1, Zh(), newExplanation))).GetProperty("updated").GetInt32());
    var (storedAfter, basisAfter, revisionAfter) = await StoredAsync(id);
    Assert.Equal(storedBefore, storedAfter);
    Assert.Equal($$"""{"zh-CN":"{{TranslationValidation.Basis(English(newExplanation))}}"}""", Compact(basisAfter!));
    Assert.NotEqual(basisBefore, basisAfter);
    Assert.Equal(revision, revisionAfter);
    var row = Data(await CardsAsync("GET", null, new Dictionary<string, string> { ["id"] = id.ToString(CultureInfo.InvariantCulture) }))[0];
    Assert.Equal("ok", row.GetProperty("translationStatus").GetProperty("zh-CN").GetString());
  }

  [Fact]
  public async Task Import_CardWithoutTheKey_WhoseNewEnglishBreaksTheStoredTranslations_IsRefused_AndWritesNothing()
  {
    var deckId = await NewDeckAsync("import-break");
    Data(await ImportAsync(deckId, ImportCard("tr-brk", 1, Zh())));
    var id = await CardIdAsync(deckId, "tr-brk");
    var before = await StoredAsync(id);
    var mcqBefore = await _db.ScalarAsync("select mcq::text from cards where id = $1", id);

    // The English MCQ gains option d, which the kept zh-CN translation does not cover.
    var fourOptions = new
    {
      v = 1,
      options = new object[]
      {
        new { key = "a", text = "Amazon SQS", correct = true },
        new { key = "b", text = "A larger EC2 instance", why = "Resizing does not buffer anything.", correct = false },
        new { key = "c", text = "A single-shard stream", why = "One shard caps the ingest rate.", correct = false },
        new { key = "d", text = "A cron job", why = "A schedule does not absorb a burst.", correct = false },
      },
    };
    var (code, message) = Error(await ImportAsync(deckId,
      ImportCard("tr-ok", 2, null, includeTranslations: false),
      ImportCard("tr-brk", 1, null, includeTranslations: false, mcq: fourOptions)), 400);
    Assert.Equal("TRANSLATION_OPTION_KEYS_MISMATCH", code);
    Assert.StartsWith("cards[1] (tr-brk): the stored translations no longer match", message, StringComparison.Ordinal);

    // The whole file is refused.
    Assert.Equal(before, await StoredAsync(id));
    Assert.Equal(mcqBefore, await _db.ScalarAsync("select mcq::text from cards where id = $1", id));
    Assert.Equal(1L, Convert.ToInt64(await _db.ScalarAsync("select count(*) from cards where deck_id = $1", deckId), CultureInfo.InvariantCulture));

    // Sending translations: null with the new English is the way to drop them.
    Data(await ImportAsync(deckId, ImportCard("tr-brk", 1, null, mcq: fourOptions)));
    Assert.Equal((null, null, before.Revision), await StoredAsync(id));
  }

  [Fact]
  public async Task Import_InvalidTranslation_IsRefusedWithItsCodeAndTheCard()
  {
    var deckId = await NewDeckAsync("import-bad");
    var zh = Zh();
    zh["zh-CN"]!["question"] = Question;

    var (code, message) = Error(await ImportAsync(deckId, ImportCard("tr-imp-bad", 1, zh)), 400);
    Assert.Equal("TRANSLATION_NOT_TRANSLATED", code);
    Assert.StartsWith("cards[0] (tr-imp-bad): ", message, StringComparison.Ordinal);
  }

  // ---------------------------------------------------------------- publish gate and preview

  private static async Task<List<SendMessageRequest>> WithPublishSeamAsync(Func<Task> body)
  {
    var saved = Publish.TestEnqueueSeam;
    var sent = new List<SendMessageRequest>();
    Publish.TestEnqueueSeam = new(SeamQueueUrl, SeamBucket, r => { lock (sent) sent.Add(r); return Task.CompletedTask; });
    try
    {
      await body();
    }
    finally
    {
      Publish.TestEnqueueSeam = saved;
    }
    return sent;
  }

  [Fact]
  public async Task Gate_DeckWithoutTranslationLocales_IsNotChecked()
  {
    var deckId = await NewDeckAsync("gate-off");
    Data(await CardsAsync("POST", CardBody(deckId, "tr-gate-off", 1, null, includeTranslations: false)));

    Assert.Null(Publish.FirstTranslationGateFailure(await _db.QueryAsync(Publish.CardsSql, deckId), [], "en-US"));
    var sent = await WithPublishSeamAsync(async () => Assert.Equal("async", Data(await PublishAsync(deckId)).GetProperty("mode").GetString()));
    Assert.Single(sent);
  }

  [Fact]
  public async Task Gate_MissingTranslation_RefusesThePublish_AndRecordsTheDefect()
  {
    var deckId = await NewDeckAsync("gate-missing", translationLocales: "{zh-CN}");
    await PostTranslatedAsync(deckId, "tr-gate-ok", 1);
    Data(await CardsAsync("POST", CardBody(deckId, "tr-gate-missing", 2, null, includeTranslations: false)));

    var sent = await WithPublishSeamAsync(async () =>
    {
      var (code, message) = Error(await PublishAsync(deckId), 400);
      Assert.Equal(("TRANSLATION_PUBLISH_GATE", "tr-gate-missing: TRANSLATION_MISSING"), (code, message));
    });
    Assert.Empty(sent);

    var ledger = await _db.QueryAsync(
      "select ref, details->>'code' as code from automation_events where automation = 'publish_gate' and deck_id = $1", deckId);
    Assert.Equal(("tr-gate-missing", "TRANSLATION_MISSING"), ((string)Assert.Single(ledger)["ref"]!, (string)ledger[0]["code"]!));
  }

  [Fact]
  public async Task Gate_StaleTranslation_RefusesThePublish_UntilRestamped()
  {
    var deckId = await NewDeckAsync("gate-stale", translationLocales: "{zh-CN}");
    var (id, version) = await PostTranslatedAsync(deckId, "tr-gate-stale");
    var edited = Data(await CardsAsync("PUT", new { id, expectedVersion = version, explanation = "Edited English explanation." }));

    var gate = Publish.FirstTranslationGateFailure(await _db.QueryAsync(Publish.CardsSql, deckId), ["zh-CN"], "en-US");
    Assert.Equal(("tr-gate-stale", "TRANSLATION_STALE"), gate!.Value);

    Data(await CardsAsync("PUT", new { id, expectedVersion = edited.GetProperty("version").GetInt64(), translations = Zh() }));
    Assert.Null(Publish.FirstTranslationGateFailure(await _db.QueryAsync(Publish.CardsSql, deckId), ["zh-CN"], "en-US"));
    var sent = await WithPublishSeamAsync(async () => Assert.Equal("async", Data(await PublishAsync(deckId)).GetProperty("mode").GetString()));
    Assert.Single(sent);
  }

  [Fact]
  public async Task Gate_StructurallyInvalidStoredTranslation_ReportsItsCode()
  {
    // Direct SQL on purpose: a blob that never went through the API, as a hand edit would leave it.
    var deckId = await NewDeckAsync("gate-shape", translationLocales: "{zh-CN}");
    var (id, _) = await PostTranslatedAsync(deckId, "tr-gate-shape");
    await _db.QueryAsync("update cards set translations = jsonb_set(translations, '{zh-CN,mcq,options,a,correct}', 'true') where id = $1", id);

    var gate = Publish.FirstTranslationGateFailure(await _db.QueryAsync(Publish.CardsSql, deckId), ["zh-CN"], "en-US");
    Assert.Equal(("tr-gate-shape", "TRANSLATION_CORRECT_MARK"), gate!.Value);
  }

  [Fact]
  public async Task Preview_EchoesTranslations()
  {
    var deckId = await NewDeckAsync("preview");
    await PostTranslatedAsync(deckId, "tr-preview-1", 1);
    Data(await CardsAsync("POST", CardBody(deckId, "tr-preview-2", 2, null, includeTranslations: false)));

    var cards = Data(await PublishAsync(deckId, "preview")).GetProperty("export").GetProperty("cards").EnumerateArray().ToList();
    Assert.Equal("Amazon SQS", cards[0].GetProperty("translations").GetProperty("zh-CN").GetProperty("mcq").GetProperty("options").GetProperty("a")
      .GetProperty("text").GetString());
    Assert.Equal(JsonValueKind.Null, cards[1].GetProperty("translations").ValueKind);
  }

  // ---------------------------------------------------------------- deck setting

  [Fact]
  public async Task Decks_TranslationLocales_IsASuperAdminSetting_ThatRebuildsTheManifest()
  {
    var deckId = await NewDeckAsync("deck-setting");
    var rebuilds = new List<long>();

    var set = Data(await DecksPutAsync(new { id = deckId, translationLocales = new[] { "zh-CN", "zh-CN" } }, SuperAdmin(), rebuilds));
    Assert.Equal(new[] { "zh-CN" }, set.GetProperty("translationLocales").EnumerateArray().Select(e => e.GetString()).ToArray());
    Assert.True(set.GetProperty("manifestRebuilt").GetBoolean());
    Assert.Single(rebuilds);

    var get = Data(await AutomationTestKit.CallAsync((q, r, a) => Decks.HandleAuthoringDecks(q, r, a), "GET", DecksPath, null, SuperAdmin(),
      new Dictionary<string, string> { ["id"] = deckId.ToString(CultureInfo.InvariantCulture) }));
    Assert.Equal("zh-CN", get[0].GetProperty("translationLocales")[0].GetString());

    // An editor with write access cannot change it.
    var editorSub = NewSub();
    await _db.QueryAsync("insert into admin_deck_permissions (admin_sub, deck_id, can_read, can_write) values ($1, $2, 1, 1)", editorSub, deckId);
    var editor = Data(await DecksPutAsync(new { id = deckId, title = "renamed", translationLocales = Array.Empty<string>() }, Editor(editorSub)));
    Assert.Contains("translationLocales", editor.GetProperty("ignoredFields").EnumerateArray().Select(e => e.GetString()));
    Assert.Equal(1, editor.GetProperty("translationLocales").GetArrayLength());

    // JSON null declares none.
    Assert.Equal(0, Data(await DecksPutAsync(new { id = deckId, translationLocales = (object?)null }, SuperAdmin())).GetProperty("translationLocales").GetArrayLength());
  }

  [Fact]
  public async Task Decks_TranslationLocales_RefusesUnsupportedAndOwnLocales()
  {
    var deckId = await NewDeckAsync("deck-bad");
    Assert.Equal("TRANSLATION_BAD_LOCALE", Error(await DecksPutAsync(new { id = deckId, translationLocales = new[] { "zh-TW" } }, SuperAdmin()), 400).Code);
    Assert.Equal("VALIDATION_ERROR", Error(await DecksPutAsync(new { id = deckId, translationLocales = "zh-CN" }, SuperAdmin()), 400).Code);

    var zhDeck = await NewDeckAsync("deck-zh", locale: "zh-CN");
    Assert.Equal("TRANSLATION_BAD_LOCALE", Error(await DecksPutAsync(new { id = zhDeck, translationLocales = new[] { "zh-CN" } }, SuperAdmin()), 400).Code);

    // A deck that declares zh-CN cannot become a zh-CN deck either.
    var declared = await NewDeckAsync("deck-declared", translationLocales: "{zh-CN}");
    Assert.Equal("TRANSLATION_BAD_LOCALE", Error(await DecksPutAsync(new { id = declared, locale = "zh-CN" }, SuperAdmin()), 400).Code);
  }

  // ---------------------------------------------------------------- manifest

  private static readonly string[] ManifestDeckKeys =
  {
    "order", "slug", "title", "locale", "deckType", "tier", "availability", "retiredAtMs", "eta",
    "downloadMode", "totalCards", "version", "buildId", "path", "sha256", "packagePath",
    "previewCards", "previewVersion", "previewBuildId", "previewPath", "previewSha256",
    "patches", "previewPatches",
  };

  private async Task<string> PublishedDeckAsync(string tag, string? translationLocales)
  {
    var deckId = await NewDeckAsync(tag, translationLocales: translationLocales);
    var slug = (string)(await _db.ScalarAsync("select slug from decks where id = $1", deckId))!;
    await _db.QueryAsync(
      "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status) values ($1, $2, $3, $4, $5, 'SUCCESS')",
      deckId, slug, "b-1", $"content/decks/{slug}/builds/b-1/deck.json", Guid.NewGuid().ToString());
    return slug;
  }

  [Fact]
  public async Task Manifest_EmitsTranslationLocales_LastAndOnlyWhenDeclared()
  {
    var declared = await PublishedDeckAsync("manifest-zh", "{zh-CN}");
    var plain = await PublishedDeckAsync("manifest-plain", null);

    await using var conn = await _db.OpenAsync();
    using var doc = JsonDocument.Parse((await ManifestBuilder.BuildAsync(conn, "content", 1700000000000L)).Json);
    var decks = doc.RootElement.GetProperty("decks").EnumerateArray().ToList();
    var declaredDeck = decks.Single(d => d.GetProperty("slug").GetString() == declared);
    var plainDeck = decks.Single(d => d.GetProperty("slug").GetString() == plain);

    Assert.Equal(ManifestDeckKeys.Append("translationLocales").ToArray(), declaredDeck.EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal(new[] { "zh-CN" }, declaredDeck.GetProperty("translationLocales").EnumerateArray().Select(e => e.GetString()).ToArray());
    Assert.Equal(ManifestDeckKeys, plainDeck.EnumerateObject().Select(p => p.Name).ToArray());
  }

  // ---------------------------------------------------------------- Worker

  [Fact]
  public async Task LoadCards_MapsTranslations_AndNeverExportsTheBasis()
  {
    var deckId = await NewDeckAsync("worker");
    await PostTranslatedAsync(deckId, "tr-worker-1", 1);
    Data(await CardsAsync("POST", CardBody(deckId, "tr-worker-2", 2, null, includeTranslations: false)));

    await using var conn = await _db.OpenAsync();
    var cards = await PublishJobProcessor.LoadCardsAsync(conn, (int)deckId);

    Assert.Equal("队列可以吸收突发流量。", cards[0].Translations!.Value.GetProperty("zh-CN").GetProperty("explanation").GetString());
    Assert.Null(cards[1].Translations);
    var json = RecallSmith.Lambda.Worker.Content.ContentJson.Serialize(cards);
    Assert.DoesNotContain("translationBasis", json, StringComparison.Ordinal);
    Assert.DoesNotContain("translation_basis", json, StringComparison.Ordinal);

    // The Worker and core-vpc digest the same rows the same way.
    var rows = await _db.QueryAsync(Publish.CardsSql, deckId);
    Assert.Equal(PublishSnapshot.Digest(rows.Select(PublishSnapshot.FromRow)), PublishJobProcessor.SnapshotDigest(cards));
  }

  // ---------------------------------------------------------------- before migration 047

  [Fact]
  public async Task Pre047Schema_RoutesWorkWithoutTranslations_AndRefuseOnlyTranslationWrites()
  {
    await InScratchAsync("it_tr_pre047", 46, async conn =>
    {
      var deckId = Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null,
        "insert into decks (slug, title, author) values ($1, 'deck pre047', 'tests') returning id", [$"it-tr-pre047-{Guid.NewGuid():N}"]),
        CultureInfo.InvariantCulture);

      // Authoring without translations works and answers null translations.
      var posted = Data(await CardsAsync("POST", CardBody(deckId, "pre-1", 1, null, includeTranslations: false)));
      Assert.Equal(JsonValueKind.Null, posted.GetProperty("translations").ValueKind);
      Data(await CardsAsync("PUT", new { id = posted.GetProperty("id").GetInt64(), expectedVersion = posted.GetProperty("version").GetInt64(), explanation = "Edited." }));
      Data(await CardsAsync("GET", null, new Dictionary<string, string> { ["deckId"] = deckId.ToString(CultureInfo.InvariantCulture) }));
      Data(await ImportAsync(deckId, ImportCard("pre-2", 2, null)));
      Data(await ImportAsync(deckId, ImportCard("pre-2", 2, null, includeTranslations: false)));

      // A translation write needs the columns.
      Assert.Equal("MIGRATION_REQUIRED", Error(await CardsAsync("POST", CardBody(deckId, "pre-3", 3, Zh())), 503).Code);
      Assert.Equal("MIGRATION_REQUIRED", Error(await ImportAsync(deckId, ImportCard("pre-2", 2, Zh())), 503).Code);

      // The publish rows, the gate, the Worker and the manifest read the old schema.
      var rows = await DbUtil.QueryAsync(conn, null, Publish.CardsSql, [deckId]);
      Assert.All(rows, r => Assert.Null(r["translations"]));
      Assert.Equal("preview", Data(await PublishAsync(deckId, "preview")).GetProperty("mode").GetString());
      var cards = await PublishJobProcessor.LoadCardsAsync(conn, (int)deckId);
      Assert.All(cards, c => Assert.Null(c.Translations));
      Assert.Equal(PublishSnapshot.Digest(rows.Select(PublishSnapshot.FromRow)), PublishJobProcessor.SnapshotDigest(cards));
      Assert.DoesNotContain("translationLocales", (await ManifestBuilder.BuildAsync(conn, "content", 1L)).Json, StringComparison.Ordinal);
    });
  }

  // ---------------------------------------------------------------- migration

  [Fact]
  public async Task Migration047_IsIdempotent_AndChecksTheDisplayLocale()
  {
    var path = Path.Combine(AppContext.BaseDirectory, "Db", "Migrations", "047_card_translations.sql");
    var sql = await File.ReadAllTextAsync(path);

    await using var conn = await _db.OpenAsync();
    await DbUtil.ExecuteAsync(conn, null, sql, []);
    await DbUtil.ExecuteAsync(conn, null, sql, []);

    var columns = await DbUtil.QueryAsync(conn, null,
      """
      select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
      where (table_name, column_name) in (('cards','translations'), ('cards','translation_basis'), ('decks','translation_locales'), ('card_reports','display_locale'))
      order by table_name, column_name
      """, []);
    Assert.Equal(
      new[] { "card_reports.display_locale:text:YES", "cards.translation_basis:jsonb:YES", "cards.translations:jsonb:YES", "decks.translation_locales:ARRAY:NO" },
      columns.Select(c => $"{c["table_name"]}.{c["column_name"]}:{c["data_type"]}:{c["is_nullable"]}").ToArray());

    var ex = await Assert.ThrowsAsync<PostgresException>(() => DbUtil.ExecuteAsync(conn, null,
      "insert into card_reports (user_sub, deck_slug, stable_uid, reason, display_locale) values ('it-tr', 'deck', 'uid', 'typo', 'zh_cn')", []));
    Assert.Equal("ck_card_reports_display_locale", ex.ConstraintName);
  }

  // ---------------------------------------------------------------- card reports

  [Fact]
  public async Task CardReports_StoreAndListTheDisplayLocale()
  {
    var saved = (Environment.GetEnvironmentVariable(CardReports.EnabledEnv), Environment.GetEnvironmentVariable(CardReports.AiTriageEnv),
      Environment.GetEnvironmentVariable(WebhookEvents.QueueUrlEnv), WebhookEvents.TestSendSeam);
    Environment.SetEnvironmentVariable(CardReports.EnabledEnv, "1");
    Environment.SetEnvironmentVariable(CardReports.AiTriageEnv, "0");
    Environment.SetEnvironmentVariable(WebhookEvents.QueueUrlEnv, AutomationTestKit.FakeWebhookQueueUrl);
    WebhookEvents.TestSendSeam = _ => Task.CompletedTask;
    try
    {
      var (deckId, slug) = await AutomationTestKit.NewDeckAsync(_db, "tr-report");
      var uid = AutomationTestKit.Uid("tr-report");
      await AutomationTestKit.NewCardAsync(_db, deckId, uid, "Synthetic reported question?");
      var learner = new AuthContext(Claims: new Dictionary<string, JsonElement>(), UserSub: NewSub(), Username: null, Groups: [], IsSuperAdmin: false,
        IsEditor: false, IsAdmin: false);

      var bad = await AutomationTestKit.CallAsync(CardReports.HandleUser, "POST", "/api/v1/user/card-reports",
        new { deckSlug = slug, stableUid = uid, reason = "typo", displayLocale = "zh-cn" }, learner);
      Assert.Equal("VALIDATION_ERROR", Error(bad, 400).Code);

      var reportId = Data(await AutomationTestKit.CallAsync(CardReports.HandleUser, "POST", "/api/v1/user/card-reports",
        new { deckSlug = slug, stableUid = uid, reason = "typo", displayLocale = "zh-CN" }, learner)).GetProperty("reportId").GetInt64();
      Assert.Equal("zh-CN", await _db.ScalarAsync("select display_locale from card_reports where id = $1", reportId));

      // The anonymous route takes it too (it refuses every other unknown key).
      AnonymousCardReports.ResetBudget();
      var anon = await AutomationTestKit.CallAsync((q, r, _) => AnonymousCardReports.HandleCreate(q, r), "POST", AnonymousCardReports.RoutePath,
        new { deckSlug = slug, stableUid = uid, reason = "unclear", appVersion = "2.1.0", displayLocale = "en" }, learner);
      Assert.Equal(202, anon.StatusCode);
      Assert.Equal("en", await _db.ScalarAsync(
        "select display_locale from card_reports where user_sub is null and deck_slug = $1 and stable_uid = $2", slug, uid));

      var items = Data(await AutomationTestKit.CallAsync(CardReports.HandleAdminList, "GET", "/api/v1/admin/card-reports", null, SuperAdmin(),
        new Dictionary<string, string> { ["deckId"] = deckId.ToString(CultureInfo.InvariantCulture) })).GetProperty("items").EnumerateArray().ToList();
      Assert.Equal(new[] { "en", "zh-CN" }, items.Select(i => i.GetProperty("displayLocale").GetString()).ToArray());
    }
    finally
    {
      Environment.SetEnvironmentVariable(CardReports.EnabledEnv, saved.Item1);
      Environment.SetEnvironmentVariable(CardReports.AiTriageEnv, saved.Item2);
      Environment.SetEnvironmentVariable(WebhookEvents.QueueUrlEnv, saved.Item3);
      WebhookEvents.TestSendSeam = saved.Item4;
    }
  }
}
