namespace Contracts.Catalog.Admin;

public record CreateDeckRequest(string Slug, string Title, string? Locale);
public record CreateDeckResponse(Guid DeckId);

public record CreateDraftCardRequest(
    string StableUid,
    string FrontMd,
    string BackMd,
    string KeyPoint,
    List<string>? Tags,
    string? Difficulty);
public record CreateDraftCardResponse(Guid CardId, string StableUid);

public record PublishDeckRequest(string Version, string? Changelog);
public record PublishDeckResponse(string Version, int TotalCards, DateTimeOffset PublishedAt);

public record DeckListItemDto(Guid DeckId, string Slug, string Title, string? Locale,
                              string? LatestVersion, DateTimeOffset CreatedAt);

public record DeckDetailDto(Guid DeckId, string Slug, string Title, string? Locale,
                            string? LatestVersion, int TotalCards,
                            DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

public record CardDto(Guid CardId, string StableUid, string FrontMd, string BackMd, string KeyPoint,
                      List<string>? Tags, string? Difficulty,
                      DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
