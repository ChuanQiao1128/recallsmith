using System.Text.Json;
using System.Text.Json.Nodes;
using ContentWorkbench;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Json.Schema;

return await WorkbenchCli.RunAsync(args);

public static class WorkbenchCli
{
    public static async Task<int> RunAsync(string[] args)
    {
        using var cancel = new CancellationTokenSource();
        ConsoleCancelEventHandler handler = (_, e) => { e.Cancel = true; cancel.Cancel(); };
        Console.CancelKeyPress += handler;
        try
        {
            if (args.Length == 0 || args[0] is not ("exec" or "resume" or "check")) throw new ArgumentException("Commands: exec --prompt FILE --schema FILE --output NEW_DIR; check --input JSON --schema FILE; resume --run ID. All require --control-root ABS_DIR.");
            var command = args[0]; var values = new Dictionary<string, string>(StringComparer.Ordinal);
            var accepted = new HashSet<string> { "control-root", "prompt", "schema", "output", "input", "model", "workspace-root", "run", "node", "timeout-seconds", "otlp-endpoint", "stream", "purpose", "input-policy-version" };
            for (var i = 1; i < args.Length; i += 2)
            {
                if (!args[i].StartsWith("--", StringComparison.Ordinal) || i + 1 >= args.Length || !accepted.Contains(args[i][2..]) || !values.TryAdd(args[i][2..], args[i + 1])) throw new ArgumentException("Unknown, duplicate, or missing CLI option.");
            }
            string Required(string key) => values.TryGetValue(key, out var value) ? value : throw new ArgumentException($"Missing --{key}.");
            var builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings { Args = [], DisableDefaults = true });
            builder.Configuration.AddEnvironmentVariables("WORKBENCH_");
            var settings = new WorkbenchOptions(); builder.Configuration.Bind(settings);
            settings.ControlRoot = values.GetValueOrDefault("control-root", settings.ControlRoot);
            settings.Model = values.GetValueOrDefault("model", settings.Model);
            settings.AttemptDirectory = values.GetValueOrDefault("output");
            settings.WorkspaceRoot = values.GetValueOrDefault("workspace-root");
            if (command != "exec" && (values.ContainsKey("purpose") || values.ContainsKey("input-policy-version"))) throw new ArgumentException("Input policy applies only to exec.");
            settings.SelectInputPolicy(values.GetValueOrDefault("purpose"), values.GetValueOrDefault("input-policy-version"));
            if (values.TryGetValue("otlp-endpoint", out var otlp)) settings.OtlpEndpoint = otlp;
            if (values.TryGetValue("timeout-seconds", out var timeout)) settings.TimeoutSeconds = int.Parse(timeout, System.Globalization.CultureInfo.InvariantCulture);
            settings.Validate();
            builder.Services.AddSingleton<IOptions<WorkbenchOptions>>(Options.Create(settings));
            builder.Services.AddSingleton<ICodexExecutor, CodexExecutor>(); builder.Services.AddSingleton<IChatClient, CodexChatClient>();
            WorkbenchTelemetry.AddTelemetry(builder, settings);
            using var host = builder.Build(); await host.StartAsync(cancel.Token);
            try
            {
                var runId = values.GetValueOrDefault("run") ?? (command == "exec" ? "exec-" + Wire.Hash(Path.GetFullPath(Required("output")))[..24] : throw new ArgumentException("--run is required."));
                using var ledger = RunLedger.Acquire(settings.ControlRoot, runId);
                settings.WorkerActivityPath = Path.Combine(ledger.DirectoryPath, "worker-active.json");
                if (command == "resume")
                {
                    await ledger.ReconcileAsync(new LocalEvidenceReconciler(), cancel.Token);
                    foreach (var (actionId, reconciledAction) in ledger.State.Actions.Where(p => p.Value.Status == ActionStatus.Confirmed && p.Value.Kind == "model"))
                    {
                        if (!ledger.State.Nodes.TryGetValue(actionId, out var recoveredNode) || reconciledAction.EvidenceDirectory is null) throw new InvalidDataException("Confirmed model action has no bound node/evidence.");
                        if (Wire.Hash(recoveredNode.InputHash + ":" + recoveredNode.SchemaHash) != reconciledAction.PayloadHash) throw new InvalidDataException("Node/action frozen-input binding mismatch.");
                        recoveredNode.Status = NodeStatus.Produced; recoveredNode.OutputHash = reconciledAction.Receipt;
                        recoveredNode.EvidenceDirectory = Path.Combine(reconciledAction.EvidenceDirectory, "result.json");
                    }
                    foreach (var existingNode in ledger.State.Nodes.Values.Where(n => n.Status == NodeStatus.Produced)) VerifyArtifact(existingNode);
                    ledger.Save();
                    Console.WriteLine(JsonSerializer.Serialize(ledger.State, Wire.Json)); return 0;
                }
                var nodeId = values.GetValueOrDefault("node", command == "exec" ? "model" : "check");
                using var frozenSchema = JsonDocument.Parse(await File.ReadAllTextAsync(Required("schema"), cancel.Token));
                var schemaText = frozenSchema.RootElement.GetRawText();
                var input = await File.ReadAllTextAsync(Required(command == "exec" ? "prompt" : "input"), cancel.Token);
                var node = ledger.BindNode(nodeId, Wire.Hash(input), Wire.Hash(schemaText),
                    settings.InputPolicy switch
                    {
                        WorkbenchInputPolicy.DevEquivalenceV2 => "dev-equivalence-input-v2",
                        WorkbenchInputPolicy.PrivateAuthorSourceV1 or WorkbenchInputPolicy.PrivateCheckerSourceV1 => "private-source-input-v1",
                        _ => null
                    });
                if (node.Status == NodeStatus.Produced) { VerifyArtifact(node); Console.WriteLine("{\"status\":\"already_produced\"}"); return 0; }
                if (command == "check")
                {
                    using var activity = WorkbenchTelemetry.Activities.StartActivity("deterministic.check");
                    node.Status = NodeStatus.Running; node.Attempts++; ledger.Save();
                    var valid = Wire.ParseSchema(schemaText).Evaluate(JsonNode.Parse(input), new EvaluationOptions { OutputFormat = OutputFormat.Flag }).IsValid;
                    node.Status = valid ? NodeStatus.Produced : NodeStatus.Failed;
                    node.OutputHash = valid ? Wire.Hash(input) : null;
                    var artifact = Path.Combine(ledger.DirectoryPath, Wire.Hash(nodeId) + ".json");
                    if (valid) { await File.WriteAllTextAsync(artifact, input, cancel.Token); Wire.PrivateFile(artifact); node.EvidenceDirectory = artifact; }
                    ledger.Save(); WorkbenchTelemetry.Record(activity, valid ? FailureKind.None : FailureKind.Schema, 0);
                    Console.WriteLine(valid ? "{\"status\":\"produced\"}" : "{\"status\":\"schema_failed\"}"); return valid ? 0 : 1;
                }
                Required("output");
                if (ledger.State.Actions.TryGetValue(nodeId, out var previous) && previous.Status != ActionStatus.ReconciledAbsent)
                {
                    await ledger.ReconcileAsync(new LocalEvidenceReconciler(), cancel.Token);
                    throw new ReconciliationRequiredException("Prior action reconciled; inspect resume result before starting a new attempt.");
                }
                if (node.Attempts >= 3) throw new InvalidOperationException("Node attempt budget exhausted.");
                var action = ledger.PrepareAction(nodeId, "model", Wire.Hash(node.InputHash + ":" + node.SchemaHash));
                action.EvidenceDirectory = Path.GetFullPath(Required("output"));
                node.Status = NodeStatus.Running; node.Attempts++; ledger.Save();
                try
                {
                    using var schema = JsonDocument.Parse(schemaText);
                    var chat = host.Services.GetRequiredService<IChatClient>();
                    var chatOptions = new ChatOptions { ModelId = settings.Model, ResponseFormat = ChatResponseFormat.ForJsonSchema(schema.RootElement) };
                    ExecutionResult? result;
                    if (values.GetValueOrDefault("stream") == "true")
                    {
                        ChatResponseUpdate? final = null;
                        await foreach (var update in chat.GetStreamingResponseAsync([new ChatMessage(ChatRole.User, input)], chatOptions, cancel.Token)) final = update;
                        result = (ExecutionResult?)final?.AdditionalProperties?["workbench.execution"];
                    }
                    else
                    {
                        var response = await chat.GetResponseAsync([new ChatMessage(ChatRole.User, input)], chatOptions, cancel.Token);
                        result = (ExecutionResult?)response.AdditionalProperties?["workbench.execution"];
                    }
                    if (result is null || !result.Success || result.OutputHash is null) throw new InvalidDataException("Missing executor receipt.");
                    node.Status = NodeStatus.Produced; node.OutputHash = result.OutputHash; node.EvidenceDirectory = Path.Combine(result.AttemptDirectory, "result.json");
                    ledger.Confirm(nodeId, result.OutputHash);
                    Console.WriteLine(JsonSerializer.Serialize(result with { Output = null }, Wire.Json)); return 0;
                }
                catch
                {
                    node.Status = NodeStatus.Unknown; ledger.MarkUnknown(nodeId); throw;
                }
            }
            finally { await host.StopAsync(CancellationToken.None); }
        }
        catch (OperationCanceledException) { Console.Error.WriteLine("Cancelled."); return 130; }
        catch (ModelExecutionException e) { Console.Error.WriteLine($"Model execution failed: {e.Result.Failure}; exit={e.Result.ExitCode?.ToString() ?? "unknown"}."); return e.Result.Failure == FailureKind.Cancelled ? 130 : 1; }
        catch (Exception e) when (e is ArgumentException or IOException or InvalidDataException or InvalidOperationException or ReconciliationRequiredException or JsonException or FormatException)
        { Console.Error.WriteLine($"{e.GetType().Name}: {e.Message}"); return 2; }
        finally { Console.CancelKeyPress -= handler; }
    }
    private static void VerifyArtifact(NodeRecord node)
    {
        if (node.EvidenceDirectory is null || !File.Exists(node.EvidenceDirectory) || Wire.HashFile(node.EvidenceDirectory) != node.OutputHash) throw new InvalidDataException("Produced artifact missing or hash mismatch.");
    }
}

public sealed class LocalEvidenceReconciler : IActionReconciler
{
    public Task<ProbeResult> QueryAsync(ActionRecord action, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var root = action.EvidenceDirectory;
        if (root is null || !File.Exists(Path.Combine(root, "execution.json"))) return Task.FromResult(new ProbeResult(ProbeStatus.Unknown));
        var execution = JsonSerializer.Deserialize<ExecutionResult>(File.ReadAllText(Path.Combine(root, "execution.json")), Wire.Json);
        if (execution is not { Success: true, ExitCode: 0, OutputHash: { } hash } || Wire.Hash(execution.InputHash + ":" + execution.SchemaHash) != action.PayloadHash || !File.Exists(Path.Combine(root, "result.json")) || Wire.HashFile(Path.Combine(root, "result.json")) != hash)
            return Task.FromResult(new ProbeResult(ProbeStatus.Unknown));
        if (Path.GetFullPath(execution.AttemptDirectory) != Path.GetFullPath(root) || execution.EventsHash is null || execution.StderrHash is null || !File.Exists(Path.Combine(root, "events.jsonl")) || !File.Exists(Path.Combine(root, "stderr.log")) || Wire.HashFile(Path.Combine(root, "events.jsonl")) != execution.EventsHash || Wire.HashFile(Path.Combine(root, "stderr.log")) != execution.StderrHash) return Task.FromResult(new ProbeResult(ProbeStatus.Unknown));
        if (!File.Exists(Path.Combine(root, "schema.json")) || Wire.HashFile(Path.Combine(root, "schema.json")) != execution.SchemaHash) return Task.FromResult(new ProbeResult(ProbeStatus.Unknown));
        var schema = Wire.ParseSchema(File.ReadAllText(Path.Combine(root, "schema.json")));
        if (!schema.Evaluate(JsonNode.Parse(File.ReadAllText(Path.Combine(root, "result.json"))), new EvaluationOptions { OutputFormat = OutputFormat.Flag }).IsValid)
            return Task.FromResult(new ProbeResult(ProbeStatus.Unknown));
        return Task.FromResult(new ProbeResult(ProbeStatus.Confirmed, action.PayloadHash, hash));
    }
}
