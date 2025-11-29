using System.Collections.Generic;

namespace RecallSmith.Api.Models
{
    /// <summary>
    /// 用于导出到 S3 / RN 的 deck+cards 组合结构。
    /// </summary>
    public class CatalogDeckExportDto
    {
        public CatalogDeck Deck { get; set; } = null!;

        public List<CatalogCard> Cards { get; set; } = new List<CatalogCard>();
    }
}