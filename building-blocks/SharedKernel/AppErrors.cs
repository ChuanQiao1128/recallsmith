namespace SharedKernel;

public enum ErrorCode
{
    Validation, NotFound, Conflict, Unexpected
}

public sealed class AppException : Exception
{
    public ErrorCode Code { get; }
    public AppException(ErrorCode code, string message) : base(message) => Code = code;

    public static AppException Validation(string msg) => new(ErrorCode.Validation, msg);
    public static AppException NotFound(string msg) => new(ErrorCode.NotFound, msg);
    public static AppException Conflict(string msg) => new(ErrorCode.Conflict, msg);
    public static AppException Unexpected(string msg) => new(ErrorCode.Unexpected, msg);
}