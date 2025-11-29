using System;
using System.Collections.Generic;
using Microsoft.Extensions.Logging;
using RecallSmith.Api.Infrastructure.Catalog;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Application.Catalog
{
    /// <summary>
    /// Catalog 读侧卡片查询服务实现。
    /// 负责做参数校验、默认值处理，然后调用 Repository。
    /// </summary>
    public class CatalogCardService : ICatalogCardService
    {
        private readonly ICatalogCardRepository _repository;
        private readonly ILogger<CatalogCardService> _logger;

        public CatalogCardService(
            ICatalogCardRepository repository,
            ILogger<CatalogCardService> logger)
        {
            _repository = repository;
            _logger = logger;
        }

        public List<CatalogCard> GetCards(string deckSlug, string deckVersion, int page, int pageSize)
        {
            if (string.IsNullOrWhiteSpace(deckSlug))
            {
                throw new ArgumentException("deckSlug is required.", nameof(deckSlug));
            }

            if (string.IsNullOrWhiteSpace(deckVersion))
            {
                throw new ArgumentException("version is required.", nameof(deckVersion));
            }

            if (page <= 0)
            {
                page = 1;
            }

            if (pageSize <= 0)
            {
                pageSize = 50; // 默认一次取 50 条
            }

            string normalizedSlug = deckSlug.Trim();
            string normalizedVersion = deckVersion.Trim();

            _logger.LogDebug(
                "Get catalog cards. deckSlug={Slug}, version={Version}, page={Page}, pageSize={PageSize}",
                normalizedSlug,
                normalizedVersion,
                page,
                pageSize);

            return _repository.GetCards(normalizedSlug, normalizedVersion, page, pageSize);
        }
    }
}