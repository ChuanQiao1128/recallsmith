using System.Globalization;
using System.Text;
using System.Text.Json;
using Amazon;
using Amazon.Lambda.APIGatewayEvents;
using Amazon.S3;
using Amazon.S3.Model;
using Npgsql;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Db;
using static RecallSmith.Lambda.Vpc.Db.DbUtil;

namespace RecallSmith.Lambda.Vpc.Analytics;

public static class OutboxPublisher
{
  private static AmazonS3Client? _s3;

  private static AmazonS3Client S3()
  {
    if (_s3 is not null) return _s3;
    var region = Environment.GetEnvironmentVariable("AWS_REGION") ?? "ap-southeast-2";
    _s3 = new AmazonS3Client(RegionEndpoint.GetBySystemName(region));
    return _s3;
  }

  public static void Reset()
  {
    var s3 = _s3;
    _s3 = null;
    if (s3 is null) return;
    try { s3.Dispose(); } catch { /* best-effort */ }
  }

  private static string NormalizePrefix(string? raw)
  {
    var s = (raw ?? "analytics/raw/review_events").Trim().Trim('/');
    return string.IsNullOrWhiteSpace(s) ? "analytics/raw/review_events" : s;
  }

  private static string? AnalyticsBucket()
  {
    return NullIfBlank(Environment.GetEnvironmentVariable("ANALYTICS_S3_BUCKET")) ??
      NullIfBlank(Environment.GetEnvironmentVariable("CONTENT_BUCKET"));
  }

  private static string? NullIfBlank(string? value)
  {
    var s = value?.Trim();
    return string.IsNullOrEmpty(s) ? null : s;
  }

  private static int ParseLimit(LambdaRequest req)
  {
    var parsed = Validation.ParseOptionalInteger(req.Query.TryGetValue("limit", out var raw) ? raw : null, "limit") ?? 500;
    return (int)Math.Max(1, Math.Min(parsed, 5000));
  }

  private static string JsonString(object? value)
  {
    return JsonSerializer.Serialize(Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty);
  }

  private static long ToLong(object? value)
  {
    if (value is long l) return l;
    if (value is int i) return i;
    if (long.TryParse(Convert.ToString(value, CultureInfo.InvariantCulture), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)) return parsed;
    return 0;
  }

  private static string PayloadJson(object? value)
  {
    var raw = Convert.ToString(value, CultureInfo.InvariantCulture);
    return string.IsNullOrWhiteSpace(raw) ? "{}" : raw;
  }

  private static string BuildJsonl(IEnumerable<Dictionary<string, object?>> rows, DateTimeOffset publishedAt)
  {
    var sb = new StringBuilder();
    foreach (var row in rows)
    {
      sb.Append('{');
      sb.Append("\"outbox_id\":").Append(ToLong(row["id"])).Append(',');
      sb.Append("\"event_id\":").Append(JsonString(row["event_id"])).Append(',');
      sb.Append("\"event_type\":").Append(JsonString(row["event_type"])).Append(',');
      sb.Append("\"aggregate_type\":").Append(JsonString(row["aggregate_type"])).Append(',');
      sb.Append("\"aggregate_id\":").Append(JsonString(row["aggregate_id"])).Append(',');
      sb.Append("\"published_at\":").Append(JsonString(publishedAt.ToString("O", CultureInfo.InvariantCulture))).Append(',');
      sb.Append("\"payload\":").Append(PayloadJson(row["payload"]));
      sb.Append('}').Append('\n');
    }

    return sb.ToString();
  }

  private static async Task<List<Dictionary<string, object?>>> ClaimPending(NpgsqlConnection conn, int limit)
  {
    const string sql = """
      with claimed as (
        select id
        from analytics_event_outbox
        where status = 'pending'
          and available_at <= now()
        order by id
        limit $1::int
        for update skip locked
      )
      update analytics_event_outbox o
      set
        status = 'processing',
        attempts = attempts + 1,
        updated_at = now()
      from claimed
      where o.id = claimed.id
      returning
        o.id,
        o.event_id,
        o.event_type,
        o.aggregate_type,
        o.aggregate_id,
        o.payload::text as payload;
      """;

    await using var tx = await conn.BeginTransactionAsync();
    try
    {
      var rows = await QueryAsync(conn, tx, sql, [limit]);
      await tx.CommitAsync();
      return rows;
    }
    catch
    {
      try { await tx.RollbackAsync(); } catch { /* ignore */ }
      throw;
    }
  }

  private static async Task MarkSent(NpgsqlConnection conn, long[] ids)
  {
    const string sql = """
      update analytics_event_outbox
      set
        status = 'sent',
        sent_at = now(),
        last_error = null,
        updated_at = now()
      where id = any($1::bigint[]);
      """;

    await ExecuteAsync(conn, null, sql, [ids]);
  }

  private static async Task MarkRetry(NpgsqlConnection conn, long[] ids, string error)
  {
    const string sql = """
      update analytics_event_outbox
      set
        status = 'pending',
        available_at = now() + (least(attempts, 10) * interval '1 minute'),
        last_error = left($2::text, 2000),
        updated_at = now()
      where id = any($1::bigint[]);
      """;

    await ExecuteAsync(conn, null, sql, [ids, error]);
  }

  public static async Task<APIGatewayProxyResponse> HandlePublishOutbox(
    LambdaRequest req,
    Res res,
    AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;
    if (req.Method != "POST") return res.MethodNotAllowed();

    var bucket = AnalyticsBucket();
    if (string.IsNullOrEmpty(bucket))
    {
      return res.BadRequest("CONFIG_ERROR", "Missing env ANALYTICS_S3_BUCKET or CONTENT_BUCKET");
    }

    var limit = ParseLimit(req);
    var prefix = NormalizePrefix(Environment.GetEnvironmentVariable("ANALYTICS_S3_PREFIX"));

    await using var conn = await Pg.OpenConnectionOrNullAsync();
    if (conn is null)
    {
      return res.BadRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");
    }

    var rows = await ClaimPending(conn, limit);
    if (rows.Count == 0)
    {
      return res.Ok(new { ok = true, published = 0, bucket, prefix });
    }

    var ids = rows.Select(row => ToLong(row["id"])).Where(id => id > 0).ToArray();
    var now = DateTimeOffset.UtcNow;
    var key = $"{prefix}/event_type=card_reviewed/dt={now:yyyy-MM-dd}/batch-{now:yyyyMMddTHHmmssfffZ}-{Guid.NewGuid():N}.jsonl";
    var body = BuildJsonl(rows, now);

    try
    {
      await S3().PutObjectAsync(new PutObjectRequest
      {
        BucketName = bucket,
        Key = key,
        ContentBody = body,
        ContentType = "application/x-ndjson; charset=utf-8",
      });

      await MarkSent(conn, ids);

      return res.Ok(new
      {
        ok = true,
        published = rows.Count,
        bucket,
        key,
        bytes = Encoding.UTF8.GetByteCount(body),
      });
    }
    catch (Exception ex)
    {
      await MarkRetry(conn, ids, ex.Message);
      Log.Error("Analytics outbox publish failed:", ex);
      return res.Error500(ex);
    }
  }
}
