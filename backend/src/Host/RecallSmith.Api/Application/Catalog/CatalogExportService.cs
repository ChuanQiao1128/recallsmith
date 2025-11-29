using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using Microsoft.Extensions.Logging;
using RecallSmith.Api.Infrastructure.Catalog;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Application.Catalog
{
    /// <summary>
    /// Catalog 导出服务实现。
    /// </summary>
    public class CatalogExportService : ICatalogExportService
    {
        private readonly ICatalogDeckRepository _deckRepository;
        private readonly ICatalogCardRepository _cardRepository;
        private readonly ILogger<CatalogExportService> _logger;

        // 导出时单 Deck 允许的最大卡片数（简单粗暴一点就行）
        private const int ExportMaxCardCount = 10000;

        public CatalogExportService(
            ICatalogDeckRepository deckRepository,
            ICatalogCardRepository cardRepository,
            ILogger<CatalogExportService> logger)
        {
            _deckRepository = deckRepository;
            _cardRepository = cardRepository;
            _logger = logger;
        }

        public CatalogDeckExportDto ExportDeck(string slug, string version)
        {
            if (string.IsNullOrWhiteSpace(slug))
            {
                throw new ArgumentException("slug is required.", nameof(slug));
            }

            if (string.IsNullOrWhiteSpace(version))
            {
                throw new ArgumentException("version is required.", nameof(version));
            }

            string normalizedSlug = slug.Trim();
            string normalizedVersion = version.Trim();

            _logger.LogInformation(
                "Exporting catalog deck. slug={Slug}, version={Version}",
                normalizedSlug,
                normalizedVersion);

            // 1. 读 Deck 元信息
            CatalogDeck? deck = _deckRepository.GetBySlugAndVersion(normalizedSlug, normalizedVersion);
            if (deck == null)
            {
                throw new KeyNotFoundException(
                    $"Catalog deck '{normalizedSlug}' with version '{normalizedVersion}' not found.");
            }

            // 2. 读全部 Cards（这里直接用 page=1 + 很大的 pageSize 简化）
            List<CatalogCard> cards =
                _cardRepository.GetCards(normalizedSlug, normalizedVersion, page: 1, pageSize: ExportMaxCardCount);

            // （可选）按 orderInDeck 排一下，确保顺序
            cards = cards
                .OrderBy(c => c.OrderInDeck)
                .ThenBy(c => c.Id)
                .ToList();

            var export = new CatalogDeckExportDto
            {
                Deck = deck,
                Cards = cards
            };

            return export;
        }
    }
}