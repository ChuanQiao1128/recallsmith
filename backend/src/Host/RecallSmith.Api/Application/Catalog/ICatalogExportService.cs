using RecallSmith.Api.Models;

namespace RecallSmith.Api.Application.Catalog
{
    /// <summary>
    /// Catalog 导出服务：把某个 slug+version 的 Deck 连同所有 Cards 一起导出。
    /// </summary>
    public interface ICatalogExportService
    {
        /// <summary>
        /// 导出指定 slug+version 的题库（包含 Deck 元信息和全部 Cards）。
        /// 找不到时抛 KeyNotFoundException。
        /// </summary>
        CatalogDeckExportDto ExportDeck(string slug, string version);
    }
}