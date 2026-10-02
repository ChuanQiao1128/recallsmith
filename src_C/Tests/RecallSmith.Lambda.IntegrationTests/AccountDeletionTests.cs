using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Runtime;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// DELETE /api/v1/me (and /api/v1/user/me) against a real Postgres. Every user-keyed table is
/// seeded for a caller, the endpoint is driven exactly as API Gateway delivers it, and the tables
/// are counted before and after. Test 8 fails the build if a future migration adds a user-keyed
/// table that <see cref="AccountDeletion.DeleteUserDataAsync"/> does not cover.
/// </summary>
[Collection(PostgresCollection.Name)]
public class AccountDeletionTests
{
  private readonly PostgresFixture _db;
  public AccountDeletionTests(PostgresFixture db) => _db = db;

  private static string NewSub() => $"it-f15-{Guid.NewGuid():N}";

  // The twelve (table, column) pairs of every row keyed by a single app user. analytics_event_outbox
  // is gone after migration 045 (R26 S01); deleting its rows before 045 is covered by
  // AnalyticsOutboxRetiredTests on a database frozen at 044.
  private static readonly (string Table, string Column)[] UserTables =
  [
    ("users", "user_sub"),
    ("user_entitlements", "user_sub"),
    ("user_subscriptions", "user_sub"),
    ("user_progress_events", "user_sub"),
    ("user_progress", "user_sub"),
    ("user_draw_owned", "user_sub"),
    ("user_draw_meta", "user_sub"),
    ("user_wallet", "user_sub"),
    ("user_deck_wallet", "user_sub"),
    ("user_premium_state", "app_user_id"),
    ("rc_webhook_events", "app_user_id"),
    ("card_reports", "user_sub"),
  ];

  private static JsonElement Event(string method, string path, string? sub)
  {
    object requestContext = sub is null
      ? new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method },
      }
      : new
      {
        requestId = Guid.NewGuid().ToString(),
        http = new { method },
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
      };

    return JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext,
      headers = new Dictionary<string, string>(),
      body = (string?)null,
      isBase64Encoded = false,
    });
  }

  private static async Task<APIGatewayProxyResponse> InvokeAsync(string method, string path, string? sub)
  {
    var req = new LambdaRequest(Event(method, path, sub));
    var res = new Res(req.TraceId);
    var auth = await Auth.GetAuthContextAsync(req);
    return await AccountDeletion.HandleDeleteMe(req, res, auth);
  }

  /// <summary>Inserts one row per user-keyed table.</summary>
  private async Task SeedAllAsync(string sub)
  {
    var eventId = Guid.NewGuid();
    await using var conn = await _db.OpenAsync();

    await DbUtil.ExecuteAsync(conn, null,
      "insert into users (user_sub, email) values ($1, 'f15@example.test')", [sub]);
    await DbUtil.ExecuteAsync(conn, null,
      "insert into user_entitlements (user_sub, entitlement_key, tier, source) values ($1, 'premium_all', 'premium', 'manual')", [sub]);
    await DbUtil.ExecuteAsync(conn, null,
      "insert into user_subscriptions (user_sub, provider, product_id, original_transaction_id, status) values ($1, 'apple', 'p', 'otx-' || $1, 'active')", [sub]);
    await DbUtil.ExecuteAsync(conn, null,
      "insert into user_progress_events (event_id, user_sub, deck_slug, stable_uid, event_time) values ($1, $2, 'd', 'u', now())", [eventId, sub]);
    await DbUtil.ExecuteAsync(conn, null,
      "insert into user_progress (user_sub, deck_slug, stable_uid) values ($1, 'd', 'u')", [sub]);
    await DbUtil.ExecuteAsync(conn, null,
      "insert into user_draw_owned (user_sub, deck_slug, stable_uid) values ($1, 'd', 'u')", [sub]);
    await DbUtil.ExecuteAsync(conn, null,
      "insert into user_draw_meta (user_sub, deck_slug) values ($1, 'd')", [sub]);
    await DbUtil.ExecuteAsync(conn, null,
      "insert into user_wallet (user_sub) values ($1)", [sub]);
    await DbUtil.ExecuteAsync(conn, null,
      "insert into user_deck_wallet (user_sub, deck_slug) values ($1, 'd')", [sub]);
    await DbUtil.ExecuteAsync(conn, null,
      "insert into user_premium_state (app_user_id) values ($1)", [sub]);
    await DbUtil.ExecuteAsync(conn, null,
      "insert into rc_webhook_events (event_id, mode, app_user_id, raw) values ('rc-' || $1, 'development', $1, '{}'::jsonb)", [sub]);
    await DbUtil.ExecuteAsync(conn, null,
      "insert into card_reports (user_sub, deck_slug, stable_uid, reason, note) values ($1, 'd', 'u', 'typo', 'synthetic note')", [sub]);
  }

  /// <summary>Sum of count(*) over UserTables keyed by sub.</summary>
  private async Task<long> CountsAsync(string sub)
  {
    await using var conn = await _db.OpenAsync();

    long total = 0;
    foreach (var (table, column) in UserTables)
    {
      var n = await DbUtil.ExecuteScalarAsync(conn, null,
        $"select count(*) from {table} where {column} = $1", [sub]);
      total += Convert.ToInt64(n);
    }

    return total;
  }

  [Fact]
  public async Task DeleteMe_RemovesEveryRowKeyedByTheCaller()
  {
    var sub = NewSub();
    await SeedAllAsync(sub);
    Assert.True(await CountsAsync(sub) > 0);

    var resp = await InvokeAsync("DELETE", "/api/v1/me", sub);

    Assert.Equal(204, resp.StatusCode);
    Assert.True(string.IsNullOrEmpty(resp.Body));
    Assert.Equal(0, await CountsAsync(sub));
  }

  [Fact]
  public async Task DeleteMe_LeavesOtherUsersUntouched()
  {
    var subA = NewSub();
    var subB = NewSub();
    await SeedAllAsync(subA);
    await SeedAllAsync(subB);

    var resp = await InvokeAsync("DELETE", "/api/v1/me", subA);

    Assert.Equal(204, resp.StatusCode);
    Assert.Equal(0, await CountsAsync(subA));
    // All twelve of B's rows remain, one per user-keyed table.
    Assert.Equal(12, await CountsAsync(subB));
  }

  [Fact]
  public async Task DeleteMe_IsIdempotent()
  {
    var sub = NewSub();
    await SeedAllAsync(sub);

    var first = await InvokeAsync("DELETE", "/api/v1/me", sub);
    Assert.Equal(204, first.StatusCode);

    var second = await InvokeAsync("DELETE", "/api/v1/me", sub);
    Assert.Equal(204, second.StatusCode);

    Assert.Equal(0, await CountsAsync(sub));
  }

  [Fact]
  public async Task DeleteMe_Anonymous_Is403()
  {
    var resp = await InvokeAsync("DELETE", "/api/v1/me", sub: null);
    Assert.Equal(403, resp.StatusCode);
  }

  [Fact]
  public async Task DeleteMe_RejectedBearer_Is401()
  {
    var req = new LambdaRequest(Event("DELETE", "/api/v1/me", sub: null));
    var res = new Res(req.TraceId);
    var auth = new AuthContext(
      Claims: new Dictionary<string, JsonElement>(),
      UserSub: null,
      Username: null,
      Groups: [],
      IsSuperAdmin: false,
      IsEditor: false,
      IsAdmin: false,
      RejectReason: "expired");

    var resp = await AccountDeletion.HandleDeleteMe(req, res, auth);
    Assert.Equal(401, resp.StatusCode);
  }

  [Fact]
  public async Task DeleteMe_IsRoutedOnBothPaths()
  {
    var subMe = NewSub();
    await SeedAllAsync(subMe);
    var meResp = await new VpcFunction().Handler(Event("DELETE", "/api/v1/me", subMe));
    Assert.Equal(204, meResp.StatusCode);
    Assert.Equal(0, await CountsAsync(subMe));

    var subUser = NewSub();
    await SeedAllAsync(subUser);
    var userResp = await new VpcFunction().Handler(Event("DELETE", "/api/v1/user/me", subUser));
    Assert.Equal(204, userResp.StatusCode);
    Assert.Equal(0, await CountsAsync(subUser));
  }

  [Fact]
  public async Task GetMe_IsUnchanged()
  {
    var sub = NewSub();
    var resp = await new VpcFunction().Handler(Event("GET", "/api/v1/me", sub));

    Assert.Equal(200, resp.StatusCode);
    using var doc = JsonDocument.Parse(resp.Body!);
    Assert.Equal(sub, doc.RootElement.GetProperty("data").GetProperty("userSub").GetString());
  }

  [Fact]
  public async Task UserKeyedTables_AreExactlyTheOnesDeletionCovers()
  {
    var rows = await _db.QueryAsync(
      "select distinct table_name from information_schema.columns where table_schema = 'public' and column_name in ('user_sub', 'app_user_id')");

    var actual = rows.Select(r => (string)r["table_name"]!).ToHashSet(StringComparer.Ordinal);
    var expected = UserTables.Select(t => t.Table).ToHashSet(StringComparer.Ordinal);

    Assert.True(
      actual.SetEquals(expected),
      "The set of user-keyed tables changed. A migration added or removed a table with a " +
      "user_sub or app_user_id column. Extend AccountDeletion.DeleteUserDataAsync and this " +
      $"UserTables list together.\n  expected: {string.Join(", ", expected.OrderBy(x => x, StringComparer.Ordinal))}" +
      $"\n  actual:   {string.Join(", ", actual.OrderBy(x => x, StringComparer.Ordinal))}");
  }
}
