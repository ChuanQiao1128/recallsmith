namespace Authoring.Core.Contracts.Deck;

public sealed record DeckSummaryResponse(
    Guid DeckId, string Slug, string Title, string? Locale,
    DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt
);