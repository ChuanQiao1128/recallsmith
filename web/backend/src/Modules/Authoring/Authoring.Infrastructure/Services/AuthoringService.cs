using System.Net;
using Authoring.Core.Common;
using Authoring.Core.Contracts.Deck;
using Authoring.Infrastructure.EfCore;
using Authoring.Infrastructure.Entities;
using Microsoft.EntityFrameworkCore;

namespace Authoring.Infrastructure.Services;

/// <summary>
/// 题库 CRUD 的具体服务（不强制接口，以后可抽 IAuthoringService）
/// </summary>
public class AuthoringService
{
    private readonly AuthoringDbContext _db;

    public AuthoringService(AuthoringDbContext db) => _db = db;

    public async Task<DeckDetailResponse> CreateDeckAsync(CreateDeckRequest req, CancellationToken ct)
    {
        string slug = NormalizeSlug(req.Slug);

        bool exists = await _db.Decks.AnyAsync(d => d.Slug == slug, ct);
        if (exists)
            throw new AppException(HttpStatusCode.Conflict, ErrorCodes.Deck.SlugExists, $"Slug '{slug}' already exists.");

        var now = DateTimeOffset.UtcNow;
        var entity = new DeckEntity
        {
            DeckId = Guid.NewGuid(),
            Slug = slug,
            Title = req.Title.Trim(),
            Locale = string.IsNullOrWhiteSpace(req.Locale) ? null : req.Locale!.Trim(),
            CreatedAt = now,
            UpdatedAt = now,
            IsDeleted = false,
            Version = 1
        };

        _db.Decks.Add(entity);
        await _db.SaveChangesAsync(ct);

        return ToDetail(entity);
    }
    public async Task<PagedResult<DeckSummaryResponse>> ListDecksAsync(DeckQuery query, CancellationToken ct)
    {
        query.Normalize();

        IQueryable<DeckEntity> baseQ = _db.Decks
            .AsNoTracking()
            .Where(d => !d.IsDeleted);

        if (!string.IsNullOrWhiteSpace(query.Q))
        {
            var kw = query.Q!.Trim();
            // 简单模糊：大小写不敏感依赖列 COLLATE NOCASE；跨库也 OK
            baseQ = baseQ.Where(d => d.Title.Contains(kw) || d.Slug.Contains(kw));
            // 若要更鲁棒的大小写不敏感，可以用 EF.Functions.Like + LOWER 方案，后续再进阶
        }

        // 仅当传入 sortBy 才排序
        IQueryable<DeckEntity> q = baseQ;
        if (!string.IsNullOrEmpty(query.SortBy))
        {
            var asc = query.SortDir == "asc";
            q = query.SortBy switch
            {
                "slug" => asc ? q.OrderBy(d => d.Slug) : q.OrderByDescending(d => d.Slug),
                "title" => asc ? q.OrderBy(d => d.Title) : q.OrderByDescending(d => d.Title),
                "createdat" => asc ? q.OrderBy(d => d.CreatedAt) : q.OrderByDescending(d => d.CreatedAt),
                "updatedat" => asc ? q.OrderBy(d => d.UpdatedAt) : q.OrderByDescending(d => d.UpdatedAt),
                _ => q // 未知字段：不排序
            };
        }

        var total = await q.CountAsync(ct);

        // 不分页：查全量
        if (!(query.Page.HasValue && query.PageSize.HasValue))
        {
            var all = await q
                .Select(d => new DeckSummaryResponse(
                    d.DeckId, d.Slug, d.Title, d.Locale, d.CreatedAt, d.UpdatedAt))
                .ToListAsync(ct);

            return new PagedResult<DeckSummaryResponse>(all, total, 1, all.Count);
        }

        // 分页
        int page = query.Page!.Value;
        int pageSize = query.PageSize!.Value;

        var items = await q
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(d => new DeckSummaryResponse(
                d.DeckId, d.Slug, d.Title, d.Locale, d.CreatedAt, d.UpdatedAt))
            .ToListAsync(ct);

        return new PagedResult<DeckSummaryResponse>(items, total, page, pageSize);
    }
    public async Task<DeckDetailResponse> GetDeckAsync(Guid deckId, CancellationToken ct)
    {
        var e = await _db.Decks.AsNoTracking().SingleOrDefaultAsync(d => d.DeckId == deckId, ct);
        if (e is null)
            throw new AppException(HttpStatusCode.NotFound, ErrorCodes.Deck.NotFound, "Deck not found.");
        return ToDetail(e);
    }

    public async Task<DeckDetailResponse> UpdateDeckAsync(Guid deckId, UpdateDeckRequest req, CancellationToken ct)
    {
        if (req.ExpectedVersion <= 0)
            throw new AppException(HttpStatusCode.BadRequest, ErrorCodes.Common.Validation,
                "expectedVersion is required and must be > 0.");

        var e = await _db.Decks.SingleOrDefaultAsync(d => d.DeckId == deckId, ct);
        if (e is null)
            throw new AppException(HttpStatusCode.NotFound, ErrorCodes.Deck.NotFound, "Deck not found.");

        // ✅ 核心：把原始版本设成“客户端声明的期望版本”
        _db.Entry(e).Property(x => x.Version).OriginalValue = req.ExpectedVersion;

        e.Title = req.Title.Trim();
        e.Locale = string.IsNullOrWhiteSpace(req.Locale) ? null : req.Locale!.Trim();
        e.UpdatedAt = DateTimeOffset.UtcNow;
        e.Version = e.Version + 1; // 递增版本

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            // 任何 0 行受影响，都会在这里被捕获
            throw new AppException(
                HttpStatusCode.Conflict,
                ErrorCodes.Common.ConcurrencyConflict,
                "Deck has been modified by someone else. Please reload and retry."
            );
        }

        return ToDetail(e);
    }

    public async Task DeleteDeckAsync(Guid deckId, CancellationToken ct)
    {
        var e = await _db.Decks.SingleOrDefaultAsync(d => d.DeckId == deckId, ct);
        if (e is null)
            throw new AppException(HttpStatusCode.NotFound, ErrorCodes.Deck.NotFound, "Deck not found.");

        e.IsDeleted = true;
        e.UpdatedAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync(ct);
    }

    private static string NormalizeSlug(string raw)
        => raw.Trim().ToLowerInvariant();

    private static DeckDetailResponse ToDetail(DeckEntity e)
        => new(e.DeckId, e.Slug, e.Title, e.Locale, e.CreatedAt, e.UpdatedAt, e.IsDeleted, e.Version);
}