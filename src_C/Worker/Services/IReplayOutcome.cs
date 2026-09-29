namespace RecallSmith.Lambda.Worker.Services;

/// <summary>
/// Optional companion of <see cref="IPublishJobProcessor"/> (R18I Q4): tells the worker whether the last
/// <see cref="IPublishJobProcessor.ProcessAsync"/> call only acknowledged a replayed message for a job that
/// was already terminal (SUCCESS or FAILED) or absent. Such a call is not a publish outcome, so the worker
/// emits neither <c>PublishJobsSucceeded</c> nor <c>PublishJobsFailed</c> for it. A processor that does not
/// implement this interface is treated as never replaying.
/// </summary>
public interface IReplayOutcome
{
  /// <summary>True when the most recent ProcessAsync call returned through the terminal-replay acknowledgement.</summary>
  bool LastCallWasTerminalReplay { get; }
}
