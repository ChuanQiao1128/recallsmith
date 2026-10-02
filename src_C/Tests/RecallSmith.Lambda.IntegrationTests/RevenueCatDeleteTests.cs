using System.Net;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Runtime;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// R25 G04: after DELETE /api/v1/user/me commits, the server deletes the caller's RevenueCat
/// customer record (DELETE /v1/subscribers/{sub}) with REVENUECAT_SECRET_API_KEY. Driven through
/// <see cref="AccountDeletion.HandleDeleteMe"/> against a real Postgres, with a fake
/// HttpMessageHandler standing in for RevenueCat. The user's deletion succeeds whatever RevenueCat
/// answers, and the revenuecat_delete log line never carries the key, the sub or a response body.
/// </summary>
/// <remarks>
/// In the postgres collection because these tests redirect Console and swap the process-wide
/// handler and env vars; that collection runs serially.
/// </remarks>
[Collection(PostgresCollection.Name)]
public class RevenueCatDeleteTests
{
  private const string FakeKey = "sk_test_fake_revenuecat_key";
  private const string FakeBase = "https://revenuecat.fake.test";

  private readonly PostgresFixture _db;
  public RevenueCatDeleteTests(PostgresFixture db) => _db = db;

  // A sub with characters that must be escaped in a path segment.
  private static string NewSub() => $"it-g04 {Guid.NewGuid():N}/x";

  /// <summary>Answers each request from a queue of steps; a null step hangs until cancelled.</summary>
  private sealed class FakeRevenueCat : HttpMessageHandler
  {
    private readonly Queue<HttpStatusCode?> _steps;
    public List<(HttpMethod Method, string Url, string? Auth)> Requests { get; } = [];

    public FakeRevenueCat(params HttpStatusCode?[] steps) => _steps = new Queue<HttpStatusCode?>(steps);

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
      Requests.Add((request.Method, request.RequestUri!.AbsoluteUri, request.Headers.Authorization?.ToString()));
      var step = _steps.Count > 0 ? _steps.Dequeue() : HttpStatusCode.OK;
      if (step is null)
      {
        await Task.Delay(Timeout.Infinite, ct);
      }
      return new HttpResponseMessage(step!.Value)
      {
        Content = new StringContent("{\"secret_body\":\"never-logged\"}"),
      };
    }
  }

  private static JsonElement Event(string sub) =>
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

  private sealed record Run(APIGatewayProxyResponse Response, JsonElement[] RcLines, string AllOutput);

  /// <summary>Seeds a users row, runs DELETE me with the fake handler and env, and captures the log.</summary>
  private async Task<Run> RunAsync(string sub, FakeRevenueCat fake, string? key, TimeSpan? attemptTimeout = null)
  {
    await using (var conn = await _db.OpenAsync())
    {
      await DbUtil.ExecuteAsync(conn, null, "insert into users (user_sub) values ($1)", [sub]);
    }

    var savedKey = Environment.GetEnvironmentVariable(RevenueCatCustomerDeletion.KeyEnv);
    var savedBase = Environment.GetEnvironmentVariable(RevenueCatCustomerDeletion.BaseEnv);
    var savedTimeout = RevenueCatCustomerDeletion.AttemptTimeout;
    var oldOut = Console.Out;
    var oldErr = Console.Error;
    var stdout = new StringWriter();
    var stderr = new StringWriter();

    Environment.SetEnvironmentVariable(RevenueCatCustomerDeletion.KeyEnv, key);
    Environment.SetEnvironmentVariable(RevenueCatCustomerDeletion.BaseEnv, FakeBase);
    RevenueCatCustomerDeletion.HandlerOverride = fake;
    if (attemptTimeout is not null) RevenueCatCustomerDeletion.AttemptTimeout = attemptTimeout.Value;
    Console.SetOut(stdout);
    Console.SetError(stderr);
    APIGatewayProxyResponse resp;
    try
    {
      var req = new LambdaRequest(Event(sub));
      var res = new Res(req.TraceId);
      var auth = await Auth.GetAuthContextAsync(req);
      resp = await AccountDeletion.HandleDeleteMe(req, res, auth);
    }
    finally
    {
      Console.SetOut(oldOut);
      Console.SetError(oldErr);
      RevenueCatCustomerDeletion.HandlerOverride = null;
      RevenueCatCustomerDeletion.AttemptTimeout = savedTimeout;
      Environment.SetEnvironmentVariable(RevenueCatCustomerDeletion.KeyEnv, savedKey);
      Environment.SetEnvironmentVariable(RevenueCatCustomerDeletion.BaseEnv, savedBase);
    }

    var all = stdout.ToString() + stderr.ToString();
    var lines = all
      .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
      .Where(l => l.StartsWith('{'))
      .Select(l =>
      {
        using var doc = JsonDocument.Parse(l);
        return doc.RootElement.Clone();
      })
      .Where(e => e.TryGetProperty("tag", out var t) && t.GetString() == "revenuecat_delete")
      .ToArray();
    return new Run(resp, lines, all);
  }

  private async Task<long> UserRowsAsync(string sub)
  {
    await using var conn = await _db.OpenAsync();
    return Convert.ToInt64(await DbUtil.ExecuteScalarAsync(conn, null, "select count(*) from users where user_sub = $1", [sub]));
  }

  private static void AssertSucceeded(Run run) => Assert.Equal(204, run.Response.StatusCode);

  private static JsonElement SingleLine(Run run) => Assert.Single(run.RcLines);

  private static void AssertNoLeak(Run run, string sub)
  {
    Assert.DoesNotContain(FakeKey, run.AllOutput, StringComparison.Ordinal);
    Assert.DoesNotContain(sub, run.AllOutput, StringComparison.Ordinal);
    Assert.DoesNotContain(Uri.EscapeDataString(sub), run.AllOutput, StringComparison.Ordinal);
    Assert.DoesNotContain("never-logged", run.AllOutput, StringComparison.Ordinal);
  }

  [Fact]
  public async Task RevenueCatDelete_Deleted_CallsOnceWithEscapedSubAndBearer()
  {
    var sub = NewSub();
    var fake = new FakeRevenueCat(HttpStatusCode.OK);

    var run = await RunAsync(sub, fake, FakeKey);

    AssertSucceeded(run);
    Assert.Equal(0, await UserRowsAsync(sub));
    var call = Assert.Single(fake.Requests);
    Assert.Equal(HttpMethod.Delete, call.Method);
    Assert.Equal($"{FakeBase}/v1/subscribers/{Uri.EscapeDataString(sub)}", call.Url);
    Assert.Equal($"Bearer {FakeKey}", call.Auth);
    var line = SingleLine(run);
    Assert.Equal("deleted", line.GetProperty("outcome").GetString());
    Assert.Equal(200, line.GetProperty("status").GetInt32());
    AssertNoLeak(run, sub);
  }

  [Fact]
  public async Task RevenueCatDelete_404_IsNotFoundAndSucceeds()
  {
    var sub = NewSub();
    var fake = new FakeRevenueCat(HttpStatusCode.NotFound);

    var run = await RunAsync(sub, fake, FakeKey);

    AssertSucceeded(run);
    Assert.Single(fake.Requests);
    var line = SingleLine(run);
    Assert.Equal("not_found", line.GetProperty("outcome").GetString());
    Assert.Equal(404, line.GetProperty("status").GetInt32());
    AssertNoLeak(run, sub);
  }

  [Fact]
  public async Task RevenueCatDelete_500Then200_RetriesOnce()
  {
    var sub = NewSub();
    var fake = new FakeRevenueCat(HttpStatusCode.InternalServerError, HttpStatusCode.OK);

    var run = await RunAsync(sub, fake, FakeKey);

    AssertSucceeded(run);
    Assert.Equal(2, fake.Requests.Count);
    var line = SingleLine(run);
    Assert.Equal("deleted", line.GetProperty("outcome").GetString());
    Assert.Equal(200, line.GetProperty("status").GetInt32());
    AssertNoLeak(run, sub);
  }

  [Fact]
  public async Task RevenueCatDelete_500Twice_IsFailedButUserDeletionSucceeds()
  {
    var sub = NewSub();
    var fake = new FakeRevenueCat(HttpStatusCode.InternalServerError, HttpStatusCode.ServiceUnavailable, HttpStatusCode.OK);

    var run = await RunAsync(sub, fake, FakeKey);

    AssertSucceeded(run);
    Assert.Equal(0, await UserRowsAsync(sub));
    Assert.Equal(2, fake.Requests.Count);
    var line = SingleLine(run);
    Assert.Equal("failed", line.GetProperty("outcome").GetString());
    Assert.Equal(503, line.GetProperty("status").GetInt32());
    AssertNoLeak(run, sub);
  }

  [Fact]
  public async Task RevenueCatDelete_4xx_IsFailedWithoutRetry()
  {
    var sub = NewSub();
    var fake = new FakeRevenueCat(HttpStatusCode.Unauthorized);

    var run = await RunAsync(sub, fake, FakeKey);

    AssertSucceeded(run);
    Assert.Single(fake.Requests);
    var line = SingleLine(run);
    Assert.Equal("failed", line.GetProperty("outcome").GetString());
    Assert.Equal(401, line.GetProperty("status").GetInt32());
    AssertNoLeak(run, sub);
  }

  [Theory]
  [InlineData(null)]
  [InlineData("")]
  [InlineData("   ")]
  public async Task RevenueCatDelete_MissingKey_SkipsWithoutACall(string? key)
  {
    var sub = NewSub();
    var fake = new FakeRevenueCat(HttpStatusCode.OK);

    var run = await RunAsync(sub, fake, key);

    AssertSucceeded(run);
    Assert.Equal(0, await UserRowsAsync(sub));
    Assert.Empty(fake.Requests);
    var line = SingleLine(run);
    Assert.Equal("skipped_no_key", line.GetProperty("outcome").GetString());
    AssertNoLeak(run, sub);
  }

  [Fact]
  public async Task RevenueCatDelete_Timeout_RetriesOnceThenFailed()
  {
    var sub = NewSub();
    var fake = new FakeRevenueCat(null, null);

    var run = await RunAsync(sub, fake, FakeKey, attemptTimeout: TimeSpan.FromMilliseconds(200));

    AssertSucceeded(run);
    Assert.Equal(0, await UserRowsAsync(sub));
    Assert.Equal(2, fake.Requests.Count);
    var line = SingleLine(run);
    Assert.Equal("failed", line.GetProperty("outcome").GetString());
    Assert.Equal(JsonValueKind.Null, line.GetProperty("status").ValueKind);
    AssertNoLeak(run, sub);
  }

  [Fact]
  public async Task RevenueCatDelete_TimeoutThen200_IsDeleted()
  {
    var sub = NewSub();
    var fake = new FakeRevenueCat(null, HttpStatusCode.NoContent);

    var run = await RunAsync(sub, fake, FakeKey, attemptTimeout: TimeSpan.FromMilliseconds(200));

    AssertSucceeded(run);
    Assert.Equal(2, fake.Requests.Count);
    var line = SingleLine(run);
    Assert.Equal("deleted", line.GetProperty("outcome").GetString());
    Assert.Equal(204, line.GetProperty("status").GetInt32());
  }

  /// <summary>
  /// deploy.sh's mapping lines, evaluated on top of merge-env.sh exactly as deploy.sh sources them:
  /// the leaf maps to REVENUECAT_SECRET_API_KEY when present, nothing is injected when it is absent,
  /// and a stale copy leaves the live environment once the leaf is gone.
  /// </summary>
  [Fact]
  public void RevenueCatDelete_DeployMapsTheSsmLeaf_AndIsANoOpWithoutIt()
  {
    var dir = new DirectoryInfo(AppContext.BaseDirectory);
    while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "src_C", "deploy.sh"))) dir = dir.Parent;
    var srcC = Path.Combine(dir?.FullName ?? throw new DirectoryNotFoundException("src_C/deploy.sh not found"), "src_C");

    const string script = """
      set -euo pipefail
      source scripts/merge-env.sh
      eval "$(grep -E '^SSM_(TO|OPTIONAL)_ENV=' deploy.sh)"
      ssm_to_env '{"Parameters":[{"Name":"/developercards/prod/revenuecat-secret-api-key","Value":"sk_test_fake"},{"Name":"/developercards/prod/pg-password","Value":"p"}]}'
      ssm_to_env '{"Parameters":[{"Name":"/developercards/prod/pg-password","Value":"p"}]}'
      drop_absent_optional '{"REVENUECAT_SECRET_API_KEY":"stale","KEEP":"1"}' '{"PGPASSWORD":"p"}'
      """;
    var psi = new System.Diagnostics.ProcessStartInfo("bash")
    {
      WorkingDirectory = srcC,
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
    Assert.Equal(3, lines.Length);
    Assert.Equal("""{"REVENUECAT_SECRET_API_KEY":"sk_test_fake","PGPASSWORD":"p"}""", lines[0]);
    Assert.Equal("""{"PGPASSWORD":"p"}""", lines[1]);
    Assert.Equal("""{"KEEP":"1"}""", lines[2]);
  }

  [Fact]
  public void RevenueCatDelete_Defaults()
  {
    Assert.Equal(TimeSpan.FromSeconds(5), RevenueCatCustomerDeletion.DefaultAttemptTimeout);
    Assert.Equal("https://api.revenuecat.com", RevenueCatCustomerDeletion.DefaultBase);
    Assert.Equal("REVENUECAT_SECRET_API_KEY", RevenueCatCustomerDeletion.KeyEnv);
    Assert.Equal("REVENUECAT_API_BASE", RevenueCatCustomerDeletion.BaseEnv);
  }
}
