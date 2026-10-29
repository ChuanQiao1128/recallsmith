using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Runtime.InteropServices;
using Json.Schema;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ContentWorkbench;

public sealed class CodexExecutor(IOptions<WorkbenchOptions> options, ILogger<CodexExecutor> logger) : ICodexExecutor
{
    private readonly WorkbenchOptions settings = options.Value;
    private static readonly string[] EnvironmentAllowList = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "TERM", "TZ", "CODEX_HOME"];
    public async Task<ExecutionResult> ExecuteAsync(FrozenRequest request, CancellationToken cancellationToken = default)
    {
        settings.Validate();
        if (!OperatingSystem.IsMacOS()) throw new PlatformNotSupportedException("The bounded process host is currently validated for macOS only.");
        Wire.ValidateInput(request);
        var schema = Wire.ParseSchema(request.Schema);
        var attempt = settings.AttemptDirectory ?? Path.Combine(settings.ControlRoot, "attempts", Guid.NewGuid().ToString("N"));
        RequireChildPath(settings.ControlRoot, attempt);
        if (Directory.Exists(attempt) || File.Exists(attempt)) throw new IOException("Attempt directory already exists; preserve evidence and reconcile instead of overwriting.");
        Wire.PrivateDirectory(attempt);
        var workspace = settings.WorkspaceRoot is { } workspaceRoot ? Path.Combine(workspaceRoot, Guid.NewGuid().ToString("N")) : Path.Combine(attempt, "workspace");
        RequireChildPath(settings.ControlRoot, workspace); Wire.PrivateDirectory(workspace);
        var schemaPath = Path.Combine(attempt, "schema.json");
        await File.WriteAllTextAsync(schemaPath, request.Schema, cancellationToken); Wire.PrivateFile(schemaPath);
        var strictSchemaPath = Path.Combine(attempt, "schema.strict.json");
        await File.WriteAllTextAsync(strictSchemaPath, Wire.ForStrictResponse(request.Schema), cancellationToken); Wire.PrivateFile(strictSchemaPath);
        using var activity = WorkbenchTelemetry.Activities.StartActivity("codex.execute");
        var watch = Stopwatch.StartNew();
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(settings.TimeoutSeconds));
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, deadline.Token);
        var failure = FailureKind.None; int? exit = null; string? output = null; string? outputHash = null;
        string? reportedModel = null; long? inputTokens = null; long? outputTokens = null; var phase = "version";
        var activityPath = settings.WorkerActivityPath ?? Path.Combine(attempt, "worker-active.json");
        RequireChildPath(settings.ControlRoot, activityPath);
        TimeSpan Remaining() => TimeSpan.FromSeconds(Math.Max(.01, settings.TimeoutSeconds - watch.Elapsed.TotalSeconds));
        async Task<ProcessCapture> Preflight(ProcessStartInfo info)
        {
            using var cap = CancellationTokenSource.CreateLinkedTokenSource(linked.Token); cap.CancelAfter(TimeSpan.FromSeconds(20));
            var capture = await RunProcessAsync(info, "", null, cap.Token, TimeSpan.FromSeconds(Math.Min(20, Remaining().TotalSeconds)), activityPath);
            if (capture.Cancelled || cap.IsCancellationRequested)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (deadline.IsCancellationRequested || watch.Elapsed.TotalSeconds >= settings.TimeoutSeconds) throw new OperationCanceledException(linked.Token);
                throw new ExecutionFailure(FailureKind.PreflightTimeout);
            }
            return capture;
        }
        try
        {
            var versionInfo = StartInfo(workspace); versionInfo.ArgumentList.Add("--version");
            var version = await Preflight(versionInfo);
            var cliVersion = version.Stdout.Trim();
            if (version.ExitCode != 0 || version.CaptureFailed || cliVersion != "codex-cli 0.155.1") throw new ExecutionFailure(FailureKind.Environment);
            var loginInfo = StartInfo(workspace);
            loginInfo.ArgumentList.Add("login"); loginInfo.ArgumentList.Add("status");
            phase = "login";
            var login = await Preflight(loginInfo);
            if (login.CaptureFailed) throw new ExecutionFailure(FailureKind.Environment);
            if (login.ExitCode != 0 || !(login.Stdout + login.Stderr).Contains("ChatGPT", StringComparison.OrdinalIgnoreCase) || (login.Stdout + login.Stderr).Contains("API key", StringComparison.OrdinalIgnoreCase))
                throw new ExecutionFailure(FailureKind.Authentication);
            var info = StartInfo(workspace);
            foreach (var arg in new[] { "exec", "--ignore-user-config", "--ignore-rules", "--strict-config", "--skip-git-repo-check", "--ephemeral", "--json", "--color", "never", "-C", workspace, "-m", settings.Model, "--output-schema", strictSchemaPath, "-o", Path.Combine(attempt, "result.pipe"), "-" }) info.ArgumentList.Add(arg);
            var config = RestrictedConfig(workspace);
            foreach (var (key, value) in config) { info.ArgumentList.Add("-c"); info.ArgumentList.Add(key + "=" + value); }
            var invocation = JsonSerializer.SerializeToNode(new
            {
                requestedModel = settings.Model, requestedEffort = "high", auth = "chatgpt", inputHash = Wire.Hash(request.Prompt), schemaHash = Wire.Hash(request.Schema),
                cli = settings.CodexPath, cliVersion, runnerAssemblyHash = Wire.HashFile(typeof(CodexExecutor).Assembly.Location), processHostHash = Wire.HashFile(Path.Combine(AppContext.BaseDirectory, "unix-process-host.py")), args = info.ArgumentList.ToArray(), config, environmentNames = info.Environment.Keys.Order().ToArray(), startedUtc = DateTimeOffset.UtcNow
            }, Wire.Json)!.AsObject();
            if (request.InputPolicy == WorkbenchInputPolicy.DevEquivalenceV2)
            {
                invocation["purpose"] = "dev-equivalence";
                invocation["inputPolicyVersion"] = "dev-equivalence-input-v2";
            }
            else if (request.InputPolicy is WorkbenchInputPolicy.PrivateAuthorSourceV1 or WorkbenchInputPolicy.PrivateCheckerSourceV1)
            {
                invocation["purpose"] = request.InputPolicy == WorkbenchInputPolicy.PrivateAuthorSourceV1 ? "private-author" : "private-checker";
                invocation["inputPolicyVersion"] = "private-source-input-v1";
            }
            Wire.AtomicJson(Path.Combine(attempt, "invocation.json"), invocation);
            phase = "execution";
            var capture = await RunProcessAsync(info, request.Prompt, attempt, linked.Token, Remaining(), activityPath);
            exit = capture.ExitCode;
            if (capture.LimitExceeded) throw new ExecutionFailure(FailureKind.Protocol);
            if (capture.Cancelled) throw new OperationCanceledException(linked.Token);
            if (capture.CaptureFailed) throw new ExecutionFailure(FailureKind.Environment);
            if (capture.ExitCode != 0) throw new ExecutionFailure(ClassifyProviderFailure(capture.Stdout + capture.Stderr, FailureKind.ProcessExit));
            var events = ParseEvents(capture.Stdout);
            if (events.Failure != FailureKind.None) throw new ExecutionFailure(ClassifyProviderFailure(capture.Stdout + capture.Stderr, events.Failure));
            reportedModel = events.Model; inputTokens = events.InputTokens; outputTokens = events.OutputTokens;
            var resultPath = Path.Combine(attempt, "result.tmp");
            if (!File.Exists(resultPath) || new FileInfo(resultPath).Length > 1_000_000) throw new ExecutionFailure(FailureKind.Protocol);
            output = await File.ReadAllTextAsync(resultPath, linked.Token);
            outputHash = Wire.HashFile(resultPath);
            JsonNode? result;
            try
            {
                result = JsonNode.Parse(output);
                if (result is not JsonObject || !JsonNode.DeepEquals(result, JsonNode.Parse(events.FinalMessage!))) throw new ExecutionFailure(FailureKind.Protocol);
            }
            catch (JsonException) { throw new ExecutionFailure(FailureKind.Protocol); }
            if (!schema.Evaluate(result, new EvaluationOptions { OutputFormat = OutputFormat.Flag }).IsValid) throw new ExecutionFailure(FailureKind.Schema);
            File.Move(resultPath, Path.Combine(attempt, "result.json")); Wire.PrivateFile(Path.Combine(attempt, "result.json"));
        }
        catch (ExecutionFailure e) { failure = e.Kind; }
        catch (OperationCanceledException) { failure = cancellationToken.IsCancellationRequested ? FailureKind.Cancelled : FailureKind.Timeout; }
        catch (Exception e) when (e is IOException or System.ComponentModel.Win32Exception or UnauthorizedAccessException) { failure = FailureKind.Environment; }
        catch (JsonException) { failure = FailureKind.Protocol; }
        catch (InvalidOperationException) { failure = FailureKind.Protocol; }
        catch (TimeoutException) { failure = FailureKind.Environment; }
        // Failed or partial results remain private evidence and are never returned as usable content.
        var temporaryResult = Path.Combine(attempt, "result.tmp");
        long? outputBytes = output is null ? null : Encoding.UTF8.GetByteCount(output);
        if (File.Exists(temporaryResult)) { var hash = Wire.BoundedHashFile(temporaryResult, 1_000_000, out var bytes); outputHash ??= hash; outputBytes = bytes; }
        var resultRecord = new ExecutionResult(failure == FailureKind.None, failure, exit, attempt, Wire.Hash(request.Prompt), Wire.Hash(request.Schema), outputHash,
            settings.Model, reportedModel, inputTokens, outputTokens, watch.ElapsedMilliseconds, failure == FailureKind.None ? output : null,
            File.Exists(Path.Combine(attempt, "events.jsonl")) ? Wire.HashFile(Path.Combine(attempt, "events.jsonl")) : null,
            File.Exists(Path.Combine(attempt, "stderr.log")) ? Wire.HashFile(Path.Combine(attempt, "stderr.log")) : null, outputBytes, phase);
        Wire.AtomicJson(Path.Combine(attempt, "execution.json"), resultRecord with { Output = null });
        if (!resultRecord.Success) Wire.AtomicJson(Path.Combine(attempt, "failure.json"), resultRecord with { Output = null });
        WorkbenchTelemetry.Record(activity, failure, watch.ElapsedMilliseconds);
        logger.LogInformation("Codex execution status={Status} failure={Failure} exit={ExitCode}", resultRecord.Success ? "success" : "failure", failure, exit);
        return resultRecord;
    }
    public static void RequireChildPath(string root, string candidate)
    {
        var relative = Path.GetRelativePath(Path.GetFullPath(root), Path.GetFullPath(candidate));
        if (relative == "." || relative == ".." || relative.StartsWith(".." + Path.DirectorySeparatorChar) || Path.IsPathFullyQualified(relative)) throw new ArgumentException("Evidence/workspace must be inside ControlRoot.");
        for (var p = new DirectoryInfo(candidate); p is not null; p = p.Parent)
            if (p.Exists && p.LinkTarget is not null) throw new ArgumentException("Evidence/workspace path contains a symlink.");
    }
    private ProcessStartInfo StartInfo(string workspace)
    {
        var info = new ProcessStartInfo(settings.CodexPath) { WorkingDirectory = workspace, UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        info.Environment.Clear();
        foreach (var name in EnvironmentAllowList) if (Environment.GetEnvironmentVariable(name) is { } value) info.Environment[name] = value;
        return info;
    }
    public static Dictionary<string, string> RestrictedConfig(string workspace)
    {
        var config = new Dictionary<string, string>
        {
            ["model_provider"] = "\"openai\"", ["forced_login_method"] = "\"chatgpt\"", ["model_reasoning_effort"] = "\"high\"", ["approval_policy"] = "\"never\"", ["default_permissions"] = "\"workbench\"",
            ["permissions.workbench.filesystem"] = "{\":root\"=\"deny\",\":minimal\"=\"read\"," + JsonSerializer.Serialize(workspace) + "=\"read\"}",
            ["permissions.workbench.network.enabled"] = "false", ["web_search"] = "\"disabled\"", ["project_doc_max_bytes"] = "0", ["mcp_servers"] = "{}",
            ["skills.bundled.enabled"] = "false", ["skills.include_instructions"] = "false", ["features.skip_host_skill_discovery"] = "true", ["suppress_unstable_features_warning"] = "true"
        };
        foreach (var flag in new[] { "shell_tool", "shell_snapshot", "apps", "plugins", "hooks", "multi_agent", "browser_use", "browser_use_external", "computer_use", "view_image", "memories", "skill_search", "request_permissions_tool", "unbounded_connection_retries" }) config["features." + flag] = "false";
        return config;
    }
    private sealed record ProcessCapture(int? ExitCode, string Stdout, string Stderr, bool Cancelled, bool LimitExceeded, bool CaptureFailed);
    private sealed record HostStatus(int? CliExitCode, string Reason);
    [DllImport("libc", SetLastError = true)]
    private static extern int kill(int pid, int signal);
    private static async Task<ProcessCapture> RunProcessAsync(ProcessStartInfo info, string input, string? directory, CancellationToken token, TimeSpan budget, string activityPath)
    {
        var hostScript = Path.Combine(AppContext.BaseDirectory, "unix-process-host.py");
        var identity = Guid.NewGuid().ToString("N"); var statusPath = activityPath + "." + identity + ".exit.json";
        if (File.Exists(activityPath)) throw new IOException("Worker lifecycle remains active or unresolved.");
        Wire.AtomicJson(activityPath, new { token = identity, phase = "starting" });
        var host = new ProcessStartInfo("/usr/bin/python3") { WorkingDirectory = info.WorkingDirectory, UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        host.Environment.Clear(); foreach (var pair in info.Environment) host.Environment[pair.Key] = pair.Value;
        foreach (var arg in new[] { "-I", "-u", hostScript, activityPath, identity, statusPath, budget.TotalSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture), directory is null ? "" : Path.Combine(directory, "result.tmp"), "--", info.FileName }) host.ArgumentList.Add(arg);
        foreach (var arg in info.ArgumentList) host.ArgumentList.Add(arg);
        Process child;
        try { child = Process.Start(host) ?? throw new IOException("Cannot start process host."); }
        catch { File.Delete(activityPath); throw; }
        using var childLifetime = child;
        var limit = false; var captureFailed = false;
        void Stop() { try { File.WriteAllText(statusPath + ".stop", "stop"); Wire.PrivateFile(statusPath + ".stop"); } catch (IOException) { } }
        void KillGroup()
        {
            try
            {
                using var state = JsonDocument.Parse(File.ReadAllText(activityPath));
                var record = state.RootElement;
                if (record.GetProperty("token").GetString() == identity && record.TryGetProperty("processGroup", out var group) && group.TryGetInt32(out var id) && id > 1) kill(-id, 9);
            }
            catch (Exception e) when (e is IOException or JsonException or InvalidOperationException) { }
        }
        using var registration = token.Register(Stop);
        async Task<string> Capture(StreamReader reader, string name)
        {
            var content = new StringBuilder();
            try
            {
                using var writer = directory is null ? null : new StreamWriter(new FileStream(Path.Combine(directory, name), FileMode.CreateNew, FileAccess.Write, FileShare.Read), new UTF8Encoding(false));
                if (directory is not null) Wire.PrivateFile(Path.Combine(directory, name));
                var buffer = new char[4096]; int n;
                while ((n = await reader.ReadAsync(buffer)) > 0)
                {
                    if (content.Length + n > 8_000_000) { limit = true; Stop(); break; }
                    content.Append(buffer, 0, n);
                    if (writer is not null) { await writer.WriteAsync(buffer.AsMemory(0, n)); await writer.FlushAsync(); }
                }
            }
            catch (Exception e) when (e is IOException or ObjectDisposedException or UnauthorizedAccessException) { captureFailed = true; Stop(); }
            return content.ToString();
        }
        var stdout = Capture(child.StandardOutput, "events.jsonl"); var stderr = Capture(child.StandardError, "stderr.log");
        try { await child.StandardInput.WriteAsync(input.AsMemory(), token); child.StandardInput.Close(); }
        catch (OperationCanceledException) { Stop(); }
        catch (IOException) { if (!token.IsCancellationRequested) captureFailed = true; Stop(); }
        try { await child.WaitForExitAsync().WaitAsync(budget + TimeSpan.FromSeconds(3)); }
        catch (TimeoutException)
        {
            captureFailed = true; Stop(); KillGroup();
            if (!child.HasExited) child.Kill();
            await child.WaitForExitAsync();
        }
        try { await Task.WhenAll(stdout, stderr).WaitAsync(TimeSpan.FromSeconds(2)); }
        catch (Exception e) when (e is IOException or TimeoutException or ObjectDisposedException)
        {
            captureFailed = true; KillGroup();
            child.StandardOutput.Dispose(); child.StandardError.Dispose();
        }
        var status = File.Exists(statusPath) ? JsonSerializer.Deserialize<HostStatus>(File.ReadAllText(statusPath), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) : null;
        return new(status?.CliExitCode, stdout.IsCompletedSuccessfully ? stdout.Result : "", stderr.IsCompletedSuccessfully ? stderr.Result : "",
            token.IsCancellationRequested || status?.Reason == "watchdog_timeout", limit || status?.Reason == "result_limit", captureFailed || status is null || status.Reason is "orphaned_descendants" or "cleanup_unknown" or "result_transport_changed");
    }
    private sealed class ExecutionFailure(FailureKind kind) : Exception { public FailureKind Kind { get; } = kind; }
    private sealed record EventSummary(FailureKind Failure, string? Model, long? InputTokens, long? OutputTokens, string? FinalMessage);
    private static EventSummary ParseEvents(string stdout)
    {
        var completed = 0; var failure = FailureKind.None; string? final = null; string? model = null; long? input = null; long? output = null;
        foreach (var line in stdout.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            using var doc = JsonDocument.Parse(line); var e = doc.RootElement;
            if (!e.TryGetProperty("type", out var t)) return new(FailureKind.Protocol, null, null, null, null);
            var type = t.GetString();
            if (type == "turn.completed")
            {
                completed++;
                if (e.TryGetProperty("usage", out var usage)) { input = Count(usage, "input_tokens"); output = Count(usage, "output_tokens"); }
                if (e.TryGetProperty("model", out var m) && m.ValueKind == JsonValueKind.String) model = m.GetString();
            }
            else if (type is "error" or "turn.failed") failure = FailureKind.Protocol;
            else if (type is not ("thread.started" or "turn.started" or "item.started" or "item.updated" or "item.completed")) failure = FailureKind.Protocol;
            if (e.TryGetProperty("item", out var item))
            {
                if (!item.TryGetProperty("type", out var it)) { failure = FailureKind.Protocol; continue; }
                var itemType = it.GetString();
                if (itemType is not ("agent_message" or "reasoning")) failure = itemType == "error" ? FailureKind.Protocol : FailureKind.ToolBoundary;
                if (type == "item.completed" && itemType == "agent_message" && item.TryGetProperty("text", out var text)) final = text.GetString();
            }
        }
        return new(completed == 1 && final is not null ? failure : FailureKind.Protocol, model, input, output, final);
    }
    private static long? Count(JsonElement usage, string name) => usage.TryGetProperty(name, out var count) && count.ValueKind == JsonValueKind.Number && count.TryGetInt64(out var value) && value >= 0 ? value : null;
    private static FailureKind ClassifyProviderFailure(string evidence, FailureKind fallback)
    {
        if (evidence.Contains("usage limit", StringComparison.OrdinalIgnoreCase) || evidence.Contains("quota", StringComparison.OrdinalIgnoreCase) || evidence.Contains("rate limit", StringComparison.OrdinalIgnoreCase)) return FailureKind.Quota;
        if (evidence.Contains("unauthorized", StringComparison.OrdinalIgnoreCase) || evidence.Contains("authentication", StringComparison.OrdinalIgnoreCase) || evidence.Contains("not logged in", StringComparison.OrdinalIgnoreCase)) return FailureKind.Authentication;
        return fallback;
    }
}
