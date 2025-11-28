// backend/src/Host/RecallSmith.Api/Models/Deck.cs
namespace RecallSmith.Api.Models
{
    /// <summary>
    /// Authoring 侧的 Deck 模型，对应数据库表 decks。
    /// </summary>
    public class Deck
    {
        public int Id { get; set; }

        /// <summary>
        /// 稳定标识，对应 decks.slug（例如 "js-core-starter"）
        /// </summary>
        public string Slug { get; set; } = null!;

        public string Title { get; set; } = null!;

        public string Author { get; set; } = null!;

        public string? Description { get; set; }

        /// <summary>
        /// 语言，如 "en-US"
        /// </summary>
        public string Locale { get; set; } = "en-US";

        /// <summary>
        /// 1 = Starter, 2 = Paid
        /// </summary>
        public short DeckType { get; set; }

        public int IsDeleted { get; set; }

        public int Version { get; set; }

        public long CreatedAt { get; set; }

        public long UpdatedAt { get; set; }
    }
}