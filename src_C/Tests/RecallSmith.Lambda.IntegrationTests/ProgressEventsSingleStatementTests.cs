using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The ingest after the transaction shell was folded away (issue #5).
///
/// ProgressEventsIntegrationTests already pins what the merge decides. What is
/// unproven by any of it is the thing that changed: the users upsert stopped
/// being a statement of its own inside BEGIN/COMMIT and became a CTE of the one
/// statement. Three claims follow from that and none of them is visible from
/// the merge results --
///
///   1. the parent row still exists by the time the foreign key is checked,
///      even though CTE execution order is undefined and this CTE is not
///      referenced by the main query;
///   2. two containers racing on one brand-new user_sub still neither deadlock
///      nor lose a write, now that the row lock is held for one statement
///      rather than for a whole transaction;
///   3. it really is one statement, with no shell around it. That last one is
///      the entire point of the change and the only witness for it is Postgres
///      itself, so this file asks Postgres.
/// </summary>
[Collection(PostgresCollection.Name)]
public class ProgressEventsSingleStatementTests
{
  private readonly PostgresFixture _db;

  private const string Deck = "csharp-basics";
  private const long OneDayMs = 24L * 60 * 60 * 1000;

  private static readonly long Base = DateTimeOffset.UtcNow.AddDays(-10).ToUnixTimeMilliseconds();

  public ProgressEventsSingleStatementTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- helpers

  private static string NewUser(string tag) => $"it-fold-{tag}-{Guid.NewGuid():N}";

  private static string NewEventId() => Guid.NewGuid().ToString("D").ToLowerInvariant();

  private static object Ev(string eventId, string stableUid, int rating, long eventTimeMs) => new
  {
    eventId,
    deckSlug = Deck,
    stableUid,
    rating,
    eventTimeMs,
    nextReviewAtMs = eventTimeMs + OneDayMs,
    sessionId = "sess-fold",
    progressAfter = new { stage = 2 },
  };

  /// <summary>
  /// A dictionary rather than an anonymous type because absent and null are
  /// different inputs here and only a dictionary can express "absent". The
  /// handler reads these with TryGetProperty, so an explicit JSON null arrives
  /// as the empty string, not as null, and would never reach the coalesce arm
  /// the users merge is built around.
  /// </summary>
  private static object Batch(
    IEnumerable<object> events,
    string? deviceId = "device-under-test",
    string? clientVersion = "1.2.3",
    string? clientPlatform = "ios")
  {
    var body = new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["events"] = events.ToList(),
    };

    if (deviceId is not null) body["deviceId"] = deviceId;
    if (clientVersion is not null) body["clientVersion"] = clientVersion;
    if (clientPlatform is not null) body["clientPlatform"] = clientPlatform;

    return body;
  }

  private static Task<JsonElement> PostAsync(string userSub, IEnumerable<object> events) =>
    LambdaHost.PostProgressEventsAsync(userSub, Batch(events));

  private static int AsInt(object? v) => Convert.ToInt32(v, CultureInfo.InvariantCulture);

  private async Task<int> CountAsync(string sql, string userSub) =>
    AsInt(await _db.ScalarAsync(sql, userSub));

  // ------------------------------------------------------------------ F1

  /// <summary>
  /// user_progress_events.user_sub is `references users(user_sub)`, and the row
  /// that satisfies it is now written by a sibling CTE of the same statement --
  /// one that the main query never reads, in a list whose execution order the
  /// planner is free to choose. This is the test that says the foreign key is
  /// checked late enough for that to be fine.
  /// </summary>
  [Fact]
  public async Task BrandNewUser_IsCreated_InsideTheOneStatement()
  {
    var user = NewUser("f1");

    // Nothing has ever written this user_sub: no prior request, no bootstrap.
    Assert.Equal(0, await CountAsync("select count(*) from users where user_sub = $1", user));

    var data = await PostAsync(user, [Ev(NewEventId(), "card-a", 3, Base), Ev(NewEventId(), "card-b", 4, Base + 1)]);
    Assert.Equal(2, data.GetProperty("acceptedCount").GetInt32());

    var row = (await _db.QueryAsync(
      "select email, last_platform, last_version, last_device_id, is_disabled from users where user_sub = $1",
      user)).Single();

    Assert.Null(row["email"]);
    Assert.Equal("ios", row["last_platform"]);
    Assert.Equal("1.2.3", row["last_version"]);
    Assert.Equal("device-under-test", row["last_device_id"]);
    Assert.Equal(0, AsInt(row["is_disabled"]));

    Assert.Equal(2, await CountAsync("select count(*) from user_progress_events where user_sub = $1", user));
    Assert.Equal(2, await CountAsync("select count(*) from user_progress where user_sub = $1", user));
  }

  // ------------------------------------------------------------------ F2

  /// <summary>
  /// The users write must stay unconditional. It is tempting to source it from
  /// the inserted events -- `insert into users ... select from ins` -- and that
  /// would be wrong in a way no other test here would catch: a batch every one
  /// of whose events is already known produces no `ins` rows, and a brand-new
  /// device replaying its outbox would then never get a users row at all.
  ///
  /// It is also the last_seen_at signal. A user whose whole batch is duplicates
  /// was still active, and the console's "last seen" column has to say so.
  /// </summary>
  [Fact]
  public async Task UsersRow_IsWritten_EvenWhenEveryEventIsADuplicate()
  {
    var owner = NewUser("f2-owner");
    var newcomer = NewUser("f2-newcomer");

    // event_id is a bare uuid primary key, so idempotency is global: whoever
    // gets there first owns the id and the second sender loses the whole batch.
    var ids = new[] { NewEventId(), NewEventId() };
    var events = ids.Select((id, i) => Ev(id, $"card-{i}", 3, Base + i)).ToList();

    Assert.Equal(2, (await PostAsync(owner, events)).GetProperty("acceptedCount").GetInt32());

    var before = DateTimeOffset.UtcNow;
    var data = await PostAsync(newcomer, events);
    Assert.Equal(0, data.GetProperty("acceptedCount").GetInt32());
    Assert.Equal(2, data.GetProperty("duplicateEventIds").GetArrayLength());

    var row = (await _db.QueryAsync(
      "select last_platform, last_seen_at from users where user_sub = $1", newcomer)).Single();
    Assert.Equal("ios", row["last_platform"]);
    Assert.True(
      (DateTime)row["last_seen_at"]! >= before.UtcDateTime.AddSeconds(-5),
      "last_seen_at must be stamped by the duplicate-only batch");

    // And nothing else: the events belong to the owner, so the newcomer gets a
    // users row and no progress.
    Assert.Equal(0, await CountAsync("select count(*) from user_progress where user_sub = $1", newcomer));
    Assert.Equal(0, await CountAsync("select count(*) from user_progress_events where user_sub = $1", newcomer));
  }

  // ------------------------------------------------------------------ F3

  /// <summary>
  /// The ON CONFLICT DO UPDATE body moved verbatim into the CTE, and every arm
  /// of it is a coalesce for a reason: a client that omits its device metadata
  /// (an older build, a web session) must not erase what a real device already
  /// reported. Rewriting any arm as a plain `excluded.x` reads like a
  /// simplification and is a data loss.
  /// </summary>
  [Fact]
  public async Task UsersMerge_KeepsItsCoalesceArms_AfterTheFold()
  {
    var user = NewUser("f3");

    await LambdaHost.PostProgressEventsAsync(user, Batch(
      [Ev(NewEventId(), "card-a", 3, Base)],
      deviceId: "device-A", clientVersion: "1.0.0", clientPlatform: "ios"));

    var afterFirst = (await _db.QueryAsync(
      "select last_platform, last_version, last_device_id, last_seen_at from users where user_sub = $1",
      user)).Single();
    Assert.Equal("ios", afterFirst["last_platform"]);
    Assert.Equal("1.0.0", afterFirst["last_version"]);
    Assert.Equal("device-A", afterFirst["last_device_id"]);
    var firstSeen = (DateTime)afterFirst["last_seen_at"]!;

    // A client that reports nothing about itself. The review still counts; the
    // device metadata must survive untouched.
    await LambdaHost.PostProgressEventsAsync(user, Batch(
      [Ev(NewEventId(), "card-a", 4, Base + 1000)],
      deviceId: null, clientVersion: null, clientPlatform: null));

    var afterBlank = (await _db.QueryAsync(
      "select last_platform, last_version, last_device_id, last_seen_at from users where user_sub = $1",
      user)).Single();
    Assert.Equal("ios", afterBlank["last_platform"]);
    Assert.Equal("1.0.0", afterBlank["last_version"]);
    Assert.Equal("device-A", afterBlank["last_device_id"]);
    // last_seen_at is `now()`, not a coalesce: it advances on every batch.
    Assert.True((DateTime)afterBlank["last_seen_at"]! >= firstSeen, "last_seen_at must not go backwards");

    // A real second device does overwrite.
    await LambdaHost.PostProgressEventsAsync(user, Batch(
      [Ev(NewEventId(), "card-a", 2, Base + 2000)],
      deviceId: "device-B", clientVersion: "2.0.0", clientPlatform: "android"));

    var afterSecond = (await _db.QueryAsync(
      "select last_platform, last_version, last_device_id from users where user_sub = $1", user)).Single();
    Assert.Equal("android", afterSecond["last_platform"]);
    Assert.Equal("2.0.0", afterSecond["last_version"]);
    Assert.Equal("device-B", afterSecond["last_device_id"]);

    Assert.Equal(1, await CountAsync("select count(*) from users where user_sub = $1", user));
    Assert.Equal(3, await CountAsync("select count(*) from user_progress_events where user_sub = $1", user));
  }

  // ------------------------------------------------------------------ F4

  private const int RaceRounds = 10;
  private const int RaceParallel = 4;
  private const int RaceEventsPerBatch = 3;

  /// <summary>
  /// The acceptance case: several containers, one user_sub that has never been
  /// seen, all arriving at once.
  ///
  /// Under the old shape the users row lock was taken by its own statement and
  /// then held until COMMIT, so the losers of the insert race waited out the
  /// winner's entire transaction. Folded in, the same lock is taken and dropped
  /// inside one statement -- a strictly shorter hold, but a different one, and
  /// "different" is what has to be proved harmless. Every batch here targets
  /// the SAME card as well as the same user, so the contenders queue on the
  /// user_progress row too and both locks are exercised, not just the first.
  ///
  /// Ten fresh users rather than one: a single round can come out right by
  /// arriving in a lucky order.
  /// </summary>
  [Fact]
  public async Task ConcurrentBatches_ForOneBrandNewUser_NeitherDeadlockNorLoseAWrite()
  {
    for (var round = 0; round < RaceRounds; round++)
    {
      var user = NewUser($"f4-r{round}");

      // Distinct event times across the whole round, ascending with the batch
      // index, so the last-writer-wins verdict has one right answer no matter
      // what order the batches actually land in.
      var batches = new List<List<object>>();
      for (var b = 0; b < RaceParallel; b++)
      {
        var events = new List<object>();
        for (var e = 0; e < RaceEventsPerBatch; e++)
        {
          events.Add(Ev(NewEventId(), "card-contended", (b % 4) + 1, Base + (b * 1000L) + e));
        }

        batches.Add(events);
      }

      // Task.Run alone would let the first batch finish before the last one is
      // scheduled on a busy pool; the gate makes them all start from the same
      // instant, which is the only version of this test worth running.
      var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
      var posts = batches
        .Select(events => Task.Run(async () =>
        {
          await gate.Task;
          return await PostAsync(user, events);
        }))
        .ToArray();

      gate.SetResult();
      var results = await Task.WhenAll(posts);

      // A deadlock surfaces as a 500 and LambdaHost asserts on the status code,
      // so reaching this line already means neither side was aborted. What is
      // left to check is that nobody's work was dropped.
      foreach (var data in results)
      {
        Assert.Equal(RaceEventsPerBatch, data.GetProperty("acceptedCount").GetInt32());
        Assert.Equal(0, data.GetProperty("duplicateEventIds").GetArrayLength());
      }

      const int Total = RaceParallel * RaceEventsPerBatch;

      Assert.Equal(1, await CountAsync("select count(*) from users where user_sub = $1", user));
      Assert.Equal(Total, await CountAsync("select count(*) from user_progress_events where user_sub = $1", user));

      var progress = (await _db.QueryAsync(
        """
        select
          review_count, last_rating,
          (extract(epoch from last_reviewed_at) * 1000)::bigint as reviewed_ms
        from user_progress
        where user_sub = $1
        """,
        user)).Single();

      // The increment is `user_progress.review_count + excluded.review_count`,
      // so a lost update shows up here as a count below Total. This is the
      // "must not lose either write" half of the acceptance criterion.
      Assert.Equal(Total, AsInt(progress["review_count"]));

      // And the merge still settles on the globally latest event, whichever
      // batch happened to commit last.
      var latestMs = Base + ((RaceParallel - 1) * 1000L) + (RaceEventsPerBatch - 1);
      Assert.Equal(latestMs, Convert.ToInt64(progress["reviewed_ms"], CultureInfo.InvariantCulture));
      Assert.Equal(((RaceParallel - 1) % 4) + 1, AsInt(progress["last_rating"]));

      var outbox = await CountAsync(
        """
        select count(*)
        from analytics_event_outbox o
        join user_progress_events e on e.event_id = o.event_id
        where e.user_sub = $1
        """,
        user);
      Assert.Equal(Total, outbox);
    }
  }

  // ------------------------------------------------------------------ F5

  // Singleline because a logged statement is not a logged line: Postgres emits
  // the first line with the usual prefix and every continuation line indented
  // with a tab, so an entry has to be reassembled before it can be matched. A
  // per-line regex would see `with ensure_user as (` and nothing else.
  private static readonly Regex LogLine = new(
    @"^\S+ \S+ \S+ \[(?<pid>\d+)\] LOG:\s+(?<verb>statement|execute|parse|bind)(?: (?<name>[^:]*))?: (?<sql>.*)$",
    RegexOptions.Compiled | RegexOptions.Singleline);

  private sealed record LoggedStatement(string Pid, string Verb, string Name, string Sql);

  private async Task WarmAsync(string user, int count)
  {
    for (var i = 0; i < count; i++)
    {
      await PostAsync(user, [Ev(NewEventId(), "card-warm", 3, Base + i)]);
    }
  }

  /// <summary>
  /// Npgsql prepends its connection reset to the front of the next command's
  /// protocol batch rather than sending it on its own, so the reset costs no
  /// round trip even though the server logs it as a statement.
  ///
  /// Two spellings, and which one appears is itself a signal: plain DISCARD ALL
  /// when auto-prepare is off, and the longer form when it is on, because
  /// DISCARD ALL would deallocate the prepared statements Npgsql is trying to
  /// keep. Both are matched by their opening words rather than loosely, so that
  /// nothing which costs a round trip can be swept up with them.
  /// </summary>
  private static bool IsConnectionReset(LoggedStatement s) =>
    s.Sql.StartsWith("DISCARD ALL", StringComparison.OrdinalIgnoreCase) ||
    s.Sql.StartsWith("SET SESSION AUTHORIZATION DEFAULT", StringComparison.OrdinalIgnoreCase);

  /// <summary>
  /// Runs <paramref name="body"/> with statement logging on, and returns
  /// everything the ingest's own backend logged while it ran.
  ///
  /// log_statement is turned on with ALTER SYSTEM + pg_reload_conf() rather than
  /// ALTER DATABASE on purpose. ALTER DATABASE only reaches sessions opened
  /// afterwards, which would force a Pg.Reset() and hand the handler a cold
  /// connection -- and a cold Npgsql connection loads its type catalogue first,
  /// which is chatter these tests would then have to explain away. A reload
  /// reaches the pooled connection the handler is already holding.
  /// </summary>
  private async Task<List<LoggedStatement>> ProbeIngestAsync(Func<Task> body)
  {
    var since = DateTime.UtcNow.AddMinutes(-2);
    var marker = $"fold-probe-{Guid.NewGuid():N}";

    await _db.ScalarAsync("alter system set log_statement = 'all'");
    await _db.ScalarAsync("select pg_reload_conf()");
    try
    {
      // ALTER SYSTEM writes postgresql.auto.conf and pg_reload_conf() only
      // signals the postmaster, so a backend that starts in the gap can still
      // come up with logging off -- and the fixture opens a fresh backend per
      // query. Re-issuing the open marker until the log proves it landed is
      // therefore not belt-and-braces: it is the handshake that says logging is
      // live, and without it this probe silently measured nothing at all.
      await EmitUntilLoggedAsync($"{marker}-open", since);
      await body();
      await _db.ScalarAsync($"select '{marker}-close' as m");
    }
    finally
    {
      await _db.ScalarAsync("alter system reset log_statement");
      await _db.ScalarAsync("select pg_reload_conf()");
    }

    var window = await ReadWindowAsync(since, marker);

    // The ingest's backend is the one that ran the event insert; the markers
    // came from the fixture's own connections and carry different pids.
    var ingest = window.FirstOrDefault(l => l.Sql.Contains("user_progress_events", StringComparison.Ordinal));
    Assert.True(ingest is not null, "no ingest statement was logged; window was:\n" + Render(window));

    return window.Where(l => l.Pid == ingest!.Pid).ToList();
  }

  /// <summary>
  /// The claim the whole issue rests on, asked of the server rather than of the
  /// code: how many statements did one ingest actually cost?
  ///
  /// Nothing else in this suite can see the answer. The handler could reopen a
  /// transaction, or split the statement in two, and every state assertion
  /// anywhere in the project would still pass -- which is exactly how the shell
  /// this issue removes survived for as long as it did.
  /// </summary>
  [Fact]
  public async Task OneIngest_CostsOneStatement_AndNoTransactionShell()
  {
    // Three, only to reach steady state: an existing users row and a pooled
    // connection. This test is deliberately indifferent to whether the
    // statement is prepared, since either way it is one execution.
    var user = NewUser("f5");
    await WarmAsync(user, 3);

    var onIngestBackend = await ProbeIngestAsync(() =>
      PostAsync(user, [Ev(NewEventId(), "card-measured", 4, Base + 5000)]));

    var billable = onIngestBackend.Where(l => !IsConnectionReset(l)).ToList();

    Assert.True(
      billable.Count == 1,
      $"expected exactly one statement per ingest, saw {billable.Count}:\n{Render(onIngestBackend)}");

    var sql = billable[0].Sql;
    Assert.Contains("ensure_user", sql, StringComparison.Ordinal);
    Assert.Contains("into user_progress_events", sql, StringComparison.Ordinal);
    Assert.Contains("into user_progress", sql, StringComparison.Ordinal);
    Assert.Contains("analytics_event_outbox", sql, StringComparison.Ordinal);

    // Named separately from the count so that a returning shell reads as what
    // it is rather than as an off-by-one.
    Assert.DoesNotContain(
      onIngestBackend,
      l => l.Sql.StartsWith("BEGIN", StringComparison.OrdinalIgnoreCase)
        || l.Sql.StartsWith("COMMIT", StringComparison.OrdinalIgnoreCase)
        || l.Sql.StartsWith("ROLLBACK", StringComparison.OrdinalIgnoreCase));
  }

  // ------------------------------------------------------------------ F7

  /// <summary>
  /// The bill that comes with turning MaxAutoPrepare on.
  ///
  /// A prepared statement has its parameter types fixed at Parse time, once,
  /// and every later execution reuses them. This statement's parameters are not
  /// type-stable across calls: rating, srs_stage, next_review_at and
  /// scheduler_version are all nullable, and the handler binds them through
  /// AddWithValue, which infers int4/text for a value and leaves the type
  /// unspecified for a null. Prepare on a batch that carries them and then send
  /// a batch that does not -- or the reverse -- and the second execution is
  /// binding against types chosen by the first.
  ///
  /// It holds because every placeholder here takes its type from context that
  /// does not vary (an INSERT column list, or an explicit ::uuid / ::smallint),
  /// so the server resolves the same types either way. That is a claim about
  /// Npgsql and Postgres rather than about this repository's code, which is
  /// exactly why it is pinned by a test instead of by a comment: an Npgsql
  /// upgrade could change it and nothing else here would notice.
  /// </summary>
  [Fact]
  public async Task PreparedStatement_BindsNullAndNonNullParametersAlike()
  {
    var pgMax = Environment.GetEnvironmentVariable("PG_MAX");
    Environment.SetEnvironmentVariable("PG_MAX", "1");
    Pg.Reset();

    try
    {
      var user = NewUser("f7");

      // Past AutoPrepareMinUsages on a single connector, with every nullable
      // field populated: the statement is now prepared with concrete types.
      await WarmAsync(user, 8);

      // The same prepared statement, now asked to carry nulls in all four.
      var nullEventTime = Base + 20_000;
      await PostAsync(user,
      [
        new
        {
          eventId = NewEventId(),
          deckSlug = Deck,
          stableUid = "card-nulls",
          eventTimeMs = nullEventTime,
          sessionId = "sess-fold",
        },
      ]);

      var nulls = (await _db.QueryAsync(
        """
        select
          last_rating, srs_stage, last_scheduler_version, review_count,
          (extract(epoch from due_at) * 1000)::bigint as due_ms
        from user_progress
        where user_sub = $1 and stable_uid = 'card-nulls'
        """,
        user)).Single();

      Assert.Null(nulls["last_rating"]);
      Assert.Null(nulls["srs_stage"]);
      Assert.Null(nulls["last_scheduler_version"]);
      Assert.Equal(1, AsInt(nulls["review_count"]));
      // next_review_at was absent, so due_at falls back to the event time.
      Assert.Equal(nullEventTime, Convert.ToInt64(nulls["due_ms"], CultureInfo.InvariantCulture));

      // And back the other way: a populated batch through the same prepared
      // statement after it has just executed with nulls.
      await PostAsync(user, [Ev(NewEventId(), "card-nulls", 4, nullEventTime + 1000)]);

      var populated = (await _db.QueryAsync(
        """
        select last_rating, srs_stage, review_count,
               (extract(epoch from due_at) * 1000)::bigint as due_ms
        from user_progress
        where user_sub = $1 and stable_uid = 'card-nulls'
        """,
        user)).Single();

      Assert.Equal(4, AsInt(populated["last_rating"]));
      Assert.Equal(2, AsInt(populated["srs_stage"]));
      Assert.Equal(2, AsInt(populated["review_count"]));
      Assert.Equal(
        nullEventTime + 1000 + OneDayMs,
        Convert.ToInt64(populated["due_ms"], CultureInfo.InvariantCulture));
    }
    finally
    {
      Environment.SetEnvironmentVariable("PG_MAX", pgMax);
      Pg.Reset();
    }
  }

  // ------------------------------------------------------------------ F6

  /// <summary>
  /// MaxAutoPrepare is on in Pg.cs because it measured faster -- p50 0.99ms
  /// against 1.72ms for a batch=1 ingest, run off/on/off/on so warm-up and
  /// drift could not be mistaken for the effect. That is a claim about the
  /// server preparing this statement, and the way to see whether it did is how
  /// the server names the execution: an unprepared extended-protocol execution
  /// is `&lt;unnamed&gt;`, an auto-prepared one carries the name Npgsql gave it.
  ///
  /// The second half matters more than the first. Preparing could have been
  /// paid for with an extra round trip, Parse as an exchange of its own, which
  /// would have handed back a good part of what folding the shell just won.
  /// Npgsql pipelines Parse into the same protocol batch; this is where that is
  /// checked rather than believed.
  /// </summary>
  [Fact]
  public async Task HotStatement_IsServerSidePrepared_WithoutBuyingAnExtraRoundTrip()
  {
    // Asked in production's pool shape, not the suite's. Auto-prepare counts
    // usages per CONNECTOR and Npgsql hands idle connectors out FIFO, so with
    // the several connectors the concurrency test leaves behind, a serial
    // caller round-robins over them and none of them reaches the five uses the
    // threshold wants -- measured, after a first attempt at this test warmed
    // eight times and still saw `<unnamed>`. Production has one connector for
    // the life of a container, because a container serves one request at a
    // time, so PG_MAX=1 is the honest shape for the question rather than a
    // convenience.
    var pgMax = Environment.GetEnvironmentVariable("PG_MAX");
    Environment.SetEnvironmentVariable("PG_MAX", "1");
    Pg.Reset();

    try
    {
      var user = NewUser("f6");
      await WarmAsync(user, 8);

      var onIngestBackend = await ProbeIngestAsync(() =>
        PostAsync(user, [Ev(NewEventId(), "card-prepared", 3, Base + 9000)]));

      var billable = onIngestBackend.Where(l => !IsConnectionReset(l)).ToList();

      Assert.True(
        billable.Count == 1,
        $"preparation must not cost a round trip, saw {billable.Count} statements:\n{Render(onIngestBackend)}");

      var executed = billable[0];
      Assert.Equal("execute", executed.Verb);
      Assert.True(
        executed.Name.Length > 0 && executed.Name != "<unnamed>",
        $"the hot statement is not server-side prepared; it ran as '{executed.Name}':\n{Render(onIngestBackend)}");
    }
    finally
    {
      Environment.SetEnvironmentVariable("PG_MAX", pgMax);
      Pg.Reset();
    }
  }

  private async Task EmitUntilLoggedAsync(string text, DateTime sinceUtc)
  {
    var deadline = DateTime.UtcNow.AddSeconds(20);
    while (true)
    {
      await _db.ScalarAsync($"select '{text}' as m");

      // The marker is a fresh guid and the only place it can appear is the log
      // line for the query that just carried it, so its presence is proof the
      // backend logged. Matching on a `statement: ` prefix would not work:
      // Npgsql speaks the extended protocol, so Postgres writes these as
      // `execute <unnamed>: ...`.
      var (stdout, stderr) = await _db.ContainerLogsAsync(sinceUtc);
      if ((stdout + stderr).Contains(text, StringComparison.Ordinal)) return;

      Assert.True(DateTime.UtcNow < deadline, $"statement logging never became active for {text}");
      await Task.Delay(100);
    }
  }

  /// <summary>
  /// Slices the container's stderr to the statements logged between the two
  /// markers. Docker's log stream lags the statement by a few milliseconds, so
  /// the close marker doubles as the signal that the window is complete.
  /// </summary>
  private async Task<List<LoggedStatement>> ReadWindowAsync(DateTime sinceUtc, string marker)
  {
    var deadline = DateTime.UtcNow.AddSeconds(20);
    while (true)
    {
      var (stdout, stderr) = await _db.ContainerLogsAsync(sinceUtc);
      var text = stdout + "\n" + stderr;

      var open = text.IndexOf($"{marker}-open", StringComparison.Ordinal);
      var close = text.IndexOf($"{marker}-close", StringComparison.Ordinal);
      if (open >= 0 && close > open)
      {
        var entries = new List<string>();
        foreach (var raw in text[open..close].Split('\n'))
        {
          var line = raw.TrimEnd('\r');
          if (line.StartsWith('\t') && entries.Count > 0)
          {
            entries[^1] = entries[^1] + "\n" + line.TrimStart('\t');
            continue;
          }

          entries.Add(line);
        }

        return entries
          .Select(entry => LogLine.Match(entry))
          .Where(m => m.Success)
          .Select(m => new LoggedStatement(
            m.Groups["pid"].Value,
            m.Groups["verb"].Value,
            m.Groups["name"].Value,
            m.Groups["sql"].Value.Trim()))
          .ToList();
      }

      Assert.True(DateTime.UtcNow < deadline, "container logs never showed the probe markers");
      await Task.Delay(100);
    }
  }

  private static string Render(IEnumerable<LoggedStatement> statements) =>
    string.Join(
      "\n",
      statements.Select(s =>
      {
        var flat = Regex.Replace(s.Sql, @"\s+", " ").Trim();
        var label = s.Name.Length > 0 ? $"{s.Verb} {s.Name}" : s.Verb;
        return $"  [{s.Pid}] {label}: {(flat.Length > 140 ? flat[..140] + " ..." : flat)}";
      }));
}
