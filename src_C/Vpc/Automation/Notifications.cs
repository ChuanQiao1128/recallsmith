using System.Globalization;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.SQS;
using Amazon.SQS.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Authoring;
using RecallSmith.Lambda.Vpc.Review;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>One email to log and hand to the notifier (A00 §12.5).</summary>
public sealed record NotificationRequest(string Kind, string? Subkind, string? DedupeKey, string Mode, RenderedEmail Email,
  Guid? RunId = null, IReadOnlyDictionary<string, object?>? Refs = null, string? ConsoleUrl = null);

/// <summary>The logged row: its id and status; <see cref="Created"/> is false when the dedupe key already existed.</summary>
public sealed record NotificationResult(Guid NotificationId, string Status, bool Created);

/// <summary>
/// Automation email (R18A A04, contract A00 §12.3 report call, §12.5, §8.6): core renders every email
/// (<see cref="EmailTemplates"/>), logs it in <c>automation_notifications</c> and hands it to the notifier Lambda
/// through SQS (<c>AUTOMATION_NOTIFY_QUEUE_URL</c>); the notifier sends it through SES and reports back. Core never
/// calls SES and never knows the recipient: no row, message, response or log line carries an address. Every enqueue
/// is best-effort after the business commit and never throws; the tick resends what failed.
/// </summary>
public static class Notifications
{
  public const string EnqueueFailuresMetric = "AutomationNotifyEnqueueFailures";
  public const int MaxSendAttempts = 5;
  /// <summary>
  /// A row still <c>queued</c> this long after a successful SQS send, with no notifier report, is "unconfirmed" in the
  /// status API's email health (R18B K6). It is never sent again: SQS redelivery and the notify DLQ own its retries.
  /// </summary>
  public const int UnconfirmedAfterMinutes = 60;
  /// <summary>
  /// A row still <c>queued</c> with 0 attempts this long after its insert was never handed to SQS: the process died
  /// between the insert and the send (R18C, backend-design-9/automation-17). The tick sends it; no SQS send happened
  /// for it, so this cannot be a second email.
  /// </summary>
  public const int NeverSentAfterMinutes = 10;
  public const int DefaultListLimit = 50, MaxListLimit = 100;

  public static readonly IReadOnlyList<string> Kinds = ["exception", "batch_summary", "weekly_digest", "source_changed", "test"];
  public static readonly IReadOnlyList<string> Statuses = ["queued", "sent", "failed", "enqueue_failed"];

  /// <summary>Test seam (InternalsVisibleTo): when non-null every send goes here instead of the SQS client. Always null in production.</summary>
  internal static Func<SendMessageRequest, Task>? TestSendSeam;

  private static AmazonSQSClient? _sqs;
  private static AmazonSQSClient SQS() => _sqs ??= new AmazonSQSClient(WebhookEvents.BoundedSqsConfig());

  private static readonly string[] RefKeys = ["runId", "draftId", "deckId", "targetId", "jobId"];

  private const string NotificationColumns = """
    notification_id, kind, subkind, subject, mode, status, attempts, ses_message_id, error_code, error, run_id, created_at, sent_at
    """;

  // ---------------------------------------------------------------------------------------------
  // enqueue (A00 §12.5)
  // ---------------------------------------------------------------------------------------------

  /// <summary>
  /// Logs <paramref name="request"/> and sends it to the notifier queue. <c>off</c> sends nothing but a <c>test</c>
  /// email (null, nothing written). A <c>dedupe_key</c> that exists returns that row without sending. An empty queue
  /// URL or a failed send leaves the row <c>enqueue_failed</c> (the tick resends it). A newly logged <c>exception</c>
  /// row also emits the <c>automation.exception</c> webhook. Never throws; null when nothing could be logged.
  /// </summary>
  public static Task<NotificationResult?> EnqueueAsync(NpgsqlConnection conn, NotificationRequest request, CancellationToken ct = default) =>
    EnqueueAsync(conn, request, Guid.NewGuid(), ct);

  internal static async Task<NotificationResult?> EnqueueAsync(NpgsqlConnection conn, NotificationRequest request, Guid notificationId,
    CancellationToken ct = default)
  {
    try
    {
      if (request.Mode == AutomationMode.Off && request.Kind != "test") return null;

      var subject = EmailTemplates.Cap(EmailTemplates.OneLine(request.Email.Subject), EmailTemplates.MaxSubjectLength);
      var inserted = await DbUtil.QueryAsync(conn, null,
        """
        insert into automation_notifications (notification_id, kind, subkind, dedupe_key, subject, body_text, mode, status, run_id)
        values ($1, $2, $3::text, $4::text, $5, $6, $7, 'queued', $8::uuid)
        on conflict (dedupe_key) do nothing
        returning notification_id
        """,
        [notificationId, request.Kind, request.Subkind, request.DedupeKey, subject, request.Email.BodyText, request.Mode, request.RunId]);
      if (inserted.Count == 0)
      {
        var existing = await DbUtil.QueryAsync(conn, null,
          "select notification_id, status from automation_notifications where dedupe_key = $1", [request.DedupeKey]);
        if (existing.Count == 0) return null;
        return new NotificationResult((Guid)existing[0]["notification_id"]!, (string)existing[0]["status"]!, false);
      }

      Log.Event("info", new { tag = "automation", outcome = "notification_logged", notificationId, kind = request.Kind, subkind = request.Subkind, mode = request.Mode });
      // The email is sent right after its insert, before the webhook side effect (R18C, backend-design-9): the window in
      // which a dying process leaves a never-sent 'queued' row is as short as it can be, and the tick's resend covers it.
      string status;
      try
      {
        status = await SendAsync(conn, notificationId, request.Kind, request.Subkind, subject, request.Email.BodyText, request.Mode, ct);
      }
      finally
      {
        if (request.Kind == "exception")
        {
          await WebhookEvents.EnqueueAsync(conn, "automation.exception", new
          {
            subkind = request.Subkind,
            mode = request.Mode,
            summary = EmailTemplates.Cap(request.Email.Summary, EmailTemplates.MaxSummaryLength),
            refs = request.Refs ?? new Dictionary<string, object?>(),
            consoleUrl = request.ConsoleUrl ?? EmailTemplates.AutomationUrl(ConsoleBaseUrl()),
          }, ct: ct);
        }
      }
      return new NotificationResult(notificationId, status, true);
    }
    catch (PostgresException pg) when (pg.SqlState is "42P01" or "42703")
    {
      Log.Event("warn", new { tag = "automation", reason = "schema_not_ready", sqlState = pg.SqlState, where = "notification_enqueue" });
      return null;
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "automation", reason = "notification_enqueue_failed", kind = request.Kind, subkind = request.Subkind, error = ex.Message });
      AutomationFailures.Record();
      return null;
    }
  }

  /// <summary>
  /// The exception alert of <paramref name="subkind"/> under the effective mode, rendered by
  /// <see cref="EmailTemplates.Exception"/> and enqueued with <paramref name="dedupeKey"/>. <paramref name="labelMode"/>
  /// labels an alert about something done in another mode than the effective one (R18C automation-12: cards accepted in
  /// live, blocked after a rollback to dry_run, are a live alert). Never throws.
  /// </summary>
  public static async Task<NotificationResult?> RaiseExceptionAsync(NpgsqlConnection conn, string subkind, string dedupeKey,
    IReadOnlyDictionary<string, string> facts, Guid? runId = null, CancellationToken ct = default, string? labelMode = null)
  {
    try
    {
      var effective = await AutomationMode.EffectiveAsync(conn, ct);
      if (effective.Effective == AutomationMode.Off) return null;
      var mode = labelMode ?? effective.Effective;
      var baseUrl = ConsoleBaseUrl();
      var email = EmailTemplates.Exception(mode, subkind, facts, baseUrl);

      if (runId is null && facts.TryGetValue("runId", out var rawRun) && Guid.TryParse(rawRun, out var parsed)) runId = parsed;
      var refs = new Dictionary<string, object?>(StringComparer.Ordinal);
      foreach (var key in RefKeys)
      {
        if (!facts.TryGetValue(key, out var value) || string.IsNullOrWhiteSpace(value)) continue;
        refs[key] = key is "draftId" or "deckId" or "targetId" &&
          long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : value;
      }
      var consoleUrl = runId is { } r ? EmailTemplates.AutomationUrl(baseUrl, $"runId={r:D}")
        : refs.TryGetValue("draftId", out var draft) ? EmailTemplates.AutomationUrl(baseUrl, $"draftId={Convert.ToString(draft, CultureInfo.InvariantCulture)}")
        : EmailTemplates.AutomationUrl(baseUrl);

      return await EnqueueAsync(conn, new NotificationRequest("exception", subkind, dedupeKey, mode, email, runId, refs, consoleUrl), ct);
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "automation", reason = "raise_exception_failed", subkind, error = ex.Message });
      AutomationFailures.Record();
      return null;
    }
  }

  /// <summary>
  /// Tick step 11: rows <c>enqueue_failed</c> with fewer than <see cref="MaxSendAttempts"/> attempts, oldest first, at
  /// most <paramref name="max"/>, are sent again (the same message). A <c>queued</c> row with attempts is never sent
  /// again (R18B K6): its SQS send was attempted, so SQS redelivery and the notify DLQ own its retries, and a second send
  /// would be a second email when only the notifier's report was lost. A <c>queued</c> row with 0 attempts older than
  /// <see cref="NeverSentAfterMinutes"/> was never handed to SQS (the process died after the insert) and is sent now
  /// (R18C, backend-design-9/automation-17). Returns how many were sent. Never throws.
  /// </summary>
  internal static async Task<int> ResendAsync(NpgsqlConnection conn, int max, CancellationToken ct = default)
  {
    try
    {
      var rows = await DbUtil.QueryAsync(conn, null,
        $"""
        select notification_id, kind, subkind, subject, body_text, mode
        from automation_notifications
        where attempts < $1
          and (status = 'enqueue_failed'
               or (status = 'queued' and attempts = 0 and created_at < now() - make_interval(mins => $3)))
        order by created_at, id
        limit $2
        """,
        [MaxSendAttempts, max, NeverSentAfterMinutes]);
      var resent = 0;
      foreach (var row in rows)
      {
        ct.ThrowIfCancellationRequested();
        var status = await SendAsync(conn, (Guid)row["notification_id"]!, (string)row["kind"]!, row["subkind"] as string,
          (string)row["subject"]!, (string)row["body_text"]!, (string)row["mode"]!, ct);
        if (status == "queued") resent++;
      }
      return resent;
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "automation", reason = "notification_resend_failed", error = ex.Message });
      return 0;
    }
  }

  /// <summary>The A00 §12.5 SQS message of one logged email.</summary>
  internal static string MessageBody(Guid notificationId, string kind, string? subkind, string subject, string text, string mode) =>
    JsonSerializer.Serialize(new { v = 1, notificationId, kind, subkind, subject, text, mode });

  /// <summary>One send of a logged row; returns its status afterwards (<c>queued</c> or <c>enqueue_failed</c>).</summary>
  private static async Task<string> SendAsync(NpgsqlConnection conn, Guid notificationId, string kind, string? subkind, string subject,
    string text, string mode, CancellationToken ct)
  {
    var queueUrl = AutomationEnv.NotifyQueueUrl();
    if (queueUrl is null)
    {
      await DbUtil.ExecuteAsync(conn, null,
        """
        update automation_notifications
        set status = 'enqueue_failed', error_code = 'NOTIFY_NOT_CONFIGURED', error = $2, attempts = attempts + 1, updated_at = now()
        where notification_id = $1 and status in ('queued', 'enqueue_failed')
        """,
        [notificationId, $"{AutomationEnv.NotifyQueueUrlEnv} is not set"]);
      RouteMetrics.EmitGauge(EnqueueFailuresMetric, 1);
      Log.Event("warn", new { tag = "automation", outcome = "notification_enqueue_failed", notificationId, kind, errorCode = NotifyNotConfigured });
      return "enqueue_failed";
    }

    await DbUtil.ExecuteAsync(conn, null,
      "update automation_notifications set attempts = attempts + 1, updated_at = now() where notification_id = $1", [notificationId]);
    var request = new SendMessageRequest { QueueUrl = queueUrl, MessageBody = MessageBody(notificationId, kind, subkind, subject, text, mode) };
    try
    {
      if (TestSendSeam is not null) await TestSendSeam(request);
      else await SQS().SendMessageAsync(request, ct);
    }
    catch (Exception ex)
    {
      var error = ex.Message.Length <= 500 ? ex.Message : ex.Message[..500];
      await DbUtil.ExecuteAsync(conn, null,
        """
        update automation_notifications
        set status = 'enqueue_failed', error_code = 'ENQUEUE_FAILED', error = $2, updated_at = now()
        where notification_id = $1 and status in ('queued', 'enqueue_failed')
        """,
        [notificationId, error]);
      RouteMetrics.EmitGauge(EnqueueFailuresMetric, 1);
      Log.Event("warn", new { tag = "automation", outcome = "notification_enqueue_failed", notificationId, kind, error });
      return "enqueue_failed";
    }

    await DbUtil.ExecuteAsync(conn, null,
      """
      update automation_notifications
      set status = 'queued', error_code = null, error = null, updated_at = now()
      where notification_id = $1 and status in ('queued', 'enqueue_failed')
      """,
      [notificationId]);
    Log.Event("info", new { tag = "automation", outcome = "notification_enqueued", notificationId, kind });
    return "queued";
  }

  private const string NotifyNotConfigured = "NOTIFY_NOT_CONFIGURED";

  internal static string ConsoleBaseUrl()
  {
    var raw = Environment.GetEnvironmentVariable("CONSOLE_BASE_URL");
    return string.IsNullOrWhiteSpace(raw) ? Drafts.DefaultConsoleBaseUrl : raw.Trim().TrimEnd('/');
  }

  // ---------------------------------------------------------------------------------------------
  // POST /api/internal/automation/notifications/report (A00 §12.3)
  // ---------------------------------------------------------------------------------------------

  public static async Task<APIGatewayProxyResponse> HandleReport(LambdaRequest req, Res res)
  {
    if (!req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");
    var v = Auth.VerifyInternalSignatureStrict(req, AutomationEnv.NotifierSecretEnv);
    if (!v.Ok) return res.Forbidden($"Internal auth failed: {v.Reason}");

    try
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
      var body = AutomationBody.Object(doc.RootElement);

      if (!body.TryGetProperty("v", out var ver) || ver.ValueKind != JsonValueKind.Number || !ver.TryGetInt32(out var version) || version != 1)
      {
        throw new ValidationError("v must be 1", "v");
      }
      var notificationId = AutomationBody.OptionalUuid(body, "notificationId") ?? throw new ValidationError("notificationId must be a uuid", "notificationId");
      var status = AutomationBody.RequiredEnum(body, "status", ["sent", "failed"]);
      var sesMessageId = AutomationBody.OptionalString(body, "sesMessageId", 200);
      var errorCode = AutomationBody.OptionalString(body, "errorCode", 60);
      var error = AutomationBody.OptionalString(body, "error", 300);
      var attempt = AutomationBody.OptionalInt(body, "attempt", 1, int.MaxValue) ?? throw new ValidationError("attempt must be an integer >= 1", "attempt");

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      // Every expression reads the row as it was: sent is sticky, failed moves only queued/enqueue_failed rows.
      var rows = await DbUtil.QueryAsync(conn, null,
        """
        update automation_notifications set
          status = case when status = 'sent' then 'sent'
                        when $2 = 'sent' then 'sent'
                        when status in ('queued', 'enqueue_failed') then 'failed'
                        else status end,
          sent_at = case when status <> 'sent' and $2 = 'sent' then now() else sent_at end,
          ses_message_id = case when status <> 'sent' and $2 = 'sent' then $3::text else ses_message_id end,
          error_code = case when $2 = 'failed' and status in ('queued', 'enqueue_failed') then $4::text else error_code end,
          error = case when $2 = 'failed' and status in ('queued', 'enqueue_failed') then $5::text else error end,
          attempts = greatest(attempts, $6),
          updated_at = now()
        where notification_id = $1
        returning status
        """,
        [notificationId, status, sesMessageId, errorCode, error, attempt]);
      if (rows.Count == 0) return NotFound(res);

      var current = (string)rows[0]["status"]!;
      Log.Event("info", new { tag = "automation", outcome = "notification_reported", notificationId, reported = status, status = current, sesMessageId, errorCode });
      return res.Ok(new { notificationId, status = current });
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // console routes (A00 §8.6)
  // ---------------------------------------------------------------------------------------------

  /// <summary><c>GET /api/v1/admin/automation/notifications</c>: the email log, id desc, filters <c>kind</c> and <c>status</c>.</summary>
  public static async Task<APIGatewayProxyResponse> HandleList(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;
    if (!req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    try
    {
      var kind = req.Query.TryGetValue("kind", out var k) && !string.IsNullOrEmpty(k) ? k : null;
      if (kind is not null && !Kinds.Contains(kind)) throw new ValidationError($"kind must be one of {string.Join(", ", Kinds)}", "kind");
      var status = req.Query.TryGetValue("status", out var s) && !string.IsNullOrEmpty(s) ? s : null;
      if (status is not null && !Statuses.Contains(status)) throw new ValidationError($"status must be one of {string.Join(", ", Statuses)}", "status");

      var limit = DefaultListLimit;
      if (req.Query.TryGetValue("limit", out var lim) && !string.IsNullOrEmpty(lim))
      {
        if (!int.TryParse(lim, NumberStyles.None, CultureInfo.InvariantCulture, out limit) || limit is < 1 or > MaxListLimit)
        {
          throw new ValidationError($"limit must be an integer in 1..{MaxListLimit}", "limit");
        }
      }
      long? cursorId = null;
      if (req.Query.TryGetValue("cursor", out var cursorRaw) && !string.IsNullOrEmpty(cursorRaw))
      {
        if (!Drafts.TryDecodeCursor(cursorRaw, out var lastId)) throw new ValidationError("Invalid cursor", "cursor");
        cursorId = lastId;
      }

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

      var parameters = new List<object?>();
      var where = new List<string> { "true" };
      if (kind is not null) { parameters.Add(kind); where.Add($"kind = ${parameters.Count}"); }
      if (status is not null) { parameters.Add(status); where.Add($"status = ${parameters.Count}"); }
      if (cursorId is not null) { parameters.Add(cursorId.Value); where.Add($"id < ${parameters.Count}"); }
      parameters.Add(limit + 1);

      var rows = await DbUtil.QueryAsync(conn, null,
        $"""
        select id, {NotificationColumns}
        from automation_notifications
        where {string.Join(" and ", where)}
        order by id desc
        limit ${parameters.Count}
        """, parameters);
      var page = rows.Take(limit).ToList();
      var items = page.Select(r => ToNotification(r)).ToList();
      var nextCursor = rows.Count > limit ? Drafts.EncodeCursor(RunnerRoutes.Long(page[^1]["id"])) : null;
      return res.Ok(new { items, nextCursor });
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  /// <summary><c>GET /api/v1/admin/automation/notifications/:notificationId</c>: one <c>Notification</c> plus <c>bodyText</c>.</summary>
  public static async Task<APIGatewayProxyResponse> HandleGet(LambdaRequest req, Res res, AuthContext auth, string notificationId)
  {
    var deny = Auth.RequireAdmin(auth, res);
    if (deny is not null) return deny;
    if (!req.Method.Equals("GET", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");
    if (!Guid.TryParseExact(notificationId, "D", out var id)) return NotFound(res);

    try
    {
      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");
      var rows = await DbUtil.QueryAsync(conn, null,
        $"select {NotificationColumns}, body_text from automation_notifications where notification_id = $1", [id]);
      if (rows.Count == 0) return NotFound(res);
      return res.Ok(ToNotification(rows[0], withBody: true));
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  /// <summary>
  /// <c>POST /api/v1/admin/automation/notifications/test</c> (super_admin, body <c>{}</c>): a <c>test</c> email in
  /// every mode, including <c>off</c>. An empty queue URL answers 503 <c>NOTIFY_NOT_CONFIGURED</c> and writes nothing.
  /// </summary>
  public static async Task<APIGatewayProxyResponse> HandleTest(LambdaRequest req, Res res, AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;
    if (!req.Method.Equals("POST", StringComparison.OrdinalIgnoreCase)) return res.MethodNotAllowed("Method not allowed");

    try
    {
      using var doc = Validation.ParseJsonBody(req);
      if (doc is null) return res.BadRequest("BAD_REQUEST", "Invalid JSON body");
      AutomationBody.Object(doc.RootElement);

      if (AutomationEnv.NotifyQueueUrl() is null)
      {
        return Helpers.ErrorEnvelope(res, 503, "NOTIFY_NOT_CONFIGURED", $"{AutomationEnv.NotifyQueueUrlEnv} is not set; no email can be sent");
      }

      await using var conn = await Pg.OpenConnectionOrNullAsync();
      if (conn is null) return Helpers.ConfigError(res, "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");
      var ready = await DbUtil.ExecuteScalarAsync(conn, null, "select to_regclass('public.automation_notifications') is not null", []);
      if (ready is not true) return RunnerRoutes.NotReady(res);

      var mode = await AutomationMode.EffectiveAsync(conn);
      var notificationId = Guid.NewGuid();
      var email = EmailTemplates.Test(mode.Effective, ConsoleBaseUrl());
      var result = await EnqueueAsync(conn, new NotificationRequest("test", null, $"test:{notificationId:D}", mode.Effective, email,
        ConsoleUrl: EmailTemplates.AutomationUrl(ConsoleBaseUrl(), "tab=email")), notificationId);
      if (result is null) return res.Error500(new InvalidOperationException("The test email could not be logged"));
      return res.Ok(new { notificationId = result.NotificationId, status = result.Status });
    }
    catch (Exception ex)
    {
      return RunnerRoutes.HandleError(ex, res);
    }
  }

  private static APIGatewayProxyResponse NotFound(Res res) =>
    Helpers.ErrorEnvelope(res, 404, "NOTIFICATION_NOT_FOUND", "Notification not found");

  /// <summary>The A00 §8.6 <c>Notification</c> shape (never a recipient), plus <c>bodyText</c> for the detail route.</summary>
  private static object ToNotification(Dictionary<string, object?> r, bool withBody = false)
  {
    var n = new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["notificationId"] = r["notification_id"],
      ["kind"] = r["kind"],
      ["subkind"] = r["subkind"],
      ["subject"] = r["subject"],
      ["mode"] = r["mode"],
      ["status"] = r["status"],
      ["attempts"] = Convert.ToInt32(r["attempts"], CultureInfo.InvariantCulture),
      ["sesMessageId"] = r["ses_message_id"],
      ["errorCode"] = r["error_code"],
      ["error"] = r["error"],
      ["runId"] = r["run_id"],
      ["createdAt"] = RunnerRoutes.Timestamp(r["created_at"]),
      ["sentAt"] = RunnerRoutes.Timestamp(r["sent_at"]),
    };
    if (withBody) n["bodyText"] = r["body_text"];
    return n;
  }
}
