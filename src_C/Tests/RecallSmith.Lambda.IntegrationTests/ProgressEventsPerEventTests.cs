using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The ingest rejects per event, not per batch. The frozen client (progressSync.ts:1537-1540)
/// only drops acceptedEventIds ∪ duplicateEventIds, so a whole-batch 400 wedges its queue
/// forever — one malformed event would block every later review on that device. These tests pin
/// that a bad event is dropped while its siblings store, that every refused valid-UUID id still
/// rides back in duplicateEventIds, and that the structural gates (bad JSON, empty/over-200
/// arrays) still answer 400.
/// </summary>
[Collection(PostgresCollection.Name)]
public class ProgressEventsPerEventTests
{
  private readonly PostgresFixture _db;

  private const int GeneratedCaseCount = 60;

  // Well before now, so nothing trips the future-clock clamp and hides the behaviour under test.
  private static readonly long Base = DateTimeOffset.UtcNow.AddDays(-10).ToUnixTimeMilliseconds();

  public ProgressEventsPerEventTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- helpers

  private static string NewUser(string tag) => $"it-perevent-{tag}-{Guid.NewGuid():N}";

  private static string NewEventId() => Guid.NewGuid().ToString("D").ToLowerInvariant();

  private static Dictionary<string, object?> Valid(string? eventId) => new(StringComparer.Ordinal)
  {
    ["eventId"] = eventId,
    ["deckSlug"] = "e07-deck",
    ["stableUid"] = $"uid-{Guid.NewGuid():N}",
    ["rating"] = 3,
    ["eventTimeMs"] = Base,
  };

  private static Dictionary<string, object?> Batch(
    IEnumerable<object> events,
    string? deviceId = "device",
    string? clientVersion = "1.2.3",
    string? clientPlatform = "ios") => new(StringComparer.Ordinal)
  {
    ["deviceId"] = deviceId,
    ["clientVersion"] = clientVersion,
    ["clientPlatform"] = clientPlatform,
    ["events"] = events.ToList(),
  };

  private static Task<JsonElement> PostAsync(string userSub, IEnumerable<object> events) =>
    LambdaHost.PostProgressEventsAsync(userSub, Batch(events));

  private static async Task<APIGatewayProxyResponse> PostRawAsync(string userSub, object body)
  {
    var evt = JsonSerializer.SerializeToElement(new
    {
      rawPath = "/api/v1/sync/push",
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method = "POST" },
      },
      headers = new Dictionary<string, string>(),
      queryStringParameters = new Dictionary<string, string>(),
      body = body is string s ? s : JsonSerializer.Serialize(body),
      isBase64Encoded = false,
    });

    var req = new LambdaRequest(evt);
    var res = new Res(req.TraceId);
    var auth = new AuthContext(
      Claims: new Dictionary<string, JsonElement>(StringComparer.Ordinal),
      UserSub: userSub,
      Username: userSub,
      Groups: [],
      IsSuperAdmin: false,
      IsEditor: false,
      IsAdmin: false);

    return await RecallSmith.Lambda.Vpc.Runtime.ProgressEvents.HandleProgressEvents(req, res, auth);
  }

  private static HashSet<string> Ids(JsonElement data, string prop) =>
    data.GetProperty(prop).EnumerateArray().Select(e => e.GetString()!).ToHashSet(StringComparer.Ordinal);

  private static string ErrCode(APIGatewayProxyResponse r) =>
    JsonDocument.Parse(r.Body!).RootElement.GetProperty("error").GetProperty("code").GetString()!;

  private static string ErrMsg(APIGatewayProxyResponse r) =>
    JsonDocument.Parse(r.Body!).RootElement.GetProperty("error").GetProperty("message").GetString()!;

  private async Task<int> RowCountAsync(string userSub)
  {
    var n = await _db.ScalarAsync("select count(*) from user_progress_events where user_sub = $1", userSub);
    return Convert.ToInt32(n, CultureInfo.InvariantCulture);
  }

  // ------------------------------------------------------------------ cases

  [Fact]
  public async Task OneBadEventAmongTwentyFive_Is200_AndOthersAreStored()
  {
    var user = NewUser("one-bad");
    var events = new List<object>();
    for (var k = 0; k < 24; k++) events.Add(Valid(NewEventId()));

    var badId = NewEventId();
    var bad = Valid(badId);
    bad["stableUid"] = null;         // missing required field
    events.Add(bad);                 // index 24

    var data = await PostAsync(user, events);

    Assert.Equal(25, data.GetProperty("receivedCount").GetInt32());
    Assert.Equal(24, data.GetProperty("acceptedCount").GetInt32());

    Assert.Contains(badId, Ids(data, "rejectedEventIds"));
    Assert.Contains(badId, Ids(data, "duplicateEventIds"));
    Assert.DoesNotContain(badId, Ids(data, "acceptedEventIds"));

    var rejected = data.GetProperty("rejected");
    Assert.Equal(1, rejected.GetArrayLength());
    Assert.Equal(24, rejected[0].GetProperty("index").GetInt32());
    Assert.Equal(badId, rejected[0].GetProperty("eventId").GetString());
    Assert.Equal("MISSING_FIELD", rejected[0].GetProperty("code").GetString());

    Assert.Equal(24, await RowCountAsync(user));
  }

  [Fact]
  public async Task AllRejected_Is200_WithZeroRows()
  {
    var user = NewUser("all-rejected");
    var thirdId = NewEventId();
    var third = Valid(thirdId);
    third["deckSlug"] = new string('x', 129);

    var events = new List<object> { 42, Valid("nope"), third };
    var data = await PostAsync(user, events);

    Assert.Equal(0, data.GetProperty("acceptedCount").GetInt32());
    Assert.Empty(Ids(data, "acceptedEventIds"));

    var dup = Ids(data, "duplicateEventIds");
    var rej = Ids(data, "rejectedEventIds");
    Assert.Single(dup);
    Assert.Contains(thirdId, dup);
    Assert.Single(rej);
    Assert.Contains(thirdId, rej);

    var rejected = data.GetProperty("rejected");
    Assert.Equal(3, rejected.GetArrayLength());
    Assert.Equal("NOT_OBJECT", rejected[0].GetProperty("code").GetString());
    Assert.Equal(JsonValueKind.Null, rejected[0].GetProperty("eventId").ValueKind);
    Assert.Equal("BAD_EVENT_ID", rejected[1].GetProperty("code").GetString());
    Assert.Equal(JsonValueKind.Null, rejected[1].GetProperty("eventId").ValueKind);
    Assert.Equal("TOO_LONG", rejected[2].GetProperty("code").GetString());
    Assert.Equal(thirdId, rejected[2].GetProperty("eventId").GetString());

    Assert.Equal(0, await RowCountAsync(user));
  }

  [Fact]
  public async Task RejectedIds_AreAlsoDuplicateIds_ForTheFrozenClient()
  {
    var user = NewUser("frozen-ack");

    var validIds = new List<string>();
    var events = new List<object>();
    for (var k = 0; k < 5; k++)
    {
      var id = NewEventId();
      validIds.Add(id);
      events.Add(Valid(id));
    }

    // Five rejected events, each a valid UUID failing a different rule, so each carries an id.
    var rejectedIds = new List<string>();
    string Reject(Action<Dictionary<string, object?>> mutate)
    {
      var id = NewEventId();
      var e = Valid(id);
      mutate(e);
      events.Add(e);
      rejectedIds.Add(id);
      return id;
    }
    Reject(e => e["stableUid"] = null);                      // MISSING_FIELD
    Reject(e => e["deckSlug"] = new string('x', 129));       // TOO_LONG
    Reject(e => e["stableUid"] = new string('x', 129));      // TOO_LONG
    Reject(e => e["sessionId"] = new string('x', 65));       // TOO_LONG
    Reject(e => e["reviewStage"] = new string('x', 65));     // TOO_LONG

    var data = await PostAsync(user, events);

    var dup = Ids(data, "duplicateEventIds");
    var rej = Ids(data, "rejectedEventIds");
    foreach (var id in rej) Assert.Contains(id, dup);

    var union = new HashSet<string>(Ids(data, "acceptedEventIds"), StringComparer.Ordinal);
    union.UnionWith(dup);
    var all = new HashSet<string>(validIds, StringComparer.Ordinal);
    all.UnionWith(rejectedIds);
    Assert.True(all.SetEquals(union), "acceptedEventIds ∪ duplicateEventIds must equal every submitted id");
  }

  [Theory]
  [InlineData("deckSlug", 129)]
  [InlineData("stableUid", 129)]
  [InlineData("sessionId", 65)]
  [InlineData("reviewStage", 65)]
  [InlineData("schedulerVersion", 65)]
  public async Task TooLongPerEventField_IsRejectedWithTooLong(string field, int length)
  {
    var user = NewUser("toolong");

    var badId = NewEventId();
    var bad = Valid(badId);
    bad[field] = new string('x', length);

    var goodId = NewEventId();
    var good = Valid(goodId);
    good[field] = new string('x', length - 1);   // one under the cap: accepted

    var data = await PostAsync(user, new List<object> { bad, good });

    var rejected = data.GetProperty("rejected");
    Assert.Equal(1, rejected.GetArrayLength());
    Assert.Equal(badId, rejected[0].GetProperty("eventId").GetString());
    Assert.Equal("TOO_LONG", rejected[0].GetProperty("code").GetString());

    Assert.Contains(goodId, Ids(data, "acceptedEventIds"));
    Assert.DoesNotContain(badId, Ids(data, "acceptedEventIds"));
  }

  [Fact]
  public async Task RatingOutOfRange_IsStoredAsNull_NotRejected()
  {
    var user = NewUser("rating");

    var id9 = NewEventId();
    var e9 = Valid(id9);
    e9["rating"] = 9;

    var id4 = NewEventId();
    var e4 = Valid(id4);
    e4["rating"] = 4;

    var data = await PostAsync(user, new List<object> { e9, e4 });
    Assert.Equal(2, data.GetProperty("acceptedCount").GetInt32());
    Assert.Equal(0, data.GetProperty("rejected").GetArrayLength());

    var r9 = await _db.QueryAsync("select rating from user_progress_events where event_id = $1::uuid", id9);
    Assert.Null(r9[0]["rating"]);

    var r4 = await _db.QueryAsync("select rating from user_progress_events where event_id = $1::uuid", id4);
    Assert.Equal(4, Convert.ToInt32(r4[0]["rating"], CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task BatchLevelStrings_AreClampedTo64()
  {
    var user = NewUser("clamp");
    var id = NewEventId();

    var body = Batch(
      new List<object> { Valid(id) },
      deviceId: new string('d', 100),
      clientVersion: new string('v', 100),
      clientPlatform: new string('p', 100));

    var data = await LambdaHost.PostProgressEventsAsync(user, body);
    Assert.Equal(1, data.GetProperty("acceptedCount").GetInt32());

    var rows = await _db.QueryAsync(
      "select device_id, client_version from user_progress_events where event_id = $1::uuid", id);
    Assert.Equal(64, (rows[0]["device_id"] as string)!.Length);
    Assert.Equal(64, (rows[0]["client_version"] as string)!.Length);
  }

  public static IEnumerable<object[]> StructuralCases()
  {
    yield return new object[] { "{not json", "Invalid JSON body" };
    yield return new object[] { "{\"events\":5}", "events must be a non-empty array" };
    yield return new object[] { "{\"events\":[]}", "events must be a non-empty array" };
    var overSized = JsonSerializer.Serialize(
      Batch(Enumerable.Range(0, 201).Select(_ => (object)Valid(NewEventId()))));
    yield return new object[] { overSized, "events too many (max 200)" };
  }

  [Theory]
  [MemberData(nameof(StructuralCases))]
  public async Task StructuralErrors_Still400(string bodyJson, string messagePart)
  {
    var response = await PostRawAsync(NewUser("struct"), bodyJson);
    Assert.Equal(400, response.StatusCode);

    var code = ErrCode(response);
    Assert.True(code is "VALIDATION_ERROR" or "BAD_REQUEST", $"unexpected error code {code}");
    Assert.Contains(messagePart, ErrMsg(response), StringComparison.Ordinal);
  }

  public static IEnumerable<object[]> Seeds() =>
    Enumerable.Range(0, GeneratedCaseCount).Select(i => new object[] { i });

  [Theory]
  [MemberData(nameof(Seeds))]
  public async Task Invariants_HoldForGeneratedBatches(int seed)
  {
    var rng = new Random(20260922 + seed);
    var n = rng.Next(1, 26);   // 1..25

    var events = new List<object>();
    var validUuidIds = new HashSet<string>(StringComparer.Ordinal);   // every submitted valid-UUID id
    var earlierValid = new List<string>();                            // accepted-eligible ids, for duplicates
    var invalidCount = 0;                                             // the five invalid kinds

    for (var i = 0; i < n; i++)
    {
      var kind = rng.Next(0, 8);
      if (kind == 2 && earlierValid.Count == 0) kind = 0;   // no earlier event to duplicate yet

      switch (kind)
      {
        case 0:   // valid
        {
          var id = NewEventId();
          events.Add(Valid(id));
          validUuidIds.Add(id);
          earlierValid.Add(id);
          break;
        }
        case 1:   // valid, rating out of range (still accepted)
        {
          var id = NewEventId();
          var e = Valid(id);
          e["rating"] = rng.Next(2) == 0 ? 9 : 0;
          events.Add(e);
          validUuidIds.Add(id);
          earlierValid.Add(id);
          break;
        }
        case 2:   // duplicate of an earlier valid event in the batch
        {
          var id = earlierValid[rng.Next(earlierValid.Count)];
          var e = Valid(id);
          e["stableUid"] = $"dup-{Guid.NewGuid():N}";
          events.Add(e);
          validUuidIds.Add(id);
          break;
        }
        case 3:   // not-object
        {
          events.Add(rng.Next(1000));
          invalidCount++;
          break;
        }
        case 4:   // bad id (missing or non-UUID)
        {
          if (rng.Next(2) == 0)
          {
            events.Add(Valid("nope"));
          }
          else
          {
            var e = Valid(NewEventId());
            e["eventId"] = null;
            events.Add(e);
          }
          invalidCount++;
          break;
        }
        case 5:   // missing field
        {
          var id = NewEventId();
          var e = Valid(id);
          e["stableUid"] = null;
          events.Add(e);
          validUuidIds.Add(id);
          invalidCount++;
          break;
        }
        case 6:   // deckSlug over 128
        {
          var id = NewEventId();
          var e = Valid(id);
          e["deckSlug"] = new string('x', 129);
          events.Add(e);
          validUuidIds.Add(id);
          invalidCount++;
          break;
        }
        default:  // 7: sessionId over 64
        {
          var id = NewEventId();
          var e = Valid(id);
          e["sessionId"] = new string('x', 65);
          events.Add(e);
          validUuidIds.Add(id);
          invalidCount++;
          break;
        }
      }
    }

    var user = NewUser($"gen-{seed}");
    var data = await PostAsync(user, events);

    Assert.Equal(n, data.GetProperty("receivedCount").GetInt32());

    var accepted = Ids(data, "acceptedEventIds");
    var dup = Ids(data, "duplicateEventIds");
    var rej = Ids(data, "rejectedEventIds");

    var union = new HashSet<string>(accepted, StringComparer.Ordinal);
    union.UnionWith(dup);
    Assert.True(validUuidIds.SetEquals(union), $"seed {seed}: union must equal the distinct valid-UUID ids submitted");

    foreach (var id in rej) Assert.Contains(id, dup);

    Assert.Equal(invalidCount, data.GetProperty("rejected").GetArrayLength());
    Assert.Equal(data.GetProperty("acceptedCount").GetInt32(), accepted.Count);
    foreach (var id in accepted) Assert.DoesNotContain(id, rej);

    Assert.Equal(data.GetProperty("acceptedCount").GetInt32(), await RowCountAsync(user));
  }
}
