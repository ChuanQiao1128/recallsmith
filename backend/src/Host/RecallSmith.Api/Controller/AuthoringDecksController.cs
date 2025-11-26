using System;
using Microsoft.AspNetCore.Mvc;
using RecallSmith.Api.Application.Decks;
using RecallSmith.Api.Models;

namespace RecallSmith.Api.Controllers;

[ApiController]
[Route("api/authoring/decks")]
public class AuthoringDecksController : ControllerBase
{
    private readonly IDeckService _deckService;

    public AuthoringDecksController(IDeckService deckService)
    {
        _deckService = deckService;
    }

    private string GetTraceId()
    {
        return HttpContext?.TraceIdentifier ?? Guid.NewGuid().ToString("N");
    }

    // GET /api/authoring/decks
    // GET /api/authoring/decks?id=1
    // GET /api/authoring/decks?title=xxx&sortbyCreatedAt=asc/desc&currentPage=1
    [HttpGet]
    public ActionResult<ApiResult<object>> Get(
        [FromQuery] int? id,
        [FromQuery] string? title,
        [FromQuery] string? sortbyCreatedAt,
        [FromQuery] int? currentPage)
    {
        string traceId = GetTraceId();

        // 列表
        if (id is null)
        {
            var decks = _deckService.GetDecks(title, sortbyCreatedAt, currentPage);
            var result = ApiResult<object>.Ok(decks, traceId);
            return Ok(result);
        }

        // 单条
        var deck = _deckService.GetDeckById(id.Value);
        if (deck is null)
        {
            var error = ApiResult<object>.Fail(
                "NotFound",
                $"Deck with id {id.Value} not found.",
                traceId);
            return NotFound(error);
        }

        var okResult = ApiResult<object>.Ok(deck, traceId);
        return Ok(okResult);
    }

    // POST /api/authoring/decks?title=xxx&author=yyy
    [HttpPost]
    public ActionResult<ApiResult<object>> Post(
        [FromQuery] string? title,
        [FromQuery] string? author)
    {
        string traceId = GetTraceId();

        // 1. 校验参数
        if (string.IsNullOrWhiteSpace(title))
        {
            var error = ApiResult<object>.Fail("BadRequest", "Title is required.", traceId);
            return BadRequest(error);
        }
        if (string.IsNullOrWhiteSpace(author))
        {
            var error = ApiResult<object>.Fail("BadRequest", "Author is required.", traceId);
            return BadRequest(error);
        }

        string normalizedTitle = title.Trim();
        string normalizedAuthor = author.Trim();

        // 2. 检查重复标题（只看未软删的）
        if (_deckService.TitleExists(normalizedTitle, excludeId: null))
        {
            var error = ApiResult<object>.Fail(
                "Conflict",
                $"Deck with the title '{normalizedTitle}' already exists.",
                traceId);
            return Conflict(error);
        }

        // 3. 创建由 Service + Repository 完成（数据库生成 id）
        var newDeck = _deckService.CreateDeck(normalizedTitle, normalizedAuthor);

        // 4. 返回 201 Created + 统一响应
        string location = $"api/authoring/decks?id={newDeck.Id}";
        var ok = ApiResult<object>.Ok(newDeck, traceId);
        return Created(location, ok);
    }

    // DELETE /api/authoring/decks?id=1
    [HttpDelete]
    public ActionResult<ApiResult<object>> Delete([FromQuery] int id)
    {
        string traceId = GetTraceId();

        if (id <= 0)
        {
            var error = ApiResult<object>.Fail(
                "BadRequest",
                "id should be greater than 0",
                traceId);
            return BadRequest(error);
        }

        bool found = _deckService.SoftDeleteDeck(id);
        if (!found)
        {
            var error = ApiResult<object>.Fail(
                "NotFound",
                $"Deck with id {id} not found.",
                traceId);
            return NotFound(error);
        }

        // 幂等：已经软删的情况下，也视为成功
        var ok = ApiResult<object>.Ok(null, traceId);
        return Ok(ok);
    }

    // PUT /api/authoring/decks?id=1&title=xxx&author=yyy
    [HttpPut]
    public ActionResult<ApiResult<object>> Update(
    [FromQuery] int id,
    [FromQuery] string? title,
    [FromQuery] string? author,
    [FromQuery] int? expectedVersion)
    {
        string traceId = GetTraceId();

        // 1. 基本参数校验
        if (id <= 0)
        {
            var error = ApiResult<object>.Fail(
                "BadRequest",
                "id should be greater than 0",
                traceId);
            return BadRequest(error);
        }

        if (expectedVersion is null || expectedVersion <= 0)
        {
            var error = ApiResult<object>.Fail(
                "BadRequest",
                "expectedVersion is required and must be greater than 0.",
                traceId);
            return BadRequest(error);
        }

        string? newTitle = title?.Trim();
        string? newAuthor = author?.Trim();

        bool hasTitle = !string.IsNullOrWhiteSpace(newTitle);
        bool hasAuthor = !string.IsNullOrWhiteSpace(newAuthor);

        if (!hasTitle && !hasAuthor)
        {
            var error = ApiResult<object>.Fail(
                "BadRequest",
                "At least one of title or author must be provided.",
                traceId);
            return BadRequest(error);
        }

        // 2. 如果要改标题，先检查是否和其他未删 Deck 冲突
        if (hasTitle && _deckService.TitleExists(newTitle!, excludeId: id))
        {
            var error = ApiResult<object>.Fail(
                "Conflict",
                $"Deck with the title '{newTitle}' already exists.",
                traceId);
            return Conflict(error);
        }

        // 3. 调用 Service 做乐观并发更新
        bool versionConflict;
        var updated = _deckService.UpdateDeck(
            id,
            expectedVersion.Value,
            newTitle,
            newAuthor,
            out versionConflict);

        if (versionConflict)
        {
            var error = ApiResult<object>.Fail(
                "VersionConflict",
                "Deck has been modified by another request. Please refresh and retry.",
                traceId);
            return Conflict(error); // HTTP 409
        }

        if (updated is null)
        {
            var error = ApiResult<object>.Fail(
                "NotFound",
                $"Deck with id {id} not found.",
                traceId);
            return NotFound(error);
        }

        var ok = ApiResult<object>.Ok(updated, traceId);
        return Ok(ok);
    }
}