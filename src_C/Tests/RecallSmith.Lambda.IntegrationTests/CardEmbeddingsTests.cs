using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Card embeddings and semantic similarity (R20 V06, contract R20-00 §5): migration 038 with and without the vector
/// extension, the super_admin upsert (stale text, unknown cards, dim/model/NaN validation), the status counts, the
/// deck-scoped semantic duplicates (each pair once) and the <c>/cards/similar</c> engine switch. The fixture image is
/// pgvector/pgvector:pg17, so 038 installed the extension in the shared database; the "absent" cases use a scratch
/// database where 038 runs as a role without CREATE. Vectors are synthetic unit vectors, never a model's output.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class CardEmbeddingsTests
{
  private const string UpsertPath = "/api/v1/admin/card-embeddings";
  private const string StatusPath = "/api/v1/admin/card-embeddings/status";
  private const string SimilarPath = "/api/v1/authoring/cards/similar";
  private const string NoVectorDb = "it_v06_novector";

  /// <summary>Contract §5: <c>"What is S3?"</c> + <c>"Object storage."</c>; V04 (Python) pins the same digest.</summary>
  private const string PinnedDigest = "657f8dad50869de985f7a8d76cbd7dca0cae9f9a49dba025459e40c2dfe94ebb";

  private readonly PostgresFixture _db;

  public CardEmbeddingsTests(PostgresFixture db)
  {
    _db = db;
    CardEmbeddings.ResetReadyCache();
  }

  // ---------------------------------------------------------------- kit

  private static string Sub(string tag) => $"it-v06-{tag}-{Guid.NewGuid():N}";

  private static AuthContext SuperAdmin() => AutomationTestKit.Ctx(Sub("sa"), agent: false);

  private static AuthContext Editor(string sub) => new(
    Claims: new Dictionary<string, JsonElement>(), UserSub: sub, Username: null, Groups: ["editor"], IsSuperAdmin: false, IsEditor: true,
    IsAdmin: true);

  /// <summary>Unit vector along axis <paramref name="axis"/>, tilted toward axis+1 so that its cosine with the pure axis is <paramref name="cosine"/>.</summary>
  private static double[] Vec(int axis, double cosine = 1.0)
  {
    var v = new double[CardEmbeddings.Dim];
    v[axis] = cosine;
    v[(axis + 1) % CardEmbeddings.Dim] = Math.Sqrt(1 - cosine * cosine);
    return v;
  }

  private sealed record Card(long Id, string Uid, string Question, string Explanation)
  {
    public string Sha => CardEmbeddings.TextSha256(Question, Explanation);
  }

  private async Task<(long Id, string Slug)> DeckAsync(string tag) => await AutomationTestKit.NewDeckAsync(_db, $"v06-{tag}");

  private async Task<Card> CardAsync(long deckId, string tag, string question, int isDeleted = 0)
  {
    var uid = AutomationTestKit.Uid($"v06{tag}");
    var id = await AutomationTestKit.NewCardAsync(_db, deckId, uid, question, isDeleted);
    return new Card(id, uid, question, "synthetic explanation");
  }

  /// <summary>Writes an embedding straight into the table (for cards the upsert would refuse, such as deleted ones).</summary>
  private async Task StoreAsync(long cardId, double[] vector) =>
    await _db.QueryAsync(
      "insert into card_embeddings (card_id, model, dim, text_sha256, embedding) values ($1, $2, 384, 'x', $3::vector) " +
      "on conflict (card_id) do update set embedding = excluded.embedding",
      cardId, CardEmbeddings.Model, CardEmbeddings.VectorLiteral(vector));

  private static object Item(string slug, string uid, string sha, object embedding) =>
    new { deckSlug = slug, stableUid = uid, textSha256 = sha, embedding };

  private static object UpsertBody(params object[] items) => new { model = CardEmbeddings.Model, dim = CardEmbeddings.Dim, items };

  private static Task<APIGatewayProxyResponse> PutAsync(AuthContext auth, object? body) =>
    AutomationTestKit.CallAsync(CardEmbeddings.HandleUpsert, "PUT", UpsertPath, body, auth);

  private static Task<APIGatewayProxyResponse> StatusAsync(AuthContext auth, long? deckId = null) =>
    AutomationTestKit.CallAsync(CardEmbeddings.HandleStatus, "GET", StatusPath, null, auth,
      deckId is null ? null : new Dictionary<string, string> { ["deckId"] = deckId.Value.ToString(CultureInfo.InvariantCulture) });

  private static Task<APIGatewayProxyResponse> DuplicatesAsync(AuthContext auth, string deckId, IDictionary<string, string>? query = null) =>
    AutomationTestKit.CallAsync((q, r, a) => CardEmbeddings.HandleSemanticDuplicates(q, r, a, deckId), "GET",
      $"/api/v1/admin/decks/{deckId}/semantic-duplicates", null, auth, query);

  private static Task<APIGatewayProxyResponse> SimilarAsync(AuthContext auth, object body) =>
    AutomationTestKit.CallAsync(CardSimilarity.HandleSimilar, "POST", SimilarPath, body, auth);

  private async Task GrantReadAsync(string sub, long deckId) =>
    await _db.QueryAsync("insert into admin_deck_permissions (admin_sub, deck_id, can_read, can_write) values ($1, $2, 1, 0)", sub, deckId);

  private static string[] Keys(JsonElement e) => e.EnumerateObject().Select(p => p.Name).ToArray();

  private static List<string> Strings(JsonElement arr) => arr.EnumerateArray().Select(x => x.GetString()!).ToList();

  // ---------------------------------------------------------------- canonical text

  [Fact]
  public void Embedding_TextSha256_MatchesPinnedContractDigest()
  {
    Assert.Equal("What is S3?\n\nObject storage.", CardEmbeddings.CanonicalText("What is S3?", "Object storage."));
    Assert.Equal(PinnedDigest, CardEmbeddings.TextSha256("What is S3?", "Object storage."));
    // Each part is trimmed before joining; a null explanation is empty text.
    Assert.Equal(PinnedDigest, CardEmbeddings.TextSha256("  What is S3?\n", "\tObject storage.  "));
    Assert.Equal("Q?\n\n", CardEmbeddings.CanonicalText("Q?", null));
  }

  // ---------------------------------------------------------------- migration 038

  [Fact]
  public async Task Embedding_Migration038_WithExtension_CreatesTable_AndAppliesTwice()
  {
    Assert.Equal(1L, AutomationTestKit.Long(await _db.ScalarAsync("select count(*) from pg_extension where extname = 'vector'")));
    var sql = await File.ReadAllTextAsync(System.IO.Path.Combine(AppContext.BaseDirectory, "Db", "Migrations", "038_card_embeddings.sql"));
    await using (var conn = await _db.OpenAsync())
    {
      await DbUtil.ExecuteAsync(conn, null, sql, []);
      await DbUtil.ExecuteAsync(conn, null, sql, []);
    }

    var columns = await _db.QueryAsync(
      """
      select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as notnull
      from pg_attribute a where a.attrelid = 'public.card_embeddings'::regclass and a.attnum > 0 and not a.attisdropped
      order by a.attnum
      """);
    Assert.Equal(
      [("card_id", "bigint", true), ("model", "text", true), ("dim", "integer", true), ("text_sha256", "text", true),
       ("embedding", "vector(384)", true), ("updated_at", "timestamp with time zone", true)],
      columns.Select(c => ((string)c["name"]!, (string)c["type"]!, (bool)c["notnull"]!)).ToList());

    // on delete cascade: removing a card removes its embedding.
    var (deckId, _) = await DeckAsync("cascade");
    var card = await CardAsync(deckId, "cascade", "Synthetic cascade question?");
    await StoreAsync(card.Id, Vec(0));
    await _db.QueryAsync("delete from cards where id = $1", card.Id);
    Assert.Equal(0L, AutomationTestKit.Long(await _db.ScalarAsync("select count(*) from card_embeddings where card_id = $1", card.Id)));
  }

  [Fact]
  public async Task Embedding_Migration038_WithoutExtension_NoticeOnly_RoutesAnswerVectorNotReady()
  {
    var scratch = await _db.CreateScratchDatabaseAsync(NoVectorDb);
    var role = $"it_v06_noext_{Guid.NewGuid():N}";
    var sql = await File.ReadAllTextAsync(System.IO.Path.Combine(AppContext.BaseDirectory, "Db", "Migrations", "038_card_embeddings.sql"));
    string slug, uid, question = "glacier restore tier alpha";
    long deckId;

    await using (var admin = await _db.OpenAsync())
    {
      await DbUtil.ExecuteAsync(admin, null, $"create role \"{role}\" nologin", []);
    }
    try
    {
      await using (var conn = new NpgsqlConnection(scratch))
      {
        await conn.OpenAsync();
        await PostgresFixture.ApplyMigrationsAsync(conn, 37);
        var notices = new List<string>();
        conn.Notice += (_, e) => notices.Add(e.Notice.MessageText);

        // The prod app role: no CREATE on the database. 038 twice, each run a notice and nothing else.
        await DbUtil.ExecuteAsync(conn, null, $"set role \"{role}\"", []);
        await DbUtil.ExecuteAsync(conn, null, sql, []);
        await DbUtil.ExecuteAsync(conn, null, sql, []);
        await DbUtil.ExecuteAsync(conn, null, "reset role", []);

        Assert.Equal(2, notices.Count);
        Assert.All(notices, n => Assert.Contains("vector not installed", n, StringComparison.Ordinal));
        Assert.Equal(0L, AutomationTestKit.Long(await DbUtil.ExecuteScalarAsync(conn, null, "select count(*) from pg_extension where extname = 'vector'", [])));
        Assert.Null(await DbUtil.ExecuteScalarAsync(conn, null, "select to_regclass('public.card_embeddings')::text", []));

        slug = $"it-v06-novector-{Guid.NewGuid():N}";
        deckId = AutomationTestKit.Long(await DbUtil.ExecuteScalarAsync(conn, null,
          "insert into decks (slug, title, author) values ($1, 'deck v06', 'tests') returning id", [slug]));
        uid = AutomationTestKit.Uid("novector");
        await DbUtil.ExecuteAsync(conn, null,
          "insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck) values ($1, $2, $3, 'E.', 2, 10)",
          [deckId, uid, question]);
      }

      var savedDb = Environment.GetEnvironmentVariable("PGDATABASE");
      try
      {
        Environment.SetEnvironmentVariable("PGDATABASE", NoVectorDb);
        RecallSmith.Lambda.Db.Pg.Reset();
        RecallSmith.Lambda.Vpc.Db.Pg.Reset();
        CardEmbeddings.ResetReadyCache();

        var sa = SuperAdmin();
        AutomationTestKit.AssertError(
          await PutAsync(sa, UpsertBody(Item(slug, uid, CardEmbeddings.TextSha256(question, "E."), Vec(0)))), 503, "VECTOR_NOT_READY");
        AutomationTestKit.AssertError(await DuplicatesAsync(sa, deckId.ToString(CultureInfo.InvariantCulture)), 503, "VECTOR_NOT_READY");

        var status = AutomationTestKit.Data(await StatusAsync(sa, deckId));
        Assert.Equal(("none", CardEmbeddings.Model, 1L, 0L, 0L),
          (status.GetProperty("engine").GetString(), status.GetProperty("model").GetString(), status.GetProperty("cards").GetInt64(),
           status.GetProperty("embedded").GetInt64(), status.GetProperty("stale").GetInt64()));

        // /cards/similar with an embedding keeps the trigram answer it gives without one.
        var plain = AutomationTestKit.Data(await SimilarAsync(sa, new { text = question, deckSlug = slug }));
        var withVector = AutomationTestKit.Data(await SimilarAsync(sa, new { text = question, deckSlug = slug, embedding = Vec(0) }));
        Assert.NotEqual("vector", withVector.GetProperty("engine").GetString());
        Assert.Equal(plain.GetRawText(), withVector.GetRawText());
      }
      finally
      {
        Environment.SetEnvironmentVariable("PGDATABASE", savedDb);
        RecallSmith.Lambda.Db.Pg.Reset();
        RecallSmith.Lambda.Vpc.Db.Pg.Reset();
        CardEmbeddings.ResetReadyCache();
      }

      // The owner step: CREATE EXTENSION as a privileged role, then 038 again creates the table.
      await using (var conn = new NpgsqlConnection(scratch))
      {
        await conn.OpenAsync();
        await DbUtil.ExecuteAsync(conn, null, "create extension if not exists vector", []);
        await DbUtil.ExecuteAsync(conn, null, sql, []);
        Assert.True(await CardEmbeddings.IsReadyAsync(conn));
        CardEmbeddings.ResetReadyCache();
      }
    }
    finally
    {
      await using var admin = await _db.OpenAsync();
      await DbUtil.ExecuteAsync(admin, null, $"drop role if exists \"{role}\"", []);
    }
  }

  // ---------------------------------------------------------------- PUT /card-embeddings

  [Fact]
  public async Task Embedding_Upsert_StoresFresh_ReportsStaleAndUnknown_ThenUpdatesInPlace()
  {
    var (deckId, slug) = await DeckAsync("upsert");
    var fresh = await CardAsync(deckId, "fresh", "Synthetic fresh question?");
    var edited = await CardAsync(deckId, "edited", "Synthetic edited question?");
    var deleted = await CardAsync(deckId, "deleted", "Synthetic deleted question?", isDeleted: 1);
    var sa = SuperAdmin();

    var data = AutomationTestKit.Data(await PutAsync(sa, UpsertBody(
      Item(slug, fresh.Uid, fresh.Sha.ToUpperInvariant(), Vec(0)),
      Item(slug, edited.Uid, CardEmbeddings.TextSha256("An older question?", edited.Explanation), Vec(1)),
      Item(slug, "v06-no-such-card", fresh.Sha, Vec(2)),
      Item("it-v06-no-such-deck", fresh.Uid, fresh.Sha, Vec(3)),
      Item(slug, deleted.Uid, deleted.Sha, Vec(4)))));

    Assert.Equal(["upserted", "unknownCards", "staleText"], Keys(data));
    Assert.Equal(1, data.GetProperty("upserted").GetInt32());
    Assert.Equal([edited.Uid], Strings(data.GetProperty("staleText")));
    Assert.Equal(["v06-no-such-card", fresh.Uid, deleted.Uid], Strings(data.GetProperty("unknownCards")));

    var rows = await _db.QueryAsync(
      "select card_id, model, dim, text_sha256, embedding::text as v from card_embeddings where card_id = any($1)",
      new[] { fresh.Id, edited.Id, deleted.Id });
    var row = Assert.Single(rows);
    Assert.Equal((fresh.Id, CardEmbeddings.Model, 384, fresh.Sha),
      (AutomationTestKit.Long(row["card_id"]), (string)row["model"]!, Convert.ToInt32(row["dim"], CultureInfo.InvariantCulture), (string)row["text_sha256"]!));
    Assert.StartsWith("[1,0,0", (string)row["v"]!, StringComparison.Ordinal);

    // Same card again: one row, new vector.
    var again = AutomationTestKit.Data(await PutAsync(sa, UpsertBody(Item(slug, fresh.Uid, fresh.Sha, Vec(5)))));
    Assert.Equal(1, again.GetProperty("upserted").GetInt32());
    Assert.Empty(again.GetProperty("unknownCards").EnumerateArray());
    Assert.Empty(again.GetProperty("staleText").EnumerateArray());
    var updated = await _db.QueryAsync("select embedding::text as v from card_embeddings where card_id = $1", fresh.Id);
    Assert.StartsWith("[0,0,0,0,0,1", (string)Assert.Single(updated)["v"]!, StringComparison.Ordinal);

    // A super_admin write leaves one audit row per call.
    Assert.True(AutomationTestKit.Long(await _db.ScalarAsync(
      "select count(*) from admin_audit where action = 'card_embeddings.upsert' and actor_sub = $1", sa.UserSub)) >= 2);
  }

  [Fact]
  public async Task Embedding_Upsert_RequiresSuperAdmin()
  {
    var (deckId, slug) = await DeckAsync("auth");
    var card = await CardAsync(deckId, "auth", "Synthetic auth question?");
    var editorSub = Sub("editor");
    await GrantReadAsync(editorSub, deckId);
    await _db.QueryAsync("update admin_deck_permissions set can_write = 1 where admin_sub = $1", editorSub);

    var response = await PutAsync(Editor(editorSub), UpsertBody(Item(slug, card.Uid, card.Sha, Vec(0))));
    Assert.Equal(403, response.StatusCode);
    Assert.Equal(0L, AutomationTestKit.Long(await _db.ScalarAsync("select count(*) from card_embeddings where card_id = $1", card.Id)));

    Assert.Equal(405, (await AutomationTestKit.CallAsync(CardEmbeddings.HandleUpsert, "POST", UpsertPath, UpsertBody(), SuperAdmin())).StatusCode);
  }

  [Fact]
  public async Task Embedding_Upsert_RejectsWrongModelDimNaNAndShape()
  {
    var sa = SuperAdmin();
    var sha = new string('a', 64);
    var good = Item("some-deck", "some-uid", sha, Vec(0));
    var nanVector = Vec(0).Select(v => (object)v).ToArray();
    nanVector[7] = "NaN";
    var zero = new double[CardEmbeddings.Dim];

    object[] bad =
    [
      new { model = "text-embedding-3-small", dim = 384, items = new[] { good } },
      new { model = CardEmbeddings.Model, dim = 383, items = new[] { good } },
      new { model = CardEmbeddings.Model, items = new[] { good } },
      new { model = CardEmbeddings.Model, dim = 384, items = Array.Empty<object>() },
      new { model = CardEmbeddings.Model, dim = 384, items = Enumerable.Range(0, 201).Select(i => Item("d", $"u{i}", sha, Vec(0))).ToArray() },
      UpsertBody(Item("some-deck", "some-uid", sha, Vec(0).Take(383).ToArray())),
      UpsertBody(Item("some-deck", "some-uid", sha, nanVector)),
      UpsertBody(Item("some-deck", "some-uid", sha, zero)),
      UpsertBody(Item("some-deck", "some-uid", "not-a-sha", Vec(0))),
      UpsertBody(Item("", "some-uid", sha, Vec(0))),
      UpsertBody(good, good),
      new[] { good },
    ];
    foreach (var body in bad) AutomationTestKit.AssertError(await PutAsync(sa, body), 400, "VALIDATION_ERROR");

    // A NaN literal (what Python's json.dumps writes by default) is not JSON at all.
    var nanLiteral = JsonSerializer.Serialize(UpsertBody(good)).Replace("[1,0,", "[NaN,0,", StringComparison.Ordinal);
    Assert.Contains("NaN", nanLiteral, StringComparison.Ordinal);
    Assert.Equal(400, (await PutAsync(sa, nanLiteral)).StatusCode);
  }

  // ---------------------------------------------------------------- GET /card-embeddings/status

  [Fact]
  public async Task Embedding_Status_CountsCardsEmbeddedAndStale_WithinDeckScope()
  {
    var (deckId, slug) = await DeckAsync("status");
    var a = await CardAsync(deckId, "sa", "Synthetic status question A?");
    var b = await CardAsync(deckId, "sb", "Synthetic status question B?");
    await CardAsync(deckId, "sc", "Synthetic status question C?");
    var gone = await CardAsync(deckId, "sd", "Synthetic status question D?", isDeleted: 1);
    var (otherDeck, _) = await DeckAsync("status-other");
    var other = await CardAsync(otherDeck, "so", "Synthetic other question?");
    var sa = SuperAdmin();

    AutomationTestKit.Data(await PutAsync(sa, UpsertBody(Item(slug, a.Uid, a.Sha, Vec(0)), Item(slug, b.Uid, b.Sha, Vec(1)))));
    await StoreAsync(gone.Id, Vec(2));
    await StoreAsync(other.Id, Vec(3));
    await _db.QueryAsync("update cards set explanation = 'edited synthetic explanation' where id = $1", b.Id);

    var data = AutomationTestKit.Data(await StatusAsync(sa, deckId));
    Assert.Equal(["engine", "model", "cards", "embedded", "stale"], Keys(data));
    Assert.Equal(("vector", CardEmbeddings.Model, 3L, 2L, 1L),
      (data.GetProperty("engine").GetString(), data.GetProperty("model").GetString(), data.GetProperty("cards").GetInt64(),
       data.GetProperty("embedded").GetInt64(), data.GetProperty("stale").GetInt64()));

    // An editor sees only the decks they may read: with no deckId, just this one deck.
    var editorSub = Sub("status-editor");
    AutomationTestKit.AssertError(await StatusAsync(Editor(editorSub), deckId), 403, "FORBIDDEN");
    await GrantReadAsync(editorSub, deckId);
    var mine = AutomationTestKit.Data(await StatusAsync(Editor(editorSub)));
    Assert.Equal((3L, 2L, 1L), (mine.GetProperty("cards").GetInt64(), mine.GetProperty("embedded").GetInt64(), mine.GetProperty("stale").GetInt64()));

    AutomationTestKit.AssertError(await StatusAsync(sa, 999_999_999), 404, "DECK_NOT_FOUND");
    AutomationTestKit.AssertError(await AutomationTestKit.CallAsync(CardEmbeddings.HandleStatus, "GET", StatusPath, null, sa,
      new Dictionary<string, string> { ["deckId"] = "abc" }), 400, "VALIDATION_ERROR");
  }

  // ---------------------------------------------------------------- GET /decks/:deckId/semantic-duplicates

  [Fact]
  public async Task Embedding_SemanticDuplicates_EachPairOnce_HighestFirst_DeckScoped()
  {
    var (deckId, _) = await DeckAsync("dups");
    var a = await CardAsync(deckId, "da", "Synthetic duplicate A?");
    var b = await CardAsync(deckId, "db", "Synthetic duplicate B?");
    var c = await CardAsync(deckId, "dc", "Synthetic unrelated C?");
    var gone = await CardAsync(deckId, "dd", "Synthetic deleted D?", isDeleted: 1);
    var (otherDeck, _) = await DeckAsync("dups-other");
    var other = await CardAsync(otherDeck, "do", "Synthetic other deck?");
    // b before a in insertion order of embeddings: the pair still comes back with the lower card id as "a".
    await StoreAsync(b.Id, Vec(10, 0.95));
    await StoreAsync(a.Id, Vec(10));
    await StoreAsync(c.Id, Vec(20));
    await StoreAsync(gone.Id, Vec(10));
    await StoreAsync(other.Id, Vec(10));
    var sa = SuperAdmin();
    var id = deckId.ToString(CultureInfo.InvariantCulture);

    var data = AutomationTestKit.Data(await DuplicatesAsync(sa, id));
    Assert.Equal(["engine", "minCosine", "pairs"], Keys(data));
    Assert.Equal("vector", data.GetProperty("engine").GetString());
    Assert.Equal(0.90, data.GetProperty("minCosine").GetDouble());
    var pair = Assert.Single(data.GetProperty("pairs").EnumerateArray());
    Assert.Equal(0.95, pair.GetProperty("cosine").GetDouble());
    Assert.Equal((a.Id, a.Uid, a.Question), (pair.GetProperty("a").GetProperty("cardId").GetInt64(),
      pair.GetProperty("a").GetProperty("stableUid").GetString(), pair.GetProperty("a").GetProperty("question").GetString()));
    Assert.Equal(b.Id, pair.GetProperty("b").GetProperty("cardId").GetInt64());

    // minCosine 0: all three live pairs, each unordered pair once, highest first.
    var all = AutomationTestKit.Data(await DuplicatesAsync(sa, id, new Dictionary<string, string> { ["minCosine"] = "0" }));
    var pairs = all.GetProperty("pairs").EnumerateArray()
      .Select(p => (p.GetProperty("a").GetProperty("cardId").GetInt64(), p.GetProperty("b").GetProperty("cardId").GetInt64(), p.GetProperty("cosine").GetDouble()))
      .ToList();
    Assert.Equal(3, pairs.Count);
    Assert.Equal((a.Id, b.Id, 0.95), pairs[0]);
    Assert.All(pairs, p => Assert.True(p.Item1 < p.Item2));
    Assert.Equal(3, pairs.Select(p => (p.Item1, p.Item2)).Distinct().Count());
    Assert.DoesNotContain(pairs, p => p.Item1 == gone.Id || p.Item2 == gone.Id || p.Item1 == other.Id || p.Item2 == other.Id);
    Assert.Equal(pairs.OrderByDescending(p => p.Item3).ToList(), pairs);

    var limited = AutomationTestKit.Data(await DuplicatesAsync(sa, id, new Dictionary<string, string> { ["minCosine"] = "0", ["limit"] = "1" }));
    Assert.Single(limited.GetProperty("pairs").EnumerateArray());

    // Deck scope: an editor needs deck read.
    var editorSub = Sub("dups-editor");
    AutomationTestKit.AssertError(await DuplicatesAsync(Editor(editorSub), id), 403, "FORBIDDEN");
    await GrantReadAsync(editorSub, deckId);
    Assert.Single(AutomationTestKit.Data(await DuplicatesAsync(Editor(editorSub), id)).GetProperty("pairs").EnumerateArray());

    AutomationTestKit.AssertError(await DuplicatesAsync(sa, "999999999"), 404, "DECK_NOT_FOUND");
    AutomationTestKit.AssertError(await DuplicatesAsync(sa, "abc"), 400, "VALIDATION_ERROR");
    AutomationTestKit.AssertError(await DuplicatesAsync(sa, id, new Dictionary<string, string> { ["minCosine"] = "1.5" }), 400, "VALIDATION_ERROR");
    AutomationTestKit.AssertError(await DuplicatesAsync(sa, id, new Dictionary<string, string> { ["limit"] = "201" }), 400, "VALIDATION_ERROR");
  }

  // ---------------------------------------------------------------- POST /cards/similar engine switch

  [Fact]
  public async Task Embedding_Similar_WithEmbedding_UsesVectorEngine_WithoutKeepsTrigram()
  {
    var (deckId, slug) = await DeckAsync("similar");
    var same = await CardAsync(deckId, "ms", "glacier restore tier alpha");
    var near = await CardAsync(deckId, "mn", "queue dead letter beta");
    var mid = await CardAsync(deckId, "mm", "lambda cold start gamma");
    var far = await CardAsync(deckId, "mf", "glacier deep archive restore tier alpha");
    await CardAsync(deckId, "mx", "glacier restore tier alpha without embedding");
    await StoreAsync(same.Id, Vec(30));
    await StoreAsync(near.Id, Vec(30, 0.92));
    await StoreAsync(mid.Id, Vec(30, 0.5));
    await StoreAsync(far.Id, Vec(40));
    var sa = SuperAdmin();

    var vector = AutomationTestKit.Data(await SimilarAsync(sa, new { text = "glacier restore tier alpha", deckSlug = slug, embedding = Vec(30) }));
    Assert.Equal("vector", vector.GetProperty("engine").GetString());
    var matches = vector.GetProperty("matches").EnumerateArray()
      .Select(m => (m.GetProperty("cardId").GetInt64(), m.GetProperty("similarity").GetDouble(), m.GetProperty("likelyDuplicate").GetBoolean()))
      .ToList();
    // Cosine over cards that have an embedding, at least the default threshold 0.3; duplicate at >= 0.90.
    Assert.Equal([(same.Id, 1.0, true), (near.Id, 0.92, true), (mid.Id, 0.5, false)], matches);

    var trigram = AutomationTestKit.Data(await SimilarAsync(sa, new { text = "glacier restore tier alpha", deckSlug = slug }));
    Assert.Equal(CardSimilarity.EnginePgTrgm, trigram.GetProperty("engine").GetString());
    Assert.Contains(trigram.GetProperty("matches").EnumerateArray(), m => m.GetProperty("cardId").GetInt64() == far.Id);

    AutomationTestKit.AssertError(await SimilarAsync(sa, new { text = "x", deckSlug = slug, embedding = Vec(0).Take(10).ToArray() }), 400, "VALIDATION_ERROR");
    AutomationTestKit.AssertError(await SimilarAsync(sa, new { text = "x", deckSlug = slug, embedding = "NaN" }), 400, "VALIDATION_ERROR");
  }

  [Fact]
  public async Task Embedding_Routes_AreDispatchedByVpcFunction()
  {
    var (deckId, _) = await DeckAsync("routed");
    var paths = new[]
    {
      ("GET", $"{StatusPath}?deckId={deckId}"),
      ("GET", $"/api/v1/admin/decks/{deckId}/semantic-duplicates"),
    };
    foreach (var (method, path) in paths)
    {
      var parts = path.Split('?');
      var query = parts.Length > 1 ? parts[1].Split('&').Select(kv => kv.Split('=')).ToDictionary(kv => kv[0], kv => kv[1]) : new Dictionary<string, string>();
      var evt = JsonSerializer.SerializeToElement(new
      {
        rawPath = parts[0],
        requestContext = new
        {
          requestId = Guid.NewGuid().ToString(),
          http = new { method },
          authorizer = new { jwt = new { claims = new Dictionary<string, object> { ["sub"] = Sub("routed"), ["cognito:groups"] = new[] { "super_admin" } } } },
        },
        headers = new Dictionary<string, string>(),
        queryStringParameters = query,
        isBase64Encoded = false,
      });
      var response = await new RecallSmith.Lambda.VpcFunction().Handler(evt);
      Assert.True(response.StatusCode == 200, $"{method} {path} returned {response.StatusCode}: {response.Body}");
    }
    Assert.Equal("/api/v1/admin/decks/:deckId/semantic-duplicates", RouteMetrics.RouteFor($"/api/v1/admin/decks/{deckId}/semantic-duplicates"));
  }
}
