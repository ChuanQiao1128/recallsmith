namespace Authoring.Core.Contracts.Deck;

public sealed record DeckDetailResponse(
    Guid DeckId,
    string Slug,
    string Title,
    string? Locale,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    bool IsDeleted,
    long Version // ✅ 新增：前端更新时要带上它
);