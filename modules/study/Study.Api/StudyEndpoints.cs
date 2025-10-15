using System;
using System.Threading;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Study.Application;
using Study.Infrastructure;

namespace Study.Api;

public static class StudyEndpoints
{
    // 注册应用服务
    public static IServiceCollection AddStudyModule(this IServiceCollection services, IConfiguration cfg)
    {
        // 单例复用内部创建的 NpgsqlDataSource（连接池）
        services.AddSingleton<IStudyApplyService, StudyApplyService>();
        return services;
    }

    // 用户端 API
    public static IEndpointRouteBuilder MapStudyUserEndpoints(this IEndpointRouteBuilder app, string basePath)
    {
        var g = app.MapGroup(basePath).WithTags("User/Study");

        // /api/user/v1/decks/apply
        g.MapPost("/decks/apply", async (ApplyDeckRequest req, IStudyApplyService svc, CancellationToken ct) =>
        {
            var res = await svc.ApplyDeckAsync(new ApplyDeckCmd(req.UserId, req.CatalogDeckId, req.TargetVersion), ct);
            return Results.Ok(new ApplyDeckResponse(res.UserDeckId, res.Version, res.Added, res.Updated));
        })
        .WithName("ApplyDeck")
        .Produces<ApplyDeckResponse>(StatusCodes.Status200OK)
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict)
        .ProducesProblem(StatusCodes.Status422UnprocessableEntity);

        return app;
    }

    // === DTO（用于 Swagger 推断；后续可迁到 contracts/Dtos）===
    public record ApplyDeckRequest(Guid UserId, Guid CatalogDeckId, string? TargetVersion);
    public record ApplyDeckResponse(Guid UserDeckId, string Version, int Added, int Updated);
}