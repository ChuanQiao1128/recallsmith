using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.SQS.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Qa;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The AI QA publish gate (R18 J13, contract §7.10) in <c>POST /api/v1/authoring/publish</c>, reached in
/// mode=publish through <see cref="Publish.TestEnqueueSeam"/> (no AWS client is ever built), as in
/// PublishEnqueueResilienceTests. The gate refuses only when AI_QA_ENABLED and AI_QA_REQUIRED are both on;
/// preview is unaffected. Every test creates its own free deck and restores the seam and both flags in finally.
/// </summary>
[Collection(PostgresCollection.Name)]
public class AiQaPublishGateTests
{
  private readonly PostgresFixture _db;
  public AiQaPublishGateTests(PostgresFixture db) => _db = db;

  private const string PublishPath = "/api/v1/authoring/publish";
  private const string SeamQueueUrl = "https://sqs.test/000000000000/j13-publish";
  private const string SeamBucket = "it-j13-bucket";

  // ---------------------------------------------------------------- helpers

  /// <summary>Runs <paramref name="body"/> with both flags set and the publish seam capturing sends; restores all.</summary>
  private static async Task WithGateAsync(string? enabled, string? required, Func<List<SendMessageRequest>, Task> body)
  {
    var savedEnabled = Environment.GetEnvironmentVariable(QaGate.EnabledEnv);
    var savedRequired = Environment.GetEnvironmentVariable(QaGate.RequiredEnv);
    var savedSeam = Publish.TestEnqueueSeam;
    var sent = new List<SendMessageRequest>();
    try
    {
      Environment.SetEnvironmentVariable(QaGate.EnabledEnv, enabled);
      Environment.SetEnvironmentVariable(QaGate.RequiredEnv, required);
      Publish.TestEnqueueSeam = new(SeamQueueUrl, SeamBucket, r => { lock (sent) sent.Add(r); return Task.CompletedTask; });
      await body(sent);
    }
    finally
    {
      Environment.SetEnvironmentVariable(QaGate.EnabledEnv, savedEnabled);
      Environment.SetEnvironmentVariable(QaGate.RequiredEnv, savedRequired);
      Publish.TestEnqueueSeam = savedSeam;
    }
  }

  private static JsonElement Event(long deckId, string? mode)
  {
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = PublishPath,
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method = "POST" },
        authorizer = new
        {
          jwt = new
          {
            claims = new Dictionary<string, object>(StringComparer.Ordinal)
            {
              ["sub"] = $"it-j13-super-{Guid.NewGuid():N}",
              ["cognito:groups"] = new[] { "super_admin" },
            },
          },
        },
      },
      headers = new Dictionary<string, string>(),
      queryStringParameters = mode is null ? new Dictionary<string, string>() : new Dictionary<string, string> { ["mode"] = mode },
      body = JsonSerializer.Serialize(new { deckId }),
      isBase64Encoded = false,
    });
  }

  private static async Task<APIGatewayProxyResponse> PublishAsync(long deckId, string? mode = null)
  {
    var req = new LambdaRequest(Event(deckId, mode));
    var res = new Res(req.TraceId);
    return await Publish.HandleAuthoringPublish(req, res, await Auth.GetAuthContextAsync(req));
  }

  private static JsonElement Data(APIGatewayProxyResponse response)
  {
    Assert.True(response.StatusCode == 200, $"handler returned {response.StatusCode}: {response.Body}");
    using var doc = JsonDocument.Parse(response.Body!);
    return doc.RootElement.GetProperty("data").Clone();
  }

  private static string AssertError(APIGatewayProxyResponse response, int status, string code)
  {
    Assert.True(response.StatusCode == status, $"expected {status}, got {response.StatusCode}: {response.Body}");
    using var doc = JsonDocument.Parse(response.Body!);
    var error = doc.RootElement.GetProperty("error");
    Assert.Equal(code, error.GetProperty("code").GetString());
    return error.GetProperty("message").GetString()!;
  }

  private static void AssertPublished(APIGatewayProxyResponse response, List<SendMessageRequest> sent)
  {
    Assert.Equal("async", Data(response).GetProperty("mode").GetString());
    Assert.Single(sent);
  }

  /// <summary>A free deck (deck_type 1) with plain Q/A cards, so the MCQ gate passes.</summary>
  private async Task<(long DeckId, List<(long CardId, string Uid)> Cards)> SeedDeckAsync(string tag, int cardCount)
  {
    var deckId = Convert.ToInt64(await _db.ScalarAsync(
      "insert into decks (slug, title, author, deck_type) values ($1, $2, $3, 1) returning id",
      $"it-j13-{tag}-{Guid.NewGuid():N}", $"deck j13 {tag}", "tests"), CultureInfo.InvariantCulture);
    var cards = new List<(long, string)>();
    for (var i = 1; i <= cardCount; i++)
    {
      var uid = $"gate-{tag}-{i}-{Guid.NewGuid():N}"[..40];
      var cardId = Convert.ToInt64(await _db.ScalarAsync(
        "insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck) values ($1, $2, $3, $4, 2, $5) returning id",
        deckId, uid, $"Synthetic question {i} for the gate?", "Synthetic explanation.", i), CultureInfo.InvariantCulture);
      cards.Add((cardId, uid));
    }
    return (deckId, cards);
  }

  private async Task<string> HashAsync(long cardId)
  {
    var rows = await _db.QueryAsync($"select {CardContentHash.CardColumnsSql} from cards c where c.id = $1", cardId);
    return CardContentHash.Compute(rows[0]);
  }

  /// <summary>A finished run with one <c>done</c> item per card at its current hash.</summary>
  private async Task<Guid> SeedReviewAsync(long deckId, IEnumerable<(long CardId, string Uid)> cards)
  {
    var list = cards.ToList();
    var runId = Guid.NewGuid();
    await _db.QueryAsync(
      """
      insert into ai_qa_runs (id, deck_id, scope, status, requested_by_sub, card_count, chunk_count, cards_done, finished_at)
      values ($1, $2, 'changed', 'done', 'it-j13-seed', $3, 1, $3, now())
      """,
      runId, deckId, list.Count);
    foreach (var (cardId, uid) in list)
    {
      await _db.QueryAsync(
        "insert into ai_qa_items (run_id, card_id, stable_uid, content_sha256, status) values ($1, $2, $3, $4, 'done')",
        runId, cardId, uid, await HashAsync(cardId));
    }
    return runId;
  }

  private async Task SeedFindingAsync(Guid runId, long cardId, string severity, string category, string resolution = "open") =>
    await _db.QueryAsync(
      """
      insert into ai_qa_findings (run_id, card_id, content_sha256, severity, category, message, resolution)
      values ($1, $2, $3, $4, $5, 'Synthetic finding.', $6)
      """,
      runId, cardId, await HashAsync(cardId), severity, category, resolution);

  private async Task<long> PublishRowsAsync(long deckId) =>
    Convert.ToInt64(await _db.ScalarAsync("select count(*) from deck_publishes where deck_id = $1", deckId), CultureInfo.InvariantCulture);

  // ---------------------------------------------------------------- flags

  [Fact]
  public async Task Gate_FlagsOff_NeverBlocks()
  {
    var deck = await SeedDeckAsync("off", 2);
    await WithGateAsync("0", "0", async sent => AssertPublished(await PublishAsync(deck.DeckId), sent));

    // With the flags off the gate runs no query at all: publishing works on a database without migration 031.
    var scratch = await _db.CreateScratchDatabaseAsync("it_j13_gateoff");
    long scratchDeck;
    await using (var conn = new NpgsqlConnection(scratch))
    {
      await conn.OpenAsync();
      await PostgresFixture.ApplyMigrationsAsync(conn, 30);
      scratchDeck = Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null,
        "insert into decks (slug, title, author, deck_type) values ($1, $2, $3, 1) returning id", [$"it-j13-gateoff-{Guid.NewGuid():N}", "deck j13", "tests"]),
        CultureInfo.InvariantCulture);
      await DbUtil.ExecuteAsync(conn, null,
        "insert into cards (deck_id, stable_uid, question, explanation, order_in_deck) values ($1, $2, $3, $4, 1)",
        [scratchDeck, "gateoff-a", "Synthetic question?", "Synthetic explanation."]);
    }

    var savedDb = Environment.GetEnvironmentVariable("PGDATABASE");
    try
    {
      Environment.SetEnvironmentVariable("PGDATABASE", "it_j13_gateoff");
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();

      await WithGateAsync("0", "1", async sent => AssertPublished(await PublishAsync(scratchDeck), sent));
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", savedDb);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
    }
  }

  [Fact]
  public async Task Gate_RequiredOnly_WithoutEnabled_NeverBlocks()
  {
    var deck = await SeedDeckAsync("reqonly", 1);
    await WithGateAsync(null, "1", async sent => AssertPublished(await PublishAsync(deck.DeckId), sent));

    var second = await SeedDeckAsync("enabledonly", 1);
    await WithGateAsync("1", "0", async sent => AssertPublished(await PublishAsync(second.DeckId), sent));
  }

  // ---------------------------------------------------------------- refusals

  [Fact]
  public async Task Gate_Refusal_EmitsQaGateRefusals()
  {
    // backend-design-10: every refusal emits one informational gauge.
    var deck = await SeedDeckAsync("refusal-metric", 1);
    await WithGateAsync("1", "true", async sent =>
    {
      APIGatewayProxyResponse? response = null;
      var stdout = await EmfCapture.StdoutAsync(async () => response = await PublishAsync(deck.DeckId));
      AssertError(response!, 409, "AI_QA_REQUIRED");
      Assert.Equal("QaGateRefusals", QaGate.RefusalsMetric);
      Assert.Equal(1, EmfCapture.GaugeSum(stdout, QaGate.RefusalsMetric));
      Assert.Empty(sent);
    });
  }

  [Fact]
  public async Task Gate_UnreviewedChangedCard_Returns409AiQaRequired()
  {
    var deck = await SeedDeckAsync("unreviewed", 2);
    await SeedReviewAsync(deck.DeckId, [deck.Cards[0]]);

    await WithGateAsync("1", "true", async sent =>
    {
      var message = AssertError(await PublishAsync(deck.DeckId), 409, "AI_QA_REQUIRED");
      Assert.Equal($"AI QA required for 1 card(s): {deck.Cards[1].Uid}", message);
      Assert.Empty(sent);
    });
    Assert.Equal(0L, await PublishRowsAsync(deck.DeckId));
  }

  [Fact]
  public async Task Gate_OpenBlockerOnCurrentHash_Returns409AiQaBlocked()
  {
    var deck = await SeedDeckAsync("blocked", 2);
    var runId = await SeedReviewAsync(deck.DeckId, deck.Cards);
    await SeedFindingAsync(runId, deck.Cards[1].CardId, "blocker", "incorrect_answer");

    await WithGateAsync("yes", "1", async sent =>
    {
      var message = AssertError(await PublishAsync(deck.DeckId), 409, "AI_QA_BLOCKED");
      Assert.StartsWith("AI QA blocked by 1 open blocker finding(s):", message);
      Assert.Contains($"{deck.Cards[1].Uid}: incorrect_answer", message);
      Assert.Empty(sent);
    });
    Assert.Equal(0L, await PublishRowsAsync(deck.DeckId));
  }

  [Fact]
  public async Task Gate_ReviewedWithoutBlockers_Publishes()
  {
    var deck = await SeedDeckAsync("reviewed", 2);
    var runId = await SeedReviewAsync(deck.DeckId, deck.Cards);
    await SeedFindingAsync(runId, deck.Cards[0].CardId, "major", "ambiguous_stem");
    await SeedFindingAsync(runId, deck.Cards[1].CardId, "blocker", "multiple_correct", resolution: "fixed");
    await SeedFindingAsync(runId, deck.Cards[1].CardId, "blocker", "incorrect_answer", resolution: "dismissed");

    await WithGateAsync("1", "1", async sent => AssertPublished(await PublishAsync(deck.DeckId), sent));
  }

  [Fact]
  public async Task Gate_EditAfterReview_RequiresNewReview()
  {
    var deck = await SeedDeckAsync("edit", 1);
    await SeedReviewAsync(deck.DeckId, deck.Cards);

    await _db.QueryAsync("update cards set explanation = 'Synthetic edited explanation.', updated_at = now() where id = $1", deck.Cards[0].CardId);

    await WithGateAsync("1", "1", async sent =>
    {
      var message = AssertError(await PublishAsync(deck.DeckId), 409, "AI_QA_REQUIRED");
      Assert.Contains(deck.Cards[0].Uid, message);
    });

    await SeedReviewAsync(deck.DeckId, deck.Cards);
    await WithGateAsync("1", "1", async sent => AssertPublished(await PublishAsync(deck.DeckId), sent));
  }

  [Fact]
  public async Task Gate_CardUnchangedSinceLiveBuild_IsNotRequired()
  {
    var deck = await SeedDeckAsync("unchanged", 1);
    var card = deck.Cards[0];
    var buildId = $"b-j13-{Guid.NewGuid():N}";
    await _db.QueryAsync(
      """
      insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status, created_at)
      select d.id, d.slug, $2, 'content/decks/it-j13/deck.json', $3, 'SUCCESS', (select c.updated_at from cards c where c.id = $4) + interval '1 minute'
      from decks d where d.id = $1
      """,
      deck.DeckId, buildId, Guid.NewGuid().ToString(), card.CardId);
    await _db.QueryAsync("update decks set live_build_id = $2 where id = $1", deck.DeckId, buildId);

    await WithGateAsync("1", "1", async sent => AssertPublished(await PublishAsync(deck.DeckId), sent));
    await _db.QueryAsync("update deck_publishes set status = 'SUCCESS' where deck_id = $1 and status in ('PENDING','PROCESSING')", deck.DeckId);

    // Edited after the live build: now it is a changed card and needs a review.
    await _db.QueryAsync(
      "update cards set question = 'Synthetic edited question?', updated_at = (select created_at from deck_publishes where build_id = $2) + interval '2 minutes' where id = $1",
      card.CardId, buildId);
    await WithGateAsync("1", "1", async sent =>
    {
      var message = AssertError(await PublishAsync(deck.DeckId), 409, "AI_QA_REQUIRED");
      Assert.Contains(card.Uid, message);
    });
  }

  [Fact]
  public async Task Gate_PreviewMode_IsUnchanged()
  {
    var deck = await SeedDeckAsync("preview", 1);

    await WithGateAsync("1", "1", async sent =>
    {
      var data = Data(await PublishAsync(deck.DeckId, "preview"));
      Assert.Equal("preview", data.GetProperty("mode").GetString());
      Assert.Equal(1, data.GetProperty("cardCount").GetInt32());
      Assert.Empty(sent);

      AssertError(await PublishAsync(deck.DeckId), 409, "AI_QA_REQUIRED");
    });
  }
}
