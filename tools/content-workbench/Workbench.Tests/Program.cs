using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Reflection;
using System.Text.Json;
using ContentWorkbench;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

if (args.Length > 0 && args[0] == "lock-child")
{
    try
    {
        using var ledger = RunLedger.Acquire(args[1], args[2]);
        Console.WriteLine(ledger.Owner.Generation);
        if (args.Length > 3) { File.WriteAllText(args[3], "ready"); await Task.Delay(Timeout.InfiniteTimeSpan); }
        return 0;
    }
    catch (IOException) { return 73; }
}

var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local/share/codex-workflows/recallsmith/aws-basics-bilingual-rag-release-20261028/evidence/workbench-canary", "tests-" + Guid.NewGuid().ToString("N"));
Wire.PrivateDirectory(root);
var fixture = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../fixtures/fake-codex.py"));
if (!File.Exists(fixture)) fixture = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../fixtures/fake-codex.py"));
const string schema = "{\"type\":\"object\",\"properties\":{\"ok\":{\"const\":true}},\"required\":[\"ok\"],\"additionalProperties\":false}";
var tests = new List<(string Name, Func<Task> Run)>();
var passed = 0;
void Test(string name, Func<Task> body) => tests.Add((name, body));
static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
static T Throws<T>(Action action) where T : Exception
{
    try { action(); } catch (T e) { return e; }
    throw new Exception("Expected " + typeof(T).Name);
}
static async Task<T> ThrowsAsync<T>(Func<Task> action) where T : Exception
{
    try { await action(); } catch (T e) { return e; }
    throw new Exception("Expected " + typeof(T).Name);
}
WorkbenchOptions Settings(int seconds = 5) => new() { ControlRoot = root, CodexPath = fixture, TimeoutSeconds = seconds };
CodexExecutor Executor(WorkbenchOptions? settings = null) => new(Options.Create(settings ?? Settings()), NullLogger<CodexExecutor>.Instance);
FrozenRequest Request(string mode = "success", string? heartbeat = null) => new(JsonSerializer.Serialize(new { mode, heartbeat }), schema);
Process Child(params string[] childArgs)
{
    var info = new ProcessStartInfo("/Users/qc/.dotnet/dotnet") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
    info.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
    foreach (var arg in childArgs) info.ArgumentList.Add(arg);
    return Process.Start(info)!;
}

Test("schema_remote_refs_and_bounds_fail_closed", () =>
{
    Throws<ArgumentException>(() => Wire.ParseSchema("{\"$ref\":\"https://example.com/schema\"}"));
    Throws<ArgumentException>(() => new WorkbenchOptions { ControlRoot = root, TimeoutSeconds = 301 }.Validate());
    Throws<ArgumentException>(() => new WorkbenchOptions { ControlRoot = root, Model = "other" }.Validate());
    Throws<ArgumentException>(() => new WorkbenchOptions { ControlRoot = root, OtlpEndpoint = "https://example.com" }.Validate());
    Throws<ArgumentException>(() => CodexExecutor.RequireChildPath(root, "/outside"));
    return Task.CompletedTask;
});
Test("protocol_success_hashes_environment_and_unknown_usage", async () =>
{
    Environment.SetEnvironmentVariable("WORKBENCH_TEST_SECRET", "non-sensitive-test-sentinel");
    try
    {
        var result = await Executor().ExecuteAsync(Request());
        Check(result.Success && result.ExitCode == 0 && result.InputTokens == 7 && result.OutputTokens == 3, "Protocol result mismatch.");
        Check(result.ReportedModel is null && result.InputHash == Wire.Hash(Request().Prompt) && result.OutputHash == Wire.HashFile(Path.Combine(result.AttemptDirectory, "result.json")), "Hash/model mismatch.");
        var metadata = File.ReadAllText(Path.Combine(result.AttemptDirectory, "invocation.json"));
        Check(!metadata.Contains("WORKBENCH_TEST_SECRET") && metadata.Contains("forced_login_method") && metadata.Contains("--strict-config"), "Invocation boundary missing.");
        var unknown = await Executor().ExecuteAsync(Request("unknown_usage"));
        Check(unknown.Success && unknown.InputTokens is null && unknown.OutputTokens is null && unknown.ReportedModel is null, "Unknown values fabricated.");
    }
    finally { Environment.SetEnvironmentVariable("WORKBENCH_TEST_SECRET", null); }
});
Test("schema_protocol_tool_nonzero_and_quota_failures", async () =>
{
    foreach (var (mode, kind, code) in new[] { ("bad_schema", FailureKind.Schema, 0), ("malformed", FailureKind.Protocol, 0), ("tool", FailureKind.ToolBoundary, 0), ("nonzero", FailureKind.ProcessExit, 17), ("quota", FailureKind.Quota, 19) })
    {
        var result = await Executor().ExecuteAsync(Request(mode));
        Check(!result.Success && result.Failure == kind && result.ExitCode == code && result.Output is null, $"{mode} classified {result.Failure} exit {result.ExitCode}.");
        Check(File.Exists(Path.Combine(result.AttemptDirectory, "failure.json")) && !File.Exists(Path.Combine(result.AttemptDirectory, "result.json")), "Failed output promoted.");
    }
});
Test("attempts_never_overwrite_and_nonexistent_cli_is_environment", async () =>
{
    var settings = Settings(); settings.AttemptDirectory = Path.Combine(root, "fixed-attempt");
    Check((await Executor(settings).ExecuteAsync(Request())).Success, "First attempt failed.");
    await ThrowsAsync<IOException>(() => Executor(settings).ExecuteAsync(Request()));
    settings.AttemptDirectory = null; settings.CodexPath = Path.Combine(root, "nonexistent");
    var failure = await Executor(settings).ExecuteAsync(Request());
    Check(failure.Failure == FailureKind.Environment && failure.ExitCode is null, "Startup failure exit must be unknown.");
});
Test("timeout_and_cancellation_kill_descendant_tree", async () =>
{
    foreach (var cancel in new[] { false, true })
    {
        var heartbeat = Path.Combine(root, Guid.NewGuid().ToString("N") + ".heartbeat");
        using var cts = new CancellationTokenSource();
        var running = Executor(Settings(cancel ? 10 : 1)).ExecuteAsync(Request(cancel ? "cancel" : "sleep", heartbeat), cts.Token);
        var deadline = Stopwatch.StartNew();
        while (!File.Exists(heartbeat) && deadline.Elapsed < TimeSpan.FromSeconds(5)) await Task.Delay(20);
        Check(File.Exists(heartbeat), "Child did not start.");
        if (cancel) cts.Cancel();
        var result = await running;
        Check(result.Failure == (cancel ? FailureKind.Cancelled : FailureKind.Timeout) && result.ExitCode is not null, "Cancellation classification/exit missing.");
        var before = File.ReadAllText(heartbeat); await Task.Delay(200);
        Check(File.ReadAllText(heartbeat) == before, "Descendant survived kill.");
    }
});
Test("bounded_capture_terminates_overproducing_process", async () =>
{
    var result = await Executor().ExecuteAsync(Request("oversize"));
    Check(result.Failure == FailureKind.Protocol && result.ExitCode is not null, "Unbounded capture or lost exit.");
});
Test("adapter_contract_rejects_roles_tools_options_and_buffers_stream", async () =>
{
    using var doc = JsonDocument.Parse(schema);
    var options = new ChatOptions { ResponseFormat = ChatResponseFormat.ForJsonSchema(doc.RootElement) };
    var fake = new RecordingExecutor(); var adapter = new CodexChatClient(fake, Options.Create(Settings()));
    await ThrowsAsync<NotSupportedException>(() => adapter.GetResponseAsync([new ChatMessage(ChatRole.System, "system")], options));
    await ThrowsAsync<NotSupportedException>(() => adapter.GetResponseAsync([new ChatMessage(ChatRole.User, "a"), new ChatMessage(ChatRole.User, "b")], options));
    await ThrowsAsync<NotSupportedException>(() => adapter.GetResponseAsync([new ChatMessage(ChatRole.User, "a")], new ChatOptions { ResponseFormat = options.ResponseFormat, Temperature = .1f }));
    await ThrowsAsync<NotSupportedException>(() => adapter.GetResponseAsync([new ChatMessage(ChatRole.User, "a")], new ChatOptions { ResponseFormat = options.ResponseFormat, Tools = [] }));
    await ThrowsAsync<NotSupportedException>(() => adapter.GetResponseAsync([new ChatMessage(ChatRole.User, "a")]));
    await ThrowsAsync<NotSupportedException>(() => adapter.GetResponseAsync([new ChatMessage(ChatRole.User, "a") { AuthorName = "unsupported" }], options));
    Check(fake.Calls == 0, "Rejected request invoked model.");
    var updates = new List<ChatResponseUpdate>();
    await foreach (var update in adapter.GetStreamingResponseAsync([new ChatMessage(ChatRole.User, "frozen")], options)) { Check(fake.Completed, "Partial stream leaked."); updates.Add(update); }
    Check(updates.Count == 1 && updates[0].Text == "{\"ok\":true}" && updates[0].ModelId is null, "Buffered stream/unknown model incorrect.");
});
Test("process_mutex_refuses_live_owner_and_releases_after_crash", async () =>
{
    using (var owner = RunLedger.Acquire(root, "mutex"))
    {
        using var blocked = Child("lock-child", root, "mutex"); await blocked.WaitForExitAsync();
        Check(blocked.ExitCode == 73, "Another process stole active owner lock.");
    }
    var ready = Path.Combine(root, "lock.ready");
    using var holder = Child("lock-child", root, "mutex", ready);
    var wait = Stopwatch.StartNew(); while (!File.Exists(ready) && wait.Elapsed < TimeSpan.FromSeconds(5)) await Task.Delay(20);
    Check(File.Exists(ready), "Child lock owner not ready.");
    Throws<IOException>(() => RunLedger.Acquire(root, "mutex"));
    holder.Kill(true); await holder.WaitForExitAsync();
    using var recovered = RunLedger.Acquire(root, "mutex");
    Check(recovered.Owner.Generation == 3 && recovered.State.Generation == 3, "Crash recovery generation incorrect.");
});
Test("stale_owner_fenced_even_if_metadata_says_expired", () =>
{
    using var old = RunLedger.Acquire(root, "fencing");
    Wire.AtomicJson(Path.Combine(old.DirectoryPath, "owner.json"), old.Owner with { Generation = old.Owner.Generation + 1, ProcessId = int.MaxValue });
    Throws<InvalidOperationException>(() => old.Save());
    Throws<IOException>(() => RunLedger.Acquire(root, "fencing"));
    old.Dispose(); using var next = RunLedger.Acquire(root, "fencing");
    Throws<InvalidOperationException>(() => old.Save());
    Check(next.Owner.Generation == 3, "Owner generation did not advance."); return Task.CompletedTask;
});
Test("remote_success_local_crash_reconciles_without_duplicate_write", async () =>
{
    var remote = new FakeRemote(); string key;
    using (var first = RunLedger.Acquire(root, "remote"))
    {
        var action = first.PrepareAction("publish", "fake_publish", "payload-v1"); key = action.IdempotencyKey;
        remote.Activate(first.Owner.Generation); remote.Apply(action); remote.Apply(action);
        Check(remote.Writes == 1, "Remote idempotency failed.");
        // Simulated death before local confirmation.
    }
    using var resumed = RunLedger.Acquire(root, "remote");
    Throws<ReconciliationRequiredException>(() => resumed.PrepareAction("publish", "fake_publish", "payload-v1"));
    remote.Activate(resumed.Owner.Generation);
    Throws<InvalidOperationException>(() => remote.Apply(resumed.State.Actions["publish"]));
    await resumed.ReconcileAsync(remote);
    Check(resumed.State.Actions["publish"].Status == ActionStatus.Confirmed && remote.Writes == 1, "Reconciliation duplicated remote write.");
    Throws<ReconciliationRequiredException>(() => resumed.PrepareAction("publish", "fake_publish", "payload-v1"));
    Throws<InvalidOperationException>(() => resumed.PrepareAction("publish", "fake_publish", "other"));
    Check(key == resumed.State.Actions["publish"].IdempotencyKey, "Idempotency key changed.");
});
Test("unknown_and_absent_action_reconciliation_and_hash_binding", async () =>
{
    using var ledger = RunLedger.Acquire(root, "unknown");
    ledger.BindNode("n", "input", "schema");
    Throws<InvalidOperationException>(() => ledger.BindNode("n", "changed", "schema"));
    ledger.PrepareAction("n", "model", "payload"); ledger.MarkUnknown("n");
    await ThrowsAsync<ReconciliationRequiredException>(() => ledger.ReconcileAsync(new UnknownModelReconciler()));
    Throws<ReconciliationRequiredException>(() => ledger.PrepareAction("n", "model", "payload"));
    await ledger.ReconcileAsync(new FixedProbe(new ProbeResult(ProbeStatus.Absent)));
    Check(ledger.PrepareAction("n", "model", "payload").Status == ActionStatus.Prepared, "Confirmed absent action could not be explicitly prepared.");
    await ThrowsAsync<InvalidDataException>(() => ledger.ReconcileAsync(new FixedProbe(new ProbeResult(ProbeStatus.Confirmed, "wrong", "receipt"))));
});
Test("cli_model_resume_reconciles_completed_attempt_and_rejects_tampered_schema", async () =>
{
    var promptPath = Path.Combine(root, "cli-prompt.json"); var schemaPath = Path.Combine(root, "cli-schema.json");
    await File.WriteAllTextAsync(promptPath, Request().Prompt); await File.WriteAllTextAsync(schemaPath, "\n" + schema + "\n");
    var output = Path.Combine(root, "cli-success");
    Environment.SetEnvironmentVariable("WORKBENCH_CodexPath", fixture);
    try
    {
        var arguments = new[] { "exec", "--control-root", root, "--prompt", promptPath, "--schema", schemaPath, "--output", output, "--run", "cli-resume" };
        Check(await WorkbenchCli.RunAsync(arguments) == 0, "CLI executor failed.");
        Check(await WorkbenchCli.RunAsync(arguments) == 0, "Confirmed node replay did not reuse artifact.");
        using (var ledger = RunLedger.Acquire(root, "cli-resume"))
        {
            Check(ledger.State.Nodes["model"].Attempts == 1, "Idempotent CLI replay ran model again.");
            ledger.State.Nodes["model"].Status = NodeStatus.Running;
            ledger.State.Actions["model"].Status = ActionStatus.Unknown;
            ledger.State.Actions["model"].Receipt = null; ledger.Save();
        }
        Check(await WorkbenchCli.RunAsync(["resume", "--control-root", root, "--run", "cli-resume"]) == 0, "Completed evidence could not reconcile crash.");
        using (var ledger = RunLedger.Acquire(root, "cli-resume"))
            Check(ledger.State.Nodes["model"].Status == NodeStatus.Produced && ledger.State.Actions["model"].Status == ActionStatus.Confirmed, "Resume did not restore produced node.");
        await File.WriteAllTextAsync(Path.Combine(output, "schema.json"), "{}");
        Check(await WorkbenchCli.RunAsync(["resume", "--control-root", root, "--run", "cli-resume"]) != 0, "Changed schema was accepted during reconciliation.");
    }
    finally { Environment.SetEnvironmentVariable("WORKBENCH_CodexPath", null); }
});
Test("cli_deterministic_task_resume_detects_corrupt_artifact", async () =>
{
    var inputPath = Path.Combine(root, "deterministic-input.json"); var schemaPath = Path.Combine(root, "deterministic-schema.json");
    await File.WriteAllTextAsync(inputPath, "{\"ok\":true}"); await File.WriteAllTextAsync(schemaPath, schema);
    var arguments = new[] { "check", "--control-root", root, "--run", "deterministic", "--input", inputPath, "--schema", schemaPath };
    Check(await WorkbenchCli.RunAsync(arguments) == 0 && await WorkbenchCli.RunAsync(["resume", "--control-root", root, "--run", "deterministic"]) == 0, "Deterministic task failed to resume.");
    using (var ledger = RunLedger.Acquire(root, "deterministic"))
        await File.WriteAllTextAsync(ledger.State.Nodes["check"].EvidenceDirectory!, "corrupt");
    Check(await WorkbenchCli.RunAsync(["resume", "--control-root", root, "--run", "deterministic"]) != 0, "Corrupt artifact accepted.");
});
Test("atomic_json_preserves_prior_state_on_serialization_failure", () =>
{
    var path = Path.Combine(root, "atomic.json"); Wire.AtomicJson(path, new { ok = true });
    var prior = File.ReadAllText(path); var loop = new List<object>(); loop.Add(loop);
    Throws<JsonException>(() => Wire.AtomicJson(path, loop));
    Check(File.ReadAllText(path) == prior && Directory.GetFiles(root, "atomic.json.*.tmp").Length == 0, "Atomic write corrupted existing state."); return Task.CompletedTask;
});
Test("telemetry_emits_success_failure_without_content_or_high_cardinality_tags", async () =>
{
    var activities = new List<Activity>(); var metrics = new List<string>();
    using var listener = new ActivityListener { ShouldListenTo = s => s.Name == WorkbenchTelemetry.Name, Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllDataAndRecorded, ActivityStopped = a => activities.Add(a) };
    ActivitySource.AddActivityListener(listener);
    using var meters = new MeterListener();
    meters.InstrumentPublished = (instrument, l) => { if (instrument.Meter.Name == WorkbenchTelemetry.Name) l.EnableMeasurementEvents(instrument); };
    meters.SetMeasurementEventCallback<long>((instrument, value, tags, _) => { foreach (var tag in tags) { Check(tag.Key is "status" or "failure", "High cardinality metric label."); metrics.Add(tag.Key); } });
    meters.Start();
    await Executor().ExecuteAsync(Request()); await Executor().ExecuteAsync(Request("bad_schema"));
    Check(activities.Any(a => a.Status == ActivityStatusCode.Ok) && activities.Any(a => a.Status == ActivityStatusCode.Error) && metrics.Count >= 4, "Telemetry did not emit both outcomes.");
    Check(activities.SelectMany(a => a.TagObjects).All(t => t.Key is "workbench.status" or "workbench.failure"), "Content leaked to traces.");
});

foreach (var (name, run) in tests)
{
    try { await run(); passed++; Console.WriteLine(JsonSerializer.Serialize(new { test = name, status = "PASS" })); }
    catch (Exception error) { Console.Error.WriteLine(JsonSerializer.Serialize(new { test = name, status = "FAIL", error = error.ToString() })); }
}
Console.WriteLine(JsonSerializer.Serialize(new { passed, total = tests.Count, evidenceRoot = root }));
return passed == tests.Count ? 0 : 1;

sealed class RecordingExecutor : ICodexExecutor
{
    public int Calls; public bool Completed;
    public async Task<ExecutionResult> ExecuteAsync(FrozenRequest request, CancellationToken cancellationToken = default)
    {
        Calls++; await Task.Delay(20, cancellationToken); Completed = true;
        return new(true, FailureKind.None, 0, "test", Wire.Hash(request.Prompt), Wire.Hash(request.Schema), Wire.Hash("{\"ok\":true}"), "gpt-6-sol", null, null, null, 20, "{\"ok\":true}");
    }
}
sealed class FakeRemote : IActionReconciler
{
    public int Writes; private long generation;
    public void Activate(long next) { if (next <= generation) throw new InvalidOperationException("Generation must advance."); generation = next; }
    private readonly Dictionary<string, (string Hash, string Receipt)> applied = [];
    public void Apply(ActionRecord action)
    {
        if (action.Generation != generation) throw new InvalidOperationException("Remote rejected stale owner generation.");
        if (applied.TryGetValue(action.IdempotencyKey, out var existing)) { if (existing.Hash != action.PayloadHash) throw new InvalidOperationException("Same key, different payload."); return; }
        applied.Add(action.IdempotencyKey, (action.PayloadHash, "remote-receipt")); Writes++;
    }
    public Task<ProbeResult> QueryAsync(ActionRecord action, CancellationToken cancellationToken) => Task.FromResult(applied.TryGetValue(action.IdempotencyKey, out var value) ? new ProbeResult(ProbeStatus.Confirmed, value.Hash, value.Receipt) : new ProbeResult(ProbeStatus.Absent));
}
sealed class FixedProbe(ProbeResult result) : IActionReconciler
{
    public Task<ProbeResult> QueryAsync(ActionRecord action, CancellationToken cancellationToken) => Task.FromResult(result);
}
