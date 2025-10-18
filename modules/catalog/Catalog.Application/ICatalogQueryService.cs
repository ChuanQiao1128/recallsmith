using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Contracts.Catalog.Admin;

namespace Catalog.Application
{
    public interface ICatalogQueryService
    {
        Task<(IReadOnlyList<DeckListItemDto> Items, int Total)> ListDecksAsync(
            string? q, int page, int pageSize, CancellationToken ct);

        Task<DeckDetailDto?> GetDeckAsync(Guid deckId, CancellationToken ct);

        Task<IReadOnlyList<CardDto>> ListDeckCardsAsync(Guid deckId, CancellationToken ct);
    }
}
