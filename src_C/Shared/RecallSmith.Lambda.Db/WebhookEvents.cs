using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using Amazon;
using Amazon.SQS;
using Amazon.SQS.Model;
using Npgsql;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Db;

/// <summary>
/// Outbound webhooks, server half (R18 J03, contract §6.2–§6.4). <see cref="EnqueueAsync"/> records one
/// <c>webhook_deliveries</c> row per live subscription and sends one SQS message each to the
/// dispatcher's queue; the HTTP delivery, signing and retries are the dispatcher's job, never this
/// process's. Every entry point is best-effort (contract §0.8): it never throws and never fails the
/// request that caused the event, and a database without migration 027 produces one warn line.
/// </summary>
/// <remarks>
/// A subscription URL is often a bearer secret (Slack, Teams incoming webhooks), so no log line written
/// here carries it; it goes only into the SQS message.
/// </remarks>
public static class WebhookEvents
{
  public static readonly IReadOnlyList<string> SubscribableEvents = ["deck.published", "import.failed", "card.flagged", "review.queued"];
  public const string TestEvent = "webhook.test";
  public const string QueueUrlEnv = "WEBHOOK_EVENTS_QUEUE_URL";

  public const string EnvironmentName = "prod";
  public const string SigningSecretSsmName = "/developercards/prod/webhook-signing-secret";

  public const int MaxUrlLength = 2048;
  public const int MaxErrorLength = 500;

  /// <summary>Test seam (InternalsVisibleTo). When non-null every send goes here instead of the SQS
  /// client, so no AWS client is ever built. Always null in production.</summary>
  internal static Func<SendMessageRequest, Task>? TestSendSeam;

  /// <summary>
  /// Upper bound on all the SQS sends of one <see cref="EnqueueAsync"/>, <see cref="RedeliverAsync"/> or
  /// <see cref="SweepAsync"/> call. These run on the request path after the business transaction has
  /// committed, and core-vpc has no egress: a misconfigured SQS endpoint must fail fast (rows marked
  /// enqueue_failed) instead of holding the request past the 30 s API Gateway timeout. Internal so a test
  /// can shorten it; never changed in production.
  /// </summary>
  internal static TimeSpan SendDeadline = TimeSpan.FromSeconds(5);

  /// <summary>Per-request HTTP timeout and retry budget of the side-effect SQS client (SDK defaults are ~100 s and several retries).</summary>
  public static readonly TimeSpan SqsRequestTimeout = TimeSpan.FromSeconds(3);
  public const int SqsMaxErrorRetry = 1;

  /// <summary>The bounded client config shared by best-effort SQS senders.</summary>
  public static AmazonSQSConfig BoundedSqsConfig() => new()
  {
    RegionEndpoint = RegionEndpoint.GetBySystemName(Environment.GetEnvironmentVariable("AWS_REGION") ?? "ap-southeast-2"),
    Timeout = SqsRequestTimeout,
    MaxErrorRetry = SqsMaxErrorRetry,
  };

  private static AmazonSQSClient? _sqs;
  private static AmazonSQSClient SQS()
  {
    if (_sqs is not null) return _sqs;
    _sqs = new AmazonSQSClient(BoundedSqsConfig());
    return _sqs;
  }

  /// <summary>
  /// A token that fires after <see cref="SendDeadline"/> or when <paramref name="ct"/> fires. Once it has
  /// fired every remaining send fails at once, so the remaining rows are marked enqueue_failed.
  /// </summary>
  private static CancellationTokenSource Deadline(CancellationToken ct)
  {
    var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
    cts.CancelAfter(SendDeadline);
    return cts;
  }

  /// <summary>UTC, millisecond precision, invariant: <c>2026-10-01T03:04:05.678Z</c>.</summary>
  public static string FormatTimestamp(DateTimeOffset value) =>
    value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

  /// <summary>
  /// Version of the §6.3 body (automation-7). New keys are added without a bump; a breaking change to the
  /// shape of <c>data</c> or of the envelope increments it, so a receiver can tell payload generations
  /// apart from the body alone. It is part of the signed body; the signature scheme does not change.
  /// </summary>
  public const int BodySchemaVersion = 1;

  /// <summary>
  /// The §6.3 body: ASCII-only JSON (default encoder) with the top-level keys data, environment, event,
  /// eventId, occurredAt, schemaVersion, in that order (schemaVersion is last, so receivers that read the
  /// first five keys are unaffected). Identical for every subscription and every retry of one event.
  /// </summary>
  public static string RenderBody(Guid eventId, string eventType, DateTimeOffset occurredAt, object data) =>
    JsonSerializer.Serialize(new
    {
      data,
      environment = EnvironmentName,
      @event = eventType,
      eventId = eventId.ToString("D"),
      occurredAt = FormatTimestamp(occurredAt),
      schemaVersion = BodySchemaVersion,
    });

  /// <summary>
  /// The §6.6 server URL rule. DNS names are not resolved here; the dispatcher checks every resolved
  /// address again before it sends anything.
  /// </summary>
  public static bool IsValidSubscriptionUrl(string? url)
  {
    if (string.IsNullOrEmpty(url)) return false;
    if (url.Length > MaxUrlLength) return false;
    if (url.Any(char.IsWhiteSpace)) return false;
    if (!url.StartsWith("https://", StringComparison.Ordinal)) return false;
    if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return false;
    if (!string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.Ordinal)) return false;
    if (!string.IsNullOrEmpty(uri.UserInfo)) return false;

    var host = uri.Host;
    if (string.IsNullOrEmpty(host)) return false;

    var bare = host.TrimEnd('.');
    if (bare.Equals("localhost", StringComparison.OrdinalIgnoreCase)) return false;
    if (bare.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase)) return false;

    if (uri.HostNameType is UriHostNameType.IPv4 or UriHostNameType.IPv6)
    {
      var literal = host.Trim('[', ']');
      if (!IPAddress.TryParse(literal, out var address)) return false;
      return !IsBlockedAddress(address);
    }

    return true;
  }

  private static readonly (uint Network, int Prefix)[] BlockedV4 =
  [
    (0x00000000, 8),   // 0.0.0.0/8
    (0x0A000000, 8),   // 10.0.0.0/8
    (0x64400000, 10),  // 100.64.0.0/10
    (0x7F000000, 8),   // 127.0.0.0/8
    (0xA9FE0000, 16),  // 169.254.0.0/16
    (0xAC100000, 12),  // 172.16.0.0/12
    (0xC0A80000, 16),  // 192.168.0.0/16
  ];

  private static bool IsBlockedAddress(IPAddress address)
  {
    if (address.AddressFamily == AddressFamily.InterNetwork) return IsBlockedV4(address);
    if (address.AddressFamily != AddressFamily.InterNetworkV6) return true;

    if (address.IsIPv4MappedToIPv6) return IsBlockedV4(address.MapToIPv4());

    var b = address.GetAddressBytes();
    if (address.Equals(IPAddress.IPv6Any) || address.Equals(IPAddress.IPv6None)) return true; // ::
    if (address.Equals(IPAddress.IPv6Loopback)) return true;                                  // ::1
    if ((b[0] & 0xFE) == 0xFC) return true;                                                    // fc00::/7
    if (b[0] == 0xFE && (b[1] & 0xC0) == 0x80) return true;                                    // fe80::/10
    return false;
  }

  private static bool IsBlockedV4(IPAddress address)
  {
    var b = address.GetAddressBytes();
    var value = ((uint)b[0] << 24) | ((uint)b[1] << 16) | ((uint)b[2] << 8) | b[3];
    foreach (var (network, prefix) in BlockedV4)
    {
      var mask = prefix == 0 ? 0u : uint.MaxValue << (32 - prefix);
      if ((value & mask) == network) return true;
    }
    return false;
  }

  /// <summary>
  /// Records one delivery row per live subscription to <paramref name="eventType"/> (or, with
  /// <paramref name="onlySubscriptionId"/>, to that one subscription whether active or not) and sends
  /// one SQS message each. Never throws. Call it after the originating transaction has committed, on a
  /// connection that is not inside a transaction.
  /// </summary>
  public static async Task<WebhookEnqueueResult> EnqueueAsync(
    NpgsqlConnection conn,
    string eventType,
    object data,
    long? onlySubscriptionId = null,
    CancellationToken ct = default)
  {
    var eventId = Guid.NewGuid();
    var occurredAt = DateTimeOffset.UtcNow;
    var deliveries = 0;
    var failures = 0;

    try
    {
      var known = SubscribableEvents.Contains(eventType, StringComparer.Ordinal)
        || (string.Equals(eventType, TestEvent, StringComparison.Ordinal) && onlySubscriptionId is not null);
      if (!known)
      {
        Log.Event("warn", new { tag = "webhook", reason = "unknown_event", @event = eventType });
        return new WebhookEnqueueResult(eventId, 0, 0);
      }

      // Read on every call (no static capture), so the queue can be configured without a code change.
      var queueUrl = Environment.GetEnvironmentVariable(QueueUrlEnv);
      if (string.IsNullOrWhiteSpace(queueUrl))
      {
        Log.Event("info", new { tag = "webhook", reason = "queue_url_missing", @event = eventType });
        return new WebhookEnqueueResult(eventId, 0, 0);
      }

      var targets = onlySubscriptionId is { } onlyId
        ? await DbUtil.QueryAsync(conn, null,
            "select id, url from webhook_subscriptions where id = $1 and deleted_at is null",
            [onlyId])
        : await DbUtil.QueryAsync(conn, null,
            "select id, url from webhook_subscriptions where deleted_at is null and is_active and $1 = any(events) order by id",
            [eventType]);
      if (targets.Count == 0) return new WebhookEnqueueResult(eventId, 0, 0);

      var occurredAtText = FormatTimestamp(occurredAt);
      var body = RenderBody(eventId, eventType, occurredAt, data);
      using var deadline = Deadline(ct);

      foreach (var target in targets)
      {
        var subscriptionId = Convert.ToInt64(target["id"], CultureInfo.InvariantCulture);
        var url = (string)target["url"]!;
        var deliveryId = Guid.NewGuid();

        await DbUtil.ExecuteAsync(conn, null,
          "insert into webhook_deliveries (delivery_id, event_id, event, subscription_id, status, body) values ($1, $2, $3, $4, 'queued', $5)",
          [deliveryId, eventId, eventType, subscriptionId, body]);
        deliveries++;

        if (!await TrySendAsync(conn, queueUrl, deliveryId, eventId, eventType, subscriptionId, url, occurredAtText, body, deadline.Token))
        {
          failures++;
        }
      }

      if (failures > 0) RouteMetrics.EmitGauge("WebhookEnqueueFailures", failures);
      Log.Event("info", new { tag = "webhook", @event = eventType, eventId, deliveries, enqueueFailures = failures });
      return new WebhookEnqueueResult(eventId, deliveries, failures);
    }
    catch (Exception ex)
    {
      LogFailure(ex, eventType);
      if (failures > 0) RouteMetrics.EmitGauge("WebhookEnqueueFailures", failures);
      return new WebhookEnqueueResult(eventId, deliveries, failures);
    }
  }

  /// <summary>
  /// A deterministic event id for an event that one source record causes exactly once (for example
  /// <c>deck.published:&lt;jobId&gt;</c>), so a replayed or recovered emission finds the delivery rows of the
  /// first one instead of creating a second event. RFC 9562 version 8 (name-based, SHA-256): the first
  /// 128 bits of SHA-256("developercards-webhook-event:" + name) with the version and variant bits set.
  /// </summary>
  public static Guid DerivedEventId(string name)
  {
    var bytes = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes("developercards-webhook-event:" + name))[..16];
    bytes[6] = (byte)((bytes[6] & 0x0F) | 0x80);
    bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80);
    // The 32-hex-digit text form is read in network (big-endian) order, so the version nibble lands in place.
    return Guid.ParseExact(Convert.ToHexString(bytes), "N");
  }

  /// <summary>
  /// Outbox, write half (automation-1): inside the caller's transaction <paramref name="tx"/>, records one
  /// <c>queued</c> delivery row of event <paramref name="eventId"/> per live subscription to
  /// <paramref name="eventType"/> that has none yet, and sends nothing. The rows commit or roll back with
  /// the business change that caused the event, so a crash after the commit leaves rows that
  /// <see cref="SendStagedAsync"/> (on replay) or the sweep sends later. Idempotent per (event, subscription).
  /// Never throws and never aborts <paramref name="tx"/>: it runs under a savepoint, and a database without
  /// migration 027 produces one warn line. Returns the number of rows staged.
  /// </summary>
  public static async Task<int> StageAsync(
    NpgsqlConnection conn,
    NpgsqlTransaction tx,
    string eventType,
    Guid eventId,
    DateTimeOffset occurredAt,
    object data)
  {
    if (!SubscribableEvents.Contains(eventType, StringComparer.Ordinal))
    {
      Log.Event("warn", new { tag = "webhook", reason = "unknown_event", @event = eventType });
      return 0;
    }

    // Without a queue nothing could ever send the rows (EnqueueAsync records none either).
    if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(QueueUrlEnv)))
    {
      Log.Event("info", new { tag = "webhook", reason = "queue_url_missing", @event = eventType, op = "stage" });
      return 0;
    }

    const string savepoint = "webhook_outbox";
    await tx.SaveAsync(savepoint);
    try
    {
      var targets = await DbUtil.QueryAsync(conn, tx,
        """
        select s.id from webhook_subscriptions s
        where s.deleted_at is null and s.is_active and $1 = any(s.events)
          and not exists (select 1 from webhook_deliveries d where d.event_id = $2 and d.subscription_id = s.id)
        order by s.id
        """,
        [eventType, eventId]);

      var body = RenderBody(eventId, eventType, occurredAt, data);
      foreach (var target in targets)
      {
        await DbUtil.ExecuteAsync(conn, tx,
          "insert into webhook_deliveries (delivery_id, event_id, event, subscription_id, status, body) values ($1, $2, $3, $4, 'queued', $5)",
          [Guid.NewGuid(), eventId, eventType, Convert.ToInt64(target["id"], CultureInfo.InvariantCulture), body]);
      }

      await tx.ReleaseAsync(savepoint);
      return targets.Count;
    }
    catch (Exception ex)
    {
      await tx.RollbackAsync(savepoint);
      LogFailure(ex, eventType);
      return 0;
    }
  }

  /// <summary>
  /// Outbox, send half (automation-1): after the staging transaction has committed, sends one SQS message
  /// per delivery row of <paramref name="eventId"/> that has not been handed off yet (<c>queued</c>, no
  /// attempt, no <c>enqueued_at</c>) on a live subscription, with its own delivery_id. A failed send marks
  /// the row enqueue_failed. Safe to repeat: a sent row has <c>enqueued_at</c> and is skipped. Returns the
  /// number of failures. Never throws.
  /// </summary>
  public static async Task<int> SendStagedAsync(NpgsqlConnection conn, Guid eventId, CancellationToken ct = default)
  {
    var failures = 0;
    string? eventType = null;
    try
    {
      var queueUrl = Environment.GetEnvironmentVariable(QueueUrlEnv);
      if (string.IsNullOrWhiteSpace(queueUrl))
      {
        Log.Event("info", new { tag = "webhook", reason = "queue_url_missing", op = "send_staged" });
        return 0;
      }

      var rows = await DbUtil.QueryAsync(conn, null,
        """
        select d.delivery_id as "deliveryId", d.event as "event", d.subscription_id as "subscriptionId", d.body as "body", s.url as "url"
        from webhook_deliveries d
        join webhook_subscriptions s on s.id = d.subscription_id
        where d.event_id = $1 and d.status = 'queued' and d.attempts = 0 and d.enqueued_at is null
          and s.deleted_at is null and s.is_active
        order by d.subscription_id, d.delivery_id
        """,
        [eventId]);
      if (rows.Count == 0) return 0;

      using var deadline = Deadline(ct);
      foreach (var row in rows)
      {
        var body = (string)row["body"]!;
        eventType = (string)row["event"]!;
        if (!await TrySendAsync(conn, queueUrl, (Guid)row["deliveryId"]!, eventId, eventType,
              Convert.ToInt64(row["subscriptionId"], CultureInfo.InvariantCulture), (string)row["url"]!, ReadOccurredAt(body), body, deadline.Token))
        {
          failures++;
        }
      }

      if (failures > 0) RouteMetrics.EmitGauge("WebhookEnqueueFailures", failures);
      Log.Event("info", new { tag = "webhook", op = "send_staged", @event = eventType, eventId, deliveries = rows.Count, enqueueFailures = failures });
      return failures;
    }
    catch (Exception ex)
    {
      LogFailure(ex, eventType);
      if (failures > 0) RouteMetrics.EmitGauge("WebhookEnqueueFailures", failures);
      return failures;
    }
  }

  /// <summary>
  /// Copies delivery <paramref name="deliveryId"/> into a new row (new delivery_id; same event_id, event,
  /// subscription and body; status queued, attempts 0) and sends its message. Returns the new id, or
  /// null when the source row does not exist (or the copy could not be recorded). Never throws; a send
  /// failure marks the new row enqueue_failed and still returns its id. A source row that never reached the
  /// dispatcher (<see cref="SupersedablePredicate"/>) is settled as <c>failed</c> in the same transaction as the
  /// copy (automation-19), so a later sweep cannot send the event a second time under the old delivery id.
  /// </summary>
  public static async Task<Guid?> RedeliverAsync(NpgsqlConnection conn, Guid deliveryId, CancellationToken ct = default)
  {
    try
    {
      var queueUrl = Environment.GetEnvironmentVariable(QueueUrlEnv);
      if (string.IsNullOrWhiteSpace(queueUrl))
      {
        Log.Event("info", new { tag = "webhook", reason = "queue_url_missing", op = "redeliver" });
        return null;
      }

      var rows = await DbUtil.QueryAsync(conn, null,
        """
        select d.event_id as "eventId", d.event as "event", d.subscription_id as "subscriptionId", d.body as "body", s.url as "url"
        from webhook_deliveries d
        join webhook_subscriptions s on s.id = d.subscription_id
        where d.delivery_id = $1
        """,
        [deliveryId]);
      if (rows.Count == 0) return null;

      var row = rows[0];
      var eventId = (Guid)row["eventId"]!;
      var eventType = (string)row["event"]!;
      var subscriptionId = Convert.ToInt64(row["subscriptionId"], CultureInfo.InvariantCulture);
      var body = (string)row["body"]!;
      var url = (string)row["url"]!;
      var occurredAtText = ReadOccurredAt(body);

      var newId = Guid.NewGuid();
      int superseded;
      await using (var tx = await conn.BeginTransactionAsync(ct))
      {
        await DbUtil.ExecuteAsync(conn, tx,
          "insert into webhook_deliveries (delivery_id, event_id, event, subscription_id, status, attempts, body) values ($1, $2, $3, $4, 'queued', 0, $5)",
          [newId, eventId, eventType, subscriptionId, body]);
        superseded = await DbUtil.ExecuteAsync(conn, tx,
          $"""
          update webhook_deliveries d
          set status = 'failed', last_error = $2, updated_at = now()
          where d.delivery_id = $1 and {SupersedablePredicate}
          """,
          [deliveryId, $"superseded by redelivery {newId:D}"]);
        await tx.CommitAsync(ct);
      }

      using var deadline = Deadline(ct);
      var sent = await TrySendAsync(conn, queueUrl, newId, eventId, eventType, subscriptionId, url, occurredAtText, body, deadline.Token);
      if (!sent) RouteMetrics.EmitGauge("WebhookEnqueueFailures", 1);
      Log.Event("info", new { tag = "webhook", op = "redeliver", @event = eventType, eventId, sourceDeliveryId = deliveryId, deliveryId = newId,
        sourceSuperseded = superseded > 0, enqueueFailures = sent ? 0 : 1 });
      return newId;
    }
    catch (Exception ex)
    {
      LogFailure(ex, null);
      return null;
    }
  }

  /// <summary>Deliveries untouched for this long in a pre-send state are considered stranded.</summary>
  public static readonly TimeSpan SweepStuckAfter = TimeSpan.FromMinutes(10);
  public const int SweepMaxBatch = 100;

  /// <summary>
  /// The stranded-delivery predicate (automation-1, backend-design-13): a row that never reached SQS, i.e.
  /// <c>enqueue_failed</c>, or <c>queued</c> with no attempt reported and no recorded hand-off
  /// (<c>enqueued_at is null</c>, migration 032), untouched for <see cref="SweepStuckAfter"/>, whose
  /// subscription is still live. A row that SQS accepted but whose report never arrived (dispatcher report
  /// call failed, or the message is still waiting in a backed-up queue) has <c>enqueued_at</c> set and is
  /// never re-sent. Alias <c>d</c> is webhook_deliveries, <c>s</c> its subscription.
  /// </summary>
  private static string StrandedPredicate => $"""
    (d.status = 'enqueue_failed' or (d.status = 'queued' and d.attempts = 0 and d.enqueued_at is null))
    and d.updated_at < now() - interval '{(int)SweepStuckAfter.TotalMinutes} minutes'
    and s.deleted_at is null and s.is_active
    """;

  /// <summary>
  /// A redelivered source row that never reached the dispatcher and so would otherwise stay eligible for the
  /// sweep (automation-19): <c>enqueue_failed</c>, or <c>queued</c> with no attempt and no hand-off that has been
  /// untouched for <see cref="SweepStuckAfter"/> (a fresher queued row may still be mid-send). A row the
  /// dispatcher has seen (attempts &gt; 0 or <c>enqueued_at</c> set) keeps its own history. Alias <c>d</c>.
  /// </summary>
  private static string SupersedablePredicate => $"""
    d.attempts = 0 and d.enqueued_at is null
    and (d.status = 'enqueue_failed'
         or (d.status = 'queued' and d.updated_at < now() - interval '{(int)SweepStuckAfter.TotalMinutes} minutes'))
    """;

  /// <summary>
  /// Claims up to <paramref name="limit"/> stranded deliveries (<see cref="StrandedPredicate"/>) inside
  /// <paramref name="tx"/>: each is set back to <c>queued</c> with a fresh <c>updated_at</c>, so a second
  /// sweep within <see cref="SweepStuckAfter"/> does not pick it up again and a concurrent one skips the
  /// locked rows. Call <see cref="ResendClaimedAsync"/> with the result after the transaction commits.
  /// </summary>
  public static async Task<List<SweptDelivery>> ClaimStrandedAsync(NpgsqlConnection conn, NpgsqlTransaction tx, int limit)
  {
    var rows = await DbUtil.QueryAsync(conn, tx,
      $"""
      with stuck as (
        select d.delivery_id
        from webhook_deliveries d
        join webhook_subscriptions s on s.id = d.subscription_id
        where {StrandedPredicate}
        order by d.created_at, d.delivery_id
        limit $1
        for update of d skip locked
      )
      update webhook_deliveries d set status = 'queued', last_error = null, updated_at = now()
      from stuck, webhook_subscriptions s
      where d.delivery_id = stuck.delivery_id and s.id = d.subscription_id
      returning d.delivery_id as "deliveryId", d.event_id as "eventId", d.event as "event",
                d.subscription_id as "subscriptionId", d.body as "body", s.url as "url"
      """,
      [limit]);

    return rows.Select(r => new SweptDelivery(
      (Guid)r["deliveryId"]!, (Guid)r["eventId"]!, (string)r["event"]!,
      Convert.ToInt64(r["subscriptionId"], CultureInfo.InvariantCulture), (string)r["body"]!, (string)r["url"]!))
      .OrderBy(d => d.DeliveryId)
      .ToList();
  }

  /// <summary>
  /// Sends one SQS message per claimed delivery with the SAME delivery_id and event_id (receivers dedupe
  /// on eventId, and the report route never regresses a terminal row). A failed send marks the row
  /// enqueue_failed again. Returns the number of failures. Never throws.
  /// </summary>
  public static async Task<int> ResendClaimedAsync(NpgsqlConnection conn, IReadOnlyList<SweptDelivery> claimed, CancellationToken ct = default)
  {
    var failures = 0;
    try
    {
      var queueUrl = Environment.GetEnvironmentVariable(QueueUrlEnv);
      if (string.IsNullOrWhiteSpace(queueUrl))
      {
        Log.Event("info", new { tag = "webhook", reason = "queue_url_missing", op = "sweep" });
        return claimed.Count;
      }

      using var deadline = Deadline(ct);
      foreach (var d in claimed)
      {
        if (!await TrySendAsync(conn, queueUrl, d.DeliveryId, d.EventId, d.Event, d.SubscriptionId, d.Url, ReadOccurredAt(d.Body), d.Body, deadline.Token))
        {
          failures++;
        }
      }
    }
    catch (Exception ex)
    {
      LogFailure(ex, null);
      failures = Math.Max(failures, 1);
    }

    if (failures > 0) RouteMetrics.EmitGauge("WebhookEnqueueFailures", failures);
    Log.Event("info", new { tag = "webhook", op = "sweep", resent = claimed.Count - failures, enqueueFailures = failures });
    return failures;
  }

  private static async Task<bool> TrySendAsync(
    NpgsqlConnection conn,
    string queueUrl,
    Guid deliveryId,
    Guid eventId,
    string eventType,
    long subscriptionId,
    string url,
    string occurredAt,
    string body,
    CancellationToken ct)
  {
    // §6.4 key order. No message attributes.
    var message = JsonSerializer.Serialize(new { v = 1, deliveryId, eventId, @event = eventType, subscriptionId, url, occurredAt, body });
    var request = new SendMessageRequest { QueueUrl = queueUrl, MessageBody = message };

    try
    {
      // WaitAsync enforces the deadline even on a send that does not observe the token itself.
      var seam = TestSendSeam;
      if (seam is not null) await seam(request).WaitAsync(ct);
      else await SQS().SendMessageAsync(request, ct).WaitAsync(ct);
    }
    catch (Exception ex)
    {
      var reason = ex is OperationCanceledException ? $"enqueue deadline exceeded ({(int)SendDeadline.TotalMilliseconds} ms)" : ex.Message;
      var error = reason.Length > MaxErrorLength ? reason[..MaxErrorLength] : reason;
      // Only a row still waiting for its hand-off may become enqueue_failed (backend-design-14): a send
      // that timed out after SQS accepted it, or a sweep re-send that raced the original message, must
      // never regress a row the dispatcher has already reported (retrying, delivered, failed, dead).
      await DbUtil.ExecuteAsync(conn, null,
        "update webhook_deliveries set status = 'enqueue_failed', last_error = $2, updated_at = now() where delivery_id = $1 and status = 'queued'",
        [deliveryId, error]);
      Log.Event("warn", new { tag = "webhook", reason = "enqueue_failed", @event = eventType, deliveryId, subscriptionId, error });
      return false;
    }

    // The durable hand-off marker the sweep keys on (backend-design-13). Best-effort: the message is
    // already on the queue, so a failure here is logged and the send still counts as done.
    try
    {
      await DbUtil.ExecuteAsync(conn, null,
        "update webhook_deliveries set enqueued_at = now() where delivery_id = $1",
        [deliveryId]);
    }
    catch (Exception ex)
    {
      Log.Event("warn", new { tag = "webhook", reason = "enqueued_marker_failed", @event = eventType, deliveryId, error = ex.Message });
    }
    return true;
  }

  private static string ReadOccurredAt(string body)
  {
    try
    {
      using var doc = JsonDocument.Parse(body);
      if (doc.RootElement.TryGetProperty("occurredAt", out var el) && el.ValueKind == JsonValueKind.String)
      {
        return el.GetString()!;
      }
    }
    catch (JsonException)
    {
      // Fall through: a body this process did not render still gets a timestamp.
    }
    return FormatTimestamp(DateTimeOffset.UtcNow);
  }

  private static void LogFailure(Exception ex, string? eventType)
  {
    if (ex is PostgresException { SqlState: "42P01" or "42703" } pg)
    {
      Log.Event("warn", new { tag = "webhook", reason = "schema_not_ready", sqlState = pg.SqlState, @event = eventType });
    }
    else
    {
      Log.Event("warn", new { tag = "webhook", reason = "enqueue_error", error = ex.Message, @event = eventType });
    }
  }
}

public sealed record WebhookEnqueueResult(Guid EventId, int Deliveries, int EnqueueFailures);

public sealed record SweptDelivery(Guid DeliveryId, Guid EventId, string Event, long SubscriptionId, string Body, string Url);
