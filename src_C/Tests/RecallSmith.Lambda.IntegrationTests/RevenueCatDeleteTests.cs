using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Automation;
using RecallSmith.Lambda.Vpc.Runtime;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// R25X F04: core-vpc has no egress, so it never calls RevenueCat. DELETE /api/v1/user/me queues the caller's sub in
/// revenuecat_deletions (migration 044) inside the deletion's own transaction; the notifier reads the queue through
/// GET /api/v1/internal/revenuecat-deletions and reports each RevenueCat status through
/// POST /api/v1/internal/revenuecat-deletions/report (both HMAC-signed with INTERNAL_SECRET_NOTIFIER); the tick's
/// retention step drops rows older than 30 days. Real Postgres; no network.
/// </summary>
/// <remarks>
/// In the postgres collection because these tests redirect Console, set process-wide env vars and read the whole queue
/// table; that collection runs serially.
/// </remarks>
[Collection(PostgresCollection.Name)]
public class RevenueCatDeleteTests
{
  private const string Secret = "test-secret-revenuecat-queue-0000000001";

  private readonly PostgresFixture _db;
  public RevenueCatDeleteTests(PostgresFixture db) => _db = db;

  // A sub with characters that must be escaped in a path segment.
  private static string NewSub() => $"it-f04 {Guid.NewGuid():N}/x";

  // ---------------------------------------------------------------- helpers

  private static JsonElement DeleteMeEvent(string sub) =>
    JsonSerializer.SerializeToElement(new
    {
      rawPath = "/api/v1/user/me",
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method = "DELETE" },
        authorizer = new
        {
          jwt = new
          {
            claims = new Dictionary<string, object>(StringComparer.Ordinal)
            {
              ["sub"] = sub,
              ["cognito:groups"] = new string[0],
            },
          },
        },
      },
      headers = new Dictionary<string, string>(),
      body = (string?)null,
      isBase64Encoded = false,
    });

  private static string Sign(string secret, long ts, string body)
  {
    using var mac = new System.Security.Cryptography.HMACSHA256(System.Text.Encoding.UTF8.GetBytes(secret));
    var hash = mac.ComputeHash(System.Text.Encoding.UTF8.GetBytes($"{ts.ToString(CultureInfo.InvariantCulture)}.{body}"));
    return "v1=" + Convert.ToHexString(hash).ToLowerInvariant();
  }

  /// <summary>An internal request as the notifier sends it; <paramref name="secret"/> null = unsigned.</summary>
  private static LambdaRequest Internal(string method, string path, string body = "", string? secret = Secret,
    Dictionary<string, string>? query = null)
  {
    var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    var headers = new Dictionary<string, string> { ["content-type"] = "application/json" };
    if (secret is not null)
    {
      headers["x-internal-timestamp"] = ts.ToString(CultureInfo.InvariantCulture);
      headers["x-internal-signature"] = Sign(secret, ts, body);
    }
    return new LambdaRequest(JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new { requestId = Guid.NewGuid().ToString(), http = new { method } },
      headers,
      queryStringParameters = query ?? new Dictionary<string, string>(),
      body,
      isBase64Encoded = false,
    }));
  }

  private sealed record Captured<T>(T Value, string Output);

  /// <summary>Runs <paramref name="body"/> with INTERNAL_SECRET_NOTIFIER set and stdout/stderr captured.</summary>
  private static async Task<Captured<T>> WithEnvAsync<T>(Func<Task<T>> body, string? secret = Secret)
  {
    var saved = Environment.GetEnvironmentVariable(AutomationEnv.NotifierSecretEnv);
    var oldOut = Console.Out;
    var oldErr = Console.Error;
    var stdout = new StringWriter();
    var stderr = new StringWriter();
    Environment.SetEnvironmentVariable(AutomationEnv.NotifierSecretEnv, secret);
    Console.SetOut(stdout);
    Console.SetError(stderr);
    try
    {
      var value = await body();
      return new Captured<T>(value, stdout.ToString() + stderr.ToString());
    }
    finally
    {
      Console.SetOut(oldOut);
      Console.SetError(oldErr);
      Environment.SetEnvironmentVariable(AutomationEnv.NotifierSecretEnv, saved);
    }
  }

  private static Task<APIGatewayProxyResponse> PendingAsync(LambdaRequest req) =>
    RevenueCatDeletions.HandlePending(req, new Res(req.TraceId));

  private static Task<APIGatewayProxyResponse> ReportAsync(LambdaRequest req) =>
    RevenueCatDeletions.HandleReport(req, new Res(req.TraceId));

  private static JsonElement Data(APIGatewayProxyResponse response)
  {
    using var doc = JsonDocument.Parse(response.Body!);
    return doc.RootElement.GetProperty("data").Clone();
  }

  private static string[] Subs(APIGatewayProxyResponse response) =>
    Data(response).GetProperty("subs").EnumerateArray().Select(e => e.GetString()!).ToArray();

  private async Task ClearQueueAsync()
  {
    await using var conn = await _db.OpenAsync();
    await DbUtil.ExecuteAsync(conn, null, "delete from revenuecat_deletions", []);
  }

  /// <summary>Inserts a queue row directly; <paramref name="ageDays"/> back-dates requested_at.</summary>
  private async Task SeedAsync(string sub, double ageDays = 0, int attempts = 0)
  {
    await using var conn = await _db.OpenAsync();
    await DbUtil.ExecuteAsync(conn, null,
      "insert into revenuecat_deletions (sub, requested_at, attempts) values ($1, now() - make_interval(secs => $2), $3)",
      [sub, ageDays * 86400, attempts]);
  }

  private async Task<Dictionary<string, object?>?> RowAsync(string sub)
  {
    await using var conn = await _db.OpenAsync();
    var rows = await DbUtil.QueryAsync(conn, null, "select * from revenuecat_deletions where sub = $1", [sub]);
    return rows.SingleOrDefault();
  }

  private async Task<long> UserRowsAsync(string sub)
  {
    await using var conn = await _db.OpenAsync();
    return Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null, "select count(*) from users where user_sub = $1", [sub]));
  }

  private static void AssertNoSub(string output, string sub)
  {
    Assert.DoesNotContain(sub, output, StringComparison.Ordinal);
    Assert.DoesNotContain(Uri.EscapeDataString(sub), output, StringComparison.Ordinal);
  }

  // ---------------------------------------------------------------- DELETE me queues the sub

  [Fact]
  public async Task RevenueCatDelete_DeleteMe_QueuesTheSubAndMakesNoOutboundCall()
  {
    var sub = NewSub();
    await using (var conn = await _db.OpenAsync())
    {
      await DbUtil.ExecuteAsync(conn, null, "insert into users (user_sub) values ($1)", [sub]);
    }

    var run = await WithEnvAsync(async () =>
    {
      var req = new LambdaRequest(DeleteMeEvent(sub));
      var res = new Res(req.TraceId);
      return await AccountDeletion.HandleDeleteMe(req, res, await Auth.GetAuthContextAsync(req));
    });

    Assert.Equal(204, run.Value.StatusCode);
    Assert.Equal(0, await UserRowsAsync(sub));
    var row = Assert.IsType<Dictionary<string, object?>>(await RowAsync(sub));
    Assert.Equal(0, Convert.ToInt32(row["attempts"], CultureInfo.InvariantCulture));
    Assert.Null(row["last_status"]);
    Assert.Null(row["last_attempt_at"]);

    var line = run.Output.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
      .Where(l => l.StartsWith('{')).Select(l => JsonDocument.Parse(l).RootElement)
      .Single(e => e.TryGetProperty("tag", out var t) && t.GetString() == "account-delete");
    Assert.Equal(1, line.GetProperty("revenueCatQueued").GetInt32());
    // core-vpc never calls RevenueCat any more: no revenuecat_delete call line, and the sub never reaches the log.
    Assert.DoesNotContain("\"tag\":\"revenuecat_delete\"", run.Output, StringComparison.Ordinal);
    AssertNoSub(run.Output, sub);
  }

  [Fact]
  public async Task RevenueCatDelete_SecondDeletion_KeepsTheExistingQueueRow()
  {
    var sub = NewSub();
    await SeedAsync(sub, ageDays: 1, attempts: 3);

    await using var conn = await _db.OpenAsync();
    var r = await AccountDeletion.DeleteUserDataAsync(conn, sub);

    Assert.Equal(0, r.RevenueCatQueued);
    var row = Assert.IsType<Dictionary<string, object?>>(await RowAsync(sub));
    Assert.Equal(3, Convert.ToInt32(row["attempts"], CultureInfo.InvariantCulture));
  }

  /// <summary>
  /// v-tests-2: the queue row is written in the deletion's transaction. A deletion that fails at the users delete (a
  /// trigger raises for this one sub) rolls back: the user stays and nothing is queued, so RevenueCat is never told to
  /// delete the customer of an account that still exists.
  /// </summary>
  [Fact]
  public async Task RevenueCatDelete_RolledBackDeletion_QueuesNothing()
  {
    var sub = NewSub();
    var fn = $"it_f04_fail_{Guid.NewGuid():N}";
    await using var conn = await _db.OpenAsync();
    await DbUtil.ExecuteAsync(conn, null, "insert into users (user_sub) values ($1)", [sub]);
    await DbUtil.ExecuteAsync(conn, null,
      $"""
      create function {fn}() returns trigger language plpgsql as $$
      begin
        if old.user_sub = '{sub.Replace("'", "''", StringComparison.Ordinal)}' then raise exception 'it-f04 forced failure'; end if;
        return old;
      end $$;
      create trigger {fn} before delete on users for each row execute function {fn}();
      """, []);
    try
    {
      await Assert.ThrowsAnyAsync<Npgsql.PostgresException>(() => AccountDeletion.DeleteUserDataAsync(conn, sub));
    }
    finally
    {
      await DbUtil.ExecuteAsync(conn, null, $"drop trigger if exists {fn} on users; drop function if exists {fn}();", []);
    }

    Assert.Equal(1, await UserRowsAsync(sub));
    Assert.Null(await RowAsync(sub));
  }

  // ---------------------------------------------------------------- GET pending

  [Fact]
  public async Task RevenueCatDelete_Pending_RequiresTheNotifierSignature()
  {
    await ClearQueueAsync();
    await SeedAsync(NewSub());

    var unsigned = await WithEnvAsync(() => PendingAsync(Internal("GET", RevenueCatDeletions.PendingPath, secret: null)));
    Assert.Equal(403, unsigned.Value.StatusCode);
    var wrong = await WithEnvAsync(() => PendingAsync(Internal("GET", RevenueCatDeletions.PendingPath, secret: "x" + Secret)));
    Assert.Equal(403, wrong.Value.StatusCode);
    // Strict: the route's own secret is mandatory; with it unset nothing verifies, not even the shared secret.
    var unset = await WithEnvAsync(() => PendingAsync(Internal("GET", RevenueCatDeletions.PendingPath)), secret: null);
    Assert.Equal(403, unset.Value.StatusCode);
    Assert.Contains("Missing INTERNAL_SECRET_NOTIFIER", unset.Value.Body, StringComparison.Ordinal);
    var post = await WithEnvAsync(() => PendingAsync(Internal("POST", RevenueCatDeletions.PendingPath)));
    Assert.Equal(405, post.Value.StatusCode);

    var ok = await WithEnvAsync(() => PendingAsync(Internal("GET", RevenueCatDeletions.PendingPath)));
    Assert.Equal(200, ok.Value.StatusCode);
    Assert.Single(Subs(ok.Value));
  }

  [Fact]
  public async Task RevenueCatDelete_Pending_OldestFirst_SkipsExhaustedAndExpired_HonoursLimit()
  {
    await ClearQueueAsync();
    var oldest = NewSub();
    var middle = NewSub();
    var newest = NewSub();
    var exhausted = NewSub();
    var expired = NewSub();
    await SeedAsync(oldest, ageDays: 3);
    await SeedAsync(middle, ageDays: 2, attempts: RevenueCatDeletions.MaxAttempts - 1);
    await SeedAsync(newest, ageDays: 1);
    await SeedAsync(exhausted, ageDays: 1, attempts: RevenueCatDeletions.MaxAttempts);
    await SeedAsync(expired, ageDays: RevenueCatDeletions.RetentionDays + 1);

    var all = await WithEnvAsync(() => PendingAsync(Internal("GET", RevenueCatDeletions.PendingPath)));
    Assert.Equal(200, all.Value.StatusCode);
    Assert.Equal([oldest, middle, newest], Subs(all.Value));
    AssertNoSub(all.Output, oldest);

    var two = await WithEnvAsync(() => PendingAsync(Internal("GET", RevenueCatDeletions.PendingPath,
      query: new Dictionary<string, string> { ["limit"] = "2" })));
    Assert.Equal([oldest, middle], Subs(two.Value));

    var big = await WithEnvAsync(() => PendingAsync(Internal("GET", RevenueCatDeletions.PendingPath,
      query: new Dictionary<string, string> { ["limit"] = "500" })));
    Assert.Equal(3, Subs(big.Value).Length);

    foreach (var bad in new[] { "0", "-1", "abc" })
    {
      var r = await WithEnvAsync(() => PendingAsync(Internal("GET", RevenueCatDeletions.PendingPath,
        query: new Dictionary<string, string> { ["limit"] = bad })));
      Assert.Equal(400, r.Value.StatusCode);
    }
  }

  [Fact]
  public async Task RevenueCatDelete_Pending_DefaultLimitIs50()
  {
    await ClearQueueAsync();
    for (var i = 0; i < 55; i++) await SeedAsync(NewSub());

    var r = await WithEnvAsync(() => PendingAsync(Internal("GET", RevenueCatDeletions.PendingPath)));
    Assert.Equal(50, Subs(r.Value).Length);
  }

  // ---------------------------------------------------------------- POST report

  [Fact]
  public async Task RevenueCatDelete_Report_RequiresTheNotifierSignature()
  {
    var sub = NewSub();
    await SeedAsync(sub);
    var body = JsonSerializer.Serialize(new[] { new { sub, status = 204 } });

    var unsigned = await WithEnvAsync(() => ReportAsync(Internal("POST", RevenueCatDeletions.ReportPath, body, secret: null)));
    Assert.Equal(403, unsigned.Value.StatusCode);
    var wrong = await WithEnvAsync(() => ReportAsync(Internal("POST", RevenueCatDeletions.ReportPath, body, secret: "x" + Secret)));
    Assert.Equal(403, wrong.Value.StatusCode);
    var get = await WithEnvAsync(() => ReportAsync(Internal("GET", RevenueCatDeletions.ReportPath, body)));
    Assert.Equal(405, get.Value.StatusCode);
    Assert.NotNull(await RowAsync(sub));
  }

  [Fact]
  public async Task RevenueCatDelete_Report_2xxAnd404Delete_OthersCountAnAttempt()
  {
    var deleted = NewSub();
    var noContent = NewSub();
    var notFound = NewSub();
    var serverError = NewSub();
    var timedOut = NewSub();
    var unauthorized = NewSub();
    foreach (var s in new[] { deleted, noContent, notFound, serverError, timedOut, unauthorized }) await SeedAsync(s);
    await using (var conn = await _db.OpenAsync())
    {
      await DbUtil.ExecuteAsync(conn, null, "update revenuecat_deletions set attempts = 2 where sub = $1", [serverError]);
    }

    var body = JsonSerializer.Serialize(new object[]
    {
      new { sub = deleted, status = 200 },
      new { sub = noContent, status = 204 },
      new { sub = notFound, status = 404 },
      new { sub = serverError, status = 503 },
      new { sub = timedOut, status = (int?)null },
      new { sub = unauthorized, status = 401 },
      new { sub = NewSub(), status = 500 },
    });
    var run = await WithEnvAsync(() => ReportAsync(Internal("POST", RevenueCatDeletions.ReportPath, body)));

    Assert.Equal(200, run.Value.StatusCode);
    var data = Data(run.Value);
    Assert.Equal(3, data.GetProperty("deleted").GetInt32());
    Assert.Equal(3, data.GetProperty("retried").GetInt32());
    Assert.Equal(1, data.GetProperty("unknown").GetInt32());

    Assert.Null(await RowAsync(deleted));
    Assert.Null(await RowAsync(noContent));
    Assert.Null(await RowAsync(notFound));

    var se = (await RowAsync(serverError))!;
    Assert.Equal(3, Convert.ToInt32(se["attempts"], CultureInfo.InvariantCulture));
    Assert.Equal(503, Convert.ToInt32(se["last_status"], CultureInfo.InvariantCulture));
    Assert.NotNull(se["last_attempt_at"]);

    var to = (await RowAsync(timedOut))!;
    Assert.Equal(1, Convert.ToInt32(to["attempts"], CultureInfo.InvariantCulture));
    Assert.Null(to["last_status"]);
    Assert.NotNull(to["last_attempt_at"]);

    var ua = (await RowAsync(unauthorized))!;
    Assert.Equal(401, Convert.ToInt32(ua["last_status"], CultureInfo.InvariantCulture));

    // Counts only: never a sub in core's log.
    foreach (var s in new[] { deleted, serverError, timedOut }) AssertNoSub(run.Output, s);
  }

  [Theory]
  [InlineData("")]
  [InlineData("{}")]
  [InlineData("{\"sub\":\"a\",\"status\":204}")]
  [InlineData("[1]")]
  [InlineData("[{\"status\":204}]")]
  [InlineData("[{\"sub\":\"\",\"status\":204}]")]
  [InlineData("[{\"sub\":\"a\",\"status\":\"204\"}]")]
  [InlineData("[{\"sub\":\"a\",\"status\":99}]")]
  public async Task RevenueCatDelete_Report_RejectsABadBody(string body)
  {
    var run = await WithEnvAsync(() => ReportAsync(Internal("POST", RevenueCatDeletions.ReportPath, body)));
    Assert.Equal(400, run.Value.StatusCode);
  }

  [Fact]
  public async Task RevenueCatDelete_Report_RejectsMoreThan50Items()
  {
    var body = JsonSerializer.Serialize(Enumerable.Range(0, 51).Select(i => new { sub = $"s{i}", status = 204 }));
    var run = await WithEnvAsync(() => ReportAsync(Internal("POST", RevenueCatDeletions.ReportPath, body)));
    Assert.Equal(400, run.Value.StatusCode);
  }

  // ---------------------------------------------------------------- 30-day retention

  [Fact]
  public async Task RevenueCatDelete_Retention_DropsRowsOlderThan30Days()
  {
    await ClearQueueAsync();
    var fresh = NewSub();
    var exhausted = NewSub();
    var old = NewSub();
    var oldExhausted = NewSub();
    await SeedAsync(fresh, ageDays: RevenueCatDeletions.RetentionDays - 1);
    await SeedAsync(exhausted, ageDays: 1, attempts: RevenueCatDeletions.MaxAttempts);
    await SeedAsync(old, ageDays: RevenueCatDeletions.RetentionDays + 0.1);
    await SeedAsync(oldExhausted, ageDays: RevenueCatDeletions.RetentionDays + 5, attempts: RevenueCatDeletions.MaxAttempts);

    await using var conn = await _db.OpenAsync();
    var run = await WithEnvAsync(() => RevenueCatDeletions.DeleteExpiredAsync(conn));

    Assert.Equal(2, run.Value);
    Assert.NotNull(await RowAsync(fresh));
    Assert.NotNull(await RowAsync(exhausted));
    Assert.Null(await RowAsync(old));
    Assert.Null(await RowAsync(oldExhausted));
    AssertNoSub(run.Output, old);
  }

  [Fact]
  public void RevenueCatDelete_RetentionIsATickStep()
  {
    var source = File.ReadAllText(Path.Combine(SrcC(), "Vpc", "Automation", "AutomationTick.cs"));
    Assert.Contains("Step(\"revenuecat_deletions_retention\", () => Runtime.RevenueCatDeletions.DeleteExpiredAsync(conn))", source,
      StringComparison.Ordinal);
  }

  [Fact]
  public void RevenueCatDelete_Constants()
  {
    Assert.Equal("/api/v1/internal/revenuecat-deletions", RevenueCatDeletions.PendingPath);
    Assert.Equal("/api/v1/internal/revenuecat-deletions/report", RevenueCatDeletions.ReportPath);
    Assert.Equal(10, RevenueCatDeletions.MaxAttempts);
    Assert.Equal(30, RevenueCatDeletions.RetentionDays);
    Assert.Equal(50, RevenueCatDeletions.DefaultLimit);
    Assert.Equal("/api/v1/internal/revenuecat-deletions", RouteMetrics.RouteFor(RevenueCatDeletions.PendingPath));
    Assert.Equal("/api/v1/internal/revenuecat-deletions/report", RouteMetrics.RouteFor(RevenueCatDeletions.ReportPath));
  }

  // ---------------------------------------------------------------- deploy.sh: the key never reaches core-vpc

  private static string SrcC()
  {
    var dir = new DirectoryInfo(AppContext.BaseDirectory);
    while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "src_C", "deploy.sh"))) dir = dir.Parent;
    return Path.Combine(dir?.FullName ?? throw new DirectoryNotFoundException("src_C/deploy.sh not found"), "src_C");
  }

  /// <summary>
  /// x-deploy-1 / v-security-3: the leaf is the notifier's. deploy.sh's skip/optional lines, evaluated on top of
  /// merge-env.sh exactly as deploy.sh sources them: the leaf present under the path is skipped (no error, no env var),
  /// and a stale REVENUECAT_SECRET_API_KEY left on core-vpc by the R25 G04 mapping is removed.
  /// </summary>
  [Fact]
  public void RevenueCatDelete_DeployNeverGivesCoreVpcTheKey_AndRemovesAStaleCopy()
  {
    const string script = """
      set -euo pipefail
      source scripts/merge-env.sh
      eval "$(grep -E '^SSM_(TO|NOT|OPTIONAL)_ENV=' deploy.sh)"
      secrets="$(ssm_to_env '{"Parameters":[{"Name":"/developercards/prod/revenuecat-secret-api-key","Value":"sk_test_fake"},{"Name":"/developercards/prod/pg-password","Value":"p"}]}')"
      echo "$secrets"
      keys="$(jq -c 'to_entries | map(.value)' <<<"$SSM_TO_ENV")"
      drop_absent_optional '{"REVENUECAT_SECRET_API_KEY":"stale","KEEP":"1"}' "$(pick_keys "$secrets" "$keys")"
      """;
    var psi = new System.Diagnostics.ProcessStartInfo("bash")
    {
      WorkingDirectory = SrcC(),
      RedirectStandardInput = true,
      RedirectStandardOutput = true,
      RedirectStandardError = true,
    };
    using var p = System.Diagnostics.Process.Start(psi)!;
    p.StandardInput.Write(script);
    p.StandardInput.Close();
    var stdout = p.StandardOutput.ReadToEnd();
    var stderr = p.StandardError.ReadToEnd();
    p.WaitForExit();

    Assert.True(p.ExitCode == 0, stderr);
    var lines = stdout.Split('\n', StringSplitOptions.RemoveEmptyEntries);
    Assert.Equal(2, lines.Length);
    Assert.Equal("""{"PGPASSWORD":"p"}""", lines[0]);
    Assert.Equal("""{"KEEP":"1"}""", lines[1]);
    Assert.DoesNotContain("sk_test_fake", stdout + stderr, StringComparison.Ordinal);

    var deploy = File.ReadAllText(Path.Combine(SrcC(), "deploy.sh"));
    Assert.DoesNotContain("\"REVENUECAT_SECRET_API_KEY\"}", deploy, StringComparison.Ordinal);
  }
}
