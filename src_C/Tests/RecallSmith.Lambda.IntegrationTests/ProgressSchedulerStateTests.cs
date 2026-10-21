using System.Text.Json;

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
}
