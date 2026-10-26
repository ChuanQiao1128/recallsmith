namespace RecallSmith.Lambda.Worker.Services;

public enum PublishReplayOutcome
{
  None,
  Succeeded,
  FailedOrAbsent,
}

/// <summary>
/// Optional companion of <see cref="IPublishJobProcessor"/>: classifies a terminal/absent replay after
/// ProcessAsync returns. No replay emits a good event. A FAILED/absent replay cannot emit a bad event
/// for manifest failure either; a SUCCESS replay retains H02's final manifest-failure bad event.
/// A processor that does not implement this interface is treated as never replaying.
/// </summary>
public interface IReplayOutcome
{
  /// <summary>Reset on each ProcessAsync call; valid for the worker only after that call returns.</summary>
  PublishReplayOutcome LastCallReplayOutcome { get; }
}
