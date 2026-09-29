using System.Net;
using System.Net.Sockets;
using System.Text;
using Amazon.Runtime;
using Amazon.SQS;
using Amazon.SQS.Model;
using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// H00 §3.5 row 1: inside Lambda the AWS SDK copies <c>_X_AMZN_TRACE_ID</c> into the
/// <c>X-Amzn-Trace-Id</c> header of every request it sends, so an SQS send from core-vpc carries
/// the invocation's trace to the queue (SQS stores it as the <c>AWSTraceHeader</c> attribute the
/// worker logs). Proven against a loopback listener; nothing leaves 127.0.0.1.
/// </summary>
/// <remarks>
/// In the postgres collection because the tests set process-global env
/// (<c>AWS_LAMBDA_FUNCTION_NAME</c>, <c>_X_AMZN_TRACE_ID</c>) that other classes also read.
/// </remarks>
[Collection(PostgresCollection.Name)]
public class TracePropagationTests
{
  private const string LambdaNameVar = "AWS_LAMBDA_FUNCTION_NAME";
  private const string TraceHeader = "X-Amzn-Trace-Id";
  private const string TraceEnvValue = "Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1";

  private static int FreePort()
  {
    var probe = new TcpListener(IPAddress.Loopback, 0);
    probe.Start();
    try
    {
      return ((IPEndPoint)probe.LocalEndpoint).Port;
    }
    finally
    {
      probe.Stop();
    }
  }

  /// <summary>
  /// Sends one SQS message to a loopback listener with the given env and returns the headers of
  /// the first request the listener received (the listener answers 400, so the SDK throws).
  /// </summary>
  private static async Task<Dictionary<string, string>> CaptureSendHeadersAsync(string? lambdaName, string? traceEnv)
  {
    var savedName = Environment.GetEnvironmentVariable(LambdaNameVar);
    var savedTrace = Environment.GetEnvironmentVariable(TraceContext.EnvVar);
    var port = FreePort();
    var baseUrl = $"http://127.0.0.1:{port}/";
    using var listener = new HttpListener();
    listener.Prefixes.Add(baseUrl);

    try
    {
      Environment.SetEnvironmentVariable(LambdaNameVar, lambdaName);
      Environment.SetEnvironmentVariable(TraceContext.EnvVar, traceEnv);
      listener.Start();

      var captured = Task.Run(async () =>
      {
        var ctx = await listener.GetContextAsync().ConfigureAwait(false);
        var headers = ctx.Request.Headers.AllKeys
          .Where(k => k is not null)
          .ToDictionary(k => k!, k => ctx.Request.Headers[k] ?? string.Empty, StringComparer.OrdinalIgnoreCase);
        var body = Encoding.UTF8.GetBytes("{\"__type\":\"com.amazonaws.sqs#InvalidAddress\",\"message\":\"loopback\"}");
        ctx.Response.StatusCode = 400;
        ctx.Response.ContentType = "application/x-amz-json-1.0";
        ctx.Response.ContentLength64 = body.Length;
        await ctx.Response.OutputStream.WriteAsync(body).ConfigureAwait(false);
        ctx.Response.Close();
        return headers;
      });

      using var client = new AmazonSQSClient(
        new BasicAWSCredentials("test-access-key", "test-secret"),
        new AmazonSQSConfig
        {
          ServiceURL = baseUrl,
          AuthenticationRegion = "ap-southeast-2",
          MaxErrorRetry = 0,
          Timeout = TimeSpan.FromSeconds(10),
        });

      var send = client.SendMessageAsync(new SendMessageRequest
      {
        QueueUrl = $"{baseUrl}123456789012/test-queue",
        MessageBody = "{\"jobId\":\"loopback\"}",
      });
      await Assert.ThrowsAnyAsync<Exception>(() => send);

      var done = await Task.WhenAny(captured, Task.Delay(TimeSpan.FromSeconds(10)));
      Assert.True(done == captured, "the loopback listener received no request within 10 s");
      return await captured;
    }
    finally
    {
      Environment.SetEnvironmentVariable(LambdaNameVar, savedName);
      Environment.SetEnvironmentVariable(TraceContext.EnvVar, savedTrace);
      if (listener.IsListening) listener.Stop();
    }
  }

  [Fact]
  public async Task SqsSend_InsideLambda_CarriesXAmznTraceIdEqualToEnv()
  {
    var headers = await CaptureSendHeadersAsync("test-fn", TraceEnvValue);

    Assert.True(headers.TryGetValue(TraceHeader, out var value),
      $"no {TraceHeader} header; captured: {string.Join(", ", headers.Keys)}");
    Assert.Equal(TraceEnvValue, value);
  }

  [Fact]
  public async Task SqsSend_OutsideLambda_HasNoXAmznTraceId()
  {
    var headers = await CaptureSendHeadersAsync(null, TraceEnvValue);

    Assert.False(headers.ContainsKey(TraceHeader),
      $"{TraceHeader} sent outside Lambda; captured: {string.Join(", ", headers.Keys)}");
  }
}
