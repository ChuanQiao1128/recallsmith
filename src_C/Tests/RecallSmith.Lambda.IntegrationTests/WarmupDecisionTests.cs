namespace RecallSmith.Lambda.IntegrationTests;

/// <summary>
/// Pure unit tests for the INIT-phase warmup gate. No AWS and no database:
/// these only cover the decision that says whether the warmup probe may run at all,
/// which is the part that must never let a missing or disabled configuration
/// turn into an error during container init.
/// </summary>
public class WarmupDecisionTests
{
  [Theory]
  [InlineData(null)]
  [InlineData("")]
  [InlineData("   ")]
  public void Decide_SkipsWhenQueueUrlMissing(string? queueUrl)
  {
    Assert.Equal(Warmup.Decision.SkipNoQueueUrl, Warmup.Decide(queueUrl, disableFlag: null));
  }

  [Theory]
  [InlineData("1")]
  [InlineData("true")]
  [InlineData("TRUE")]
  [InlineData("yes")]
  public void Decide_SkipsWhenKillSwitchSet(string flag)
  {
    Assert.Equal(
      Warmup.Decision.SkipDisabled,
      Warmup.Decide("https://sqs.ap-southeast-2.amazonaws.com/1234/publish-jobs", flag));
  }

  [Fact]
  public void Decide_KillSwitchWinsOverPresentQueueUrl()
  {
    // The kill switch has to be checked first, otherwise it could not stop a warmup on a
    // fully configured function, which is the only case where turning it off matters.
    Assert.Equal(Warmup.Decision.SkipDisabled, Warmup.Decide(queueUrl: null, disableFlag: "1"));
  }

  [Theory]
  [InlineData(null)]
  [InlineData("")]
  [InlineData("0")]
  [InlineData("false")]
  public void Decide_RunsWhenConfiguredAndNotDisabled(string? flag)
  {
    Assert.Equal(
      Warmup.Decision.Run,
      Warmup.Decide("https://sqs.ap-southeast-2.amazonaws.com/1234/publish-jobs", flag));
  }

  [Fact]
  public void RunOnce_IsSafeAndIdempotentWhenUnconfigured()
  {
    // Guard: only assert the no-op path. With a real queue URL present this would attempt
    // an actual AWS call, which these tests must not do.
    if (!string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("PUBLISH_JOB_QUEUE_URL"))) return;

    var ex = Record.Exception(() =>
    {
      Warmup.RunOnce();
      Warmup.RunOnce();
    });

    Assert.Null(ex);
  }
}
