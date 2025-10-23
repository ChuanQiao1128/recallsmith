using Authoring.Core.Common;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace RecallSmith.Api.Filters;

/// <summary>
/// 捕获未处理异常，统一输出 ApiResult（并维持合适的 HTTP Status）
/// </summary>
public class ApiExceptionFilter : IExceptionFilter
{
    private readonly ILogger<ApiExceptionFilter> _logger;
    public ApiExceptionFilter(ILogger<ApiExceptionFilter> logger) => _logger = logger;

    public void OnException(ExceptionContext context)
    {
        var traceId = context.HttpContext.TraceIdentifier;

        if (context.Exception is AppException appEx)
        {
            var result = ApiResult<object>.Fail(appEx.Code, appEx.Message, appEx.Details, traceId);
            context.Result = new ObjectResult(result) { StatusCode = (int)appEx.Status };
            context.ExceptionHandled = true;
            return;
        }

        _logger.LogError(context.Exception, "Unhandled exception: {TraceId}", traceId);

        var fallback = ApiResult<object>.Fail(ErrorCodes.Common.Unexpected, "Unexpected server error.", null, traceId);
        context.Result = new ObjectResult(fallback) { StatusCode = StatusCodes.Status500InternalServerError };
        context.ExceptionHandled = true;
    }
}