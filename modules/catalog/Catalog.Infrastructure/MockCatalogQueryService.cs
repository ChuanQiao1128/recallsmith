using Catalog.Application;

namespace Catalog.Infrastructure;

public sealed class MockCatalogQueryService : ICatalogQueryService
{
    private static readonly List<DeckSummaryDto> _decks = new()
    {
        new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), "js-core", "JavaScript Core", "en-US", 3, "1.0.4", 3),
        new(Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"), "dotnet-core", ".NET Core", "en-US", 2, "1.2.0", 12)
    };

    private static readonly List<CardDto> _cards = new()
    {
        new(Guid.NewGuid(), Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), "js.eventloop.micro-vs-macro.v1", "Microtasks run before macrotasks", "intermediate", DateTimeOffset.UtcNow.AddDays(-1)),
        new(Guid.NewGuid(), Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), "react.reconciliation.keys.v1", "Stable keys for reconciliation", "intermediate", DateTimeOffset.UtcNow.AddDays(-2)),
        new(Guid.NewGuid(), Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"), "dotnet.async.await.vs-taskrun.v1", "Prefer async/await for I/O", "intermediate", DateTimeOffset.UtcNow.AddDays(-3)),
    };

    public Task<(IReadOnlyList<DeckSummaryDto> Items, int Total)> ListDecksAsync(string? q, int page, int pageSize, CancellationToken ct)
    {
        var list = string.IsNullOrWhiteSpace(q)
            ? _decks
            : _decks.Where(d => d.Slug.Contains(q, StringComparison.OrdinalIgnoreCase)
                || d.Title.Contains(q, StringComparison.OrdinalIgnoreCase)).ToList();
        var total = list.Count;
        var items = list.Skip((page - 1) * pageSize).Take(pageSize).ToList();
        return Task.FromResult(((IReadOnlyList<DeckSummaryDto>)items, total));
    }

    public Task<DeckSummaryDto?> GetDeckAsync(Guid deckId, CancellationToken ct)
        => Task.FromResult(_decks.FirstOrDefault(d => d.Id == deckId));

    public Task<IReadOnlyList<CardDto>> ListDeckCardsAsync(Guid deckId, CancellationToken ct)
        => Task.FromResult((IReadOnlyList<CardDto>)_cards.Where(c => c.DeckId == deckId).ToList());
}