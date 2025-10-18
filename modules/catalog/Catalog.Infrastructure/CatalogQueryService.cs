using Catalog.Application;
using Dapper;
using Npgsql;

namespace Catalog.Infrastructure;

public sealed class CatalogQueryService : ICatalogQueryService
{
    private readonly NpgsqlDataSource _ds;

    public CatalogQueryService(NpgsqlDataSource ds) => _ds = ds;

    public async Task<(IReadOnlyList<DeckSummaryDto> Items, int Total)> ListDecksAsync(string? q, int page, int pageSize, CancellationToken ct)
    {
        var offset = (page - 1) * pageSize;
        await using var conn = await _ds.OpenConnectionAsync(ct);

        // 注意：下列列名请按你的实际表结构调整（尽量用最保守的列 id/slug/title/locale）
        var sqlItems = @"
select d.id, d.slug, d.title, d.locale
from decks d
where (@q is null or d.slug ilike '%'||@q||'%' or d.title ilike '%'||@q||'%')
order by d.id desc
limit @pageSize offset @offset;
";
        var sqlTotal = @"
select count(*) from decks d
where (@q is null or d.slug ilike '%'||@q||'%' or d.title ilike '%'||@q||'%');
";
        var sqlDraftCounts = @"select deck_id as deckId, count(*) as cnt from cards group by deck_id;";

        var items = (await conn.QueryAsync<(Guid Id, string Slug, string Title, string? Locale)>(
            sqlItems, new { q, pageSize, offset })).ToList();

        var total = await conn.ExecuteScalarAsync<int>(sqlTotal, new { q });

        var draftCounts = await conn.QueryAsync<(Guid deckId, int cnt)>(sqlDraftCounts);

        var dictCount = draftCounts.ToDictionary(x => x.deckId, x => x.cnt);
        var mapped = items.Select(x =>
            new DeckSummaryDto(x.Id, x.Slug, x.Title, x.Locale,
                dictCount.TryGetValue(x.Id, out var c) ? c : 0,
                LatestVersion: null, LatestTotalPublished: null)).ToList();

        return (mapped, total);
    }

    public async Task<DeckSummaryDto?> GetDeckAsync(Guid deckId, CancellationToken ct)
    {
        await using var conn = await _ds.OpenConnectionAsync(ct);

        var deck = await conn.QuerySingleOrDefaultAsync<(Guid Id, string Slug, string Title, string? Locale)>(
            "select id, slug, title, locale from decks where id=@deckId;", new { deckId });

        if (deck == default) return null;

        var draftCount = await conn.ExecuteScalarAsync<int>(
            "select count(*) from cards where deck_id=@deckId;", new { deckId });

        return new DeckSummaryDto(deck.Id, deck.Slug, deck.Title, deck.Locale, draftCount, null, null);
    }

    public async Task<IReadOnlyList<CardDto>> ListDeckCardsAsync(Guid deckId, CancellationToken ct)
    {
        await using var conn = await _ds.OpenConnectionAsync(ct);

        // 注意：若你的列名不同，请对齐（stable_uid/front_md/back_md 这类列先不选，避免 tag/jsonb 造成映射繁琐）
        var sql = @"
select id, deck_id as DeckId, stable_uid as StableUid, key_point as KeyPoint, difficulty,
       coalesce(created_at, now()) as CreatedAt
from cards
where deck_id=@deckId
order by created_at nulls last, id;
";
        var rows = await conn.QueryAsync<CardDto>(sql, new { deckId });
        return rows.ToList();
    }
}