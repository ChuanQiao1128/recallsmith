using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.SQS.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Automation;
using RecallSmith.Lambda.Vpc.Qa;
using RecallSmith.Lambda.Vpc.Reports;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Card reports (R20 V05, contract R20-00 §4): the learner's report-a-card POST/GET, the console list and resolve with
/// deck scoping, the per-user UTC-day limit (a duplicate open report does not count), the kill switch, the pre-037 503,
/// the <c>card.reported</c> webhook (no note, no user), the status field, the digest line and the AI-triage hook.
/// Every test uses fresh subs and decks against the fixture database; the pre-037 cases use a scratch database at 036.
/// </summary>
[Collection(PostgresCollection.Name)]
public sealed class CardReportsTests
{
  private const string UserPath = "/api/v1/user/card-reports";
  private const string AdminPath = "/api/v1/admin/card-reports";
  private const string NotReadyName = "it_v05_card_reports_036";

  private static readonly string[] UserItemKeys =
    ["reportId", "deckSlug", "stableUid", "question", "reason", "status", "resolution", "resolutionNote", "createdAt", "resolvedAt"];

  private static readonly string[] AdminItemKeys =
  [
    "reportId", "deckId", "deckSlug", "cardId", "stableUid", "question", "reason", "note", "status", "resolution", "resolutionNote",
    "clientVersion", "createdAt", "resolvedAt",
  ];

  private readonly PostgresFixture _db;
  public CardReportsTests(PostgresFixture db) => _db = db;

  // ---------------------------------------------------------------- kit

  /// <summary>Sets the card report, AI QA and webhook env for one test; restores every value and seam on dispose.</summary>
  private sealed class Scope : IDisposable
  {
    private static readonly string[] Names =
    [
      CardReports.EnabledEnv, CardReports.DailyLimitEnv, CardReports.AiTriageEnv, QaGate.EnabledEnv, QaRuns.QueueUrlEnv, QaRuns.DailyCapEnv,
      QaRuns.EstUsdPerCardEnv, WebhookEvents.QueueUrlEnv,
    ];

    private readonly Dictionary<string, string?> _saved = Names.ToDictionary(n => n, Environment.GetEnvironmentVariable);
    private readonly Func<SendMessageRequest, Task>? _savedQaSeam = QaRuns.TestSendSeam;
    private readonly Func<SendMessageRequest, Task>? _savedWebhookSeam = WebhookEvents.TestSendSeam;

    public List<SendMessageRequest> QaSent { get; } = [];
    public List<SendMessageRequest> WebhookSent { get; } = [];

    public Scope()
    {
      Set(CardReports.EnabledEnv, "1");
      Set(CardReports.DailyLimitEnv, "5");
      Set(CardReports.AiTriageEnv, "0");
      Set(QaGate.EnabledEnv, "0");
      Set(QaRuns.QueueUrlEnv, AutomationTestKit.FakeQaQueueUrl);
      Set(QaRuns.DailyCapEnv, "1000000");
      Set(QaRuns.EstUsdPerCardEnv, "0.05");
      Set(WebhookEvents.QueueUrlEnv, AutomationTestKit.FakeWebhookQueueUrl);
      QaRuns.TestSendSeam = r => { lock (QaSent) QaSent.Add(r); return Task.CompletedTask; };
      WebhookEvents.TestSendSeam = r => { lock (WebhookSent) WebhookSent.Add(r); return Task.CompletedTask; };
    }

    public void Set(string name, string? value) => Environment.SetEnvironmentVariable(name, value);

    public void Dispose()
    {
      foreach (var (name, value) in _saved) Environment.SetEnvironmentVariable(name, value);
      QaRuns.TestSendSeam = _savedQaSeam;
      WebhookEvents.TestSendSeam = _savedWebhookSeam;
    }
  }

  private static string Sub(string tag) => $"it-v05-{tag}-{Guid.NewGuid():N}";

  private static AuthContext Learner(string sub) => new(
    Claims: new Dictionary<string, JsonElement>(), UserSub: sub, Username: null, Groups: [], IsSuperAdmin: false, IsEditor: false, IsAdmin: false);

  private static AuthContext Editor(string sub) => new(
    Claims: new Dictionary<string, JsonElement>(), UserSub: sub, Username: null, Groups: ["editor"], IsSuperAdmin: false, IsEditor: true,
    IsAdmin: true);

  private static AuthContext SuperAdmin(string sub) => AutomationTestKit.Ctx(sub, agent: false);

  private static Task<APIGatewayProxyResponse> PostAsync(AuthContext auth, object? body) =>
    AutomationTestKit.CallAsync(CardReports.HandleUser, "POST", UserPath, body, auth);

  private static Task<APIGatewayProxyResponse> MineAsync(AuthContext auth, IDictionary<string, string>? query = null) =>
    AutomationTestKit.CallAsync(CardReports.HandleUser, "GET", UserPath, null, auth, query);

  private static Task<APIGatewayProxyResponse> ListAsync(AuthContext auth, IDictionary<string, string>? query = null) =>
    AutomationTestKit.CallAsync(CardReports.HandleAdminList, "GET", AdminPath, null, auth, query);

  private static Task<APIGatewayProxyResponse> ResolveAsync(AuthContext auth, string reportId, object? body) =>
    AutomationTestKit.CallAsync((q, r, a) => CardReports.HandleResolve(q, r, a, reportId), "POST", $"{AdminPath}/{reportId}/resolve", body, auth);

  private static Task<APIGatewayProxyResponse> ResolveAsync(AuthContext auth, long reportId, object? body) =>
    ResolveAsync(auth, reportId.ToString(CultureInfo.InvariantCulture), body);

  private static object Report(string deckSlug, string stableUid, string reason = "wrong_answer", string? note = null, string? clientVersion = null) =>
    new { deckSlug, stableUid, reason, note, clientVersion };

  private async Task<(long DeckId, string Slug, long CardId, string Uid)> CardAsync(string tag, string question = "Synthetic reported question?")
  {
    var (deckId, slug) = await AutomationTestKit.NewDeckAsync(_db, $"v05-{tag}");
    var uid = AutomationTestKit.Uid(tag);
    var cardId = await AutomationTestKit.NewCardAsync(_db, deckId, uid, question);
    return (deckId, slug, cardId, uid);
  }

  private async Task<long> NewCardInAsync(long deckId, string tag) =>
    await AutomationTestKit.NewCardAsync(_db, deckId, AutomationTestKit.Uid(tag), $"Synthetic question {tag}?");

  private async Task<string> UidAsync(long cardId) => (string)(await _db.ScalarAsync("select stable_uid from cards where id = $1", cardId))!;

  private static async Task<long> CreateAsync(AuthContext auth, string slug, string uid, string reason = "wrong_answer", string? note = null)
  {
    var data = AutomationTestKit.Data(await PostAsync(auth, Report(slug, uid, reason, note)));
    Assert.False(data.GetProperty("duplicate").GetBoolean());
    return data.GetProperty("reportId").GetInt64();
  }

  private static string[] Keys(JsonElement e) => e.EnumerateObject().Select(p => p.Name).ToArray();

  // ---------------------------------------------------------------- learner POST

  [Fact]
  public async Task CardReport_Post_CreatesOpenReport_StoresNoteAsIs()
  {
    using var scope = new Scope();
    var (deckId, slug, cardId, uid) = await CardAsync("post");
    var sub = Sub("post");

    var note = "  The answer says 5 but the docs say <b>6</b>; see \"limits\" '; drop table cards; --  ";
    var data = AutomationTestKit.Data(await PostAsync(Learner(sub), Report(slug, uid, "outdated", note, " 1.9.0 (23) ")));
    Assert.Equal(["reportId", "status", "duplicate"], Keys(data));
    Assert.Equal("open", data.GetProperty("status").GetString());
    Assert.False(data.GetProperty("duplicate").GetBoolean());
    var reportId = data.GetProperty("reportId").GetInt64();

    var row = (await _db.QueryAsync("select * from card_reports where id = $1", reportId))[0];
    Assert.Equal((sub, deckId, slug, cardId, uid, "outdated", "open"),
      ((string)row["user_sub"]!, AutomationTestKit.Long(row["deck_id"]), (string)row["deck_slug"]!, AutomationTestKit.Long(row["card_id"]),
        (string)row["stable_uid"]!, (string)row["reason"]!, (string)row["status"]!));
    // Stored as is after the trim: never escaped, never executed.
    Assert.Equal(note.Trim(), row["note"]);
    Assert.Equal("1.9.0 (23)", row["client_version"]);
    Assert.Null(row["resolution"]);
  }

  [Fact]
  public async Task CardReport_Post_EmptyNote_IsNull_AndNoteCapIsAfterTrim()
  {
    using var scope = new Scope();
    var (_, slug, _, uid) = await CardAsync("trim");
    var (_, _, _, uid2) = await CardAsync("trim2");
    var id = await CreateAsync(Learner(Sub("empty")), slug, uid, note: "    ");
    Assert.Null(await _db.ScalarAsync("select note from card_reports where id = $1", id));

    // 500 characters after the trim pass, 501 do not.
    var padded = "   " + new string('x', 500) + "   ";
    var ok = await CreateAsync(Learner(Sub("cap")), slug, uid, note: padded);
    Assert.Equal(500, ((string)(await _db.ScalarAsync("select note from card_reports where id = $1", ok))!).Length);
    AutomationTestKit.AssertError(await PostAsync(Learner(Sub("cap")), Report(slug, uid2, note: new string('x', 501))), 400, "VALIDATION_ERROR");
  }

  public static IEnumerable<object[]> InvalidBodies()
  {
    var longKey = new string('a', 129);
    yield return ["not json at all"];
    yield return ["[1, 2]"];
    yield return [new { stableUid = "uid", reason = "typo" }];
    yield return [new { deckSlug = "", stableUid = "uid", reason = "typo" }];
    yield return [new { deckSlug = longKey, stableUid = "uid", reason = "typo" }];
    yield return [new { deckSlug = "deck", stableUid = longKey, reason = "typo" }];
    yield return [new { deckSlug = "deck", stableUid = 42, reason = "typo" }];
    yield return [new { deckSlug = "deck", stableUid = "uid" }];
    yield return [new { deckSlug = "deck", stableUid = "uid", reason = "spam" }];
    yield return [new { deckSlug = "deck", stableUid = "uid", reason = "typo", note = 7 }];
    yield return [new { deckSlug = "deck", stableUid = "uid", reason = "typo", clientVersion = new string('1', 65) }];
  }

  [Theory]
  [MemberData(nameof(InvalidBodies))]
  public async Task CardReport_Post_InvalidBody_Returns400(object body)
  {
    using var scope = new Scope();
    AutomationTestKit.AssertError(await PostAsync(Learner(Sub("invalid")), body), 400, "VALIDATION_ERROR");
  }

  [Fact]
  public async Task CardReport_Post_UnknownOrDeletedCard_Returns404()
  {
    using var scope = new Scope();
    var (deckId, slug, _, uid) = await CardAsync("missing");
    var sub = Sub("missing");
    var deletedCard = await AutomationTestKit.NewCardAsync(_db, deckId, AutomationTestKit.Uid("deleted"), "Deleted card?", isDeleted: 1);

    AutomationTestKit.AssertError(await PostAsync(Learner(sub), Report("it-v05-no-such-deck", uid)), 404, "CARD_NOT_FOUND");
    AutomationTestKit.AssertError(await PostAsync(Learner(sub), Report(slug, "no-such-uid")), 404, "CARD_NOT_FOUND");
    AutomationTestKit.AssertError(await PostAsync(Learner(sub), Report(slug, await UidAsync(deletedCard))), 404, "CARD_NOT_FOUND");

    await _db.QueryAsync("update decks set is_deleted = 1 where id = $1", deckId);
    AutomationTestKit.AssertError(await PostAsync(Learner(sub), Report(slug, uid)), 404, "CARD_NOT_FOUND");
    Assert.Equal(0L, AutomationTestKit.Long(await _db.ScalarAsync("select count(*) from card_reports where user_sub = $1", sub)));
  }

  [Fact]
  public async Task CardReport_Post_Duplicate_ReturnsOpenReport_AndDoesNotCountAgainstLimit()
  {
    using var scope = new Scope();
    scope.Set(CardReports.DailyLimitEnv, "2");
    var (deckId, slug, _, uid) = await CardAsync("dup");
    var sub = Sub("dup");

    var first = await CreateAsync(Learner(sub), slug, uid);
    for (var i = 0; i < 3; i++)
    {
      var again = AutomationTestKit.Data(await PostAsync(Learner(sub), Report(slug, uid, "typo", "second try")));
      Assert.Equal((first, "open", true), (again.GetProperty("reportId").GetInt64(), again.GetProperty("status").GetString(),
        again.GetProperty("duplicate").GetBoolean()));
    }
    Assert.Equal(1L, AutomationTestKit.Long(await _db.ScalarAsync("select count(*) from card_reports where user_sub = $1", sub)));

    // The duplicates did not count: a second new report is still allowed under a limit of 2.
    var other = await NewCardInAsync(deckId, "dup-b");
    await CreateAsync(Learner(sub), slug, await UidAsync(other));
    // The limit is now reached, yet a duplicate still answers with its open report.
    var third = await NewCardInAsync(deckId, "dup-c");
    AutomationTestKit.AssertError(await PostAsync(Learner(sub), Report(slug, await UidAsync(third))), 429, "REPORT_DAILY_LIMIT");
    Assert.True(AutomationTestKit.Data(await PostAsync(Learner(sub), Report(slug, uid))).GetProperty("duplicate").GetBoolean());

    // Another learner reporting the same card is not a duplicate of this one.
    await CreateAsync(Learner(Sub("dup-other")), slug, uid);
    // Once resolved, the same learner may report the card again (the partial unique index covers open reports only).
    Assert.Equal(200, (await ResolveAsync(SuperAdmin(Sub("sa")), first, new { resolution = "fixed" })).StatusCode);
    scope.Set(CardReports.DailyLimitEnv, "5");
    Assert.NotEqual(first, await CreateAsync(Learner(sub), slug, uid));
  }

  [Fact]
  public async Task CardReport_Post_DailyLimit_Returns429_AndCountsOnlyTheCurrentUtcDay()
  {
    using var scope = new Scope();
    scope.Set(CardReports.DailyLimitEnv, "3");
    var (deckId, slug, _, _) = await CardAsync("limit");
    var sub = Sub("limit");
    var cards = new List<string>();
    for (var i = 0; i < 5; i++) cards.Add(await UidAsync(await NewCardInAsync(deckId, $"limit-{i}")));

    // Reports from yesterday (UTC) do not count.
    await _db.QueryAsync(
      """
      insert into card_reports (user_sub, deck_id, deck_slug, stable_uid, reason, status, resolution, created_at)
      select $1, $2, $3, 'old-' || g, 'typo', 'resolved', 'fixed', date_trunc('day', now(), 'UTC') - interval '1 minute'
      from generate_series(1, 4) g
      """, sub, deckId, slug);

    for (var i = 0; i < 3; i++) await CreateAsync(Learner(sub), slug, cards[i]);
    AutomationTestKit.AssertError(await PostAsync(Learner(sub), Report(slug, cards[3])), 429, "REPORT_DAILY_LIMIT");
    // Resolved reports of today still count.
    await _db.QueryAsync("update card_reports set status = 'resolved', resolution = 'invalid' where user_sub = $1 and status = 'open'", sub);
    AutomationTestKit.AssertError(await PostAsync(Learner(sub), Report(slug, cards[3])), 429, "REPORT_DAILY_LIMIT");
    // The limit is per user.
    await CreateAsync(Learner(Sub("limit-other")), slug, cards[3]);
    // The limit is read per call.
    scope.Set(CardReports.DailyLimitEnv, "4");
    await CreateAsync(Learner(sub), slug, cards[3]);
  }

  [Fact]
  public async Task CardReport_Post_ConcurrentReports_NeverExceedTheLimit()
  {
    using var scope = new Scope();
    scope.Set(CardReports.DailyLimitEnv, "2");
    var (deckId, slug, _, _) = await CardAsync("race");
    var sub = Sub("race");
    var uids = new List<string>();
    for (var i = 0; i < 6; i++) uids.Add(await UidAsync(await NewCardInAsync(deckId, $"race-{i}")));

    var responses = await Task.WhenAll(uids.Select(u => PostAsync(Learner(sub), Report(slug, u))));
    Assert.Equal(2, responses.Count(r => r.StatusCode == 200));
    Assert.Equal(4, responses.Count(r => r.StatusCode == 429));
    Assert.Equal(2L, AutomationTestKit.Long(await _db.ScalarAsync("select count(*) from card_reports where user_sub = $1", sub)));
  }

  [Fact]
  public async Task CardReport_Learner_Auth_401And403()
  {
    using var scope = new Scope();
    var bad = Learner(Sub("bad")) with { RejectReason = "expired" };
    var anonymous = Learner(Sub("anon")) with { UserSub = null };
    AutomationTestKit.AssertError(await PostAsync(bad, Report("deck", "uid")), 401, "UNAUTHORIZED");
    AutomationTestKit.AssertError(await MineAsync(bad), 401, "UNAUTHORIZED");
    AutomationTestKit.AssertError(await PostAsync(anonymous, Report("deck", "uid")), 403, "FORBIDDEN");
    AutomationTestKit.AssertError(await MineAsync(anonymous), 403, "FORBIDDEN");
    Assert.Equal(405, (await AutomationTestKit.CallAsync(CardReports.HandleUser, "DELETE", UserPath, null, Learner(Sub("m")))).StatusCode);
  }

  [Fact]
  public async Task CardReport_Disabled_Returns503()
  {
    using var scope = new Scope();
    var (_, slug, _, uid) = await CardAsync("off");
    scope.Set(CardReports.EnabledEnv, "0");
    AutomationTestKit.AssertError(await PostAsync(Learner(Sub("off")), Report(slug, uid)), 503, "CARD_REPORTS_DISABLED");
    AutomationTestKit.AssertError(await MineAsync(Learner(Sub("off"))), 503, "CARD_REPORTS_DISABLED");
    // Unset means the contract default "1".
    scope.Set(CardReports.EnabledEnv, null);
    await CreateAsync(Learner(Sub("default-on")), slug, uid);
  }

  // ---------------------------------------------------------------- learner GET

  [Fact]
  public async Task CardReport_GetMine_ReturnsOwnReportsNewestFirst_WithoutNoteOrUser()
  {
    using var scope = new Scope();
    var longQuestion = "Q" + new string('q', 250);
    var (deckId, slug, _, uid) = await CardAsync("mine", longQuestion);
    var second = await UidAsync(await NewCardInAsync(deckId, "mine-b"));
    var sub = Sub("mine");
    var first = await CreateAsync(Learner(sub), slug, uid, "unclear", "private learner note");
    var newest = await CreateAsync(Learner(sub), slug, second, "typo");
    await CreateAsync(Learner(Sub("mine-other")), slug, uid);
    Assert.Equal(200, (await ResolveAsync(SuperAdmin(Sub("sa")), first, new { resolution = "fixed", note = "Updated the answer." })).StatusCode);

    var response = await MineAsync(Learner(sub));
    Assert.DoesNotContain(sub, response.Body);
    Assert.DoesNotContain("private learner note", response.Body);
    var data = AutomationTestKit.Data(response);
    Assert.Equal(["items"], Keys(data));
    var items = data.GetProperty("items").EnumerateArray().ToList();
    Assert.Equal([newest, first], items.Select(i => i.GetProperty("reportId").GetInt64()).ToArray());
    Assert.All(items, i => Assert.Equal(UserItemKeys, Keys(i)));
    var resolved = items[1];
    Assert.Equal((slug, uid, "unclear", "resolved", "fixed", "Updated the answer."), (resolved.GetProperty("deckSlug").GetString(),
      resolved.GetProperty("stableUid").GetString(), resolved.GetProperty("reason").GetString(), resolved.GetProperty("status").GetString(),
      resolved.GetProperty("resolution").GetString(), resolved.GetProperty("resolutionNote").GetString()));
    Assert.Equal(longQuestion[..200], resolved.GetProperty("question").GetString());
    Assert.EndsWith("Z", resolved.GetProperty("createdAt").GetString());
    Assert.EndsWith("Z", resolved.GetProperty("resolvedAt").GetString());
    Assert.Equal(JsonValueKind.Null, items[0].GetProperty("resolvedAt").ValueKind);

    var limited = AutomationTestKit.Data(await MineAsync(Learner(sub), new Dictionary<string, string> { ["limit"] = "1" }));
    Assert.Equal([newest], limited.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("reportId").GetInt64()).ToArray());
    AutomationTestKit.AssertError(await MineAsync(Learner(sub), new Dictionary<string, string> { ["limit"] = "0" }), 400, "VALIDATION_ERROR");
    AutomationTestKit.AssertError(await MineAsync(Learner(sub), new Dictionary<string, string> { ["limit"] = "abc" }), 400, "VALIDATION_ERROR");
    Assert.Empty(AutomationTestKit.Data(await MineAsync(Learner(Sub("nobody")))).GetProperty("items").EnumerateArray());
  }

  // ---------------------------------------------------------------- console list

  [Fact]
  public async Task CardReport_AdminList_ReturnsReportsWithNote_NeverUserSub_AndPages()
  {
    using var scope = new Scope();
    var (deckId, slug, cardId, uid) = await CardAsync("admin-list");
    var sub = Sub("admin-list");
    var reportId = await CreateAsync(Learner(sub), slug, uid, "wrong_answer", "the note for admins");
    var second = await CreateAsync(Learner(Sub("admin-list-2")), slug, uid, "typo");

    var response = await ListAsync(SuperAdmin(Sub("sa")), new Dictionary<string, string> { ["deckId"] = deckId.ToString(CultureInfo.InvariantCulture) });
    Assert.DoesNotContain(sub, response.Body);
    Assert.DoesNotContain("userSub", response.Body);
    Assert.DoesNotContain("email", response.Body, StringComparison.OrdinalIgnoreCase);
    var data = AutomationTestKit.Data(response);
    Assert.Equal(["items", "nextCursor"], Keys(data));
    var items = data.GetProperty("items").EnumerateArray().ToList();
    Assert.Equal([second, reportId], items.Select(i => i.GetProperty("reportId").GetInt64()).ToArray());
    Assert.All(items, i => Assert.Equal(AdminItemKeys, Keys(i)));
    var item = items[1];
    Assert.Equal((deckId, slug, cardId, uid, "wrong_answer", "the note for admins", "open"), (item.GetProperty("deckId").GetInt64(),
      item.GetProperty("deckSlug").GetString(), item.GetProperty("cardId").GetInt64(), item.GetProperty("stableUid").GetString(),
      item.GetProperty("reason").GetString(), item.GetProperty("note").GetString(), item.GetProperty("status").GetString()));
    Assert.Equal("Synthetic reported question?", item.GetProperty("question").GetString());
    Assert.Equal(JsonValueKind.Null, data.GetProperty("nextCursor").ValueKind);

    // Keyset paging.
    var deck = deckId.ToString(CultureInfo.InvariantCulture);
    var page1 = AutomationTestKit.Data(await ListAsync(SuperAdmin(Sub("sa")), new Dictionary<string, string> { ["deckId"] = deck, ["limit"] = "1" }));
    Assert.Equal(second, page1.GetProperty("items")[0].GetProperty("reportId").GetInt64());
    var cursor = page1.GetProperty("nextCursor").GetString()!;
    var page2 = AutomationTestKit.Data(await ListAsync(SuperAdmin(Sub("sa")),
      new Dictionary<string, string> { ["deckId"] = deck, ["limit"] = "1", ["cursor"] = cursor }));
    Assert.Equal(reportId, page2.GetProperty("items")[0].GetProperty("reportId").GetInt64());

    // Status filter: open by default, resolved and all on request.
    Assert.Equal(200, (await ResolveAsync(SuperAdmin(Sub("sa")), reportId, new { resolution = "invalid" })).StatusCode);
    long[] Ids(string? status)
    {
      var q = new Dictionary<string, string> { ["deckId"] = deck };
      if (status is not null) q["status"] = status;
      return AutomationTestKit.Data(ListAsync(SuperAdmin(Sub("sa")), q).GetAwaiter().GetResult())
        .GetProperty("items").EnumerateArray().Select(i => i.GetProperty("reportId").GetInt64()).ToArray();
    }
    Assert.Equal([second], Ids(null));
    Assert.Equal([second], Ids("open"));
    Assert.Equal([reportId], Ids("resolved"));
    Assert.Equal([second, reportId], Ids("all"));

    foreach (var bad in new[] { new Dictionary<string, string> { ["status"] = "closed" }, new() { ["deckId"] = "x" }, new() { ["deckId"] = "0" },
               new() { ["limit"] = "101" }, new() { ["cursor"] = "%%%" } })
    {
      AutomationTestKit.AssertError(await ListAsync(SuperAdmin(Sub("sa")), bad), 400, "VALIDATION_ERROR");
    }
  }

  [Fact]
  public async Task CardReport_AdminList_IsDeckScoped()
  {
    using var scope = new Scope();
    var (deckA, slugA, _, uidA) = await CardAsync("scope-a");
    var (deckB, slugB, _, uidB) = await CardAsync("scope-b");
    var inA = await CreateAsync(Learner(Sub("scope")), slugA, uidA);
    var inB = await CreateAsync(Learner(Sub("scope")), slugB, uidB);
    var editor = Sub("editor");
    await _db.QueryAsync("insert into admin_deck_permissions (admin_sub, deck_id, can_read, can_write) values ($1, $2, 1, 0)", editor, deckA);

    var all = AutomationTestKit.Data(await ListAsync(Editor(editor), new Dictionary<string, string> { ["status"] = "all", ["limit"] = "100" }));
    var ids = all.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("reportId").GetInt64()).ToList();
    Assert.Contains(inA, ids);
    Assert.DoesNotContain(inB, ids);
    Assert.All(all.GetProperty("items").EnumerateArray(), i => Assert.Equal(deckA, i.GetProperty("deckId").GetInt64()));

    AutomationTestKit.AssertError(await ListAsync(Editor(editor), new Dictionary<string, string> { ["deckId"] = deckB.ToString(CultureInfo.InvariantCulture) }),
      403, "FORBIDDEN");
    // An editor without any grant sees nothing.
    Assert.Empty(AutomationTestKit.Data(await ListAsync(Editor(Sub("no-grant")))).GetProperty("items").EnumerateArray());
    // A super_admin sees both decks.
    var sa = AutomationTestKit.Data(await ListAsync(SuperAdmin(Sub("sa")), new Dictionary<string, string> { ["limit"] = "100" }))
      .GetProperty("items").EnumerateArray().Select(i => i.GetProperty("reportId").GetInt64()).ToList();
    Assert.Contains(inA, sa);
    Assert.Contains(inB, sa);
  }

  [Fact]
  public async Task CardReport_Admin_Auth_401And403()
  {
    using var scope = new Scope();
    var learner = Learner(Sub("learner"));
    var bad = Editor(Sub("bad")) with { RejectReason = "expired" };
    var mobileToken = Editor(Sub("mobile")) with { AdminDenyReason = "client" };
    AutomationTestKit.AssertError(await ListAsync(bad), 401, "UNAUTHORIZED");
    AutomationTestKit.AssertError(await ListAsync(learner), 403, "FORBIDDEN");
    AutomationTestKit.AssertError(await ListAsync(mobileToken), 403, "FORBIDDEN");
    AutomationTestKit.AssertError(await ResolveAsync(bad, 1, new { resolution = "fixed" }), 401, "UNAUTHORIZED");
    AutomationTestKit.AssertError(await ResolveAsync(learner, 1, new { resolution = "fixed" }), 403, "FORBIDDEN");
    AutomationTestKit.AssertError(await ResolveAsync(mobileToken, 1, new { resolution = "fixed" }), 403, "FORBIDDEN");
  }

  // ---------------------------------------------------------------- console resolve

  [Fact]
  public async Task CardReport_Resolve_NeedsDeckWrite_Then409()
  {
    using var scope = new Scope();
    var (deckId, slug, _, uid) = await CardAsync("resolve");
    var reportId = await CreateAsync(Learner(Sub("resolve")), slug, uid);
    var editor = Sub("resolver");
    await _db.QueryAsync("insert into admin_deck_permissions (admin_sub, deck_id, can_read, can_write) values ($1, $2, 1, 0)", editor, deckId);

    AutomationTestKit.AssertError(await ResolveAsync(Editor(editor), reportId, new { resolution = "fixed" }), 403, "FORBIDDEN");
    AutomationTestKit.AssertError(await ResolveAsync(Editor(Sub("stranger")), reportId, new { resolution = "fixed" }), 403, "FORBIDDEN");
    await _db.QueryAsync("update admin_deck_permissions set can_write = 1 where admin_sub = $1", editor);

    AutomationTestKit.AssertError(await ResolveAsync(Editor(editor), reportId, new { resolution = "done" }), 400, "VALIDATION_ERROR");
    AutomationTestKit.AssertError(await ResolveAsync(Editor(editor), reportId, new { }), 400, "VALIDATION_ERROR");
    AutomationTestKit.AssertError(await ResolveAsync(Editor(editor), reportId, new { resolution = "fixed", note = new string('n', 501) }), 400,
      "VALIDATION_ERROR");
    AutomationTestKit.AssertError(await ResolveAsync(Editor(editor), reportId, "{"), 400, "VALIDATION_ERROR");

    var data = AutomationTestKit.Data(await ResolveAsync(Editor(editor), reportId, new { resolution = "wont_fix", note = "  Correct as written.  " }));
    Assert.Equal(["reportId", "status", "resolution"], Keys(data));
    Assert.Equal((reportId, "resolved", "wont_fix"), (data.GetProperty("reportId").GetInt64(), data.GetProperty("status").GetString(),
      data.GetProperty("resolution").GetString()));
    var row = (await _db.QueryAsync("select * from card_reports where id = $1", reportId))[0];
    Assert.Equal(("resolved", "wont_fix", "Correct as written.", editor), ((string)row["status"]!, (string)row["resolution"]!,
      (string)row["resolution_note"]!, (string)row["resolved_by_sub"]!));
    Assert.NotNull(row["resolved_at"]);

    AutomationTestKit.AssertError(await ResolveAsync(Editor(editor), reportId, new { resolution = "fixed" }), 409, "ALREADY_RESOLVED");
    Assert.Equal("wont_fix", await _db.ScalarAsync("select resolution from card_reports where id = $1", reportId));
  }

  [Fact]
  public async Task CardReport_Resolve_UnknownReport_Returns404()
  {
    using var scope = new Scope();
    var sa = SuperAdmin(Sub("sa"));
    AutomationTestKit.AssertError(await ResolveAsync(sa, long.MaxValue, new { resolution = "fixed" }), 404, "REPORT_NOT_FOUND");
    AutomationTestKit.AssertError(await ResolveAsync(sa, "abc", new { resolution = "fixed" }), 404, "REPORT_NOT_FOUND");
    AutomationTestKit.AssertError(await ResolveAsync(sa, "-3", new { resolution = "fixed" }), 404, "REPORT_NOT_FOUND");
  }

  // ---------------------------------------------------------------- webhook

  [Fact]
  public async Task CardReport_Post_EnqueuesCardReportedWebhook_WithoutNoteOrUser()
  {
    using var scope = new Scope();
    var (_, slug, _, uid) = await CardAsync("hook");
    var subscriptionId = AutomationTestKit.Long(await _db.ScalarAsync(
      "insert into webhook_subscriptions (name, url, events) values ('it-v05', 'https://example.com/v05-hook', array['card.reported']) returning id"));
    try
    {
      var sub = Sub("hook");
      var reportId = await CreateAsync(Learner(sub), slug, uid, "typo", "secret learner note");

      var messages = scope.WebhookSent.Select(m => JsonDocument.Parse(m.MessageBody).RootElement.Clone())
        .Where(m => m.GetProperty("event").GetString() == "card.reported").ToList();
      var message = Assert.Single(messages);
      Assert.DoesNotContain("secret learner note", message.GetRawText());
      Assert.DoesNotContain(sub, message.GetRawText());
      using var body = JsonDocument.Parse(message.GetProperty("body").GetString()!);
      var data = body.RootElement.GetProperty("data");
      Assert.Equal(["reportId", "deckSlug", "stableUid", "reason", "createdAt"], Keys(data));
      Assert.Equal((reportId, slug, uid, "typo"), (data.GetProperty("reportId").GetInt64(), data.GetProperty("deckSlug").GetString(),
        data.GetProperty("stableUid").GetString(), data.GetProperty("reason").GetString()));
      Assert.Matches(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$", data.GetProperty("createdAt").GetString()!);
      Assert.Equal(1L, AutomationTestKit.Long(await _db.ScalarAsync(
        "select count(*) from webhook_deliveries where subscription_id = $1 and event = 'card.reported'", subscriptionId)));

      // A duplicate emits nothing.
      scope.WebhookSent.Clear();
      Assert.True(AutomationTestKit.Data(await PostAsync(Learner(sub), Report(slug, uid))).GetProperty("duplicate").GetBoolean());
      Assert.Empty(scope.WebhookSent);
    }
    finally
    {
      await _db.QueryAsync("update webhook_subscriptions set deleted_at = now() where id = $1", subscriptionId);
    }
  }

  [Fact]
  public void CardReport_WebhookEvent_IsSubscribable() =>
    Assert.Contains("card.reported", WebhookEvents.SubscribableEvents);

  [Fact]
  public async Task CardReport_Migration_WidensWebhookEventsCheck()
  {
    var nine = WebhookEvents.SubscribableEvents.ToArray();
    Assert.Equal(9, nine.Length);
    var id = await _db.ScalarAsync("insert into webhook_subscriptions (name, url, events) values ('it-v05-check', 'https://example.com/v05-check', $1) returning id",
      [nine]);
    await _db.QueryAsync("update webhook_subscriptions set deleted_at = now() where id = $1", id);
    var ex = await Assert.ThrowsAsync<PostgresException>(() => _db.QueryAsync(
      "insert into webhook_subscriptions (name, url, events) values ('it-v05-bad', 'https://example.com/v05-bad', array['card.deleted'])"));
    Assert.Equal("ck_webhook_subscriptions_events", ex.ConstraintName);
  }

  // ---------------------------------------------------------------- AI triage hook

  [Fact]
  public async Task CardReport_Triage_Off_StartsNothing()
  {
    using var scope = new Scope();
    scope.Set(QaGate.EnabledEnv, "1");
    var (deckId, slug, _, uid) = await CardAsync("triage-off");
    await CreateAsync(Learner(Sub("triage-off")), slug, uid, note: "note");
    Assert.Equal(0L, AutomationTestKit.Long(await _db.ScalarAsync("select count(*) from ai_qa_runs where deck_id = $1", deckId)));
    Assert.Empty(scope.QaSent);
  }

  [Fact]
  public async Task CardReport_Triage_OnWithAiQaOff_RecordsNothingAndDoesNotThrow()
  {
    using var scope = new Scope();
    scope.Set(CardReports.AiTriageEnv, "1");
    scope.Set(QaGate.EnabledEnv, "0");
    var (deckId, slug, cardId, uid) = await CardAsync("triage-qa-off");
    await CreateAsync(Learner(Sub("triage-qa-off")), slug, uid, note: "note");
    Assert.Equal(0L, AutomationTestKit.Long(await _db.ScalarAsync("select count(*) from ai_qa_runs where deck_id = $1", deckId)));
    Assert.Empty(scope.QaSent);

    await using var conn = new NpgsqlConnection(_db.ConnectionString);
    await conn.OpenAsync();
    Assert.Null(await CardReports.TriageAsync(conn, 1, deckId, cardId));
  }

  [Fact]
  public async Task CardReport_Triage_OnWithAiQaOn_RechecksTheOneCard_WithoutTheNote()
  {
    using var scope = new Scope();
    scope.Set(CardReports.AiTriageEnv, "1");
    scope.Set(QaGate.EnabledEnv, "1");
    var (deckId, slug, cardId, uid) = await CardAsync("triage-on");
    await NewCardInAsync(deckId, "triage-other");
    const string note = "TRIAGE-NOTE-must-never-reach-a-model";
    var sub = Sub("triage-on");
    await CreateAsync(Learner(sub), slug, uid, note: note);

    var run = Assert.Single(await _db.QueryAsync("select scope, card_count, requested_by_sub from ai_qa_runs where deck_id = $1", deckId));
    Assert.Equal(("cards", 1, CardReports.TriageTrigger), ((string)run["scope"]!, Convert.ToInt32(run["card_count"], CultureInfo.InvariantCulture),
      (string)run["requested_by_sub"]!));
    var sent = Assert.Single(scope.QaSent);
    Assert.DoesNotContain(note, sent.MessageBody);
    Assert.DoesNotContain(sub, sent.MessageBody);
    using var message = JsonDocument.Parse(sent.MessageBody);
    Assert.Equal([cardId], message.RootElement.GetProperty("cards").EnumerateArray().Select(c => c.GetProperty("cardId").GetInt64()).ToArray());
  }

  // ---------------------------------------------------------------- status and digest

  [Fact]
  public async Task CardReport_AutomationStatus_HasCardReportsCounts()
  {
    using var scope = new Scope();
    var status = async () => AutomationTestKit.Data(await AutomationTestKit.CallAsync(StatusRoutes.HandleStatus, "GET",
      "/api/v1/admin/automation/status", null, SuperAdmin(Sub("sa")))).GetProperty("cardReports");
    var before = await status();
    Assert.Equal(["open", "openedLast7d"], Keys(before));

    var (deckId, slug, _, uid) = await CardAsync("status");
    var resolvedId = await CreateAsync(Learner(Sub("status")), slug, uid);
    await CreateAsync(Learner(Sub("status-2")), slug, uid);
    Assert.Equal(200, (await ResolveAsync(SuperAdmin(Sub("sa")), resolvedId, new { resolution = "fixed" })).StatusCode);
    await _db.QueryAsync(
      "insert into card_reports (user_sub, deck_id, deck_slug, stable_uid, reason, created_at) values ($1, $2, $3, 'old-open', 'other', now() - interval '8 days')",
      Sub("status-old"), deckId, slug);

    var after = await status();
    Assert.Equal(before.GetProperty("open").GetInt64() + 2, after.GetProperty("open").GetInt64());
    Assert.Equal(before.GetProperty("openedLast7d").GetInt64() + 2, after.GetProperty("openedLast7d").GetInt64());
  }

  [Fact]
  public void CardReport_WeeklyDigest_HasCardReportsLine()
  {
    var body = EmailTemplates.WeeklyDigest("live", EmailTemplatesTests.Digest() with { CardReportsOpen = 4, CardReportsNew = 3 },
      "https://console.developercards.app").BodyText;
    Assert.Contains("\nCard reports: 4 open (3 new this week)\n", body);
  }

  [Fact]
  public async Task CardReport_DigestCounts_CountTheWeek()
  {
    using var scope = new Scope();
    var (deckId, slug, _, uid) = await CardAsync("digest");
    var start = DateTime.UtcNow.AddDays(-30);
    var end = DateTime.UtcNow.AddDays(-20);
    await using var conn = new NpgsqlConnection(_db.ConnectionString);
    await conn.OpenAsync();
    var baseline = await CardReports.CreatedBetweenAsync(conn, start, end);
    await _db.QueryAsync(
      "insert into card_reports (user_sub, deck_id, deck_slug, stable_uid, reason, created_at) values ($1, $2, $3, $4, 'other', $5)",
      Sub("digest"), deckId, slug, uid, DateTime.UtcNow.AddDays(-25));
    Assert.Equal(baseline + 1, await CardReports.CreatedBetweenAsync(conn, start, end));
  }

  // ---------------------------------------------------------------- account deletion

  [Fact]
  public async Task CardReport_AccountDeletion_RemovesTheLearnersReports()
  {
    using var scope = new Scope();
    var (_, slug, _, uid) = await CardAsync("delete");
    var sub = Sub("delete");
    var other = Sub("delete-other");
    await CreateAsync(Learner(sub), slug, uid, note: "to be deleted");
    await CreateAsync(Learner(other), slug, uid);
    await using var conn = new NpgsqlConnection(_db.ConnectionString);
    await conn.OpenAsync();
    Assert.Equal(1, (await RecallSmith.Lambda.Vpc.Runtime.AccountDeletion.DeleteUserDataAsync(conn, sub)).CardReportRows);
    Assert.Equal(0L, AutomationTestKit.Long(await _db.ScalarAsync("select count(*) from card_reports where user_sub = $1", sub)));
    Assert.Equal(1L, AutomationTestKit.Long(await _db.ScalarAsync("select count(*) from card_reports where user_sub = $1", other)));
  }

  // ---------------------------------------------------------------- before migration 037

  [Fact]
  public async Task CardReport_MissingTable_Returns503NotReady_AndZeroCounts()
  {
    using var scope = new Scope();
    var cs = await _db.CreateScratchDatabaseAsync(NotReadyName);
    string slug, uid;
    await using (var conn = new NpgsqlConnection(cs))
    {
      await conn.OpenAsync();
      await PostgresFixture.ApplyMigrationsAsync(conn, 36);
      Assert.Null(await DbUtil.ExecuteScalarAsync(conn, null, "select to_regclass('card_reports')::text", []));
      slug = $"it-v05-notready-{Guid.NewGuid():N}";
      var deckId = AutomationTestKit.Long(await DbUtil.ExecuteScalarAsync(conn, null,
        "insert into decks (slug, title, author) values ($1, 'deck v05', 'tests') returning id", [slug]));
      uid = AutomationTestKit.Uid("notready");
      await DbUtil.ExecuteAsync(conn, null,
        "insert into cards (deck_id, stable_uid, question, explanation, difficulty, order_in_deck) values ($1, $2, 'Q?', 'E.', 2, 10)", [deckId, uid]);

      Assert.Equal(new CardReports.Counts(0, 0), await CardReports.CountsAsync(conn));
      Assert.Equal(0L, await CardReports.CreatedBetweenAsync(conn, DateTime.UtcNow.AddDays(-7), DateTime.UtcNow));
      // Account deletion skips the missing table instead of failing its transaction.
      var deleted = await RecallSmith.Lambda.Vpc.Runtime.AccountDeletion.DeleteUserDataAsync(conn, Sub("nr-delete"));
      Assert.Equal(0, deleted.CardReportRows);
    }

    var savedDb = Environment.GetEnvironmentVariable("PGDATABASE");
    var savedMode = Environment.GetEnvironmentVariable(AutomationMode.EnvName);
    try
    {
      Environment.SetEnvironmentVariable("PGDATABASE", NotReadyName);
      Environment.SetEnvironmentVariable(AutomationMode.EnvName, AutomationMode.DryRun);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();

      var sa = SuperAdmin(Sub("sa"));
      AutomationTestKit.AssertError(await PostAsync(Learner(Sub("nr")), Report(slug, uid)), 503, "NOT_READY");
      AutomationTestKit.AssertError(await MineAsync(Learner(Sub("nr"))), 503, "NOT_READY");
      AutomationTestKit.AssertError(await ListAsync(sa), 503, "NOT_READY");
      AutomationTestKit.AssertError(await ResolveAsync(sa, 1, new { resolution = "fixed" }), 503, "NOT_READY");

      var status = AutomationTestKit.Data(await AutomationTestKit.CallAsync(StatusRoutes.HandleStatus, "GET", "/api/v1/admin/automation/status", null, sa));
      Assert.Equal((0L, 0L), (status.GetProperty("cardReports").GetProperty("open").GetInt64(),
        status.GetProperty("cardReports").GetProperty("openedLast7d").GetInt64()));
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", savedDb);
      Environment.SetEnvironmentVariable(AutomationMode.EnvName, savedMode);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
    }
  }
}
