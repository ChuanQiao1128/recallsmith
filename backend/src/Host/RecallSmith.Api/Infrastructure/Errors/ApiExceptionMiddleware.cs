using System;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Infrastructure.Errors;

public class ApiExceptionMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ApiExceptionMiddleware> _logger;

    public ApiExceptionMiddleware(RequestDelegate next, ILogger<ApiExceptionMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        // ASP.NET Core 自动给每个请求一个 TraceIdentifier
        string traceId = context.TraceIdentifier;

        try
        {
            await _next(context);
        }
        catch (Exception ex)
        {
            // 1. 记录日志
            _logger.LogError(ex, "Unhandled exception, traceId = {TraceId}", traceId);

            // 2. 如果响应还没开始写，就用统一格式返回 500
            if (!context.Response.HasStarted)
            {
                context.Response.Clear();
                context.Response.StatusCode = StatusCodes.Status500InternalServerError;
                context.Response.ContentType = "application/json";

                var result = ApiResult<object>.Fail(
                    code: "ServerError",
                    message: "Unexpected server error. Please contact support with traceId.",
                    traceId: traceId
                );

                var json = JsonSerializer.Serialize(
                    result,
                    new JsonSerializerOptions
                    {
                        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
                    });

                await context.Response.WriteAsync(json);
            }
            else
            {
                // 已经开始写响应了，就不能再改 body，只能往日志里记
                _logger.LogWarning("Response has already started, cannot write error body. traceId = {TraceId}", traceId);
            }
        }
    }
}