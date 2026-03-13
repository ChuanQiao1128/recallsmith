using System.Net;
using System.Net.Sockets;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Vpc.Db;

public static class Netcheck
{
  private static Task Sleep(int ms) => Task.Delay(ms);

  private static async Task<Dictionary<string, object?>> TcpCheck(string host, int port, int timeoutMs)
  {
    using var tcp = new TcpClient();
    try
    {
      using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(timeoutMs));
      await tcp.ConnectAsync(host, port, cts.Token);
      return new Dictionary<string, object?> { ["ok"] = true, ["detail"] = "connected" };
    }
    catch (OperationCanceledException)
    {
      return new Dictionary<string, object?> { ["ok"] = false, ["detail"] = $"timeout_{timeoutMs}ms" };
    }
    catch (SocketException ex)
    {
      return new Dictionary<string, object?> { ["ok"] = false, ["detail"] = ex.SocketErrorCode.ToString() };
    }
    catch (Exception ex)
    {
      return new Dictionary<string, object?> { ["ok"] = false, ["detail"] = ex.Message };
    }
  }

  public static async Task<Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse> HandleDbNetcheck(
    LambdaRequest req,
    Res res,
    AuthContext auth)
  {
    var deny = Auth.RequireSuperAdmin(auth, res);
    if (deny is not null) return deny;

    var host = (Environment.GetEnvironmentVariable("PGHOST") ?? string.Empty).Trim();
    var port = int.TryParse(Environment.GetEnvironmentVariable("PGPORT"), out var p) ? p : 5432;
    var database = (Environment.GetEnvironmentVariable("PGDATABASE") ?? string.Empty).Trim();
    var user = (Environment.GetEnvironmentVariable("PGUSER") ?? string.Empty).Trim();

    if (string.IsNullOrEmpty(host)) return res.BadRequest("CONFIG_ERROR", "Missing PGHOST");

    // 1) DNS
    List<object> ips = [];
    string? dnsErr = null;
    try
    {
      var addrs = await Dns.GetHostAddressesAsync(host);
      ips = addrs.Select(a => new { address = a.ToString(), family = a.AddressFamily == AddressFamily.InterNetwork ? 4 : 6 }).Cast<object>().ToList();
    }
    catch (Exception ex)
    {
      dnsErr = ex.Message;
    }

    // 2) TCP connect (try twice, ENI cold-start can be spiky)
    var attempts = new List<object>();
    for (var i = 0; i < 2; i++)
    {
      attempts.Add(await TcpCheck(host, port, 2500));
      await Sleep(80);
    }

    return res.Ok(new
    {
      env = new { host, port, database, user },
      dns = new { ok = dnsErr is null, ips, error = dnsErr },
      tcp = new { attempts },
    });
  }
}

