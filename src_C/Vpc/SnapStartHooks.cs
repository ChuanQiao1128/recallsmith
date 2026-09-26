using System.Threading;
using Amazon.Lambda.Core;
using RecallSmith.Lambda.Db;

namespace RecallSmith.Lambda;

/// <summary>
/// SnapStart runtime hooks. Registered during init; dormant while SnapStart is None on this
/// function, which is exactly why the warmup hangs off the constructor rather than off a hook.
/// </summary>
/// <remarks>
/// These are wired now, before SnapStart is ever switched on, because the INIT-phase database
/// warmup and SnapStart are two features that touch the same object -- the pooled Npgsql
/// connection -- from opposite ends, and the failure they would produce together is silent.
/// Turning SnapStart on with only half of this in place gives every restored container a pool
/// holding a socket that was snapshotted open and is dead on the other side; nothing throws
/// until the first query, and the symptom is an intermittent 500 that looks like the database.
///
/// AWS states the obligation directly: "Always re-establish your network connections when your
/// function resumes from a snapshot. We recommend that you re-establish network connections in
/// the function handler. Alternatively, you can use an after-restore runtime hook"
/// (docs.aws.amazon.com/lambda/latest/dg/snapstart-best-practices.html).
/// </remarks>
internal static class SnapStartHooks
{
  private static int _registered;

  public static void RegisterOnce()
  {
    if (Interlocked.Exchange(ref _registered, 1) == 1) return;

    SnapshotRestore.RegisterBeforeSnapshot(BeforeSnapshot);
    SnapshotRestore.RegisterAfterRestore(AfterRestore);
  }

  // internal, not private: the whole point of these two is what they do to process-wide
  // state, and that is only checkable by calling them. Lambda is the only other caller and
  // it reaches them through the delegates registered above, so widening them costs nothing.
  internal static ValueTask BeforeSnapshot()
  {
    // Invalidate only. Deliberately NO warmup here: anything opened at this point is what
    // gets snapshotted, and a snapshotted TCP socket is dead in every environment restored
    // from it. Warming before the checkpoint would not save the first request a single
    // millisecond, it would hand every restored container a broken connection to discover.
    ResetResources();
    return ValueTask.CompletedTask;
  }

  internal static ValueTask AfterRestore()
  {
    // Order is load-bearing. Invalidate first, then re-warm: warming first would fill a pool
    // that ResetResources is about to dispose, so the first request would pay the full
    // connect anyway and the restore hook would have spent its budget for nothing.
    ResetResources();

    // Runs on the restore budget (2 s), not the init budget, because the snapshot already
    // preserved the loaded assemblies and the JIT-ed code. Only the sockets need rebuilding.
    try { Warmup.RunAfterRestore(); } catch { /* best-effort, same contract as init */ }

    return ValueTask.CompletedTask;
  }

  private static void ResetResources()
  {
    try { Pg.Reset(); } catch { /* best-effort */ }

    // The second pool. Vpc/Db/*.cs resolves the unqualified name `Pg` to
    // RecallSmith.Lambda.Vpc.Db.Pg -- a different class, with its own static
    // NpgsqlDataSource, serving the admin and migration routes. It was missing here, so a
    // restored container would have handed those routes a pre-snapshot socket. Nothing on
    // the hot path uses it, which is precisely why the gap could sit unnoticed until the
    // day someone ran a migration through a restored container.
    try { Vpc.Db.Pg.Reset(); } catch { /* best-effort */ }

    try { Vpc.Runtime.AdminManifest.Reset(); } catch { /* best-effort */ }
    try { Vpc.Authoring.Publish.Reset(); } catch { /* best-effort */ }
    try { ManifestBuilder.Reset(); } catch { /* best-effort */ }
    try { Vpc.Runtime.PremiumDeckUrl.Reset(); } catch { /* best-effort */ }
    try { Vpc.Analytics.OutboxPublisher.Reset(); } catch { /* best-effort */ }
    try { Vpc.Analytics.ContentIntelligenceSnapshotImport.Reset(); } catch { /* best-effort */ }
  }
}
