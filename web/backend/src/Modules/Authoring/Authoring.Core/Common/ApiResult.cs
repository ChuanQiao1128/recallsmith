namespace Authoring.Core.Common;

public sealed record ApiResult<T>(
    bool Success,
    T? Data,
    ApiError? Error,
    string? TraceId
)
{
    public static ApiResult<T> SuccessResult(T data, string? traceId = null)
        => new(true, data, null, traceId);

    public static ApiResult<T> Fail(string code, string message, object? details = null, string? traceId = null)
        => new(false, default, new ApiError(code, message, details), traceId);
}

public sealed record ApiError(string Code, string Message, object? Details);