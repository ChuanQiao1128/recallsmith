namespace RecallSmith.Lambda.Common;

public static class Log
{
  private static readonly string LogLevel =
    (Environment.GetEnvironmentVariable("LOG_LEVEL") ?? "info").Trim().ToLowerInvariant();

  private static string Join(object?[] args)
  {
    if (args.Length == 0) return string.Empty;
    return string.Join(" ", args.Select(a => a?.ToString() ?? "null"));
  }

  public static void Debug(params object?[] args)
  {
    if (LogLevel == "debug") Console.WriteLine(Join(args));
  }

  public static void Info(params object?[] args)
  {
    if (LogLevel is "debug" or "info") Console.WriteLine(Join(args));
  }

  public static void Warn(params object?[] args)
  {
    Console.Error.WriteLine(Join(args));
  }

  public static void Error(params object?[] args)
  {
    Console.Error.WriteLine(Join(args));
  }
}

