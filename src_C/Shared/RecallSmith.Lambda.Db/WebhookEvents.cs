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

  private static AmazonSQSClient? _sqs;
  private static AmazonSQSClient SQS()
  {
    if (_sqs is not null) return _sqs;
    var region = Environment.GetEnvironmentVariable("AWS_REGION") ?? "ap-southeast-2";
    _sqs = new AmazonSQSClient(RegionEndpoint.GetBySystemName(region));
    return _sqs;
  }

  /// <summary>UTC, millisecond precision, invariant: <c>2026-10-01T03:04:05.678Z</c>.</summary>
  public static string FormatTimestamp(DateTimeOffset value) =>
    value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

  /// <summary>
  /// The §6.3 body: ASCII-only JSON (default encoder) with the top-level keys data, environment, event,
  /// eventId, occurredAt, in that order. Identical for every subscription and every retry of one event.
  /// </summary>
  public static string RenderBody(Guid eventId, string eventType, DateTimeOffset occurredAt, object data) =>
    JsonSerializer.Serialize(new
    {
      data,
      environment = EnvironmentName,
      @event = eventType,
      eventId = eventId.ToString("D"),
      occurredAt = FormatTimestamp(occurredAt),
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

      foreach (var target in targets)
      {
        var subscriptionId = Convert.ToInt64(target["id"], CultureInfo.InvariantCulture);
        var url = (string)target["url"]!;
        var deliveryId = Guid.NewGuid();

        await DbUtil.ExecuteAsync(conn, null,
          "insert into webhook_deliveries (delivery_id, event_id, event, subscription_id, status, body) values ($1, $2, $3, $4, 'queued', $5)",
          [deliveryId, eventId, eventType, subscriptionId, body]);
        deliveries++;

        if (!await TrySendAsync(conn, queueUrl, deliveryId, eventId, eventType, subscriptionId, url, occurredAtText, body, ct))
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
  /// Copies delivery <paramref name="deliveryId"/> into a new row (new delivery_id; same event_id, event,
  /// subscription and body; status queued, attempts 0) and sends its message. Returns the new id, or
  /// null when the source row does not exist (or the copy could not be recorded). Never throws; a send
  /// failure marks the new row enqueue_failed and still returns its id.
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
      await DbUtil.ExecuteAsync(conn, null,
        "insert into webhook_deliveries (delivery_id, event_id, event, subscription_id, status, attempts, body) values ($1, $2, $3, $4, 'queued', 0, $5)",
        [newId, eventId, eventType, subscriptionId, body]);

      var sent = await TrySendAsync(conn, queueUrl, newId, eventId, eventType, subscriptionId, url, occurredAtText, body, ct);
      if (!sent) RouteMetrics.EmitGauge("WebhookEnqueueFailures", 1);
      Log.Event("info", new { tag = "webhook", op = "redeliver", @event = eventType, eventId, sourceDeliveryId = deliveryId, deliveryId = newId, enqueueFailures = sent ? 0 : 1 });
      return newId;
    }
    catch (Exception ex)
    {
      LogFailure(ex, null);
      return null;
    }
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
      var seam = TestSendSeam;
      if (seam is not null) await seam(request);
      else await SQS().SendMessageAsync(request, ct);
      return true;
    }
    catch (Exception ex)
    {
      var error = ex.Message.Length > MaxErrorLength ? ex.Message[..MaxErrorLength] : ex.Message;
      await DbUtil.ExecuteAsync(conn, null,
        "update webhook_deliveries set status = 'enqueue_failed', last_error = $2, updated_at = now() where delivery_id = $1",
        [deliveryId, error]);
      Log.Event("warn", new { tag = "webhook", reason = "enqueue_failed", @event = eventType, deliveryId, subscriptionId, error });
      return false;
    }
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
