// backend/src/Host/RecallSmith.Api/Controllers/AuthoringDecksController.cs
using System;
using System.Collections.Generic;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using RecallSmith.Api.Application.Decks;
using RecallSmith.Api.Models;
using RecallSmith.Api.Application.Publishing;

namespace RecallSmith.Api.Controllers
{
    [ApiController]
    [Route("api/authoring/decks")]
    public class AuthoringDecksController : ControllerBase
    {
        private readonly IDeckService _deckService;
        private readonly IDeckPublishingService _deckPublishingService;
        private readonly ILogger<AuthoringDecksController> _logger;

        private const int PageSize = 10;

        public AuthoringDecksController(
            IDeckService deckService,
            IDeckPublishingService deckPublishingService,
            ILogger<AuthoringDecksController> logger)
        {
            _deckService = deckService;
            _deckPublishingService = deckPublishingService;
            _logger = logger;
        }

        private string GetTraceId()
        {
            return HttpContext?.TraceIdentifier ?? Guid.NewGuid().ToString("N");
        }

        // GET /api/authoring/decks
        // GET /api/authoring/decks?id=1
        // GET /api/authoring/decks?title=js&sortByCreatedAt=asc|desc&currentPage=1
        [HttpGet]
        public ActionResult<ApiResult<object>> Get(
            [FromQuery] int? id,
            [FromQuery] string? title,
            [FromQuery(Name = "sortbyCreatedAt")] string? sortByCreatedAt,
            [FromQuery] int? currentPage)
        {
            string traceId = GetTraceId();

            if (id is null)
            {
                int page = (currentPage.HasValue && currentPage.Value > 0) ? currentPage.Value : 1;

                bool sortCreatedAtAsc = true; // 默认升序
                if (!string.IsNullOrWhiteSpace(sortByCreatedAt))
                {
                    string normalized = sortByCreatedAt.Trim().ToLowerInvariant();
                    if (normalized == "desc")
                    {
                        sortCreatedAtAsc = false;
                    }
                    else
                    {
                        sortCreatedAtAsc = true;
                    }
                }

                List<Deck> decks = _deckService.GetDecks(title, sortCreatedAtAsc, page, PageSize);

                var result = ApiResult<object>.Ok(decks, traceId);
                return Ok(result);
            }

            // id 不为空，查询单个
            Deck? deck = _deckService.GetDeckById(id.Value);
            if (deck == null || deck.IsDeleted != 0)
            {
                var notFoundResult = ApiResult<object>.Fail(
                    code: "NotFound",
                    message: $"Deck with id {id.Value} not found.",
                    traceId: traceId
                );
                return NotFound(notFoundResult);
            }

            var okResult = ApiResult<object>.Ok(deck, traceId);
            return Ok(okResult);
        }

        // POST /api/authoring/decks?title=...&author=...&slug=...&description=...&locale=...&deckType=1|2
        [HttpPost]
        public ActionResult<ApiResult<object>> Create(
            [FromQuery] string? title,
            [FromQuery] string? author,
            [FromQuery] string? slug,
            [FromQuery] string? description,
            [FromQuery] string? locale,
            [FromQuery] short? deckType)
        {
            string traceId = GetTraceId();

            try
            {
                Deck deck = _deckService.CreateDeck(
                    slug,
                    title ?? string.Empty,
                    author ?? string.Empty,
                    description,
                    locale,
                    deckType);

                string location = $"api/authoring/decks?id={deck.Id}";
                var result = ApiResult<object>.Ok(deck, traceId);
                return Created(location, result);
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

        // DELETE /api/authoring/decks?id=1
        [HttpDelete]
        public ActionResult<ApiResult<object>> Delete([FromQuery] int id)
        {
            string traceId = GetTraceId();

            if (id <= 0)
            {
                var bad = ApiResult<object>.Fail("BadRequest", "id must be greater than 0.", traceId);
                return BadRequest(bad);
            }

            bool found = _deckService.SoftDeleteDeck(id);

            if (!found)
            {
                var notFound = ApiResult<object>.Fail("NotFound", $"Deck with id {id} not found.", traceId);
                return NotFound(notFound);
            }

            var result = ApiResult<object?>.Ok(null, traceId);
            return Ok(result);
        }

        // PUT /api/authoring/decks?id=1&expectedVersion=1&title=...&author=...&description=...&locale=...
        [HttpPut]
        public ActionResult<ApiResult<object>> Update(
            [FromQuery] int id,
            [FromQuery] int expectedVersion,
            [FromQuery] string? title,
            [FromQuery] string? author,
            [FromQuery] string? description,
            [FromQuery] string? locale)
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

            if (string.IsNullOrWhiteSpace(title)
                && string.IsNullOrWhiteSpace(author)
                && description is null
                && string.IsNullOrWhiteSpace(locale))
            {
                var bad = ApiResult<object>.Fail("BadRequest",
                    "At least one of title, author, description, or locale must be provided.",
                    traceId);
                return BadRequest(bad);
            }

            try
            {
                bool versionConflict;
                Deck? updated = _deckService.UpdateDeck(
                    id,
                    expectedVersion,
                    title,
                    author,
                    description,
                    locale,
                    out versionConflict);

                if (updated == null)
                {
                    if (versionConflict)
                    {
                        var conflict = ApiResult<object>.Fail(
                            "VersionConflict",
                            "Deck has been modified by another request.",
                            traceId);
                        return Conflict(conflict);
                    }
                    else
                    {
                        var notFound = ApiResult<object>.Fail(
                            "NotFound",
                            $"Deck with id {id} not found.",
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

        // POST /api/authoring/decks/publish?deckId=1&version=v2&force=false
        [HttpPost("publish")]
        public ActionResult<ApiResult<object>> Publish(
            [FromQuery] int deckId,
            [FromQuery] string? version,
            [FromQuery] bool? force)
        {
            string traceId = GetTraceId();

            if (deckId <= 0)
            {
                var bad = ApiResult<object>.Fail("BadRequest", "deckId must be greater than 0.", traceId);
                return BadRequest(bad);
            }

            if (string.IsNullOrWhiteSpace(version))
            {
                var bad = ApiResult<object>.Fail("BadRequest", "version is required.", traceId);
                return BadRequest(bad);
            }

            bool forceOverwrite = force ?? false;

            try
            {
                CatalogDeck catalogDeck = _deckPublishingService.PublishDeck(deckId, version!, forceOverwrite);
                var ok = ApiResult<object>.Ok(catalogDeck, traceId);
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
            catch (InvalidOperationException ex)
            {
                var conflict = ApiResult<object>.Fail("Conflict", ex.Message, traceId);
                return Conflict(conflict);
            }
        }
    }
}