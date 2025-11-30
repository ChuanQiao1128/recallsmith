// Controllers/CatalogDeckExportController.cs
using System;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using RecallSmith.Api.Application.Catalog;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Controllers
{
    [ApiController]
    [Route("api/catalog/decks")]
    public class CatalogDeckExportController : ControllerBase
    {
        private readonly IDeckExportService _deckExportService;
        private readonly ILogger<CatalogDeckExportController> _logger;

        public CatalogDeckExportController(
            IDeckExportService deckExportService,
            ILogger<CatalogDeckExportController> logger)
        {
            _deckExportService = deckExportService;
            _logger = logger;
        }

        private string GetTraceId()
        {
            return HttpContext?.TraceIdentifier ?? Guid.NewGuid().ToString("N");
        }

        // GET /api/catalog/decks/export?slug=js-core-starter&version=v1
        [HttpGet("export")]
        public ActionResult<ApiResult<object>> Export(
            [FromQuery] string? slug,
            [FromQuery] string? version)
        {
            string traceId = GetTraceId();

            if (string.IsNullOrWhiteSpace(slug) || string.IsNullOrWhiteSpace(version))
            {
                var bad = ApiResult<object>.Fail(
                    code: "BadRequest",
                    message: "slug and version are required.",
                    traceId: traceId);
                return BadRequest(bad);
            }

            try
            {
                string filePath;
                DeckExportDto dto = _deckExportService.ExportDeck(slug, version, out filePath);

                var payload = new
                {
                    deck = dto,
                    exportPath = filePath  // 方便你本地知道 json 文件放哪了
                };

                var ok = ApiResult<object>.Ok(payload, traceId);
                return Ok(ok);
            }
            catch (KeyNotFoundException ex)
            {
                _logger.LogWarning(ex, "Deck export not found: {Slug} {Version}", slug, version);

                var notFound = ApiResult<object>.Fail(
                    code: "NotFound",
                    message: ex.Message,
                    traceId: traceId);
                return NotFound(notFound);
            }
            catch (ArgumentException ex)
            {
                _logger.LogWarning(ex, "Bad export request: {Slug} {Version}", slug, version);

                var bad = ApiResult<object>.Fail(
                    code: "BadRequest",
                    message: ex.Message,
                    traceId: traceId);
                return BadRequest(bad);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error exporting deck: {Slug} {Version}", slug, version);

                var error = ApiResult<object>.Fail(
                    code: "ServerError",
                    message: "Unexpected error while exporting deck.",
                    traceId: traceId);
                return StatusCode(500, error);
            }
        }
    }
}