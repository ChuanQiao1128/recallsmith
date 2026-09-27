using System.Globalization;
using Npgsql;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Automation;
using RecallSmith.Lambda.Vpc.Qa;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The one daily USD cap shared by human QA runs and automation draft QA (R18A A03, contract A00 §9.5): today's
/// decision spend and the reservation of fresh <c>qa_queued</c> decisions join <see cref="QaRuns.SpendTodayAsync"/>,
/// the draft enqueue and a human run refuse against the combined numbers, <c>GET /qa/status</c> reports them, and a
/// database without migration 034 counts runs only. Other classes spend in the same database, so every limit is
/// computed relative to <see cref="QaRuns.SpendTodayAsync"/> at the start of the test; rows inserted directly are
/// removed in <c>finally</c>.
/// </summary>
[Collection(PostgresCollection.Name)]
public class AutomationSpendCapTests
{
  private readonly PostgresFixture _db;
  public AutomationSpendCapTests(PostgresFixture db) => _db = db;

  private async Task<(decimal Spent, long OpenCards)> SpendAsync()
  {
    await using var conn = await _db.OpenAsync();
    return await QaRuns.SpendTodayAsync(conn, null);
  }

  /// <summary>
  /// A decision row inserted directly (no events) for a fresh draft, with its spend row; <paramref name="enqueuedMinutesAgo"/>
  /// sets <c>qa_enqueued_at</c>, <paramref name="createdDaysAgo"/> backdates <c>created_at</c> and the spend's <c>spent_at</c>.
  /// </summary>
  private async Task<long> InsertDecisionAsync(string state, decimal costUsd, int? enqueuedMinutesAgo = null, int createdDaysAgo = 0)
  {
    var sub = AutomationTestKit.Sub("spend");
    var deck = await AutomationTestKit.NewDeckAsync(_db, "spend");
    var runId = await AutomationTestKit.NewRunAsync(_db, sub, deck.Id);
    var draftId = AutomationTestKit.Long(await _db.ScalarAsync(
      """
      insert into ai_drafts (deck_id, batch_id, client_draft_key, stable_uid, card, "similar", agent, submitted_by_sub)
      values ($1, $2, $3, $4, '{}'::jsonb, '[]'::jsonb, null, $5)
      returning id
      """,
      deck.Id, Guid.NewGuid(), Guid.NewGuid().ToString("N"), AutomationTestKit.Uid("spend"), sub));
    await _db.QueryAsync(
      """
      insert into automation_draft_decisions (draft_id, run_id, deck_id, mode, state, qa_job_id, qa_enqueued_at, estimated_cost_usd, created_at,
        decided_at)
      values ($1, $2, $3, 'dry_run', $4, $5, case when $6::int is null then null else now() - make_interval(mins => $6::int) end, $7,
        now() - make_interval(days => $8), case when $4 in ('human','would_accept') then now() end)
      """,
      draftId, runId, deck.Id, state, Guid.NewGuid(), enqueuedMinutesAgo, costUsd, createdDaysAgo);
    // The spend itself, dated like the decision (R18B backend-design-4: the cap sums automation_qa_spend.spent_at).
    if (costUsd > 0)
    {
      await _db.QueryAsync(
        """
        insert into automation_qa_spend (qa_job_id, request_key, draft_id, estimated_cost_usd, spent_at)
        values ($1, '', $2, $3, now() - make_interval(days => $4))
        """,
        Guid.NewGuid(), draftId, costUsd, createdDaysAgo);
    }
    return draftId;
  }

  private Task DeleteDecisionsAsync(IEnumerable<long> draftIds) =>
    _db.QueryAsync("delete from automation_draft_decisions where draft_id = any($1)", draftIds.ToArray());

  [Fact]
  public async Task SpendToday_IncludesDraftQaCost()
  {
    var inserted = new List<long>();
    try
    {
      var before = await SpendAsync();
      inserted.Add(await InsertDecisionAsync("human", 0.123456m));
      inserted.Add(await InsertDecisionAsync("would_accept", 0.000544m));
      // Yesterday's decision spend is not today's.
      inserted.Add(await InsertDecisionAsync("human", 3m, createdDaysAgo: 2));

      var after = await SpendAsync();
      Assert.Equal(before.Spent + 0.124m, after.Spent);
      Assert.Equal(before.OpenCards, after.OpenCards);
    }
    finally
    {
      await DeleteDecisionsAsync(inserted);
    }
  }

  [Fact]
  public async Task SpendToday_ReservesQueuedDecisions()
  {
    var inserted = new List<long>();
    try
    {
      var before = await SpendAsync();
      inserted.Add(await InsertDecisionAsync("qa_queued", 0m, enqueuedMinutesAgo: 1));
      inserted.Add(await InsertDecisionAsync("qa_queued", 0m, enqueuedMinutesAgo: 30));
      // Older than QaRuns.StaleAfter (2 h): no longer reserved.
      inserted.Add(await InsertDecisionAsync("qa_queued", 0m, enqueuedMinutesAgo: 180));
      // Not sent: nothing to reserve.
      inserted.Add(await InsertDecisionAsync("qa_pending", 0m));

      var after = await SpendAsync();
      Assert.Equal(before.OpenCards + 2, after.OpenCards);
      Assert.Equal(before.Spent, after.Spent);
    }
    finally
    {
      await DeleteDecisionsAsync(inserted);
    }
  }

  [Fact]
  public async Task DraftQa_RespectsTheSharedDailyCap()
  {
    using var scope = new AutomationTestKit.Scope();
    const decimal perCard = 0.05m;
    var start = await SpendAsync();
    // Headroom for exactly one card.
    scope.Set(QaRuns.DailyCapEnv, (start.Spent + start.OpenCards * perCard + perCard).ToString(CultureInfo.InvariantCulture));

    var sub = AutomationTestKit.Sub("sharedcap");
    var deck = await AutomationTestKit.NewDeckAsync(_db, "sharedcap");
    var runId = await AutomationTestKit.NewRunAsync(_db, sub, deck.Id);
    var ids = await AutomationTestKit.SubmitDraftsAsync(AutomationTestKit.Ctx(sub), deck.Id, runId,
      AutomationTestKit.Card(AutomationTestKit.Uid("cap-a"), "Which synthetic lighthouse guides ships at night?"),
      AutomationTestKit.Card(AutomationTestKit.Uid("cap-b"), "Which synthetic canal lock raises boats uphill?"));

    var first = (await AutomationTestKit.DecisionAsync(_db, ids[0]))!;
    var second = (await AutomationTestKit.DecisionAsync(_db, ids[1]))!;
    Assert.Equal("qa_queued", first["state"]);
    Assert.Equal(("qa_pending", "AI_QA_DAILY_CAP"), ((string)second["state"]!, (string)second["reason"]!));
    Assert.Single(scope.QaSent);
    Assert.Equal(start.OpenCards + 1, (await SpendAsync()).OpenCards);

    // The queued draft's reservation also holds back a human run: the cap is shared.
    var other = await AutomationTestKit.NewDeckAsync(_db, "sharedcap-human");
    await AutomationTestKit.NewCardAsync(_db, other.Id, AutomationTestKit.Uid("cap-human"), "A synthetic card about harbours");
    await using (var conn = await _db.OpenAsync())
    {
      var chained = await QaRuns.StartChangedRunAsync(conn, other.Id, AutomationTestKit.Sub("human"), "test");
      Assert.NotNull(chained);
      Assert.Equal(("not_started", "AI_QA_DAILY_CAP"), (chained!.Status, chained.Code));
    }

    // One more card of headroom lets the waiting draft through.
    scope.Set(QaRuns.DailyCapEnv, (start.Spent + start.OpenCards * perCard + 2 * perCard).ToString(CultureInfo.InvariantCulture));
    await using (var conn = await _db.OpenAsync())
    {
      Assert.Equal("qa_queued", await DraftDecisions.EnqueueQaAsync(conn, ids[1]));
    }
    Assert.Equal(2, scope.QaSent.Count);
  }

  [Fact]
  public async Task QaStatus_ReportsCombinedLimits()
  {
    using var scope = new AutomationTestKit.Scope();
    const decimal perCard = 0.05m;
    var deck = await AutomationTestKit.NewDeckAsync(_db, "status");
    var reader = AutomationTestKit.Ctx(AutomationTestKit.Sub("status"), agent: false);
    var query = new Dictionary<string, string> { ["deckId"] = deck.Id.ToString(CultureInfo.InvariantCulture) };

    var inserted = new List<long>();
    try
    {
      var before = AutomationTestKit.Data(await AutomationTestKit.CallAsync(QaRuns.HandleStatus, "GET", "/api/v1/authoring/qa/status", null, reader, query))
        .GetProperty("limits");
      inserted.Add(await InsertDecisionAsync("human", 0.25m));
      inserted.Add(await InsertDecisionAsync("qa_queued", 0.5m, enqueuedMinutesAgo: 5));

      var limits = AutomationTestKit.Data(await AutomationTestKit.CallAsync(QaRuns.HandleStatus, "GET", "/api/v1/authoring/qa/status", null, reader, query))
        .GetProperty("limits");
      Assert.Equal(["maxCards", "dailyUsdCap", "spentTodayUsd", "reservedTodayUsd"], limits.EnumerateObject().Select(p => p.Name).ToArray());
      Assert.Equal(before.GetProperty("spentTodayUsd").GetDecimal() + 0.75m, limits.GetProperty("spentTodayUsd").GetDecimal());
      Assert.Equal(before.GetProperty("reservedTodayUsd").GetDecimal() + perCard, limits.GetProperty("reservedTodayUsd").GetDecimal());

      var (spent, openCards) = await SpendAsync();
      Assert.Equal(spent, limits.GetProperty("spentTodayUsd").GetDecimal());
      Assert.Equal(openCards * perCard, limits.GetProperty("reservedTodayUsd").GetDecimal());
    }
    finally
    {
      await DeleteDecisionsAsync(inserted);
    }
  }

  [Fact]
  public async Task SpendToday_WithoutDecisionTable_CountsRunsOnly()
  {
    var scratch = await _db.CreateScratchDatabaseAsync("it_a03_spend_033");
    await using var conn = new NpgsqlConnection(scratch);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, 33);
    var deckId = AutomationTestKit.Long(await DbUtil.ExecuteScalarAsync(conn, null,
      "insert into decks (slug, title, author) values ($1, 'deck a03', 'tests') returning id", [$"it-a03-spend-{Guid.NewGuid():N}"]));
    await DbUtil.ExecuteAsync(conn, null,
      """
      insert into ai_qa_runs (id, deck_id, scope, status, requested_by_sub, card_count, chunk_count, cards_done, estimated_cost_usd, finished_at)
      values ($1, $2, 'all', 'done', 'it-a03', 2, 1, 2, 0.4, now()), ($3, $2, 'all', 'running', 'it-a03', 5, 1, 2, 0.1, null)
      """,
      [Guid.NewGuid(), deckId, Guid.NewGuid()]);

    Assert.Equal((0.5m, 3L), await QaRuns.SpendTodayAsync(conn, null));

    // Inside the cap transaction the missing table is probed, never hit: the transaction stays usable.
    await using var tx = await conn.BeginTransactionAsync();
    await DbUtil.ExecuteAsync(conn, tx, "select pg_advisory_xact_lock($1)", [QaRuns.DailyCapLockKey]);
    Assert.Equal((0.5m, 3L), await QaRuns.SpendTodayAsync(conn, tx));
    Assert.Equal(1, Convert.ToInt32(await DbUtil.ExecuteScalarAsync(conn, tx, "select 1", []), CultureInfo.InvariantCulture));
    await tx.RollbackAsync();
  }
}
