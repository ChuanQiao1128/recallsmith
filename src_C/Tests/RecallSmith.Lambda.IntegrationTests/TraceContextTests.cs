using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The X-Ray root parser of H00 §3.3: a deterministic rule shared with the Python twin, so the
/// header table is generated from a fixed seed and every row carries its expected result.
/// </summary>
/// <remarks>
/// In the postgres collection because two tests set the process-global <c>_X_AMZN_TRACE_ID</c>,
/// which the log and EMF tests of the same serial collection also read.
/// </remarks>
[Collection(PostgresCollection.Name)]
public class TraceContextTests
{
  private const string ExampleRoot = "1-5759e988-bd862e3fe1be46a994272793";

  // ---------------------------------------------------------------- generated data

  private const string Hex = "0123456789abcdef";

  private static string HexDigits(Random rng, int count)
  {
    var chars = new char[count];
    for (var i = 0; i < count; i++) chars[i] = Hex[rng.Next(Hex.Length)];
    return new string(chars);
  }

  private static string NewRoot(Random rng) => $"1-{HexDigits(rng, 8)}-{HexDigits(rng, 24)}";

  public static IEnumerable<object?[]> GeneratedHeaders()
  {
    var rng = new Random(18);
    var rows = new List<object?[]>();

    for (var i = 0; i < 5; i++)
    {
      var root = NewRoot(rng);
      var parent = HexDigits(rng, 16);
      rows.Add([root, root]);
      rows.Add([$"Root={root};Parent={parent};Sampled=1", root]);
      rows.Add([$"Parent={parent};Root={root};Sampled=0", root]);
      rows.Add([$"Parent={parent};Sampled=1;Root={root}", root]);
      rows.Add([$"Root={root};Parent={parent};Sampled=1;Lineage=a87bd80c:1", root]);
      rows.Add([$"  Root={root} ; Parent={parent} ;  Sampled=1 ", root]);
    }

    for (var i = 0; i < 4; i++)
    {
      var root = NewRoot(rng);
      var parent = HexDigits(rng, 16);
      var first = HexDigits(rng, 8);
      var second = HexDigits(rng, 24);
      rows.Add([$"1-A{first[1..]}-{second}", null]);
      rows.Add([$"Root=1-{first}-{second[..23]}A;Parent={parent}", null]);
      rows.Add([$"Root=2-{first}-{second};Parent={parent}", null]);
      rows.Add([$"Root=1-{first[..7]}-{second};Parent={parent}", null]);
      rows.Add([$"Root=1-{first}{HexDigits(rng, 1)}-{second};Parent={parent}", null]);
      rows.Add([$"Root=1-{first}-{second[..23]};Parent={parent}", null]);
      rows.Add([$"Root=1-{first}-{second}{HexDigits(rng, 1)};Parent={parent}", null]);
      rows.Add([$"Root=1-{first}-{second[..10]}g{second[11..]};Parent={parent}", null]);
      rows.Add([$"Root=1-{first}{second};Parent={parent}", null]);
      rows.Add([$"Root=;Parent={parent};Sampled=1", null]);
      rows.Add([$"Parent={parent}", null]);
      rows.Add([$"root={root};Parent={parent}", null]);
      rows.Add([$"Root={root}x;Parent={parent}", null]);
    }

    rows.Add([null, null]);
    rows.Add([string.Empty, null]);
    rows.Add(["   \t ", null]);
    return rows;
  }

  // ---------------------------------------------------------------- shared vectors (R18I Q3)

  // The same literal table is copied into every Python test_tracectx.py; a change here must be made there
  // too. R = ExampleRoot. PadTo(s, n) appends 'x' up to n chars; LeftPad(s, n) prepends spaces up to n chars.
  private static string PadTo(string s, int length) => s + new string('x', length - s.Length);

  private static string LeftPad(string s, int length) => new string(' ', length - s.Length) + s;

  public static IEnumerable<object?[]> SharedVectors()
  {
    const string R = ExampleRoot;
    return
    [
      [R, R],
      [$"Root={R};Parent=53995c3f42cd8ad8;Sampled=1", R],
      [$"Parent=53995c3f42cd8ad8;Root={R};Sampled=0", R],
      [$"Parent=53995c3f42cd8ad8;Sampled=1;Root={R}", R],
      [$"  Root={R} ; Parent=53995c3f42cd8ad8 ;  Sampled=1  ", R],
      [$"Root= {R} ;Sampled=1", R],
      [$"\t{R}\t", R],
      [$"Root ={R};Sampled=1", null],
      [$"Root\t={R}", null],
      [$"root={R};Sampled=1", null],
      [$"ROOT={R}", null],
      [$"Rootx={R}", null],
      [$"Root=={R}", null],
      [$"Root={R.ToUpperInvariant()};Sampled=1", null],
      ["Root=;Parent=53995c3f42cd8ad8;Sampled=1", null],
      [$"Root=1-XYZ;Root={R}", null],
      [$"Root={R}x;Parent=53995c3f42cd8ad8", null],
      ["Parent=53995c3f42cd8ad8;Sampled=1", null],
      [$"{R} junk", null],
      ["2-5759e988-bd862e3fe1be46a994272793", null],
      ["1-5759e988-bd862e3fe1be46a99427279", null],
      ["Root", null],
      ["=", null],
      [string.Empty, null],
      ["   ", null],
      [null, null],
      [PadTo($"Root={R};Lineage=", 512), R],
      [PadTo($"Root={R};Lineage=", 513), null],
      [LeftPad(R, 512), R],
      [LeftPad(R, 513), null],
    ];
  }

  // ---------------------------------------------------------------- tests

  [Fact]
  public void Constants_MatchTheContract()
  {
    Assert.Equal("_X_AMZN_TRACE_ID", TraceContext.EnvVar);
    Assert.Equal("x-dc-trace-id", TraceContext.UpstreamHeader);
    Assert.Equal("xrayTraceId", TraceContext.XrayField);
    Assert.Equal("upstreamTraceId", TraceContext.UpstreamField);
  }

  [Theory]
  [MemberData(nameof(GeneratedHeaders))]
  public void RootFromHeader_ParsesEveryGeneratedHeader(string? header, string? expected)
  {
    Assert.Equal(expected, TraceContext.RootFromHeader(header));
  }

  [Theory]
  [MemberData(nameof(SharedVectors))]
  public void RootFromHeader_MatchesTheSharedVectors(string? header, string? expected)
  {
    Assert.Equal(expected, TraceContext.RootFromHeader(header));
  }

  [Fact]
  public void MaxHeaderChars_Is512()
  {
    Assert.Equal(512, TraceContext.MaxHeaderChars);
  }

  [Fact]
  public void GeneratedHeaders_AreAtLeastFifty()
  {
    var rows = GeneratedHeaders().ToList();
    Assert.True(rows.Count >= 50, $"only {rows.Count} generated rows");
    Assert.True(rows.Count(r => r[1] is not null) >= 20, "fewer than 20 valid rows");
    Assert.True(rows.Count(r => r[1] is null) >= 20, "fewer than 20 invalid rows");
  }

  [Fact]
  public void RootFromHeader_AcceptsFullHeaderAndBareRoot()
  {
    Assert.Equal(ExampleRoot, TraceContext.RootFromHeader($"Root={ExampleRoot};Parent=53995c3f42cd8ad8;Sampled=1"));
    Assert.Equal(ExampleRoot, TraceContext.RootFromHeader(ExampleRoot));
  }

  [Fact]
  public void RootFromHeader_NeverThrows()
  {
    string?[] inputs =
    [
      "\0\u0001\u001f\u007f",
      $"Root={ExampleRoot}\n",
      $"{ExampleRoot}\n",
      new string('a', 100_000),
      "Root=" + new string('1', 100_000),
      ";;;",
      "=",
      "Root=",
      "Root=1-５７５９e988-bd862e3fe1be46a994272793",
      "Root=🙂;Parent=✓",
      "\uD800",
    ];

    foreach (var input in inputs)
    {
      var result = TraceContext.RootFromHeader(input);
      Assert.True(result is null || result == ExampleRoot, $"unexpected result {result}");
    }

    Assert.Null(TraceContext.RootFromHeader(new string('a', 100_000)));
    Assert.Null(TraceContext.RootFromHeader("Root=1-５７５９e988-bd862e3fe1be46a994272793"));
  }

  [Fact]
  public void CurrentRoot_ParsesTheLambdaEnvValue()
  {
    var saved = Environment.GetEnvironmentVariable(TraceContext.EnvVar);
    try
    {
      Environment.SetEnvironmentVariable(TraceContext.EnvVar, $"Root={ExampleRoot};Parent=53995c3f42cd8ad8;Sampled=1");
      Assert.Equal(ExampleRoot, TraceContext.CurrentRoot());

      var rng = new Random(18);
      var next = NewRoot(rng);
      Environment.SetEnvironmentVariable(TraceContext.EnvVar, $"Root={next};Parent=53995c3f42cd8ad8;Sampled=0");
      Assert.Equal(next, TraceContext.CurrentRoot());
    }
    finally
    {
      Environment.SetEnvironmentVariable(TraceContext.EnvVar, saved);
    }
  }

  [Fact]
  public void CurrentRoot_UnsetOrInvalid_IsNull()
  {
    var saved = Environment.GetEnvironmentVariable(TraceContext.EnvVar);
    try
    {
      Environment.SetEnvironmentVariable(TraceContext.EnvVar, null);
      Assert.Null(TraceContext.CurrentRoot());

      foreach (var invalid in new[] { " ", "Parent=53995c3f42cd8ad8", $"Root={ExampleRoot.ToUpperInvariant()}", "Root=1-5759e988-bd862e3f" })
      {
        Environment.SetEnvironmentVariable(TraceContext.EnvVar, invalid);
        Assert.Null(TraceContext.CurrentRoot());
      }
    }
    finally
    {
      Environment.SetEnvironmentVariable(TraceContext.EnvVar, saved);
    }
  }
}
