// backend/src/Host/RecallSmith.Api/Application/Cards/ICardService.cs
using System.Collections.Generic;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Application.Cards
{
    public interface ICardService
    {
        /// <summary>
        /// 根据 deckId 获取该 Deck 下的所有未软删卡片。
        /// </summary>
        List<Card> GetCardsByDeckId(int deckId);
    }
}