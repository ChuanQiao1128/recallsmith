using System.Globalization;
using System.Text.Json;
using RecallSmith.Lambda.Vpc.Automation;
using RecallSmith.Lambda.Vpc.Qa;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Source re-check runs (R18A A05, contract A00 §9.6): <see cref="QaRuns.StartCardsRunAsync"/> against the shared
/// database (every check is per deck, and the scope lifts the daily cap), the byte-identical human-run message, and the
/// tick's retry of <c>waiting</c> re-checks (A00 §12.6 step 8) against a scratch database, because the tick scans
/// global tables. QA sends are captured through <see cref="QaRuns.TestSendSeam"/>.
/// </summary>
[Collection(PostgresCollection.Name)]
public class SourceRecheckTests
{
  private const string Scratch = "it_a05_recheck";
  private readonly PostgresFixture _db;

  public SourceRecheckTests(PostgresFixture db) => _db = db;

  private static readonly string[] HumanMessageKeys = ["v", "runId", "chunk", "chunkCount", "promptVersion", "deck", "reviewDate", "cards"];

  private async Task<(long DeckId, long[] CardIds)> DeckWithCardsAsync(string tag, int cards = 2)
  {
    var sql = new A04Kit.Sql(_db.ConnectionString);
    var deckId = await A05Kit.DeckAsync(sql, tag);
    var ids = new List<long>();
    for (var i = 0; i < cards; i++) ids.Add(await A05Kit.CardAsync(sql, deckId, $"https://docs.example.com/a05/recheck/{tag}"));
    return (deckId, [.. ids]);
  }

  private static JsonElement Message(Amazon.SQS.Model.SendMessageRequest request) => JsonDocument.Parse(request.MessageBody).RootElement.Clone();

  [Fact]
  public async Task StartCardsRun_QueuesAutomationProfileRun()
  {
    using var scope = new AutomationTestKit.Scope();
    var (deckId, cardIds) = await DeckWithCardsAsync("profile", 3);
    await using var conn = await _db.OpenAsync();

    var run = await QaRuns.StartCardsRunAsync(conn, deckId, cardIds[..2], "automation", "source_changed", "automation");

    Assert.NotNull(run);
    Assert.Equal(("queued", (string?)null), (run!.Status, run.Code));
    var row = (await _db.QueryAsync("select scope, requested_by_sub, card_count, status from ai_qa_runs where id = $1", run.RunId!.Value)).Single();
    Assert.Equal(("cards", "automation", 2, "queued"), ((string)row["scope"]!, (string)row["requested_by_sub"]!,
      Convert.ToInt32(row["card_count"], CultureInfo.InvariantCulture), (string)row["status"]!));

    var sent = Assert.Single(scope.QaSent);
    var message = Message(sent);
    Assert.Equal(["v", "runId", "chunk", "chunkCount", "promptVersion", "profile", "deck", "reviewDate", "cards"], A05Kit.Keys(message));
    Assert.Equal("automation", message.GetProperty("profile").GetString());
    Assert.Contains("\"promptVersion\":\"qa-v4\",\"profile\":\"automation\",", sent.MessageBody);
    Assert.Equal(cardIds[..2], message.GetProperty("cards").EnumerateArray().Select(c => c.GetProperty("cardId").GetInt64()).ToArray());

    // A card not live in the deck is refused without a run; the call never throws.
    await _db.QueryAsync("update ai_qa_runs set status = 'done', finished_at = now() where id = $1", run.RunId.Value);
    var (otherDeck, otherCards) = await DeckWithCardsAsync("profile-other", 1);
    var refused = await QaRuns.StartCardsRunAsync(conn, deckId, [cardIds[0], otherCards[0]], "automation", "source_changed", "automation");
    Assert.Equal(("not_started", "VALIDATION_ERROR"), (refused!.Status, refused.Code));
    var empty = await QaRuns.StartCardsRunAsync(conn, otherDeck, [], "automation", "source_changed", "automation");
    Assert.Equal(("not_started", "VALIDATION_ERROR"), (empty!.Status, empty.Code));
    Assert.Single(scope.QaSent);
  }

  [Fact]
  public async Task HumanRunMessages_HaveNoProfileKey()
  {
    using var scope = new AutomationTestKit.Scope();
    var (deckId, cardIds) = await DeckWithCardsAsync("human", 2);

    // The console start (POST /qa/runs).
    var started = AutomationTestKit.Data(await AutomationTestKit.CallAsync(QaRuns.HandleRuns, "POST", "/api/v1/authoring/qa/runs",
      new { deckId, scope = "cards", cardIds }, AutomationTestKit.Ctx("it-a05-human", agent: false)));
    Assert.Equal("queued", started.GetProperty("status").GetString());
    var human = Message(Assert.Single(scope.QaSent));
    Assert.Equal(HumanMessageKeys, A05Kit.Keys(human));
    Assert.DoesNotContain("profile", scope.QaSent[0].MessageBody);

    // The accept → QA chain (scope changed) is a human run too.
    await _db.QueryAsync("update ai_qa_runs set status = 'done', finished_at = now() where deck_id = $1", deckId);
    var (changedDeck, _) = await DeckWithCardsAsync("human-changed", 1);
    await using var conn = await _db.OpenAsync();
    var chained = await QaRuns.StartChangedRunAsync(conn, changedDeck, "it-a05-human", "test");
    Assert.Equal("queued", chained!.Status);
    Assert.Equal(2, scope.QaSent.Count);
    Assert.Equal(HumanMessageKeys, A05Kit.Keys(Message(scope.QaSent[1])));
    Assert.DoesNotContain("profile", scope.QaSent[1].MessageBody);
  }

  [Fact]
  public async Task StartCardsRun_Disabled_ReturnsNull()
  {
    using var scope = new AutomationTestKit.Scope();
    scope.Set(QaGate.EnabledEnv, "0");
    var (deckId, cardIds) = await DeckWithCardsAsync("disabled", 1);
    await using var conn = await _db.OpenAsync();

    Assert.Null(await QaRuns.StartCardsRunAsync(conn, deckId, cardIds, "automation", "source_changed", "automation"));
    Assert.Equal(0, await AutomationTestKit.CountAsync(_db, "select count(*) from ai_qa_runs where deck_id = $1", deckId));
    Assert.Empty(scope.QaSent);
  }

  [Fact]
  public async Task StartCardsRun_ActiveRun_IsInProgress()
  {
    using var scope = new AutomationTestKit.Scope();
    var (deckId, cardIds) = await DeckWithCardsAsync("active", 2);
    await using var conn = await _db.OpenAsync();

    var first = await QaRuns.StartCardsRunAsync(conn, deckId, cardIds, "automation", "source_changed", "automation");
    var second = await QaRuns.StartCardsRunAsync(conn, deckId, cardIds, "automation", "source_changed", "automation");

    Assert.Equal("queued", first!.Status);
    Assert.Equal(("in_progress", first.RunId), (second!.Status, second.RunId));
    Assert.Equal(1, await AutomationTestKit.CountAsync(_db, "select count(*) from ai_qa_runs where deck_id = $1", deckId));
    Assert.Single(scope.QaSent);
  }

  [Fact]
  public async Task StartCardsRun_DailyCap_IsNotStarted()
  {
    using var scope = new AutomationTestKit.Scope();
    scope.Set(QaRuns.DailyCapEnv, "0");
    var (deckId, cardIds) = await DeckWithCardsAsync("cap", 1);
    await using var conn = await _db.OpenAsync();

    var run = await QaRuns.StartCardsRunAsync(conn, deckId, cardIds, "automation", "source_changed", "automation");

    Assert.Equal(("not_started", "AI_QA_DAILY_CAP", (Guid?)null), (run!.Status, run.Code, run.RunId));
    Assert.Equal(0, await AutomationTestKit.CountAsync(_db, "select count(*) from ai_qa_runs where deck_id = $1", deckId));
    Assert.Empty(scope.QaSent);
  }

  // ---------------------------------------------------------------- tick step 8

  /// <summary>A page target cited by one card of a new deck, with a <c>waiting</c> event pending on that deck.</summary>
  private static async Task<(long DeckId, long CardId, long EventId)> WaitingEventAsync(A04Kit.Sql sql, string tag, string age)
  {
    var deckId = await A05Kit.DeckAsync(sql, tag);
    var url = $"https://docs.example.com/a05/waiting/{tag}/{Guid.NewGuid():N}";
    var cardId = await A05Kit.CardAsync(sql, deckId, url);
    var targetId = await A05Kit.PageAsync(sql, url);
    var details = JsonSerializer.Serialize(new
    {
      citingCards = 1,
      byDeck = new Dictionary<string, int> { [deckId.ToString(CultureInfo.InvariantCulture)] = 1 },
      missingQuoteCardIds = Array.Empty<long>(),
      queueItemIds = Array.Empty<long>(),
      recheckPendingDeckIds = new[] { deckId },
    });
    var eventId = A04Kit.Long(await sql.ScalarAsync(
      $"""
      insert into source_watch_events (target_id, watch_run_id, kind, old_sha256, new_sha256, details, recheck_state, created_at)
      values ($1, $2, 'changed', $3, $4, $5::jsonb, 'waiting', now() - interval '{age}') returning id
      """, targetId, Guid.NewGuid(), A05Kit.Sha("old"), A05Kit.Sha("new"), details));
    return (deckId, cardId, eventId);
  }

  [Fact]
  public async Task Tick_WaitingRecheck_IsRetried()
  {
    await A05Kit.WithScopeAsync(async scope =>
    {
      await A05Kit.InScratchAsync(_db, Scratch, async sql =>
      {
        var (deckId, cardId, eventId) = await WaitingEventAsync(sql, "retry", "1 hour");

        var data = AutomationTestKit.Data(await A04Kit.TickAsync());

        Assert.Equal(1, data.GetProperty("actions").GetProperty("rechecksStarted").GetInt32());
        var ev = (await sql.QueryAsync("select recheck_state, recheck_run_ids, details::text as details, notification_id from source_watch_events where id = $1", eventId)).Single();
        Assert.Equal("started", ev["recheck_state"]);
        var runId = Assert.Single((Guid[])ev["recheck_run_ids"]!);
        Assert.Empty(A05Kit.Json(ev["details"]).GetProperty("recheckPendingDeckIds").EnumerateArray());
        Assert.Null(ev["notification_id"]);
        var run = (await sql.QueryAsync("select deck_id, scope, requested_by_sub from ai_qa_runs where id = $1", runId)).Single();
        Assert.Equal((deckId, "cards", "automation"), (A04Kit.Long(run["deck_id"]), (string)run["scope"]!, (string)run["requested_by_sub"]!));
        var message = Message(Assert.Single(scope.QaSent));
        Assert.Equal("automation", message.GetProperty("profile").GetString());
        Assert.Equal([cardId], message.GetProperty("cards").EnumerateArray().Select(c => c.GetProperty("cardId").GetInt64()).ToArray());

        // A deck whose run is still open keeps waiting; the next tick starts nothing new.
        var (_, _, blockedEvent) = await WaitingEventAsync(sql, "blocked", "1 hour");
        var blockedDeck = A04Kit.Long(await sql.ScalarAsync(
          "select (details->'recheckPendingDeckIds'->>0)::bigint from source_watch_events where id = $1", blockedEvent));
        await sql.QueryAsync("insert into ai_qa_runs (id, deck_id, scope, status, requested_by_sub, card_count, chunk_count) values ($1, $2, 'all', 'running', 'it-a05', 1, 1)",
          Guid.NewGuid(), blockedDeck);
        var again = AutomationTestKit.Data(await A04Kit.TickAsync());
        Assert.Equal(0, again.GetProperty("actions").GetProperty("rechecksStarted").GetInt32());
        Assert.Equal("waiting", await sql.ScalarAsync("select recheck_state from source_watch_events where id = $1", blockedEvent));
      });
    });
  }

  [Fact]
  public async Task Tick_WaitingRecheckAfter24h_IsUnavailable()
  {
    await A05Kit.WithScopeAsync(async scope =>
    {
      await A05Kit.InScratchAsync(_db, Scratch, async sql =>
      {
        var (_, _, eventId) = await WaitingEventAsync(sql, "expired", "25 hours");

        var data = AutomationTestKit.Data(await A04Kit.TickAsync());

        Assert.Equal(0, data.GetProperty("actions").GetProperty("rechecksStarted").GetInt32());
        var ev = (await sql.QueryAsync("select recheck_state, recheck_run_ids, details::text as details, notification_id from source_watch_events where id = $1", eventId)).Single();
        Assert.Equal("unavailable", ev["recheck_state"]);
        Assert.Empty((Guid[])ev["recheck_run_ids"]!);
        Assert.Empty(A05Kit.Json(ev["details"]).GetProperty("recheckPendingDeckIds").EnumerateArray());
        Assert.Empty(scope.QaSent);
        // The same tick's step 8 then sends the source_changed email for the given-up event.
        Assert.NotNull(ev["notification_id"]);
        Assert.Equal(1, await sql.CountAsync("select count(*) from automation_notifications where dedupe_key = $1", $"source:{eventId}"));
      });
    });
  }
}
