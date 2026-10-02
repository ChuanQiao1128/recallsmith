using System.Text.Json;

namespace RecallSmith.Lambda.Common;

public sealed class LambdaRequest
{
  public JsonElement RawEvent { get; }
  public string Method { get; }
  public string Path { get; }
  public string? TraceId { get; }

  public IReadOnlyDictionary<string, string> Headers { get; }
  public IReadOnlyDictionary<string, string> Query { get; }

  public string? Body { get; }
  public bool IsBase64Encoded { get; }
  public string RawBody { get; }

  /// <summary>The caller's Origin header, or null when it is absent or empty.</summary>
  /// <remarks>
  /// A property here rather than a header lookup at each call site, so the one thing that
  /// decides which origins the API answers for is not spelled out as a magic string in every
  /// handler. Empty collapses to null deliberately: <see cref="ReadStringMap"/> turns a JSON
  /// null header value into "", and "" is not an origin — passing it on would put an empty
  /// access-control-allow-origin on the response.
  /// </remarks>
  public string? Origin => Headers.TryGetValue("origin", out var v) && v.Length > 0 ? v : null;

  public LambdaRequest(JsonElement rawEvent)
  {
    RawEvent = rawEvent;

    Headers = ReadStringMap(rawEvent, "headers", StringComparer.OrdinalIgnoreCase);
    var (rawPath, pathQuery) = SplitPathQuery(GetPath(rawEvent));
    Query = MergeQuery(ReadStringMap(rawEvent, "queryStringParameters", StringComparer.Ordinal), pathQuery);

    Body = rawEvent.TryGetProperty("body", out var bodyEl) && bodyEl.ValueKind == JsonValueKind.String
      ? bodyEl.GetString()
      : null;

    IsBase64Encoded = rawEvent.TryGetProperty("isBase64Encoded", out var b64El) && b64El.ValueKind == JsonValueKind.True;
    RawBody = Validation.DecodeBody(Body, IsBase64Encoded);

    Method = GetMethod(rawEvent);
    Path = Validation.NormalizePath(rawPath);
    TraceId = GetTraceId(rawEvent);
  }

  private LambdaRequest(
    JsonElement rawEvent,
    string method,
    string path,
    string? traceId,
    IReadOnlyDictionary<string, string> headers,
    IReadOnlyDictionary<string, string> query,
    string? body,
    bool isBase64Encoded,
    string rawBody)
  {
    RawEvent = rawEvent;
    Method = method;
    Path = path;
    TraceId = traceId;
    Headers = headers;
    Query = query;
    Body = body;
    IsBase64Encoded = isBase64Encoded;
    RawBody = rawBody;
  }

  public LambdaRequest WithHeader(string name, string value)
  {
    var next = new Dictionary<string, string>(Headers, StringComparer.OrdinalIgnoreCase)
    {
      [name] = value,
    };

    return new LambdaRequest(
      rawEvent: RawEvent,
      method: Method,
      path: Path,
      traceId: TraceId,
      headers: next,
      query: Query,
      body: Body,
      isBase64Encoded: IsBase64Encoded,
      rawBody: RawBody);
  }

  public LambdaRequest WithQuery(string name, string value)
  {
    var next = new Dictionary<string, string>(Query, StringComparer.Ordinal)
    {
      [name] = value,
    };

    return new LambdaRequest(
      rawEvent: RawEvent,
      method: Method,
      path: Path,
      traceId: TraceId,
      headers: Headers,
      query: next,
      body: Body,
      isBase64Encoded: IsBase64Encoded,
      rawBody: RawBody);
  }

  private static string GetMethod(JsonElement evt)
  {
    if (evt.TryGetProperty("requestContext", out var rc) && rc.ValueKind == JsonValueKind.Object)
    {
      if (rc.TryGetProperty("http", out var http) && http.ValueKind == JsonValueKind.Object)
      {
        if (http.TryGetProperty("method", out var m) && m.ValueKind == JsonValueKind.String)
        {
          var s = m.GetString();
          if (!string.IsNullOrWhiteSpace(s)) return s!;
        }
      }
    }

    if (evt.TryGetProperty("httpMethod", out var hm) && hm.ValueKind == JsonValueKind.String)
    {
      var s = hm.GetString();
      if (!string.IsNullOrWhiteSpace(s)) return s!;
    }

    return "GET";
  }

  private static string GetPath(JsonElement evt)
  {
    if (evt.TryGetProperty("rawPath", out var rp) && rp.ValueKind == JsonValueKind.String)
    {
      var s = rp.GetString();
      if (!string.IsNullOrWhiteSpace(s)) return s!;
    }

    if (evt.TryGetProperty("path", out var p) && p.ValueKind == JsonValueKind.String)
    {
      var s = p.GetString();
      if (!string.IsNullOrWhiteSpace(s)) return s!;
    }

    return "/";
  }

  /// <summary>
  /// API Gateway never puts a query string in rawPath, but a hand-built event does: scripts/invoke-as-admin.sh sends
  /// the path it is given as rawPath with an empty rawQueryString (e.g. the owner's
  /// <c>/api/v1/admin/db/migrate?confirmDestructive=45</c>, R26X F01). Split it off so the route still matches and
  /// the parameters reach <see cref="Query"/>.
  /// </summary>
  private static (string Path, Dictionary<string, string> Query) SplitPathQuery(string rawPath)
  {
    var query = new Dictionary<string, string>(StringComparer.Ordinal);
    var q = rawPath.IndexOf('?', StringComparison.Ordinal);
    if (q < 0) return (rawPath, query);

    foreach (var pair in rawPath[(q + 1)..].Split('&', StringSplitOptions.RemoveEmptyEntries))
    {
      var eq = pair.IndexOf('=', StringComparison.Ordinal);
      var name = Uri.UnescapeDataString(eq < 0 ? pair : pair[..eq]);
      var value = eq < 0 ? string.Empty : Uri.UnescapeDataString(pair[(eq + 1)..]);
      if (name.Length > 0) query.TryAdd(name, value);
    }

    return (rawPath[..q], query);
  }

  /// <summary>queryStringParameters wins over a parameter of the same name taken from rawPath.</summary>
  private static IReadOnlyDictionary<string, string> MergeQuery(IReadOnlyDictionary<string, string> fromEvent, Dictionary<string, string> fromPath)
  {
    if (fromPath.Count == 0) return fromEvent;
    foreach (var (name, value) in fromEvent) fromPath[name] = value;
    return fromPath;
  }

  private static string? GetTraceId(JsonElement evt)
  {
    if (evt.TryGetProperty("requestContext", out var rc) && rc.ValueKind == JsonValueKind.Object)
    {
      if (rc.TryGetProperty("requestId", out var id) && id.ValueKind == JsonValueKind.String)
      {
        return id.GetString();
      }
    }

    return null;
  }

  private static IReadOnlyDictionary<string, string> ReadStringMap(
    JsonElement evt,
    string propertyName,
    StringComparer comparer)
  {
    if (!evt.TryGetProperty(propertyName, out var el)) return new Dictionary<string, string>(comparer);
    if (el.ValueKind != JsonValueKind.Object) return new Dictionary<string, string>(comparer);

    var dict = new Dictionary<string, string>(comparer);
    foreach (var p in el.EnumerateObject())
    {
      dict[p.Name] = p.Value.ValueKind switch
      {
        JsonValueKind.String => p.Value.GetString() ?? string.Empty,
        JsonValueKind.Null => string.Empty,
        JsonValueKind.Undefined => string.Empty,
        _ => p.Value.ToString(),
      };
    }

    return dict;
  }
}
