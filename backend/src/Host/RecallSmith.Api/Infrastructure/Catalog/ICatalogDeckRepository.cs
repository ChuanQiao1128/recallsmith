// backend/src/Host/RecallSmith.Api/Infrastructure/Catalog/ICatalogDeckRepository.cs
using System.Collections.Generic;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Infrastructure.Catalog
{
    public interface ICatalogDeckRepository
    {
        /// <summary>
        /// 按 locale 分页读取 Catalog Deck 列表。
        /// </summary>
        List<CatalogDeck> GetDecks(string? locale, int page, int pageSize);

        /// <summary>
        /// 根据 slug + version 读取一个 CatalogDeck。
        /// </summary>
        CatalogDeck? GetBySlugAndVersion(string slug, string version);

        /// <summary>
        /// 判断某个 slug + version 是否已经存在。
        /// </summary>
        bool ExistsSlugAndVersion(string slug, string version);

        /// <summary>
        /// 插入一条新的 CatalogDeck 记录。
        /// </summary>
        CatalogDeck? InsertDeck(
            string slug,
            string version,
            string title,
            string? description,
            string locale,
            bool isFreeStarter,
            int totalCards,
            int freeCardCount,
            short deckType,
            int? sourceDeckId,
            long createdAt,
            long updatedAt,
            long publishedAt);
    }
}