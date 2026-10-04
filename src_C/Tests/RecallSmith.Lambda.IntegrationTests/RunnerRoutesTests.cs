using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc;
using RecallSmith.Lambda.Vpc.Automation;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The local authoring runner's routes (R18A A02, contract A00 §8.5): RUNNER auth, the heartbeat upsert and its mode
/// report, claim (mode off, due items, deleted decks, concurrent claims) and complete (done, failed with backoff, the
/// third failure, replay, the error codes), the pre-034 503 and the agent token through <see cref="VpcFunction"/>.
///
/// Every database test runs against this class's own scratch database migrated to the latest version (the
/// <c>PGDATABASE</c> switch), and starts by skipping every item still <c>queued</c> there, so no other test's items
/// ever enter a claim. Every env variable a test sets is restored in <c>finally</c>.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class RunnerRoutesTests
{
  private const string ScratchName = "it_a02_runner";
  private const string NotReadyName = "it_a02_runner_notready";
  private const string HeartbeatPath = "/api/v1/authoring/automation/runner/heartbeat";
  private const string ClaimPath = "/api/v1/authoring/automation/runner/claim";
  private const string CompletePath = "/api/v1/authoring/automation/runner/complete";

  // A00 §8.5, the response keys in contract order.
  private static readonly string[] HeartbeatKeys = ["mode", "effectiveMode", "liveBlockedReason", "serverTime", "queue", "pollAfterSeconds"];
  private static readonly string[] ClaimKeys = ["mode", "effectiveMode", "items"];
  private static readonly string[] ClaimItemKeys =
    ["itemId", "runId", "kind", "url", "deckId", "deckSlug", "title", "sectionHint", "note", "attempts", "leaseExpiresAt", "maxCards"];
  private static readonly string[] CompleteKeys = ["runId", "runStatus", "itemStatus", "decisions", "replayed"];

  private static readonly SemaphoreSlim ScratchGate = new(1, 1);
  private static string? _scratch;

  private readonly PostgresFixture _db;
  public RunnerRoutesTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- scratch database

  private async Task<string> ScratchAsync()
  {
    await ScratchGate.WaitAsync();
    try
    {
      if (_scratch is null)
      {
        var cs = await _db.CreateScratchDatabaseAsync(ScratchName);
        await using var conn = new NpgsqlConnection(cs);
        await conn.OpenAsync();
        await PostgresFixture.ApplyMigrationsAsync(conn, int.MaxValue);
        _scratch = cs;
      }
      return _scratch;
    }
    finally
    {
      ScratchGate.Release();
    }
  }

  /// <summary>Runs <paramref name="body"/> with PGDATABASE on the scratch database and AUTOMATION_MODE = <paramref name="mode"/>.</summary>
  private async Task InScratchAsync(string? mode, Func<Task> body, string database = ScratchName)
  {
    if (database == ScratchName)
    {
      await ScratchAsync();
      await ExecAsync("update authoring_queue_items set status = 'skipped', finished_at = now(), updated_at = now() where status = 'queued'");
    }

    var savedDb = Environment.GetEnvironmentVariable("PGDATABASE");
    var savedMode = Environment.GetEnvironmentVariable(AutomationMode.EnvName);
    try
    {
      Environment.SetEnvironmentVariable("PGDATABASE", database);
      Environment.SetEnvironmentVariable(AutomationMode.EnvName, mode);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
      await body();
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", savedDb);
      Environment.SetEnvironmentVariable(AutomationMode.EnvName, savedMode);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
    }
  }

  private async Task<List<Dictionary<string, object?>>> QueryAsync(string sql, params object?[] parameters)
  {
    await using var conn = new NpgsqlConnection(await ScratchAsync());
    await conn.OpenAsync();
    return await DbUtil.QueryAsync(conn, null, sql, parameters);
  }

  private async Task<object?> ScalarAsync(string sql, params object?[] parameters)
  {
    await using var conn = new NpgsqlConnection(await ScratchAsync());
    await conn.OpenAsync();
    return await DbUtil.ExecuteScalarAsync(conn, null, sql, parameters);
  }

  private async Task ExecAsync(string sql, params object?[] parameters)
  {
    await using var conn = new NpgsqlConnection(await ScratchAsync());
    await conn.OpenAsync();
    await DbUtil.ExecuteAsync(conn, null, sql, parameters);
  }

  // ---------------------------------------------------------------- helpers

  private static string Sub() => $"it-a02-owner-{Guid.NewGuid():N}";
  private static string RunnerId() => $"it-a02-{Guid.NewGuid():N}"[..30];
  private static long Long(object? v) => Convert.ToInt64(v, CultureInfo.InvariantCulture);

  private static AuthContext Ctx(string sub, bool agent = true, bool superAdmin = true) => new(
    Claims: new Dictionary<string, JsonElement>(),
    UserSub: sub,
    Username: null,
    Groups: superAdmin ? ["super_admin"] : ["editor"],
    IsSuperAdmin: superAdmin,
    IsEditor: !superAdmin,
    IsAdmin: true,
    IsAgentClient: agent);

  private static JsonElement Event(string method, string path, string? body, string? bearer = null)
  {
    var headers = new Dictionary<string, string>(StringComparer.Ordinal) { ["content-type"] = "application/json" };
    if (bearer is not null) headers["authorization"] = "Bearer " + bearer;
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new { requestId = Guid.NewGuid().ToString(), http = new { method } },
      headers,
      queryStringParameters = new Dictionary<string, string>(),
      body,
      isBase64Encoded = false,
    });
  }

  private delegate Task<APIGatewayProxyResponse> Handler(LambdaRequest req, Res res, AuthContext auth);

  private static Task<APIGatewayProxyResponse> CallAsync(Handler handler, string path, object? body, AuthContext auth, string method = "POST")
  {
    var raw = body switch { null => null, string s => s, _ => JsonSerializer.Serialize(body) };
    var req = new LambdaRequest(Event(method, path, raw));
    return handler(req, new Res(req.TraceId), auth);
  }

  private static Task<APIGatewayProxyResponse> HeartbeatAsync(object body, AuthContext auth) =>
    CallAsync(RunnerRoutes.HandleHeartbeat, HeartbeatPath, body, auth);

  private static Task<APIGatewayProxyResponse> ClaimAsync(object body, AuthContext auth) =>
    CallAsync(RunnerRoutes.HandleClaim, ClaimPath, body, auth);

  private static Task<APIGatewayProxyResponse> CompleteAsync(object body, AuthContext auth) =>
    CallAsync(RunnerRoutes.HandleComplete, CompletePath, body, auth);

  private static Dictionary<string, object?> HeartbeatBody(string runnerId, string state = "idle") => new(StringComparer.Ordinal)
  {
    ["runnerId"] = runnerId,
    ["host"] = "it-host.example.com",
    ["runnerVersion"] = "0.1.0",
    ["claudeVersion"] = "2.0.0",
    ["state"] = state,
    ["loginExpiresAt"] = "2026-12-01T00:00:00Z",
    ["lastRunId"] = null,
    ["lastRunAt"] = null,
    ["lastRunOutcome"] = null,
    ["lastError"] = null,
  };

  private static object CompleteBody(string runnerId, Guid runId, string outcome, string? error = null) => new
  {
    runnerId,
    runId,
    outcome,
    exitCode = outcome == "failed" ? 1 : 0,
    durationMs = 4321,
    numTurns = 7,
    error,
    summary = $"synthetic summary: {outcome}",
  };

  private static JsonElement Data(APIGatewayProxyResponse response)
  {
    Assert.True(response.StatusCode == 200, $"expected 200, got {response.StatusCode}: {response.Body}");
    using var doc = JsonDocument.Parse(response.Body!);
    return doc.RootElement.GetProperty("data").Clone();
  }

  private static void AssertError(APIGatewayProxyResponse response, int status, string code)
  {
    Assert.True(response.StatusCode == status, $"expected {status}, got {response.StatusCode}: {response.Body}");
    using var doc = JsonDocument.Parse(response.Body!);
    Assert.False(doc.RootElement.GetProperty("success").GetBoolean());
    Assert.Equal(code, doc.RootElement.GetProperty("error").GetProperty("code").GetString());
  }

  private static void AssertKeys(JsonElement obj, string[] keys) =>
    Assert.Equal(keys, obj.EnumerateObject().Select(p => p.Name).ToArray());

  private async Task<(long Id, string Slug)> NewDeckAsync(int isDeleted = 0)
  {
    var slug = $"it-a02-{Guid.NewGuid():N}";
    var rows = await QueryAsync("insert into decks (slug, title, author, is_deleted) values ($1, $2, $3, $4) returning id",
      slug, "deck a02", "tests", (short)isDeleted);
    return (Long(rows[0]["id"]), slug);
  }

  private async Task<long> NewItemAsync(long? deckId, int notBeforeMinutes = -1, string? title = "Synthetic item")
  {
    return Long(await ScalarAsync(
      """
      insert into authoring_queue_items (kind, url, deck_id, title, section_hint, note, dedupe_key, created_by, not_before)
      values ('manual', $1, $2, $3, 'Synthetic section', 'synthetic note', $4, 'owner:it-a02', now() + make_interval(mins => $5))
      returning id
      """,
      $"https://docs.example.com/a02/{Guid.NewGuid():N}", deckId, title, $"test:{Guid.NewGuid()}", notBeforeMinutes));
  }

  private async Task<JsonElement> ClaimOneAsync(string runnerId, AuthContext auth)
  {
    var data = Data(await ClaimAsync(new { runnerId, max = 1 }, auth));
    return Assert.Single(data.GetProperty("items").EnumerateArray().ToList());
  }

  // ---------------------------------------------------------------- auth

  [Fact]
  public async Task Heartbeat_SpaToken_Returns403RunnerClientRequired()
  {
    var auth = Ctx(Sub(), agent: false);
    AssertError(await HeartbeatAsync(HeartbeatBody(RunnerId()), auth), 403, RunnerRoutes.RunnerClientRequired);
    AssertError(await ClaimAsync(new { runnerId = RunnerId() }, auth), 403, "RUNNER_CLIENT_REQUIRED");
    AssertError(await CompleteAsync(CompleteBody(RunnerId(), Guid.NewGuid(), "done"), auth), 403, "RUNNER_CLIENT_REQUIRED");
  }

  [Fact]
  public async Task Heartbeat_EditorAgentToken_Returns403()
  {
    var auth = Ctx(Sub(), agent: true, superAdmin: false);
    AssertError(await HeartbeatAsync(HeartbeatBody(RunnerId()), auth), 403, "FORBIDDEN");
    AssertError(await ClaimAsync(new { runnerId = RunnerId() }, auth), 403, "FORBIDDEN");
    AssertError(await CompleteAsync(CompleteBody(RunnerId(), Guid.NewGuid(), "done"), auth), 403, "FORBIDDEN");

    // The method check follows auth: a runner token on GET is 405.
    AssertError(await CallAsync(RunnerRoutes.HandleHeartbeat, HeartbeatPath, null, Ctx(Sub()), "GET"), 405, "METHOD_NOT_ALLOWED");
  }

  // ---------------------------------------------------------------- heartbeat

  [Fact]
  public async Task Heartbeat_UpsertsRunner_AndReportsMode()
  {
    await InScratchAsync(AutomationMode.DryRun, async () =>
    {
      var (deckId, _) = await NewDeckAsync();
      await NewItemAsync(deckId);
      await NewItemAsync(deckId, notBeforeMinutes: 120);
      await NewItemAsync(null);

      var sub = Sub();
      var runnerId = RunnerId();
      var before = DateTimeOffset.UtcNow.AddSeconds(-5);
      var data = Data(await HeartbeatAsync(HeartbeatBody(runnerId), Ctx(sub)));

      AssertKeys(data, HeartbeatKeys);
      Assert.Equal("dry_run", data.GetProperty("mode").GetString());
      Assert.Equal("dry_run", data.GetProperty("effectiveMode").GetString());
      Assert.Equal(JsonValueKind.Null, data.GetProperty("liveBlockedReason").ValueKind);
      var serverTime = DateTimeOffset.Parse(data.GetProperty("serverTime").GetString()!, CultureInfo.InvariantCulture);
      Assert.InRange(serverTime, before, DateTimeOffset.UtcNow.AddSeconds(5));
      Assert.Equal(3, data.GetProperty("queue").GetProperty("queued").GetInt64());
      Assert.Equal(1, data.GetProperty("queue").GetProperty("due").GetInt64());
      Assert.Equal(3600, data.GetProperty("pollAfterSeconds").GetInt32());

      var row = Assert.Single(await QueryAsync(
        "select owner_sub, host, runner_version, claude_version, state, login_expires_at, last_heartbeat_at from automation_runners where runner_id = $1", runnerId));
      Assert.Equal(sub, row["owner_sub"]);
      Assert.Equal("it-host.example.com", row["host"]);
      Assert.Equal("0.1.0", row["runner_version"]);
      Assert.Equal("2.0.0", row["claude_version"]);
      Assert.Equal("idle", row["state"]);
      Assert.Equal(new DateTime(2026, 12, 1, 0, 0, 0, DateTimeKind.Utc), ((DateTime)row["login_expires_at"]!).ToUniversalTime());
      var firstBeat = (DateTime)row["last_heartbeat_at"]!;

      // A second heartbeat updates the same row; live without a gate reports dry_run / EVAL_GATE_MISSING.
      Environment.SetEnvironmentVariable(AutomationMode.EnvName, AutomationMode.Live);
      var body = HeartbeatBody(runnerId, "login_expired");
      var lastRunId = Guid.NewGuid();
      body["lastRunId"] = lastRunId.ToString();
      body["lastRunAt"] = "2026-09-27T10:00:00+02:00";
      body["lastRunOutcome"] = "nothing_new";
      data = Data(await HeartbeatAsync(body, Ctx(sub)));
      Assert.Equal("live", data.GetProperty("mode").GetString());
      Assert.Equal("dry_run", data.GetProperty("effectiveMode").GetString());
      Assert.Equal("EVAL_GATE_MISSING", data.GetProperty("liveBlockedReason").GetString());

      row = Assert.Single(await QueryAsync(
        "select state, last_heartbeat_at, last_run_id, last_run_at, last_run_outcome from automation_runners where runner_id = $1", runnerId));
      Assert.Equal("login_expired", row["state"]);
      Assert.True((DateTime)row["last_heartbeat_at"]! >= firstBeat);
      Assert.Equal(lastRunId, row["last_run_id"]);
      Assert.Equal(new DateTime(2026, 9, 27, 8, 0, 0, DateTimeKind.Utc), ((DateTime)row["last_run_at"]!).ToUniversalTime());
      Assert.Equal("nothing_new", row["last_run_outcome"]);

      // Works in every mode, off included.
      Environment.SetEnvironmentVariable(AutomationMode.EnvName, AutomationMode.Off);
      data = Data(await HeartbeatAsync(HeartbeatBody(runnerId), Ctx(sub)));
      Assert.Equal("off", data.GetProperty("mode").GetString());
      Assert.Equal("off", data.GetProperty("effectiveMode").GetString());
    });
  }

  [Fact]
  public async Task Heartbeat_OtherOwner_Returns403RunnerMismatch()
  {
    await InScratchAsync(AutomationMode.DryRun, async () =>
    {
      var owner = Sub();
      var runnerId = RunnerId();
      Data(await HeartbeatAsync(HeartbeatBody(runnerId), Ctx(owner)));

      AssertError(await HeartbeatAsync(HeartbeatBody(runnerId, "running"), Ctx(Sub())), 403, "RUNNER_MISMATCH");
      AssertError(await ClaimAsync(new { runnerId }, Ctx(Sub())), 403, "RUNNER_MISMATCH");

      var row = Assert.Single(await QueryAsync("select owner_sub, state from automation_runners where runner_id = $1", runnerId));
      Assert.Equal(owner, row["owner_sub"]);
      Assert.Equal("idle", row["state"]);
    });
  }

  [Fact]
  public async Task Heartbeat_InvalidBody_Returns400ValidationError()
  {
    var auth = Ctx(Sub());
    AssertError(await HeartbeatAsync("{not json", auth), 400, "BAD_REQUEST");
    AssertError(await HeartbeatAsync("[]", auth), 400, "VALIDATION_ERROR");

    var cases = new (string Key, object? Value)[]
    {
      ("runnerId", null),
      ("runnerId", "Upper-Case"),
      ("runnerId", "-leading-dash"),
      ("runnerId", new string('a', 65)),
      ("runnerId", 12),
      ("host", new string('h', 65)),
      ("runnerVersion", null),
      ("runnerVersion", new string('v', 41)),
      ("claudeVersion", new string('c', 81)),
      ("state", "sleeping"),
      ("state", null),
      ("loginExpiresAt", "tomorrow"),
      ("loginExpiresAt", "2026-13-01T00:00:00Z"),
      ("lastRunId", "not-a-uuid"),
      ("lastRunAt", 1790000000),
      ("lastRunOutcome", "succeeded"),
      ("lastError", new string('e', 501)),
    };
    foreach (var (key, value) in cases)
    {
      var body = HeartbeatBody(RunnerId());
      body[key] = value;
      var response = await HeartbeatAsync(body, auth);
      Assert.True(response.StatusCode == 400, $"{key}={value}: {response.Body}");
      AssertError(response, 400, "VALIDATION_ERROR");
    }

    AssertError(await ClaimAsync(new { runnerId = RunnerId(), max = 6 }, auth), 400, "VALIDATION_ERROR");
    AssertError(await ClaimAsync(new { runnerId = RunnerId(), max = 0 }, auth), 400, "VALIDATION_ERROR");
    AssertError(await ClaimAsync(new { runnerId = RunnerId(), leaseMinutes = 14 }, auth), 400, "VALIDATION_ERROR");
    AssertError(await ClaimAsync(new { runnerId = RunnerId(), leaseMinutes = 241 }, auth), 400, "VALIDATION_ERROR");
    AssertError(await CompleteAsync(new { runnerId = RunnerId(), runId = "x", outcome = "done", durationMs = 1 }, auth), 400, "VALIDATION_ERROR");
    AssertError(await CompleteAsync(new { runnerId = RunnerId(), runId = Guid.NewGuid(), outcome = "ok", durationMs = 1 }, auth), 400, "VALIDATION_ERROR");
    AssertError(await CompleteAsync(new { runnerId = RunnerId(), runId = Guid.NewGuid(), outcome = "done", durationMs = -1 }, auth), 400, "VALIDATION_ERROR");
    AssertError(await CompleteAsync(new { runnerId = RunnerId(), runId = Guid.NewGuid(), outcome = "done" }, auth), 400, "VALIDATION_ERROR");
    AssertError(await CompleteAsync(new { runnerId = RunnerId(), runId = Guid.NewGuid(), outcome = "failed", durationMs = 1, error = new string('e', 501) }, auth), 400, "VALIDATION_ERROR");
    AssertError(await CompleteAsync(new { runnerId = RunnerId(), runId = Guid.NewGuid(), outcome = "done", durationMs = 1, summary = new string('s', 2001) }, auth), 400, "VALIDATION_ERROR");
  }

  // ---------------------------------------------------------------- claim

  [Fact]
  public async Task Claim_ModeOff_ReturnsNoItems()
  {
    await InScratchAsync(AutomationMode.Off, async () =>
    {
      var (deckId, _) = await NewDeckAsync();
      var itemId = await NewItemAsync(deckId);
      var runnerId = RunnerId();

      var data = Data(await ClaimAsync(new { runnerId, max = 5 }, Ctx(Sub())));
      AssertKeys(data, ClaimKeys);
      Assert.Equal("off", data.GetProperty("mode").GetString());
      Assert.Equal("off", data.GetProperty("effectiveMode").GetString());
      Assert.Empty(data.GetProperty("items").EnumerateArray());

      Assert.Equal("queued", await ScalarAsync("select status from authoring_queue_items where id = $1", itemId));
      Assert.Equal(0L, Long(await ScalarAsync("select count(*) from automation_runs where queue_item_id = $1", itemId)));
      Assert.Equal(0L, Long(await ScalarAsync("select count(*) from automation_runners where runner_id = $1", runnerId)));
    });
  }

  [Fact]
  public async Task Claim_DryRun_ClaimsDueItems_AndCreatesRuns()
  {
    await InScratchAsync(AutomationMode.DryRun, async () =>
    {
      var (deckId, slug) = await NewDeckAsync();
      var first = await NewItemAsync(deckId, title: "First synthetic item");
      var second = await NewItemAsync(deckId);
      var third = await NewItemAsync(deckId);
      var future = await NewItemAsync(deckId, notBeforeMinutes: 60);
      var sub = Sub();
      var runnerId = RunnerId();

      var data = Data(await ClaimAsync(new { runnerId, max = 2, leaseMinutes = 30 }, Ctx(sub)));
      AssertKeys(data, ClaimKeys);
      Assert.Equal("dry_run", data.GetProperty("mode").GetString());
      Assert.Equal("dry_run", data.GetProperty("effectiveMode").GetString());
      var items = data.GetProperty("items").EnumerateArray().ToList();
      Assert.Equal([first, second], items.Select(i => i.GetProperty("itemId").GetInt64()).ToArray());

      var item = items[0];
      AssertKeys(item, ClaimItemKeys);
      Assert.Equal("manual", item.GetProperty("kind").GetString());
      Assert.StartsWith("https://docs.example.com/a02/", item.GetProperty("url").GetString());
      Assert.Equal(deckId, item.GetProperty("deckId").GetInt64());
      Assert.Equal(slug, item.GetProperty("deckSlug").GetString());
      Assert.Equal("First synthetic item", item.GetProperty("title").GetString());
      Assert.Equal("Synthetic section", item.GetProperty("sectionHint").GetString());
      Assert.Equal("synthetic note", item.GetProperty("note").GetString());
      Assert.Equal(1, item.GetProperty("attempts").GetInt32());
      Assert.Equal(5, item.GetProperty("maxCards").GetInt32());
      var lease = DateTimeOffset.Parse(item.GetProperty("leaseExpiresAt").GetString()!, CultureInfo.InvariantCulture);
      Assert.InRange(lease, DateTimeOffset.UtcNow.AddMinutes(29), DateTimeOffset.UtcNow.AddMinutes(31));

      foreach (var claimed in items)
      {
        var itemId = claimed.GetProperty("itemId").GetInt64();
        var runId = Guid.Parse(claimed.GetProperty("runId").GetString()!);
        var q = Assert.Single(await QueryAsync(
          "select status, claimed_by_runner, claimed_at, lease_expires_at, attempts, last_run_id from authoring_queue_items where id = $1", itemId));
        Assert.Equal("claimed", q["status"]);
        Assert.Equal(runnerId, q["claimed_by_runner"]);
        Assert.NotNull(q["claimed_at"]);
        Assert.NotNull(q["lease_expires_at"]);
        Assert.Equal(1, q["attempts"]);
        Assert.Equal(runId, q["last_run_id"]);

        var run = Assert.Single(await QueryAsync(
          "select queue_item_id, runner_id, owner_sub, deck_id, status, outcome from automation_runs where run_id = $1", runId));
        Assert.Equal(itemId, Long(run["queue_item_id"]));
        Assert.Equal(runnerId, run["runner_id"]);
        Assert.Equal(sub, run["owner_sub"]);
        Assert.Equal(deckId, Long(run["deck_id"]));
        Assert.Equal("running", run["status"]);
        Assert.Null(run["outcome"]);
      }

      Assert.Equal("queued", await ScalarAsync("select status from authoring_queue_items where id = $1", third));
      Assert.Equal("queued", await ScalarAsync("select status from authoring_queue_items where id = $1", future));

      // A claim without a prior heartbeat registered the runner as running.
      var runner = Assert.Single(await QueryAsync("select owner_sub, state, runner_version from automation_runners where runner_id = $1", runnerId));
      Assert.Equal(sub, runner["owner_sub"]);
      Assert.Equal("running", runner["state"]);
      Assert.Null(runner["runner_version"]);

      // The default max is 1 and the default lease 90 minutes.
      var next = await ClaimOneAsync(runnerId, Ctx(sub));
      Assert.Equal(third, next.GetProperty("itemId").GetInt64());
      var defaultLease = DateTimeOffset.Parse(next.GetProperty("leaseExpiresAt").GetString()!, CultureInfo.InvariantCulture);
      Assert.InRange(defaultLease, DateTimeOffset.UtcNow.AddMinutes(89), DateTimeOffset.UtcNow.AddMinutes(91));
      Assert.Empty(Data(await ClaimAsync(new { runnerId }, Ctx(sub))).GetProperty("items").EnumerateArray());
    });
  }

  [Fact]
  public async Task Claim_SkipsItemsOfDeletedDecks()
  {
    await InScratchAsync(AutomationMode.DryRun, async () =>
    {
      var (deletedDeck, _) = await NewDeckAsync(isDeleted: 1);
      var (liveDeck, _) = await NewDeckAsync();
      var orphan = await NewItemAsync(deletedDeck);
      var live = await NewItemAsync(liveDeck);

      var data = Data(await ClaimAsync(new { runnerId = RunnerId(), max = 5 }, Ctx(Sub())));
      var item = Assert.Single(data.GetProperty("items").EnumerateArray().ToList());
      Assert.Equal(live, item.GetProperty("itemId").GetInt64());

      var row = Assert.Single(await QueryAsync(
        "select status, last_error, finished_at, lease_expires_at, attempts from authoring_queue_items where id = $1", orphan));
      Assert.Equal("skipped", row["status"]);
      Assert.Equal("DECK_MISSING", row["last_error"]);
      Assert.NotNull(row["finished_at"]);
      Assert.Null(row["lease_expires_at"]);
      Assert.Equal(0, row["attempts"]);
      Assert.Equal(0L, Long(await ScalarAsync("select count(*) from automation_runs where queue_item_id = $1", orphan)));
    });
  }

  [Fact]
  public async Task Claim_ConcurrentClaims_NeverShareAnItem()
  {
    await InScratchAsync(AutomationMode.DryRun, async () =>
    {
      var sub = Sub();
      for (var round = 0; round < 5; round++)
      {
        var (deckId, _) = await NewDeckAsync();
        var seeded = new[] { await NewItemAsync(deckId), await NewItemAsync(deckId), await NewItemAsync(deckId) };

        var a = RunnerId();
        var b = RunnerId();
        var responses = await Task.WhenAll(
          Task.Run(() => ClaimAsync(new { runnerId = a, max = 3 }, Ctx(sub))),
          Task.Run(() => ClaimAsync(new { runnerId = b, max = 3 }, Ctx(sub))));

        var setA = Data(responses[0]).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("itemId").GetInt64()).ToList();
        var setB = Data(responses[1]).GetProperty("items").EnumerateArray().Select(i => i.GetProperty("itemId").GetInt64()).ToList();
        Assert.Empty(setA.Intersect(setB));
        Assert.Equal(seeded.OrderBy(x => x), setA.Concat(setB).OrderBy(x => x));

        Assert.Equal(3L, Long(await ScalarAsync("select count(*) from automation_runs where queue_item_id = any($1)", seeded)));
        Assert.Equal(3L, Long(await ScalarAsync("select count(*) from authoring_queue_items where id = any($1) and status = 'claimed' and attempts = 1", seeded)));
      }
    });
  }

  // ---------------------------------------------------------------- claim: the source-watch daily cap (R28 MONITOR)

  /// <summary>A queue item as the source watch creates it (SourceWatchRoutes: created_by 'watcher').</summary>
  private async Task<long> NewWatchItemAsync(long deckId, string kind = "source_changed")
  {
    return Long(await ScalarAsync(
      """
      insert into authoring_queue_items (kind, url, deck_id, title, note, dedupe_key, created_by)
      values ($1, $2, $3, 'Source changed', 'missing quotes: 0', $4, 'watcher')
      returning id
      """,
      kind, $"https://docs.example.com/r28/{Guid.NewGuid():N}", deckId, $"test:r28:{Guid.NewGuid()}"));
  }

  /// <summary>Moves every earlier claim of a source-watch item out of the rolling 24-hour window.</summary>
  private Task AgeWatchClaimsAsync(int hours = 25) => ExecAsync(
    """
    update automation_runs set started_at = started_at - make_interval(hours => $1)
    where queue_item_id in (select id from authoring_queue_items where kind in ('source_changed', 'feed_item'))
    """, hours);

  private static long[] ItemIds(JsonElement data) =>
    data.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("itemId").GetInt64()).ToArray();

  private static async Task WithWatchCapAsync(string? value, Func<Task> body)
  {
    var saved = Environment.GetEnvironmentVariable(AutomationEnv.WatchClaimsPerDayEnv);
    try
    {
      Environment.SetEnvironmentVariable(AutomationEnv.WatchClaimsPerDayEnv, value);
      await body();
    }
    finally
    {
      Environment.SetEnvironmentVariable(AutomationEnv.WatchClaimsPerDayEnv, saved);
    }
  }

  [Fact]
  public async Task WatchClaimsPerDay_ParsesWithASafeDefault()
  {
    var cases = new (string? Raw, int Want)[]
    {
      (null, 5), ("", 5), ("  ", 5), ("abc", 5), ("-1", 5), ("+7", 5), ("2.5", 5), ("1e3", 5), ("7 7", 5), ("٣", 5),
      ("0", 0), ("1", 1), (" 7 ", 7), ("007", 7), ("1000", 1000), ("5000", 1000),
      // R28 review F5: a whole number past int range is still "above the maximum", not "not a number".
      ("99999999999", 1000), ("2147483648", 1000), ("2147483647", 1000),
    };
    foreach (var (raw, want) in cases)
    {
      await WithWatchCapAsync(raw, () =>
      {
        Assert.True(AutomationEnv.WatchClaimsPerDay() == want, $"{raw ?? "(unset)"} -> {AutomationEnv.WatchClaimsPerDay()}, want {want}");
        return Task.CompletedTask;
      });
    }
    Assert.Equal(5, AutomationEnv.DefaultWatchClaimsPerDay);
  }

  [Fact]
  public async Task Claim_SourceWatchItems_AreCappedPerRolling24Hours_OwnerItemsAreNot()
  {
    await InScratchAsync(AutomationMode.DryRun, async () =>
    {
      await AgeWatchClaimsAsync();
      await WithWatchCapAsync("2", async () =>
      {
        var (deckId, _) = await NewDeckAsync();
        var w1 = await NewWatchItemAsync(deckId);
        var w2 = await NewWatchItemAsync(deckId, "feed_item");
        var w3 = await NewWatchItemAsync(deckId);
        var m1 = await NewItemAsync(deckId);
        var sub = Sub();
        var runnerId = RunnerId();

        // Two source-watch items fit the day; the third stays queued, the owner's item is claimed regardless.
        var first = ItemIds(Data(await ClaimAsync(new { runnerId, max = 5 }, Ctx(sub))));
        Assert.Equal([w1, w2, m1], first);
        Assert.Equal("queued", await ScalarAsync("select status from authoring_queue_items where id = $1", w3));
        Assert.Equal(0, Convert.ToInt32(await ScalarAsync("select attempts from authoring_queue_items where id = $1", w3), CultureInfo.InvariantCulture));

        // A second runner, a minute later: the cap is the queue's, not the runner's. New owner items still flow.
        var m2 = await NewItemAsync(deckId);
        var second = ItemIds(Data(await ClaimAsync(new { runnerId = RunnerId(), max = 5 }, Ctx(Sub()))));
        Assert.Equal([m2], second);
        Assert.Equal("queued", await ScalarAsync("select status from authoring_queue_items where id = $1", w3));

        // A claim that later failed or was refunded still counted: the window is about claims, not outcomes.
        await ExecAsync("update authoring_queue_items set status = 'queued', lease_expires_at = null where id = $1", w1);
        Assert.Empty(ItemIds(Data(await ClaimAsync(new { runnerId, max = 5 }, Ctx(sub)))));

        // Once the earlier claims leave the 24-hour window, the next two drain (w1 again, then w3).
        await AgeWatchClaimsAsync();
        Assert.Equal([w1, w3], ItemIds(Data(await ClaimAsync(new { runnerId, max = 5 }, Ctx(sub)))));
      });
    });
  }

  [Fact]
  public async Task Claim_WatchCapZero_HoldsEverySourceWatchItem_AndDefaultIsFive()
  {
    await InScratchAsync(AutomationMode.DryRun, async () =>
    {
      await AgeWatchClaimsAsync();
      var (deckId, _) = await NewDeckAsync();
      var watch = new List<long>();
      for (var i = 0; i < 7; i++) watch.Add(await NewWatchItemAsync(deckId));
      var sub = Sub();
      var runnerId = RunnerId();

      await WithWatchCapAsync("0", async () =>
      {
        var owner = await NewItemAsync(deckId);
        Assert.Equal([owner], ItemIds(Data(await ClaimAsync(new { runnerId, max = 5 }, Ctx(sub)))));
        Assert.Empty(ItemIds(Data(await ClaimAsync(new { runnerId, max = 5 }, Ctx(sub)))));
      });

      // Unset: the default 5 a day, one claim at a time as the runner does it.
      await WithWatchCapAsync(null, async () =>
      {
        var claimed = new List<long>();
        for (var i = 0; i < 7; i++) claimed.AddRange(ItemIds(Data(await ClaimAsync(new { runnerId, max = 1 }, Ctx(sub)))));
        Assert.Equal(watch.Take(5), claimed);
        Assert.Equal(2L, Long(await ScalarAsync("select count(*) from authoring_queue_items where id = any($1) and status = 'queued'", watch.ToArray())));
      });
    });
  }

  [Fact]
  public async Task Claim_WatchCap_TwoRunnersAtOnce_ShareOneCap()
  {
    // R28 review F6: the cap is the queue's. Two runners claiming at the same moment, each asking for 3, get 2 source-watch
    // items between them, the two oldest, never 2 each.
    await InScratchAsync(AutomationMode.DryRun, async () =>
    {
      await WithWatchCapAsync("2", async () =>
      {
        for (var round = 0; round < 5; round++)
        {
          await AgeWatchClaimsAsync();
          await ExecAsync("update authoring_queue_items set status = 'skipped', finished_at = now(), updated_at = now() where status = 'queued'");
          var (deckId, _) = await NewDeckAsync();
          var watch = new List<long>();
          for (var i = 0; i < 6; i++) watch.Add(await NewWatchItemAsync(deckId));
          var sub = Sub();

          var responses = await Task.WhenAll(
            Task.Run(() => ClaimAsync(new { runnerId = RunnerId(), max = 3 }, Ctx(sub))),
            Task.Run(() => ClaimAsync(new { runnerId = RunnerId(), max = 3 }, Ctx(sub))));

          var claimed = responses.SelectMany(r => ItemIds(Data(r))).Order().ToList();
          Assert.Equal(watch.Take(2), claimed);
          Assert.Equal(2L, Long(await ScalarAsync("select count(*) from automation_runs where queue_item_id = any($1)", watch.ToArray())));
          Assert.Equal(4L, Long(await ScalarAsync("select count(*) from authoring_queue_items where id = any($1) and status = 'queued'", watch.ToArray())));
        }
      });
    });
  }

  [Fact]
  public async Task Claim_WatchCap_CountsUnderTheLock_SoAClaimCommittedWhileItWaitsIsCounted()
  {
    // R28 review F6, deterministic: this test plays another runner whose claim transaction holds the watch-cap lock and
    // has claimed two source-watch items without committing. The claim must wait for the lock and only then count, so it
    // sees those two once they commit and claims none (cap 2). Without the lock it would not wait and would take the other
    // two (the row locks only make it skip the first two); with the count read before the lock it would count 0 and take
    // them after the wait.
    await InScratchAsync(AutomationMode.DryRun, async () =>
    {
      await AgeWatchClaimsAsync();
      await WithWatchCapAsync("2", async () =>
      {
        var (deckId, _) = await NewDeckAsync();
        var watch = new List<long>();
        for (var i = 0; i < 4; i++) watch.Add(await NewWatchItemAsync(deckId));
        var sub = Sub();

        await using var other = new NpgsqlConnection(await ScratchAsync());
        await other.OpenAsync();
        await using var tx = await other.BeginTransactionAsync();
        await DbUtil.ExecuteAsync(other, tx, "select pg_advisory_xact_lock($1)", [RunnerRoutes.WatchClaimLockKey]);
        var taken = watch.Take(2).ToArray();
        await DbUtil.ExecuteAsync(other, tx,
          """
          update authoring_queue_items
          set status = 'claimed', claimed_by_runner = 'it-r28-other', claimed_at = now(), lease_expires_at = now() + interval '1 hour',
              attempts = attempts + 1, updated_at = now()
          where id = any($1)
          """, [taken]);
        foreach (var id in taken)
        {
          await DbUtil.ExecuteAsync(other, tx,
            "insert into automation_runs (run_id, queue_item_id, runner_id, owner_sub, deck_id, status) values ($1, $2, 'it-r28-other', $3, $4, 'running')",
            [Guid.NewGuid(), id, sub, deckId]);
        }

        var claim = Task.Run(() => ClaimAsync(new { runnerId = RunnerId(), max = 3 }, Ctx(sub)));
        await Task.WhenAny(claim, Task.Delay(TimeSpan.FromSeconds(1)));
        Assert.False(claim.IsCompleted, "the claim must wait for the watch-cap lock another runner's claim holds");

        await tx.CommitAsync();
        Assert.Empty(ItemIds(Data(await claim)));
        Assert.Equal(2L, Long(await ScalarAsync("select count(*) from authoring_queue_items where id = any($1) and status = 'queued'", watch.Skip(2).ToArray())));
      });
    });
  }

  [Fact]
  public async Task Claim_WatchCap_LogsTheDocumentedLine_OnlyWhenItHoldsItems()
  {
    // R28 review F6: docs/runbooks/automation-operations.md tells the owner to search core-vpc's log for
    // { $.reason = "watch_claim_cap" }; the line's shape is pinned here.
    await InScratchAsync(AutomationMode.DryRun, async () =>
    {
      await AgeWatchClaimsAsync();
      await WithWatchCapAsync("1", async () =>
      {
        var (deckId, _) = await NewDeckAsync();
        var first = await NewWatchItemAsync(deckId);
        await NewWatchItemAsync(deckId, "feed_item");
        await NewWatchItemAsync(deckId);
        var runnerId = RunnerId();
        var sub = Sub();

        var within = await EmfCapture.StdoutAsync(async () =>
          Assert.Equal([first], ItemIds(Data(await ClaimAsync(new { runnerId, max = 1 }, Ctx(sub))))));
        Assert.DoesNotContain("watch_claim_cap", within, StringComparison.Ordinal);

        var past = await EmfCapture.StdoutAsync(async () =>
          Assert.Empty(ItemIds(Data(await ClaimAsync(new { runnerId, max = 3 }, Ctx(sub))))));
        var line = Assert.Single(past.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
          l => l.Contains("\"watch_claim_cap\"", StringComparison.Ordinal));
        using var doc = JsonDocument.Parse(line);
        var root = doc.RootElement;
        AssertKeys(root, ["ts", "level", "tag", "reason", "runnerId", "cap", "claimed24h", "held"]);
        Assert.Equal(("info", "automation", "watch_claim_cap", runnerId), (root.GetProperty("level").GetString(), root.GetProperty("tag").GetString(),
          root.GetProperty("reason").GetString(), root.GetProperty("runnerId").GetString()));
        Assert.Equal((1, 1L, 2L), (root.GetProperty("cap").GetInt32(), root.GetProperty("claimed24h").GetInt64(), root.GetProperty("held").GetInt64()));
      });
    });
  }

  // ---------------------------------------------------------------- complete

  [Fact]
  public async Task Complete_Done_FinishesRunAndItem()
  {
    await InScratchAsync(AutomationMode.DryRun, async () =>
    {
      var (deckId, _) = await NewDeckAsync();
      var itemId = await NewItemAsync(deckId);
      var sub = Sub();
      var runnerId = RunnerId();
      var claimed = await ClaimOneAsync(runnerId, Ctx(sub));
      var runId = Guid.Parse(claimed.GetProperty("runId").GetString()!);

      var data = Data(await CompleteAsync(CompleteBody(runnerId, runId, "done"), Ctx(sub)));
      AssertKeys(data, CompleteKeys);
      Assert.Equal(runId, Guid.Parse(data.GetProperty("runId").GetString()!));
      Assert.Equal("completed", data.GetProperty("runStatus").GetString());
      Assert.Equal("done", data.GetProperty("itemStatus").GetString());
      Assert.Equal(0, data.GetProperty("decisions").GetProperty("total").GetInt64());
      Assert.Equal(0, data.GetProperty("decisions").GetProperty("pending").GetInt64());
      Assert.False(data.GetProperty("replayed").GetBoolean());

      var run = Assert.Single(await QueryAsync(
        "select status, outcome, completed_at, exit_code, duration_ms, num_turns, error, summary from automation_runs where run_id = $1", runId));
      Assert.Equal("completed", run["status"]);
      Assert.Equal("done", run["outcome"]);
      Assert.NotNull(run["completed_at"]);
      Assert.Equal(0, run["exit_code"]);
      Assert.Equal(4321, run["duration_ms"]);
      Assert.Equal(7, run["num_turns"]);
      Assert.Null(run["error"]);
      Assert.Equal("synthetic summary: done", run["summary"]);

      var item = Assert.Single(await QueryAsync(
        "select status, lease_expires_at, finished_at, claimed_by_runner, claimed_at from authoring_queue_items where id = $1", itemId));
      Assert.Equal("done", item["status"]);
      Assert.Null(item["lease_expires_at"]);
      Assert.NotNull(item["finished_at"]);
      Assert.Equal(runnerId, item["claimed_by_runner"]);
      Assert.NotNull(item["claimed_at"]);

      var runner = Assert.Single(await QueryAsync(
        "select last_run_id, last_run_at, last_run_outcome, last_error from automation_runners where runner_id = $1", runnerId));
      Assert.Equal(runId, runner["last_run_id"]);
      Assert.NotNull(runner["last_run_at"]);
      Assert.Equal("done", runner["last_run_outcome"]);
      Assert.Null(runner["last_error"]);

      // nothing_new also finishes the item.
      var other = await NewItemAsync(deckId);
      var claimed2 = await ClaimOneAsync(runnerId, Ctx(sub));
      Assert.Equal(other, claimed2.GetProperty("itemId").GetInt64());
      var data2 = Data(await CompleteAsync(CompleteBody(runnerId, Guid.Parse(claimed2.GetProperty("runId").GetString()!), "nothing_new"), Ctx(sub)));
      Assert.Equal("completed", data2.GetProperty("runStatus").GetString());
      Assert.Equal("done", data2.GetProperty("itemStatus").GetString());
    });
  }

  [Fact]
  public async Task Complete_Failed_RequeuesWithBackoff()
  {
    await InScratchAsync(AutomationMode.DryRun, async () =>
    {
      var (deckId, _) = await NewDeckAsync();
      var itemId = await NewItemAsync(deckId);
      var sub = Sub();
      var runnerId = RunnerId();
      var runId = Guid.Parse((await ClaimOneAsync(runnerId, Ctx(sub))).GetProperty("runId").GetString()!);

      var data = Data(await CompleteAsync(CompleteBody(runnerId, runId, "failed", "synthetic failure"), Ctx(sub)));
      Assert.Equal("failed", data.GetProperty("runStatus").GetString());
      Assert.Equal("queued", data.GetProperty("itemStatus").GetString());

      var item = Assert.Single(await QueryAsync(
        """
        select status, attempts, lease_expires_at, finished_at, last_error, claimed_by_runner,
          extract(epoch from (not_before - now()))::float8 as wait_seconds
        from authoring_queue_items where id = $1
        """, itemId));
      Assert.Equal("queued", item["status"]);
      Assert.Equal(1, item["attempts"]);
      Assert.Null(item["lease_expires_at"]);
      Assert.Null(item["finished_at"]);
      Assert.Equal("synthetic failure", item["last_error"]);
      Assert.Equal(runnerId, item["claimed_by_runner"]);
      Assert.InRange((double)item["wait_seconds"]!, 60 * 60 - 120, 60 * 60 + 5);

      var run = Assert.Single(await QueryAsync("select status, outcome, error, exit_code from automation_runs where run_id = $1", runId));
      Assert.Equal("failed", run["status"]);
      Assert.Equal("failed", run["outcome"]);
      Assert.Equal("synthetic failure", run["error"]);
      Assert.Equal(1, run["exit_code"]);
      var runner = Assert.Single(await QueryAsync("select last_run_outcome, last_error from automation_runners where runner_id = $1", runnerId));
      Assert.Equal("failed", runner["last_run_outcome"]);
      Assert.Equal("synthetic failure", runner["last_error"]);

      // Not due during the backoff.
      Assert.Empty(Data(await ClaimAsync(new { runnerId }, Ctx(sub))).GetProperty("items").EnumerateArray());
    });
  }

  [Fact]
  public async Task Complete_ThirdFailure_MarksItemFailed()
  {
    await InScratchAsync(AutomationMode.DryRun, async () =>
    {
      var (deckId, _) = await NewDeckAsync();
      var itemId = await NewItemAsync(deckId);
      var sub = Sub();
      var runnerId = RunnerId();

      for (var attempt = 1; attempt <= RunnerRoutes.MaxItemAttempts; attempt++)
      {
        var claimed = await ClaimOneAsync(runnerId, Ctx(sub));
        Assert.Equal(itemId, claimed.GetProperty("itemId").GetInt64());
        Assert.Equal(attempt, claimed.GetProperty("attempts").GetInt32());
        var runId = Guid.Parse(claimed.GetProperty("runId").GetString()!);

        var data = Data(await CompleteAsync(CompleteBody(runnerId, runId, "failed", $"synthetic failure {attempt}"), Ctx(sub)));
        Assert.Equal("failed", data.GetProperty("runStatus").GetString());
        if (attempt < RunnerRoutes.MaxItemAttempts)
        {
          Assert.Equal("queued", data.GetProperty("itemStatus").GetString());
          var wait = (double)(await ScalarAsync("select extract(epoch from (not_before - now()))::float8 from authoring_queue_items where id = $1", itemId))!;
          Assert.InRange(wait, attempt * 3600 - 120, attempt * 3600 + 5);
          await ExecAsync("update authoring_queue_items set not_before = now() - interval '1 second' where id = $1", itemId);
        }
        else
        {
          Assert.Equal("failed", data.GetProperty("itemStatus").GetString());
        }
      }

      var item = Assert.Single(await QueryAsync(
        "select status, attempts, lease_expires_at, finished_at, last_error from authoring_queue_items where id = $1", itemId));
      Assert.Equal("failed", item["status"]);
      Assert.Equal(3, item["attempts"]);
      Assert.Null(item["lease_expires_at"]);
      Assert.NotNull(item["finished_at"]);
      Assert.Equal("synthetic failure 3", item["last_error"]);
      Assert.Equal(3L, Long(await ScalarAsync("select count(*) from automation_runs where queue_item_id = $1 and status = 'failed'", itemId)));
    });
  }

  [Fact]
  public async Task Complete_SameOutcomeTwice_Replays()
  {
    await InScratchAsync(AutomationMode.DryRun, async () =>
    {
      var (deckId, _) = await NewDeckAsync();
      var itemId = await NewItemAsync(deckId);
      var sub = Sub();
      var runnerId = RunnerId();
      var runId = Guid.Parse((await ClaimOneAsync(runnerId, Ctx(sub))).GetProperty("runId").GetString()!);

      Assert.False(Data(await CompleteAsync(CompleteBody(runnerId, runId, "done"), Ctx(sub))).GetProperty("replayed").GetBoolean());
      var completedAt = await ScalarAsync("select completed_at from automation_runs where run_id = $1", runId);
      var finishedAt = await ScalarAsync("select finished_at from authoring_queue_items where id = $1", itemId);

      var replay = Data(await CompleteAsync(CompleteBody(runnerId, runId, "done"), Ctx(sub)));
      AssertKeys(replay, CompleteKeys);
      Assert.True(replay.GetProperty("replayed").GetBoolean());
      Assert.Equal("completed", replay.GetProperty("runStatus").GetString());
      Assert.Equal("done", replay.GetProperty("itemStatus").GetString());
      Assert.Equal(completedAt, await ScalarAsync("select completed_at from automation_runs where run_id = $1", runId));
      Assert.Equal(finishedAt, await ScalarAsync("select finished_at from authoring_queue_items where id = $1", itemId));
    });
  }

  [Fact]
  public async Task Complete_DifferentOutcome_Returns409RunNotRunning()
  {
    await InScratchAsync(AutomationMode.DryRun, async () =>
    {
      var (deckId, _) = await NewDeckAsync();
      await NewItemAsync(deckId);
      var sub = Sub();
      var runnerId = RunnerId();
      var runId = Guid.Parse((await ClaimOneAsync(runnerId, Ctx(sub))).GetProperty("runId").GetString()!);

      Data(await CompleteAsync(CompleteBody(runnerId, runId, "nothing_new"), Ctx(sub)));
      AssertError(await CompleteAsync(CompleteBody(runnerId, runId, "failed", "late failure"), Ctx(sub)), 409, "RUN_NOT_RUNNING");
      AssertError(await CompleteAsync(CompleteBody(runnerId, runId, "done"), Ctx(sub)), 409, "RUN_NOT_RUNNING");
      Assert.Equal("nothing_new", await ScalarAsync("select outcome from automation_runs where run_id = $1", runId));
    });
  }

  [Fact]
  public async Task Complete_UnknownRun_Returns404RunNotFound()
  {
    await InScratchAsync(AutomationMode.DryRun, async () =>
    {
      AssertError(await CompleteAsync(CompleteBody(RunnerId(), Guid.NewGuid(), "done"), Ctx(Sub())), 404, "RUN_NOT_FOUND");
    });
  }

  [Fact]
  public async Task Complete_OtherRunner_Returns403RunnerMismatch()
  {
    await InScratchAsync(AutomationMode.DryRun, async () =>
    {
      var (deckId, _) = await NewDeckAsync();
      var itemId = await NewItemAsync(deckId);
      var sub = Sub();
      var runnerId = RunnerId();
      var runId = Guid.Parse((await ClaimOneAsync(runnerId, Ctx(sub))).GetProperty("runId").GetString()!);

      AssertError(await CompleteAsync(CompleteBody(RunnerId(), runId, "done"), Ctx(sub)), 403, "RUNNER_MISMATCH");
      Assert.Equal("running", await ScalarAsync("select status from automation_runs where run_id = $1", runId));
      Assert.Equal("claimed", await ScalarAsync("select status from authoring_queue_items where id = $1", itemId));
    });
  }

  [Fact]
  public async Task Complete_AfterLeaseRequeue_LeavesTheItemAlone()
  {
    await InScratchAsync(AutomationMode.DryRun, async () =>
    {
      var (deckId, _) = await NewDeckAsync();
      var itemId = await NewItemAsync(deckId);
      var sub = Sub();
      var runnerId = RunnerId();
      var runId = Guid.Parse((await ClaimOneAsync(runnerId, Ctx(sub))).GetProperty("runId").GetString()!);

      // A lease expiry requeued the item (A04's tick does this); the late report still completes the run.
      await ExecAsync("update authoring_queue_items set status = 'queued', lease_expires_at = null, not_before = now() + interval '1 hour' where id = $1", itemId);
      var data = Data(await CompleteAsync(CompleteBody(runnerId, runId, "done"), Ctx(sub)));
      Assert.Equal("completed", data.GetProperty("runStatus").GetString());
      Assert.Equal("queued", data.GetProperty("itemStatus").GetString());
      Assert.Equal("queued", await ScalarAsync("select status from authoring_queue_items where id = $1", itemId));
    });
  }

  // ---------------------------------------------------------------- schema not ready

  [Fact]
  public async Task RunnerRoutes_MissingTables_Return503ServerNotReadyAutomation()
  {
    var cs = await _db.CreateScratchDatabaseAsync(NotReadyName);
    await using (var conn = new NpgsqlConnection(cs))
    {
      await conn.OpenAsync();
      await PostgresFixture.ApplyMigrationsAsync(conn, 33);
    }

    await InScratchAsync(AutomationMode.DryRun, async () =>
    {
      var auth = Ctx(Sub());
      var runnerId = RunnerId();
      AssertError(await HeartbeatAsync(HeartbeatBody(runnerId), auth), 503, "SERVER_NOT_READY_AUTOMATION");
      AssertError(await ClaimAsync(new { runnerId }, auth), 503, "SERVER_NOT_READY_AUTOMATION");
      AssertError(await CompleteAsync(CompleteBody(runnerId, Guid.NewGuid(), "done"), auth), 503, "SERVER_NOT_READY_AUTOMATION");
    }, NotReadyName);
  }

  // ---------------------------------------------------------------- through VpcFunction

  [Fact]
  public async Task AgentToken_ReachesTheRunnerRoutesThroughVpcFunction()
  {
    const string kid = "cognito-kid-a02";
    const string spaClient = "spa-client-a02";
    const string agentClient = "agent-client-a02";
    using var key = TestJwt.NewKey();
    var sub = Sub();

    string Token(string clientId)
    {
      var payload = TestJwt.Payload(issuer: TestJwt.ConsoleIssuer, sub: sub, groups: ["super_admin"]);
      payload["client_id"] = clientId;
      return TestJwt.Sign(key, kid, payload);
    }

    static string? ErrorCode(APIGatewayProxyResponse response)
    {
      using var doc = JsonDocument.Parse(response.Body!);
      return doc.RootElement.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.Object
        ? error.GetProperty("code").GetString()
        : null;
    }

    await InScratchAsync(AutomationMode.DryRun, async () =>
    {
      try
      {
        Auth.Configure(
          AuthOptions.Parse(null, null, "production", null, $"{spaClient},{agentClient}", agentClient),
          new StubJwks(TestJwt.Jwks((kid, key))));

        var agent = Token(agentClient);
        var runnerId = RunnerId();
        foreach (var path in new[] { HeartbeatPath, "/prod" + HeartbeatPath })
        {
          var response = await new VpcFunction().Handler(Event("POST", path, JsonSerializer.Serialize(HeartbeatBody(runnerId)), agent));
          Assert.True(response.StatusCode == 200, response.Body);
          Assert.NotEqual(AgentClientPolicy.ErrorCode, ErrorCode(response));
        }
        Assert.Equal(sub, await ScalarAsync("select owner_sub from automation_runners where runner_id = $1", runnerId));

        var claim = await new VpcFunction().Handler(Event("POST", ClaimPath, JsonSerializer.Serialize(new { runnerId }), agent));
        Assert.Equal(200, claim.StatusCode);
        var complete = await new VpcFunction().Handler(Event("POST", CompletePath, JsonSerializer.Serialize(CompleteBody(runnerId, Guid.NewGuid(), "done")), agent));
        Assert.Equal(404, complete.StatusCode);
        Assert.Equal("RUN_NOT_FOUND", ErrorCode(complete));

        // The agent token stays off the console's queue routes.
        var queue = await new VpcFunction().Handler(Event("POST", "/api/v1/admin/automation/queue",
          JsonSerializer.Serialize(new { url = "https://docs.example.com/a02/queue", deckId = 1 }), agent));
        Assert.Equal(403, queue.StatusCode);
        Assert.Equal(AgentClientPolicy.ErrorCode, ErrorCode(queue));

        // The SPA token of the same pool and groups is not a runner.
        var spa = await new VpcFunction().Handler(Event("POST", HeartbeatPath, JsonSerializer.Serialize(HeartbeatBody(RunnerId())), Token(spaClient)));
        Assert.Equal(403, spa.StatusCode);
        Assert.Equal(RunnerRoutes.RunnerClientRequired, ErrorCode(spa));
      }
      finally
      {
        Auth.ResetToEnvironment();
      }
    });
  }
}
