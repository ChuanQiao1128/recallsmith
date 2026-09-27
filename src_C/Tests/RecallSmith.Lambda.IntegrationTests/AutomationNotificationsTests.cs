using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Automation;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Automation email (R18A A04, contract A00 §8.6, §12.3–§12.5, §13) against the shared Postgres: the email log and its
/// dedupe, the notifier SQS message (asserted against the literal A00 §12.5 JSON), enqueue failures, the notifier's
/// report call (A00 §12.3 body), the console routes and the test email, and the two hooks A02/A03 left. The notifier
/// Lambda is contract-only: SQS sends go through <see cref="Notifications.TestSendSeam"/>, reports are signed here with
/// the fake <c>test-secret</c>. No row, message or response carries a recipient.
/// </summary>
[Collection(PostgresCollection.Name)]
public class AutomationNotificationsTests
{
  private const string ListPath = "/api/v1/admin/automation/notifications";
  private static readonly string[] NotificationKeys =
    ["notificationId", "kind", "subkind", "subject", "mode", "status", "attempts", "sesMessageId", "errorCode", "error", "runId", "createdAt", "sentAt"];

  private readonly PostgresFixture _db;
  private readonly A04Kit.Sql _sql;

  public AutomationNotificationsTests(PostgresFixture db)
  {
    _db = db;
    _sql = new A04Kit.Sql(db.ConnectionString);
  }

  private static AuthContext Editor() => new(
    Claims: new Dictionary<string, JsonElement>(), UserSub: AutomationTestKit.Sub("editor"), Username: null, Groups: ["editor"],
    IsSuperAdmin: false, IsEditor: true, IsAdmin: true, IsAgentClient: false);

  private static AuthContext SuperAdmin() => AutomationTestKit.Ctx(AutomationTestKit.Sub("sa"), agent: false);

  private static NotificationRequest Request(string mode, string? dedupeKey = null, string kind = "batch_summary") =>
    new(kind, null, dedupeKey ?? $"it-a04:{Guid.NewGuid():N}", mode,
      EmailTemplates.BatchSummary(mode, EmailTemplatesTests.Batch(), "https://console.example.com"));

  private async Task<NotificationResult?> EnqueueAsync(NotificationRequest request)
  {
    await using var conn = await _db.OpenAsync();
    return await Notifications.EnqueueAsync(conn, request);
  }

  private async Task<Dictionary<string, object?>> RowAsync(Guid notificationId) =>
    (await _sql.QueryAsync("select * from automation_notifications where notification_id = $1", notificationId)).Single();

  private static Task<APIGatewayProxyResponse> TestEmailAsync(AuthContext auth) =>
    AutomationTestKit.CallAsync(Notifications.HandleTest, "POST", ListPath + "/test", new { }, auth);

  private static object Report(Guid id, string status, int attempt = 1, string? sesMessageId = null, string? errorCode = null, string? error = null)
  {
    // The A00 §12.3 body with this call's values, key for key.
    using var contract = JsonDocument.Parse(A04Kit.ContractReportJson);
    var body = new Dictionary<string, object?>(StringComparer.Ordinal);
    foreach (var p in contract.RootElement.EnumerateObject())
    {
      body[p.Name] = p.Name switch
      {
        "v" => 1,
        "notificationId" => id,
        "status" => status,
        "sesMessageId" => sesMessageId,
        "errorCode" => errorCode,
        "error" => error,
        "attempt" => attempt,
        _ => throw new InvalidOperationException(p.Name),
      };
    }
    return body;
  }

  // ---------------------------------------------------------------- enqueue (A00 §12.5)

  [Fact]
  public async Task Enqueue_DedupeKey_SendsOnce()
  {
    await using var scope = new A04Kit.Scope();
    var key = $"it-a04-dedupe:{Guid.NewGuid():N}";

    var first = await EnqueueAsync(Request("dry_run", key));
    var second = await EnqueueAsync(Request("dry_run", key));

    Assert.True(first!.Created);
    Assert.Equal("queued", first.Status);
    Assert.False(second!.Created);
    Assert.Equal(first.NotificationId, second.NotificationId);
    Assert.Single(scope.NotifySent);
    Assert.Equal(1, await _sql.CountAsync("select count(*) from automation_notifications where dedupe_key = $1", key));
    var row = await RowAsync(first.NotificationId);
    Assert.Equal(1, Convert.ToInt32(row["attempts"], CultureInfo.InvariantCulture));
  }

  [Fact]
  public async Task Enqueue_NoQueueUrl_IsEnqueueFailedNotConfigured()
  {
    await using var scope = new A04Kit.Scope();
    scope.Set(AutomationEnv.NotifyQueueUrlEnv, " ");

    NotificationResult? result = null;
    var stdout = await EmfCapture.StdoutAsync(async () => result = await EnqueueAsync(Request("dry_run")));

    Assert.Equal("enqueue_failed", result!.Status);
    var row = await RowAsync(result.NotificationId);
    // R18B K6 (backend-design-5): a not-configured send counts as an attempt, so MaxSendAttempts bounds its retries.
    Assert.Equal(("enqueue_failed", "NOTIFY_NOT_CONFIGURED", 1),
      ((string)row["status"]!, (string)row["error_code"]!, Convert.ToInt32(row["attempts"], CultureInfo.InvariantCulture)));
    Assert.Equal(1, EmfCapture.GaugeSum(stdout, Notifications.EnqueueFailuresMetric));
    Assert.Empty(scope.NotifySent);
  }

  [Fact]
  public async Task Enqueue_SqsFailure_IsEnqueueFailed()
  {
    await using var scope = new A04Kit.Scope();
    scope.FailNotify = true;

    NotificationResult? result = null;
    var stdout = await EmfCapture.StdoutAsync(async () => result = await EnqueueAsync(Request("live")));

    Assert.True(result!.Created);
    Assert.Equal("enqueue_failed", result.Status);
    var row = await RowAsync(result.NotificationId);
    Assert.Equal(("enqueue_failed", "ENQUEUE_FAILED", 1),
      ((string)row["status"]!, (string)row["error_code"]!, Convert.ToInt32(row["attempts"], CultureInfo.InvariantCulture)));
    Assert.Contains("synthetic SQS failure", (string)row["error"]!);
    Assert.Equal(1, EmfCapture.GaugeSum(stdout, Notifications.EnqueueFailuresMetric));
  }

  [Fact]
  public async Task Enqueue_ModeOff_SendsOnlyTheTestEmail()
  {
    await using var scope = new A04Kit.Scope(AutomationMode.Off);
    var key = $"it-a04-off:{Guid.NewGuid():N}";

    Assert.Null(await EnqueueAsync(Request("off", key)));
    await using (var conn = await _db.OpenAsync())
    {
      Assert.Null(await Notifications.RaiseExceptionAsync(conn, "eval_gate_missing", key + ":exception", new Dictionary<string, string>()));
    }
    Assert.Equal(0, await _sql.CountAsync("select count(*) from automation_notifications where dedupe_key like $1", key + "%"));
    Assert.Empty(scope.NotifySent);

    var data = AutomationTestKit.Data(await TestEmailAsync(SuperAdmin()));
    var id = data.GetProperty("notificationId").GetGuid();
    var row = await RowAsync(id);
    Assert.Equal(("test", "off", $"test:{id:D}", "[DeveloperCards] Test email"),
      ((string)row["kind"]!, (string)row["mode"]!, (string)row["dedupe_key"]!, (string)row["subject"]!));
    var message = Assert.Single(A04Kit.Messages(scope));
    Assert.Equal("off", message.GetProperty("mode").GetString());
  }

  [Fact]
  public async Task Enqueue_Exception_EmitsAutomationExceptionWebhook()
  {
    await using var scope = new A04Kit.Scope();
    scope.Set(WebhookEvents.QueueUrlEnv, AutomationTestKit.FakeWebhookQueueUrl);
    var subscriptionId = A04Kit.Long(await _sql.ScalarAsync(
      "insert into webhook_subscriptions (name, url, events, is_active) values ($1, $2, $3, true) returning id",
      $"it-a04-{Guid.NewGuid():N}"[..20], $"https://hooks.example.com/it-a04/{Guid.NewGuid():N}", new[] { "automation.exception" }));
    try
    {
      var runId = Guid.NewGuid();
      var key = $"exception:publish_blocked:it-a04-{Guid.NewGuid():N}";
      var facts = new Dictionary<string, string>
      {
        ["publishId"] = "99", ["deckId"] = "12", ["deckSlug"] = "aws-saa-c03", ["reason"] = "AI_QA_BLOCKED", ["reasonDetail"] = "x", ["runId"] = runId.ToString(),
      };
      await using (var conn = await _db.OpenAsync())
      {
        Assert.True((await Notifications.RaiseExceptionAsync(conn, "publish_blocked", key, facts))!.Created);
        Assert.False((await Notifications.RaiseExceptionAsync(conn, "publish_blocked", key, facts))!.Created);
      }

      var delivery = (await _sql.QueryAsync("select body from webhook_deliveries where subscription_id = $1 and event = 'automation.exception'", subscriptionId)).Single();
      using var doc = JsonDocument.Parse((string)delivery["body"]!);
      var data = doc.RootElement.GetProperty("data");
      Assert.Equal(["subkind", "mode", "summary", "refs", "consoleUrl"], A04Kit.Keys(data));
      Assert.Equal("publish_blocked", data.GetProperty("subkind").GetString());
      Assert.Equal("dry_run", data.GetProperty("mode").GetString());
      Assert.Equal("Action needed: publish aws-saa-c03 (AI_QA_BLOCKED)", data.GetProperty("summary").GetString());
      Assert.Equal(runId, data.GetProperty("refs").GetProperty("runId").GetGuid());
      Assert.Equal(12, data.GetProperty("refs").GetProperty("deckId").GetInt64());
      Assert.False(data.GetProperty("refs").TryGetProperty("publishId", out _));
      Assert.Equal($"https://console.example.com/automation?runId={runId:D}", data.GetProperty("consoleUrl").GetString());
      Assert.Contains(scope.WebhookSent, r => r.QueueUrl == AutomationTestKit.FakeWebhookQueueUrl);
    }
    finally
    {
      await _sql.QueryAsync("update webhook_subscriptions set is_active = false where id = $1", subscriptionId);
    }
  }

  [Fact]
  public async Task SqsMessage_MatchesTheContractShape()
  {
    await using var scope = new A04Kit.Scope();
    var request = Request("dry_run");
    var result = await EnqueueAsync(request);

    var sent = Assert.Single(scope.NotifySent);
    Assert.Equal(A04Kit.FakeNotifyQueueUrl, sent.QueueUrl);
    using var contract = JsonDocument.Parse(A04Kit.ContractNotifyMessageJson);
    using var actual = JsonDocument.Parse(sent.MessageBody);
    var m = actual.RootElement;
    Assert.Equal(A04Kit.Keys(contract.RootElement), A04Kit.Keys(m));
    Assert.Equal(1, m.GetProperty("v").GetInt32());
    Assert.Equal(result!.NotificationId, m.GetProperty("notificationId").GetGuid());
    Assert.Equal(contract.RootElement.GetProperty("kind").GetString(), m.GetProperty("kind").GetString());
    Assert.Equal(JsonValueKind.Null, m.GetProperty("subkind").ValueKind);
    Assert.Equal(contract.RootElement.GetProperty("subject").GetString(), m.GetProperty("subject").GetString());
    Assert.Equal(request.Email.BodyText, m.GetProperty("text").GetString());
    Assert.StartsWith("DRY RUN — ", m.GetProperty("text").GetString());
    Assert.Equal("dry_run", m.GetProperty("mode").GetString());
    Assert.DoesNotContain("recipient", sent.MessageBody, StringComparison.OrdinalIgnoreCase);
  }

  // ---------------------------------------------------------------- the notifier's report (A00 §12.3)

  [Fact]
  public async Task Report_Sent_IsSticky()
  {
    await using var scope = new A04Kit.Scope();
    var id = (await EnqueueAsync(Request("dry_run")))!.NotificationId;

    var first = AutomationTestKit.Data(await A04Kit.ReportAsync(Report(id, "sent", 1, sesMessageId: "ses-it-a04-1")));
    Assert.Equal(["notificationId", "status"], A04Kit.Keys(first));
    Assert.Equal((id, "sent"), (first.GetProperty("notificationId").GetGuid(), first.GetProperty("status").GetString()));
    var row = await RowAsync(id);
    Assert.Equal("ses-it-a04-1", row["ses_message_id"]);
    var sentAt = (DateTime)row["sent_at"]!;

    // A duplicate delivery of the report (a later attempt) keeps the first send.
    var again = AutomationTestKit.Data(await A04Kit.ReportAsync(Report(id, "sent", 3, sesMessageId: "ses-it-a04-2")));
    Assert.Equal("sent", again.GetProperty("status").GetString());
    row = await RowAsync(id);
    Assert.Equal(("ses-it-a04-1", sentAt, 3), ((string)row["ses_message_id"]!, (DateTime)row["sent_at"]!, Convert.ToInt32(row["attempts"], CultureInfo.InvariantCulture)));

    // Validation: the body must be the §12.3 shape.
    AutomationTestKit.AssertError(await A04Kit.ReportAsync(new { v = 1, notificationId = id, status = "bounced", attempt = 1 }), 400, "VALIDATION_ERROR");
    AutomationTestKit.AssertError(await A04Kit.ReportAsync(Report(id, "sent", 0)), 400, "VALIDATION_ERROR");
    AutomationTestKit.AssertError(await A04Kit.ReportAsync(Report(id, "failed", 1, errorCode: new string('E', 61))), 400, "VALIDATION_ERROR");
  }

  [Fact]
  public async Task Report_FailedAfterSent_IsIgnored()
  {
    await using var scope = new A04Kit.Scope();
    var sentId = (await EnqueueAsync(Request("live")))!.NotificationId;
    AutomationTestKit.Data(await A04Kit.ReportAsync(Report(sentId, "sent", 1, sesMessageId: "ses-it-a04-3")));

    var late = AutomationTestKit.Data(await A04Kit.ReportAsync(Report(sentId, "failed", 2, errorCode: "MessageRejected", error: "late")));

    Assert.Equal("sent", late.GetProperty("status").GetString());
    var row = await RowAsync(sentId);
    Assert.Equal("sent", row["status"]);
    Assert.Null(row["error_code"]);

    // From queued a failure applies.
    var failedId = (await EnqueueAsync(Request("live")))!.NotificationId;
    var failed = AutomationTestKit.Data(await A04Kit.ReportAsync(Report(failedId, "failed", 5, errorCode: "MessageRejected", error: "Email address is not verified.")));
    Assert.Equal("failed", failed.GetProperty("status").GetString());
    row = await RowAsync(failedId);
    Assert.Equal(("failed", "MessageRejected", 5), ((string)row["status"]!, (string)row["error_code"]!, Convert.ToInt32(row["attempts"], CultureInfo.InvariantCulture)));
  }

  [Fact]
  public async Task Report_UnknownNotification_Returns404NotificationNotFound()
  {
    await using var scope = new A04Kit.Scope();
    AutomationTestKit.AssertError(await A04Kit.ReportAsync(Report(Guid.NewGuid(), "sent", 1)), 404, "NOTIFICATION_NOT_FOUND");
  }

  [Fact]
  public async Task Report_BadSignature_Returns403()
  {
    await using var scope = new A04Kit.Scope();
    var id = (await EnqueueAsync(Request("dry_run")))!.NotificationId;

    var wrong = await A04Kit.ReportAsync(Report(id, "sent"), secret: "not-the-secret");
    Assert.Equal(403, wrong.StatusCode);
    Assert.Contains("Internal auth failed", wrong.Body);

    // The route secret is mandatory: unset, even a correctly signed shared-secret call is refused.
    scope.Set(AutomationEnv.NotifierSecretEnv, null);
    Assert.Equal(403, (await A04Kit.ReportAsync(Report(id, "sent"))).StatusCode);
    Assert.Equal("queued", (await RowAsync(id))["status"]);
  }

  // ---------------------------------------------------------------- console routes (A00 §8.6)

  [Fact]
  public async Task ListNotifications_FiltersAndNeverCarriesARecipient()
  {
    await using var scope = new A04Kit.Scope();
    var runId = Guid.NewGuid();
    var ids = new List<Guid>();
    for (var i = 0; i < 3; i++)
    {
      ids.Add((await EnqueueAsync(Request("dry_run", kind: "weekly_digest") with { RunId = runId }))!.NotificationId);
    }
    await _sql.QueryAsync("update automation_notifications set status = 'sent', sent_at = now() where notification_id = $1", ids[1]);
    var reader = Editor();

    var page = AutomationTestKit.Data(await AutomationTestKit.CallAsync(Notifications.HandleList, "GET", ListPath, null, reader,
      new Dictionary<string, string> { ["kind"] = "weekly_digest", ["limit"] = "2" }));
    Assert.Equal(["items", "nextCursor"], A04Kit.Keys(page));
    var items = page.GetProperty("items").EnumerateArray().ToList();
    Assert.Equal(2, items.Count);
    Assert.All(items, item =>
    {
      Assert.Equal(NotificationKeys, A04Kit.Keys(item));
      Assert.Equal("weekly_digest", item.GetProperty("kind").GetString());
    });
    Assert.Equal(ids[2], items[0].GetProperty("notificationId").GetGuid());
    Assert.Equal(ids[1], items[1].GetProperty("notificationId").GetGuid());
    var next = AutomationTestKit.Data(await AutomationTestKit.CallAsync(Notifications.HandleList, "GET", ListPath, null, reader,
      new Dictionary<string, string> { ["kind"] = "weekly_digest", ["limit"] = "2", ["cursor"] = page.GetProperty("nextCursor").GetString()! }));
    Assert.Equal(ids[0], next.GetProperty("items")[0].GetProperty("notificationId").GetGuid());

    var sent = AutomationTestKit.Data(await AutomationTestKit.CallAsync(Notifications.HandleList, "GET", ListPath, null, reader,
      new Dictionary<string, string> { ["kind"] = "weekly_digest", ["status"] = "sent" }));
    Assert.Contains(sent.GetProperty("items").EnumerateArray(), i => i.GetProperty("notificationId").GetGuid() == ids[1]);
    Assert.All(sent.GetProperty("items").EnumerateArray(), i => Assert.Equal("sent", i.GetProperty("status").GetString()));
    Assert.DoesNotContain(sent.GetProperty("items").EnumerateArray(), i => i.GetProperty("notificationId").GetGuid() == ids[0]);

    foreach (var item in items)
    {
      Assert.DoesNotContain(A04Kit.Keys(item), k => k.Contains("recipient", StringComparison.OrdinalIgnoreCase) || k is "to" or "email" or "address");
    }
    var columns = await _sql.QueryAsync("select column_name from information_schema.columns where table_name = 'automation_notifications'");
    Assert.DoesNotContain(columns, c => ((string)c["column_name"]!).Contains("recipient", StringComparison.Ordinal));

    AutomationTestKit.AssertError(await AutomationTestKit.CallAsync(Notifications.HandleList, "GET", ListPath, null, reader,
      new Dictionary<string, string> { ["kind"] = "newsletter" }), 400, "VALIDATION_ERROR");
    AutomationTestKit.AssertError(await AutomationTestKit.CallAsync(Notifications.HandleList, "GET", ListPath, null, reader,
      new Dictionary<string, string> { ["cursor"] = "not-a-cursor" }), 400, "VALIDATION_ERROR");
  }

  [Fact]
  public async Task GetNotification_ReturnsBodyText()
  {
    await using var scope = new A04Kit.Scope();
    var request = Request("dry_run");
    var id = (await EnqueueAsync(request))!.NotificationId;

    var data = AutomationTestKit.Data(await AutomationTestKit.CallAsync(
      (q, r, a) => Notifications.HandleGet(q, r, a, id.ToString()), "GET", $"{ListPath}/{id}", null, Editor()));

    Assert.Equal([.. NotificationKeys, "bodyText"], A04Kit.Keys(data));
    Assert.Equal(request.Email.BodyText, data.GetProperty("bodyText").GetString());
    Assert.Equal(request.Email.Subject, data.GetProperty("subject").GetString());
    Assert.Equal("queued", data.GetProperty("status").GetString());

    foreach (var unknown in new[] { Guid.NewGuid().ToString(), "not-a-uuid" })
    {
      AutomationTestKit.AssertError(await AutomationTestKit.CallAsync((q, r, a) => Notifications.HandleGet(q, r, a, unknown), "GET",
        $"{ListPath}/{unknown}", null, Editor()), 404, "NOTIFICATION_NOT_FOUND");
    }
  }

  [Fact]
  public async Task TestEmail_SuperAdmin_EnqueuesInEveryMode()
  {
    foreach (var (configured, effective) in new[] { ("off", "off"), ("dry_run", "dry_run"), ("live", "dry_run") })
    {
      await using var scope = new A04Kit.Scope(configured);
      var data = AutomationTestKit.Data(await TestEmailAsync(SuperAdmin()));
      Assert.Equal(["notificationId", "status"], A04Kit.Keys(data));
      Assert.Equal("queued", data.GetProperty("status").GetString());
      var id = data.GetProperty("notificationId").GetGuid();
      var row = await RowAsync(id);
      Assert.Equal(("test", effective, $"test:{id:D}"), ((string)row["kind"]!, (string)row["mode"]!, (string)row["dedupe_key"]!));
      var expectedSubject = effective == "dry_run" ? "[DeveloperCards] (dry run) Test email" : "[DeveloperCards] Test email";
      Assert.Equal(expectedSubject, row["subject"]);
      Assert.Single(scope.NotifySent);
    }
  }

  [Fact]
  public async Task TestEmail_NoQueueUrl_Returns503NotifyNotConfigured()
  {
    await using var scope = new A04Kit.Scope();
    scope.Set(AutomationEnv.NotifyQueueUrlEnv, null);
    var before = await _sql.CountAsync("select count(*) from automation_notifications where kind = 'test'");

    AutomationTestKit.AssertError(await TestEmailAsync(SuperAdmin()), 503, "NOTIFY_NOT_CONFIGURED");

    Assert.Equal(before, await _sql.CountAsync("select count(*) from automation_notifications where kind = 'test'"));
    Assert.Empty(scope.NotifySent);
  }

  [Fact]
  public async Task TestEmail_Editor_Returns403()
  {
    await using var scope = new A04Kit.Scope();
    var before = await _sql.CountAsync("select count(*) from automation_notifications where kind = 'test'");
    Assert.Equal(403, (await TestEmailAsync(Editor())).StatusCode);
    Assert.Equal(before, await _sql.CountAsync("select count(*) from automation_notifications where kind = 'test'"));
  }

  // ---------------------------------------------------------------- the hooks A02/A03 left

  [Fact]
  public async Task RunnerComplete_Failed_RaisesRunnerRunFailed()
  {
    await using var scope = new A04Kit.Scope();
    var sub = AutomationTestKit.Sub("runner");
    var deck = await AutomationTestKit.NewDeckAsync(_db, "a04-runner");
    var runId = Guid.NewGuid();
    var url = $"https://docs.aws.amazon.com/synthetic/{Guid.NewGuid():N}/page.html";
    var itemId = A04Kit.Long(await _sql.ScalarAsync(
      """
      insert into authoring_queue_items (kind, url, deck_id, dedupe_key, created_by, status, attempts, claimed_by_runner, claimed_at, lease_expires_at, last_run_id)
      values ('manual', $1, $2, $3, 'owner:it-a04', 'claimed', 3, 'it-a04-runner', now(), now() + interval '1 hour', $4)
      returning id
      """, url, deck.Id, $"it-a04:{Guid.NewGuid()}", runId));
    await _sql.QueryAsync(
      "insert into automation_runs (run_id, queue_item_id, runner_id, owner_sub, deck_id, status) values ($1, $2, 'it-a04-runner', $3, $4, 'running')",
      runId, itemId, sub, deck.Id);

    var data = AutomationTestKit.Data(await AutomationTestKit.CallAsync(RunnerRoutes.HandleComplete, "POST",
      "/api/v1/authoring/automation/runner/complete",
      new { runnerId = "it-a04-runner", runId, outcome = "failed", exitCode = 1, durationMs = 1200, error = "synthetic runner failure" },
      AutomationTestKit.Ctx(sub)));
    Assert.Equal(("failed", "failed"), (data.GetProperty("runStatus").GetString(), data.GetProperty("itemStatus").GetString()));

    var runFailed = (await _sql.QueryAsync("select kind, subkind, subject, run_id, body_text from automation_notifications where dedupe_key = $1",
      $"exception:runner_run_failed:{runId:D}")).Single();
    Assert.Equal(("exception", "runner_run_failed", runId), ((string)runFailed["kind"]!, (string)runFailed["subkind"]!, (Guid)runFailed["run_id"]!));
    Assert.StartsWith("[DeveloperCards] (dry run) Action needed: authoring run failed for docs.aws.amazon.com/synthetic/", (string)runFailed["subject"]!);
    Assert.Contains("synthetic runner failure", (string)runFailed["body_text"]!);
    Assert.Equal("queue_item_failed", await _sql.ScalarAsync("select subkind from automation_notifications where dedupe_key = $1",
      $"exception:queue_item_failed:{itemId}"));
    Assert.Equal(2, A04Kit.Messages(scope).Count);
    // No decisions: the run is final at once (and sends no summary).
    Assert.NotNull(await _sql.ScalarAsync("select finalized_at from automation_runs where run_id = $1", runId));
  }

  [Fact]
  public async Task DraftQa_ProviderAccessDenied_RaisesQaProviderErrorOncePerDay()
  {
    await using var scope = new A04Kit.Scope();
    var key = $"exception:qa_provider_error:PROVIDER_ACCESS_DENIED:{DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}";
    // Earlier classes may have raised today's alert already; this test owns the key while it runs.
    await _sql.QueryAsync("delete from automation_notifications where dedupe_key = $1", key);

    var first = await AutomationTestKit.EligibleDraftAsync(_db, "denied1");
    var second = await AutomationTestKit.EligibleDraftAsync(_db, "denied2", "Which synthetic reviewer denies access twice?");
    foreach (var e in new[] { first, second })
    {
      AutomationTestKit.Data(await AutomationTestKit.PostReportAsync(AutomationTestKit.DraftReport(e.JobId, e.DraftId, e.Hash, status: "error",
        errorCode: "PROVIDER_ACCESS_DENIED")));
      Assert.Equal("QA_ERROR", (await AutomationTestKit.DecisionAsync(_db, e.DraftId))!["reason"]);
    }

    var row = (await _sql.QueryAsync("select kind, subkind, subject from automation_notifications where dedupe_key = $1", key)).Single();
    Assert.Equal(("exception", "qa_provider_error"), ((string)row["kind"]!, (string)row["subkind"]!));
    Assert.Equal("[DeveloperCards] (dry run) Action needed: AI QA reviewer error PROVIDER_ACCESS_DENIED", row["subject"]);
    Assert.Single(A04Kit.Messages(scope, "AI QA reviewer error PROVIDER_ACCESS_DENIED"));
  }

  [Fact]
  public async Task NotificationRoutes_MissingTables_Return503ServerNotReadyAutomation()
  {
    const string name = "it_a04_notify_033";
    var scratch = await _db.CreateScratchDatabaseAsync(name);
    await using (var conn = new NpgsqlConnection(scratch))
    {
      await conn.OpenAsync();
      await PostgresFixture.ApplyMigrationsAsync(conn, 33);
    }

    await using var scope = new A04Kit.Scope();
    var savedDb = Environment.GetEnvironmentVariable("PGDATABASE");
    try
    {
      Environment.SetEnvironmentVariable("PGDATABASE", name);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();

      var id = Guid.NewGuid();
      AutomationTestKit.AssertError(await AutomationTestKit.CallAsync(Notifications.HandleList, "GET", ListPath, null, Editor()),
        503, "SERVER_NOT_READY_AUTOMATION");
      AutomationTestKit.AssertError(await AutomationTestKit.CallAsync((q, r, a) => Notifications.HandleGet(q, r, a, id.ToString()), "GET",
        $"{ListPath}/{id}", null, Editor()), 503, "SERVER_NOT_READY_AUTOMATION");
      AutomationTestKit.AssertError(await TestEmailAsync(SuperAdmin()), 503, "SERVER_NOT_READY_AUTOMATION");
      AutomationTestKit.AssertError(await A04Kit.ReportAsync(Report(id, "sent")), 503, "SERVER_NOT_READY_AUTOMATION");
      Assert.Empty(scope.NotifySent);
    }
    finally
    {
      Environment.SetEnvironmentVariable("PGDATABASE", savedDb);
      RecallSmith.Lambda.Db.Pg.Reset();
      RecallSmith.Lambda.Vpc.Db.Pg.Reset();
    }
  }
}
