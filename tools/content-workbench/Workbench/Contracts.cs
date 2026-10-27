using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Json.Schema;

namespace ContentWorkbench;

public sealed class WorkbenchOptions
{
    public string ControlRoot { get; set; } = "";
    public string CodexPath { get; set; } = "/opt/homebrew/bin/codex";
    public string? AttemptDirectory { get; set; }
    public string? WorkspaceRoot { get; set; }
    public string? WorkerActivityPath { get; set; }
    public string Model { get; set; } = "gpt-6-sol";
    public int TimeoutSeconds { get; set; } = 300;
    public string? OtlpEndpoint { get; set; }
    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(ControlRoot) || !Path.IsPathFullyQualified(ControlRoot)) throw new ArgumentException("An absolute ControlRoot is required.");
        if (!Path.IsPathFullyQualified(CodexPath)) throw new ArgumentException("CodexPath must be absolute.");
        if (Model != "gpt-6-sol") throw new ArgumentException("Only the verified gpt-6-sol/high subscription route is enabled.");
        if (TimeoutSeconds is < 1 or > 300) throw new ArgumentException("TimeoutSeconds must be between 1 and 300.");
        if (OtlpEndpoint is not null && (!Uri.TryCreate(OtlpEndpoint, UriKind.Absolute, out var uri) || !uri.IsLoopback || uri.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query)))
            throw new ArgumentException("OTLP must use a local loopback HTTP(S) endpoint without credentials/query.");
    }
}

public enum FailureKind { None, Cancelled, Timeout, PreflightTimeout, Authentication, Quota, Environment, ProcessExit, Protocol, Schema, ToolBoundary }
public sealed record FrozenRequest(string Prompt, string Schema);
public sealed record ExecutionResult(bool Success, FailureKind Failure, int? ExitCode, string AttemptDirectory,
    string InputHash, string SchemaHash, string? OutputHash, string RequestedModel, string? ReportedModel,
    long? InputTokens, long? OutputTokens, long ElapsedMs, string? Output, string? EventsHash = null, string? StderrHash = null, long? OutputBytes = null, string? Phase = null);
public interface ICodexExecutor
{
    Task<ExecutionResult> ExecuteAsync(FrozenRequest request, CancellationToken cancellationToken = default);
}
public sealed class ModelExecutionException(ExecutionResult result) : Exception($"Codex execution failed: {result.Failure}")
{
    public ExecutionResult Result { get; } = result;
}
public static class Wire
{
    public static readonly JsonSerializerOptions Json = new() { WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase, Converters = { new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower) } };
    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    public static string HashFile(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }
    public static string? BoundedHashFile(string path, long maximumBytes, out long bytes)
    {
        using var stream = File.OpenRead(path); bytes = stream.Length;
        if (bytes > maximumBytes) return null;
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[8192]; long consumed = 0; int count;
        while ((count = stream.Read(buffer)) > 0)
        {
            consumed += count;
            if (consumed > maximumBytes) { bytes = Math.Max(stream.Length, consumed); return null; }
            hash.AppendData(buffer, 0, count);
        }
        bytes = consumed; return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }
    public static void PrivateDirectory(string path)
    {
        Directory.CreateDirectory(path);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
    }
    public static void PrivateFile(string path)
    {
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
    }
    public static void AtomicJson<T>(string path, T value)
    {
        var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var f = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                PrivateFile(temp);
                JsonSerializer.Serialize(f, value, Json); f.Flush(flushToDisk: true);
            }
            File.Move(temp, path, overwrite: true);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
    public static JsonSchema ParseSchema(string text)
    {
        if (text.Length > 60_000) throw new ArgumentException("Schema exceeds budget.");
        using var doc = JsonDocument.Parse(text);
        if (doc.RootElement.ValueKind != JsonValueKind.Object) throw new ArgumentException("Schema must be an object.");
        CheckSchema(doc.RootElement);
        return JsonSchema.FromText(text);
    }
    private static void CheckSchema(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in value.EnumerateObject())
            {
                if (property.Name is "$ref" or "$dynamicRef" && property.Value.ValueKind == JsonValueKind.String && !property.Value.GetString()!.StartsWith('#'))
                    throw new ArgumentException("Remote schema references are disabled.");
                if (property.Name is "$id") throw new ArgumentException("External schema identifiers are disabled.");
                CheckSchema(property.Value);
            }
        }
        else if (value.ValueKind == JsonValueKind.Array) foreach (var item in value.EnumerateArray()) CheckSchema(item);
    }
}
