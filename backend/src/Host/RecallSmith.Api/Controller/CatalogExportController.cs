using System;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using RecallSmith.Api.Application.Catalog;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Controllers
{
    [ApiController]
    [Route("api/catalog/decks/export")]
    public class CatalogExportController : ControllerBase
    {
        private readonly ICatalogExportService _exportService;
        private readonly ILogger<CatalogExportController> _logger;

        public CatalogExportController(
            ICatalogExportService exportService,
            ILogger<CatalogExportController> logger)
        {
            _exportService = exportService;
            _logger = logger;
        }

        private string GetTraceId()
        {
            return HttpContext?.TraceIdentifier ?? Guid.NewGuid().ToString("N");
        }

        /// <summary>
        /// 导出指定 slug+version 的题库（Deck + Cards）。
        /// GET /api/catalog/decks/export?slug=js-core-starter&version=v2
        /// </summary>
        [HttpGet]
        public ActionResult<ApiResult<object>> Export(
            [FromQuery] string? slug,
            [FromQuery] string? version)
        {
            string traceId = GetTraceId();

            if (string.IsNullOrWhiteSpace(slug))
            {
                var bad = ApiResult<object>.Fail("BadRequest", "slug is required.", traceId);
                return BadRequest(bad);
            }

            if (string.IsNullOrWhiteSpace(version))
            {
                var bad = ApiResult<object>.Fail("BadRequest", "version is required.", traceId);
                return BadRequest(bad);
            }

            try
            {
                CatalogDeckExportDto result = _exportService.ExportDeck(slug!, version!);
                var ok = ApiResult<object>.Ok(result, traceId);
                return Ok(ok);
            }
            catch (ArgumentException ex)
            {
                var bad = ApiResult<object>.Fail("BadRequest", ex.Message, traceId);
                return BadRequest(bad);
            }
            catch (KeyNotFoundException ex)
            {
                var notFound = ApiResult<object>.Fail("NotFound", ex.Message, traceId);
                return NotFound(notFound);
            }
        }
    }
}