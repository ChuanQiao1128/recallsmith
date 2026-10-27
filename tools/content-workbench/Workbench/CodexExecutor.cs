using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
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
        if (string.IsNullOrWhiteSpace(request.Prompt) || request.Prompt.Length > 60_000) throw new ArgumentException("Frozen input must contain 1..60000 characters.");
        var schema = Wire.ParseSchema(request.Schema);
        var attempt = settings.AttemptDirectory ?? Path.Combine(settings.ControlRoot, "attempts", Guid.NewGuid().ToString("N"));
        RequireChildPath(settings.ControlRoot, attempt);
        if (Directory.Exists(attempt) || File.Exists(attempt)) throw new IOException("Attempt directory already exists; preserve evidence and reconcile instead of overwriting.");
        Wire.PrivateDirectory(attempt);
        var workspace = settings.WorkspaceRoot is { } workspaceRoot ? Path.Combine(workspaceRoot, Guid.NewGuid().ToString("N")) : Path.Combine(attempt, "workspace");
        RequireChildPath(settings.ControlRoot, workspace); Wire.PrivateDirectory(workspace);
        var schemaPath = Path.Combine(attempt, "schema.json");
        await File.WriteAllTextAsync(schemaPath, request.Schema, cancellationToken); Wire.PrivateFile(schemaPath);
        using var activity = WorkbenchTelemetry.Activities.StartActivity("codex.execute");
        var watch = Stopwatch.StartNew();
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(settings.TimeoutSeconds));
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, deadline.Token);
        var failure = FailureKind.None; int? exit = null; string? output = null; string? outputHash = null;
        string? reportedModel = null; long? inputTokens = null; long? outputTokens = null;
        try
        {
            var versionInfo = StartInfo(workspace); versionInfo.ArgumentList.Add("--version");
            using var versionLimit = CancellationTokenSource.CreateLinkedTokenSource(linked.Token); versionLimit.CancelAfter(TimeSpan.FromSeconds(20));
            var version = await RunProcessAsync(versionInfo, "", null, versionLimit.Token);
            var cliVersion = version.Stdout.Trim();
            if (version.ExitCode != 0 || version.CaptureFailed || cliVersion != "codex-cli 0.155.1") throw new ExecutionFailure(FailureKind.Environment);
            var loginInfo = StartInfo(workspace);
            loginInfo.ArgumentList.Add("login"); loginInfo.ArgumentList.Add("status");
            using var loginLimit = CancellationTokenSource.CreateLinkedTokenSource(linked.Token); loginLimit.CancelAfter(TimeSpan.FromSeconds(20));
            ProcessCapture login;
            try { login = await RunProcessAsync(loginInfo, "", null, loginLimit.Token); }
            catch (OperationCanceledException) when (!linked.IsCancellationRequested) { throw new ExecutionFailure(FailureKind.Environment); }
            if (login.CaptureFailed) throw new ExecutionFailure(FailureKind.Environment);
            if (login.ExitCode != 0 || !(login.Stdout + login.Stderr).Contains("ChatGPT", StringComparison.OrdinalIgnoreCase) || (login.Stdout + login.Stderr).Contains("API key", StringComparison.OrdinalIgnoreCase))
                throw new ExecutionFailure(FailureKind.Authentication);
            var info = StartInfo(workspace);
            foreach (var arg in new[] { "exec", "--ignore-user-config", "--ignore-rules", "--strict-config", "--skip-git-repo-check", "--ephemeral", "--json", "--color", "never", "-C", workspace, "-m", settings.Model, "--output-schema", schemaPath, "-o", Path.Combine(attempt, "result.tmp"), "-" }) info.ArgumentList.Add(arg);
            var config = RestrictedConfig(workspace);
            foreach (var (key, value) in config) { info.ArgumentList.Add("-c"); info.ArgumentList.Add(key + "=" + value); }
            Wire.AtomicJson(Path.Combine(attempt, "invocation.json"), new
            {
                requestedModel = settings.Model, requestedEffort = "high", auth = "chatgpt", inputHash = Wire.Hash(request.Prompt), schemaHash = Wire.Hash(request.Schema),
                cli = settings.CodexPath, cliVersion, runnerAssemblyHash = Wire.HashFile(typeof(CodexExecutor).Assembly.Location), args = info.ArgumentList.ToArray(), config, environmentNames = info.Environment.Keys.Order().ToArray(), startedUtc = DateTimeOffset.UtcNow
            });
            var capture = await RunProcessAsync(info, request.Prompt, attempt, linked.Token);
            exit = capture.ExitCode;
            if (capture.CaptureFailed) throw new ExecutionFailure(FailureKind.Environment);
            if (capture.Cancelled) throw new OperationCanceledException(linked.Token);
            if (capture.LimitExceeded) throw new ExecutionFailure(FailureKind.Protocol);
            if (capture.ExitCode != 0) throw new ExecutionFailure(ClassifyProviderFailure(capture.Stdout + capture.Stderr, FailureKind.ProcessExit));
            var events = ParseEvents(capture.Stdout);
            if (events.Failure != FailureKind.None) throw new ExecutionFailure(ClassifyProviderFailure(capture.Stdout + capture.Stderr, events.Failure));
            reportedModel = events.Model; inputTokens = events.InputTokens; outputTokens = events.OutputTokens;
            var resultPath = Path.Combine(attempt, "result.tmp");
            if (!File.Exists(resultPath) || new FileInfo(resultPath).Length > 1_000_000) throw new ExecutionFailure(FailureKind.Protocol);
            output = await File.ReadAllTextAsync(resultPath, linked.Token);
            outputHash = Wire.Hash(output);
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
        if (outputHash is null && File.Exists(temporaryResult)) outputHash = Wire.HashFile(temporaryResult);
        var resultRecord = new ExecutionResult(failure == FailureKind.None, failure, exit, attempt, Wire.Hash(request.Prompt), Wire.Hash(request.Schema), outputHash,
            settings.Model, reportedModel, inputTokens, outputTokens, watch.ElapsedMilliseconds, failure == FailureKind.None ? output : null,
            File.Exists(Path.Combine(attempt, "events.jsonl")) ? Wire.HashFile(Path.Combine(attempt, "events.jsonl")) : null,
            File.Exists(Path.Combine(attempt, "stderr.log")) ? Wire.HashFile(Path.Combine(attempt, "stderr.log")) : null);
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
    private sealed record ProcessCapture(int ExitCode, string Stdout, string Stderr, bool Cancelled, bool LimitExceeded, bool CaptureFailed);
    private static async Task<ProcessCapture> RunProcessAsync(ProcessStartInfo info, string input, string? directory, CancellationToken token)
    {
        using var child = Process.Start(info) ?? throw new IOException("Cannot start CLI.");
        var cancelled = false; var limit = false; var captureFailed = false;
        void Kill() { try { if (!child.HasExited) child.Kill(entireProcessTree: true); } catch (InvalidOperationException) { } }
        using var registration = token.Register(Kill);
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
                    if (content.Length + n > 8_000_000) { limit = true; Kill(); break; }
                    content.Append(buffer, 0, n);
                    if (writer is not null) { await writer.WriteAsync(buffer.AsMemory(0, n)); await writer.FlushAsync(); }
                }
            }
            catch (Exception e) when (e is IOException or ObjectDisposedException or UnauthorizedAccessException) { captureFailed = true; Kill(); }
            return content.ToString();
        }
        var stdout = Capture(child.StandardOutput, "events.jsonl"); var stderr = Capture(child.StandardError, "stderr.log");
        try { await child.StandardInput.WriteAsync(input.AsMemory(), token); child.StandardInput.Close(); await child.WaitForExitAsync(token); }
        catch (OperationCanceledException) { cancelled = true; Kill(); }
        catch (IOException) { Kill(); captureFailed = !token.IsCancellationRequested; cancelled = token.IsCancellationRequested; }
        finally { if (!child.HasExited) { Kill(); await child.WaitForExitAsync(); } }
        try { await Task.WhenAll(stdout, stderr).WaitAsync(TimeSpan.FromSeconds(10)); }
        catch (Exception e) when (e is IOException or TimeoutException or ObjectDisposedException) { captureFailed = true; Kill(); }
        return new(child.ExitCode, stdout.IsCompletedSuccessfully ? stdout.Result : "", stderr.IsCompletedSuccessfully ? stderr.Result : "", cancelled || token.IsCancellationRequested, limit, captureFailed);
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
