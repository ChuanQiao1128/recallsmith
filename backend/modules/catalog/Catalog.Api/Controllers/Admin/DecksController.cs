using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Catalog.Application;
using Contracts.Catalog.Admin;
using Contracts.Common;

namespace Catalog.Api.Controllers.Admin;

[ApiController]
[Route("api/admin/decks")]
public class DecksController : ControllerBase
{
    private readonly ICatalogAdminService _admin;
    private readonly ICatalogQueryService _queries;

    public DecksController(ICatalogAdminService admin, ICatalogQueryService queries)
    {
        _admin = admin;
        _queries = queries;
    }

    // POST /api/admin/decks
    [HttpPost]
    public async Task<ActionResult<CreateDeckResponse>> Create([FromBody] CreateDeckRequest req, CancellationToken ct)
    {
        // 将请求 DTO 映射为 Cmd
        var cmd = new CreateDeckCmd(req.Slug, req.Title, req.Locale);
        var res = await _admin.CreateDeckAsync(cmd, ct);
        return Ok(res);
    }

    // POST /api/admin/decks/cards?deckId=...
    [HttpPost("cards")]
    public async Task<ActionResult<CreateDraftCardResponse>> CreateCard(
        [FromQuery] Guid deckId,
        [FromBody] CreateDraftCardRequest req,
        CancellationToken ct)
    {
        var cmd = new CreateDraftCardCmd(
            deckId,
            req.StableUid,
            req.FrontMd,
            req.BackMd,
            req.KeyPoint,
            req.Tags ?? new List<string>(),
            req.Difficulty
        );
        var res = await _admin.CreateDraftCardAsync(cmd, ct);
        return Ok(res);
    }

    // POST /api/admin/decks/publish?deckId=...
    [HttpPost("publish")]
    public async Task<ActionResult<PublishDeckResponse>> Publish(
        [FromQuery] Guid deckId,
        [FromBody] PublishDeckRequest req,
        CancellationToken ct)
    {
        var cmd = new PublishDeckCmd(deckId, req.Version, req.Changelog);
        var res = await _admin.PublishDeckAsync(cmd, ct);
        return Ok(res);
    }

    // GET /api/admin/decks?query=&page=&pageSize=
    [HttpGet]
    public async Task<ActionResult<PagedResult<DeckListItemDto>>> List(
        [FromQuery] string? query,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken ct = default)
    {
        var (items, total) = await _queries.ListDecksAsync(query, page, pageSize, ct);
        return Ok(new PagedResult<DeckListItemDto>(items, total, page, pageSize));
    }

    // GET /api/admin/decks/detail?deckId=...
    [HttpGet("detail")]
    public async Task<ActionResult<DeckDetailDto>> Detail([FromQuery] Guid deckId, CancellationToken ct)
    {
        var d = await _queries.GetDeckAsync(deckId, ct);
        return d is null ? NotFound() : Ok(d);
    }

    // GET /api/admin/decks/cards?deckId=...
    [HttpGet("cards")]
    public async Task<ActionResult<IReadOnlyList<CardDto>>> Cards([FromQuery] Guid deckId, CancellationToken ct)
    {
        var list = await _queries.ListDeckCardsAsync(deckId, ct);
        return Ok(list);
    }
}
