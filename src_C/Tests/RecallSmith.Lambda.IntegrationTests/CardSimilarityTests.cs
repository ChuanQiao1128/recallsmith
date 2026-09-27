using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// POST /api/v1/authoring/cards/similar (J10) against the shared Postgres, where migration 029 installed
/// pg_trgm. The shared database holds every other test's cards, so each test makes its own decks and scopes
/// its request by deckSlug or by an editor's own permission rows. Card text is plainly synthetic.
/// </summary>
[Collection(PostgresCollection.Name)]
public class CardSimilarityTests
{
  private readonly PostgresFixture _db;

  public CardSimilarityTests(PostgresFixture db) => _db = db;

  private const string Path = "/api/v1/authoring/cards/similar";

  private static readonly string[] SyntheticQuestions =
  [
    "glacier restore tier alpha",
    "glacier deep archive restore tier alpha",
    "queue dead letter beta",
    "lambda cold start gamma",
  ];

  // ---------------------------------------------------------------- helpers

  private sealed record Deck(long Id, string Slug);

  private async Task<Deck> NewDeckAsync(string tag)
  {
    var slug = $"it-j10-{tag}-{Guid.NewGuid():N}";
    var rows = await _db.QueryAsync(
      "insert into decks (slug, title, author) values ($1, $2, $3) returning id",
      slug, $"deck {tag}", "tests");
    return new Deck(Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture), slug);
  }

  private async Task<long> NewCardAsync(long deckId, int order, string question)
  {
    var rows = await _db.QueryAsync(
      "insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck) values ($1, $2, $3, $4, $5, $6) returning id",
      deckId, $"j10-{order}-{Guid.NewGuid():N}", question, "synthetic", 1, order);
    return Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);
  }

  private async Task<(Deck Deck, List<long> CardIds)> SyntheticDeckAsync(string tag)
  {
    var deck = await NewDeckAsync(tag);
    var ids = new List<long>();
    for (var i = 0; i < SyntheticQuestions.Length; i++) ids.Add(await NewCardAsync(deck.Id, i + 1, SyntheticQuestions[i]));
    return (deck, ids);
  }

  private static JsonElement Event(string method, string sub, string[] groups, string? body)
  {
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = Path,
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
              ["sub"] = sub,
              ["cognito:groups"] = groups,
            },
          },
        },
      },
      headers = new Dictionary<string, string>(),
      queryStringParameters = new Dictionary<string, string>(),
      body,
      isBase64Encoded = false,
    });
  }

  private static async Task<APIGatewayProxyResponse> CallAsync(object? body, string[]? groups = null, string? sub = null, string method = "POST")
  {
    var raw = body switch
    {
      null => null,
      string s => s,
      _ => JsonSerializer.Serialize(body),
    };
    var req = new LambdaRequest(Event(method, sub ?? $"it-j10-{Guid.NewGuid():N}", groups ?? ["super_admin"], raw));
    var res = new Res(req.TraceId);
    var auth = await Auth.GetAuthContextAsync(req);
    return await CardSimilarity.HandleSimilar(req, res, auth);
  }

  private static JsonElement Data(APIGatewayProxyResponse response)
  {
    Assert.True(response.StatusCode == 200, $"handler returned {response.StatusCode}: {response.Body}");
    using var doc = JsonDocument.Parse(response.Body!);
    return doc.RootElement.GetProperty("data").Clone();
  }

  private static string ErrorCode(APIGatewayProxyResponse response)
  {
    using var doc = JsonDocument.Parse(response.Body!);
    return doc.RootElement.GetProperty("error").GetProperty("code").GetString()!;
  }

  private static List<(long CardId, double Similarity, bool LikelyDuplicate)> Tuples(JsonElement data) =>
    data.GetProperty("matches").EnumerateArray()
      .Select(m => (m.GetProperty("cardId").GetInt64(), m.GetProperty("similarity").GetDouble(), m.GetProperty("likelyDuplicate").GetBoolean()))
      .ToList();

  private static void AssertSorted(List<(long CardId, double Similarity, bool LikelyDuplicate)> matches)
  {
    for (var i = 1; i < matches.Count; i++)
    {
      var prev = matches[i - 1];
      var cur = matches[i];
      Assert.True(
        prev.Similarity > cur.Similarity || (prev.Similarity == cur.Similarity && prev.CardId < cur.CardId),
        $"matches out of order at {i}: {prev} then {cur}");
    }
  }

  // ---------------------------------------------------------------- engines

  [Fact]
  public async Task Similar_PgTrgmEngine_ReturnsMatchesSortedAboveThreshold()
  {
    var (deck, ids) = await SyntheticDeckAsync("pgtrgm");
    const string text = "Glacier restore tier alpha?";

    CardSimilarity.ResetEngineCache();
    try
    {
      var data = Data(await CallAsync(new { text, deckSlug = deck.Slug, threshold = 0.3 }));
      Assert.Equal("pg_trgm", data.GetProperty("engine").GetString());
      Assert.Equal(0.3, data.GetProperty("threshold").GetDouble());

      var matches = Tuples(data);
      Assert.NotEmpty(matches);
      Assert.All(matches, m => Assert.True(m.Similarity >= 0.3, $"{m} below threshold"));
      AssertSorted(matches);

      // Punctuation is not a word character, so the question mark changes nothing.
      Assert.Equal(ids[0], matches[0].CardId);
      Assert.Equal(1.0, matches[0].Similarity);

      foreach (var m in matches)
      {
        var pg = await _db.ScalarAsync(
          "select round(similarity(question, $1)::numeric, 4) from cards where id = $2", text, m.CardId);
        Assert.Equal(Convert.ToDouble(pg, CultureInfo.InvariantCulture), m.Similarity);
      }

      var first = data.GetProperty("matches")[0];
      Assert.Equal(deck.Id, first.GetProperty("deckId").GetInt64());
      Assert.Equal(deck.Slug, first.GetProperty("deckSlug").GetString());
      Assert.Equal(SyntheticQuestions[0], first.GetProperty("question").GetString());
      Assert.StartsWith("j10-1-", first.GetProperty("stableUid").GetString(), StringComparison.Ordinal);
    }
    finally
    {
      CardSimilarity.ResetEngineCache();
    }
  }

  [Fact]
  public async Task Similar_FallbackEngine_MatchesPgTrgmEngine()
  {
    var (deck, _) = await SyntheticDeckAsync("parity");
    await NewCardAsync(deck.Id, 5, "Glacier-restore (tier) alpha, S3?");
    await NewCardAsync(deck.Id, 6, "dead letter queue retry beta");

    string[] texts = ["glacier restore tier alpha", "Which queue holds dead letters?", "lambda cold-start S3 gamma", "restore"];
    double[] thresholds = [0, 0.3, 0.6];

    try
    {
      foreach (var text in texts)
      {
        foreach (var threshold in thresholds)
        {
          CardSimilarity.TestForceEngine = CardSimilarity.EnginePgTrgm;
          var pg = Data(await CallAsync(new { text, deckSlug = deck.Slug, threshold, limit = 20 }));
          CardSimilarity.TestForceEngine = CardSimilarity.EngineFallback;
          var fb = Data(await CallAsync(new { text, deckSlug = deck.Slug, threshold, limit = 20 }));

          Assert.Equal("pg_trgm", pg.GetProperty("engine").GetString());
          Assert.Equal("fallback", fb.GetProperty("engine").GetString());
          Assert.Equal(Tuples(pg), Tuples(fb));
          if (threshold == 0) Assert.Equal(6, Tuples(fb).Count);
        }
      }
    }
    finally
    {
      CardSimilarity.TestForceEngine = null;
      CardSimilarity.ResetEngineCache();
    }
  }

  [Fact]
  public async Task PgTrgmQuery_FiltersThroughTheTrigramIndex()
  {
    // backend-design-7: a similarity(...) >= $n predicate cannot be an index condition of idx_cards_question_trgm
    // (at best the partial index is read whole); the % operator under pg_trgm.similarity_threshold can. Whether the
    // planner prefers the index depends on table size, so the competing paths are removed inside a rolled-back
    // transaction (sequential scans, plain index scans and nested loops off, the is_deleted btree dropped) and the plan must show the
    // trigram index doing the filtering.
    var text = "glacier restore tier alpha";
    var (sql, parameters, usesIndex) = CardSimilarity.BuildPgTrgmQuery(text, new SimilarityQuery(text, null), 5, 0.3);
    Assert.True(usesIndex);

    await using var conn = await _db.OpenAsync();
    await using var tx = await conn.BeginTransactionAsync();
    var deckId = Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, tx,
      "insert into decks (slug, title, author) values ($1, 'deck j10 plan', 'tests') returning id", [$"it-j10-plan-{Guid.NewGuid():N}"]),
      CultureInfo.InvariantCulture);
    await DbUtil.ExecuteAsync(conn, tx,
      """
      insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck)
      select $1, 'plan-' || g, 'synthetic filler ' || md5(g::text) || ' question ' || g, 'synthetic explanation', 2, g
      from generate_series(1, 2000) g
      """,
      [deckId]);
    await DbUtil.ExecuteAsync(conn, tx, "analyze cards", []);
    await DbUtil.ExecuteAsync(conn, tx, "drop index idx_cards_is_deleted", []);
    await DbUtil.ExecuteAsync(conn, tx, "set local enable_seqscan = off", []);
    await DbUtil.ExecuteAsync(conn, tx, "set local enable_indexscan = off", []);
    await DbUtil.ExecuteAsync(conn, tx, "set local enable_nestloop = off", []);
    await DbUtil.ExecuteAsync(conn, tx, "select set_config('pg_trgm.similarity_threshold', $1, true)", [CardSimilarity.ThresholdSetting(0.3)]);
    var plan = string.Join("\n", (await DbUtil.QueryAsync(conn, tx, "explain " + sql, parameters)).Select(r => r["QUERY PLAN"] as string));
    await tx.RollbackAsync();

    Assert.True(plan.Contains("Bitmap Index Scan on idx_cards_question_trgm", StringComparison.Ordinal), plan);
    Assert.True(plan.Contains("Index Cond: (question % ", StringComparison.Ordinal), plan);

    // A threshold of 0 matches cards that share no trigram (absent from the index), so it keeps the plain predicate.
    Assert.False(CardSimilarity.BuildPgTrgmQuery(text, new SimilarityQuery(text, null), 5, 0).UsesIndex);
  }

  [Fact]
  public async Task Similar_ThresholdEqualToAScore_MatchesInBothEngines()
  {
    // The indexed filter keeps exact parity at the boundary: a card whose float4 score equals the threshold is
    // returned by pg_trgm exactly when the in-process fallback returns it.
    var (deck, _) = await SyntheticDeckAsync("boundary");
    const string text = "glacier restore tier alpha";
    var scores = (await _db.QueryAsync(
      "select similarity(question, $1)::float8 as s from cards where deck_id = $2 and similarity(question, $1) > 0 order by 1", text, deck.Id))
      .Select(r => Convert.ToDouble(r["s"], CultureInfo.InvariantCulture)).ToList();
    Assert.NotEmpty(scores);

    try
    {
      foreach (var threshold in scores)
      {
        CardSimilarity.TestForceEngine = CardSimilarity.EnginePgTrgm;
        var pg = Data(await CallAsync(new { text, deckSlug = deck.Slug, threshold, limit = 20 }));
        CardSimilarity.TestForceEngine = CardSimilarity.EngineFallback;
        var fb = Data(await CallAsync(new { text, deckSlug = deck.Slug, threshold, limit = 20 }));

        Assert.Equal(Tuples(fb), Tuples(pg));
        Assert.Equal(scores.Count(s => s >= threshold), Tuples(pg).Count);
      }
    }
    finally
    {
      CardSimilarity.TestForceEngine = null;
      CardSimilarity.ResetEngineCache();
    }
  }

  // ---------------------------------------------------------------- scope and flags

  [Fact]
  public async Task Similar_DeckSlugScopeAndExcludeCardIds_AreApplied()
  {
    const string question = "subnet route table delta";
    var deckA = await NewDeckAsync("scope-a");
    var deckB = await NewDeckAsync("scope-b");
    var cardA = await NewCardAsync(deckA.Id, 1, question);
    var cardB = await NewCardAsync(deckB.Id, 1, question);

    var scoped = Tuples(Data(await CallAsync(new { text = question, deckSlug = deckA.Slug })));
    Assert.Equal([cardA], scoped.Select(m => m.CardId).ToList());

    var byId = Tuples(Data(await CallAsync(new { text = question, deckId = deckB.Id })));
    Assert.Equal([cardB], byId.Select(m => m.CardId).ToList());

    var excluded = Tuples(Data(await CallAsync(new { text = question, deckSlug = deckA.Slug, excludeCardIds = new[] { cardA } })));
    Assert.Empty(excluded);

    var both = await CallAsync(new { text = question, deckSlug = deckA.Slug, deckId = deckB.Id });
    Assert.Equal(400, both.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(both));
  }

  [Fact]
  public async Task Similar_LikelyDuplicate_IsSimilarityAtLeastPointSix()
  {
    var deck = await NewDeckAsync("dup");
    const string text = "glacier restore tier alpha";
    var exact = await NewCardAsync(deck.Id, 1, text);
    var partial = await NewCardAsync(deck.Id, 2, "glacier restore queue lambda");

    var partialScore = Trigram.Similarity("glacier restore queue lambda", text);
    Assert.InRange(partialScore, 0.3f, 0.5f);

    var matches = Tuples(Data(await CallAsync(new { text, deckSlug = deck.Slug, threshold = 0 })));
    var exactMatch = Assert.Single(matches, m => m.CardId == exact);
    var partialMatch = Assert.Single(matches, m => m.CardId == partial);
    Assert.True(exactMatch.LikelyDuplicate);
    Assert.Equal(1.0, exactMatch.Similarity);
    Assert.False(partialMatch.LikelyDuplicate);
    Assert.All(matches, m => Assert.Equal(m.Similarity >= 0.6, m.LikelyDuplicate));
  }

  // ---------------------------------------------------------------- auth, errors

  [Fact]
  public async Task Similar_EditorWithoutDeckRead_Returns403()
  {
    var deck = await NewDeckAsync("noperm");
    await NewCardAsync(deck.Id, 1, "vpc subnet zone epsilon");

    var response = await CallAsync(new { text = "vpc subnet zone epsilon", deckSlug = deck.Slug }, ["editor"]);
    Assert.Equal(403, response.StatusCode);
  }

  [Fact]
  public async Task Similar_EditorWithoutDeck_SearchesOnlyReadableDecks()
  {
    const string question = "redis cache partition key zeta";
    var deckA = await NewDeckAsync("read-a");
    var deckB = await NewDeckAsync("read-b");
    var cardA = await NewCardAsync(deckA.Id, 1, question);
    await NewCardAsync(deckB.Id, 1, question);

    var sub = $"it-j10-editor-{Guid.NewGuid():N}";
    await _db.QueryAsync(
      "insert into admin_deck_permissions (admin_sub, deck_id, can_read, can_write) values ($1, $2, 1, 0)", sub, deckA.Id);

    var matches = Tuples(Data(await CallAsync(new { text = question }, ["editor"], sub)));
    Assert.Equal([cardA], matches.Select(m => m.CardId).ToList());
  }

  [Fact]
  public async Task Similar_UnknownDeck_Returns404DeckNotFound()
  {
    var bySlug = await CallAsync(new { text = "glacier restore tier alpha", deckSlug = $"it-j10-missing-{Guid.NewGuid():N}" });
    Assert.Equal(404, bySlug.StatusCode);
    Assert.Equal("DECK_NOT_FOUND", ErrorCode(bySlug));

    var maxId = Convert.ToInt64(await _db.ScalarAsync("select coalesce(max(id), 0) from decks"), CultureInfo.InvariantCulture);
    var byId = await CallAsync(new { text = "glacier restore tier alpha", deckId = maxId + 1_000_000 });
    Assert.Equal(404, byId.StatusCode);
    Assert.Equal("DECK_NOT_FOUND", ErrorCode(byId));
  }

  [Theory]
  [InlineData("blank-text")]
  [InlineData("text-4001")]
  [InlineData("limit-0")]
  [InlineData("limit-21")]
  [InlineData("threshold-1.5")]
  [InlineData("threshold-negative")]
  [InlineData("exclude-string")]
  [InlineData("deckId-string")]
  public async Task Similar_InvalidBody_Returns400ValidationError(string invalidCase)
  {
    object body = invalidCase switch
    {
      "blank-text" => new { text = "   " },
      "text-4001" => new { text = new string('a', 4001) },
      "limit-0" => new { text = "glacier", limit = 0 },
      "limit-21" => new { text = "glacier", limit = 21 },
      "threshold-1.5" => new { text = "glacier", threshold = 1.5 },
      "threshold-negative" => new { text = "glacier", threshold = -0.1 },
      "exclude-string" => new { text = "glacier", excludeCardIds = "x" },
      "deckId-string" => new { text = "glacier", deckId = "abc" },
      _ => throw new ArgumentOutOfRangeException(nameof(invalidCase)),
    };

    var response = await CallAsync(body);
    Assert.Equal(400, response.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(response));
  }

  [Fact]
  public async Task Similar_GetMethod_Returns405()
  {
    var response = await CallAsync(null, method: "GET");
    Assert.Equal(405, response.StatusCode);
  }

  // ---------------------------------------------------------------- migration 029

  [Fact]
  public async Task Migration029_InstallsPgTrgmAndIndex_WhenPrivileged()
  {
    var ext = await _db.ScalarAsync("select count(*) from pg_extension where extname = 'pg_trgm'");
    Assert.Equal(1L, Convert.ToInt64(ext, CultureInfo.InvariantCulture));

    var idx = await _db.ScalarAsync("select count(*) from pg_indexes where indexname = 'idx_cards_question_trgm'");
    Assert.Equal(1L, Convert.ToInt64(idx, CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task Migration029_WithoutCreatePrivilege_SucceedsWithNotice()
  {
    var scratch = await _db.CreateScratchDatabaseAsync("it_j10_noext");
    var role = $"it_j10_noext_{Guid.NewGuid():N}";
    await using (var admin = await _db.OpenAsync())
    {
      await DbUtil.ExecuteAsync(admin, null, $"create role \"{role}\" nologin", []);
    }

    var sql = await File.ReadAllTextAsync(System.IO.Path.Combine(AppContext.BaseDirectory, "Db", "Migrations", "029_pg_trgm.sql"));
    var notices = new List<string>();
    var conn = new NpgsqlConnection(scratch);
    await conn.OpenAsync();
    conn.Notice += (_, e) => notices.Add(e.Notice.MessageText);
    try
    {
      await DbUtil.ExecuteAsync(conn, null, $"set role \"{role}\"", []);
      await DbUtil.ExecuteAsync(conn, null, sql, []);
      await DbUtil.ExecuteAsync(conn, null, "reset role", []);

      Assert.Single(notices, n => n.Contains("pg_trgm not installed", StringComparison.Ordinal));
      var ext = await DbUtil.ExecuteScalarAsync(conn, null, "select count(*) from pg_extension where extname = 'pg_trgm'", []);
      Assert.Equal(0L, Convert.ToInt64(ext, CultureInfo.InvariantCulture));
    }
    finally
    {
      await DbUtil.ExecuteAsync(conn, null, "reset role", []);
      await conn.CloseAsync();
      await conn.DisposeAsync();
      await using var admin = await _db.OpenAsync();
      await DbUtil.ExecuteAsync(admin, null, $"drop role if exists \"{role}\"", []);
    }
  }

  // ---------------------------------------------------------------- router

  [Fact]
  public async Task Similar_ThroughVpcFunction_IsRouted()
  {
    var (deck, _) = await SyntheticDeckAsync("routed");
    var body = JsonSerializer.Serialize(new { text = "glacier restore tier alpha", deckSlug = deck.Slug });

    var response = await new RecallSmith.Lambda.VpcFunction().Handler(Event("POST", $"it-j10-{Guid.NewGuid():N}", ["super_admin"], body));

    var data = Data(response);
    Assert.False(string.IsNullOrEmpty(data.GetProperty("engine").GetString()));
    Assert.NotEmpty(data.GetProperty("matches").EnumerateArray());
  }
}
