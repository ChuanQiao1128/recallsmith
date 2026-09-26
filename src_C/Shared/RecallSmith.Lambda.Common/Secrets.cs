using System.Security.Cryptography;
using System.Text;

namespace RecallSmith.Lambda.Common;

/// Constant-time secret comparison. Shared by the x-migrate-secret gates (Migrate.cs,
/// AppRole.cs) and, from E07, the RevenueCat webhook bearer. Same idiom as
/// Auth.VerifyInternalSignature: UTF-8 bytes, equal-length check, FixedTimeEquals.
public static class Secrets
{
  public static bool FixedTimeEquals(string? got, string? expected)
  {
    if (string.IsNullOrEmpty(got) || string.IsNullOrEmpty(expected)) return false;
    var a = Encoding.UTF8.GetBytes(got);
    var b = Encoding.UTF8.GetBytes(expected);
    if (a.Length != b.Length) return false;
    return CryptographicOperations.FixedTimeEquals(a, b);
  }
}
