// Application/Catalog/IDeckExportService.cs
namespace RecallSmith.Api.Application.Catalog
{
    public interface IDeckExportService
    {
        /// <summary>
        /// 从 catalog_decks / catalog_cards 按 slug + version 读取数据，
        /// 组装成 DeckExportDto，并将 JSON 写到本地文件。
        /// </summary>
        /// <param name="slug">Deck 的 slug，例如 js-core-starter</param>
        /// <param name="version">版本号，例如 v1</param>
        /// <param name="jsonFilePath">导出的 JSON 文件绝对路径</param>
        /// <returns>DeckExportDto（返回给 API 调用方）</returns>
        DeckExportDto ExportDeck(string slug, string version, out string jsonFilePath);
    }
}