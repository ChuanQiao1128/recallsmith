using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Runtime;

namespace RecallSmith.Lambda.IntegrationTests;

[Collection(PostgresCollection.Name)]
public class ProgressSchedulerStateTests
{
  private readonly PostgresFixture _db;
  private static readonly long T = DateTimeOffset.UtcNow.AddDays(-2).ToUnixTimeMilliseconds();
  public ProgressSchedulerStateTests(PostgresFixture db) => _db = db;
  private static object State(long time, int lapses = 1) => new {
    stage = 0, lapses, hardStreak = 0, fsrsStability = 0.39150242161493015,
    fsrsDifficulty = 6.607035107311108, fsrsAnchorAt = time, fsrsReviewedAt = time,
    privateExtra = "MUST_NOT_PERSIST"
  };
  private static object Ev(long time, object? state, string uid = "one", string? id = null) => new {
    eventId = id ?? Guid.NewGuid().ToString(), deckSlug = "qa-scheduler", stableUid = uid,
    rating = 1, eventTimeMs = time, nextReviewAtMs = time + 600_000,
    progressAfter = state, schedulerVersion = "fsrs-5"
  };
  private static Task<JsonElement> Push(string user, params object[] events) =>
    LambdaHost.PostProgressEventsAsync(user, new { events });
  private static async Task<JsonElement> Get(string user, string uid = "one") {
    var data = await LambdaHost.GetProgressAsync(user);
    return data.GetProperty("items").EnumerateArray().Single(x => x.GetProperty("stableUid").GetString() == uid);
  }

  [Fact]
  public async Task PushPull_RestoresExactMemoryState_AndWhitelist() {
    var user = $"it-fsrs-{Guid.NewGuid():N}";
    await Push(user, Ev(T, State(T)));
    var row = await Get(user);
    var state = row.GetProperty("schedulerState");
    Assert.Equal(JsonValueKind.Object, state.ValueKind);
    Assert.Equal(6, state.EnumerateObject().Count());
    Assert.Equal(1, state.GetProperty("lapses").GetInt32());
    Assert.Equal(0.39150242161493015, state.GetProperty("fsrsStability").GetDouble());
    Assert.Equal(T, state.GetProperty("fsrsAnchorAt").GetInt64());
    Assert.Equal(T, state.GetProperty("fsrsReviewedAt").GetInt64());
    Assert.False(state.TryGetProperty("privateExtra", out _));
  }

  [Fact]
  public async Task DuplicateAndStaleEvents_CannotReplaceTheWinningModel() {
    var user = $"it-fsrs-{Guid.NewGuid():N}";
    var id = Guid.NewGuid().ToString();
    var winner = Ev(T + 1000, State(T + 1000, 3), id: id);
    await Push(user, winner);
    await Push(user, winner);
    await Push(user, Ev(T, State(T)));
    var row = await Get(user);
    Assert.Equal(2, row.GetProperty("reviewCount").GetInt32());
    Assert.Equal(3, row.GetProperty("schedulerState").GetProperty("lapses").GetInt32());
    Assert.Equal(T + 1000, row.GetProperty("schedulerState").GetProperty("fsrsAnchorAt").GetInt64());
  }

  [Fact]
  public async Task NewLegacyReview_ClearsPreviousModel_AndOtherAccountHasNoRows() {
    var user = $"it-fsrs-{Guid.NewGuid():N}";
    await Push(user, Ev(T, State(T)));
    await Push(user, Ev(T + 1000, null));
    Assert.Equal(JsonValueKind.Null, (await Get(user)).GetProperty("schedulerState").ValueKind);
    var other = await LambdaHost.GetProgressAsync($"it-fsrs-{Guid.NewGuid():N}");
    Assert.Empty(other.GetProperty("items").EnumerateArray());
  }

  [Fact]
  public async Task InvalidModel_IsDropped_CountersCanStillRoundTrip() {
    var user = $"it-fsrs-{Guid.NewGuid():N}";
    await Push(user, Ev(T, new { stage = 0, lapses = 2, hardStreak = -1,
      fsrsStability = -5, fsrsDifficulty = 99, fsrsAnchorAt = T, fsrsReviewedAt = T }));
    var state = (await Get(user)).GetProperty("schedulerState");
    Assert.Single(state.EnumerateObject());
    Assert.Equal(2, state.GetProperty("lapses").GetInt32());
  }

  [Fact]
  public async Task SameBatchDuplicateId_AndTiedReviews_KeepOneCoherentState() {
    var user = $"it-fsrs-{Guid.NewGuid():N}";
    var small = "00000000-0000-4000-8000-000000000001";
    var large = "00000000-0000-4000-8000-000000000002";
    // IDs are globally unique in the event table; mint the shared prefix per test.
    var prefix = Guid.NewGuid().ToString()[..24];
    small = prefix + small[24..]; large = prefix + large[24..];
    await Push(user, Ev(T, State(T, 3), id: large), Ev(T, State(T), id: small), Ev(T, State(T, 8), id: large));
    var row = await Get(user);
    Assert.Equal(2, row.GetProperty("reviewCount").GetInt32());
    Assert.Equal(3, row.GetProperty("schedulerState").GetProperty("lapses").GetInt32());
  }

  [Fact]
  public async Task Migration_IsIdempotent_AndDoesNotInventOldState() {
    var user = $"it-fsrs-{Guid.NewGuid():N}";
    await Push(user, Ev(T, null));
    var sql = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Db", "Migrations", "048_progress_scheduler_state.sql"));
    await _db.ScalarAsync(sql);
    await _db.ScalarAsync(sql);
    Assert.Equal(JsonValueKind.Null, (await Get(user)).GetProperty("schedulerState").ValueKind);
  }

  [Fact]
  public async Task RollingDeployment_WithoutColumn_ServesLegacyAndDefersModelUntilMigration() {
    // All DDL stays in a scratch database inside the disposable test container.
    // Never remove the column from the fixture database shared by other tests.
    var database = $"scheduler_rollout_{Guid.NewGuid():N}";
    var connectionString = await _db.CreateScratchDatabaseAsync(database);
    await using var conn = new NpgsqlConnection(connectionString);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, int.MaxValue);
    await DbUtil.ExecuteAsync(conn, null, "alter table user_progress drop column scheduler_state", []);

    var previousDatabase = Environment.GetEnvironmentVariable("PGDATABASE");
    try {
      Environment.SetEnvironmentVariable("PGDATABASE", database);
      Pg.Reset();
      ProgressSchedulerSchema.ResetReadyCache();

      var legacyUser = $"it-rollout-legacy-{Guid.NewGuid():N}";
      var legacy = Ev(T, new { stage = 2 });
      Assert.Equal(1, (await Push(legacyUser, legacy)).GetProperty("acceptedCount").GetInt32());
      Assert.Equal(JsonValueKind.Null, (await Get(legacyUser)).GetProperty("schedulerState").ValueKind);

      var user = $"it-rollout-model-{Guid.NewGuid():N}";
      var modelId = Guid.NewGuid().ToString();
      var legacyId = Guid.NewGuid().ToString();
      var model = Ev(T, State(T, 3), "model", modelId);
      var stageOnly = Ev(T, new { stage = 2 }, "legacy", legacyId);
      var response = await PushResponse(user, new { events = new[] { stageOnly, model } });
      Assert.Equal(503, response.StatusCode);
      using (var body = JsonDocument.Parse(response.Body)) {
        Assert.Equal("SCHEDULER_STATE_NOT_READY", body.RootElement.GetProperty("error").GetProperty("code").GetString());
        // A retryable failure must not acknowledge either half of a mixed batch.
        Assert.False(body.RootElement.TryGetProperty("acceptedEventIds", out _));
      }
      Assert.Equal(0L, await DbUtil.ExecuteScalarAsync(conn, null,
        "select count(*) from user_progress_events where user_sub = $1", [user]));
      Assert.Equal(0L, await DbUtil.ExecuteScalarAsync(conn, null,
        "select count(*) from users where user_sub = $1", [user]));

      var migration = await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Db", "Migrations", "048_progress_scheduler_state.sql"));
      await DbUtil.ExecuteAsync(conn, null, migration, []);
      await DbUtil.ExecuteAsync(conn, null, migration, []);

      // Do not reset readiness: a previously false result must notice the new
      // column immediately in the same warm process. Reuse the exact event IDs.
      Assert.Equal(2, (await Push(user, stageOnly, model)).GetProperty("acceptedCount").GetInt32());
      Assert.Equal(3, (await Get(user, "model")).GetProperty("schedulerState").GetProperty("lapses").GetInt32());
      Assert.Equal(JsonValueKind.Null, (await Get(user, "legacy")).GetProperty("schedulerState").ValueKind);
      Assert.Equal(0, (await Push(user, stageOnly, model)).GetProperty("acceptedCount").GetInt32());
      Assert.Equal(1, (await Get(user, "model")).GetProperty("reviewCount").GetInt32());
    } finally {
      Environment.SetEnvironmentVariable("PGDATABASE", previousDatabase);
      Pg.Reset();
      ProgressSchedulerSchema.ResetReadyCache();
    }
  }

  private static Task<APIGatewayProxyResponse> PushResponse(string user, object body) {
    var evt = JsonSerializer.SerializeToElement(new {
      rawPath = "/api/progress/events",
      requestContext = new { requestId = Guid.NewGuid().ToString(), http = new { method = "POST" } },
      headers = new Dictionary<string, string>(), body = JsonSerializer.Serialize(body), isBase64Encoded = false
    });
    var req = new LambdaRequest(evt);
    var auth = new AuthContext(new Dictionary<string, JsonElement>(), user, user, [], false, false, false);
    return ProgressEvents.HandleProgressEvents(req, new Res(req.TraceId), auth);
  }
}
