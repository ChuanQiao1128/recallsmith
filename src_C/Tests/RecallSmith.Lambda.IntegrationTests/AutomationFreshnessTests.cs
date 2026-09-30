using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Automation;
using RecallSmith.Lambda.Vpc.Ledger;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// R20 V08 freshness and measured baselines (contract R20-00 §7): <c>GET /api/v1/admin/automation/freshness</c> walking
/// page events and matched feed items through queue item → run → draft decision → deck publish, with gaps left null and
/// medians over the items that reached each stage; the status <c>freshness</c> block; the 503 before migration 034; and
/// the baselines GET's <c>suggestedMeasuredMinutes</c>/<c>suggestedFromN</c> (median review time, n ≥ 5). Scratch
/// databases; every timestamp is an exact offset from one base instant so the minutes are exact.
/// </summary>
[Collection(PostgresCollection.Name)]
public class AutomationFreshnessTests
{
  private const string Scratch = "it_v08_freshness";
  private const string FreshnessPath = "/api/v1/admin/automation/freshness";
  private static readonly string[] ItemKeys = ["kind", "refId", "title", "detectedAt", "queuedAt", "draftedAt", "decidedAt", "publishedAt"];

  private readonly PostgresFixture _db;
  private readonly DateTime _base = DateTime.SpecifyKind(DateTime.UtcNow.AddTicks(-(DateTime.UtcNow.Ticks % TimeSpan.TicksPerSecond)), DateTimeKind.Utc);

  public AutomationFreshnessTests(PostgresFixture db) => _db = db;

  private DateTime Ago(double hours) => _base.AddHours(-hours);

  private static AuthContext Admin() => AutomationTestKit.Ctx("it-v08-admin", agent: false);

  private static Task<APIGatewayProxyResponse> FreshnessAsync(string? days = null) =>
    AutomationTestKit.CallAsync(Freshness.HandleFreshness, "GET", FreshnessPath, null, Admin(),
      days is null ? null : new Dictionary<string, string> { ["days"] = days });

  // ---------------------------------------------------------------- seed kit

  private sealed class Seed(A04Kit.Sql sql, long deckId, string slug)
  {
    public long DeckId => deckId;

    public async Task<long> TargetAsync(string kind)
    {
      var url = $"https://docs.example.com/v08/{kind}/{Guid.NewGuid():N}";
      return A04Kit.Long(await sql.ScalarAsync(
        "insert into source_watch_targets (kind, url, feed_format, check_interval_minutes) values ($1, $2, $3, 60) returning id",
        kind, url, kind == "feed" ? "rss" : null));
    }

    public async Task<long> EventAsync(long targetId, string kind, DateTime at) =>
      A04Kit.Long(await sql.ScalarAsync(
        "insert into source_watch_events (target_id, watch_run_id, kind, created_at) values ($1, $2, $3, $4) returning id",
        targetId, Guid.NewGuid(), kind, at));

    public async Task<long> QueueAsync(DateTime at, long? sourceEventId = null) =>
      A04Kit.Long(await sql.ScalarAsync(
        """
        insert into authoring_queue_items (kind, url, deck_id, dedupe_key, created_by, status, source_event_id, created_at, finished_at)
        values ('manual', $1, $2, $3, 'owner:it-v08', 'done', $4::bigint, $5, $5)
        returning id
        """,
        $"https://docs.example.com/v08/q/{Guid.NewGuid():N}", deckId, $"it-v08:{Guid.NewGuid()}", sourceEventId, at));

    public async Task FeedItemAsync(long targetId, string key, string title, bool matched, DateTime at, long? queueItemId) =>
      await sql.ScalarAsync(
        """
        insert into source_watch_feed_items (target_id, item_key, url, title, matched, queue_item_id, first_seen_at)
        values ($1, $2, $3, $4, $5, $6::bigint, $7)
        """,
        targetId, key, $"https://docs.example.com/v08/item/{key}", title, matched, queueItemId, at);

    public async Task<Guid> RunAsync(long queueItemId, DateTime at)
    {
      var runId = Guid.NewGuid();
      await sql.ScalarAsync(
        "insert into automation_runs (run_id, queue_item_id, runner_id, owner_sub, deck_id, status, started_at, completed_at) values ($1, $2, 'it-v08-runner', 'it-v08', $3, 'completed', $4, $4)",
        runId, queueItemId, deckId, at);
      return runId;
    }

    public async Task<long> CardAsync() =>
      A04Kit.Long(await sql.ScalarAsync(
        "insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck) values ($1, $2, 'Synthetic Q?', 'Synthetic E.', 2, " +
        "(select coalesce(max(order_in_deck), 0) + 10 from cards where deck_id = $1)) returning id",
        deckId, $"v08-{Guid.NewGuid():N}"[..30]));

    /// <summary>A draft submitted at <paramref name="submitted"/> with its decision in <paramref name="state"/>.</summary>
    public async Task<long> DraftAsync(Guid runId, DateTime submitted, string state, DateTime? decidedAt = null, DateTime? humanDecidedAt = null,
      long? autoAcceptedCardId = null, long? humanAcceptedCardId = null)
    {
      // The draft row records whoever accepted it (the automation or a person); the decision row keeps them apart.
      var acceptedCardId = humanAcceptedCardId ?? autoAcceptedCardId;
      var draftDecidedAt = humanDecidedAt ?? (autoAcceptedCardId is null ? null : decidedAt);
      var draftId = A04Kit.Long(await sql.ScalarAsync(
        """
        insert into ai_drafts (deck_id, batch_id, client_draft_key, stable_uid, status, card, submitted_by_sub, created_at, decided_at,
          decided_by_sub, accepted_card_id)
        values ($1, $2, $3, $4, $5, '{}'::jsonb, 'it-v08', $6, $7, $8, $9::bigint)
        returning id
        """,
        deckId, Guid.NewGuid(), Guid.NewGuid().ToString("N"), $"v08-{Guid.NewGuid():N}"[..30],
        acceptedCardId is null ? "pending" : "accepted", submitted, draftDecidedAt, draftDecidedAt is null ? null : "it-v08", acceptedCardId));
      await sql.ScalarAsync(
        """
        insert into automation_draft_decisions (draft_id, run_id, deck_id, mode, state, decided_at, human_decided_at, accepted_card_id,
          accepted_content_sha256, human_action, created_at)
        values ($1, $2, $3, 'live', $4, $5, $6, $7::bigint, $8, $9, $10)
        """,
        draftId, runId, deckId, state, decidedAt, humanDecidedAt, autoAcceptedCardId, state == "auto_accepted" ? new string('a', 64) : null,
        humanDecidedAt is null ? null : "accepted", submitted);
      return draftId;
    }

    public async Task PublishAsync(DateTime at, string status, params long[] cardIds) =>
      await sql.ScalarAsync(
        "insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, status, card_ids, created_at) values ($1, $2, $3, 'k', $4, $5, $6)",
        deckId, slug, Guid.NewGuid().ToString("N"), status, cardIds, at);
  }

  private static async Task<Seed> NewSeedAsync(A04Kit.Sql sql)
  {
    var slug = $"it-v08-{Guid.NewGuid():N}"[..30];
    var deckId = A04Kit.Long(await sql.ScalarAsync("insert into decks (slug, title, author) values ($1, 'deck v08', 'tests') returning id", slug));
    return new Seed(sql, deckId, slug);
  }

  /// <summary>
  /// e1 (page changed, 10 h ago): queued +1 h, drafted +2 h, auto-accepted +3 h, published +4 h.
  /// e2 (page gone, 5 h ago): queued +1 h, no run.
  /// f1 (matched feed item, 3 h ago): queued +10 min, drafted +1 h, routed to a person who has not decided.
  /// e3 (page changed, 20 h ago): drafted +1 h, a person accepted +2 h, a failed publish then published +3 h (and again later).
  /// Not items: an unmatched feed item, a failing event, a change older than the window.
  /// </summary>
  private async Task<(long E1, long E2, long E3, string F1)> SeedChainAsync(Seed s)
  {
    var page = await s.TargetAsync("page");
    var feed = await s.TargetAsync("feed");

    var e1 = await s.EventAsync(page, "changed", Ago(10));
    var q1 = await s.QueueAsync(Ago(9), e1);
    var r1 = await s.RunAsync(q1, Ago(8.5));
    var card1 = await s.CardAsync();
    await s.DraftAsync(r1, Ago(8), "auto_accepted", decidedAt: Ago(7), autoAcceptedCardId: card1);
    await s.PublishAsync(Ago(6), "SUCCESS", card1);

    var e2 = await s.EventAsync(page, "gone", Ago(5));
    await s.QueueAsync(Ago(4), e2);

    var q3 = await s.QueueAsync(Ago(3) + TimeSpan.FromMinutes(10));
    await s.FeedItemAsync(feed, "f1", "Release notes item", matched: true, Ago(3), q3);
    var r3 = await s.RunAsync(q3, Ago(2.5));
    // Routed to a person at +70 min: not a decision yet.
    await s.DraftAsync(r3, Ago(2), "human", decidedAt: Ago(3) + TimeSpan.FromMinutes(70));

    var e3 = await s.EventAsync(page, "changed", Ago(20));
    var q4 = await s.QueueAsync(Ago(19.5), e3);
    var r4 = await s.RunAsync(q4, Ago(19.2));
    var card2 = await s.CardAsync();
    await s.DraftAsync(r4, Ago(19), "human", decidedAt: Ago(19), humanDecidedAt: Ago(18), humanAcceptedCardId: card2);
    await s.PublishAsync(Ago(17.5), "FAILED", card2);
    await s.PublishAsync(Ago(17), "SUCCESS", card2);
    await s.PublishAsync(Ago(1), "SUCCESS", card2);

    await s.FeedItemAsync(feed, "unmatched", "Other item", matched: false, Ago(1), null);
    await s.EventAsync(page, "failing", Ago(1));
    await s.EventAsync(page, "changed", Ago(24 * 40));
    return (e1, e2, e3, $"{feed}:f1");
  }

  private string Iso(DateTime at) => at.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture);

  private static string? Str(JsonElement e, string name) => e.GetProperty(name).ValueKind == JsonValueKind.Null ? null : e.GetProperty(name).GetString();

  // ---------------------------------------------------------------- freshness route

  [Fact]
  public async Task Freshness_WalksTheChain_GapsAreNull_MediansPerStage()
  {
    await A05Kit.InScratchAsync(_db, Scratch, async sql =>
    {
      var (e1, e2, e3, f1) = await SeedChainAsync(await NewSeedAsync(sql));

      var data = AutomationTestKit.Data(await FreshnessAsync());
      Assert.Equal(["items", "medians", "n"], A04Kit.Keys(data));
      Assert.Equal(4, data.GetProperty("n").GetInt32());

      var items = data.GetProperty("items").EnumerateArray().ToList();
      Assert.All(items, i => Assert.Equal(ItemKeys, A04Kit.Keys(i)));
      // Newest first.
      Assert.Equal(["feed " + f1, $"page {e2}", $"page {e1}", $"page {e3}"],
        items.Select(i => $"{i.GetProperty("kind").GetString()} {i.GetProperty("refId").GetString()}"));

      var feed = items[0];
      Assert.Equal("Release notes item", Str(feed, "title"));
      Assert.Equal([Iso(Ago(3)), Iso(Ago(3) + TimeSpan.FromMinutes(10)), Iso(Ago(2)), null, null],
        new[] { "detectedAt", "queuedAt", "draftedAt", "decidedAt", "publishedAt" }.Select(k => Str(feed, k)));

      var gone = items[1];
      Assert.StartsWith("https://docs.example.com/v08/page/", Str(gone, "title"));
      Assert.Equal([Iso(Ago(5)), Iso(Ago(4)), null, null, null],
        new[] { "detectedAt", "queuedAt", "draftedAt", "decidedAt", "publishedAt" }.Select(k => Str(gone, k)));

      Assert.Equal([Iso(Ago(10)), Iso(Ago(9)), Iso(Ago(8)), Iso(Ago(7)), Iso(Ago(6))],
        new[] { "detectedAt", "queuedAt", "draftedAt", "decidedAt", "publishedAt" }.Select(k => Str(items[2], k)));
      Assert.Equal([Iso(Ago(20)), Iso(Ago(19.5)), Iso(Ago(19)), Iso(Ago(18)), Iso(Ago(17))],
        new[] { "detectedAt", "queuedAt", "draftedAt", "decidedAt", "publishedAt" }.Select(k => Str(items[3], k)));

      // Drafted: 60 (f1), 120 (e1), 60 (e3) → 60. Decided: 180 (e1), 120 (e3) → 150. Published: 240, 180 → 210.
      var medians = data.GetProperty("medians");
      Assert.Equal(["minutesToDraft", "minutesToDecision", "minutesToPublish"], A04Kit.Keys(medians));
      Assert.Equal((60m, 150m, 210m), (medians.GetProperty("minutesToDraft").GetDecimal(), medians.GetProperty("minutesToDecision").GetDecimal(),
        medians.GetProperty("minutesToPublish").GetDecimal()));

      // A 90-day window takes the 40-day-old change too (detected, nothing after it).
      var wide = AutomationTestKit.Data(await FreshnessAsync("90"));
      Assert.Equal(5, wide.GetProperty("n").GetInt32());
      Assert.Equal(210m, wide.GetProperty("medians").GetProperty("minutesToPublish").GetDecimal());

      var status = AutomationTestKit.Data(await AutomationTestKit.CallAsync(StatusRoutes.HandleStatus, "GET", "/api/v1/admin/automation/status", null, Admin()));
      var block = status.GetProperty("freshness");
      Assert.Equal(["medianMinutesToPublish", "n"], A04Kit.Keys(block));
      Assert.Equal((210m, 2), (block.GetProperty("medianMinutesToPublish").GetDecimal(), block.GetProperty("n").GetInt32()));
    });
  }

  [Fact]
  public async Task Freshness_Empty_MediansNull()
  {
    await A05Kit.InScratchAsync(_db, Scratch, async _ =>
    {
      var data = AutomationTestKit.Data(await FreshnessAsync());
      Assert.Empty(data.GetProperty("items").EnumerateArray());
      Assert.Equal(0, data.GetProperty("n").GetInt32());
      foreach (var m in data.GetProperty("medians").EnumerateObject()) Assert.Equal(JsonValueKind.Null, m.Value.ValueKind);
    });
  }

  [Fact]
  public void Freshness_Median_OddEvenAndRounding()
  {
    Assert.Null(Freshness.Median([]));
    Assert.Equal(5m, Freshness.Median([5m]));
    Assert.Equal(2m, Freshness.Median([3m, 1m, 2m]));
    Assert.Equal(2.5m, Freshness.Median([4m, 1m, 2m, 3m]));
    Assert.Equal(0.33m, Freshness.Median([1m / 3m]));
  }

  [Theory]
  [InlineData("0")]
  [InlineData("91")]
  [InlineData("x")]
  public async Task Freshness_BadDays_Returns400(string days)
  {
    await A05Kit.InScratchAsync(_db, Scratch, async _ => AutomationTestKit.AssertError(await FreshnessAsync(days), 400, "VALIDATION_ERROR"));
  }

  [Fact]
  public async Task Freshness_RequiresAdmin()
  {
    var learner = new AuthContext(Claims: new Dictionary<string, JsonElement>(), UserSub: "it-v08-learner", Username: null, Groups: [],
      IsSuperAdmin: false, IsEditor: false, IsAdmin: false);
    Assert.Equal(403, (await AutomationTestKit.CallAsync(Freshness.HandleFreshness, "GET", FreshnessPath, null, learner)).StatusCode);
    Assert.Equal(405, (await AutomationTestKit.CallAsync(Freshness.HandleFreshness, "POST", FreshnessPath, new { }, Admin())).StatusCode);
  }

  [Fact]
  public async Task Freshness_BeforeMigration034_Returns503NotReady()
  {
    await A05Kit.InScratchAsync(_db, Scratch, async _ => AutomationTestKit.AssertError(await FreshnessAsync(), 503, "NOT_READY"), maxVersion: 33);
  }

  // ---------------------------------------------------------------- suggested measured baseline

  private static async Task ReviewEventsAsync(A04Kit.Sql sql, long draftId, params (string Action, int? Ms)[] events)
  {
    foreach (var (action, ms) in events)
    {
      await sql.ScalarAsync(
        "insert into ai_review_events (draft_id, action, actor_sub, reason, review_ms) values ($1, $2, 'it-v08', $3, $4::int)",
        draftId, action, action == "rejected" ? "incorrect" : null, ms);
    }
  }

  private static async Task<JsonElement> BaselineAsync(string automation)
  {
    var data = AutomationTestKit.Data(await AutomationTestKit.CallAsync(LedgerRoutes.HandleBaselines, "GET", "/api/v1/admin/automation/baselines", null, Admin()));
    return data.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("automation").GetString() == automation);
  }

  [Fact]
  public async Task Baselines_SuggestedMeasuredMinutes_MedianReviewTime_FromFiveDecisions()
  {
    await A05Kit.InScratchAsync(_db, Scratch, async sql =>
    {
      var s = await NewSeedAsync(sql);
      var q = await s.QueueAsync(Ago(1));
      var draft = await s.DraftAsync(await s.RunAsync(q, Ago(1)), Ago(1), "human");

      // Nothing measured yet.
      var none = await BaselineAsync("ai_draft_review");
      Assert.Equal(JsonValueKind.Null, none.GetProperty("suggestedMeasuredMinutes").ValueKind);
      Assert.Equal(0, none.GetProperty("suggestedFromN").GetInt32());

      // Four decisions with a time; submits, missing and zero times never count.
      await ReviewEventsAsync(sql, draft, ("accepted", 60000), ("edited_accepted", 120000), ("rejected", 180000), ("accepted", 240000),
        ("submitted", 999999), ("accepted", null), ("rejected", 0));
      var four = await BaselineAsync("ai_draft_review");
      Assert.Equal(JsonValueKind.Null, four.GetProperty("suggestedMeasuredMinutes").ValueKind);
      Assert.Equal(4, four.GetProperty("suggestedFromN").GetInt32());

      // The fifth reaches the threshold: median of 1, 2, 3, 4, 10 minutes = 3.
      await ReviewEventsAsync(sql, draft, ("accepted", 600000));
      var five = await BaselineAsync("ai_draft_review");
      Assert.Equal((3m, 5), (five.GetProperty("suggestedMeasuredMinutes").GetDecimal(), five.GetProperty("suggestedFromN").GetInt32()));
      // A suggestion only: the stored baseline is untouched.
      Assert.Equal(12m, five.GetProperty("baselineMinutesPerUnit").GetDecimal());

      // An even count takes the mean of the middle two: 1, 2, 3, 4, 5, 10 → 3.5.
      await ReviewEventsAsync(sql, draft, ("accepted", 300000));
      Assert.Equal(3.5m, (await BaselineAsync("ai_draft_review")).GetProperty("suggestedMeasuredMinutes").GetDecimal());

      // Every other automation carries nulls.
      var other = await BaselineAsync("bulk_import");
      Assert.Equal((JsonValueKind.Null, JsonValueKind.Null),
        (other.GetProperty("suggestedMeasuredMinutes").ValueKind, other.GetProperty("suggestedFromN").ValueKind));
    });
  }
}
