// backend/src/Host/RecallSmith.Api/Application/Publishing/IDeckPublishingService.cs
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Application.Publishing
{
    public interface IDeckPublishingService
    {
        /// <summary>
        /// 从 Authoring 发布一个 Deck 到 Catalog。
        /// </summary>
        CatalogDeck PublishDeck(int deckId, string version, bool forceOverwrite);
    }
}