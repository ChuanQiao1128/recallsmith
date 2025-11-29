// backend/src/Host/RecallSmith.Api/Application/Catalog/CatalogDeckService.cs
using System;
using System.Collections.Generic;
using Microsoft.Extensions.Logging;
using RecallSmith.Api.Infrastructure.Catalog;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Application.Catalog
{
    public class CatalogDeckService : ICatalogDeckService
    {
        private readonly ICatalogDeckRepository _repository;
        private readonly ILogger<CatalogDeckService> _logger;

        public CatalogDeckService(ICatalogDeckRepository repository, ILogger<CatalogDeckService> logger)
        {
            _repository = repository;
            _logger = logger;
        }

        public List<CatalogDeck> GetDecks(string? locale, int page, int pageSize)
        {
            if (page <= 0)
            {
                page = 1;
            }

            if (pageSize <= 0)
            {
                pageSize = 10;
            }

            return _repository.GetDecks(locale, page, pageSize);
        }

        public CatalogDeck? GetDeckBySlugAndVersion(string slug, string version)
        {
            if (string.IsNullOrWhiteSpace(slug))
            {
                throw new ArgumentException("slug is required.", nameof(slug));
            }

            if (string.IsNullOrWhiteSpace(version))
            {
                throw new ArgumentException("version is required.", nameof(version));
            }

            return _repository.GetBySlugAndVersion(slug.Trim(), version.Trim());
        }
    }
}