// backend/src/Host/RecallSmith.Api/Infrastructure/Cards/ICardRepository.cs
using System.Collections.Generic;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Infrastructure.Cards
{
    public interface ICardRepository
    {
        /// <summary>
        /// 根据 deckId 查询该 Deck 下所有未软删卡片，按 order_in_deck 升序。
        /// </summary>
        List<Card> GetCardsByDeckId(int deckId);
    }
}