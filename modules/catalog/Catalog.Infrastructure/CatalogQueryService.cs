using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Catalog.Application;
using Contracts.Catalog.Admin;
using Npgsql;

namespace Catalog.Infrastructure
{
    /// <summary>
    /// 真实查询实现（占位骨架）。后续你可以用 EF Core 或 Dapper/NpgsqlDataSource 完成查询。
    /// 这里先返回空数据，保证编译可通过与应用可运行。
    /// </summary>
    public sealed class CatalogQueryService : ICatalogQueryService
    {
        private readonly NpgsqlDataSource _ds;

        public CatalogQueryService(NpgsqlDataSource ds)
        {
            _ds = ds;
        }

        public Task<(IReadOnlyList<DeckListItemDto> Items, int Total)> ListDecksAsync(
            string? q, int page, int pageSize, CancellationToken ct)
        {
            // TODO: 换成真实查询
            return Task.FromResult(((IReadOnlyList<DeckListItemDto>)Array.Empty<DeckListItemDto>(), 0));
        }

        public Task<DeckDetailDto?> GetDeckAsync(Guid deckId, CancellationToken ct)
        {
            // TODO: 换成真实查询
            return Task.FromResult<DeckDetailDto?>(null);
        }

        public Task<IReadOnlyList<CardDto>> ListDeckCardsAsync(Guid deckId, CancellationToken ct)
        {
            // TODO: 换成真实查询
            return Task.FromResult((IReadOnlyList<CardDto>)Array.Empty<CardDto>());
        }
    }
}
