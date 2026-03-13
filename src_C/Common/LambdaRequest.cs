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

  public LambdaRequest(JsonElement rawEvent)
  {
    RawEvent = rawEvent;

    Headers = ReadStringMap(rawEvent, "headers", StringComparer.OrdinalIgnoreCase);
    Query = ReadStringMap(rawEvent, "queryStringParameters", StringComparer.Ordinal);

    Body = rawEvent.TryGetProperty("body", out var bodyEl) && bodyEl.ValueKind == JsonValueKind.String
      ? bodyEl.GetString()
      : null;

    IsBase64Encoded = rawEvent.TryGetProperty("isBase64Encoded", out var b64El) && b64El.ValueKind == JsonValueKind.True;
    RawBody = Validation.DecodeBody(Body, IsBase64Encoded);

    Method = GetMethod(rawEvent);
    Path = Validation.NormalizePath(GetPath(rawEvent));
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

