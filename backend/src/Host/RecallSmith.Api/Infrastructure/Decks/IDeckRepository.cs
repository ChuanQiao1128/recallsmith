using RecallSmith.Api.Models;

namespace RecallSmith.Api.Infrastructure.Decks;

public interface IDeckRepository
{
    List<Deck> GetDecks(string? title, bool sortCreatedAtAsc, int page, int pageSize);

    Deck? GetDeckById(int id);

    bool ExistsActiveTitle(string title, int? excludeId);

    Deck? InsertDeck(string title, string author, long createdAt, long updatedAt);

    /// <summary>
    /// 软删：id 不存在返回 false；存在则返回 true（即使已经是软删状态）
    /// </summary>
    bool SoftDeleteDeck(int id, long updatedAt);

    /// <summary>
    /// 更新：成功返回更新后的 Deck；id 不存在或已软删时返回 null
    /// </summary>
    Deck? UpdateDeck(int id, string? newTitle, string? newAuthor, long updatedAt);
}