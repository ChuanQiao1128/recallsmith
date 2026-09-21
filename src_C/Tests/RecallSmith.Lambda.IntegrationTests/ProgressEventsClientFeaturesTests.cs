using System.Globalization;
using System.Text.Json;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The two batch-level envelope markers land in the analytics_event_outbox
/// payload: clientFeatures becomes a jsonb array under client_features and
/// updateId becomes update_id. Both are stripped by jsonb_strip_nulls when the
/// client omits them or sends JSON null, and both are normalised on the server
/// (features: string-only, token grammar, sorted, distinct, capped at 16;
/// updateId: trimmed, non-blank, ≤ 64 chars) so a payload never carries a value
/// the analytics keys off of that the client did not really send.
///
/// Asserted through the outbox row, like ProgressEventsCardFormatTests: F5 plus
/// OneIngest_WithClientFeaturesAndUpdateId_IsStillOneStatement already own the
/// one-statement claim, so a log probe here would only add container time.
/// </summary>
[Collection(PostgresCollection.Name)]
public class ProgressEventsClientFeaturesTests
{
  private readonly PostgresFixture _db;

  private const string Deck = "csharp-basics";
  private const long OneDayMs = 24L * 60 * 60 * 1000;

  private static readonly long Base = DateTimeOffset.UtcNow.AddDays(-10).ToUnixTimeMilliseconds();

  public ProgressEventsClientFeaturesTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- helpers

  private int _n;

  private static string NewUser(string tag) => $"it-caps-{tag}-{Guid.NewGuid():N}";

  private static string NewEventId() => Guid.NewGuid().ToString("D").ToLowerInvariant();

  private static string NewUid() => $"uid-{Guid.NewGuid():N}";

  private static object Ev(string eventId, string stableUid, int rating, long eventTimeMs) => new
  {
    eventId,
    deckSlug = Deck,
    stableUid,
    rating,
    eventTimeMs,
    nextReviewAtMs = eventTimeMs + OneDayMs,
    sessionId = "sess-caps",
    progressAfter = new { stage = 2 },
  };

  // A dictionary so that an explicit JSON null (a different input from absent)
  // can be expressed for either marker via `extra`.
  private static Dictionary<string, object?> Body(
    IEnumerable<object> events,
    IDictionary<string, object?>? extra = null)
  {
    var body = new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["events"] = events.ToList(),
      ["deviceId"] = "device-under-test",
      ["clientVersion"] = "1.2.3",
      ["clientPlatform"] = "ios",
    };
    if (extra is not null)
      foreach (var kv in extra) body[kv.Key] = kv.Value;
    return body;
  }

  private async Task<JsonElement> PayloadAsync(string eventId)
  {
    var raw = await _db.ScalarAsync(
      "select payload::text from analytics_event_outbox where event_id = $1::uuid",
      eventId);
    Assert.NotNull(raw);
    using var doc = JsonDocument.Parse((string)raw!);
    return doc.RootElement.Clone();
  }

  private async Task<string> PostOneAsync(string user, string eventId, IDictionary<string, object?>? extra)
  {
    var data = await LambdaHost.PostProgressEventsAsync(
      user, Body([Ev(eventId, NewUid(), 4, Base + _n++)], extra));
    Assert.Equal(1, data.GetProperty("acceptedCount").GetInt32());
    return eventId;
  }

  // ------------------------------------------------------------------ facts

  [Fact]
  public async Task Payload_CarriesClientFeaturesAndUpdateId_WhenSent()
  {
    const string updateId = "0b6c3f52-1c3f-4a3b-9c8e-7f0d2a1b4c5d";
    var user = NewUser("carries");
    var eventId = NewEventId();

    await PostOneAsync(user, eventId, new Dictionary<string, object?>
    {
      ["clientFeatures"] = new[] { "mcq" },
      ["updateId"] = updateId,
    });

    var payload = await PayloadAsync(eventId);

    var features = payload.GetProperty("client_features");
    Assert.Equal(JsonValueKind.Array, features.ValueKind);
    Assert.Equal(1, features.GetArrayLength());
    Assert.Equal("mcq", features[0].GetString());

    Assert.Equal(updateId, payload.GetProperty("update_id").GetString());

    // The old keys are intact next to the new ones.
    Assert.Equal("1.2.3", payload.GetProperty("app_version").GetString());
    Assert.Equal(eventId, payload.GetProperty("event_id").GetString());
  }

  [Fact]
  public async Task Payload_HasNeitherKey_WhenAbsent()
  {
    var user = NewUser("absent");
    var eventId = NewEventId();

    await PostOneAsync(user, eventId, extra: null);

    var payload = await PayloadAsync(eventId);
    Assert.False(payload.TryGetProperty("client_features", out _));
    Assert.False(payload.TryGetProperty("update_id", out _));
  }

  [Fact]
  public async Task Payload_HasNeitherKey_WhenSentAsNull()
  {
    var user = NewUser("null");
    var eventId = NewEventId();

    await PostOneAsync(user, eventId, new Dictionary<string, object?>
    {
      ["clientFeatures"] = null,
      ["updateId"] = null,
    });

    var payload = await PayloadAsync(eventId);
    Assert.False(payload.TryGetProperty("client_features", out _));
    Assert.False(payload.TryGetProperty("update_id", out _));
  }

  [Fact]
  public async Task ClientFeatures_AreNormalized_BeforeTheyReachThePayload()
  {
    var user = NewUser("normalize");
    var eventId = NewEventId();

    var mixed = new object[] { "MCQ", " mcq ", "mcq", 42, "", "x y", "Alpha_1", "9start", "-dash" };
    await PostOneAsync(user, eventId, new Dictionary<string, object?> { ["clientFeatures"] = mixed });

    var payload = await PayloadAsync(eventId);
    var features = payload.GetProperty("client_features");
    Assert.Equal(JsonValueKind.Array, features.ValueKind);
    Assert.Equal(
      new[] { "alpha_1", "mcq" },
      features.EnumerateArray().Select(x => x.GetString()).ToArray());

    // A bare string is not an array, so the whole marker is dropped.
    var stringUser = NewUser("normalize-string");
    var stringEventId = NewEventId();
    await PostOneAsync(stringUser, stringEventId, new Dictionary<string, object?> { ["clientFeatures"] = "mcq" });
    Assert.False((await PayloadAsync(stringEventId)).TryGetProperty("client_features", out _));
  }

  [Fact]
  public async Task ClientFeatures_AreCappedAtSixteen()
  {
    var user = NewUser("cap");
    var eventId = NewEventId();

    var reversed = Enumerable.Range(0, 20).Reverse().Select(i => $"f{i:00}").ToArray();
    await PostOneAsync(user, eventId, new Dictionary<string, object?> { ["clientFeatures"] = reversed });

    var payload = await PayloadAsync(eventId);
    var features = payload.GetProperty("client_features");
    Assert.Equal(
      Enumerable.Range(0, 16).Select(i => $"f{i:00}").ToArray(),
      features.EnumerateArray().Select(x => x.GetString()).ToArray());
  }

  [Fact]
  public async Task UpdateId_IsTrimmed_AndDroppedWhenBlankOrTooLong()
  {
    var trimmedId = NewEventId();
    await PostOneAsync(NewUser("trim"), trimmedId, new Dictionary<string, object?> { ["updateId"] = "  abc  " });
    Assert.Equal("abc", (await PayloadAsync(trimmedId)).GetProperty("update_id").GetString());

    var blankId = NewEventId();
    await PostOneAsync(NewUser("blank"), blankId, new Dictionary<string, object?> { ["updateId"] = "   " });
    Assert.False((await PayloadAsync(blankId)).TryGetProperty("update_id", out _));

    var tooLongId = NewEventId();
    await PostOneAsync(NewUser("toolong"), tooLongId, new Dictionary<string, object?> { ["updateId"] = new string('a', 65) });
    Assert.False((await PayloadAsync(tooLongId)).TryGetProperty("update_id", out _));

    var maxLenId = NewEventId();
    await PostOneAsync(NewUser("maxlen"), maxLenId, new Dictionary<string, object?> { ["updateId"] = new string('a', 64) });
    Assert.Equal(new string('a', 64), (await PayloadAsync(maxLenId)).GetProperty("update_id").GetString());
  }
}
