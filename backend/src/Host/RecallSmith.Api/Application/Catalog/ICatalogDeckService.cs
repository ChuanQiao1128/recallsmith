// backend/src/Host/RecallSmith.Api/Application/Catalog/ICatalogDeckService.cs
using System.Collections.Generic;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Application.Catalog
{
    public interface ICatalogDeckService
    {
        List<CatalogDeck> GetDecks(string? locale, int page, int pageSize);

        CatalogDeck? GetDeckBySlugAndVersion(string slug, string version);
    }
}