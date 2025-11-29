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

        /// <summary>
        /// 创建一条新的 Card（会检查 Deck 是否存在）。
        /// </summary>
        Card CreateCard(
            int deckId,
            string question,
            string? explanation,
            string? codeSnippet,
            string? codeLanguage,
            short? difficulty,
            int? orderInDeck,
            string? stableUid);

        /// <summary>
        /// 软删卡片。返回 false 表示记录不存在。
        /// </summary>
        bool SoftDeleteCard(int id);

        /// <summary>
        /// 按 expectedVersion 更新卡片。
        /// updated == null 时，根据 versionConflict 判断：
        ///   - true  => 版本冲突；
        ///   - false => 记录不存在或已删除。
        /// </summary>
        Card? UpdateCard(
            int id,
            int expectedVersion,
            string? question,
            string? explanation,
            string? codeSnippet,
            string? codeLanguage,
            short? difficulty,
            int? orderInDeck,
            out bool versionConflict);
    }
}