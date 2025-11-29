// backend/src/Host/RecallSmith.Api/Infrastructure/Catalog/ICatalogCardRepository.cs
using System.Collections.Generic;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Infrastructure.Catalog
{
    public interface ICatalogCardRepository
    {
        /// <summary>
        /// 按 deckSlug + version 分页读取卡片，按 order_in_deck 升序。
        /// </summary>
        List<CatalogCard> GetCards(string deckSlug, string deckVersion, int page, int pageSize);

        /// <summary>
        /// 为指定的 Catalog Deck 版本插入一批卡片。
        /// 传入的是 Authoring 侧的 Card 列表。
        /// </summary>
        void InsertCardsForDeck(
            string deckSlug,
            string deckVersion,
            IReadOnlyList<Card> sourceCards,
            long createdAt,
            long updatedAt);
    }
}