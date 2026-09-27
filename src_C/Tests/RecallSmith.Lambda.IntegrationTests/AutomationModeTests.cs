using System.Globalization;
using Npgsql;
using RecallSmith.Lambda.Db;
using RecallSmith.Lambda.Vpc.Automation;

namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// The <c>AUTOMATION_MODE</c> switch and its effective mode (R18A A01, contract A00 §3): parsing, the eval-gate rule
/// for <c>live</c>, the pre-034 schema, and the <see cref="AutomationEnv"/> defaults. Every env variable a test sets
/// is restored in <c>finally</c>; a passed gate inserted into the shared database is revoked in <c>finally</c>, so
/// the shared database never carries a current gate outside the test that made it.
/// </summary>
[Collection(PostgresCollection.Name)]
public class AutomationModeTests
{
  private readonly PostgresFixture _db;
  public AutomationModeTests(PostgresFixture db) => _db = db;

  private static readonly string[] AutomationEnvNames =
  [
    AutomationMode.EnvName, AutomationEnv.AutoPublishEnv, AutomationEnv.SourceHostsEnv, AutomationEnv.DeckSlugsEnv,
    AutomationEnv.QaTimeoutMinutesEnv, AutomationEnv.RunnerStaleMinutesEnv, AutomationEnv.LoginWarnDaysEnv, AutomationEnv.NotifyQueueUrlEnv,
  ];

  // ---------------------------------------------------------------- helpers

  private static async Task WithEnvAsync(IReadOnlyDictionary<string, string?> values, Func<Task> body)
  {
    var saved = AutomationEnvNames.Concat(values.Keys).Distinct().ToDictionary(n => n, Environment.GetEnvironmentVariable);
    try
    {
      foreach (var name in AutomationEnvNames) Environment.SetEnvironmentVariable(name, null);
      foreach (var (name, value) in values) Environment.SetEnvironmentVariable(name, value);
      await body();
    }
    finally
    {
      foreach (var (n, v) in saved) Environment.SetEnvironmentVariable(n, v);
    }
  }

  private static Task WithModeAsync(string? mode, Func<Task> body) =>
    WithEnvAsync(new Dictionary<string, string?> { [AutomationMode.EnvName] = mode }, body);

  private async Task<long> InsertGateAsync(bool passed, bool revoked)
  {
    var id = await _db.ScalarAsync(
      "insert into automation_eval_gates (reviewer_provider, reviewer_model, prompt_version, passed, metrics, report_sha256, report, created_by_sub, revoked_at) " +
      "values ('test-provider', 'test-model', 'test-prompt-v1', $1, '{}'::jsonb, $2, '{}'::jsonb, 'it-a01', case when $3 then now() end) returning id",
      passed, new string('a', 64), revoked);
    return Convert.ToInt64(id, CultureInfo.InvariantCulture);
  }

  private Task RevokeGateAsync(long id) =>
    _db.ScalarAsync("update automation_eval_gates set revoked_at = now(), revoked_by_sub = 'it-a01' where id = $1 and revoked_at is null", id);

  private async Task<EffectiveMode> EffectiveAsync()
  {
    await using var conn = await _db.OpenAsync();
    return await AutomationMode.EffectiveAsync(conn);
  }

  // ---------------------------------------------------------------- parsing

  public static IEnumerable<object?[]> GeneratedModeValues()
  {
    var pads = new[] { ("", ""), (" ", ""), ("", "  "), ("\t", "\n"), (" \r\n", "\t ") };
    foreach (var mode in new[] { AutomationMode.Off, AutomationMode.DryRun, AutomationMode.Live })
    {
      var casings = new[]
      {
        mode,
        mode.ToUpperInvariant(),
        CultureInfo.InvariantCulture.TextInfo.ToTitleCase(mode),
        new string(mode.Select((c, i) => i % 2 == 0 ? char.ToUpperInvariant(c) : c).ToArray()),
      };
      foreach (var casing in casings)
      {
        foreach (var (before, after) in pads) yield return [before + casing + after, mode];
      }
    }

    foreach (var invalid in new string?[]
    {
      null, "", " ", "\t\n", "on", "true", "1", "0", "yes", "dry-run", "dryrun", "dry run", "dry_run_", "_live", "livee", "o ff",
      "offline", "LIVE!", "live;", "\"live\"", "'off'", "dry_run,live", "d\u0000ry_run", "ｌｉｖｅ", "live​", new string('x', 100),
    })
    {
      yield return [invalid, AutomationMode.Off];
    }
  }

  [Theory]
  [MemberData(nameof(GeneratedModeValues))]
  public void Configured_ParsesEveryGeneratedValue(string? raw, string expected)
  {
    Assert.Equal(expected, AutomationMode.Parse(raw));
  }

  [Fact]
  public async Task Configured_InvalidValue_IsOff()
  {
    Assert.True(GeneratedModeValues().Count() >= 50);

    foreach (var raw in new string?[] { "bogus", "", "   ", null, "dry-run", new string('z', 400) })
    {
      await WithModeAsync(raw, () =>
      {
        Assert.Equal(AutomationMode.Off, AutomationMode.Configured());
        return Task.CompletedTask;
      });
    }

    // Read on every call: a change of the variable changes the answer immediately.
    await WithModeAsync("  LIVE ", async () =>
    {
      Assert.Equal(AutomationMode.Live, AutomationMode.Configured());
      Environment.SetEnvironmentVariable(AutomationMode.EnvName, "Dry_Run");
      Assert.Equal(AutomationMode.DryRun, AutomationMode.Configured());
      Environment.SetEnvironmentVariable(AutomationMode.EnvName, "nonsense");
      Assert.Equal(AutomationMode.Off, AutomationMode.Configured());
      await Task.CompletedTask;
    });
  }

  // ---------------------------------------------------------------- effective mode

  [Fact]
  public async Task Effective_Off_IsOffWithoutDatabase()
  {
    foreach (var raw in new string?[] { "off", " OFF ", null, "garbage" })
    {
      await WithModeAsync(raw, async () =>
      {
        // Never opened, no host: any database access would throw.
        await using var conn = new NpgsqlConnection();
        var mode = await AutomationMode.EffectiveAsync(conn);
        Assert.Equal(new EffectiveMode("off", "off", null, null, null), mode);
      });
    }
  }

  [Fact]
  public async Task Effective_DryRun_ReportsGateWhenPresent()
  {
    await WithModeAsync("dry_run", async () =>
    {
      Assert.Equal(new EffectiveMode("dry_run", "dry_run", null, null, null), await EffectiveAsync());

      var gate = await InsertGateAsync(passed: true, revoked: false);
      try
      {
        var mode = await EffectiveAsync();
        Assert.Equal(new EffectiveMode("dry_run", "dry_run", null, gate, new GateReviewer("test-provider", "test-model", "test-prompt-v1")), mode);
      }
      finally
      {
        await RevokeGateAsync(gate);
      }

      Assert.Equal(new EffectiveMode("dry_run", "dry_run", null, null, null), await EffectiveAsync());
    });
  }

  [Fact]
  public async Task Effective_Live_WithPassedGate_IsLive()
  {
    await WithModeAsync("live", async () =>
    {
      var older = await InsertGateAsync(passed: true, revoked: false);
      var failed = await InsertGateAsync(passed: false, revoked: false);
      var latest = await InsertGateAsync(passed: true, revoked: false);
      try
      {
        // The latest passed, unrevoked gate wins; a failed gate never counts.
        var mode = await EffectiveAsync();
        Assert.Equal(new EffectiveMode("live", "live", null, latest, new GateReviewer("test-provider", "test-model", "test-prompt-v1")), mode);

        await RevokeGateAsync(latest);
        Assert.Equal(older, (await EffectiveAsync()).GateId);
      }
      finally
      {
        await RevokeGateAsync(older);
        await RevokeGateAsync(failed);
        await RevokeGateAsync(latest);
      }
    });
  }

  [Fact]
  public async Task Effective_Live_WithoutGate_IsDryRunEvalGateMissing()
  {
    await WithModeAsync("live", async () =>
    {
      var failed = await InsertGateAsync(passed: false, revoked: false);
      try
      {
        Assert.Equal(new EffectiveMode("live", "dry_run", AutomationMode.EvalGateMissing, null, null), await EffectiveAsync());
      }
      finally
      {
        await RevokeGateAsync(failed);
      }
    });
  }

  [Fact]
  public async Task Effective_Live_WithRevokedGate_IsDryRunEvalGateMissing()
  {
    await WithModeAsync("LIVE", async () =>
    {
      var gate = await InsertGateAsync(passed: true, revoked: false);
      try
      {
        Assert.Equal("live", (await EffectiveAsync()).Effective);
      }
      finally
      {
        await RevokeGateAsync(gate);
      }

      var mode = await EffectiveAsync();
      Assert.Equal(new EffectiveMode("live", "dry_run", "EVAL_GATE_MISSING", null, null), mode);

      await InsertGateAsync(passed: true, revoked: true);
      Assert.Equal(new EffectiveMode("live", "dry_run", "EVAL_GATE_MISSING", null, null), await EffectiveAsync());
    });
  }

  [Fact]
  public async Task Effective_MissingTables_IsOffServerNotReady()
  {
    var scratch = await _db.CreateScratchDatabaseAsync("a01_mode_033");
    await using var conn = new NpgsqlConnection(scratch);
    await conn.OpenAsync();
    await PostgresFixture.ApplyMigrationsAsync(conn, 33);

    foreach (var configured in new[] { "live", "dry_run" })
    {
      await WithModeAsync(configured, async () =>
      {
        Assert.Equal(new EffectiveMode(configured, "off", AutomationMode.ServerNotReady, null, null), await AutomationMode.EffectiveAsync(conn));

        // Safe inside an open transaction: the probe raises nothing, so the transaction stays usable.
        await using var tx = await conn.BeginTransactionAsync();
        Assert.Equal("off", (await AutomationMode.EffectiveAsync(conn)).Effective);
        Assert.Equal(1, Convert.ToInt32(await DbUtil.ExecuteScalarAsync(conn, tx, "select 1", []), CultureInfo.InvariantCulture));
        await tx.RollbackAsync();
      });
    }
  }

  // ---------------------------------------------------------------- AutomationEnv

  [Fact]
  public async Task AutomationEnv_Defaults_MatchTheContract()
  {
    await WithEnvAsync(new Dictionary<string, string?>(), () =>
    {
      Assert.True(AutomationEnv.AutoPublish());
      Assert.Equal(
        new[] { "aws.amazon.com", "docs.anthropic.com", "docs.aws.amazon.com", "docs.claude.com", "platform.claude.com", "www.anthropic.com" },
        AutomationEnv.SourceHosts().OrderBy(h => h, StringComparer.Ordinal));
      Assert.Null(AutomationEnv.DeckSlugs());
      Assert.Equal(120, AutomationEnv.QaTimeoutMinutes());
      Assert.Equal(1440, AutomationEnv.RunnerStaleMinutes());
      Assert.Equal(5, AutomationEnv.LoginWarnDays());
      Assert.Null(AutomationEnv.NotifyQueueUrl());
      Assert.Equal("off", AutomationMode.Configured());
      return Task.CompletedTask;
    });

    // Blank is the same as absent.
    await WithEnvAsync(new Dictionary<string, string?>
    {
      [AutomationEnv.AutoPublishEnv] = "  ",
      [AutomationEnv.SourceHostsEnv] = " ",
      [AutomationEnv.DeckSlugsEnv] = "",
      [AutomationEnv.QaTimeoutMinutesEnv] = " ",
      [AutomationEnv.NotifyQueueUrlEnv] = "   ",
    }, () =>
    {
      Assert.True(AutomationEnv.AutoPublish());
      Assert.Equal(6, AutomationEnv.SourceHosts().Count);
      Assert.Null(AutomationEnv.DeckSlugs());
      Assert.Equal(120, AutomationEnv.QaTimeoutMinutes());
      Assert.Null(AutomationEnv.NotifyQueueUrl());
      return Task.CompletedTask;
    });

    // Set values: parsed per call.
    await WithEnvAsync(new Dictionary<string, string?>
    {
      [AutomationEnv.AutoPublishEnv] = "0",
      [AutomationEnv.SourceHostsEnv] = " Docs.AWS.amazon.com, ,example.com ,",
      [AutomationEnv.DeckSlugsEnv] = " aws-saa-c03 ,claude-ccdv-f,, ",
      [AutomationEnv.QaTimeoutMinutesEnv] = "45",
      [AutomationEnv.RunnerStaleMinutesEnv] = "0",
      [AutomationEnv.LoginWarnDaysEnv] = "-3",
      [AutomationEnv.NotifyQueueUrlEnv] = " https://sqs.example.com/test-queue ",
    }, () =>
    {
      Assert.False(AutomationEnv.AutoPublish());
      Assert.Equal(new[] { "docs.aws.amazon.com", "example.com" }, AutomationEnv.SourceHosts().OrderBy(h => h, StringComparer.Ordinal));
      Assert.Equal(new[] { "aws-saa-c03", "claude-ccdv-f" }, AutomationEnv.DeckSlugs()!.OrderBy(s => s, StringComparer.Ordinal));
      Assert.Equal(45, AutomationEnv.QaTimeoutMinutes());
      Assert.Equal(1440, AutomationEnv.RunnerStaleMinutes());
      Assert.Equal(5, AutomationEnv.LoginWarnDays());
      Assert.Equal("https://sqs.example.com/test-queue", AutomationEnv.NotifyQueueUrl());

      Environment.SetEnvironmentVariable(AutomationEnv.AutoPublishEnv, "yes");
      Assert.True(AutomationEnv.AutoPublish());
      Environment.SetEnvironmentVariable(AutomationEnv.QaTimeoutMinutesEnv, "abc");
      Assert.Equal(120, AutomationEnv.QaTimeoutMinutes());
      return Task.CompletedTask;
    });

    Assert.Equal("INTERNAL_SECRET_SOURCE_WATCH", AutomationEnv.SourceWatchSecretEnv);
    Assert.Equal("INTERNAL_SECRET_NOTIFIER", AutomationEnv.NotifierSecretEnv);
  }
}
