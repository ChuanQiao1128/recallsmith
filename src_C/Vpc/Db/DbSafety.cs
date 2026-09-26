using Amazon.Lambda.APIGatewayEvents;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Vpc.Db;

/// <summary>
/// The single production gate for the destructive DB routes (CBE-08). Reads env per call (no
/// caching) so tests can toggle it. create / recreate / content-intelligence-demo are 404 in
/// production unless ALLOW_DESTRUCTIVE_DB=1, and every x-migrate-secret check runs through one
/// constant-time comparer (E06's <see cref="Secrets.FixedTimeEquals"/>), missing-in-prod being 503.
/// </summary>
public static class DbSafety
{
  public const string AllowDestructiveEnv = "ALLOW_DESTRUCTIVE_DB";
  public const string MigrateSecretEnv = "MIGRATE_SECRET";
  public const string MigrateSecretHeader = "x-migrate-secret";

  public static bool IsProduction(string? apiEnv) =>
    string.Equals(apiEnv?.Trim(), "production", StringComparison.OrdinalIgnoreCase);

  /// <summary>
  /// Pure. create / recreate / content-intelligence-demo exist outside production, and in
  /// production only while ALLOW_DESTRUCTIVE_DB is exactly "1".
  /// </summary>
  public static bool DestructiveRoutesEnabled(string? apiEnv, string? allowDestructive) =>
    !IsProduction(apiEnv) || string.Equals(allowDestructive?.Trim(), "1", StringComparison.Ordinal);

  public static bool DestructiveRoutesEnabled() => DestructiveRoutesEnabled(
    Environment.GetEnvironmentVariable("API_ENV"),
    Environment.GetEnvironmentVariable(AllowDestructiveEnv));

  /// <summary>
  /// null = proceed. A configured MIGRATE_SECRET must match x-migrate-secret
  /// (<see cref="Secrets.FixedTimeEquals"/>), else 403 FORBIDDEN "Bad migrate secret". No secret
  /// configured: 503 CONFIG_ERROR "MIGRATE_SECRET is required in production" when API_ENV=production,
  /// null elsewhere (local/dev unchanged). Never logs the secret or the header value.
  /// </summary>
  public static APIGatewayProxyResponse? CheckMigrateSecret(LambdaRequest req, Res res)
  {
    var required = Environment.GetEnvironmentVariable(MigrateSecretEnv) ?? string.Empty;
    if (!string.IsNullOrEmpty(required))
    {
      var got = Validation.GetHeader(req, MigrateSecretHeader) ?? string.Empty;
      if (!Secrets.FixedTimeEquals(got, required)) return res.Forbidden("Bad migrate secret");
      return null;
    }

    if (IsProduction(Environment.GetEnvironmentVariable("API_ENV")))
    {
      return RecallSmith.Lambda.Vpc.Authoring.Helpers.ErrorEnvelope(
        res, 503, "CONFIG_ERROR", "MIGRATE_SECRET is required in production");
    }

    return null;
  }
}
