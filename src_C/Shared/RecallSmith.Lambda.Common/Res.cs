using System.Text.Json;
using System.Text.Json.Serialization;
using Amazon.Lambda.APIGatewayEvents;

namespace RecallSmith.Lambda.Common;

public sealed class Res
{
  public string? TraceId { get; }

  private readonly string _apiVersion;
  private readonly string _corsOrigin;

  public Res(string? traceId)
  {
    TraceId = traceId;
    _apiVersion = Environment.GetEnvironmentVariable("API_VERSION") ?? "v1";
    _corsOrigin = Environment.GetEnvironmentVariable("CORS_ORIGIN") ?? "*";
  }

  private static readonly JsonSerializerOptions JsonOptions = new()
  {
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    WriteIndented = false,
  };

  private APIGatewayProxyResponse Base(int statusCode, string body, IDictionary<string, string>? extraHeaders = null)
  {
    var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
      ["content-type"] = "application/json",
      ["access-control-allow-origin"] = _corsOrigin,
      ["access-control-allow-headers"] =
        "authorization,content-type,accept,x-internal-timestamp,x-internal-signature,x-migrate-secret",
      ["access-control-allow-methods"] = "GET,POST,PUT,DELETE,OPTIONS",
    };

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

  public APIGatewayProxyResponse Error500(Exception? _)
  {
    // Do not leak internal error details to clients.
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
