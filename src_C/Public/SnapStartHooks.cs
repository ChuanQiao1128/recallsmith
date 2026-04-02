using System.Threading;
using Amazon.Lambda.Core;

namespace RecallSmith.Lambda;

internal static class SnapStartHooks
{
  private static int _registered;

  public static void RegisterOnce()
  {
    if (Interlocked.Exchange(ref _registered, 1) == 1) return;

    SnapshotRestore.RegisterBeforeSnapshot(BeforeSnapshot);
    SnapshotRestore.RegisterAfterRestore(AfterRestore);
  }

  private static ValueTask BeforeSnapshot()
  {
    ResetResources();
    return ValueTask.CompletedTask;
  }

  private static ValueTask AfterRestore()
  {
    ResetResources();
    return ValueTask.CompletedTask;
  }

  private static void ResetResources()
  {
    try { RecallSmith.Lambda.Public.CognitoAdmin.CognitoClient.Reset(); } catch { /* best-effort */ }
  }
}
