using System.Text.Json;
using System.Text.RegularExpressions;

namespace ContentWorkbench;

public enum NodeStatus { Pending, Running, Produced, Failed, Unknown }
public enum ActionStatus { Prepared, Unknown, Confirmed, ReconciledAbsent }
public sealed record Owner(long Generation, string Token, int ProcessId);
public sealed class NodeRecord
{
    public required string InputHash { get; set; }
    public required string SchemaHash { get; set; }
    public NodeStatus Status { get; set; }
    public int Attempts { get; set; }
    public string? OutputHash { get; set; }
    public string? EvidenceDirectory { get; set; }
}
public sealed class ActionRecord
{
    public required string Kind { get; set; }
    public required string PayloadHash { get; set; }
    public required string IdempotencyKey { get; set; }
    public required long Generation { get; set; }
    public ActionStatus Status { get; set; }
    public string? Receipt { get; set; }
    public string? EvidenceDirectory { get; set; }
}
public sealed class RunState
{
    public int SchemaVersion { get; set; } = 1;
    public required string RunId { get; set; }
    public long Generation { get; set; }
    public Dictionary<string, NodeRecord> Nodes { get; set; } = [];
    public Dictionary<string, ActionRecord> Actions { get; set; } = [];
}
public enum ProbeStatus { Confirmed, Absent, Unknown }
public sealed record ProbeResult(ProbeStatus Status, string? PayloadHash = null, string? Receipt = null);
public interface IActionReconciler { Task<ProbeResult> QueryAsync(ActionRecord action, CancellationToken cancellationToken); }
public sealed class ReconciliationRequiredException(string message) : Exception(message);

/// <summary>OS-backed exclusive file sharing is the process mutex. Time alone never steals a live owner's lock.</summary>
public sealed class RunLedger : IDisposable
{
    private readonly FileStream mutex;
    private readonly string ownerPath;
    private readonly string statePath;
    private bool disposed;
    public Owner Owner { get; }
    public RunState State { get; }
    public string DirectoryPath { get; }
    private RunLedger(string directory, string runId)
    {
        DirectoryPath = directory;
        Wire.PrivateDirectory(directory);
        ownerPath = Path.Combine(directory, "owner.json"); statePath = Path.Combine(directory, "state.json");
        mutex = new FileStream(Path.Combine(directory, "controller.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        try
        {
            Wire.PrivateFile(Path.Combine(directory, "controller.lock"));
            var previous = File.Exists(ownerPath) ? Read<Owner>(ownerPath).Generation : 0;
            State = File.Exists(statePath) ? Read<RunState>(statePath) : new RunState { RunId = runId };
            if (State.SchemaVersion != 1 || State.RunId != runId || previous < State.Generation) throw new InvalidDataException("Ledger identity/version/owner mismatch.");
            Owner = new Owner(checked(previous + 1), Guid.NewGuid().ToString("N"), Environment.ProcessId);
            Wire.AtomicJson(ownerPath, Owner);
            State.Generation = Owner.Generation; Save();
        }
        catch { mutex.Dispose(); throw; }
    }
    public static RunLedger Acquire(string controlRoot, string runId)
    {
        if (!Regex.IsMatch(runId, "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$", RegexOptions.CultureInvariant)) throw new ArgumentException("Invalid run ID.");
        var root = Path.GetFullPath(controlRoot);
        // Reject symlinked control roots/parents: an alias must not create a separate fencing namespace.
        for (var p = new DirectoryInfo(root); p is not null; p = p.Parent)
            if (p.Exists && p.LinkTarget is not null) throw new ArgumentException("Control roots must not contain symlink aliases.");
        var directory = Path.Combine(root, "runs", runId);
        for (var p = new DirectoryInfo(directory); p is not null; p = p.Parent)
            if (p.Exists && p.LinkTarget is not null) throw new ArgumentException("Run directory ancestry cannot be a symlink.");
        return new RunLedger(directory, runId);
    }
    public void AssertCurrent()
    {
        if (disposed) throw new InvalidOperationException("Owner lease has been released.");
        var current = Read<Owner>(ownerPath);
        if (current.Generation != Owner.Generation || current.Token != Owner.Token) throw new InvalidOperationException("Stale owner generation fenced.");
    }
    public void Save() { AssertCurrent(); Wire.AtomicJson(statePath, State); }
    public NodeRecord BindNode(string id, string inputHash, string schemaHash)
    {
        AssertCurrent();
        if (State.Nodes.TryGetValue(id, out var node))
        {
            if (node.InputHash != inputHash || node.SchemaHash != schemaHash) throw new InvalidOperationException("Frozen node inputs changed; use a new node/run.");
            return node;
        }
        node = new NodeRecord { InputHash = inputHash, SchemaHash = schemaHash };
        State.Nodes.Add(id, node); Save(); return node;
    }
    public ActionRecord PrepareAction(string id, string kind, string payloadHash)
    {
        AssertCurrent();
        if (State.Actions.TryGetValue(id, out var previous))
        {
            if (previous.PayloadHash != payloadHash || previous.Kind != kind) throw new InvalidOperationException("Action ID reused with a different payload/kind.");
            if (previous.Status != ActionStatus.ReconciledAbsent) throw new ReconciliationRequiredException("Existing actions must be reconciled; confirmed actions cannot replay.");
        }
        var action = new ActionRecord { Kind = kind, PayloadHash = payloadHash, IdempotencyKey = Wire.Hash(State.RunId + ":" + id), Generation = Owner.Generation, Status = ActionStatus.Prepared };
        State.Actions[id] = action; Save(); return action;
    }
    public void MarkUnknown(string id)
    {
        AssertCurrent(); var action = State.Actions[id];
        if (action.Status != ActionStatus.Prepared) throw new InvalidOperationException("Only a prepared action can become unknown.");
        action.Status = ActionStatus.Unknown; Save();
    }
    public void Confirm(string id, string receipt)
    {
        AssertCurrent(); var action = State.Actions[id];
        if (action.Generation != Owner.Generation || action.Status != ActionStatus.Prepared || string.IsNullOrEmpty(receipt)) throw new InvalidOperationException("Stale or invalid action confirmation.");
        action.Status = ActionStatus.Confirmed; action.Receipt = receipt; Save();
    }
    public async Task ReconcileAsync(IActionReconciler remote, CancellationToken cancellationToken = default)
    {
        AssertCurrent();
        foreach (var action in State.Actions.Values.Where(a => a.Status is ActionStatus.Prepared or ActionStatus.Unknown or ActionStatus.Confirmed))
        {
            var probe = await remote.QueryAsync(action, cancellationToken); AssertCurrent();
            if (probe.Status == ProbeStatus.Confirmed)
            {
                if (probe.PayloadHash != action.PayloadHash || string.IsNullOrEmpty(probe.Receipt)) throw new InvalidDataException("Remote receipt payload mismatch.");
                action.Status = ActionStatus.Confirmed; action.Receipt = probe.Receipt;
            }
            else if (probe.Status == ProbeStatus.Absent)
            {
                if (action.Status == ActionStatus.Confirmed) throw new InvalidDataException("Previously confirmed action is absent remotely; refusing replay.");
                action.Status = ActionStatus.ReconciledAbsent;
            }
            else action.Status = ActionStatus.Unknown;
            Save();
        }
        if (State.Actions.Values.Any(a => a.Status == ActionStatus.Unknown)) throw new ReconciliationRequiredException("Remote outcome is unknown; blind replay is blocked.");
    }
    public void Dispose() { if (disposed) return; disposed = true; mutex.Dispose(); }
    private static T Read<T>(string path) => JsonSerializer.Deserialize<T>(File.ReadAllText(path), Wire.Json) ?? throw new InvalidDataException("Invalid ledger.");
}

/// <summary>Subscription CLI has no remote idempotency query: ambiguous attempts require operator evidence, never replay.</summary>
public sealed class UnknownModelReconciler : IActionReconciler
{
    public Task<ProbeResult> QueryAsync(ActionRecord action, CancellationToken cancellationToken) => Task.FromResult(new ProbeResult(ProbeStatus.Unknown));
}
