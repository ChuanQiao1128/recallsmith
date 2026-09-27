using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Least authority for the local authoring agent's token (R18 X02, ai-agent-6). A super_admin token minted for the
/// agent client (console-dev, AUTH_AGENT_CLIENT_IDS) reaches only deck list/read, card similarity, draft submit and
/// its own drafts; every human-decision route (accept/reject, publish, QA, webhooks, ledger, admin/db, card writes)
/// answers 403 AGENT_CLIENT_FORBIDDEN. The console's SPA client, with the same pool and groups, is unchanged.
///
/// Every request goes through <see cref="VpcFunction.Handler"/> with a signed bearer, as API Gateway sends it.
/// </summary>
/// <remarks>In the postgres collection: <see cref="Auth.Configure"/> is process-global and the allowed routes read the database.</remarks>
[Collection(PostgresCollection.Name)]
public sealed class AgentClientPolicyTests : IDisposable
{
  private const string Kid = "cognito-kid-agent";
  private const string SpaClient = "spa-client-test";
  private const string AgentClient = "agent-client-test";

  private readonly PostgresFixture _db;
  private readonly RSA _key = TestJwt.NewKey();

  public AgentClientPolicyTests(PostgresFixture db)
  {
    _db = db;
    // Both clients are console clients (they pass the admin binding); only the agent client is least-authority.
    Auth.Configure(
      AuthOptions.Parse(null, null, "production", null, $"{SpaClient},{AgentClient}", AgentClient),
      new StubJwks(TestJwt.Jwks((Kid, _key))));
  }

  public void Dispose()
  {
    Auth.ResetToEnvironment();
    _key.Dispose();
  }

  // ------------------------------------------------------------- helpers

  private string Token(string clientId, string sub)
  {
    var payload = TestJwt.Payload(issuer: TestJwt.ConsoleIssuer, sub: sub, groups: ["super_admin"]);
    payload["client_id"] = clientId;
    return TestJwt.Sign(_key, Kid, payload);
  }

  private static JsonElement Event(string method, string path, string? bearer, object? body = null, IDictionary<string, string>? query = null)
  {
    var headers = new Dictionary<string, string>(StringComparer.Ordinal) { ["content-type"] = "application/json" };
    if (bearer is not null) headers["authorization"] = "Bearer " + bearer;
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new { requestId = Guid.NewGuid().ToString(), http = new { method } },
      headers,
      queryStringParameters = query ?? new Dictionary<string, string>(),
      body = body is null ? null : JsonSerializer.Serialize(body),
      isBase64Encoded = false,
    });
  }

  private static Task<APIGatewayProxyResponse> CallAsync(JsonElement evt) => new VpcFunction().Handler(evt);

  private static string? ErrorCode(APIGatewayProxyResponse response)
  {
    using var doc = JsonDocument.Parse(response.Body!);
    return doc.RootElement.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.Object
      ? error.GetProperty("code").GetString()
      : null;
  }

  private async Task<long> NewDeckAsync()
  {
    var slug = $"it-x02-agent-{Guid.NewGuid():N}";
    return Convert.ToInt64(await _db.ScalarAsync(
      "insert into decks (slug, title, author) values ($1, $2, $3) returning id", slug, "deck x02 agent", "tests"), CultureInfo.InvariantCulture);
  }

  private static object DraftBody(long deckId, string uid) => new
  {
    deckId,
    drafts = new[]
    {
      new
      {
        clientDraftKey = Guid.NewGuid().ToString("N"),
        card = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
          ["stableUid"] = uid,
          ["difficulty"] = 2,
          ["topic"] = "Synthetic topic",
          ["question"] = $"Synthetic question about agent draft {uid}?",
          ["explanation"] = $"Synthetic explanation for agent draft {uid}.",
          ["codeSnippet"] = null,
          ["codeLanguage"] = null,
          ["realWorldUsage"] = "Synthetic usage note.",
          ["mcq"] = null,
          ["source"] = new Dictionary<string, object?>
          {
            ["url"] = "https://docs.aws.amazon.com/synthetic/latest/userguide/agent-draft.html",
            ["quote"] = "Synthetic quote for an agent draft.",
          },
        },
      },
    },
  };

  /// <summary>Human-decision and write routes (ids that match nothing, in case a route were ever reached).</summary>
  public static TheoryData<string, string> DeniedRoutes => new()
  {
    { "POST", "/api/v1/authoring/drafts/999999999999/accept" },
    { "POST", "/api/v1/authoring/drafts/999999999999/reject" },
    { "GET", "/api/v1/authoring/drafts" },
    { "POST", "/api/v1/authoring/publish" },
    { "POST", "/api/v1/authoring/qa/runs" },
    { "GET", "/api/v1/authoring/qa/runs" },
    { "GET", "/api/v1/authoring/qa/status" },
    { "POST", "/api/v1/authoring/qa/findings/999999999999/resolve" },
    { "POST", "/api/v1/authoring/qa/runs/00000000-0000-0000-0000-000000000001/items/999999999999/waive" },
    { "GET", "/api/v1/admin/webhooks/subscriptions" },
    { "POST", "/api/v1/admin/webhooks/subscriptions" },
    { "POST", "/api/v1/admin/webhooks/deliveries/999999999999/redeliver" },
    { "GET", "/api/v1/admin/automation/ledger" },
    { "POST", "/api/v1/admin/automation/backfill" },
    { "PUT", "/api/v1/admin/automation/baselines/ai_qa_review" },
    { "POST", "/api/v1/admin/db/migrate" },
    { "POST", "/api/v1/admin/permissions" },
    { "POST", "/api/v1/authoring/cards" },
    { "PUT", "/api/v1/authoring/cards" },
    { "POST", "/api/v1/authoring/cards/import" },
    { "POST", "/api/v1/authoring/decks" },
    { "DELETE", "/api/v1/authoring/decks" },
    { "POST", "/api/v1/admin/decks/999999999999/rollback" },
    { "POST", "/api/v1/admin/manifest/rebuild" },
  };

  /// <summary>A read-only or not-found subset of <see cref="DeniedRoutes"/> that is safe to run for real with the SPA client.</summary>
  public static TheoryData<string, string> SpaProbeRoutes => new()
  {
    { "POST", "/api/v1/authoring/drafts/999999999999/accept" },
    { "POST", "/api/v1/authoring/drafts/999999999999/reject" },
    { "GET", "/api/v1/authoring/drafts" },
    { "GET", "/api/v1/authoring/qa/runs" },
    { "POST", "/api/v1/authoring/qa/findings/999999999999/resolve" },
    { "POST", "/api/v1/authoring/qa/runs/00000000-0000-0000-0000-000000000001/items/999999999999/waive" },
    { "GET", "/api/v1/admin/webhooks/subscriptions" },
    { "GET", "/api/v1/admin/automation/ledger" },
  };

  // ------------------------------------------------------------- routes

  [Theory]
  [MemberData(nameof(DeniedRoutes))]
  public async Task AgentClient_HumanDecisionAndWriteRoutes_Are403AgentClientForbidden(string method, string path)
  {
    var response = await CallAsync(Event(method, path, Token(AgentClient, $"it-x02-agent-{Guid.NewGuid():N}"), new { }));

    Assert.Equal(403, response.StatusCode);
    Assert.Equal(AgentClientPolicy.ErrorCode, ErrorCode(response));
  }

  [Theory]
  [MemberData(nameof(SpaProbeRoutes))]
  public async Task SpaClient_SameRoutes_AreNotAgentForbidden(string method, string path)
  {
    // The console's own client is unchanged: whatever each route answers, it is never the agent denial.
    var response = await CallAsync(Event(method, path, Token(SpaClient, $"it-x02-spa-{Guid.NewGuid():N}"), new { }));

    Assert.NotEqual(AgentClientPolicy.ErrorCode, ErrorCode(response));
  }

  [Fact]
  public async Task AgentClient_McpRoutes_AreAllowed()
  {
    var sub = $"it-x02-agent-{Guid.NewGuid():N}";
    var deckId = await NewDeckAsync();

    var decks = await CallAsync(Event("GET", "/api/v1/admin/decks", Token(AgentClient, sub), query: new Dictionary<string, string> { ["limit"] = "5" }));
    Assert.Equal(200, decks.StatusCode);

    var similar = await CallAsync(Event("POST", "/api/v1/authoring/cards/similar", Token(AgentClient, sub),
      new { text = "Synthetic question about an agent draft?", deckId }));
    Assert.Equal(200, similar.StatusCode);

    var submitted = await CallAsync(Event("POST", "/api/v1/authoring/drafts", Token(AgentClient, sub), DraftBody(deckId, "agent-own")));
    Assert.True(submitted.StatusCode == 200, submitted.Body);
    long draftId;
    using (var doc = JsonDocument.Parse(submitted.Body!))
    {
      draftId = doc.RootElement.GetProperty("data").GetProperty("created")[0].GetProperty("draftId").GetInt64();
    }

    // Y02 (ai-agent-6 cross-wave contract): the MCP server never reads a draft back, so the agent token may not
    // either, not even its own draft (X02 allowed that; the contract now limits the agent to the MCP's calls).
    var own = await CallAsync(Event("GET", $"/api/v1/authoring/drafts/{draftId}", Token(AgentClient, sub)));
    Assert.Equal(403, own.StatusCode);
    Assert.Equal(AgentClientPolicy.ErrorCode, ErrorCode(own));

    // The console reviewer still reads it.
    var spa = await CallAsync(Event("GET", $"/api/v1/authoring/drafts/{draftId}", Token(SpaClient, sub)));
    Assert.Equal(200, spa.StatusCode);

    // And only the human can decide it.
    var accept = await CallAsync(Event("POST", $"/api/v1/authoring/drafts/{draftId}/accept", Token(AgentClient, sub), new { }));
    Assert.Equal(AgentClientPolicy.ErrorCode, ErrorCode(accept));
    Assert.Equal("pending", await _db.ScalarAsync("select status from ai_drafts where id = $1", draftId));
  }

  [Fact]
  public async Task AgentClient_GatewayVerifiedClaims_AreRestrictedToo()
  {
    // The API Gateway authorizer path carries client_id in the verified claims; the policy reads it the same way.
    var evt = JsonSerializer.SerializeToElement(new
    {
      rawPath = "/api/v1/authoring/publish",
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method = "POST" },
        authorizer = new
        {
          jwt = new
          {
            claims = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
              ["sub"] = "gateway-agent-sub",
              ["cognito:groups"] = "[super_admin]",
              ["iss"] = TestJwt.ConsoleIssuer,
              ["client_id"] = AgentClient,
            },
          },
        },
      },
      headers = new Dictionary<string, string>(StringComparer.Ordinal),
      queryStringParameters = new Dictionary<string, string>(),
      body = "{}",
      isBase64Encoded = false,
    });

    var response = await CallAsync(evt);

    Assert.Equal(403, response.StatusCode);
    Assert.Equal(AgentClientPolicy.ErrorCode, ErrorCode(response));
  }

  // ------------------------------------------------------------- pure

  [Fact]
  public void Parse_AgentClientIds_DefaultToConsoleDev()
  {
    Assert.Equal([AuthOptions.DefaultAgentClientId], AuthOptions.Parse(null, null, "production").AgentClientIds);
    Assert.Equal([AuthOptions.DefaultAgentClientId], AuthOptions.Parse(null, null, "production", null, null, "  ").AgentClientIds);
    Assert.Equal(["a", "b"], AuthOptions.Parse(null, null, "production", null, null, " a , b ,a").AgentClientIds);
  }

  [Theory]
  [InlineData("GET", "/api/v1/admin/decks", true)]
  [InlineData("GET", "/prod/api/v1/admin/decks", true)]
  [InlineData("POST", "/api/v1/admin/decks", false)]
  [InlineData("GET", "/api/v1/authoring/decks", false)]
  [InlineData("POST", "/api/v1/authoring/cards/similar", true)]
  [InlineData("POST", "/api/v1/authoring/drafts", true)]
  [InlineData("GET", "/api/v1/authoring/drafts", false)]
  [InlineData("GET", "/api/v1/authoring/drafts/12", false)]
  [InlineData("POST", "/api/v1/authoring/drafts/12/accept", false)]
  [InlineData("GET", "/api/v1/authoring/drafts/12/accept", false)]
  [InlineData("GET", "/health", false)]
  [InlineData("POST", "/api/internal/ai-qa/results", false)]
  public void Allows_Table(string method, string path, bool expected)
  {
    Assert.Equal(expected, AgentClientPolicy.Allows(method, path));
  }

  /// <summary>
  /// Cross-wave contract (Y02, ai-agent-6): the policy's allowed routes are exactly the endpoints the MCP server
  /// calls. Reads tools/mcp-server/src and fails when the server gains a call the policy denies, or the policy keeps
  /// a route the server no longer calls.
  /// </summary>
  [Fact]
  public void Allows_ExactlyTheMcpServerEndpoints()
  {
    var src = Path.Combine(RepoRoot(), "tools", "mcp-server", "src");
    var called = new HashSet<(string, string)>();
    foreach (var file in Directory.EnumerateFiles(src, "*.ts", SearchOption.AllDirectories))
    {
      var text = File.ReadAllText(file);
      foreach (System.Text.RegularExpressions.Match m in System.Text.RegularExpressions.Regex.Matches(
        text, @"'(GET|POST)'\s*,\s*[`'](/api/[^`'?$]+)"))
      {
        called.Add((m.Groups[1].Value, m.Groups[2].Value));
      }
    }

    Assert.Equal(
      new HashSet<(string, string)> { ("GET", "/api/v1/admin/decks"), ("POST", "/api/v1/authoring/cards/similar"), ("POST", "/api/v1/authoring/drafts") },
      called);
    Assert.All(called, c => Assert.True(AgentClientPolicy.Allows(c.Item1, c.Item2), $"{c.Item1} {c.Item2} is denied"));
    foreach (var (method, path) in new[] { ("GET", "/health"), ("GET", "/api/v1/authoring/decks"), ("GET", "/api/v1/authoring/drafts/1"),
      ("GET", "/api/v1/authoring/drafts"), ("POST", "/api/v1/authoring/publish"), ("POST", "/api/v1/authoring/qa/runs") })
    {
      Assert.False(AgentClientPolicy.Allows(method, path), $"{method} {path} is allowed but the MCP server never calls it");
    }
  }

  private static string RepoRoot()
  {
    var dir = new DirectoryInfo(AppContext.BaseDirectory);
    while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "tools", "mcp-server"))) dir = dir.Parent;
    return dir?.FullName ?? throw new DirectoryNotFoundException("repo root (tools/mcp-server) not found above the test output");
  }
}
