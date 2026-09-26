using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Runtime;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The contract of POST /api/v1/user/client-errors: one bounded JSON report in, one structured
/// <c>warn</c> line tagged <c>client_error</c> out, 202, and nothing persisted. The bearer is
/// optional in code, and a signed-in caller's sub is logged only as a 16-hex SHA-256 prefix.
/// </summary>
/// <remarks>
/// In the postgres collection because these tests redirect Console (process-global, shared with
/// the other log-shape classes; xunit runs one collection serially). The per-container budget is
/// static process state, so the constructor and <see cref="Dispose"/> both zero it.
/// </remarks>
[Collection(PostgresCollection.Name)]
public sealed class ClientErrorsTests : IDisposable
{
  public ClientErrorsTests() => ClientErrors.ResetBudget();

  public void Dispose() => ClientErrors.ResetBudget();

  // ---------------------------------------------------------------- helpers

  private static async Task<(string Out, string Err)> CaptureAsync(Func<Task> action)
  {
    var oldOut = Console.Out;
    var oldErr = Console.Error;
    var stdout = new StringWriter();
    var stderr = new StringWriter();

    Console.SetOut(stdout);
    Console.SetError(stderr);
    try
    {
      await action().ConfigureAwait(false);
    }
    finally
    {
      Console.SetOut(oldOut);
      Console.SetError(oldErr);
    }

    return (stdout.ToString(), stderr.ToString());
  }

  private static JsonElement[] Lines(string text) =>
    text
      .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
      .Where(l => l.Length > 0)
      .Select(l =>
      {
        using var doc = JsonDocument.Parse(l);
        return doc.RootElement.Clone();
      })
      .ToArray();

  private static JsonElement[] TaggedLines(string stderr, string tag) =>
    Lines(stderr).Where(l => l.TryGetProperty("tag", out var t) && t.GetString() == tag).ToArray();

  private static JsonElement[] ClientErrorLines(string stderr) => TaggedLines(stderr, "client_error");

  private static JsonElement Body(APIGatewayProxyResponse r) => JsonDocument.Parse(r.Body).RootElement.Clone();

  /// <summary>A request event; when <paramref name="sub"/> is non-null it carries an authorizer block.</summary>
  private static JsonElement Event(string method, string? body, string? sub = null)
  {
    var requestContext = new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["requestId"] = Guid.NewGuid().ToString(),
      ["http"] = new Dictionary<string, object?> { ["method"] = method },
    };

    if (sub is not null)
    {
      requestContext["authorizer"] = new Dictionary<string, object?>
      {
        ["jwt"] = new Dictionary<string, object?>
        {
          ["claims"] = new Dictionary<string, object?>(StringComparer.Ordinal)
          {
            ["sub"] = sub,
            ["cognito:groups"] = Array.Empty<string>(),
          },
        },
      };
    }

    return JsonSerializer.SerializeToElement(new Dictionary<string, object?>
    {
      ["rawPath"] = "/api/v1/user/client-errors",
      ["requestContext"] = requestContext,
      ["headers"] = new Dictionary<string, string>(StringComparer.Ordinal),
      ["body"] = body,
      ["isBase64Encoded"] = false,
    });
  }

  private static async Task<APIGatewayProxyResponse> CallAsync(JsonElement evt)
  {
    var req = new LambdaRequest(evt);
    return await ClientErrors.HandleClientErrors(req, new Res(req.TraceId), await Auth.GetAuthContextAsync(req));
  }

  private static Dictionary<string, object?> Report() => new(StringComparer.Ordinal)
  {
    ["kind"] = "js_error",
    ["message"] = "TypeError: x is undefined",
    ["stack"] = "at f (app.js:1:1)",
    ["screen"] = "Home",
    ["isFatal"] = false,
    ["appVersion"] = "1.6.1",
    ["platform"] = "ios",
    ["occurredAtMs"] = 1_700_000_000_000L,
  };

  private static string Json(Dictionary<string, object?> report) => JsonSerializer.Serialize(report);

  // ---------------------------------------------------------------- tests

  [Fact]
  public async Task Post_ValidReport_Is202AndLogsOneClientErrorLine()
  {
    APIGatewayProxyResponse? resp = null;
    var (_, err) = await CaptureAsync(async () => resp = await CallAsync(Event("POST", Json(Report()))));

    Assert.Equal(202, resp!.StatusCode);
    var body = Body(resp);
    Assert.True(body.GetProperty("success").GetBoolean());
    Assert.True(body.GetProperty("data").GetProperty("accepted").GetBoolean());

    var line = Assert.Single(ClientErrorLines(err));
    Assert.Equal("warn", line.GetProperty("level").GetString());
    Assert.Equal("js_error", line.GetProperty("kind").GetString());
    Assert.Equal("TypeError: x is undefined", line.GetProperty("message").GetString());
    Assert.Equal("Home", line.GetProperty("screen").GetString());
    Assert.Equal("1.6.1", line.GetProperty("appVersion").GetString());
    Assert.Equal(1_700_000_000_000L, line.GetProperty("occurredAtMs").GetInt64());
  }

  [Fact]
  public async Task Post_SignedIn_LogsSubHashNeverTheSub()
  {
    const string sub = "it-f16-user-7f3a";
    APIGatewayProxyResponse? resp = null;
    var (_, err) = await CaptureAsync(async () => resp = await CallAsync(Event("POST", Json(Report()), sub)));

    Assert.Equal(202, resp!.StatusCode);
    var hash = ClientErrors.HashSub(sub);
    Assert.Equal(16, hash.Length);

    var line = Assert.Single(ClientErrorLines(err));
    Assert.Equal(hash, line.GetProperty("userSubHash").GetString());
    Assert.DoesNotContain(sub, err);
  }

  [Fact]
  public async Task Post_Anonymous_Is202WithNullSubHash()
  {
    APIGatewayProxyResponse? resp = null;
    var (_, err) = await CaptureAsync(async () => resp = await CallAsync(Event("POST", Json(Report()))));

    Assert.Equal(202, resp!.StatusCode);
    var line = Assert.Single(ClientErrorLines(err));
    Assert.Equal(JsonValueKind.Null, line.GetProperty("userSubHash").ValueKind);
  }

  [Fact]
  public async Task Post_RejectedBearer_IsStillAccepted()
  {
    var req = new LambdaRequest(Event("POST", Json(Report())));
    var auth = new AuthContext(
      Claims: new Dictionary<string, JsonElement>(StringComparer.Ordinal),
      UserSub: null,
      Username: null,
      Groups: [],
      IsSuperAdmin: false,
      IsEditor: false,
      IsAdmin: false,
      RejectReason: "expired");

    APIGatewayProxyResponse? resp = null;
    var (_, err) = await CaptureAsync(async () =>
      resp = await ClientErrors.HandleClientErrors(req, new Res(req.TraceId), auth));

    Assert.Equal(202, resp!.StatusCode);
    var line = Assert.Single(ClientErrorLines(err));
    Assert.Equal(JsonValueKind.Null, line.GetProperty("userSubHash").ValueKind);
    Assert.True(line.GetProperty("authRejected").GetBoolean());
  }

  [Fact]
  public async Task Post_BodyOver16KB_Is413()
  {
    var report = Report();
    report["stack"] = new string('x', ClientErrors.MaxBodyChars + 1);
    var json = Json(report);
    Assert.True(json.Length > ClientErrors.MaxBodyChars);

    APIGatewayProxyResponse? resp = null;
    var (_, err) = await CaptureAsync(async () => resp = await CallAsync(Event("POST", json)));

    Assert.Equal(413, resp!.StatusCode);
    Assert.Equal("PAYLOAD_TOO_LARGE", Body(resp).GetProperty("error").GetProperty("code").GetString());
    Assert.Empty(ClientErrorLines(err));
  }

  [Fact]
  public async Task Post_MissingMessage_Is400()
  {
    var report = Report();
    report.Remove("message");

    APIGatewayProxyResponse? resp = null;
    var (_, err) = await CaptureAsync(async () => resp = await CallAsync(Event("POST", Json(report))));

    Assert.Equal(400, resp!.StatusCode);
    Assert.Equal("VALIDATION_ERROR", Body(resp).GetProperty("error").GetProperty("code").GetString());
    Assert.Empty(ClientErrorLines(err));
  }

  [Fact]
  public async Task Post_UnknownKind_Is400()
  {
    var report = Report();
    report["kind"] = "segfault";

    APIGatewayProxyResponse? resp = null;
    var (_, err) = await CaptureAsync(async () => resp = await CallAsync(Event("POST", Json(report))));

    Assert.Equal(400, resp!.StatusCode);
    Assert.Equal("VALIDATION_ERROR", Body(resp).GetProperty("error").GetProperty("code").GetString());
    Assert.Empty(ClientErrorLines(err));
  }

  [Fact]
  public async Task Post_NonObjectBody_Is400()
  {
    APIGatewayProxyResponse? resp = null;
    var (_, err) = await CaptureAsync(async () =>
      resp = await CallAsync(Event("POST", "[{\"kind\":\"js_error\",\"message\":\"m\"}]")));

    Assert.Equal(400, resp!.StatusCode);
    Assert.Equal("VALIDATION_ERROR", Body(resp).GetProperty("error").GetProperty("code").GetString());
    Assert.Empty(ClientErrorLines(err));
  }

  [Fact]
  public async Task Post_LongFields_AreClamped()
  {
    var report = Report();
    report["message"] = new string('m', 5000);
    report["stack"] = new string('s', 9000);
    report["screen"] = new string('c', 500);

    APIGatewayProxyResponse? resp = null;
    var (_, err) = await CaptureAsync(async () => resp = await CallAsync(Event("POST", Json(report))));

    Assert.Equal(202, resp!.StatusCode);
    var line = Assert.Single(ClientErrorLines(err));
    Assert.Equal(1000, line.GetProperty("message").GetString()!.Length);
    Assert.Equal(8000, line.GetProperty("stack").GetString()!.Length);
    Assert.Equal(128, line.GetProperty("screen").GetString()!.Length);
  }

  [Fact]
  public async Task Get_Is405()
  {
    var resp = await CallAsync(Event("GET", null));
    Assert.Equal(405, resp.StatusCode);
  }

  [Fact]
  public async Task Budget_DropsReportsBeyondSixtyPerWindow()
  {
    ClientErrors.ResetBudget();

    var accepted = new List<APIGatewayProxyResponse>();
    APIGatewayProxyResponse? overflow = null;
    var (_, err) = await CaptureAsync(async () =>
    {
      for (var i = 0; i < ClientErrors.MaxReportsPerWindow; i++)
      {
        accepted.Add(await CallAsync(Event("POST", Json(Report()))));
      }
      overflow = await CallAsync(Event("POST", Json(Report())));
    });

    foreach (var r in accepted)
    {
      Assert.Equal(202, r.StatusCode);
      Assert.True(Body(r).GetProperty("data").GetProperty("accepted").GetBoolean());
    }

    Assert.Equal(202, overflow!.StatusCode);
    var data = Body(overflow).GetProperty("data");
    Assert.False(data.GetProperty("accepted").GetBoolean());
    Assert.True(data.GetProperty("dropped").GetBoolean());

    Assert.Equal(ClientErrors.MaxReportsPerWindow, ClientErrorLines(err).Length);
    Assert.Single(TaggedLines(err, "client_error_budget"));
  }

  [Fact]
  public async Task Post_IsRoutedByVpcFunction()
  {
    var resp = await new VpcFunction().Handler(Event("POST", Json(Report())));
    Assert.Equal(202, resp.StatusCode);
  }
}
