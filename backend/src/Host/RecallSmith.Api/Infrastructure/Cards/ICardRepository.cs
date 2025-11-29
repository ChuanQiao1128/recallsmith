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

        /// <summary>
        /// 根据 id 查询单个 Card（仅未软删）。
        /// </summary>
        Card? GetCardById(int id);

        /// <summary>
        /// 检查同一 deck 内 stableUid 是否已经存在。
        /// excludeId 用于更新场景，排除自身。
        /// </summary>
        bool ExistsStableUid(int deckId, string stableUid, int? excludeId);

        /// <summary>
        /// 插入一条新的 Card，返回插入后的完整实体。
        /// </summary>
        Card? InsertCard(
            int deckId,
            string stableUid,
            string question,
            string? explanation,
            string? codeSnippet,
            string? codeLanguage,
            short difficulty,
            int orderInDeck,
            long createdAt,
            long updatedAt);

        /// <summary>
        /// 软删卡片：如果不存在返回 false；
        /// 存在则：
        ///   - 未软删：置 is_deleted=1, version+=1, updated_at 更新；
        ///   - 已软删：保持不变。
        /// 存在时返回 true。
        /// </summary>
        bool SoftDeleteCard(int id, long updatedAt);

        /// <summary>
        /// 按 expectedVersion 乐观并发更新卡片。
        /// 更新成功返回更新后的 Card；
        /// 未更新到行时，通过 versionConflict 区分：
        ///   - versionConflict=true：记录存在但版本不匹配；
        ///   - versionConflict=false：记录不存在或已软删。
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
            long updatedAt,
            out bool versionConflict);
    }
}