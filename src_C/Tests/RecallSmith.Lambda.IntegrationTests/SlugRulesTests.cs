using System.Globalization;
using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Runtime;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The one deck-slug grammar (Validation.SlugRegex, E00 §2.7), shared by Decks, Publish and
/// PremiumDeckUrl. The pure IsValidSlug/RequireSlug rules are pinned by the tables and generated
/// cases; the three routes are exercised end to end so a bad slug is a 400 VALIDATION_ERROR
/// before any SQL, and an upper-case slug still passes the phone's gate after lower-casing.
/// </summary>
[Collection(PostgresCollection.Name)]
public class SlugRulesTests
{
  private readonly PostgresFixture _db;

  private const int GeneratedCaseCount = 60;
  private const string DecksPath = "/api/v1/authoring/decks";
  private const string PublishPath = "/api/v1/authoring/publish";
  private const string PremiumPath = "/api/v1/content/premium-url";
  private const string RuleMessage = "slug must match ^[a-z0-9][a-z0-9-]{0,63}$";

  public SlugRulesTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- helpers

  private static string NewSub() => $"it-slug-{Guid.NewGuid():N}";

  private static JsonElement AdminEvent(string method, string path, IDictionary<string, string>? query, string? body)
  {
    return JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method },
        authorizer = new
        {
          jwt = new
          {
            claims = new Dictionary<string, object>(StringComparer.Ordinal)
            {
              ["sub"] = NewSub(),
              ["cognito:groups"] = new[] { "super_admin" },
            },
          },
        },
      },
      headers = new Dictionary<string, string>(),
      queryStringParameters = query ?? new Dictionary<string, string>(),
      body,
      isBase64Encoded = false,
    });
  }

  private static async Task<APIGatewayProxyResponse> DecksAsync(string method, string? body)
  {
    var req = new LambdaRequest(AdminEvent(method, DecksPath, null, body));
    var res = new Res(req.TraceId);
    return await Decks.HandleAuthoringDecks(req, res, await Auth.GetAuthContextAsync(req));
  }

  private static async Task<APIGatewayProxyResponse> PreviewPublishAsync(long deckId)
  {
    var query = new Dictionary<string, string>(StringComparer.Ordinal) { ["mode"] = "preview" };
    var body = JsonSerializer.Serialize(new { deckId });
    var req = new LambdaRequest(AdminEvent("POST", PublishPath, query, body));
    var res = new Res(req.TraceId);
    return await Publish.HandleAuthoringPublish(req, res, await Auth.GetAuthContextAsync(req));
  }

  private static async Task<APIGatewayProxyResponse> PremiumUrlAsync(string slug)
  {
    var evt = JsonSerializer.SerializeToElement(new
    {
      rawPath = PremiumPath,
      requestContext = new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method = "GET" },
      },
      headers = new Dictionary<string, string>(),
      queryStringParameters = new Dictionary<string, string> { ["slug"] = slug },
      body = (string?)null,
      isBase64Encoded = false,
    });
    var req = new LambdaRequest(evt);
    var res = new Res(req.TraceId);
    var query = new Dictionary<string, string>(StringComparer.Ordinal) { ["slug"] = slug };
    // Anonymous caller: a slug that passes the gate is then observable as 403 "Requires login".
    var auth = new AuthContext(
      Claims: new Dictionary<string, JsonElement>(StringComparer.Ordinal),
      UserSub: null,
      Username: null,
      Groups: [],
      IsSuperAdmin: false,
      IsEditor: false,
      IsAdmin: false);
    return await PremiumDeckUrl.HandlePremiumDeckUrl(req, query, res, auth);
  }

  private static JsonElement Data(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("data").Clone();

  private static string? ErrorCode(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("error").GetProperty("code").GetString();

  private static string? ErrorMessage(APIGatewayProxyResponse response) =>
    JsonDocument.Parse(response.Body!).RootElement.GetProperty("error").GetProperty("message").GetString();

  // ---------------------------------------------------------- pure IsValidSlug

  public static IEnumerable<object?[]> AcceptSlugs() => new List<object?[]>
  {
    new object?[] { "aws-saa-c03" },
    new object?[] { "csharp-basics" },
    new object?[] { "claude-ccdv-f" },
    new object?[] { "a" },
    new object?[] { "0" },
    new object?[] { "a-b-c" },
    new object?[] { "a" + new string('b', 63) },
  };

  [Theory]
  [MemberData(nameof(AcceptSlugs))]
  public void IsValidSlug_AcceptTable(string slug)
  {
    Assert.True(Validation.IsValidSlug(slug), $"expected {slug} to be a valid slug");
  }

  public static IEnumerable<object?[]> RejectSlugs() => new List<object?[]>
  {
    new object?[] { null },
    new object?[] { "" },
    new object?[] { "-a" },
    new object?[] { "a_b" },
    new object?[] { "A" },
    new object?[] { "aB" },
    new object?[] { "a/b" },
    new object?[] { ".." },
    new object?[] { "a b" },
    new object?[] { " a" },
    new object?[] { new string('a', 65) },
    new object?[] { "abc\n" },
    new object?[] { "é" },
  };

  [Theory]
  [MemberData(nameof(RejectSlugs))]
  public void IsValidSlug_RejectTable(string? slug)
  {
    Assert.False(Validation.IsValidSlug(slug), $"expected {slug ?? "<null>"} to be rejected");
  }

  private static string RandValidSlug(Random rng)
  {
    const string alnum = "abcdefghijklmnopqrstuvwxyz0123456789";
    const string body = "abcdefghijklmnopqrstuvwxyz0123456789-";
    var len = rng.Next(1, 65);   // 1..64
    var sb = new StringBuilder();
    sb.Append(alnum[rng.Next(alnum.Length)]);   // first char is never '-'
    for (var i = 1; i < len; i++) sb.Append(body[rng.Next(body.Length)]);
    return sb.ToString();
  }

  public static IEnumerable<object[]> GeneratedSlugs()
  {
    var rng = new Random(20260922);
    var rows = new List<object[]>();

    for (var i = 0; i < GeneratedCaseCount / 2; i++)
    {
      rows.Add(new object[] { RandValidSlug(rng), true });
    }

    for (var i = 0; i < GeneratedCaseCount / 2; i++)
    {
      var s = RandValidSlug(rng);
      var bad = (i % 7) switch
      {
        0 => s[..1] + "A" + s[1..],                 // an upper-case char
        1 => s[..1] + "_" + s[1..],                 // an underscore
        2 => "-" + s,                               // leading dash
        3 => s + new string('a', 65 - s.Length),    // extended past 64
        4 => s + "\n",                              // trailing newline
        5 => s[..1] + " " + s[1..],                 // an embedded space
        _ => s[..1] + "/" + s[1..],                 // a slash
      };
      rows.Add(new object[] { bad, false });
    }

    return rows;
  }

  [Theory]
  [MemberData(nameof(GeneratedSlugs))]
  public void IsValidSlug_GeneratedCases(string slug, bool expected)
  {
    Assert.Equal(expected, Validation.IsValidSlug(slug));
  }

  [Fact]
  public void RequireSlug_TrimsOrThrowsWithTheRuleMessage()
  {
    Assert.Equal("ok-1", Validation.RequireSlug("  ok-1 "));

    var ex = Assert.Throws<ValidationError>(() => Validation.RequireSlug("Bad_Slug"));
    Assert.Equal(Validation.SlugRuleMessage, ex.Message);
    Assert.Equal("slug", ex.Field);

    var ex2 = Assert.Throws<ValidationError>(() => Validation.RequireSlug("Bad_Slug", "deckSlug"));
    Assert.Equal("deckSlug", ex2.Field);
  }

  // ------------------------------------------------------------------ routes

  [Fact]
  public async Task PostDeck_BadSlug_Is400_AndNothingInserted()
  {
    var body = JsonSerializer.Serialize(new { slug = "Bad_Slug", title = "t", author = "tests" });
    var response = await DecksAsync("POST", body);

    Assert.Equal(400, response.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(response));
    Assert.Equal(RuleMessage, ErrorMessage(response));

    var n = await _db.ScalarAsync("select count(*) from decks where slug = $1", "Bad_Slug");
    Assert.Equal(0, Convert.ToInt32(n, CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task PostDeck_GoodSlug_Is200()
  {
    var slug = $"e07-{Guid.NewGuid():N}"[..20];
    var body = JsonSerializer.Serialize(new { slug, title = "t", author = "tests" });
    var response = await DecksAsync("POST", body);

    Assert.True(response.StatusCode == 200, $"expected 200, got {response.StatusCode}: {response.Body}");
    Assert.Equal(slug, Data(response).GetProperty("slug").GetString());
  }

  [Fact]
  public async Task PutDeck_BadSlug_Is400_AndRowUnchanged()
  {
    var slug = $"e07-{Guid.NewGuid():N}"[..20];
    var post = await DecksAsync("POST", JsonSerializer.Serialize(new { slug, title = "t", author = "tests" }));
    Assert.True(post.StatusCode == 200, $"expected 200, got {post.StatusCode}: {post.Body}");
    var id = Data(post).GetProperty("id").GetInt64();

    var put = await DecksAsync("PUT", JsonSerializer.Serialize(new { id, slug = "-leading" }));
    Assert.Equal(400, put.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(put));

    var rows = await _db.QueryAsync("select slug from decks where id = $1", id);
    Assert.Equal(slug, rows[0]["slug"] as string);
  }

  [Fact]
  public async Task PublishPreview_BadSlugRow_Is400()
  {
    // A row with a slug the API would never have accepted, inserted straight past the guard.
    var badSlug = $"Bad_Slug_{Guid.NewGuid():N}";
    var rows = await _db.QueryAsync(
      "insert into decks (slug, title, author) values ($1, $2, $3) returning id",
      badSlug, "t", "tests");
    var deckId = Convert.ToInt64(rows[0]["id"], CultureInfo.InvariantCulture);

    var response = await PreviewPublishAsync(deckId);
    Assert.Equal(400, response.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(response));
    Assert.Contains("slug must match", ErrorMessage(response)!, StringComparison.Ordinal);
  }

  [Fact]
  public async Task PremiumUrl_BadSlug_Is400()
  {
    var response = await PremiumUrlAsync("Bad_Slug");
    Assert.Equal(400, response.StatusCode);
    Assert.Equal("VALIDATION_ERROR", ErrorCode(response));
  }

  [Fact]
  public async Task PremiumUrl_UpperCaseSlug_PassesTheSlugGate()
  {
    // The gate lower-cases first, so "AWS-SAA-C03" passes it; the anonymous caller then meets
    // the login requirement, which is observable as 403 rather than the 400 a bad slug would give.
    var response = await PremiumUrlAsync("AWS-SAA-C03");
    Assert.Equal(403, response.StatusCode);
  }
}
