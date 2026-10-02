using System.Net.Http.Headers;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Vpc.Runtime;

/// <summary>
/// R25 G04: deletes the caller's RevenueCat customer record after their account rows are gone
/// (<c>DELETE {REVENUECAT_API_BASE}/v1/subscribers/{app_user_id}</c>, app_user_id = the Cognito sub).
/// Best effort by design: it never throws and never changes the user's response.
/// </summary>
/// <remarks>
/// The key comes from SSM <c>/developercards/prod/revenuecat-secret-api-key</c> through deploy.sh's
/// SSM→env mapping. Without it the call is skipped. Each attempt has a 5 s budget; a 5xx or a
/// timeout gets exactly one retry. 2xx is <c>deleted</c>, 404 is <c>not_found</c> (nothing to
/// delete), anything else is <c>failed</c>. One log line, tag <c>revenuecat_delete</c>, carries the
/// outcome and the last status code only -- never the key, the sub or a response body.
/// </remarks>
public static class RevenueCatCustomerDeletion
{
  public const string KeyEnv = "REVENUECAT_SECRET_API_KEY";
  public const string BaseEnv = "REVENUECAT_API_BASE";
  public const string DefaultBase = "https://api.revenuecat.com";
  public static readonly TimeSpan DefaultAttemptTimeout = TimeSpan.FromSeconds(5);

  // The per-attempt budget is enforced by a CancellationTokenSource, so the client itself never times out.
  private static readonly HttpClient Client = new() { Timeout = System.Threading.Timeout.InfiniteTimeSpan };

  /// <summary>Test seam: a fake handler in place of the network.</summary>
  internal static HttpMessageHandler? HandlerOverride;

  /// <summary>Test seam: the per-attempt budget, so a timeout test does not wait 10 s.</summary>
  internal static TimeSpan AttemptTimeout = DefaultAttemptTimeout;

  private const int MaxAttempts = 2;

  public static async Task DeleteCustomerAsync(string appUserId)
  {
    string outcome;
    int? status = null;
    var attempts = 0;
    try
    {
      var key = Environment.GetEnvironmentVariable(KeyEnv);
      if (string.IsNullOrWhiteSpace(key))
      {
        outcome = "skipped_no_key";
      }
      else
      {
        var baseUrl = Environment.GetEnvironmentVariable(BaseEnv);
        if (string.IsNullOrWhiteSpace(baseUrl)) baseUrl = DefaultBase;
        var url = baseUrl.Trim().TrimEnd('/') + "/v1/subscribers/" + Uri.EscapeDataString(appUserId);
        var invoker = HandlerOverride is { } h ? new HttpMessageInvoker(h, disposeHandler: false) : Client;

        (outcome, status, attempts) = await SendWithRetryAsync(invoker, url, key.Trim());
      }
    }
    catch
    {
      // Never let the cleanup call fail the user's deletion; the exception text could carry the URL.
      outcome = "failed";
    }

    Log.Event(outcome == "failed" ? "warn" : "info", new
    {
      tag = "revenuecat_delete",
      outcome,
      status,
      attempts,
    });
  }

  private static async Task<(string Outcome, int? Status, int Attempts)> SendWithRetryAsync(
    HttpMessageInvoker invoker, string url, string key)
  {
    int? status = null;
    var attempt = 0;
    while (attempt < MaxAttempts)
    {
      attempt++;
      status = null;
      using var cts = new CancellationTokenSource(AttemptTimeout);
      using var request = new HttpRequestMessage(HttpMethod.Delete, url);
      request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
      try
      {
        using var response = await invoker.SendAsync(request, cts.Token);
        status = (int)response.StatusCode;
      }
      catch (OperationCanceledException) when (cts.IsCancellationRequested)
      {
        continue; // timeout: retry once
      }

      if (status is >= 200 and < 300) return ("deleted", status, attempt);
      if (status == 404) return ("not_found", status, attempt);
      if (status < 500) return ("failed", status, attempt);
      // 5xx: retry once
    }
    return ("failed", status, attempt);
  }
}
