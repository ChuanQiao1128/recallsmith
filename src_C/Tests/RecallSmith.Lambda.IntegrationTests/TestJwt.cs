using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Mints tokens and key sets the way Cognito does, byte for byte at the JOSE level, from RSA
/// keys generated in-process. Written by hand rather than through the IdentityModel token
/// factory on purpose: the factory refuses to create the tokens these tests exist to reject
/// (alg=none, exp in the past), and a verifier tested only against tokens its own library
/// agreed to mint has not been tested against an attacker.
/// </summary>
internal static class TestJwt
{
  public const string ConsoleIssuer = "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_4Vf8uCXKt";
  public const string MobileIssuer = "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_04hd6iisb";

  public static RSA NewKey() => RSA.Create(2048);

  public static long Now() => DateTimeOffset.UtcNow.ToUnixTimeSeconds();

  /// <summary>A Cognito-shaped payload: iss/sub/token_use/exp/iat plus whatever the test adds.</summary>
  public static Dictionary<string, object?> Payload(
    string issuer = ConsoleIssuer,
    string tokenUse = "access",
    string? sub = null,
    string[]? groups = null,
    long? exp = null,
    long? nbf = null)
  {
    var p = new Dictionary<string, object?>(StringComparer.Ordinal)
    {
      ["iss"] = issuer,
      ["sub"] = sub ?? Guid.NewGuid().ToString(),
      ["token_use"] = tokenUse,
      ["iat"] = Now(),
      ["exp"] = exp ?? Now() + 3600,
    };
    if (groups is not null) p["cognito:groups"] = groups;
    if (nbf is not null) p["nbf"] = nbf;
    if (tokenUse == "id") p["cognito:username"] = "user-" + p["sub"];
    return p;
  }

  /// <summary>RS256-signs a payload with <paramref name="signer"/>, claiming <paramref name="kid"/> in the header.</summary>
  public static string Sign(RSA signer, string kid, Dictionary<string, object?> payload)
  {
    var header = B64(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { alg = "RS256", typ = "JWT", kid })));
    var body = B64(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload)));
    var input = Encoding.ASCII.GetBytes(header + "." + body);
    var sig = signer.SignData(input, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
    return header + "." + body + "." + B64(sig);
  }

  /// <summary>The classic forgery: alg=none, empty signature, any claims the attacker likes.</summary>
  public static string Unsigned(string kid, Dictionary<string, object?> payload)
  {
    var header = B64(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { alg = "none", typ = "JWT", kid })));
    var body = B64(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload)));
    return header + "." + body + ".";
  }

  /// <summary>Same header, same payload, signature replaced with the wrong key's.</summary>
  public static string ResignedWith(RSA attacker, string kid, Dictionary<string, object?> payload) => Sign(attacker, kid, payload);

  /// <summary>A JWKS document publishing the given (kid, key) pairs, in Cognito's spelling.</summary>
  public static string Jwks(params (string Kid, RSA Key)[] keys)
  {
    var list = keys.Select(k =>
    {
      var p = k.Key.ExportParameters(includePrivateParameters: false);
      return new Dictionary<string, string>
      {
        ["kty"] = "RSA",
        ["use"] = "sig",
        ["alg"] = "RS256",
        ["kid"] = k.Kid,
        ["n"] = B64(p.Modulus!),
        ["e"] = B64(p.Exponent!),
      };
    });
    return JsonSerializer.Serialize(new { keys = list });
  }

  private static string B64(byte[] bytes) =>
    Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

/// <summary>
/// A JWKS source under the test's control: what it serves per issuer, and how many times it
/// was asked. The count is the observable for "one refresh, not one per request".
/// </summary>
internal sealed class StubJwks : IJwksProvider
{
  private Func<string, string> _respond;

  public StubJwks(string jwks) : this(_ => jwks) { }

  public StubJwks(Func<string, string> respond) { _respond = respond; }

  public int Calls { get; private set; }
  public List<string> Issuers { get; } = [];

  public void Serve(string jwks) => _respond = _ => jwks;
  public void Fail(Exception ex) => _respond = _ => throw ex;

  public Task<string> FetchAsync(string issuer, CancellationToken ct)
  {
    Calls++;
    Issuers.Add(issuer);
    return Task.FromResult(_respond(issuer));
  }
}
