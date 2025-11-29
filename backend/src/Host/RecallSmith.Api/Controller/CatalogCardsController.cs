using System;
using System.Collections.Generic;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using RecallSmith.Api.Application.Catalog;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Controllers
{
    [ApiController]
    [Route("api/catalog/cards")]
    public class CatalogCardsController : ControllerBase
    {
        private readonly ICatalogCardService _service;
        private readonly ILogger<CatalogCardsController> _logger;

        private const int DefaultPageSize = 50;

        public CatalogCardsController(
            ICatalogCardService service,
            ILogger<CatalogCardsController> logger)
        {
            _service = service;
            _logger = logger;
        }

        private string GetTraceId()
        {
            return HttpContext?.TraceIdentifier ?? Guid.NewGuid().ToString("N");
        }

        /// <summary>
        /// 读侧：按 deckSlug + version 分页获取卡片列表。
        /// GET /api/catalog/cards?deckSlug=js-core-starter&version=v1&page=1
        /// </summary>
        [HttpGet]
        public ActionResult<ApiResult<object>> Get(
            [FromQuery] string? deckSlug,
            [FromQuery] string? version,
            [FromQuery] int? page)
        {
            string traceId = GetTraceId();

            if (string.IsNullOrWhiteSpace(deckSlug))
            {
                var bad = ApiResult<object>.Fail("BadRequest", "deckSlug is required.", traceId);
                return BadRequest(bad);
            }

            if (string.IsNullOrWhiteSpace(version))
            {
                var bad = ApiResult<object>.Fail("BadRequest", "version is required.", traceId);
                return BadRequest(bad);
            }

            int currentPage = (page.HasValue && page.Value > 0) ? page.Value : 1;

            try
            {
                List<CatalogCard> cards = _service.GetCards(
                    deckSlug!,
                    version!,
                    currentPage,
                    DefaultPageSize);

                var ok = ApiResult<object>.Ok(cards, traceId);
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