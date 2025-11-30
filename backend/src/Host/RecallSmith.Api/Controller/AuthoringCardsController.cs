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
                var notFound = ApiResult<object>.Fail("NotFound", ex.Message, traceId);
                return NotFound(notFound);
            }
        }

        // POST /api/authoring/cards?deckId=1&question=...&difficulty=2&orderInDeck=10
        [HttpPost]
        public ActionResult<ApiResult<object>> Create(
            [FromQuery] int deckId,
            [FromQuery] string? question,
            [FromQuery] string? explanation,
            [FromQuery] string? codeSnippet,
            [FromQuery] string? codeLanguage,
            [FromQuery] short? difficulty,
            [FromQuery] int? orderInDeck,
            [FromQuery] string? stableUid)
        {
            string traceId = GetTraceId();

            if (deckId <= 0)
            {
                var bad = ApiResult<object>.Fail("BadRequest", "deckId must be greater than 0.", traceId);
                return BadRequest(bad);
            }

            if (string.IsNullOrWhiteSpace(question))
            {
                var bad = ApiResult<object>.Fail("BadRequest", "Question is required.", traceId);
                return BadRequest(bad);
            }

            try
            {
                Card card = _cardService.CreateCard(
                    deckId,
                    question!,
                    explanation,
                    codeSnippet,
                    codeLanguage,
                    difficulty,
                    orderInDeck,
                    stableUid);

                string location = $"api/authoring/cards?id={card.Id}";
                var result = ApiResult<object>.Ok(card, traceId);
                return Created(location, result);
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
            catch (InvalidOperationException ex)
            {
                var conflict = ApiResult<object>.Fail("Conflict", ex.Message, traceId);
                return Conflict(conflict);
            }
        }

        // PUT /api/authoring/cards?id=1&expectedVersion=1&question=...&difficulty=3
        [HttpPut]
        public ActionResult<ApiResult<object>> Update(
            [FromQuery] int id,
            [FromQuery] int expectedVersion,
            [FromQuery] string? question,
            [FromQuery] string? explanation,
            [FromQuery] string? codeSnippet,
            [FromQuery] string? codeLanguage,
            [FromQuery] short? difficulty,
            [FromQuery] int? orderInDeck)
        {
            string traceId = GetTraceId();

            if (id <= 0)
            {
                var bad = ApiResult<object>.Fail("BadRequest", "id must be greater than 0.", traceId);
                return BadRequest(bad);
            }

            if (expectedVersion <= 0)
            {
                var bad = ApiResult<object>.Fail("BadRequest", "expectedVersion must be greater than 0.", traceId);
                return BadRequest(bad);
            }

            if (string.IsNullOrWhiteSpace(question)
                && explanation is null
                && codeSnippet is null
                && codeLanguage is null
                && !difficulty.HasValue
                && !orderInDeck.HasValue)
            {
                var bad = ApiResult<object>.Fail(
                    "BadRequest",
                    "At least one of question, explanation, codeSnippet, codeLanguage, difficulty, or orderInDeck must be provided.",
                    traceId);
                return BadRequest(bad);
            }

            try
            {
                bool versionConflict;
                Card? updated = _cardService.UpdateCard(
                    id,
                    expectedVersion,
                    question,
                    explanation,
                    codeSnippet,
                    codeLanguage,
                    difficulty,
                    orderInDeck,
                    out versionConflict);

                if (updated == null)
                {
                    if (versionConflict)
                    {
                        var conflict = ApiResult<object>.Fail(
                            "VersionConflict",
                            "Card has been modified by another request.",
                            traceId);
                        return Conflict(conflict);
                    }
                    else
                    {
                        var notFound = ApiResult<object>.Fail(
                            "NotFound",
                            $"Card with id {id} not found.",
                            traceId);
                        return NotFound(notFound);
                    }
                }

                var ok = ApiResult<object>.Ok(updated, traceId);
                return Ok(ok);
            }
            catch (ArgumentException ex)
            {
                var bad = ApiResult<object>.Fail("BadRequest", ex.Message, traceId);
                return BadRequest(bad);
            }
            catch (InvalidOperationException ex)
            {
                var conflict = ApiResult<object>.Fail("Conflict", ex.Message, traceId);
                return Conflict(conflict);
            }
        }

        // DELETE /api/authoring/cards?id=1
        [HttpDelete]
        public ActionResult<ApiResult<object>> Delete([FromQuery] int id)
        {
            string traceId = GetTraceId();

            if (id <= 0)
            {
                var bad = ApiResult<object>.Fail("BadRequest", "id must be greater than 0.", traceId);
                return BadRequest(bad);
            }

            bool found = _cardService.SoftDeleteCard(id);

            if (!found)
            {
                var notFound = ApiResult<object>.Fail("NotFound", $"Card with id {id} not found.", traceId);
                return NotFound(notFound);
            }

            var ok = ApiResult<object?>.Ok(null, traceId);
            return Ok(ok);
        }
    }
}