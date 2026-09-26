using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Vpc.Runtime;

/// <summary>
/// POST /api/v1/user/client-errors: the interim server sink for client-side JS errors, in
/// place until the Sentry SDK ships with the 1.7.0 binary (H02). It is log-only -- one
/// structured <c>warn</c> line per report and nothing else: no database, no S3, no queue,
/// no persistence of any kind.
/// </summary>
/// <remarks>
/// The bearer is optional in code: a missing or rejected token is still accepted anonymously,
/// because an expired token is a likely cause of the very errors being reported. After E08 the
/// gateway puts the mobile authorizer on <c>/api/v1/user/*</c>, so anonymous reports only reach
/// this function before E08 is applied; a signed-in caller's sub is logged as a 16-hex
/// SHA-256 prefix, never the sub itself.
/// </remarks>
public static class ClientErrors
{
  public const int MaxBodyChars = 16384;
  public const int MaxMessageChars = 1000;
  public const int MaxStackChars = 8000;
  public const int MaxComponentStackChars = 4000;
  public const int MaxShortFieldChars = 128;
  internal const int MaxReportsPerWindow = 60;
  internal const long WindowMs = 60_000;
  internal static readonly string[] AllowedKinds = ["js_error", "unhandled_rejection", "boundary", "other"];

  // A per-container budget guarded by a lock. Static, so it survives across invocations warm on
  // the same container; the process is the "container" the budget names.
  private static readonly object BudgetLock = new();
  private static long _windowStart;
  private static int _count;
  private static bool _budgetLineWritten;

  public static Task<APIGatewayProxyResponse> HandleClientErrors(LambdaRequest req, Res res, AuthContext auth)
  {
    // 1. Method gate.
    if (!string.Equals(req.Method, "POST", StringComparison.OrdinalIgnoreCase))
    {
      return Task.FromResult(res.MethodNotAllowed("Method not allowed"));
    }

    // 2. This route's own 16 KB cap, tighter than E07's 1 MiB global cap and with its own
    //    envelope naming the smaller limit.
    if (req.RawBody.Length > MaxBodyChars)
    {
      return Task.FromResult(res.Raw(413, new
      {
        success = false,
        data = (object?)null,
        error = new { code = "PAYLOAD_TOO_LARGE", message = "client error report exceeds 16384 characters" },
        traceId = res.TraceId,
        version = "v1",
      }));
    }

    // 3. One JSON object, never a batch.
    using var doc = Validation.ParseJsonBody(req);
    if (doc is null)
    {
      return Task.FromResult(res.BadRequest("BAD_REQUEST", "Invalid JSON body"));
    }
    var root = doc.RootElement;
    if (root.ValueKind != JsonValueKind.Object)
    {
      return Task.FromResult(res.BadRequest("VALIDATION_ERROR", "body must be one JSON object"));
    }

    // 4. Validate and clamp per the contract. Any present field of the wrong JSON type is a 400.
    if (!TryReadString(root, "kind", out var kindRaw, out var err))
    {
      return Task.FromResult(res.BadRequest("VALIDATION_ERROR", err));
    }
    if (string.IsNullOrWhiteSpace(kindRaw))
    {
      return Task.FromResult(res.BadRequest("VALIDATION_ERROR", "kind is required"));
    }
    var kind = kindRaw.Trim().ToLowerInvariant();
    if (Array.IndexOf(AllowedKinds, kind) < 0)
    {
      return Task.FromResult(res.BadRequest("VALIDATION_ERROR", "kind must be one of js_error, unhandled_rejection, boundary, other"));
    }

    if (!TryReadString(root, "message", out var messageRaw, out err))
    {
      return Task.FromResult(res.BadRequest("VALIDATION_ERROR", err));
    }
    if (string.IsNullOrWhiteSpace(messageRaw))
    {
      return Task.FromResult(res.BadRequest("VALIDATION_ERROR", "message is required"));
    }
    var message = Clamp(messageRaw.Trim(), MaxMessageChars);

    if (!TryReadString(root, "stack", out var stackRaw, out err))
    {
      return Task.FromResult(res.BadRequest("VALIDATION_ERROR", err));
    }
    var stack = Clamp(stackRaw, MaxStackChars);

    if (!TryReadString(root, "componentStack", out var componentStackRaw, out err))
    {
      return Task.FromResult(res.BadRequest("VALIDATION_ERROR", err));
    }
    var componentStack = Clamp(componentStackRaw, MaxComponentStackChars);

    if (!TryReadShort(root, "screen", out var screen, out err)) return Task.FromResult(res.BadRequest("VALIDATION_ERROR", err));
    if (!TryReadShort(root, "appVersion", out var appVersion, out err)) return Task.FromResult(res.BadRequest("VALIDATION_ERROR", err));
    if (!TryReadShort(root, "runtimeVersion", out var runtimeVersion, out err)) return Task.FromResult(res.BadRequest("VALIDATION_ERROR", err));
    if (!TryReadShort(root, "updateId", out var updateId, out err)) return Task.FromResult(res.BadRequest("VALIDATION_ERROR", err));
    if (!TryReadShort(root, "platform", out var platform, out err)) return Task.FromResult(res.BadRequest("VALIDATION_ERROR", err));
    if (!TryReadShort(root, "osVersion", out var osVersion, out err)) return Task.FromResult(res.BadRequest("VALIDATION_ERROR", err));

    if (!TryReadBool(root, "isFatal", out var isFatal, out err))
    {
      return Task.FromResult(res.BadRequest("VALIDATION_ERROR", err));
    }

    if (!TryReadMs(root, "occurredAtMs", out var occurredAtMs, out err))
    {
      return Task.FromResult(res.BadRequest("VALIDATION_ERROR", err));
    }

    // 5. Budget. A per-container window: reset when stale, drop past the cap, otherwise count.
    lock (BudgetLock)
    {
      var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
      if (now - _windowStart >= WindowMs)
      {
        _windowStart = now;
        _count = 0;
        _budgetLineWritten = false;
      }

      if (_count >= MaxReportsPerWindow)
      {
        // First drop of the window only: one line saying the budget capped, then silence for
        // the rest of the window so the drop itself cannot flood the log it protects.
        if (!_budgetLineWritten)
        {
          _budgetLineWritten = true;
          Log.Event("warn", new { tag = "client_error_budget", droppedAfter = MaxReportsPerWindow, windowMs = WindowMs });
        }
        return Task.FromResult(Accepted(res, new { accepted = false, dropped = true }));
      }

      _count++;
    }

    // 6. Exactly one structured line, only the whitelisted fields.
    Log.Event("warn", new
    {
      tag = "client_error",
      kind, message, stack, componentStack, screen, isFatal,
      appVersion, runtimeVersion, updateId, platform, osVersion, occurredAtMs,
      userSubHash = string.IsNullOrWhiteSpace(auth.UserSub) ? null : HashSub(auth.UserSub),
      authRejected = auth.RejectReason is not null,
      traceId = req.TraceId,
    });

    // 7. Accepted, persisting nothing.
    return Task.FromResult(Accepted(res, new { accepted = true }));
  }

  /// <summary>Zeroes the per-container window. For tests only.</summary>
  internal static void ResetBudget()
  {
    lock (BudgetLock)
    {
      _windowStart = 0;
      _count = 0;
      _budgetLineWritten = false;
    }
  }

  /// <summary>Lower-case hex SHA-256 of the UTF-8 sub, first 16 characters. Never the sub itself.</summary>
  internal static string HashSub(string sub)
  {
    var hash = SHA256.HashData(Encoding.UTF8.GetBytes(sub));
    return Convert.ToHexString(hash).ToLowerInvariant()[..16];
  }

  private static APIGatewayProxyResponse Accepted(Res res, object data) =>
    res.Raw(202, new { success = true, data, error = (object?)null, traceId = res.TraceId, version = "v1" });

  private static string? Clamp(string? s, int max) =>
    s is null ? null : (s.Length > max ? s[..max] : s);

  /// <summary>
  /// Reads an optional string: missing or JSON null yields null, a string yields its value, any
  /// other present type is a validation error.
  /// </summary>
  private static bool TryReadString(JsonElement root, string name, out string? value, out string? error)
  {
    value = null;
    error = null;
    if (!root.TryGetProperty(name, out var el)) return true;
    switch (el.ValueKind)
    {
      case JsonValueKind.Null:
        return true;
      case JsonValueKind.String:
        value = el.GetString();
        return true;
      default:
        error = $"{name} must be a string";
        return false;
    }
  }

  /// <summary>An optional string, clamped to <see cref="MaxShortFieldChars"/>.</summary>
  private static bool TryReadShort(JsonElement root, string name, out string? value, out string? error)
  {
    if (!TryReadString(root, name, out var raw, out error))
    {
      value = null;
      return false;
    }
    value = Clamp(raw, MaxShortFieldChars);
    return true;
  }

  private static bool TryReadBool(JsonElement root, string name, out bool? value, out string? error)
  {
    value = null;
    error = null;
    if (!root.TryGetProperty(name, out var el)) return true;
    switch (el.ValueKind)
    {
      case JsonValueKind.Null:
        return true;
      case JsonValueKind.True:
        value = true;
        return true;
      case JsonValueKind.False:
        value = false;
        return true;
      default:
        error = $"{name} must be a boolean";
        return false;
    }
  }

  /// <summary>An optional integer milliseconds value; a value of zero or below is read as null.</summary>
  private static bool TryReadMs(JsonElement root, string name, out long? value, out string? error)
  {
    value = null;
    error = null;
    if (!root.TryGetProperty(name, out var el)) return true;
    switch (el.ValueKind)
    {
      case JsonValueKind.Null:
        return true;
      case JsonValueKind.Number when el.TryGetInt64(out var ms):
        value = ms > 0 ? ms : null;
        return true;
      default:
        error = $"{name} must be an integer";
        return false;
    }
  }
}
