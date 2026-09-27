using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using RecallSmith.Lambda.Common;
using RecallSmith.Lambda.Vpc.Automation;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The per-route HMAC check of the R18A internal routes (A01, contract A00 §8.3): the route's own secret is
/// mandatory and <c>INTERNAL_SHARED_SECRET</c> is never a fallback. Pure: <see cref="Auth.VerifyInternalSignatureStrict"/>
/// with fake secrets only, every variable restored in <c>finally</c>.
/// </summary>
[Collection(PostgresCollection.Name)]
public class InternalSignatureStrictTests
{
  private const string Shared = "test-shared-secret";
  // At least Auth.MinStrictSecretLength characters: a shorter value counts as unset (R18C L2).
  private const string Notifier = "test-notifier-secret-0000000000000001";
  private const string NotifierPrevious = "test-notifier-secret-0000000000000000-old";
  private const string ContractVectorSecret = "test-secret";
  private const string TerraformPlaceholder = "PLACEHOLDER-set-by-supervisor";
  private const string Body = "{\"a\":1}";

  private static string Sign(string secret, long ts, string body)
  {
    using var mac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
    return "v1=" + Convert.ToHexString(mac.ComputeHash(Encoding.UTF8.GetBytes($"{ts.ToString(CultureInfo.InvariantCulture)}.{body}"))).ToLowerInvariant();
  }

  private static LambdaRequest Signed(string secret, long? ts = null)
  {
    var at = ts ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    return new LambdaRequest(JsonSerializer.SerializeToElement(new
    {
      rawPath = "/api/internal/automation/tick",
      requestContext = new { requestId = Guid.NewGuid().ToString(), http = new { method = "POST" } },
      headers = new Dictionary<string, string>
      {
        ["x-internal-timestamp"] = at.ToString(CultureInfo.InvariantCulture),
        ["x-internal-signature"] = Sign(secret, at, Body),
      },
      body = Body,
      isBase64Encoded = false,
    }));
  }

  private static void WithSecrets(string? shared, string? notifier, string? notifierPrevious, Action body)
  {
    var names = new[]
    {
      Auth.InternalSharedSecretEnv, Auth.InternalSharedSecretEnv + Auth.PreviousSecretSuffix,
      AutomationEnv.NotifierSecretEnv, AutomationEnv.NotifierSecretEnv + Auth.PreviousSecretSuffix,
    };
    var saved = names.ToDictionary(n => n, Environment.GetEnvironmentVariable);
    try
    {
      Environment.SetEnvironmentVariable(Auth.InternalSharedSecretEnv, shared);
      Environment.SetEnvironmentVariable(Auth.InternalSharedSecretEnv + Auth.PreviousSecretSuffix, null);
      Environment.SetEnvironmentVariable(AutomationEnv.NotifierSecretEnv, notifier);
      Environment.SetEnvironmentVariable(AutomationEnv.NotifierSecretEnv + Auth.PreviousSecretSuffix, notifierPrevious);
      body();
    }
    finally
    {
      foreach (var (n, v) in saved) Environment.SetEnvironmentVariable(n, v);
    }
  }

  private static InternalSignatureVerifyResult Strict(string secret) =>
    Auth.VerifyInternalSignatureStrict(Signed(secret), AutomationEnv.NotifierSecretEnv);

  [Fact]
  public void Strict_UnsetRouteSecret_RefusesEvenWithSharedSecret()
  {
    WithSecrets(Shared, null, null, () =>
    {
      var v = Strict(Shared);
      Assert.False(v.Ok);
      Assert.Equal("Missing INTERNAL_SECRET_NOTIFIER", v.Reason);

      // The lenient check on the same request still falls back to the shared secret: only the strict one refuses.
      Assert.True(Auth.VerifyInternalSignature(Signed(Shared), AutomationEnv.NotifierSecretEnv).Ok);
    });

    WithSecrets(Shared, "", null, () =>
    {
      var v = Strict(Shared);
      Assert.False(v.Ok);
      Assert.Equal("Missing INTERNAL_SECRET_NOTIFIER", v.Reason);
    });
  }

  [Fact]
  public void Strict_RouteSecret_Accepts()
  {
    WithSecrets(null, Notifier, null, () =>
    {
      var v = Strict(Notifier);
      Assert.True(v.Ok, v.Reason);
      Assert.Null(v.Reason);

      Assert.Equal("Bad signature", Strict("test-other-secret").Reason);

      // Same skew rule as the lenient check: ±5 minutes.
      var stale = DateTimeOffset.UtcNow.AddMinutes(-6).ToUnixTimeMilliseconds();
      Assert.Equal("Timestamp expired", Auth.VerifyInternalSignatureStrict(Signed(Notifier, stale), AutomationEnv.NotifierSecretEnv).Reason);
    });
  }

  [Fact]
  public void Strict_PreviousSecret_IsAccepted()
  {
    WithSecrets(null, Notifier, NotifierPrevious, () =>
    {
      Assert.True(Strict(Notifier).Ok);
      Assert.True(Strict(NotifierPrevious).Ok);
      Assert.False(Strict("test-other-secret").Ok);
    });

    // Without the companion the old secret no longer signs.
    WithSecrets(null, Notifier, null, () => Assert.False(Strict(NotifierPrevious).Ok));

    // A previous secret alone never stands in for a missing route secret.
    WithSecrets(null, null, NotifierPrevious, () =>
    {
      var v = Strict(NotifierPrevious);
      Assert.False(v.Ok);
      Assert.Equal("Missing INTERNAL_SECRET_NOTIFIER", v.Reason);
    });
  }

  [Fact]
  public void Strict_SharedSecret_IsRefusedWhenRouteSecretSet()
  {
    WithSecrets(Shared, Notifier, null, () =>
    {
      var v = Strict(Shared);
      Assert.False(v.Ok);
      Assert.Equal("Bad signature", v.Reason);
      Assert.True(Strict(Notifier).Ok);
    });
  }

  [Fact]
  public void Strict_ContractVector_Matches()
  {
    const string expected = "v1=4ff7aae81c904927786fb5dc89854a13823626f7f1fd6692d046db073616bb85";

    // The raw formula: v1=hex(HMAC-SHA256(secret, "<ts>.<body>")).
    Assert.Equal(expected, Sign("test-secret", 1790000000000, Body));

    // The vector's secret is shorter than Auth.MinStrictSecretLength, so the strict check treats it as unset (R18C L2).
    WithSecrets(null, ContractVectorSecret, null, () =>
      Assert.Equal("Missing INTERNAL_SECRET_NOTIFIER", Strict(ContractVectorSecret).Reason));

    // A provisioned secret through the strict check, with a fresh timestamp (the vector's own is outside the skew).
    WithSecrets(null, Notifier, null, () =>
    {
      var v = Strict(Notifier);
      Assert.True(v.Ok, v.Reason);
      Assert.Equal("Timestamp expired", Auth.VerifyInternalSignatureStrict(Signed(Notifier, 1790000000000), AutomationEnv.NotifierSecretEnv).Reason);
    });
  }

  // R18C L2 (cloud-security-resilience-9): the value Terraform seeds the leaf with is public in the repo, so a request
  // signed with it must be refused as if no secret were set, whatever the deploy order.
  [Fact]
  public void Strict_TerraformPlaceholder_IsRefusedAsMissing()
  {
    WithSecrets(null, TerraformPlaceholder, null, () =>
    {
      var v = Strict(TerraformPlaceholder);
      Assert.False(v.Ok);
      Assert.Equal("Missing INTERNAL_SECRET_NOTIFIER", v.Reason);
    });

    // Any PLACEHOLDER- value, even a long one, and whatever the shared secret holds.
    var longPlaceholder = "PLACEHOLDER-" + new string('x', 40);
    WithSecrets(Notifier, longPlaceholder, null, () =>
    {
      Assert.Equal("Missing INTERNAL_SECRET_NOTIFIER", Strict(longPlaceholder).Reason);
      Assert.Equal("Missing INTERNAL_SECRET_NOTIFIER", Strict(Notifier).Reason);
    });
  }

  [Fact]
  public void Strict_ShortSecret_IsRefusedAsMissing()
  {
    var shortSecret = new string('s', Auth.MinStrictSecretLength - 1);
    WithSecrets(null, shortSecret, null, () => Assert.Equal("Missing INTERNAL_SECRET_NOTIFIER", Strict(shortSecret).Reason));

    var exact = new string('s', Auth.MinStrictSecretLength);
    WithSecrets(null, exact, null, () => Assert.True(Strict(exact).Ok));
  }

  // The _PREVIOUS companion follows the same rule: a placeholder or short previous secret never signs.
  [Fact]
  public void Strict_PlaceholderPreviousSecret_IsIgnored()
  {
    WithSecrets(null, Notifier, TerraformPlaceholder, () =>
    {
      Assert.True(Strict(Notifier).Ok);
      Assert.Equal("Bad signature", Strict(TerraformPlaceholder).Reason);
    });

    const string shortPrevious = "short-previous";
    WithSecrets(null, Notifier, shortPrevious, () => Assert.Equal("Bad signature", Strict(shortPrevious).Reason));
  }

  [Theory]
  [InlineData(null, false)]
  [InlineData("", false)]
  [InlineData("PLACEHOLDER-set-by-supervisor", false)]
  [InlineData("PLACEHOLDER-0123456789012345678901234567890123456789", false)]
  [InlineData("0123456789012345678901234567890", false)]
  [InlineData("01234567890123456789012345678901", true)]
  [InlineData("placeholder-0123456789012345678901234567890", true)]
  public void IsProvisionedSecret_FollowsL2(string? value, bool expected) => Assert.Equal(expected, Auth.IsProvisionedSecret(value));
}
