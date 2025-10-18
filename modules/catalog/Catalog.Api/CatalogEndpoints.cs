// modules/catalog/Catalog.Api/CatalogEndpoints.cs
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Catalog.Application;
using Catalog.Infrastructure;               // <- 用到 CatalogAdminService / QueryService
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;           // <- StatusCodes / Results
using Microsoft.AspNetCore.Mvc;            // <- [FromQuery]
using Microsoft.AspNetCore.Routing;        // <- IEndpointRouteBuilder
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Catalog.Api;

public static class CatalogEndpoints
{
    // 注册 Catalog 模块（Admin 写 + 查询服务可 Mock/Real）
    public static IServiceCollection AddCatalogModule(this IServiceCollection services, IConfiguration cfg)
    {
        // Admin 写服务（此前你已有）
        services.AddScoped<ICatalogAdminService, CatalogAdminService>();

        // 查询服务（先用 Mock 驱动前端；准备好后把 Features:MockQueries 设为 false 走真实 SQL）
        var useMock = cfg.GetValue<bool>("Features:MockQueries", true);
        if (useMock)
            services.AddSingleton<ICatalogQueryService, MockCatalogQueryService>();
        else
            services.AddScoped<ICatalogQueryService, CatalogQueryService>();

        // 注意：NpgsqlDataSource 的注册由 apps/api/Program.cs 的 AddPostgres 完成
        return services;
    }

    // === Admin 写接口（已在你之前跑通过）===
    public static IEndpointRouteBuilder MapCatalogAdminEndpoints(this IEndpointRouteBuilder app, string basePath)
    {
        var g = app.MapGroup(basePath).WithTags("Admin/Catalog");

        // 1) CreateDeck
        g.MapPost("/decks", async (CreateDeckRequest req, ICatalogAdminService svc, CancellationToken ct) =>
        {
            var res = await svc.CreateDeckAsync(new CreateDeckCmd(req.Slug, req.Title, req.Locale), ct);
            return Results.Created($"/api/admin/v1/decks/{res.DeckId}", new CreateDeckResponse(res.DeckId));
        })
        .WithName("CreateDeck")
        .Produces<CreateDeckResponse>(StatusCodes.Status201Created)
        .ProducesProblem(StatusCodes.Status409Conflict)
        .ProducesProblem(StatusCodes.Status422UnprocessableEntity);

        // 2) CreateDraftCard
        g.MapPost("/decks/{deckId:guid}/cards", async (Guid deckId, CreateDraftCardRequest req, ICatalogAdminService svc, CancellationToken ct) =>
        {
            var res = await svc.CreateDraftCardAsync(
                new CreateDraftCardCmd(deckId, req.StableUid, req.FrontMd, req.BackMd, req.KeyPoint, req.Tags, req.Difficulty), ct);

            return Results.Created($"/api/admin/v1/decks/{deckId}/cards/{res.CardId}",
                new CreateDraftCardResponse(res.CardId, res.StableUid));
        })
        .WithName("CreateDraftCard")
        .Produces<CreateDraftCardResponse>(StatusCodes.Status201Created)
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict)
        .ProducesProblem(StatusCodes.Status422UnprocessableEntity);

        // 3) PublishDeck
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

    // === Admin 查询接口（驱动管理后台列表/详情）===
    public static IEndpointRouteBuilder MapCatalogAdminQueryEndpoints(this IEndpointRouteBuilder app, string basePath)
    {
        var g = app.MapGroup(basePath).WithTags("Admin/Catalog (Query)");

        // 列出 Deck（page/pageSize 可不传）
        g.MapGet("/decks", async (
            ICatalogQueryService svc,
            CancellationToken ct,
            [FromQuery] string? q = null,
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 20) =>
        {
            page = page <= 0 ? 1 : page;
            pageSize = pageSize is <= 0 or > 100 ? 20 : pageSize;

            var (items, total) = await svc.ListDecksAsync(q, page, pageSize, ct);
            return Results.Ok(new { items, total, page, pageSize });
        });

        // Deck 概览
        g.MapGet("/decks/{deckId:guid}", async (Guid deckId, ICatalogQueryService svc, CancellationToken ct) =>
        {
            var d = await svc.GetDeckAsync(deckId, ct);
            return d is null ? Results.NotFound() : Results.Ok(d);
        });

        // Deck 下的卡片
        g.MapGet("/decks/{deckId:guid}/cards", async (Guid deckId, ICatalogQueryService svc, CancellationToken ct) =>
        {
            var list = await svc.ListDeckCardsAsync(deckId, ct);
            return Results.Ok(new { items = list });
        });

        return app;
    }

    // === Public（占位，避免 Program.cs 找不到扩展方法）===
    public static IEndpointRouteBuilder MapCatalogPublicEndpoints(this IEndpointRouteBuilder app, string basePath)
    {
        var g = app.MapGroup(basePath).WithTags("Public/Catalog");
        g.MapGet("/_placeholder", () => Results.Ok(new { mod = "catalog", scope = "public" }));
        return app;
    }

    // === DTO（保持与前端/Swagger 对齐；序列化在 Program.cs 已设为 camelCase）===
    public record CreateDeckRequest(string Slug, string Title, string? Locale);
    public record CreateDeckResponse(Guid DeckId);

    public record CreateDraftCardRequest(
        string StableUid, string FrontMd, string BackMd, string KeyPoint,
        List<string>? Tags, string? Difficulty);
    public record CreateDraftCardResponse(Guid CardId, string StableUid);

    public record PublishDeckRequest(string Version, string? Changelog);
    public record PublishDeckResponse(string Version, int TotalCards, DateTimeOffset PublishedAt);
}