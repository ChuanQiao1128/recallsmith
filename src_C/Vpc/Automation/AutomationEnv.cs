using System.Globalization;
using RecallSmith.Lambda.Vpc.Qa;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>
/// The optional core-vpc automation env keys (R18A A01, contract A00 §3.2–§3.3). Every value is read from the
/// environment on every call, never cached; an absent or blank key means the contract default.
/// </summary>
public static class AutomationEnv
{
  public const string AutoPublishEnv = "AUTOMATION_AUTO_PUBLISH";
  public const string SourceHostsEnv = "AUTOMATION_SOURCE_HOSTS";
  public const string DeckSlugsEnv = "AUTOMATION_DECK_SLUGS";
  public const string QaTimeoutMinutesEnv = "AUTOMATION_QA_TIMEOUT_MINUTES";
  public const string RunnerStaleMinutesEnv = "AUTOMATION_RUNNER_STALE_MINUTES";
  public const string LoginWarnDaysEnv = "AUTOMATION_LOGIN_WARN_DAYS";
  public const string NotifyQueueUrlEnv = "AUTOMATION_NOTIFY_QUEUE_URL";
  public const string SourceWatchSecretEnv = "INTERNAL_SECRET_SOURCE_WATCH";
  public const string NotifierSecretEnv = "INTERNAL_SECRET_NOTIFIER";
  public const string WatchClaimsPerDayEnv = "AUTOMATION_WATCH_CLAIMS_PER_DAY";

  public const string DefaultSourceHosts = "docs.aws.amazon.com,aws.amazon.com,platform.claude.com,docs.claude.com,docs.anthropic.com,www.anthropic.com";
  public const int DefaultQaTimeoutMinutes = 120, DefaultRunnerStaleMinutes = 1440, DefaultLoginWarnDays = 5;

  /// <summary>
  /// R28 MONITOR (report AI-6): how many source-watch queue items (kinds <c>source_changed</c> and <c>feed_item</c>) the
  /// runners may claim in any rolling 24 hours. 5 items is at most 25 draft cards a day (<see cref="RunnerRoutes.MaxCardsPerItem"/>),
  /// one human review batch, so a weekly re-check that finds many changed pages drains over days instead of running the
  /// runner for hours. Owner-created (<c>manual</c>) items are never counted or held.
  /// </summary>
  public const int DefaultWatchClaimsPerDay = 5, MaxWatchClaimsPerDay = 1000;

  /// <summary>Unset or blank ⇒ true; otherwise <see cref="Env.IsTruthy"/>.</summary>
  public static bool AutoPublish()
  {
    var raw = Read(AutoPublishEnv);
    return raw is null || Env.IsTruthy(raw);
  }

  /// <summary>Comma list, trimmed and lower-cased, empties dropped; unset or blank ⇒ <see cref="DefaultSourceHosts"/>.</summary>
  public static IReadOnlySet<string> SourceHosts()
  {
    var hosts = SplitList(Read(SourceHostsEnv) ?? DefaultSourceHosts, lower: true);
    return hosts.Count > 0 ? hosts : SplitList(DefaultSourceHosts, lower: true);
  }

  /// <summary>Unset or blank ⇒ null (every deck is eligible); otherwise the trimmed slugs (ordinal).</summary>
  public static IReadOnlySet<string>? DeckSlugs()
  {
    var raw = Read(DeckSlugsEnv);
    if (raw is null) return null;
    var slugs = SplitList(raw, lower: false);
    return slugs.Count > 0 ? slugs : null;
  }

  public static int QaTimeoutMinutes() => PositiveInt(QaTimeoutMinutesEnv, DefaultQaTimeoutMinutes);

  public static int RunnerStaleMinutes() => PositiveInt(RunnerStaleMinutesEnv, DefaultRunnerStaleMinutes);

  public static int LoginWarnDays() => PositiveInt(LoginWarnDaysEnv, DefaultLoginWarnDays);

  /// <summary>
  /// <see cref="WatchClaimsPerDayEnv"/>: unset, blank or not a whole number ⇒ <see cref="DefaultWatchClaimsPerDay"/>;
  /// <c>0</c> holds every source-watch item in the queue (none is claimed); above <see cref="MaxWatchClaimsPerDay"/> ⇒ that.
  /// </summary>
  public static int WatchClaimsPerDay() =>
    int.TryParse(Read(WatchClaimsPerDayEnv), NumberStyles.None, CultureInfo.InvariantCulture, out var n)
      ? Math.Min(n, MaxWatchClaimsPerDay)
      : DefaultWatchClaimsPerDay;

  /// <summary>Trimmed; null when unset or blank.</summary>
  public static string? NotifyQueueUrl() => Read(NotifyQueueUrlEnv);

  private static string? Read(string name)
  {
    var v = Environment.GetEnvironmentVariable(name)?.Trim();
    return string.IsNullOrEmpty(v) ? null : v;
  }

  private static int PositiveInt(string name, int fallback) =>
    int.TryParse(Read(name), NumberStyles.None, CultureInfo.InvariantCulture, out var n) && n > 0 ? n : fallback;

  private static HashSet<string> SplitList(string raw, bool lower)
  {
    var set = new HashSet<string>(StringComparer.Ordinal);
    foreach (var part in raw.Split(','))
    {
      var item = part.Trim();
      if (item.Length == 0) continue;
      set.Add(lower ? item.ToLowerInvariant() : item);
    }
    return set;
  }
}
