using RecallSmith.Lambda.Common;

namespace RecallSmith.Lambda.Vpc.Automation;

/// <summary>
/// The automation self-failure signal (R18B K4): every automation failure that is caught and only logged (tick steps,
/// run finalisation, publish evaluation and reconcile, draft-QA after-commit hooks) emits the
/// <c>AutomationStepFailures</c> gauge, so a step that fails on every tick raises an alarm instead of a silent warn log.
/// Inside a tick the failure is also attributed to the running step, which the tick answers as <c>failedSteps</c>.
/// </summary>
public static class AutomationFailures
{
  public const string StepFailuresMetric = "AutomationStepFailures";

  /// <summary>The steps of one tick that failed, and the step running now.</summary>
  internal sealed class TickSink
  {
    public string Step { get; set; } = string.Empty;
    public List<string> Failed { get; } = [];

    public void Add(string step)
    {
      if (!Failed.Contains(step, StringComparer.Ordinal)) Failed.Add(step);
    }
  }

  private static readonly AsyncLocal<TickSink?> Sink = new();

  /// <summary>Attributes every <see cref="Record"/> in the calling async flow to <paramref name="sink"/>'s current step.</summary>
  internal static void Collect(TickSink sink) => Sink.Value = sink;

  /// <summary>One swallowed failure: the gauge, and inside a tick the current step's name in <c>failedSteps</c>.</summary>
  public static void Record()
  {
    RouteMetrics.EmitGauge(StepFailuresMetric, 1);
    if (Sink.Value is { Step.Length: > 0 } sink) sink.Add(sink.Step);
  }
}
