using System.Buffers;
using System.Text;
using System.Text.Json;

namespace RecallSmith.Lambda.Common;

/// <summary>
/// One structured line per call: a single JSON object, <c>ts</c> first and <c>level</c>
/// second, written with one <see cref="TextWriter.WriteLine()"/> so a CloudWatch Logs
/// Insights query can index every field. Text log format is kept (E00 §6 #6) precisely so a
/// line that IS JSON is auto-indexed rather than wrapped as <c>{"message":"…"}</c>.
/// </summary>
/// <remarks>
/// The embedding rule (a lone JSON-object string argument is spread at the top level, not
/// nested under <c>msg</c>) is what keeps every caller that already hands this class a
/// serialised object -- Warmup's db-warmup line, Auth's auth line -- readable exactly as
/// before: their keys stay at the top level, so the tests that select on them keep working.
/// </remarks>
public static class Log
{
  // Read once, as before: the level is fixed for the life of the container.
  private static readonly string LogLevel =
    (Environment.GetEnvironmentVariable("LOG_LEVEL") ?? "info").Trim().ToLowerInvariant();

  /// <summary>
  /// Whether a line at <paramref name="level"/> is written: "debug" only when
  /// <c>LOG_LEVEL=debug</c>; "info" when debug|info; "warn"/"error" always; any other value
  /// is treated as "info".
  /// </summary>
  public static bool IsEnabled(string level)
  {
    var l = (level ?? string.Empty).Trim().ToLowerInvariant();
    return l switch
    {
      "debug" => LogLevel == "debug",
      "warn" => true,
      "error" => true,
      _ => LogLevel is "debug" or "info",
    };
  }

  public static void Debug(params object?[] args) => WriteArgs("debug", args);

  public static void Info(params object?[] args) => WriteArgs("info", args);

  public static void Warn(params object?[] args) => WriteArgs("warn", args);

  public static void Error(params object?[] args) => WriteArgs("error", args);

  /// <summary>
  /// Emits <paramref name="fields"/> as one line: an object's properties sit at the top level
  /// after <c>ts</c>/<c>level</c> (properties named <c>ts</c> or <c>level</c> are dropped --
  /// the prefix wins); a non-object is carried under <c>msg</c>. Gated by
  /// <see cref="IsEnabled"/> exactly like the named methods; warn/error go to stderr.
  /// </summary>
  public static void Event(string level, object fields)
  {
    var lvl = (level ?? string.Empty).Trim().ToLowerInvariant();
    if (!IsEnabled(lvl)) return;

    var stream = lvl is "warn" or "error" ? Console.Error : Console.Out;
    try
    {
      var element = JsonSerializer.SerializeToElement(fields);
      var line = Build(lvl, writer =>
      {
        if (element.ValueKind == JsonValueKind.Object)
        {
          Embed(writer, element);
        }
        else
        {
          writer.WriteString("msg", element.GetRawText());
        }
      });
      stream.WriteLine(line);
    }
    catch
    {
      Fallback();
    }
  }

  // ------------------------------------------------------------------ internals

  private static void WriteArgs(string level, object?[] args)
  {
    if (!IsEnabled(level)) return;

    // Evaluate the stream at call time so a test that has redirected Console still captures it.
    var stream = level is "warn" or "error" ? Console.Error : Console.Out;
    try
    {
      var line = Build(level, writer =>
      {
        if (args.Length == 1 && args[0] is string s && TryParseObject(s, out var doc))
        {
          using (doc)
          {
            Embed(writer, doc.RootElement);
          }
        }
        else
        {
          writer.WriteString("msg", Join(args));
        }
      });
      stream.WriteLine(line);
    }
    catch
    {
      Fallback();
    }
  }

  private static string Build(string level, Action<Utf8JsonWriter> writeBody)
  {
    var buffer = new ArrayBufferWriter<byte>();
    using (var writer = new Utf8JsonWriter(buffer))
    {
      writer.WriteStartObject();
      // ISO-8601, UTC, ends in "Z"; the writer escapes any newline in a value so a stack
      // trace stays on one line.
      writer.WriteString("ts", DateTime.UtcNow.ToString("o"));
      writer.WriteString("level", level);
      writeBody(writer);
      writer.WriteEndObject();
    }

    return Encoding.UTF8.GetString(buffer.WrittenSpan);
  }

  private static void Embed(Utf8JsonWriter writer, JsonElement obj)
  {
    foreach (var prop in obj.EnumerateObject())
    {
      if (prop.NameEquals("ts") || prop.NameEquals("level")) continue;
      prop.WriteTo(writer);
    }
  }

  private static bool TryParseObject(string s, out JsonDocument doc)
  {
    doc = null!;
    var t = s.Trim();
    if (t.Length < 2 || t[0] != '{' || t[^1] != '}') return false;
    try
    {
      var parsed = JsonDocument.Parse(s);
      if (parsed.RootElement.ValueKind == JsonValueKind.Object)
      {
        doc = parsed;
        return true;
      }
      parsed.Dispose();
      return false;
    }
    catch
    {
      return false;
    }
  }

  private static string Join(object?[] args)
  {
    if (args.Length == 0) return string.Empty;
    return string.Join(" ", args.Select(a => a?.ToString() ?? "null"));
  }

  private static void Fallback()
  {
    try
    {
      Console.Error.WriteLine(
        "{\"ts\":\"" + DateTime.UtcNow.ToString("o") + "\",\"level\":\"error\",\"msg\":\"log serialisation failed\"}");
    }
    catch
    {
      // Nothing left to do: the instrument must never fault the caller.
    }
  }
}
