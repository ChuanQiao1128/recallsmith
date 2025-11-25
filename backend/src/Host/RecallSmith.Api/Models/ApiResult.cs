namespace RecallSmith.Api.Models;

// 错误信息结构
public class ApiError
{
    public string Code { get; set; } = null!;
    public string Message { get; set; } = null!;
}

// 统一响应结构：泛型 T 表示 data 类型
public class ApiResult<T>
{
    public bool Success { get; set; }
    public T? Data { get; set; }
    public ApiError? Error { get; set; }
    public string TraceId { get; set; } = null!;

    // 下面是两个“工厂方法”，方便构造成功/失败响应

    public static ApiResult<T> Ok(T data, string traceId)
    {
        return new ApiResult<T>
        {
            Success = true,
            Data = data,
            Error = null,
            TraceId = traceId
        };
    }

    public static ApiResult<T> Fail(string code, string message, string traceId)
    {
        return new ApiResult<T>
        {
            Success = false,
            Data = default,
            Error = new ApiError
            {
                Code = code,
                Message = message
            },
            TraceId = traceId
        };
    }
}