// Application/Catalog/DeckExportDto.cs
using System.Collections.Generic;

namespace RecallSmith.Api.Application.Catalog
{
    /// <summary>
    /// 一个 Deck 的完整导出结构（RN / S3 使用）
    /// </summary>
    public sealed class DeckExportDto
    {
        public string Slug { get; set; } = "";
        public string Title { get; set; } = "";
        public string Locale { get; set; } = "";
        public string Version { get; set; } = "";

        /// <summary>
        /// 1 = Starter, 2 = Paid（和你 catalog_decks 里的 deck_type 对齐）
        /// </summary>
        public int DeckType { get; set; }

        public bool IsFreeStarter { get; set; }
        public int TotalCards { get; set; }
        public int FreeCardCount { get; set; }

        public List<DeckExportCardDto> Cards { get; set; } = new();
    }

    public sealed class DeckExportCardDto
    {
        public string StableUid { get; set; } = "";
        public string Question { get; set; } = "";
        public string? Explanation { get; set; }
        public string? CodeSnippet { get; set; }
        public string? CodeLanguage { get; set; }
        public short Difficulty { get; set; }
        public int OrderInDeck { get; set; }
    }
}