using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// cards.source (J01, migration 026) end to end against a real Postgres: the NormalizeSource rules
/// as a generated [Theory] table, POST/PUT/GET/page/import/preview on the authoring API, the
/// Worker's LoadCardsAsync on a full schema and its 42703 fallback on a pre-026 schema, and the
/// migration's idempotence.
/// </summary>
[Collection(PostgresCollection.Name)]
public class SourceFieldTests
{
  private readonly PostgresFixture _db;

  private const string CardsPath = "/api/v1/authoring/cards";
  private const string PagePath = "/api/v1/authoring/cards/page";
  private const string ImportPath = "/api/v1/authoring/cards/import";
  private const string PublishPath = "/api/v1/authoring/publish";

  private const string UrlMessage = "source.url must be an https URL (max 2048)";
  private const string QuoteTypeMessage = "source.quote must be a string or null";
  private const string QuoteLengthMessage = "source.quote too long (max 1000)";
  private const string ObjectMessage = "source must be an object";

  public SourceFieldTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- helpers

  private static string NewSub() => $"it-j01-{Guid.NewGuid():N}";

  private async Task<long> NewDeckAsync(string tag)
  {
    var rows = await _db.QueryAsync(
      "insert into decks (slug, title, author) values ($1, $2, $3) returning id",
      $"it-j01-{tag}-{Guid.NewGuid():N}", $"deck {tag}", "tests");
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private static JsonElement Event(string method, string path, IDictionary<string, string>? query, string? body)
  {
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method },
        authorizer = new
        {
          jwt = new
          {
            claims = new Dictionary<string, object>(StringComparer.Ordinal)
            {
              ["sub"] = NewSub(),
              ["cognito:groups"] = new[] { "super_admin" },
            },
          },
        },
      },
      headers = new Dictionary<string, string>(),
      queryStringParameters = query ?? new Dictionary<string, string>(),
      body,
      isBase64Encoded = false,
    });
  }

  private static async Task<APIGatewayProxyResponse> CardsAsync(string method, IDictionary<string, string>? query, string? body)
  {
    var req = new LambdaRequest(Event(method, CardsPath, query, body));
    var res = new Res(req.TraceId);
    return await Cards.HandleAuthoringCards(req, res, await Auth.GetAuthContextAsync(req));
  }

  private static async Task<APIGatewayProxyResponse> PageAsync(long deckId)
  {
    var query = new Dictionary<string, string>(StringComparer.Ordinal)
    {
      ["deckId"] = deckId.ToString(CultureInfo.InvariantCulture),
      ["limit"] = "50",
    };
    var req = new LambdaRequest(Event("GET", PagePath, query, null));
    var res = new Res(req.TraceId);
    return await CardsPage.HandleAuthoringCardsPage(req, res, await Auth.GetAuthContextAsync(req));
  }

  private static async Task<APIGatewayProxyResponse> ImportAsync(long deckId, object[] cards)
  {
    var req = new LambdaRequest(Event("POST", ImportPath, null, JsonSerializer.Serialize(new { deckId, cards })));
    var res = new Res(req.TraceId);
    return await CardsImport.HandleCardsImport(req, res, await Auth.GetAuthContextAsync(req));
  }

  private static async Task<APIGatewayProxyResponse> PreviewAsync(long deckId)
  {
    var query = new Dictionary<string, string>(StringComparer.Ordinal) { ["mode"] = "preview" };
    var req = new LambdaRequest(Event("POST", PublishPath, query, JsonSerializer.Serialize(new { deckId })));
    var res = new Res(req.TraceId);
    return await Publish.HandleAuthoringPublish(req, res, await Auth.GetAuthContextAsync(req));
  }

  private static JsonElement Data(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("data").Clone();

  private static string? ErrorCode(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("error").GetProperty("code").GetString();

  private static string? ErrorMessage(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("error").GetProperty("message").GetString();

  private static void AssertOk(APIGatewayProxyResponse response, string what) =>
    Assert.True(response.StatusCode == 200, $"{what} returned {response.StatusCode}: {response.Body}");

  /// <summary>POSTs a card; includeSource: false omits the key entirely.</summary>
  private static async Task<APIGatewayProxyResponse> PostCardAsync(long deckId, int orderInDeck, object? source, bool includeSource = true)
  {
    var body = new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["deckId"] = deckId,
      ["stableUid"] = $"uid-{Guid.NewGuid():N}",
      ["question"] = "q",
      ["orderInDeck"] = orderInDeck,
    };
    if (includeSource) body["source"] = source;
    return await CardsAsync("POST", null, JsonSerializer.Serialize(body));
  }

  private static Task<APIGatewayProxyResponse> PutCardAsync(Dictionary<string, object?> body) =>
    CardsAsync("PUT", null, JsonSerializer.Serialize(body));

  private static object ImportCard(string uid, int order, object? source, bool includeSource = true)
  {
    var card = new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["stableUid"] = uid,
      ["question"] = "q",
      ["explanation"] = "a",
      ["orderInDeck"] = order,
      ["difficulty"] = 2,
    };
    if (includeSource) card["source"] = source;
    return card;
  }

  /// <summary>Asserts a wire source object: keys exactly url, quote in that order.</summary>
  private static void AssertSource(JsonElement card, string url, string? quote)
  {
    Assert.True(card.TryGetProperty("source", out var src), "card is missing the source key");
    Assert.Equal(JsonValueKind.Object, src.ValueKind);
    Assert.Equal(new[] { "url", "quote" }, src.EnumerateObject().Select(p => p.Name).ToArray());
    Assert.Equal(url, src.GetProperty("url").GetString());
    if (quote is null) Assert.Equal(JsonValueKind.Null, src.GetProperty("quote").ValueKind);
    else Assert.Equal(quote, src.GetProperty("quote").GetString());
  }

  private static void AssertNullSource(JsonElement card)
  {
    Assert.True(card.TryGetProperty("source", out var src), "card is missing the source key");
    Assert.Equal(JsonValueKind.Null, src.ValueKind);
  }

  private async Task<string?> DbSourceAsync(long id)
  {
    var rows = await _db.QueryAsync("select source::text as s from cards where id = $1", id);
    return rows[0]["s"] as string;
  }

  // ------------------------------------------------------- NormalizeSource

  private static string Canonical(string url, string? quote) =>
    "{\"url\":" + JsonSerializer.Serialize(url) + ",\"quote\":" + (quote is null ? "null" : JsonSerializer.Serialize(quote)) + "}";

  private static string Obj(object? url, object? quote) => JsonSerializer.Serialize(new { url, quote });

  /// <summary>
  /// Generated rule table: (input JSON, expected canonical string or null, expected ValidationError
  /// message or null). Exactly one of the last two is set unless the input normalises to null.
  /// </summary>
  public static IEnumerable<object?[]> SourceCases()
  {
    const string u = "https://docs.aws.amazon.com/AmazonS3/latest/userguide/restoring-objects-retrieval-options.html";
    var cases = new List<object?[]>
    {
      // Null → null.
      new object?[] { "null", null, null },
    };

    // Valid url with every quote shape, with and without surrounding whitespace on the url.
    var paddings = new[] { "", " ", "  ", "\t", "\n ", " \r\n" };
    foreach (var pad in paddings)
    {
      cases.Add(new object?[] { Obj(pad + u + pad, null), Canonical(u, null), null });
      cases.Add(new object?[] { Obj(pad + u + pad, "quote"), Canonical(u, "quote"), null });
      cases.Add(new object?[] { Obj(pad + u + pad, pad + "padded quote" + pad), Canonical(u, "padded quote"), null });
      cases.Add(new object?[] { Obj(u, pad), Canonical(u, null), null });
    }

    cases.Add(new object?[] { JsonSerializer.Serialize(new { url = u }), Canonical(u, null), null });
    cases.Add(new object?[] { Obj(u, "line one\nline two"), Canonical(u, "line one\nline two"), null });
    cases.Add(new object?[] { Obj(u, "  line one\n\nline two  "), Canonical(u, "line one\n\nline two"), null });
    cases.Add(new object?[] { JsonSerializer.Serialize(new { quote = "q", url = u }), Canonical(u, "q"), null });
    cases.Add(new object?[] { Obj("https://x", null), Canonical("https://x", null), null });

    // url length boundaries (after trim).
    var url2048 = "https://" + new string('a', 2048 - 8);
    var url2049 = "https://" + new string('a', 2049 - 8);
    cases.Add(new object?[] { Obj(url2048, null), Canonical(url2048, null), null });
    cases.Add(new object?[] { Obj("  " + url2048 + "  ", null), Canonical(url2048, null), null });
    cases.Add(new object?[] { Obj(url2049, null), null, UrlMessage });

    // quote length boundaries (after trim).
    var quote1000 = new string('q', 1000);
    var quote1001 = new string('q', 1001);
    cases.Add(new object?[] { Obj(u, quote1000), Canonical(u, quote1000), null });
    cases.Add(new object?[] { Obj(u, "   " + quote1000 + "   "), Canonical(u, quote1000), null });
    cases.Add(new object?[] { Obj(u, quote1001), null, QuoteLengthMessage });

    // Bad urls.
    foreach (var bad in new[] { "http://docs.aws.amazon.com/x", "ftp://docs.aws.amazon.com/x", "https://docs.aws.amazon.com/a b", "https://", "  https://  ", "HTTPS://x", "docs.aws.amazon.com", "", "   ", "https://a\tb", "mailto:x@example.com" })
    {
      cases.Add(new object?[] { Obj(bad, null), null, UrlMessage });
    }
    cases.Add(new object?[] { """{"quote":"q"}""", null, UrlMessage });
    cases.Add(new object?[] { "{}", null, UrlMessage });
    foreach (var badUrl in new[] { "null", "42", "true", "[]", "{}", """["https://x"]""" })
    {
      cases.Add(new object?[] { "{\"url\":" + badUrl + "}", null, UrlMessage });
    }
    // The url check runs before the quote check.
    cases.Add(new object?[] { "{\"url\":\"http://x\",\"quote\":1}", null, UrlMessage });

    // Non-string quote.
    foreach (var badQuote in new[] { "1", "true", "false", "[]", "{}", "[\"q\"]", "0.5" })
    {
      cases.Add(new object?[] { "{\"url\":\"https://x\",\"quote\":" + badQuote + "}", null, QuoteTypeMessage });
    }

    // Non-object kinds.
    foreach (var kind in new[] { "\"https://x\"", "\"\"", "42", "0", "[]", "[{\"url\":\"https://x\"}]", "true", "false" })
    {
      cases.Add(new object?[] { kind, null, ObjectMessage });
    }

    // Unknown keys (first offending key in document order), checked before url/quote.
    cases.Add(new object?[] { "{\"url\":\"https://x\",\"title\":\"t\"}", null, "source has unknown key title" });
    cases.Add(new object?[] { "{\"title\":\"t\",\"url\":\"https://x\"}", null, "source has unknown key title" });
    cases.Add(new object?[] { "{\"a\":1,\"b\":2}", null, "source has unknown key a" });
    cases.Add(new object?[] { "{\"url\":1,\"extra\":2}", null, "source has unknown key extra" });
    cases.Add(new object?[] { "{\"url\":\"https://x\",\"quote\":1,\"Url\":\"https://y\"}", null, "source has unknown key Url" });
    cases.Add(new object?[] { "{\"URL\":\"https://x\"}", null, "source has unknown key URL" });

    return cases;
  }

  [Fact]
  public void NormalizeSource_GeneratedCases_AreAtLeastFifty() =>
    Assert.True(SourceCases().Count() >= 50, $"only {SourceCases().Count()} generated cases");

  [Theory]
  [MemberData(nameof(SourceCases))]
  public void NormalizeSource_GeneratedCases_MatchRules(string input, string? expected, string? expectedMessage)
  {
    using var doc = JsonDocument.Parse(input);
    if (expectedMessage is null)
    {
      Assert.Equal(expected, Helpers.NormalizeSource(doc.RootElement));

      // The body-level wrapper agrees, and an absent key is null.
      using var body = JsonDocument.Parse("{\"source\":" + input + "}");
      Assert.Equal(expected, Helpers.ParseOptionalSource(body.RootElement));
      using var empty = JsonDocument.Parse("{}");
      Assert.Null(Helpers.ParseOptionalSource(empty.RootElement));
    }
    else
    {
      var ex = Assert.Throws<ValidationError>(() => Helpers.NormalizeSource(doc.RootElement));
      Assert.Equal(expectedMessage, ex.Message);
      Assert.Equal("source", ex.Field);
    }
  }

  // ------------------------------------------------------------ POST / PUT

  [Fact]
  public async Task PostCard_WithSource_ReturnsCanonicalSource()
  {
    var deckId = await NewDeckAsync("post");
    var response = await PostCardAsync(deckId, 1, new
    {
      url = "  https://docs.aws.amazon.com/AmazonS3/latest/userguide/restoring-objects-retrieval-options.html  ",
      quote = "  line one\nline two  ",
    });
    AssertOk(response, "POST cards");

    var data = Data(response);
    AssertSource(data, "https://docs.aws.amazon.com/AmazonS3/latest/userguide/restoring-objects-retrieval-options.html", "line one\nline two");

    // source is the last key of the card.
    Assert.Equal("source", data.EnumerateObject().Last().Name);

    var stored = await DbSourceAsync(data.GetProperty("id").GetInt64());
    Assert.NotNull(stored);
    Assert.Contains("line one\\nline two", stored!, StringComparison.Ordinal);
  }

  [Fact]
  public async Task PostCard_WithoutSource_ReturnsNullSource()
  {
    var deckId = await NewDeckAsync("post-none");

    var absent = await PostCardAsync(deckId, 1, null, includeSource: false);
    AssertOk(absent, "POST cards");
    AssertNullSource(Data(absent));
    Assert.Null(await DbSourceAsync(Data(absent).GetProperty("id").GetInt64()));

    var explicitNull = await PostCardAsync(deckId, 2, null);
    AssertOk(explicitNull, "POST cards");
    AssertNullSource(Data(explicitNull));
  }

  [Fact]
  public async Task PutCard_SetsKeepsAndClearsSource()
  {
    var deckId = await NewDeckAsync("put");
    var post = await PostCardAsync(deckId, 1, null, includeSource: false);
    AssertOk(post, "POST cards");
    var id = Data(post).GetProperty("id").GetInt64();

    var set = await PutCardAsync(new Dictionary<string, object?>
    {
      ["id"] = id,
      ["expectedVersion"] = 1,
      ["source"] = new { url = " https://example.com/doc ", quote = " q " },
    });
    AssertOk(set, "PUT cards (set)");
    AssertSource(Data(set), "https://example.com/doc", "q");
    Assert.Equal(2, Data(set).GetProperty("version").GetInt32());

    var keep = await PutCardAsync(new Dictionary<string, object?> { ["id"] = id, ["expectedVersion"] = 2, ["question"] = "q2" });
    AssertOk(keep, "PUT cards (keep)");
    AssertSource(Data(keep), "https://example.com/doc", "q");
    Assert.Equal("q2", Data(keep).GetProperty("question").GetString());

    var clear = await PutCardAsync(new Dictionary<string, object?> { ["id"] = id, ["expectedVersion"] = 3, ["source"] = null });
    AssertOk(clear, "PUT cards (clear)");
    AssertNullSource(Data(clear));
    Assert.Null(await DbSourceAsync(id));
  }

  [Fact]
  public async Task PutCard_InvalidSource_Is400WithContractMessage()
  {
    var deckId = await NewDeckAsync("put-bad");
    var post = await PostCardAsync(deckId, 1, new { url = "https://example.com/keep", quote = (string?)null });
    AssertOk(post, "POST cards");
    var id = Data(post).GetProperty("id").GetInt64();

    var cases = new (object Source, string Message)[]
    {
      (new { url = "http://example.com" }, UrlMessage),
      ("https://example.com", ObjectMessage),
      (new { url = "https://example.com", note = "x" }, "source has unknown key note"),
      (new { url = "https://example.com", quote = 5 }, QuoteTypeMessage),
      (new { url = "https://example.com", quote = new string('q', 1001) }, QuoteLengthMessage),
    };

    foreach (var (source, message) in cases)
    {
      var put = await PutCardAsync(new Dictionary<string, object?> { ["id"] = id, ["expectedVersion"] = 1, ["source"] = source });
      Assert.Equal(400, put.StatusCode);
      Assert.Equal("VALIDATION_ERROR", ErrorCode(put));
      Assert.Equal(message, ErrorMessage(put));
    }

    // Nothing was written: version and source unchanged.
    var rows = await _db.QueryAsync("select version, source->>'url' as url from cards where id = $1", id);
    Assert.Equal(1, Convert.ToInt32(rows[0]["version"], CultureInfo.InvariantCulture));
    Assert.Equal("https://example.com/keep", rows[0]["url"] as string);

    // POST gets the same validation.
    var badPost = await PostCardAsync(deckId, 2, new { url = "ftp://example.com" });
    Assert.Equal(400, badPost.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(badPost));
    Assert.Equal(UrlMessage, ErrorMessage(badPost));
  }

  // ------------------------------------------------------------ GET / page

  [Fact]
  public async Task GetAndPage_IncludeSource()
  {
    var deckId = await NewDeckAsync("get");
    AssertOk(await PostCardAsync(deckId, 1, new { url = "https://example.com/a", quote = "qa" }), "POST cards");
    AssertOk(await PostCardAsync(deckId, 2, null, includeSource: false), "POST cards");

    var get = await CardsAsync("GET", new Dictionary<string, string> { ["deckId"] = deckId.ToString(CultureInfo.InvariantCulture) }, null);
    AssertOk(get, "GET cards");
    var items = Data(get).EnumerateArray().ToList();
    Assert.Equal(2, items.Count);
    AssertSource(items[0], "https://example.com/a", "qa");
    AssertNullSource(items[1]);

    var page = await PageAsync(deckId);
    AssertOk(page, "GET cards/page");
    var pageItems = Data(page).GetProperty("items").EnumerateArray().ToList();
    Assert.Equal(2, pageItems.Count);
    AssertSource(pageItems[0], "https://example.com/a", "qa");
    AssertNullSource(pageItems[1]);
  }

  // ---------------------------------------------------------------- import

  [Fact]
  public async Task Import_WithSource_IsIdempotent()
  {
    var deckId = await NewDeckAsync("imp-idem");
    var cards = new[]
    {
      ImportCard("a", 1, new { url = " https://example.com/a ", quote = "line one\nline two" }),
      ImportCard("b", 2, new { url = "https://example.com/b", quote = (string?)null }),
      ImportCard("c", 3, null, includeSource: false),
    };

    var first = await ImportAsync(deckId, cards);
    AssertOk(first, "import #1");
    Assert.Equal(3, Data(first).GetProperty("created").GetInt32());

    var second = await ImportAsync(deckId, cards);
    AssertOk(second, "import #2");
    var data = Data(second);
    Assert.Equal(0, data.GetProperty("created").GetInt32());
    Assert.Equal(0, data.GetProperty("updated").GetInt32());
    Assert.Equal(3, data.GetProperty("unchanged").GetInt32());
    foreach (var c in data.GetProperty("cards").EnumerateArray())
    {
      Assert.Equal("unchanged", c.GetProperty("action").GetString());
    }

    var rows = await _db.QueryAsync(
      "select stable_uid as uid, version, source->>'url' as url from cards where deck_id = $1 order by order_in_deck", deckId);
    Assert.All(rows, r => Assert.Equal(1, Convert.ToInt32(r["version"], CultureInfo.InvariantCulture)));
    Assert.Equal("https://example.com/a", rows[0]["url"] as string);
    Assert.Null(rows[2]["url"]);
  }

  [Fact]
  public async Task Import_SourceOnlyChange_UpdatesCard()
  {
    var deckId = await NewDeckAsync("imp-change");
    AssertOk(await ImportAsync(deckId, new[] { ImportCard("a", 1, new { url = "https://example.com/a", quote = "old" }) }), "import #1");

    var changed = await ImportAsync(deckId, new[] { ImportCard("a", 1, new { url = "https://example.com/a", quote = "new" }) });
    AssertOk(changed, "import #2");
    Assert.Equal(1, Data(changed).GetProperty("updated").GetInt32());
    Assert.Equal("updated", Data(changed).GetProperty("cards")[0].GetProperty("action").GetString());

    var rows = await _db.QueryAsync("select version, source->>'quote' as quote from cards where deck_id = $1", deckId);
    Assert.Equal(2, Convert.ToInt32(rows[0]["version"], CultureInfo.InvariantCulture));
    Assert.Equal("new", rows[0]["quote"] as string);

    // Whole-file import: omitting source clears the stored one.
    var cleared = await ImportAsync(deckId, new[] { ImportCard("a", 1, null, includeSource: false) });
    AssertOk(cleared, "import #3");
    Assert.Equal("updated", Data(cleared).GetProperty("cards")[0].GetProperty("action").GetString());

    rows = await _db.QueryAsync("select version, source from cards where deck_id = $1", deckId);
    Assert.Equal(3, Convert.ToInt32(rows[0]["version"], CultureInfo.InvariantCulture));
    Assert.Null(rows[0]["source"]);
  }

  [Fact]
  public async Task Import_InvalidSource_Is400AndWritesNothing()
  {
    var deckId = await NewDeckAsync("imp-bad");
    var response = await ImportAsync(deckId, new[]
    {
      ImportCard("ok", 1, new { url = "https://example.com/ok" }),
      ImportCard("bad", 2, new { url = "http://example.com/bad" }),
    });

    Assert.Equal(400, response.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(response));
    Assert.Equal($"cards[1] (bad): {UrlMessage}", ErrorMessage(response));

    var count = await _db.ScalarAsync("select count(*) from cards where deck_id = $1", deckId);
    Assert.Equal(0, Convert.ToInt32(count, CultureInfo.InvariantCulture));
  }

  // --------------------------------------------------------------- preview

  [Fact]
  public async Task PublishPreview_LegacyCard_ShowsNullSource()
  {
    var deckId = await NewDeckAsync("preview");
    AssertOk(await PostCardAsync(deckId, 1, null, includeSource: false), "POST cards");
    AssertOk(await PostCardAsync(deckId, 2, new { url = "https://example.com/p", quote = "pq" }), "POST cards");

    var preview = await PreviewAsync(deckId);
    AssertOk(preview, "publish preview");
    var cards = Data(preview).GetProperty("export").GetProperty("cards").EnumerateArray().ToList();
    Assert.Equal(2, cards.Count);
    AssertNullSource(cards[0]);
    AssertSource(cards[1], "https://example.com/p", "pq");
  }

  // ---------------------------------------------------------------- Worker

  [Fact]
  public async Task LoadCards_WithSource_MapsSourceElement()
  {
    await using var conn = await _db.OpenAsync();
    var deckId = (int)await NewDeckAsync("worker");
    await DbUtil.ExecuteAsync(
      conn, null,
      "insert into cards (deck_id, stable_uid, question, order_in_deck, source) values ($1, $2, $3, $4, $5::jsonb)",
      [deckId, "sourced", "q", 1, """{"url":"https://example.com/w","quote":null}"""]);
    await DbUtil.ExecuteAsync(
      conn, null,
      "insert into cards (deck_id, stable_uid, question, order_in_deck) values ($1, $2, $3, $4)",
      [deckId, "legacy", "q", 2]);

    var cards = await PublishJobProcessor.LoadCardsAsync(conn, deckId);

    Assert.Equal(2, cards.Count);
    var sourced = cards[0];
    Assert.Equal("sourced", sourced.StableUid);
    Assert.NotNull(sourced.Source);
    Assert.Equal(JsonValueKind.Object, sourced.Source!.Value.ValueKind);
    Assert.Equal("https://example.com/w", sourced.Source.Value.GetProperty("url").GetString());
    Assert.Equal(JsonValueKind.Null, sourced.Source.Value.GetProperty("quote").ValueKind);

    Assert.Equal("legacy", cards[1].StableUid);
    Assert.Null(cards[1].Source);
  }

  [Fact]
  public async Task LoadCards_Pre026Schema_FallsBackWithoutSource()
  {
    var connectionString = await _db.CreateScratchDatabaseAsync("j01_pre026");

    await using var conn = new NpgsqlConnection(connectionString);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, maxVersion: 25);

    var deckRows = await DbUtil.QueryAsync(
      conn, null,
      "insert into decks (slug, title, author) values ($1, $2, $3) returning id",
      [$"it-j01-pre026-{Guid.NewGuid():N}", "deck pre026", "tests"]);
    var deckId = (int)Convert.ToInt64(deckRows[0]["id"], CultureInfo.InvariantCulture);

    const string mcq =
      """{"v":1,"qualifier":null,"shuffle":true,"options":[{"key":"a","text":"queue","why":null,"correct":true},{"key":"b","text":"resize","why":"no buffer","correct":false}]}""";
    await DbUtil.ExecuteAsync(
      conn, null,
      "insert into cards (deck_id, stable_uid, question, explanation, order_in_deck, topic, mcq) values ($1, $2, $3, $4, $5, $6, $7::jsonb)",
      [deckId, "uid-1", "q", "e", 1, "t", mcq]);

    var cards = await PublishJobProcessor.LoadCardsAsync(conn, deckId);

    var card = Assert.Single(cards);
    Assert.Equal("t", card.Topic);
    Assert.NotNull(card.Mcq);
    Assert.Equal(JsonValueKind.Object, card.Mcq!.Value.ValueKind);
    Assert.Equal(2, card.Mcq.Value.GetProperty("options").GetArrayLength());
    Assert.Null(card.Source);
  }

  // ------------------------------------------------------------- migration

  [Fact]
  public async Task Migration026_IsIdempotent()
  {
    var path = Path.Combine(AppContext.BaseDirectory, "Db", "Migrations", "026_cards_source.sql");
    var sql = await File.ReadAllTextAsync(path);

    await using var conn = await _db.OpenAsync();
    await DbUtil.ExecuteAsync(conn, null, sql, []);

    var rows = await DbUtil.QueryAsync(
      conn, null,
      "select data_type, is_nullable from information_schema.columns where table_name = 'cards' and column_name = 'source'",
      []);
    var row = Assert.Single(rows);
    Assert.Equal("jsonb", row["data_type"] as string);
    Assert.Equal("YES", row["is_nullable"] as string);
  }
}
