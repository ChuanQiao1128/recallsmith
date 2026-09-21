using System.Text.Json;
using System.Text.Json.Serialization;
using Amazon.Lambda.APIGatewayEvents;

namespace RecallSmith.Lambda.Common;

public sealed class Res
{
  public string? TraceId { get; }

  private readonly string _apiVersion;
  private readonly string? _allowOrigin;
  private readonly bool _varyOnOrigin;

  /// <param name="requestOrigin">
  /// The caller's Origin header, or null when it has none. Null is the fail-closed input:
  /// under a configured allowlist a Res built without an origin allows nobody, so a route
  /// that forgets to pass one loses CORS rather than handing it out. That is also why this
  /// stays optional — the alternative, a required parameter, would have been answered at
  /// every call site with whatever compiled.
  /// </param>
  public Res(string? traceId, string? requestOrigin = null)
  {
    TraceId = traceId;
    _apiVersion = Environment.GetEnvironmentVariable("API_VERSION") ?? "v1";

    // Read per response rather than cached in a static: the value is read per response today
    // as well, parsing a short string costs microseconds against a 20 ms query, and a cache
    // would need an invalidation hook that nothing but a test would ever call.
    var cors = DecideCors(Environment.GetEnvironmentVariable("CORS_ORIGIN"), requestOrigin);
    _allowOrigin = cors.AllowOrigin;
    _varyOnOrigin = cors.VaryOnOrigin;
  }

  /// <summary>
  /// The CORS half of one response: the access-control-allow-origin value (null meaning
  /// "send no such header"), and whether the answer depended on the request's Origin.
  /// </summary>
  public readonly record struct CorsDecision(string? AllowOrigin, bool VaryOnOrigin);

  /// <summary>
  /// Decides that pair from the configured CORS_ORIGIN value and the caller's Origin.
  /// Pure, and deliberately separate from the environment read so it can be tested without
  /// mutating process-global state.
  /// </summary>
  /// <remarks>
  /// API Gateway holds the real allowlist; this is the second copy of it. The point of the
  /// second copy is that the two must not be able to disagree silently — a gateway config
  /// change that widens the origin set now still meets a Lambda that answers only for
  /// origins named here.
  /// </remarks>
  public static CorsDecision DecideCors(string? configured, string? requestOrigin)
  {
    // Wildcard mode: byte-for-byte what this class did before an allowlist existed.
    //
    // The literal "*" has to land here too, and that is not cosmetic. If the deployed
    // function already sets CORS_ORIGIN=* explicitly, reading it as a one-entry allowlist
    // would match no origin at all and kill every browser call the moment this code shipped
    // — the exact failure that shipping the code before the env change is meant to avoid.
    if (configured is null || configured.Trim() == "*") return new CorsDecision("*", false);

    // Allowlist mode from here down. Note what is NOT reachable below: "*". A response that
    // names one origin cannot also name all of them, so a misconfigured "*,https://real"
    // simply loses its wildcard — no browser sends `Origin: *`, so that entry matches
    // nothing and the real entry still works.
    foreach (var entry in configured.Split(','))
    {
      var allowed = entry.Trim();
      if (allowed.Length == 0) continue;
      if (string.IsNullOrEmpty(requestOrigin)) continue;

      // OrdinalIgnoreCase, because an origin is scheme://host[:port] and both the scheme and
      // the host are case-insensitive (RFC 3986 3.1/3.2.2, RFC 6454 4). Ignoring case here
      // therefore cannot admit an origin that a case-sensitive match would have rejected;
      // it only forgives a capitalised entry in the configuration.
      if (!string.Equals(allowed, requestOrigin, StringComparison.OrdinalIgnoreCase)) continue;

      // Echo the REQUEST's spelling, not the configured entry's. The browser compares this
      // header against its own serialised origin exactly, so answering "https://App.Example"
      // to a request from "https://app.example" would fail the very check the entry was
      // written to pass. Echoing is safe precisely because we only get here after a match:
      // the value is byte-equal to a configured entry apart from ASCII case, so no
      // caller-controlled text (a CR/LF, another origin) can reach the header this way.
      return new CorsDecision(requestOrigin, true);
    }

    // No match — including the case where the configuration parsed to nothing at all
    // (CORS_ORIGIN="" or ","). That stays here rather than falling back to "*": a typo in
    // the allowlist must not open the API to everyone, and today an empty value already
    // allows nobody (it emits an empty header that no browser accepts).
    return new CorsDecision(null, true);
  }

  private static readonly JsonSerializerOptions JsonOptions = new()
  {
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    WriteIndented = false,
  };

  private APIGatewayProxyResponse Base(int statusCode, string body, IDictionary<string, string>? extraHeaders = null)
  {
    // Built key by key instead of in one initialiser so that insertion order survives:
    // with CORS_ORIGIN unset this dictionary is key-for-key AND order-for-order the one this
    // method returned before the allowlist existed, so the JSON API Gateway receives is
    // unchanged rather than merely equivalent.
    var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
      ["content-type"] = "application/json",
    };

    // Omitted entirely — not sent empty, not widened to "*" — when a configured allowlist
    // does not cover the caller. An absent header is the only thing a browser reads as
    // "not allowed"; an empty one is a malformed header that merely happens to fail.
    if (_allowOrigin is not null) headers["access-control-allow-origin"] = _allowOrigin;

    headers["access-control-allow-headers"] =
      "authorization,content-type,accept,x-internal-timestamp,x-internal-signature,x-migrate-secret";
    headers["access-control-allow-methods"] = "GET,POST,PUT,DELETE,OPTIONS";

    // Only in allowlist mode. There the response genuinely varies by request origin, so any
    // cache in front of this must key on it. In wildcard mode every origin gets the same
    // answer, and emitting it anyway would be a behaviour change on an unset env var.
    if (_varyOnOrigin) headers["vary"] = "Origin";

    if (extraHeaders is not null)
    {
      foreach (var kv in extraHeaders) headers[kv.Key] = kv.Value;
    }

    return new APIGatewayProxyResponse
    {
      StatusCode = statusCode,
      Headers = headers,
      Body = body,
    };
  }

  public APIGatewayProxyResponse Raw(int statusCode, object body, IDictionary<string, string>? extraHeaders = null)
  {
    var s = body is string str ? str : JsonSerializer.Serialize(body, JsonOptions);
    return Base(statusCode, s, extraHeaders);
  }

  private APIGatewayProxyResponse Wrap(int statusCode, bool success, object? data, ApiError? error)
  {
    var envelope = new ApiEnvelope
    {
      Success = success,
      Data = data,
      Error = error,
      TraceId = TraceId,
      Version = _apiVersion,
    };

    return Base(statusCode, JsonSerializer.Serialize(envelope, JsonOptions));
  }

  public APIGatewayProxyResponse Ok(object? data) => Wrap(200, true, data, null);

  public APIGatewayProxyResponse BadRequest(string code, string? message = null) =>
    Wrap(400, false, null, new ApiError { Code = code, Message = message });

  public APIGatewayProxyResponse Unauthorized(string? message = null) =>
    Wrap(401, false, null, new ApiError { Code = "UNAUTHORIZED", Message = message });

  public APIGatewayProxyResponse Forbidden(string? message = null) =>
    Wrap(403, false, null, new ApiError { Code = "FORBIDDEN", Message = message });

  public APIGatewayProxyResponse NotFound(string? message = null) =>
    Wrap(404, false, null, new ApiError { Code = "NOT_FOUND", Message = message });

  public APIGatewayProxyResponse MethodNotAllowed(string? message = null) =>
    Wrap(405, false, null, new ApiError { Code = "METHOD_NOT_ALLOWED", Message = message });

  public APIGatewayProxyResponse NotImplemented(string? message = null) =>
    Wrap(501, false, null, new ApiError { Code = "NOT_IMPLEMENTED", Message = message });

  public APIGatewayProxyResponse Error500(Exception? ex)
  {
    // Do not leak internal error details to clients — but do keep them for us. Until 2026-09-21
    // nothing logged the exception behind a 500, so a failed console import ("Internal server
    // error" on one card) left no trace in CloudWatch. Type + message + SqlState/constraint for
    // Postgres; the stack only at Debug (it is long and rarely needed).
    if (ex is not null)
    {
      var pg = ex as Npgsql.PostgresException;
      Console.WriteLine(JsonSerializer.Serialize(new
      {
        level = "error",
        tag = "unhandled",
        traceId = TraceId,
        type = ex.GetType().FullName,
        message = ex.Message,
        sqlState = pg?.SqlState,
        constraint = pg?.ConstraintName,
        detail = pg?.Detail,
        inner = ex.InnerException?.Message,
      }));
    }
    return Wrap(500, false, null, new ApiError { Code = "INTERNAL_ERROR", Message = "Internal server error" });
  }

  private sealed class ApiEnvelope
  {
    public bool Success { get; init; }
    public object? Data { get; init; }
    public ApiError? Error { get; init; }
    public string? TraceId { get; init; }
    public string Version { get; init; } = "v1";
  }

  private sealed class ApiError
  {
    public string Code { get; init; } = string.Empty;

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Message { get; init; }
  }
}
