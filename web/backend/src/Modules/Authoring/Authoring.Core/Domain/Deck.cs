namespace Authoring.Core.Domain;

public sealed class Deck
{
    public Guid DeckId { get; init; }
    public string Slug { get; init; } = default!;
    public string Title { get; set; } = default!;
    public string? Locale { get; set; }
    public DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset UpdatedAt { get; set; }
    public bool IsDeleted { get; set; }
}