using System.Text.Json;
using System.Text.Json.Serialization;
using Authoring.Core.Common;
using Microsoft.AspNetCore.Mvc;

namespace RecallSmith.Api.Config;

/// <summary>
/// Extension methods for configuring MVC services
/// </summary>
public static class MvcExtensions
{
#pragma warning disable CS1591 // Missing XML comment for publicly visible type or member
    public static IServiceCollection AddCustomControllers(this IServiceCollection services)
#pragma warning restore CS1591 // Missing XML comment for publicly visible type or member
    {
        services.AddControllers(options =>
        {
            options.Filters.Add<RecallSmith.Api.Filters.ApiExceptionFilter>();
        })
        .AddJsonOptions(o =>
        {
            o.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
            o.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
        });

        // 把 ModelState 验证错误也统一为 ApiResult
        services.Configure<ApiBehaviorOptions>(opt =>
        {
            opt.InvalidModelStateResponseFactory = ctx =>
            {
                var errors = ctx.ModelState
                    .Where(kv => kv.Value is { Errors.Count: > 0 })
                    .ToDictionary(
                        kv => kv.Key,
                        kv => kv.Value!.Errors.Select(e => e.ErrorMessage).ToArray()
                    );

                var result = ApiResult<object>.Fail(
                    ErrorCodes.Common.Validation,
                    "Validation failed.",
                    new { errors },
                    ctx.HttpContext.TraceIdentifier
                );
                return new BadRequestObjectResult(result);
            };
        });

        return services;
    }
}