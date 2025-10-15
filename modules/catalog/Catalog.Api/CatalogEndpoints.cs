using System;
using System.Collections.Generic;
using System.Threading;
using Catalog.Application;
using Catalog.Infrastructure;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Catalog.Api;

public static class CatalogEndpoints
{
    // 1) 模块服务注册（将 Application 抽象绑定到 Infrastructure 实现）
    public static IServiceCollection AddCatalogModule(this IServiceCollection services, IConfiguration cfg)
    {
        services.AddScoped<ICatalogAdminService, CatalogAdminService>();
        return services;
    }

    // 2) Admin 端点（真实实现，调用 ICatalogAdminService）
    public static IEndpointRouteBuilder MapCatalogAdminEndpoints(this IEndpointRouteBuilder app, string basePath)
    {
        var g = app.MapGroup(basePath).WithTags("Admin/Catalog");

        // CreateDeck
        g.MapPost("/decks", async (CreateDeckRequest req, ICatalogAdminService svc, CancellationToken ct) =>
        {
            var res = await svc.CreateDeckAsync(new CreateDeckCmd(req.Slug, req.Title, req.Locale), ct);
            return Results.Created($"/api/admin/v1/decks/{res.DeckId}", new CreateDeckResponse(res.DeckId));
        })
        .WithName("CreateDeck")
        .Produces<CreateDeckResponse>(StatusCodes.Status201Created)
        .ProducesProblem(StatusCodes.Status409Conflict)
        .ProducesProblem(StatusCodes.Status422UnprocessableEntity);

        // CreateDraftCard
        g.MapPost("/decks/{deckId:guid}/cards", async (Guid deckId, CreateDraftCardRequest req, ICatalogAdminService svc, CancellationToken ct) =>
        {
            var res = await svc.CreateDraftCardAsync(new CreateDraftCardCmd(
                deckId, req.StableUid, req.FrontMd, req.BackMd, req.KeyPoint, req.Tags, req.Difficulty), ct);
            return Results.Created($"/api/admin/v1/decks/{deckId}/cards/{res.CardId}",
                new CreateDraftCardResponse(res.CardId, res.StableUid));
        })
        .WithName("CreateDraftCard")
        .Produces<CreateDraftCardResponse>(StatusCodes.Status201Created)
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict)
        .ProducesProblem(StatusCodes.Status422UnprocessableEntity);

        // Publish
        g.MapPost("/decks/{deckId:guid}/publish", async (Guid deckId, PublishDeckRequest req, ICatalogAdminService svc, CancellationToken ct) =>
        {
            var res = await svc.PublishDeckAsync(new PublishDeckCmd(deckId, req.Version, req.Changelog), ct);
            return Results.Ok(new PublishDeckResponse(res.Version, res.TotalCards, res.PublishedAt));
        })
        .WithName("PublishDeck")
        .Produces<PublishDeckResponse>(StatusCodes.Status200OK)
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict)
        .ProducesProblem(StatusCodes.Status422UnprocessableEntity);

        return app;
    }

    // 3) Public 端点（保持与 Program.cs 一致；先提供一个可用占位）
    public static IEndpointRouteBuilder MapCatalogPublicEndpoints(this IEndpointRouteBuilder app, string basePath)
    {
        var g = app.MapGroup(basePath).WithTags("Catalog/Public");
        g.MapGet("/decks/ping", () => Results.Ok(new { mod = "catalog", scope = "public" }));
        return app;
    }

    // === DTO（仅为 Swagger 推断；后续可迁移到 contracts/Dtos）===
    public record CreateDeckRequest(string Slug, string Title, string? Locale);
    public record CreateDeckResponse(Guid DeckId);

    public record CreateDraftCardRequest(
        string StableUid, string FrontMd, string BackMd, string KeyPoint,
        List<string>? Tags, string? Difficulty);
    public record CreateDraftCardResponse(Guid CardId, string StableUid);

    public record PublishDeckRequest(string Version, string? Changelog);
    public record PublishDeckResponse(string Version, int TotalCards, DateTimeOffset PublishedAt);
}