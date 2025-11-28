// backend/src/Host/RecallSmith.Api/Models/Card.cs
namespace RecallSmith.Api.Models
{
    /// <summary>
    /// Authoring 侧的 Card 模型，对应数据库表 cards。
    /// </summary>
    public class Card
    {
        public int Id { get; set; }

        public int DeckId { get; set; }

        public string StableUid { get; set; } = null!;

        public string Question { get; set; } = null!;

        public string? Explanation { get; set; }

        public string? CodeSnippet { get; set; }

        public string? CodeLanguage { get; set; }

        /// <summary>
        /// 1=简单, 2=中等, 3=困难
        /// </summary>
        public short Difficulty { get; set; }

        public int OrderInDeck { get; set; }

        public int IsDeleted { get; set; }

        public int Version { get; set; }

        public long CreatedAt { get; set; }

        public long UpdatedAt { get; set; }
    }
}