// backend/src/Host/RecallSmith.Api/Controllers/CatalogDecksController.cs
using System;
using System.Collections.Generic;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using RecallSmith.Api.Application.Catalog;
using RecallSmith.Api.Models;


namespace RecallSmith.Api.Controllers
{
    [ApiController]
    [Route("api/catalog/decks")]
    public class CatalogDecksController : ControllerBase
    {
        private readonly ICatalogDeckService _service;
        private readonly ILogger<CatalogDecksController> _logger;

        private const int PageSize = 10;

        public CatalogDecksController(ICatalogDeckService service, ILogger<CatalogDecksController> logger)
        {
            _service = service;
            _logger = logger;
        }

        private string GetTraceId()
        {
            return HttpContext?.TraceIdentifier ?? Guid.NewGuid().ToString("N");
        }

        // GET /api/catalog/decks?locale=en-US&page=1
        [HttpGet]
        public ActionResult<ApiResult<object>> GetList(
            [FromQuery] string? locale,
            [FromQuery] int? page)
        {
            string traceId = GetTraceId();

            int currentPage = (page.HasValue && page.Value > 0) ? page.Value : 1;

            try
            {
                List<CatalogDeck> decks = _service.GetDecks(locale, currentPage, PageSize);
                var ok = ApiResult<object>.Ok(decks, traceId);
                return Ok(ok);
            }
            catch (ArgumentException ex)
            {
                var bad = ApiResult<object>.Fail("BadRequest", ex.Message, traceId);
                return BadRequest(bad);
            }
        }

        // GET /api/catalog/decks/{slug}/{version}
        [HttpGet("{slug}/{version}")]
        public ActionResult<ApiResult<object>> GetBySlugAndVersion(
            [FromRoute] string slug,
            [FromRoute] string version)
        {
            string traceId = GetTraceId();

            try
            {
                CatalogDeck? deck = _service.GetDeckBySlugAndVersion(slug, version);

                if (deck == null)
                {
                    var notFound = ApiResult<object>.Fail(
                        "NotFound",
                        $"Catalog deck '{slug}' with version '{version}' not found.",
                        traceId);
                    return NotFound(notFound);
                }

                var ok = ApiResult<object>.Ok(deck, traceId);
                return Ok(ok);
            }
            catch (ArgumentException ex)
            {
                var bad = ApiResult<object>.Fail("BadRequest", ex.Message, traceId);
                return BadRequest(bad);
            }
        }
    }
}