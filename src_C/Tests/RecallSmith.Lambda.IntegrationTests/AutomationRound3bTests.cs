using System.Globalization;
using System.Text.Json;
using Npgsql;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Automation;
using RecallSmith.Lambda.Vpc.Qa;
using RecallSmith.Lambda.Worker.Services;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// R18D D02 (automation fix round 3b): one unresolved deck blockage is one exception and one backlog item
/// (backend-design-19, automation-25), the decision sweep is repair-only (backend-design-18), the weekly digest survives
/// a running tick (cloud-security-resilience-13), and the pre-035 publish fallbacks are pinned (backend-design-20).
/// Every test runs in its own scratch database with <c>PGDATABASE</c> switched for the handlers and restored after.
/// </summary>
[Collection(PostgresCollection.Name)]
public class AutomationRound3bTests
{
  private const string ScratchName = "it_d02_round3b";
  private readonly PostgresFixture _db;

  public AutomationRound3bTests(PostgresFixture db) => _db = db;

  private async Task InScratchAsync(Func<A04Kit.Sql, Task> body, int maxVersion = int.MaxValue)
  {
    // Unpooled: each test drops and recreates the scratch database, which kills any pooled connection to the old one.
    var connectionString = new NpgsqlConnectionStringBuilder(await _db.CreateScratchDatabaseAsync(ScratchName)) { Pooling = false }.ConnectionString;
    await using (var conn = new NpgsqlConnection(connectionString))
    {
      await conn.OpenAsync();
      await PostgresFixture.ApplyMigrationsAsync(conn, maxVersion);
    }
    var savedDb = Environment.GetEnvironmentVariable("PGDATABASE");
    try
    {
      Environment.SetEnvironmentVariable("PGDATABASE", ScratchName);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
      await body(new A04Kit.Sql(connectionString));
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", savedDb);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
    }
  }

  private static async Task<JsonElement> TickDataAsync(string job = "tick") => AutomationTestKit.Data(await A04Kit.TickAsync(job, Guid.NewGuid()));

  private static async Task<AutoPublishOutcome> EvaluateAsync(A04Kit.Sql sql, long deckId, Guid runId)
  {
    await using var conn = await sql.OpenAsync();
    var outcome = await AutoPublisher.EvaluateAsync(conn, deckId, runId);
    Assert.NotNull(outcome);
    return outcome!;
  }

  private static async Task<StatusRoutes.Backlog> BacklogAsync(A04Kit.Sql sql)
  {
    await using var conn = await sql.OpenAsync();
    return await StatusRoutes.LoadBacklogAsync(conn);
  }

  private static Task<long> BlockedAlertsAsync(A04Kit.Sql sql) =>
    sql.CountAsync("select count(*) from automation_notifications where subkind = 'publish_blocked'");

  // ---------------------------------------------------------------- backend-design-19 / automation-25

  [Fact]
  public async Task Evaluate_RepeatedLiveRunsIntoABlockedDeck_RaiseOneAlert_AndOneBacklogItem()
  {
    await using var scope = new A04Kit.Scope(AutomationMode.Live);
    await InScratchAsync(async sql =>
    {
      await scope.GateAsync(sql);
      var sub = AutomationTestKit.Sub("d02-blocked");
      var deck = await A04Kit.PublishedDeckAsync(sql, "d02-blocked");
      // A human edits a live card after the live build: every later run into the deck is blocked until a person publishes.
      await sql.QueryAsync(
        "update cards set question = 'An edited synthetic question about lighthouses?', updated_at = now() where deck_id = $1 and stable_uid = $2",
        deck.Id, deck.OldUid);

      var first = await EvaluateAsync(sql, deck.Id, await A04Kit.RunAsync(sql, sub, deck.Id, "completed"));
      var second = await EvaluateAsync(sql, deck.Id, await A04Kit.RunAsync(sql, sub, deck.Id, "completed"));

      Assert.Equal(("human", "DECK_HAS_HUMAN_CHANGES"), (first.State, first.Reason));
      Assert.Equal(("human", "DECK_HAS_HUMAN_CHANGES"), (second.State, second.Reason));
      Assert.NotEqual(first.PublishId, second.PublishId);
      // One exception: the alert of the blockage's first row, and no second email.
      Assert.Equal(1, await BlockedAlertsAsync(sql));
      Assert.Equal(1, await sql.CountAsync("select count(*) from automation_notifications where dedupe_key = $1",
        $"exception:publish_blocked:{first.PublishId}"));
      Assert.Single(A04Kit.Messages(scope, deck.Slug));
      // Each evaluation keeps its own ledger row.
      Assert.Equal(2, await sql.CountAsync("select count(*) from automation_events where automation = 'auto_publish' and deck_id = $1", deck.Id));

      // One deck is one publish a person has to do: one backlog item, since the blockage began.
      var backlog = await BacklogAsync(sql);
      Assert.Equal(1, backlog.HumanPublishes);
      var item = Assert.Single(backlog.HumanPublishItems);
      Assert.Equal((deck.Id, "DECK_HAS_HUMAN_CHANGES"), (A04Kit.Long(item["deck_id"]), (string)item["reason"]!));
      Assert.Equal((await A04Kit.PublishRowAsync(sql, first.PublishId))["updated_at"], item["updated_at"]);

      // A new reason is a new exception; the deck still counts once, with its newest reason.
      scope.Set(AutomationEnv.AutoPublishEnv, "0");
      var disabled = await EvaluateAsync(sql, deck.Id, await A04Kit.RunAsync(sql, sub, deck.Id, "completed"));
      Assert.Equal("AUTO_PUBLISH_DISABLED", disabled.Reason);
      Assert.Equal(2, await BlockedAlertsAsync(sql));
      backlog = await BacklogAsync(sql);
      Assert.Equal(1, backlog.HumanPublishes);
      item = Assert.Single(backlog.HumanPublishItems);
      Assert.Equal("AUTO_PUBLISH_DISABLED", item["reason"]);
      Assert.Equal((await A04Kit.PublishRowAsync(sql, first.PublishId))["updated_at"], item["updated_at"]);

      // A human publish resolves the deck; the next blockage is a new exception with its own alert.
      await sql.QueryAsync(
        """
        insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, job_id, status, published_by_admin_sub)
        values ($1, $2, 'd02-human-build', 'content/decks/d02/deck.json', $3, 'SUCCESS', 'it-d02')
        """, deck.Id, deck.Slug, Guid.NewGuid().ToString());
      Assert.Equal(0, (await BacklogAsync(sql)).HumanPublishes);
      scope.Set(AutomationEnv.AutoPublishEnv, null);
      var again = await EvaluateAsync(sql, deck.Id, await A04Kit.RunAsync(sql, sub, deck.Id, "completed"));
      Assert.Equal("DECK_HAS_HUMAN_CHANGES", again.Reason);
      Assert.Equal(3, await BlockedAlertsAsync(sql));
      Assert.Equal(1, await sql.CountAsync("select count(*) from automation_notifications where dedupe_key = $1",
        $"exception:publish_blocked:{again.PublishId}"));
      Assert.Equal(1, (await BacklogAsync(sql)).HumanPublishes);
    });
  }

  [Fact]
  public async Task Backlog_CountsDecksNotRows_OneItemPerDeck()
  {
    await using var scope = new A04Kit.Scope();
    await InScratchAsync(async sql =>
    {
      var a = A04Kit.Long(await sql.ScalarAsync("insert into decks (slug, title, author) values ($1, 'd02 a', 'tests') returning id", A04Kit.Tag("d02-a")));
      var b = A04Kit.Long(await sql.ScalarAsync("insert into decks (slug, title, author) values ($1, 'd02 b', 'tests') returning id", A04Kit.Tag("d02-b")));
      var run = await A04Kit.RunAsync(sql, "it-d02", a, "completed");
      await sql.QueryAsync(
        """
        insert into automation_publishes (deck_id, run_id, mode, state, reason, created_at, updated_at) values
          ($1, $3, 'live', 'human', 'DECK_HAS_HUMAN_CHANGES', now() - interval '3 days', now() - interval '3 days'),
          ($1, $3, 'live', 'human', 'DECK_HAS_HUMAN_CHANGES', now() - interval '2 days', now() - interval '2 days'),
          ($1, $3, 'live', 'human', 'AUTO_PUBLISH_DISABLED', now() - interval '1 day', now() - interval '1 day'),
          ($2, $3, 'live', 'human', 'PUBLISH_FAILED', now() - interval '2 days', now() - interval '2 days')
        """, a, b, run);

      var backlog = await BacklogAsync(sql);

      Assert.Equal(2, backlog.HumanPublishes);
      Assert.Equal([a, b], backlog.HumanPublishItems.Select(i => A04Kit.Long(i["deck_id"])).ToArray());
      Assert.Equal(["AUTO_PUBLISH_DISABLED", "PUBLISH_FAILED"], backlog.HumanPublishItems.Select(i => (string)i["reason"]!).ToArray());
      var since = backlog.HumanPublishItems[0]["updated_at"] is DateTimeOffset dto ? dto.UtcDateTime : (DateTime)backlog.HumanPublishItems[0]["updated_at"]!;
      Assert.InRange(DateTime.UtcNow - since, TimeSpan.FromDays(2.9), TimeSpan.FromDays(3.1));
    });
  }

  // ---------------------------------------------------------------- backend-design-18

  [Fact]
  public async Task Sweep_DraftSubmittedWhileOff_EndsHumanAndNeverReachesQa()
  {
    await using var scope = new A04Kit.Scope(AutomationMode.Off);
    await InScratchAsync(async sql =>
    {
      var sub = AutomationTestKit.Sub("d02-off");
      var deck = await A04Kit.PublishedDeckAsync(sql, "d02-off");
      var running = await A04Kit.RunAsync(sql, sub, deck.Id);
      // Off at submit: the hook deliberately creates no decision. The owner flips back while the run is still running.
      var draftId = (await AutomationTestKit.SubmitDraftsAsync(AutomationTestKit.Ctx(sub), deck.Id, running,
        AutomationTestKit.Card(AutomationTestKit.Uid("d02"), "Which synthetic tide gauge reads the neap tide?")))[0];
      Assert.Equal(0, await sql.CountAsync("select count(*) from automation_draft_decisions"));
      await sql.QueryAsync("update ai_drafts set created_at = now() - make_interval(mins => $2) where id = $1",
        draftId, DraftDecisions.MissingDecisionGraceMinutes + 1);
      scope.Set(AutomationMode.EnvName, AutomationMode.DryRun);

      await TickDataAsync();

      var d = (await sql.QueryAsync("select state, reason, reason_detail, run_id from automation_draft_decisions where draft_id = $1", draftId)).Single();
      Assert.Equal(("human", "ENQUEUE_FAILED", DraftDecisions.SweptDetail, running),
        ((string)d["state"]!, (string)d["reason"]!, (string)d["reason_detail"]!, (Guid)d["run_id"]!));
      Assert.Empty(scope.QaSent);
      Assert.Equal(0, await sql.CountAsync("select count(*) from automation_decision_events where draft_id = $1 and to_state <> 'human'", draftId));
      Assert.Equal("pending", await sql.ScalarAsync("select status from ai_drafts where id = $1", draftId));
    });
  }

  [Fact]
  public async Task Submit_NonAgentClientWithRunId_DropsTheRunId_AndTheSweepLeavesTheDraftAlone()
  {
    await using var scope = new A04Kit.Scope(AutomationMode.DryRun);
    await InScratchAsync(async sql =>
    {
      var sub = AutomationTestKit.Sub("d02-console");
      var deck = await A04Kit.PublishedDeckAsync(sql, "d02-console");
      var running = await A04Kit.RunAsync(sql, sub, deck.Id);
      // The run's owner posts through the console (not the agent client) with a hand-made agent.runId.
      var draftId = (await AutomationTestKit.SubmitDraftsAsync(AutomationTestKit.Ctx(sub, agent: false), deck.Id, running,
        AutomationTestKit.Card(AutomationTestKit.Uid("d02"), "Which synthetic pilot boat meets the ferry?")))[0];
      var agent = (string)(await sql.ScalarAsync("select agent::text from ai_drafts where id = $1", draftId))!;
      using (var doc = JsonDocument.Parse(agent))
      {
        Assert.False(doc.RootElement.TryGetProperty("runId", out _));
        Assert.Equal("it-agent", doc.RootElement.GetProperty("name").GetString());
      }
      await sql.QueryAsync("update ai_drafts set created_at = now() - make_interval(mins => $2) where id = $1",
        draftId, DraftDecisions.MissingDecisionGraceMinutes + 1);

      await TickDataAsync();

      // A plain review-queue draft: no decision, no draft QA.
      Assert.Equal(0, await sql.CountAsync("select count(*) from automation_draft_decisions where draft_id = $1", draftId));
      Assert.Empty(scope.QaSent);
    });
  }

  // ---------------------------------------------------------------- cloud-security-resilience-13

  [Fact]
  public async Task Digest_WhileATickHoldsTheLock_IsStillSentOnce()
  {
    await using var scope = new A04Kit.Scope();
    await InScratchAsync(async sql =>
    {
      var deckId = A04Kit.Long(await sql.ScalarAsync("insert into decks (slug, title, author) values ($1, 'd02 lock', 'tests') returning id", A04Kit.Tag("d02-lock")));
      // Work only the tick steps would do: an expired lease.
      var itemId = A04Kit.Long(await sql.ScalarAsync(
        """
        insert into authoring_queue_items (kind, url, deck_id, dedupe_key, created_by, status, attempts, claimed_by_runner, claimed_at, lease_expires_at)
        values ('manual', $1, $2, $3, 'owner:it-d02', 'claimed', 1, 'it-d02-runner', now() - interval '3 hours', now() - interval '1 minute')
        returning id
        """, $"https://docs.example.com/d02/{Guid.NewGuid():N}", deckId, $"it-d02:{Guid.NewGuid()}"));

      await using var holder = await sql.OpenAsync();
      Assert.Equal(true, await DbUtil.ExecuteScalarAsync(holder, null, "select pg_try_advisory_lock($1)", [AutomationTick.LockKey]));
      try
      {
        var data = await TickDataAsync("digest");

        Assert.Equal("locked", data.GetProperty("skipped").GetString());
        Assert.True(data.GetProperty("actions").GetProperty("digest").GetBoolean());
        Assert.Empty(data.GetProperty("failedSteps").EnumerateArray());
        var today = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        Assert.Equal(1, await sql.CountAsync("select count(*) from automation_notifications where dedupe_key = $1 and kind = 'weekly_digest'", $"digest:{today}"));
        Assert.Single(A04Kit.Messages(scope, "Weekly automation digest"));
        // The tick steps stay single-flight: nothing of theirs ran.
        Assert.Equal("claimed", await sql.ScalarAsync("select status from authoring_queue_items where id = $1", itemId));

        // A repeated digest call, and a plain tick, still under the held lock: nothing more is sent.
        Assert.False((await TickDataAsync("digest")).GetProperty("actions").GetProperty("digest").GetBoolean());
        var tick = await TickDataAsync();
        Assert.Equal("locked", tick.GetProperty("skipped").GetString());
        Assert.False(tick.GetProperty("actions").GetProperty("digest").GetBoolean());
        Assert.Single(A04Kit.Messages(scope, "Weekly automation digest"));
      }
      finally
      {
        await DbUtil.ExecuteScalarAsync(holder, null, "select pg_advisory_unlock($1)", [AutomationTick.LockKey]);
      }

      // The digest call released no lock it did not take: a tick now runs normally.
      var ran = await TickDataAsync();
      Assert.Equal(JsonValueKind.Null, ran.GetProperty("skipped").ValueKind);
      Assert.Equal("queued", await sql.ScalarAsync("select status from authoring_queue_items where id = $1", itemId));
    });
  }

  // ---------------------------------------------------------------- backend-design-20: the pre-035 window

  [Fact]
  public async Task Pre035_ConsolePublishFallsBack_AutomationPublishFails_WorkerSeesNoSettingsChange()
  {
    var savedRequired = Environment.GetEnvironmentVariable(QaGate.RequiredEnv);
    var savedSeam = Publish.TestEnqueueSeam;
    var sent = new List<Amazon.SQS.Model.SendMessageRequest>();
    try
    {
      Environment.SetEnvironmentVariable(QaGate.RequiredEnv, null);
      Publish.TestEnqueueSeam = new Publish.EnqueueSeam(A04Kit.FakePublishQueueUrl, A04Kit.FakeContentBucket, r =>
      {
        lock (sent) sent.Add(r);
        return Task.CompletedTask;
      });
      // Code shipped, console Migrate not yet clicked: the database stops at 034.
      await InScratchAsync(async sql =>
      {
        Assert.Equal(0, await sql.CountAsync(
          "select count(*) from information_schema.columns where table_name = 'deck_publishes' and column_name in ('card_ids', 'deck_updated_at')"));
        var deck = await A04Kit.PublishedDeckAsync(sql, "d02-pre035");
        await using var conn = await sql.OpenAsync();

        // An automation publish (bound to the deck settings it checked) never runs unbound: the 42703 propagates.
        var checkedAt = (DateTime)(await sql.ScalarAsync("select updated_at from decks where id = $1", deck.Id))!;
        var ex = await Assert.ThrowsAsync<PostgresException>(() => Publish.StartPublishAsync(conn, deck.Id, AutoPublisher.Actor, "auto-publish d02",
          bindSnapshot: true, expectedSnapshot: null, allowResume: false, expectedDeckUpdatedAt: checkedAt));
        Assert.Equal("42703", ex.SqlState);
        Assert.Equal(0, await sql.CountAsync("select count(*) from deck_publishes where deck_id = $1 and status = 'PENDING'", deck.Id));
        Assert.Empty(sent);

        // A console publish falls back to the legacy insert and is queued.
        var start = await Publish.StartPublishAsync(conn, deck.Id, "it-d02-admin", "console publish", bindSnapshot: false, expectedSnapshot: null,
          allowResume: true);
        Assert.Equal(Publish.Queued, start.Outcome);
        var job = (await sql.QueryAsync("select status, published_by_admin_sub from deck_publishes where job_id = $1", start.JobId)).Single();
        Assert.Equal(("PENDING", "it-d02-admin"), ((string)job["status"]!, (string)job["published_by_admin_sub"]!));
        Assert.Single(sent);

        // The Worker's settings check: no job records deck settings before 035.
        Assert.False(await PublishJobProcessor.DeckSettingsChangedAsync(start.JobId!));
      }, maxVersion: 34);
    }
    finally
    {
      Environment.SetEnvironmentVariable(QaGate.RequiredEnv, savedRequired);
      Publish.TestEnqueueSeam = savedSeam;
    }
  }
}
