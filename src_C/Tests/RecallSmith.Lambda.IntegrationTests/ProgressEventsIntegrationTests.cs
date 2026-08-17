using System.Globalization;
using System.Text.Json;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The ingest, end to end, against a real Postgres.
///
/// Everything checked here lives in one SQL statement that no unit test can
/// reach: an inline VALUES list joined on event_id, a `distinct on` whose
/// tiebreak decides what the user sees, a four-column LWW group under a single
/// predicate, and two clamps whose effect only exists once a timestamp has been
/// through to_timestamp and back. These tests exist because "the text says so"
/// and "the planner does so" are different claims.
/// </summary>
[Collection(PostgresCollection.Name)]
public class ProgressEventsIntegrationTests
{
  private readonly PostgresFixture _db;

  private const string Deck = "csharp-basics";

  // Well before now, so nothing in these fixtures trips the future-clock clamp
  // by accident and hides the behaviour under test.
  private static readonly long Base = DateTimeOffset.UtcNow.AddDays(-10).ToUnixTimeMilliseconds();

  private const long OneDayMs = 24L * 60 * 60 * 1000;
  private const long HorizonMs = 90L * 24 * 60 * 60 * 1000;

  // The state columns the merge is responsible for, rendered to fixed text so
  // two users' outcomes can be compared exactly. id/created_at/updated_at are
  // excluded on purpose: they record when the run happened, not what it decided.
  private const string StateSql = """
    select
      deck_slug, stable_uid, status, last_rating, review_count,
      to_char(last_reviewed_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') as last_reviewed_at,
      to_char(due_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') as due_at,
      last_seen_revision, srs_stage, last_scheduler_version
    from user_progress
    where user_sub = $1
    order by deck_slug, stable_uid
    """;

  public ProgressEventsIntegrationTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- helpers

  private static string NewUser(string tag) => $"it-progress-{tag}-{Guid.NewGuid():N}";

  private static string NewEventId() => Guid.NewGuid().ToString("D").ToLowerInvariant();

  private static object Ev(
    string eventId,
    string stableUid,
    int? rating,
    long eventTimeMs,
    long? nextReviewAtMs = null,
    int? stage = null,
    string? schedulerVersion = null,
    int? lastSeenRevision = null) => new
    {
      eventId,
      deckSlug = Deck,
      stableUid,
      rating,
      eventTimeMs,
      nextReviewAtMs,
      schedulerVersion,
      sessionId = "sess-1",
      progressAfter = new { stage, lastSeenRevision },
    };

  private static object Batch(IEnumerable<object> events) => new
  {
    deviceId = "device-under-test",
    clientVersion = "1.2.3",
    clientPlatform = "ios",
    events = events.ToList(),
  };

  private static Task<JsonElement> PostAsync(string userSub, IEnumerable<object> events) =>
    LambdaHost.PostProgressEventsAsync(userSub, Batch(events));

  private static int Count(JsonElement data, string prop) => data.GetProperty(prop).GetArrayLength();

  private static int? AsInt(object? v) => v is null ? null : Convert.ToInt32(v, CultureInfo.InvariantCulture);

  private async Task<List<string>> StateAsync(string userSub)
  {
    var rows = await _db.QueryAsync(StateSql, userSub);
    return rows
      .Select(r => string.Join(
        "|",
        r.OrderBy(kv => kv.Key, StringComparer.Ordinal)
          .Select(kv => $"{kv.Key}={kv.Value ?? "<null>"}")))
      .ToList();
  }

  // ------------------------------------------------------------------ T1

  [Fact]
  public async Task Replay_OfTheSameBatch_IsExactlyIdempotent()
  {
    var user = NewUser("t1");
    var events = new List<object>();
    for (var card = 0; card < 25; card++)
    {
      for (var n = 0; n < 8; n++)
      {
        events.Add(Ev(
          NewEventId(),
          $"card-{card:D2}",
          rating: (n % 4) + 1,
          eventTimeMs: Base + (card * 1000L) + n,
          nextReviewAtMs: Base + (card * 1000L) + n + OneDayMs,
          stage: n % 7,
          schedulerVersion: "v1"));
      }
    }

    Assert.Equal(200, events.Count);

    var first = await PostAsync(user, events);
    Assert.Equal(200, first.GetProperty("acceptedCount").GetInt32());
    Assert.Equal(0, Count(first, "duplicateEventIds"));

    for (var replay = 0; replay < 9; replay++)
    {
      var again = await PostAsync(user, events);
      Assert.Equal(0, again.GetProperty("acceptedCount").GetInt32());
      Assert.Equal(200, Count(again, "duplicateEventIds"));
    }

    var eventRows = Convert.ToInt32(
      await _db.ScalarAsync("select count(*) from user_progress_events where user_sub = $1", user),
      CultureInfo.InvariantCulture);
    Assert.Equal(200, eventRows);

    var reviewTotal = Convert.ToInt32(
      await _db.ScalarAsync("select coalesce(sum(review_count), 0) from user_progress where user_sub = $1", user),
      CultureInfo.InvariantCulture);
    Assert.Equal(200, reviewTotal);

    // The outbox has no user_sub of its own, so it is counted through the
    // events it was written from. Ten posts, one outbox row per event: the
    // downstream analytics pipeline must not see the replays either.
    var outboxRows = Convert.ToInt32(
      await _db.ScalarAsync(
        """
        select count(*)
        from analytics_event_outbox o
        join user_progress_events e on e.event_id = o.event_id
        where e.user_sub = $1
        """,
        user),
      CultureInfo.InvariantCulture);
    Assert.Equal(200, outboxRows);
  }

  // ------------------------------------------------------------------ T2

  // Fresh event ids on every call, because event_id is the PRIMARY KEY of
  // user_progress_events and that key is global, not scoped by user_sub. Two
  // users therefore cannot replay one another's ids: the second one's whole
  // batch is swallowed by ON CONFLICT DO NOTHING and reported back as
  // duplicates. Everything else about the twelve events is identical, which is
  // what makes the three orderings comparable.
  private static List<object> BuildReorderingSet()
  {
    var events = new List<object>();
    for (var card = 0; card < 3; card++)
    {
      for (var n = 0; n < 4; n++)
      {
        events.Add(Ev(
          NewEventId(),
          $"card-{card}",
          rating: ((card + n) % 4) + 1,
          // Distinct times across the whole set: ties are T6's subject, and
          // mixing them in here would make a failure ambiguous.
          eventTimeMs: Base + (card * 10_000L) + (n * 137L),
          nextReviewAtMs: Base + (card * 10_000L) + (n * 137L) + OneDayMs * (n + 1),
          stage: n,
          schedulerVersion: $"v{n}",
          lastSeenRevision: n));
      }
    }

    return events;
  }

  [Fact]
  public async Task Reordering_TheSameEvents_ReachesTheSameFinalState()
  {
    var chronological = NewUser("t2-chrono");
    var reversed = NewUser("t2-reverse");
    var dribbled = NewUser("t2-dribble");

    var setA = BuildReorderingSet();
    var setB = BuildReorderingSet();
    var setC = BuildReorderingSet();

    foreach (var chunk in setA.Chunk(4)) await PostAsync(chronological, chunk);
    foreach (var chunk in Enumerable.Reverse(setB).Chunk(4)) await PostAsync(reversed, chunk);

    // A fixed shuffle, not Random: a test that reorders differently on every
    // run reports a different bug every run.
    var shuffleOrder = new[] { 7, 0, 11, 3, 5, 9, 1, 10, 2, 8, 4, 6 };
    foreach (var i in shuffleOrder) await PostAsync(dribbled, [setC[i]]);

    var a = await StateAsync(chronological);
    var b = await StateAsync(reversed);
    var c = await StateAsync(dribbled);

    Assert.Equal(3, a.Count);
    Assert.Equal(a, b);
    Assert.Equal(a, c);
  }

  /// <summary>
  /// Not a rule anyone wrote down, but one a live database enforces: event_id
  /// is a bare `uuid primary key`, so idempotency is global rather than
  /// per-user. A second user replaying a first user's ids loses the whole
  /// batch, and the response calls those events duplicates, which is exactly
  /// what a client uses to drop them from its outbox.
  ///
  /// Pinned here because it is invisible from the C# side and because a v4
  /// collision is not the only way to reach it: a restored backup, a cloned
  /// device image or a seeded id generator all produce it deterministically.
  /// </summary>
  [Fact]
  public async Task EventIdIdempotency_IsGlobal_NotPerUser()
  {
    var first = NewUser("t3b-first");
    var second = NewUser("t3b-second");

    var eventId = NewEventId();
    var shared = new[] { Ev(eventId, "card-shared", 4, Base, Base + OneDayMs, stage: 2) };

    var a = await PostAsync(first, shared);
    Assert.Equal(1, a.GetProperty("acceptedCount").GetInt32());

    var b = await PostAsync(second, shared);
    Assert.Equal(0, b.GetProperty("acceptedCount").GetInt32());
    Assert.Equal([eventId], b.GetProperty("duplicateEventIds").EnumerateArray().Select(x => x.GetString()).ToList());

    // The second user's review is gone, not merged elsewhere.
    Assert.Empty(await _db.QueryAsync("select 1 as x from user_progress where user_sub = $1", second));
  }

  // ------------------------------------------------------------------ T3

  [Fact]
  public async Task DuplicateEventIds_AcrossBatches_AreReportedAndNotRecounted()
  {
    var user = NewUser("t3");

    var shared = NewEventId();
    var batch1 = new List<object>
    {
      Ev(NewEventId(), "card-a", 3, Base + 1, Base + 1 + OneDayMs, stage: 1),
      Ev(NewEventId(), "card-b", 2, Base + 2, Base + 2 + OneDayMs, stage: 1),
      Ev(shared, "card-c", 4, Base + 3, Base + 3 + OneDayMs, stage: 2),
    };

    var first = await PostAsync(user, batch1);
    Assert.Equal(3, first.GetProperty("acceptedCount").GetInt32());
    Assert.Equal(0, Count(first, "duplicateEventIds"));

    var batch2 = new List<object>
    {
      // Same event_id, later time and a different verdict. The row already
      // exists, so ON CONFLICT DO NOTHING must drop it whole: neither the
      // rating nor the count may leak through.
      Ev(shared, "card-c", 1, Base + 9_000, Base + 9_000 + OneDayMs, stage: 0),
      Ev(NewEventId(), "card-d", 3, Base + 4, Base + 4 + OneDayMs, stage: 1),
      Ev(NewEventId(), "card-e", 3, Base + 5, Base + 5 + OneDayMs, stage: 1),
    };

    var second = await PostAsync(user, batch2);
    Assert.Equal(2, second.GetProperty("acceptedCount").GetInt32());
    var dupes = second.GetProperty("duplicateEventIds").EnumerateArray().Select(x => x.GetString()).ToList();
    Assert.Equal([shared], dupes);

    var rows = await _db.QueryAsync(
      "select stable_uid, review_count, last_rating from user_progress where user_sub = $1 order by stable_uid",
      user);
    Assert.Equal(5, rows.Count);

    var cardC = rows.Single(r => (string)r["stable_uid"]! == "card-c");
    Assert.Equal(1, AsInt(cardC["review_count"]));
    Assert.Equal(4, AsInt(cardC["last_rating"]));

    var eventRows = Convert.ToInt32(
      await _db.ScalarAsync("select count(*) from user_progress_events where user_sub = $1", user),
      CultureInfo.InvariantCulture);
    Assert.Equal(5, eventRows);
  }

  // ------------------------------------------------------------------ T4

  [Fact]
  public async Task ClockClamps_BoundBothTheEventTimeAndTheHorizon()
  {
    var user = NewUser("t4");

    var beforeMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    var futureMs = beforeMs + 400L * OneDayMs;

    await PostAsync(user,
    [
      // A device whose clock sits a year ahead, and whose next review sits
      // centuries ahead of even that.
      Ev(NewEventId(), "card-future", 3, futureMs, futureMs + 900L * OneDayMs, stage: 3),
      // A sane clock with an absurd due date: isolates the horizon clamp from
      // the event-time clamp, so a failure names one of the two.
      Ev(NewEventId(), "card-horizon", 3, Base, Base + 200_000L * OneDayMs, stage: 3),
    ]);
    var afterMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    var rows = await _db.QueryAsync(
      """
      select
        stable_uid,
        (extract(epoch from last_reviewed_at) * 1000)::bigint as reviewed_ms,
        extract(epoch from due_at) - extract(epoch from last_reviewed_at) as horizon_s
      from user_progress
      where user_sub = $1
      order by stable_uid
      """,
      user);

    var future = rows.Single(r => (string)r["stable_uid"]! == "card-future");
    var reviewedMs = Convert.ToInt64(future["reviewed_ms"], CultureInfo.InvariantCulture);
    const long SlackMs = 5 * 60 * 1000;
    Assert.InRange(reviewedMs, beforeMs + SlackMs - 2_000, afterMs + SlackMs + 2_000);

    // Both rows land exactly on the horizon: the clamp is applied after the
    // event time has itself been clamped, so the two interact rather than
    // compounding.
    foreach (var row in rows)
    {
      var horizonS = Convert.ToDouble(row["horizon_s"], CultureInfo.InvariantCulture);
      // 2ms of tolerance for the double round trip through to_timestamp; the
      // failure this guards against is off by centuries, not by milliseconds.
      Assert.InRange(horizonS, (HorizonMs / 1000.0) - 0.002, (HorizonMs / 1000.0) + 0.002);
    }
  }

  // ------------------------------------------------------------------ T5

  [Fact]
  public async Task ManyEventsForOneCardInOneBatch_FoldIntoOneRow()
  {
    var user = NewUser("t5");

    var ratings = new[] { 1, 2, 3, 4, 3 };
    var stages = new[] { 0, 1, 2, 3, 4 };
    var events = new List<object>();
    for (var n = 0; n < 5; n++)
    {
      events.Add(Ev(
        NewEventId(),
        "card-solo",
        ratings[n],
        Base + (n * 60_000L),
        nextReviewAtMs: Base + (n * 60_000L) + OneDayMs * (n + 1),
        stage: stages[n],
        schedulerVersion: $"v{n}",
        lastSeenRevision: n));
    }

    // Submitted out of order inside the single batch, so agg's count and
    // last_row's pick are proved independent of array position.
    var scrambled = new List<object> { events[3], events[0], events[4], events[2], events[1] };
    var data = await PostAsync(user, scrambled);
    Assert.Equal(5, data.GetProperty("acceptedCount").GetInt32());

    var row = (await _db.QueryAsync(
      """
      select
        review_count, last_rating, srs_stage, last_scheduler_version, last_seen_revision,
        (extract(epoch from last_reviewed_at) * 1000)::bigint as reviewed_ms,
        (extract(epoch from due_at) * 1000)::bigint as due_ms
      from user_progress
      where user_sub = $1
      """,
      user)).Single();

    Assert.Equal(5, AsInt(row["review_count"]));
    Assert.Equal(ratings[4], AsInt(row["last_rating"]));
    Assert.Equal(stages[4], AsInt(row["srs_stage"]));
    Assert.Equal("v4", row["last_scheduler_version"]);
    Assert.Equal(Base + (4 * 60_000L), Convert.ToInt64(row["reviewed_ms"], CultureInfo.InvariantCulture));
    Assert.Equal(Base + (4 * 60_000L) + OneDayMs * 5, Convert.ToInt64(row["due_ms"], CultureInfo.InvariantCulture));
    // last_seen_revision is greatest(), not part of the LWW verdict, so the
    // highest revision wins regardless of which event carried it.
    Assert.Equal(4, AsInt(row["last_seen_revision"]));
  }

  // ------------------------------------------------------------------ T6

  // 30 tied pairs rather than one: a single pair can be decided correctly by
  // luck under any plan, thirty cannot.
  private const int TiePairs = 30;

  private const int LoserRating = 1;
  private const int WinnerRating = 4;
  private const int LoserStage = 0;
  private const int WinnerStage = 6;

  /// <summary>
  /// Builds one user's tied batch. Each card gets two events sharing an
  /// event_time to the millisecond and disagreeing on every column of the LWW
  /// group; the higher of the two freshly minted event_ids always carries the
  /// WINNER payload, so "the event_id desc tiebreak held" and "the winner
  /// payload survived" are the same statement even though the two users cannot
  /// share ids.
  ///
  /// winnerFirst alternates per card, so a plan that honoured array position
  /// instead of event_id would leave half the cards on the loser and the
  /// comparison below would not merely differ, it would differ in a readable
  /// pattern.
  /// </summary>
  private static List<object> BuildTiedBatch(bool winnerFirstOnEvenCards)
  {
    var batch = new List<object>();
    for (var i = 0; i < TiePairs; i++)
    {
      var ids = new[] { NewEventId(), NewEventId() };
      Array.Sort(ids, StringComparer.Ordinal);
      var uid = $"tie-card-{i:D2}";

      // Identical event_time to the millisecond. This is not a contrived
      // shape: the future-clock clamp maps every event from a skewed device
      // onto the SAME bound, which turns a rare collision into a systematic one.
      var t = Base + 500_000L;
      var loser = Ev(ids[0], uid, LoserRating, t, t + OneDayMs, stage: LoserStage, schedulerVersion: "sched-loser");
      var winner = Ev(ids[1], uid, WinnerRating, t, t + 7 * OneDayMs, stage: WinnerStage, schedulerVersion: "sched-winner");

      var winnerFirst = (i % 2 == 0) == winnerFirstOnEvenCards;
      if (winnerFirst)
      {
        batch.Add(winner);
        batch.Add(loser);
      }
      else
      {
        batch.Add(loser);
        batch.Add(winner);
      }
    }

    return batch;
  }

  [Fact]
  public async Task TiedEventTimes_ResolveByEventIdRegardlessOfArrayOrder()
  {
    var forward = NewUser("t6-forward");
    var backward = NewUser("t6-backward");

    await PostAsync(forward, BuildTiedBatch(winnerFirstOnEvenCards: true));
    // Opposite array position for every card, and the whole array reversed on
    // top of that.
    await PostAsync(backward, Enumerable.Reverse(BuildTiedBatch(winnerFirstOnEvenCards: false)));

    var forwardState = await StateAsync(forward);
    Assert.Equal(TiePairs, forwardState.Count);
    Assert.Equal(forwardState, await StateAsync(backward));

    // Identical is not enough on its own: identically wrong is still wrong. The
    // documented rule is `event_id desc`, so the higher uuid must be the one
    // standing, for every card and for both users.
    foreach (var user in new[] { forward, backward })
    {
      var rows = await _db.QueryAsync(
        "select stable_uid, last_rating, srs_stage, last_scheduler_version from user_progress where user_sub = $1",
        user);
      Assert.Equal(TiePairs, rows.Count);

      foreach (var row in rows)
      {
        Assert.Equal(WinnerRating, AsInt(row["last_rating"]));
        Assert.Equal(WinnerStage, AsInt(row["srs_stage"]));
        Assert.Equal("sched-winner", row["last_scheduler_version"]);
      }
    }
  }

  // ------------------------------------------------------------------ T7

  [Fact]
  public async Task StageJoinsTheLwwGroup_AndANewerStagelessEventClearsIt()
  {
    var user = NewUser("t7-group");

    await PostAsync(user, [Ev(NewEventId(), "card-x", 3, Base, Base + OneDayMs, stage: 2, schedulerVersion: "v1")]);
    var afterFirst = (await _db.QueryAsync(
      "select srs_stage, last_scheduler_version, last_rating from user_progress where user_sub = $1", user)).Single();
    Assert.Equal(2, AsInt(afterFirst["srs_stage"]));
    Assert.Equal("v1", afterFirst["last_scheduler_version"]);

    // A newer event that carries a stage wins the whole group.
    await PostAsync(user, [Ev(NewEventId(), "card-x", 4, Base + 1000, Base + 1000 + OneDayMs, stage: 5, schedulerVersion: "v2")]);
    var afterSecond = (await _db.QueryAsync(
      "select srs_stage, last_scheduler_version, last_rating from user_progress where user_sub = $1", user)).Single();
    Assert.Equal(5, AsInt(afterSecond["srs_stage"]));
    Assert.Equal("v2", afterSecond["last_scheduler_version"]);
    Assert.Equal(4, AsInt(afterSecond["last_rating"]));

    // The seam: an OLD client that reports no stage but is newer still wins,
    // and writing null is the point. Keeping the previous stage next to the new
    // due date would describe a review nobody performed.
    await PostAsync(user, [Ev(NewEventId(), "card-x", 1, Base + 2000, Base + 2000 + OneDayMs)]);
    var afterLegacy = (await _db.QueryAsync(
      "select srs_stage, last_scheduler_version, last_rating from user_progress where user_sub = $1", user)).Single();
    Assert.Null(afterLegacy["srs_stage"]);
    Assert.Null(afterLegacy["last_scheduler_version"]);
    Assert.Equal(1, AsInt(afterLegacy["last_rating"]));

    // A loser must not smuggle its stage in through the back door: this event
    // is older, so every column of the group keeps the current verdict.
    await PostAsync(user, [Ev(NewEventId(), "card-x", 2, Base + 500, Base + 500 + OneDayMs, stage: 6, schedulerVersion: "v0")]);
    var afterStale = (await _db.QueryAsync(
      "select srs_stage, last_scheduler_version, last_rating, review_count from user_progress where user_sub = $1", user)).Single();
    Assert.Null(afterStale["srs_stage"]);
    Assert.Null(afterStale["last_scheduler_version"]);
    Assert.Equal(1, AsInt(afterStale["last_rating"]));
    // Losing the verdict is not the same as being ignored: the review happened.
    Assert.Equal(4, AsInt(afterStale["review_count"]));
  }

  [Fact]
  public async Task ProgressGet_EchoesNullStageForRowsWrittenBefore013()
  {
    var user = NewUser("t7-legacy");
    await PostAsync(user, [Ev(NewEventId(), "card-legacy", 3, Base, Base + OneDayMs, stage: 4)]);

    // Exactly the shape of a row merged before 013 existed: everything else
    // present, stage unknown.
    await _db.QueryAsync(
      "update user_progress set srs_stage = null where user_sub = $1 returning 1", user);

    var data = await LambdaHost.GetProgressAsync(user, new Dictionary<string, string> { ["deckSlug"] = Deck });
    var item = data.GetProperty("items").EnumerateArray().Single();
    Assert.Equal("card-legacy", item.GetProperty("stableUid").GetString());

    // Present and null, not absent and not 0. Zero is a real rung, so sending
    // it would be a lie the client cannot detect.
    Assert.Equal(JsonValueKind.Null, item.GetProperty("srsStage").ValueKind);
  }
}
