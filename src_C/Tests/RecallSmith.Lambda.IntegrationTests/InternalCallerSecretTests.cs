using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Internal;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Least privilege for the internal routes (R18 Y02, cloud-security-resilience-2): each caller-facing route verifies
/// its own secret when it is configured, so the webhook dispatcher's credential cannot sign AI QA results and the
/// ai-qa Lambda's cannot sign delivery reports. Without a route secret the shared secret still works (the pre-split
/// behaviour). Pure: <see cref="Auth.VerifyInternalSignature(LambdaRequest, string?)"/> with fake secrets only.
/// </summary>
[Collection(PostgresCollection.Name)]
public class InternalCallerSecretTests
{
  private const string Shared = "test-shared-secret";
  private const string AiQa = "test-ai-qa-secret";
  private const string Dispatcher = "test-dispatcher-secret";

  private static LambdaRequest Signed(string secret, string path)
  {
    const string body = "{\"a\":1}";
    var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    using var mac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
    var sig = "v1=" + Convert.ToHexString(mac.ComputeHash(Encoding.UTF8.GetBytes($"{ts.ToString(CultureInfo.InvariantCulture)}.{body}"))).ToLowerInvariant();
    return new LambdaRequest(JsonSerializer.SerializeToElement(new
    {
      rawPath = path,
      requestContext = new { requestId = Guid.NewGuid().ToString(), http = new { method = "POST" } },
      headers = new Dictionary<string, string>
      {
        ["x-internal-timestamp"] = ts.ToString(CultureInfo.InvariantCulture),
        ["x-internal-signature"] = sig,
      },
      body,
      isBase64Encoded = false,
    }));
  }

  private static void WithSecrets(string? shared, string? aiQa, string? dispatcher, Action body)
  {
    var names = new[] { Auth.InternalSharedSecretEnv, AiQaResults.CallerSecretEnv, WebhookDeliveryReport.CallerSecretEnv };
    var saved = names.ToDictionary(n => n, Environment.GetEnvironmentVariable);
    try
    {
      Environment.SetEnvironmentVariable(Auth.InternalSharedSecretEnv, shared);
      Environment.SetEnvironmentVariable(AiQaResults.CallerSecretEnv, aiQa);
      Environment.SetEnvironmentVariable(WebhookDeliveryReport.CallerSecretEnv, dispatcher);
      body();
    }
    finally
    {
      foreach (var (n, v) in saved) Environment.SetEnvironmentVariable(n, v);
    }
  }

  private static bool AiQaRoute(string secret) =>
    Auth.VerifyInternalSignature(Signed(secret, "/api/internal/ai-qa/results"), AiQaResults.CallerSecretEnv).Ok;

  private static bool ReportRoute(string secret) =>
    Auth.VerifyInternalSignature(Signed(secret, "/api/internal/webhooks/deliveries/report"), WebhookDeliveryReport.CallerSecretEnv).Ok;

  [Fact]
  public void PerCallerSecrets_EachRouteAcceptsOnlyItsOwn()
  {
    WithSecrets(Shared, AiQa, Dispatcher, () =>
    {
      Assert.True(AiQaRoute(AiQa));
      Assert.False(AiQaRoute(Dispatcher));
      Assert.False(AiQaRoute(Shared));

      Assert.True(ReportRoute(Dispatcher));
      Assert.False(ReportRoute(AiQa));
      Assert.False(ReportRoute(Shared));

      // Routes without a caller secret keep the shared one.
      Assert.True(Auth.VerifyInternalSignature(Signed(Shared, "/api/internal/entitlements/apply")).Ok);
    });
  }

  [Fact]
  public void WithoutCallerSecrets_TheSharedSecretStillSigns()
  {
    WithSecrets(Shared, null, null, () =>
    {
      Assert.True(AiQaRoute(Shared));
      Assert.True(ReportRoute(Shared));
      Assert.False(AiQaRoute(AiQa));
    });

    WithSecrets(null, null, null, () =>
    {
      var v = Auth.VerifyInternalSignature(Signed(Shared, "/api/internal/ai-qa/results"), AiQaResults.CallerSecretEnv);
      Assert.False(v.Ok);
      Assert.Equal("Missing INTERNAL_SHARED_SECRET", v.Reason);
    });
  }

  private const string SharedPrevious = "test-shared-secret-old";
  private const string AiQaPrevious = "test-ai-qa-secret-old";

  private static void WithPrevious(string? sharedPrevious, string? aiQaPrevious, Action body)
  {
    var names = new[] { Auth.InternalSharedSecretEnv + Auth.PreviousSecretSuffix, AiQaResults.CallerSecretEnv + Auth.PreviousSecretSuffix };
    var saved = names.ToDictionary(n => n, Environment.GetEnvironmentVariable);
    try
    {
      Environment.SetEnvironmentVariable(names[0], sharedPrevious);
      Environment.SetEnvironmentVariable(names[1], aiQaPrevious);
      body();
    }
    finally
    {
      foreach (var (n, v) in saved) Environment.SetEnvironmentVariable(n, v);
    }
  }

  [Fact]
  public void SharedSecretRotation_BothHmacRoutesAcceptCurrentAndPrevious()
  {
    // cloud-security-resilience-11: while INTERNAL_SHARED_SECRET_PREVIOUS is set, a caller still signing with the
    // old value keeps working on both HMAC routes (and every shared-secret route), so a rotation has no flag day.
    Assert.Equal("INTERNAL_SHARED_SECRET_PREVIOUS", Auth.InternalSharedSecretEnv + Auth.PreviousSecretSuffix);
    WithSecrets(Shared, null, null, () =>
    {
      Assert.False(AiQaRoute(SharedPrevious));
      Assert.False(ReportRoute(SharedPrevious));

      WithPrevious(SharedPrevious, null, () =>
      {
        Assert.True(AiQaRoute(Shared));
        Assert.True(AiQaRoute(SharedPrevious));
        Assert.True(ReportRoute(Shared));
        Assert.True(ReportRoute(SharedPrevious));
        Assert.True(Auth.VerifyInternalSignature(Signed(SharedPrevious, "/api/internal/entitlements/apply")).Ok);
        Assert.False(AiQaRoute("some-other-secret"));
      });

      // An empty previous is no secret at all.
      WithPrevious("", null, () => Assert.False(AiQaRoute("")));
    });
  }

  [Fact]
  public void RouteSecret_PreviousIsItsOwn_NotTheSharedOne()
  {
    // cloud-security-resilience-2 cut-over: a route with its own secret accepts that secret's _PREVIOUS (so the
    // Lambda may keep signing with the old value until it is redeployed), never the shared secret's.
    WithSecrets(Shared, AiQa, Dispatcher, () =>
    {
      WithPrevious(SharedPrevious, AiQaPrevious, () =>
      {
        Assert.True(AiQaRoute(AiQa));
        Assert.True(AiQaRoute(AiQaPrevious));
        Assert.False(AiQaRoute(Shared));
        Assert.False(AiQaRoute(SharedPrevious));
        Assert.False(ReportRoute(AiQaPrevious));
        Assert.False(ReportRoute(SharedPrevious));
        Assert.True(ReportRoute(Dispatcher));
      });
    });
  }
}
