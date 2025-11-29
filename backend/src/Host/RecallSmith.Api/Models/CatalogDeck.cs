// backend/src/Host/RecallSmith.Api/Models/CatalogDeck.cs
namespace RecallSmith.Api.Models
{
    /// <summary>
    /// Catalog 读侧的题库信息，对应 catalog_decks 表。
    /// </summary>
    public class CatalogDeck
    {
        public int Id { get; set; }

        public string Slug { get; set; } = null!;

        public string Version { get; set; } = null!;

        public string Title { get; set; } = null!;

        public string? Description { get; set; }

        public string Locale { get; set; } = "en-US";

        public bool IsFreeStarter { get; set; }

        public int TotalCards { get; set; }

        public int FreeCardCount { get; set; }

        public short DeckType { get; set; }

        public int? SourceDeckId { get; set; }

        public long CreatedAt { get; set; }

        public long UpdatedAt { get; set; }

        public long PublishedAt { get; set; }
    }
}