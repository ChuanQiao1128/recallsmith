namespace Catalog.Application;

public record DeckSummaryDto(
    Guid Id, string Slug, string Title, string? Locale,
    int DraftCount, string? LatestVersion, int? LatestTotalPublished);

public record CardDto(
    Guid Id, Guid DeckId, string StableUid, string KeyPoint,
    string? Difficulty, DateTimeOffset CreatedAt);

public interface ICatalogQueryService
{
    Task<(IReadOnlyList<DeckSummaryDto> Items, int Total)> ListDecksAsync(string? q, int page, int pageSize, CancellationToken ct);
    Task<DeckSummaryDto?> GetDeckAsync(Guid deckId, CancellationToken ct);
    Task<IReadOnlyList<CardDto>> ListDeckCardsAsync(Guid deckId, CancellationToken ct);
}