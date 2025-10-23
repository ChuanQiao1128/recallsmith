using Authoring.Core.Common;
using Authoring.Core.Contracts.Deck;
using Authoring.Infrastructure.Services;
using Microsoft.AspNetCore.Mvc;

namespace RecallSmith.Api.Controllers.Authoring;

[ApiController]
[Route("api/authoring/decks")]
public class DecksController : ControllerBase
{
    private readonly AuthoringService _svc;
    public DecksController(AuthoringService svc) => _svc = svc;

    // POST /api/authoring/decks
    [HttpPost]
    public async Task<ActionResult<ApiResult<DeckDetailResponse>>> Create([FromBody] CreateDeckRequest req, CancellationToken ct)
    {
        var d = await _svc.CreateDeckAsync(req, ct);
        var res = ApiResult<DeckDetailResponse>.SuccessResult(d);
        // 返回 201 + Location
        return CreatedAtAction(nameof(GetById), new { deckId = d.DeckId }, res);
    }

    // GET /api/authoring/decks
    [HttpGet]
    public async Task<ActionResult<ApiResult<PagedResult<DeckSummaryResponse>>>> List([FromQuery] DeckQuery query, CancellationToken ct)
    {
        var page = await _svc.ListDecksAsync(query, ct);
        return Ok(ApiResult<PagedResult<DeckSummaryResponse>>.SuccessResult(page));
    }

    // GET /api/authoring/decks/{deckId}
    [HttpGet("{deckId:guid}")]
    public async Task<ActionResult<ApiResult<DeckDetailResponse>>> GetById([FromRoute] Guid deckId, CancellationToken ct)
    {
        var d = await _svc.GetDeckAsync(deckId, ct);
        return Ok(ApiResult<DeckDetailResponse>.SuccessResult(d));
    }

    // PUT /api/authoring/decks/{deckId}
    [HttpPut("{deckId:guid}")]
    public async Task<ActionResult<ApiResult<DeckDetailResponse>>> Update([FromRoute] Guid deckId, [FromBody] UpdateDeckRequest req, CancellationToken ct)
    {
        var d = await _svc.UpdateDeckAsync(deckId, req, ct);
        return Ok(ApiResult<DeckDetailResponse>.SuccessResult(d));
    }

    // DELETE /api/authoring/decks/{deckId}
    [HttpDelete("{deckId:guid}")]
    public async Task<ActionResult<ApiResult<object?>>> Delete([FromRoute] Guid deckId, CancellationToken ct)
    {
        await _svc.DeleteDeckAsync(deckId, ct);
        return Ok(ApiResult<object?>.SuccessResult(null));
    }
}