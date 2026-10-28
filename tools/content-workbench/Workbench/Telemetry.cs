using System.Diagnostics;
using System.Diagnostics.Metrics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Console;
using OpenTelemetry;
using OpenTelemetry.Logs;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

namespace ContentWorkbench;

public static class WorkbenchTelemetry
{
    public const string Name = "RecallSmith.ContentWorkbench";
    public static readonly ActivitySource Activities = new(Name, "1.0.0");
    public static readonly Meter Meter = new(Name, "1.0.0");
    public static readonly Counter<long> Executions = Meter.CreateCounter<long>("workbench.executions");
    public static readonly Histogram<double> Duration = Meter.CreateHistogram<double>("workbench.execution.duration", "ms");
    public static void AddTelemetry(HostApplicationBuilder builder, WorkbenchOptions options)
    {
        Wire.PrivateDirectory(options.ControlRoot);
        var traces = Path.Combine(options.ControlRoot, "traces.jsonl");
        builder.Logging.ClearProviders();
        builder.Logging.AddSimpleConsole(x => x.SingleLine = true);
        builder.Services.Configure<ConsoleLoggerOptions>(x => x.LogToStandardErrorThreshold = LogLevel.Trace);
        builder.Logging.AddFilter("Microsoft.Hosting.Lifetime", LogLevel.Warning);
        builder.Services.AddOpenTelemetry().ConfigureResource(x => x.AddService(Name))
            .WithTracing(x =>
            {
                x.AddSource(Name).AddProcessor(new SimpleActivityExportProcessor(new LocalTraceExporter(traces)));
                if (options.OtlpEndpoint is { } endpoint) x.AddOtlpExporter(o => o.Endpoint = new Uri(endpoint));
            })
            .WithMetrics(x =>
            {
                x.AddMeter(Name);
                if (options.OtlpEndpoint is { } endpoint) x.AddOtlpExporter(o => o.Endpoint = new Uri(endpoint));
            });
        if (options.OtlpEndpoint is { } logEndpoint)
            builder.Logging.AddOpenTelemetry(x => { x.IncludeFormattedMessage = false; x.IncludeScopes = false; x.AddOtlpExporter(o => o.Endpoint = new Uri(logEndpoint)); });
    }
    public static void Record(Activity? activity, FailureKind failure, long elapsedMs)
    {
        var status = failure == FailureKind.None ? "success" : "failure";
        var category = failure.ToString().ToLowerInvariant();
        activity?.SetTag("workbench.status", status);
        activity?.SetTag("workbench.failure", category);
        activity?.SetStatus(failure == FailureKind.None ? ActivityStatusCode.Ok : ActivityStatusCode.Error);
        var tags = new TagList { { "status", status }, { "failure", category } };
        Executions.Add(1, tags); Duration.Record(elapsedMs, tags);
    }
}

public sealed class LocalTraceExporter(string path) : BaseExporter<Activity>
{
    private readonly object gate = new();
    public override ExportResult Export(in Batch<Activity> batch)
    {
        lock (gate)
        {
            using var writer = new StreamWriter(new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read));
            Wire.PrivateFile(path);
            foreach (var a in batch)
                writer.WriteLine(System.Text.Json.JsonSerializer.Serialize(new
                {
                    traceId = a.TraceId.ToString(), spanId = a.SpanId.ToString(), parentSpanId = a.ParentSpanId.ToString(), operation = a.OperationName,
                    startedUtc = a.StartTimeUtc, elapsedMs = a.Duration.TotalMilliseconds, status = a.Status.ToString(),
                    tags = a.TagObjects.Where(t => t.Key is "workbench.status" or "workbench.failure").ToDictionary(t => t.Key, t => t.Value)
                }));
        }
        return ExportResult.Success;
    }
}
