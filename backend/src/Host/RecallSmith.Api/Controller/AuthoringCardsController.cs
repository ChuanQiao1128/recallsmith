// backend/src/Host/RecallSmith.Api/Controllers/AuthoringCardsController.cs
using System;
using System.Collections.Generic;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using RecallSmith.Api.Application.Cards;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Controllers
{
    [ApiController]
    [Route("api/authoring/cards")]
    public class AuthoringCardsController : ControllerBase
    {
        private readonly ICardService _cardService;
        private readonly ILogger<AuthoringCardsController> _logger;

        public AuthoringCardsController(ICardService cardService, ILogger<AuthoringCardsController> logger)
        {
            _cardService = cardService;
            _logger = logger;
        }

        private string GetTraceId()
        {
            return HttpContext?.TraceIdentifier ?? Guid.NewGuid().ToString("N");
        }

        // GET /api/authoring/cards?deckId=1
        [HttpGet]
        public ActionResult<ApiResult<object>> GetByDeckId([FromQuery] int deckId)
        {
            string traceId = GetTraceId();

            if (deckId <= 0)
            {
                var bad = ApiResult<object>.Fail("BadRequest", "deckId must be greater than 0.", traceId);
                return BadRequest(bad);
            }

            try
            {
                List<Card> cards = _cardService.GetCardsByDeckId(deckId);

                // deck 存在，即使没有卡，也返回空数组
                var ok = ApiResult<object>.Ok(cards, traceId);
                return Ok(ok);
            }
            catch (ArgumentException ex)
            {
                var bad = ApiResult<object>.Fail("BadRequest", ex.Message, traceId);
                return BadRequest(bad);
            }
            catch (KeyNotFoundException ex)
            {
                // ★ Deck 不存在 → 404
                var notFound = ApiResult<object>.Fail("NotFound", ex.Message, traceId);
                return NotFound(notFound);
            }
        }
    }
}