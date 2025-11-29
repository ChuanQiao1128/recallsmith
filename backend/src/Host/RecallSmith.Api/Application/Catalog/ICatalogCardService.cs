using System.Collections.Generic;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Application.Catalog
{
    /// <summary>
    /// Catalog 读侧卡片查询服务接口。
    /// </summary>
    public interface ICatalogCardService
    {
        /// <summary>
        /// 按 deckSlug + version 分页获取卡片列表。
        /// page 从 1 开始，pageSize 由调用方传入或使用默认值。
        /// </summary>
        List<CatalogCard> GetCards(string deckSlug, string deckVersion, int page, int pageSize);
    }
}